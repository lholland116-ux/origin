import { describe, expect, it, vi } from "vitest";
import type { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import type { DurableExecutionRun, ExecutionStore } from "@/lib/agent-runtime/execution-store";
import { createTrustedExecutionWorker } from "@/lib/agent-runtime/trusted-execution-worker";

const OWNER = "a2000000-0000-4000-8000-000000000001";
const RUN_ID = "b2000000-0000-4000-8000-000000000001";
const REQUEST_ID = "d2000000-0000-4000-8000-000000000001";
const CLAIM_ID = "c2000000-0000-4000-8000-000000000001";

function run(overrides: Partial<DurableExecutionRun> = {}): DurableExecutionRun {
  return {
    id: RUN_ID,
    userId: OWNER,
    runtimeVersion: 1,
    handoffVersion: 1,
    idempotencyKey: "request-key",
    requestFingerprint: "a".repeat(64),
    acceptedRequestId: REQUEST_ID,
    acceptanceFingerprint: "b".repeat(64),
    executionPlan: { version: 1, steps: [], orderedStepIds: [], plannerSource: "deterministic", governance: {
      maxSteps: 3, capabilityIds: ["standard"], modelPlanningAllowed: false,
      maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1,
    } },
    runtimeContext: { conversationId: "e2000000-0000-4000-8000-000000000001", attachments: [], resourceReferences: [],
      requestMessageBinding: { requestId: REQUEST_ID, userId: OWNER, conversationId: "e2000000-0000-4000-8000-000000000001",
        userMessageId: "f2000000-0000-4000-8000-000000000001", assistantMessageId: "f2000000-0000-4000-8000-000000000002" } },
    status: "pending",
    controlState: "active",
    controlRevision: 0,
    snapshotSchemaVersion: 1,
    snapshotRevision: 0,
    snapshot: { version: 1, runtimeVersion: 1, snapshot: { run: {}, steps: {} } },
    createdAt: "2026-10-09T12:00:00.000Z",
    steps: [{ runId: RUN_ID, userId: OWNER, stepId: "step-1", capabilityId: "standard", dependencyIds: [], attempt: 1,
      executionKey: "f2000000-0000-4000-8000-000000000003", status: "pending" }],
    approvalCheckpoints: [],
    ...overrides,
  } as DurableExecutionRun;
}

function setup(options: { currentRun?: DurableExecutionRun; pendingFinalizations?: readonly string[] } = {}) {
  const currentRun = options.currentRun ?? run();
  const store = {
    discoverExecutionWork: vi.fn(async () => [{ runId: RUN_ID, stepId: "step-1", kind: "runnable", dueAt: "2026-10-09T12:00:00.000Z", fencingGeneration: 0 }]),
    claimExecutionWork: vi.fn(async () => ({ status: "claimed", claim: { claimId: CLAIM_ID, fencingGeneration: 1 }, runId: RUN_ID,
      stepId: "step-1", snapshotRevision: currentRun.snapshotRevision, leaseExpiresAt: "2026-10-09T12:02:00.000Z" })),
    renewExecutionWorkClaim: vi.fn(async () => ({ status: "renewed", leaseExpiresAt: "2026-10-09T12:02:00.000Z" })),
    releaseExecutionWorkClaim: vi.fn(async () => ({ status: "released" })),
    getAcceptedRunForFinalization: vi.fn(async () => currentRun),
  } as unknown as ExecutionStore;
  const runtime = { executeClaimedStep: vi.fn(async () => ({
    kind: "slice_yielded", run: {} as never, stepResults: {}, telemetry: {} as never,
  })) } as unknown as DurableXStateExecutionRuntime;
  const finalizations = options.pendingFinalizations ?? [];
  const worker = createTrustedExecutionWorker({
    store,
    runtime,
    listPendingFinalizationRunIds: vi.fn(async () => finalizations),
    finalizeAcceptedExecution: vi.fn(async () => ({ status: "finalized" })),
    createClaimId: () => CLAIM_ID,
    now: () => 1_000,
  });
  return { worker, store, runtime };
}

describe("trusted bounded execution worker", () => {
  it("claims, renews, advances one step as the persisted owner, and releases at the checkpoint revision", async () => {
    const { worker, store, runtime } = setup();
    const result = await worker.runOnce();

    expect(result).toMatchObject({ status: "bounded_yield", runId: RUN_ID, stepId: "step-1", capability: "standard", durationMs: 0 });
    expect(store.discoverExecutionWork).toHaveBeenCalledWith({ limit: 10 });
    expect(store.claimExecutionWork).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN_ID, claimId: CLAIM_ID, leaseSeconds: 120 }));
    expect(store.renewExecutionWorkClaim).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN_ID, claim: { claimId: CLAIM_ID, fencingGeneration: 1 } }));
    expect(runtime.executeClaimedStep).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID, authenticatedUserId: OWNER, expectedStepId: "step-1",
      workClaim: { claimId: CLAIM_ID, fencingGeneration: 1 }, executionDeadlineAtMs: 91_000,
    }));
    expect(store.releaseExecutionWorkClaim).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID, claim: { claimId: CLAIM_ID, fencingGeneration: 1 }, expectedRevision: 0,
    }));
  });

  it("never dispatches a non-allowlisted capability from a forged/stale discovery result", async () => {
    const runWithDeferred = run({ steps: [{ ...run().steps[0]!, capabilityId: "web_search" }] });
    const { worker, runtime, store } = setup({ currentRun: runWithDeferred });
    expect((await worker.runOnce()).status).toBe("authorization_denied");
    expect(runtime.executeClaimedStep).not.toHaveBeenCalled();
    expect(store.releaseExecutionWorkClaim).toHaveBeenCalledOnce();
  });

  it("does not run a step when the current persisted owner/control/approval state blocks it", async () => {
    const paused = run({ controlState: "paused" });
    const { worker, runtime, store } = setup({ currentRun: paused });
    expect((await worker.runOnce()).status).toBe("paused_or_stopped");
    expect(runtime.executeClaimedStep).not.toHaveBeenCalled();
    expect(store.releaseExecutionWorkClaim).toHaveBeenCalledOnce();

    const approvalPending = run({ approvalCheckpoints: [{ id: "g2000000-0000-4000-8000-000000000001",
      runId: RUN_ID, userId: OWNER, stepId: "step-1", planFingerprint: "c".repeat(64), stepFingerprint: "d".repeat(64),
      status: "pending", source: "runtime_policy", createdAt: "2026-10-09T12:00:00.000Z" }] });
    const pendingSetup = setup({ currentRun: approvalPending });
    expect((await pendingSetup.worker.runOnce()).status).toBe("waiting_for_approval");
    expect(pendingSetup.runtime.executeClaimedStep).not.toHaveBeenCalled();
  });

  it("refuses unassociated runs and never invents accepted-request metadata", async () => {
    const unassociated = run({ acceptedRequestId: undefined, acceptanceFingerprint: undefined });
    const { worker, runtime, store } = setup({ currentRun: unassociated });
    expect((await worker.runOnce()).status).toBe("authorization_denied");
    expect(runtime.executeClaimedStep).not.toHaveBeenCalled();
    expect(store.releaseExecutionWorkClaim).toHaveBeenCalledOnce();
  });

  it("finalizes only one existing assistant destination before trying to claim more work", async () => {
    const { store, runtime } = setup({ pendingFinalizations: [RUN_ID] });
    const finalizer = vi.fn(async () => ({ status: "replayed" }));
    const worker = createTrustedExecutionWorker({ store, runtime, listPendingFinalizationRunIds: async () => [RUN_ID],
      finalizeAcceptedExecution: finalizer, now: () => 1_000 });
    expect(await worker.runOnce()).toMatchObject({ status: "finalization_completed", runId: RUN_ID });
    expect(finalizer).toHaveBeenCalledOnce();
    expect(store.discoverExecutionWork).not.toHaveBeenCalled();
    expect(runtime.executeClaimedStep).not.toHaveBeenCalled();
  });

  it("surfaces ambiguous recovery work without acquiring a claim or replaying a provider call", async () => {
    const { worker, runtime, store } = setup();
    vi.mocked(store.discoverExecutionWork).mockResolvedValue([{
      runId: RUN_ID, stepId: "step-1", kind: "recovery_required", dueAt: "2026-10-09T12:00:00.000Z", fencingGeneration: 1,
    }]);
    expect(await worker.runOnce()).toMatchObject({ status: "recovery_required", runId: RUN_ID });
    expect(store.claimExecutionWork).not.toHaveBeenCalled();
    expect(runtime.executeClaimedStep).not.toHaveBeenCalled();
  });
});
