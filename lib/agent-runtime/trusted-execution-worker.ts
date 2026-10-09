import { randomUUID } from "node:crypto";
import type { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { isAutonomousCapabilityAllowed } from "@/lib/agent-runtime/autonomous-capability-policy";
import type { DiscoveredExecutionWork, ExecutionStore } from "@/lib/agent-runtime/execution-store";
import { EXECUTION_WORK_LEASE_POLICY } from "@/lib/agent-runtime/execution-store";

if (typeof window !== "undefined") throw new Error("Trusted execution worker is server-only");

const MAX_DISCOVERY_PER_INVOCATION = 10;
const MAX_WORK_ITEMS_PER_INVOCATION = 1;
const MAX_SLICE_WALL_TIME_MS = 90_000;
const LEASE_SECONDS = EXECUTION_WORK_LEASE_POLICY.defaultSeconds;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TrustedExecutionWorkerOutcome = Readonly<{
  status:
    | "no_work"
    | "step_completed"
    | "bounded_yield"
    | "waiting_for_approval"
    | "paused_or_stopped"
    | "retry_pending"
    | "budget_exhausted"
    | "authorization_denied"
    | "lease_lost"
    | "recovery_required"
    | "finalization_pending"
    | "finalization_completed"
    | "terminal";
  runId?: string;
  stepId?: string;
  capability?: string;
  durationMs: number;
  /** Null means the persisted outcome does not prove how many provider calls completed. */
  providerCalls: number | null;
}>;

export type TrustedExecutionWorkerDependencies = Readonly<{
  store: ExecutionStore;
  runtime: DurableXStateExecutionRuntime;
  listPendingFinalizationRunIds(limit: number): Promise<readonly string[]>;
  finalizeAcceptedExecution(runId: string): Promise<{ status: string }>;
  createClaimId?: () => string;
  now?: () => number;
}>;

function outcome(
  status: TrustedExecutionWorkerOutcome["status"],
  started: number,
  now: () => number,
  options: { runId?: string; stepId?: string; capability?: string; providerCalls?: number | null } = {},
): TrustedExecutionWorkerOutcome {
  return Object.freeze({
    status,
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.stepId ? { stepId: options.stepId } : {}),
    ...(options.capability ? { capability: options.capability } : {}),
    durationMs: Math.max(0, now() - started),
    providerCalls: Object.prototype.hasOwnProperty.call(options, "providerCalls") ? options.providerCalls! : 0,
  });
}

function firstWork(items: readonly DiscoveredExecutionWork[]): DiscoveredExecutionWork | undefined {
  return items.find((item) => UUID.test(item.runId) && typeof item.stepId === "string"
    && item.stepId.length > 0 && item.stepId.length <= 128
    && (item.kind === "runnable" || item.kind === "recovery_required"));
}

function hasAcceptedBinding(run: NonNullable<Awaited<ReturnType<ExecutionStore["getAcceptedRunForFinalization"]>>>): boolean {
  const binding = run.runtimeContext.requestMessageBinding;
  return Boolean(run.acceptedRequestId && run.acceptanceFingerprint && binding
    && UUID.test(run.acceptedRequestId) && /^[0-9a-f]{64}$/i.test(run.acceptanceFingerprint)
    && binding.requestId === run.acceptedRequestId && binding.userId === run.userId
    && binding.conversationId === run.runtimeContext.conversationId
    && UUID.test(binding.userMessageId) && UUID.test(binding.assistantMessageId));
}

function providerCallCount(result: unknown, capability: string, stepId: string): number | null {
  if (capability === "image_generation") return 1;
  if (capability !== "standard" || !result || typeof result !== "object" || !("stepResults" in result)) return 0;
  const results = (result as { stepResults?: unknown }).stepResults;
  if (!results || typeof results !== "object") return 0;
  const step = (results as Record<string, unknown>)[stepId];
  if (!step || typeof step !== "object" || !("value" in step)) return 0;
  const value = (step as { value?: unknown }).value;
  if (!value || typeof value !== "object" || !("measurements" in value)) return 0;
  const measurements = (value as { measurements?: unknown }).measurements;
  return Array.isArray(measurements) ? Math.min(measurements.length, 2) : null;
}

