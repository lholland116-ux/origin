import { describe, expect, it, vi } from "vitest";
import type { IntelligencePlan, PlanStep } from "@/lib/ai/intelligence-plan";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import type { CapabilityExecutionInput, ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import { CapabilityAdapterError } from "@/lib/agent-runtime/capability-adapters/common";
import { InMemoryExecutionStore } from "@/lib/agent-runtime/in-memory-execution-store";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import type { ExecutionStepResult } from "@/lib/agent-runtime/runtime-contracts";
import type { ExecutionStore } from "@/lib/agent-runtime/execution-store";

const USER_ID = "a2100000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "a2100000-0000-4000-8000-000000000002";
const RUN_ID = "b2100000-0000-4000-8000-000000000001";
const BINDING: RequestMessageBinding = {
  requestId: "c2100000-0000-4000-8000-000000000001",
  userId: USER_ID,
  conversationId: "a1100000-0000-4000-8000-000000000099",
  userMessageId: "c2100000-0000-4000-8000-000000000002",
  assistantMessageId: "c2100000-0000-4000-8000-000000000003",
};

function handoff(steps: PlanStep[] = [
  { id: "step-1", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
  { id: "step-2", capability: "standard", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "search_results" }], expectedOutput: "text" },
]): PlannedExecutionHandoff {
  const objective = "Search and explain";
  const plan: IntelligencePlan = { objective, steps, status: "validated" };
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid) throw new Error(`Invalid human-control fixture: ${validation.errors.join(", ")}`);
  return {
    version: 1,
    objective,
    plan,
    orderedStepIds: validation.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 6,
      capabilityIds: [...new Set(steps.map((step) => step.capability))].sort() as PlannedExecutionHandoff["governance"]["capabilityIds"],
      modelPlanningAllowed: true,
      maxModelCalls: 2,
      maxRepairAttempts: 1,
      attachmentContextAllowed: true,
      handoffVersion: 1,
    },
  };
}

function result(input: CapabilityExecutionInput): ExecutionStepResult {
  return input.stepId === "step-1"
    ? { kind: "search_results", value: { sources: ["stable-result"] } }
    : { kind: "text", value: { answer: "stable-answer" } };
}

function input(overrides: Partial<ExecutionRuntimeInput> = {}): ExecutionRuntimeInput {
  return {
    authenticatedUserId: USER_ID,
    conversationId: BINDING.conversationId,
    requestMessageBinding: BINDING,
    userInput: "Search this topic and explain it.",
    ...overrides,
  };
}

function makeRuntime(
  store: ExecutionStore,
  options: {
    readonly execute?: (request: CapabilityExecutionInput) => Promise<ExecutionStepResult>;
    readonly authorize?: (stepId: string) => Promise<boolean>;
    readonly approvalPolicy?: (steps: readonly PlanStep[]) => readonly string[];
    readonly now?: () => Date;
  } = {},
) {
  let key = 0;
  let control = 0;
  return new DurableXStateExecutionRuntime({
    store,
    executor: { execute: options.execute ?? (async (request) => result(request)) },
    authorizer: { authorize: async ({ stepId }) => ({ allowed: await (options.authorize?.(stepId) ?? Promise.resolve(true)) }) },
    requestMessageBindingValidator: { validate: async () => true },
    createExecutionId: () => RUN_ID,
    createExecutionKey: () => `d2100000-0000-4000-8000-${String(++key).padStart(12, "0")}`,
    createControlId: () => `e2100000-0000-4000-8000-${String(++control).padStart(12, "0")}`,
    ...(options.approvalPolicy ? { approvalPolicy: ({ steps }) => options.approvalPolicy!(steps) } : {}),
    now: options.now ?? (() => new Date("2026-10-08T12:00:00.000Z")),
  });
}