function validWorkerBounds(): boolean {
  return Number.isSafeInteger(MAX_DISCOVERY_PER_INVOCATION)
    && MAX_DISCOVERY_PER_INVOCATION >= 1
    && Number.isSafeInteger(MAX_WORK_ITEMS_PER_INVOCATION)
    && MAX_WORK_ITEMS_PER_INVOCATION === 1
    && Number.isSafeInteger(MAX_SLICE_WALL_TIME_MS)
    && MAX_SLICE_WALL_TIME_MS > 0
    && MAX_SLICE_WALL_TIME_MS < LEASE_SECONDS * 1000
    && LEASE_SECONDS >= EXECUTION_WORK_LEASE_POLICY.minimumSeconds
    && LEASE_SECONDS <= EXECUTION_WORK_LEASE_POLICY.maximumSeconds;
}

async function releaseIfSafe(
  store: ExecutionStore,
  runId: string,
  claim: { claimId: string; fencingGeneration: number },
): Promise<boolean> {
  const latest = await store.getAcceptedRunForFinalization({ runId }).catch(() => null);
  if (!latest || latest.steps.some((step) => step.status === "running")) return false;
  return (await store.releaseExecutionWorkClaim({
    runId,
    claim,
    expectedRevision: latest.snapshotRevision,
  }).catch(() => ({ status: "stale_claim" as const }))).status === "released";
}