describe("durable execution human controls", () => {
  it("pauses between steps, preserves the predecessor and binding, and only explicit resume continues", async () => {
    const store = new InMemoryExecutionStore();
    const calls: string[] = [];
    const service = makeRuntime(store, { execute: async (request) => {
      calls.push(request.stepId);
      if (request.stepId === "step-1") {
        expect(await service.pause({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "pause_requested" });
      }
      return result(request);
    } });

    const paused = await service.execute(handoff(), input(), "pause-between-steps");
    expect(paused.kind).toBe("paused");
    const saved = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(saved).toMatchObject({ controlState: "paused", runtimeContext: { requestMessageBinding: BINDING }, steps: [
      { stepId: "step-1", status: "succeeded", result: { kind: "search_results" } },
      { stepId: "step-2", status: "pending" },
    ] });
    expect((await service.resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).kind).toBe("paused");
    expect(calls).toEqual(["step-1"]);

    const continued = await makeRuntime(store, { execute: async (request) => { calls.push(request.stepId); return result(request); } })
      .resumeControl({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(continued.kind).toBe("succeeded");
    expect(calls).toEqual(["step-1", "step-2"]);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map((step) => step.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("records an in-flight pause without claiming cancellation and stops at the next checkpoint", async () => {
    const store = new InMemoryExecutionStore();
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const providerGate = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const service = makeRuntime(store, { execute: async (request) => {
      calls.push(request.stepId);
      if (request.stepId === "step-1") {
        signalEntered();
        await providerGate;
      }
      return result(request);
    } });
    const executing = service.execute(handoff(), input(), "pause-in-flight");
    await entered;
    expect(await service.pause({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "pause_requested" });
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps[0]?.status).toBe("running");
    release();
    expect((await executing).kind).toBe("paused");
    expect(await makeRuntime(store, { execute: async (request) => { calls.push(request.stepId); return result(request); } })
      .resumeControl({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "succeeded" });
    expect(calls).toEqual(["step-1", "step-2"]);
  });

  it("persists pause across runtime reconstruction, makes duplicate pause idempotent, and rejects another owner", async () => {
    const store = new InMemoryExecutionStore();
    const first = makeRuntime(store, { approvalPolicy: () => ["step-1"] });
    const waiting = await first.execute(handoff(), input(), "pause-restart");
    expect(waiting.kind).toBe("awaiting_human_approval");
    expect(await first.pause({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "paused" });
    expect(await first.pause({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "already_applied", run: { controlState: "paused" } });
    expect(await first.pause({ runId: RUN_ID, authenticatedUserId: OTHER_USER_ID })).toMatchObject({ kind: "rejected" });
    expect((await makeRuntime(store).resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).kind).toBe("paused");
    expect(await makeRuntime(store).resumeControl({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "awaiting_human_approval" });
  });

  it("serializes a control request against a claim at the store boundary", async () => {
    const store = new InMemoryExecutionStore();
    const service = makeRuntime(store, { approvalPolicy: () => ["step-2"] });
    expect((await service.execute(handoff(), input(), "pause-versus-claim")).kind).toBe("awaiting_human_approval");
    const run = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(run).toBeTruthy();
    if (!run) return;
    const checkpointSnapshot = run.snapshot;
    const [pause, claim] = await Promise.all([
      store.pauseRun({ runId: RUN_ID, userId: USER_ID, actorUserId: USER_ID, expectedControlRevision: run.controlRevision, createdAt: "2026-10-08T12:00:01.000Z" }),
      store.claimStep({ runId: RUN_ID, userId: USER_ID, stepId: "step-2", expectedRevision: run.snapshotRevision, snapshot: checkpointSnapshot, startedAt: "2026-10-08T12:00:01.000Z" }),
    ]);
    expect(["paused", "pause_requested"]).toContain(pause.status);
    expect(["control_blocked", "approval_required"]).toContain(claim.status);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps[1]?.status).toBe("pending");
  });

  it("requires explicit resume, reauthorizes the next step, and does not dispatch when authorization is denied", async () => {
    const store = new InMemoryExecutionStore();
    const first = makeRuntime(store, { execute: async (request) => {
      if (request.stepId === "step-1") {
        expect(await first.pause({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "pause_requested" });
      }
      return result(request);
    } });
    expect((await first.execute(handoff(), input(), "resume-reauthorize")).kind).toBe("paused");
    const calls: string[] = [];
    const resumed = await makeRuntime(store, {
      execute: async (request) => { calls.push(request.stepId); return result(request); },
      authorize: async () => false,
    }).resumeControl({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(resumed).toMatchObject({ kind: "failed", failure: { code: "authorization_denied" } });
    expect(calls).toEqual([]);
  });

  it("does not resume an indeterminate in-flight operation", async () => {
    const backend = new InMemoryExecutionStore();
    let calls = 0;
    const crashAtCheckpoint: ExecutionStore = {
    createRun: (value) => backend.createRun(value),
    associateAcceptedRequest: (value) => backend.associateAcceptedRequest(value),
    lookupAcceptedRequestRun: (value) => backend.lookupAcceptedRequestRun(value),
      getRun: (value) => backend.getRun(value),
      getControlEvents: (value) => backend.getControlEvents(value),
      pauseRun: (value) => backend.pauseRun(value),
      resumeRun: (value) => backend.resumeRun(value),
      stopRun: (value) => backend.stopRun(value),
      createApprovalCheckpoint: (value) => backend.createApprovalCheckpoint(value),
      decideApprovalCheckpoint: (value) => backend.decideApprovalCheckpoint(value),
      saveRunState: (value) => backend.saveRunState(value),
      claimStep: (value) => backend.claimStep(value),
      scheduleStepRetry: (value) => backend.scheduleStepRetry(value),
      claimRetryableStep: (value) => backend.claimRetryableStep(value),
      checkpoint: async () => { throw new Error("simulated persistence interruption"); },
    };
    const first = makeRuntime(crashAtCheckpoint, { execute: async (request) => { calls += 1; return result(request); } });
    expect(await first.execute(handoff(), input(), "recovery-required-resume"))
      .toMatchObject({ kind: "rejected", failure: { code: "persistence_failed" } });
    const resumed = await makeRuntime(backend).resumeControl({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(resumed).toMatchObject({ kind: "recovery_required", failure: { code: "indeterminate_step" }, stepId: "step-1" });
    expect(calls).toBe(1);
  });

  it("gates only the trusted selected step, survives restart, and approval does not bypass execution authorization", async () => {
    const store = new InMemoryExecutionStore();
    const calls: string[] = [];
    let accessRevoked = false;
    const first = makeRuntime(store, { approvalPolicy: () => ["step-2"], execute: async (request) => {
      calls.push(request.stepId);
      return result(request);
    } });
    const outcome = await first.execute(handoff(), input(), "step-specific-approval");
    expect(outcome).toMatchObject({ kind: "awaiting_human_approval", checkpoint: { stepId: "step-2", status: "pending" } });
    expect(calls).toEqual(["step-1"]);
    if (outcome.kind !== "awaiting_human_approval") return;
    expect(await makeRuntime(store).approveCheckpoint({ runId: RUN_ID, authenticatedUserId: OTHER_USER_ID, checkpointId: outcome.checkpoint.id })).toMatchObject({ kind: "rejected" });
    expect(await makeRuntime(store).approveCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: outcome.checkpoint.id })).toMatchObject({ kind: "approved", checkpoint: { stepId: "step-2", status: "approved" } });
    expect(await makeRuntime(store).approveCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: outcome.checkpoint.id })).toMatchObject({ kind: "already_applied" });
    expect(calls).toEqual(["step-1"]);
    accessRevoked = true;
    const resumed = await makeRuntime(store, {
      authorize: async () => !accessRevoked,
      execute: async (request) => { calls.push(request.stepId); return result(request); },
    })
      .resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(resumed).toMatchObject({ kind: "failed", failure: { code: "authorization_denied" } });
    expect(calls).toEqual(["step-1"]);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map((step) => step.attempt)).toEqual([1, 1]);
  });

  it("allows an owner control request to create an exact-step checkpoint before that step is claimed", async () => {
    const store = new InMemoryExecutionStore();
    const calls: string[] = [];
    let controlResult: Awaited<ReturnType<DurableXStateExecutionRuntime["requireApproval"]>> | undefined;
    const service = makeRuntime(store, { execute: async (request) => {
      calls.push(request.stepId);
      if (request.stepId === "step-1") {
        controlResult = await service.requireApproval({ runId: RUN_ID, authenticatedUserId: USER_ID, stepId: "step-2" });
      }
      return result(request);
    } });
    const waiting = await service.execute(handoff(), input(), "owner-control-gate");
    expect(controlResult).toMatchObject({ kind: "awaiting_human_approval", checkpoint: { stepId: "step-2", source: "owner_request", requestedBy: USER_ID } });
    expect(waiting).toMatchObject({ kind: "awaiting_human_approval", checkpoint: { stepId: "step-2", status: "pending" } });
    expect(calls).toEqual(["step-1"]);
    if (waiting.kind !== "awaiting_human_approval") return;
    expect(await service.approveCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: waiting.checkpoint.id })).toMatchObject({ kind: "approved" });
    expect((await service.resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).kind).toBe("succeeded");
    expect(calls).toEqual(["step-1", "step-2"]);
    expect((await store.getControlEvents({ runId: RUN_ID, userId: USER_ID })).map((event) => event.action)).toContain("approval_required");
  });

  it("rejects planner-supplied approval fields instead of treating them as human authorization", async () => {
    const store = new InMemoryExecutionStore();
    const forged = handoff();
    const forgedStep = { ...forged.plan.steps[0]!, humanApproved: true } as PlanStep;
    const forgedHandoff = { ...forged, plan: { ...forged.plan, steps: [forgedStep, forged.plan.steps[1]!] } };
    const execute = vi.fn(async (request: CapabilityExecutionInput) => result(request));
    expect(await makeRuntime(store, { execute }).execute(forgedHandoff, input(), "planner-cannot-approve"))
      .toMatchObject({ kind: "rejected" });
    expect(execute).not.toHaveBeenCalled();
    expect(await store.getRun({ runId: RUN_ID, userId: USER_ID })).toBeNull();
  });

  it("allows only one of competing approval and return decisions and persists return rationale", async () => {
    const store = new InMemoryExecutionStore();
    const pending = await makeRuntime(store, { approvalPolicy: () => ["step-1"] }).execute(handoff(), input(), "decision-race");
    expect(pending.kind).toBe("awaiting_human_approval");
    if (pending.kind !== "awaiting_human_approval") return;
    const decisionRuntime = makeRuntime(store);
    const decisions = await Promise.all([
      decisionRuntime.approveCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: pending.checkpoint.id }),
      decisionRuntime.returnCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: pending.checkpoint.id, rationale: "Please revise the scope." }),
    ]);
    expect(decisions.filter((decision) => decision.kind === "approved" || decision.kind === "returned")).toHaveLength(1);
    expect(decisions.filter((decision) => decision.kind === "rejected")).toHaveLength(1);
    const saved = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    const events = await store.getControlEvents({ runId: RUN_ID, userId: USER_ID });
    expect(events.map((event) => event.action)).toContain(saved?.approvalCheckpoints[0]?.status === "approved" ? "approved" : "returned");
    if (saved?.approvalCheckpoints[0]?.status === "returned") {
      expect(saved.approvalCheckpoints[0].rationale).toBe("Please revise the scope.");
      expect(saved.controlState).toBe("returned");
      expect((await makeRuntime(store).resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).kind).toBe("returned");
      expect((await makeRuntime(store).approveCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: pending.checkpoint.id })).kind).toBe("rejected");
    }
  });

  it("keeps an explicitly returned checkpoint non-executing and rejects later approval", async () => {
    const store = new InMemoryExecutionStore();
    const calls: string[] = [];
    const service = makeRuntime(store, {
      approvalPolicy: () => ["step-1"],
      execute: async (request) => { calls.push(request.stepId); return result(request); },
    });
    const pending = await service.execute(handoff(), input(), "explicit-return");
    if (pending.kind !== "awaiting_human_approval") throw new Error("Expected a pending human checkpoint.");
    expect(await service.returnCheckpoint({
      runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: pending.checkpoint.id, rationale: "Please narrow the requested scope.",
    })).toMatchObject({ kind: "returned", checkpoint: { status: "returned", rationale: "Please narrow the requested scope." } });
    expect((await service.resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).kind).toBe("returned");
    expect(await service.approveCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: pending.checkpoint.id }))
      .toMatchObject({ kind: "rejected" });
    expect(calls).toEqual([]);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.controlState).toBe("returned");
  });

  it("stops future work and retry claims without implying cancellation of current external work", async () => {
    const store = new InMemoryExecutionStore();
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const providerGate = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const service = makeRuntime(store, { execute: async (request) => {
      calls.push(request.stepId);
      if (request.stepId === "step-1") {
        signalEntered();
        await providerGate;
      }
      return result(request);
    } });
    const executing = service.execute(handoff(), input(), "stop-in-flight");
    await entered;
    expect(await service.stop({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "stop_requested" });
    release();
    expect((await executing).kind).toBe("stopped");
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map((step) => step.status)).toEqual(["succeeded", "pending"]);
    expect(await makeRuntime(store).resumeControl({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "rejected" });
    expect(calls).toEqual(["step-1"]);
  });

  it("stops a run before a gated step and prevents a persisted retry claim", async () => {
    const gateStore = new InMemoryExecutionStore();
    const gateCalls: string[] = [];
    const gated = makeRuntime(gateStore, {
      approvalPolicy: () => ["step-1"],
      execute: async (request) => { gateCalls.push(request.stepId); return result(request); },
    });
    expect((await gated.execute(handoff(), input(), "stop-before-step")).kind).toBe("awaiting_human_approval");
    expect(await gated.stop({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "stopped" });
    expect((await makeRuntime(gateStore).resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).kind).toBe("stopped");
    expect(gateCalls).toEqual([]);

    const retryAt = new Date("2026-10-08T12:00:00.000Z");
    const retryStore = new InMemoryExecutionStore(() => new Date(retryAt));
    let attempts = 0;
    const retryRuntime = makeRuntime(retryStore, {
      now: () => new Date(retryAt),
      execute: async () => {
        attempts += 1;
        throw new CapabilityAdapterError("transient_dependency_failure", {
          phase: "pre_provider", retrySafety: "SAFE_RETRY", retryAfterMs: 1_000,
        });
      },
    });
    expect((await retryRuntime.execute(handoff(), input(), "stop-retry")).kind).toBe("retry_pending");
    expect(await retryRuntime.stop({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "stopped" });
    const retry = await retryStore.getRun({ runId: RUN_ID, userId: USER_ID });
    if (!retry) throw new Error("Expected persisted retry state.");
    expect(await retryStore.claimRetryableStep({
      runId: RUN_ID, userId: USER_ID, stepId: "step-1", expectedRevision: retry.snapshotRevision, snapshot: retry.snapshot,
    })).toMatchObject({ status: "control_blocked", controlState: "stopped" });
    expect((await retryStore.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps[0]).toMatchObject({ status: "retry_pending", attempt: 1 });
    expect(attempts).toBe(1);
  });

  it("preserves a scheduled retry and attempt budget while paused", async () => {
    const retryAt = new Date("2026-10-08T12:00:00.000Z");
    let storeNow = new Date(retryAt);
    const store = new InMemoryExecutionStore(() => new Date(storeNow));
    let failures = 0;
    const service = makeRuntime(store, {
      now: () => new Date(retryAt),
      execute: async (request) => {
        if (request.stepId === "step-1" && failures++ === 0) {
          throw new CapabilityAdapterError("transient_dependency_failure", {
            phase: "pre_provider", retrySafety: "SAFE_RETRY", retryAfterMs: 30_000,
          });
        }
        return result(request);
      },
    });
    expect(await service.execute(handoff(), input(), "pause-retry")).toMatchObject({ kind: "retry_pending" });
    expect(await service.pause({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "paused" });
    const paused = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(paused?.steps[0]).toMatchObject({ status: "retry_pending", attempt: 1, nextRetryAt: expect.any(String) });
    expect((await makeRuntime(store).resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).kind).toBe("paused");
    storeNow = new Date("2026-10-08T12:01:00.000Z");
    const resumed = await makeRuntime(store, { now: () => new Date("2026-10-08T12:01:00.000Z") })
      .resumeControl({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(resumed.kind).toBe("succeeded");
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps[0]).toMatchObject({ status: "succeeded", attempt: 2 });
  });

  it("records owner, revisions, action and rationale in append-only in-memory audit events", async () => {
    const store = new InMemoryExecutionStore();
    const service = makeRuntime(store, { approvalPolicy: () => ["step-1"] });
    const waiting = await service.execute(handoff(), input(), "control-audit");
    if (waiting.kind !== "awaiting_human_approval") throw new Error("Expected a human checkpoint.");
    await service.returnCheckpoint({ runId: RUN_ID, authenticatedUserId: USER_ID, checkpointId: waiting.checkpoint.id, rationale: "Out of scope." });
    const events = await store.getControlEvents({ runId: RUN_ID, userId: USER_ID });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "approval_required", controlRevision: 1 }),
      expect.objectContaining({ action: "returned", actorUserId: USER_ID, rationale: "Out of scope.", controlRevision: 2 }),
    ]));
    expect(events.every((event) => event.controlRevision === event.priorControlRevision + 1)).toBe(true);
  });
});