/** One invocation finalizes one existing message or executes at most one fenced workflow step. */
export function createTrustedExecutionWorker(dependencies: TrustedExecutionWorkerDependencies) {
  const now = dependencies.now ?? Date.now;
  const createClaimId = dependencies.createClaimId ?? randomUUID;

  return Object.freeze({
    async runOnce(): Promise<TrustedExecutionWorkerOutcome> {
      const started = now();
      if (!Number.isSafeInteger(started) || !validWorkerBounds()) return outcome("recovery_required", started, now);

      let pendingFinalizations: readonly string[];
      try {
        pendingFinalizations = await dependencies.listPendingFinalizationRunIds(1);
      } catch {
        return outcome("finalization_pending", started, now);
      }
      const finalizationId = pendingFinalizations.find((id) => UUID.test(id));
      if (finalizationId) {
        const finalized = await dependencies.finalizeAcceptedExecution(finalizationId).catch(() => ({ status: "unavailable" }));
        return outcome(finalized.status === "finalized" || finalized.status === "replayed"
          ? "finalization_completed" : "finalization_pending", started, now, { runId: finalizationId });
      }

      let discovered: readonly DiscoveredExecutionWork[];
      try {
        discovered = await dependencies.store.discoverExecutionWork({ limit: MAX_DISCOVERY_PER_INVOCATION });
      } catch {
        return outcome("no_work", started, now);
      }
      const candidate = firstWork(discovered);
      if (!candidate) return outcome("no_work", started, now);
      if (candidate.kind === "recovery_required") {
        return outcome("recovery_required", started, now, { runId: candidate.runId, stepId: candidate.stepId });
      }

      if (now() - started >= MAX_SLICE_WALL_TIME_MS) return outcome("bounded_yield", started, now, { runId: candidate.runId, stepId: candidate.stepId });
      const claimId = createClaimId();
      if (!UUID.test(claimId)) return outcome("lease_lost", started, now, { runId: candidate.runId, stepId: candidate.stepId });
      const claimResult = await dependencies.store.claimExecutionWork({
        runId: candidate.runId,
        claimId,
        leaseSeconds: LEASE_SECONDS,
      }).catch(() => ({ status: "ineligible" as const }));
      if (claimResult.status === "recovery_required") return outcome("recovery_required", started, now, { runId: candidate.runId, stepId: candidate.stepId });
      if (claimResult.status !== "claimed") {
        return outcome("lease_lost", started, now, { runId: candidate.runId, stepId: candidate.stepId });
      }
      if (claimResult.stepId !== candidate.stepId) {
        await releaseIfSafe(dependencies.store, candidate.runId, claimResult.claim);
        return outcome("lease_lost", started, now, { runId: candidate.runId, stepId: candidate.stepId });
      }

      let run;
      try {
        // Owner and immutable accepted-request binding are loaded from persisted relationships, never caller input.
        run = await dependencies.store.getAcceptedRunForFinalization({ runId: candidate.runId });
      } catch {
        run = null;
      }
      if (!run || run.id !== claimResult.runId || !hasAcceptedBinding(run)
        || run.steps.some((step) => !isAutonomousCapabilityAllowed(step.capabilityId))) {
        await releaseIfSafe(dependencies.store, candidate.runId, claimResult.claim);
        return outcome(run ? "authorization_denied" : "recovery_required", started, now, { runId: candidate.runId, stepId: candidate.stepId });
      }
      const selected = run.steps.find((step) => step.stepId === claimResult.stepId);
      const hasUnresolvedApproval = run.approvalCheckpoints.some((checkpoint) => checkpoint.status !== "approved");
      if (!selected || !isAutonomousCapabilityAllowed(selected.capabilityId)
        || (selected.status !== "pending" && selected.status !== "retry_pending")
        || run.steps.some((step) => step.status === "running")
        || selected.dependencyIds.some((id) => run!.steps.find((step) => step.stepId === id)?.status !== "succeeded")
        || run.controlState !== "active" || hasUnresolvedApproval) {
        await releaseIfSafe(dependencies.store, candidate.runId, claimResult.claim);
        const blocked = run.controlState !== "active" ? "paused_or_stopped"
          : hasUnresolvedApproval ? "waiting_for_approval" : "authorization_denied";
        return outcome(blocked, started, now, { runId: run.id, stepId: claimResult.stepId, capability: selected?.capabilityId });
      }

      const renewed = await dependencies.store.renewExecutionWorkClaim({
        runId: run.id,
        claim: claimResult.claim,
        leaseSeconds: LEASE_SECONDS,
      }).catch(() => ({ status: "stale_claim" as const }));
      if (renewed.status !== "renewed") return outcome("lease_lost", started, now,
        { runId: run.id, stepId: claimResult.stepId, capability: selected.capabilityId });

      const executionDeadlineAtMs = started + MAX_SLICE_WALL_TIME_MS;
      if (!Number.isSafeInteger(executionDeadlineAtMs) || now() >= executionDeadlineAtMs) {
        const released = await releaseIfSafe(dependencies.store, run.id, claimResult.claim);
        return outcome(released ? "bounded_yield" : "lease_lost", started, now,
          { runId: run.id, stepId: selected.stepId, capability: selected.capabilityId });
      }

      const result = await dependencies.runtime.executeClaimedStep({
        runId: run.id,
        authenticatedUserId: run.userId,
        expectedStepId: selected.stepId,
        workClaim: claimResult.claim,
        executionDeadlineAtMs,
      }).catch(() => null);
      if (!result) return outcome("recovery_required", started, now,
        { runId: run.id, stepId: selected.stepId, capability: selected.capabilityId, providerCalls: null });
      if (result.kind === "recovery_required") return outcome("recovery_required", started, now,
        { runId: run.id, stepId: selected.stepId, capability: selected.capabilityId, providerCalls: null });

      const latest = await dependencies.store.getAcceptedRunForFinalization({ runId: run.id }).catch(() => null);
      if (!latest || latest.steps.some((step) => step.status === "running")) {
        return outcome("recovery_required", started, now,
          { runId: run.id, stepId: selected.stepId, capability: selected.capabilityId, providerCalls: null });
      }
      const released = await dependencies.store.releaseExecutionWorkClaim({
        runId: run.id,
        claim: claimResult.claim,
        expectedRevision: latest.snapshotRevision,
      }).catch(() => ({ status: "stale_claim" as const }));
      if (released.status !== "released") return outcome("lease_lost", started, now,
        { runId: run.id, stepId: selected.stepId, capability: selected.capabilityId, providerCalls: null });

      const details = { runId: run.id, stepId: selected.stepId, capability: selected.capabilityId };
      if (result.kind === "slice_yielded") return outcome("bounded_yield", started, now,
        { ...details, providerCalls: providerCallCount(result, selected.capabilityId, selected.stepId) });
      if (result.kind === "retry_pending") return outcome("retry_pending", started, now, details);
      if (result.kind === "awaiting_human_approval") return outcome("waiting_for_approval", started, now, details);
      if (result.kind === "paused" || result.kind === "pause_requested" || result.kind === "stopped"
        || result.kind === "stop_requested" || result.kind === "returned") return outcome("paused_or_stopped", started, now, details);
      if (result.kind === "succeeded") return outcome("step_completed", started, now,
        { ...details, providerCalls: providerCallCount(result, selected.capabilityId, selected.stepId) });
      if (result.kind === "failed") {
        const status = result.failure.code === "quota_exhausted" ? "budget_exhausted"
          : result.failure.code === "authorization_denied" || result.failure.code === "ownership_denied"
            ? "authorization_denied" : "terminal";
        return outcome(status, started, now, { ...details, providerCalls: null });
      }
      if (result.kind === "rejected" && result.failure.code === "authorization_denied") {
        return outcome("authorization_denied", started, now, details);
      }
      return outcome("recovery_required", started, now, { ...details, providerCalls: null });
    },
  });
}
