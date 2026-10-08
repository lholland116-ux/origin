import { describe, expect, it, vi } from "vitest";
import type { IntelligencePlan, PlanStep } from "@/lib/ai/intelligence-plan";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import type {
  CapabilityExecutionInput,
  CapabilityExecutor,
  ExecutionAuthorizer,
  ExecutionRuntimeInput,
  RequestMessageBindingValidator,
} from "@/lib/agent-runtime/capability-executor";
import type { ExecutionStore } from "@/lib/agent-runtime/execution-store";
import type { ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { InMemoryExecutionStore } from "@/lib/agent-runtime/in-memory-execution-store";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { CapabilityAdapterError } from "@/lib/agent-runtime/capability-adapters/common";
import type { ExecutionStepResult } from "@/lib/agent-runtime/runtime-contracts";

const USER_ID = "a2000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "a2000000-0000-4000-8000-000000000002";
const RUN_ID = "b2000000-0000-4000-8000-000000000001";
const REQUEST_BINDING: RequestMessageBinding = {
  requestId: "c2000000-0000-4000-8000-000000000001",
  userId: USER_ID,
  conversationId: "a1000000-0000-4000-8000-000000000099",
  userMessageId: "c2000000-0000-4000-8000-000000000002",
  assistantMessageId: "c2000000-0000-4000-8000-000000000003",
};

function handoff(steps: PlanStep[] = [
  { id: "step-1", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
  { id: "step-2", capability: "standard", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "search_results" }], expectedOutput: "text" },
  { id: "step-3", capability: "document_generation", dependsOn: ["step-2"], inputs: [{ source: "step", stepId: "step-2", output: "text" }], expectedOutput: "document" },
]): PlannedExecutionHandoff {
  const objective = "Private objective deliberately omitted from durable execution plan";
  const plan: IntelligencePlan = { objective, steps, status: "validated" };
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid) throw new Error(`Invalid test plan: ${validation.errors.join(", ")}`);
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

function mockResult(input: CapabilityExecutionInput): ExecutionStepResult {
  const kind: ExecutionStepResult["kind"] = {
    web_search: "search_results",
    standard: "text",
    document_generation: "document",
    file_analysis: "text",
    image_generation: "image",
    image_editing: "image",
  }[input.capabilityId] as ExecutionStepResult["kind"];
  return { kind, value: { step: input.stepId, prior: input.inputs.filter((item) => item.source === "step").map((item) => item.result.value ?? null) } };
}

function runtimeInput(overrides: Partial<ExecutionRuntimeInput> = {}): ExecutionRuntimeInput {
  return {
    authenticatedUserId: USER_ID,
    conversationId: REQUEST_BINDING.conversationId,
    requestMessageBinding: REQUEST_BINDING,
    userInput: "sensitive input needed only until step-1 finishes",
    ...overrides,
  };
}

function runtime(
  store: ExecutionStore,
  executor: CapabilityExecutor["execute"],
  authorize: ExecutionAuthorizer["authorize"] = async () => ({ allowed: true }),
  validateBinding: RequestMessageBindingValidator["validate"] = async () => true,
  nowOverride?: () => Date,
) {
  let keyCounter = 0;
  let runCounter = 0;
  return new DurableXStateExecutionRuntime({
    store,
    executor: { execute: executor },
    authorizer: { authorize },
    requestMessageBindingValidator: { validate: validateBinding },
    createExecutionId: () => `b2000000-0000-4000-8000-${String(++runCounter).padStart(12, "0")}`,
    createExecutionKey: () => `c2000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`,
    now: nowOverride ?? (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 9, 6, 12, 0, tick++));
    })(),
  });
}

function storeWithClaim(base: InMemoryExecutionStore, claim: ExecutionStore["claimStep"]): ExecutionStore {
  return {
    createRun: (input) => base.createRun(input),
    getRun: (input) => base.getRun(input),
    saveRunState: (input) => base.saveRunState(input),
    claimStep: claim,
    scheduleStepRetry: (input) => base.scheduleStepRetry(input),
    claimRetryableStep: (input) => base.claimRetryableStep(input),
    checkpoint: (input) => base.checkpoint(input),
  };
}

describe("durable XState execution runtime", () => {
  it("requires a conversation binding before creating a durable run", async () => {
    const store = new InMemoryExecutionStore();
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const result = await runtime(store, executor).execute(
      handoff(),
      { authenticatedUserId: USER_ID } as ExecutionRuntimeInput,
      "missing-conversation",
    );

    expect(result).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });
    expect(await store.getRun({ runId: RUN_ID, userId: USER_ID })).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it("resumes a safe completed checkpoint without re-executing step-1 and reauthorizes remaining steps", async () => {
    const store = new InMemoryExecutionStore();
    const firstCalls: CapabilityExecutionInput[] = [];
    const firstAuthorizations: string[] = [];
    let claimCount = 0;
    const interruptedStore = storeWithClaim(store, async (input) => {
      claimCount += 1;
      if (claimCount === 2) return { status: "conflict" };
      return store.claimStep(input);
    });
    const firstRuntime = runtime(interruptedStore, async (input) => {
      firstCalls.push(input);
      return mockResult(input);
    }, async ({ stepId }) => {
      firstAuthorizations.push(stepId);
      return { allowed: true };
    });
    const stopped = await firstRuntime.execute(handoff(), runtimeInput(), "resume-safe-key");
    expect(stopped).toMatchObject({ kind: "recovery_required", failure: { code: "snapshot_conflict" } });
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.runtimeContext.conversationId).toBe(runtimeInput().conversationId);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.runtimeContext.requestMessageBinding).toEqual(REQUEST_BINDING);
    expect(firstCalls.map(({ stepId }) => stepId)).toEqual(["step-1"]);
    expect(firstAuthorizations).toEqual(["step-1"]);
    expect(firstCalls[0]?.context.requestMessageBinding).toEqual(REQUEST_BINDING);
    const checkpoint = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(checkpoint).toMatchObject({ status: "running", steps: [{ status: "succeeded" }, { status: "pending" }, { status: "pending" }] });
    expect(checkpoint?.runtimeContext).not.toHaveProperty("userInput");
    expect(JSON.stringify(checkpoint?.executionPlan)).not.toContain("Private objective");

    const resumedCalls: CapabilityExecutionInput[] = [];
    const resumedAuthorizations: string[] = [];
    const resumed = await runtime(store, async (input) => {
      resumedCalls.push(input);
      return mockResult(input);
    }, async ({ stepId }) => {
      resumedAuthorizations.push(stepId);
      return { allowed: true };
    }).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });

    expect(resumed.kind).toBe("succeeded");
    if (resumed.kind !== "succeeded") return;
    expect(resumedCalls.map(({ stepId }) => stepId)).toEqual(["step-2", "step-3"]);
    expect(resumedCalls.every(({ context }) => context.conversationId === runtimeInput().conversationId)).toBe(true);
    expect(resumedCalls.every(({ context }) => context.requestMessageBinding.userMessageId === REQUEST_BINDING.userMessageId
      && context.requestMessageBinding.assistantMessageId === REQUEST_BINDING.assistantMessageId
      && context.requestMessageBinding.requestId === REQUEST_BINDING.requestId)).toBe(true);
    expect(resumedCalls.every(({ executionKey }) => typeof executionKey === "string")).toBe(true);
    expect(resumedAuthorizations).toEqual(["step-2", "step-3"]);
    expect(resumed.run.steps.map(({ status }) => status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(resumed.stepResults["step-1"]).toEqual({ kind: "search_results", value: { step: "step-1", prior: [] } });
  });

  it("passes a large result transparently to a declared successor and returns it unchanged after resume", async () => {
    const store = new InMemoryExecutionStore();
    const largeResult: ExecutionStepResult = {
      kind: "search_results",
      value: { reply: "bounded web result ".repeat(6_000), source: { title: "Source", url: "https://example.test" } },
    };
    const calls: CapabilityExecutionInput[] = [];
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      calls.push(input);
      if (input.stepId === "step-1") return largeResult;
      if (input.stepId === "step-2") return { kind: "text" as const, value: { received: input.inputs[0]?.source === "step" ? input.inputs[0].result : null } };
      return mockResult(input);
    });
    const plan = handoff([
      { id: "step-1", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
      { id: "step-2", capability: "standard", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "search_results" }], expectedOutput: "text" },
    ]);
    const service = runtime(store, executor);
    const result = await service.execute(plan, runtimeInput(), "large-result-transparent-key");

    expect(result.kind).toBe("succeeded");
    expect(calls[1]?.inputs).toEqual([{ source: "step", stepId: "step-1", result: largeResult }]);
    const persisted = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(persisted?.steps[0]?.result).toEqual(largeResult);
    const resumed = await service.resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(resumed.kind).toBe("succeeded");
    if (resumed.kind === "succeeded") expect(resumed.stepResults["step-1"]).toEqual(largeResult);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("returns a terminal succeeded run without executing again and binds idempotency to request content", async () => {
    const store = new InMemoryExecutionStore();
    const execute = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const service = runtime(store, execute);
    const first = await service.execute(handoff(), runtimeInput(), "terminal-key");
    expect(first.kind).toBe("succeeded");
    const resumed = await service.resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(resumed.kind).toBe("succeeded");
    expect(execute).toHaveBeenCalledTimes(3);
    const duplicate = await service.execute(handoff(), runtimeInput(), "terminal-key");
    expect(duplicate.kind).toBe("succeeded");
    expect(execute).toHaveBeenCalledTimes(3);

    const alteredPlan = handoff([{ id: "one-step", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }]);
    expect(await service.execute(alteredPlan, runtimeInput(), "terminal-key")).toMatchObject({ kind: "rejected", failure: { code: "idempotency_conflict" } });
    const conflictingBinding = { ...REQUEST_BINDING, assistantMessageId: "c2000000-0000-4000-8000-000000000004" };
    expect(await service.execute(handoff(), runtimeInput({ requestMessageBinding: conflictingBinding }), "terminal-key"))
      .toMatchObject({ kind: "rejected", failure: { code: "idempotency_conflict" } });
  });

  it("rejects missing or invalid persisted message bindings before creating a run", async () => {
    const store = new InMemoryExecutionStore();
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const missing = await runtime(store, executor).execute(
      handoff(),
      { authenticatedUserId: USER_ID, conversationId: REQUEST_BINDING.conversationId } as ExecutionRuntimeInput,
      "missing-message-binding",
    );
    expect(missing).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });

    const denied = await runtime(store, executor, async () => ({ allowed: true }), async () => false)
      .execute(handoff(), runtimeInput(), "unowned-message-binding");
    expect(denied).toMatchObject({ kind: "rejected", failure: { code: "ownership_denied" } });
    expect(await store.getRun({ runId: RUN_ID, userId: USER_ID })).toBeNull();
    expect(executor).not.toHaveBeenCalled();
  });

  it("freezes the validated binding before passing it to the ownership validator", async () => {
    const store = new InMemoryExecutionStore();
    let validatorMutationRejected = false;
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const result = await runtime(
      store,
      executor,
      async () => ({ allowed: true }),
      async (binding) => {
        validatorMutationRejected = !Reflect.set(
          binding as unknown as { assistantMessageId: string },
          "assistantMessageId",
          "c2000000-0000-4000-8000-000000000004",
        );
        return true;
      },
    ).execute(handoff(), runtimeInput(), "validator-cannot-rebind-message-pair");

    expect(result.kind).toBe("succeeded");
    expect(validatorMutationRejected).toBe(true);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.runtimeContext.requestMessageBinding).toEqual(REQUEST_BINDING);
  });

  it("does not replay a running step after a simulated crash and returns indeterminate recovery", async () => {
    const store = new InMemoryExecutionStore();
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const crashingStore = storeWithClaim(store, async (input) => {
      const claimed = await store.claimStep(input);
      if (claimed.status === "claimed") throw new Error("simulated crash after durable claim");
      return claimed;
    });
    const interrupted = await runtime(crashingStore, executor).execute(handoff(), runtimeInput(), "uncertain-key");
    expect(interrupted).toMatchObject({ kind: "recovery_required", failure: { code: "persistence_failed" } });
    expect(executor).not.toHaveBeenCalled();
    const recovered = await runtime(store, executor).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(recovered).toMatchObject({ kind: "recovery_required", stepId: "step-1", failure: { code: "indeterminate_step" } });
    expect(executor).not.toHaveBeenCalled();
    const uncertain = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(uncertain?.status).toBe("running");
    expect(uncertain?.runtimeContext.requestMessageBinding).toEqual(REQUEST_BINDING);
    expect(uncertain?.steps.map(({ status }) => status)).toEqual(["running", "pending", "pending"]);
  });

  it("resumes retry-pending state without claiming or dispatching it, while a claimed running retry stays fail-closed", async () => {
    let storeNow = new Date("1999-12-31T23:59:59.000Z");
    const store = new InMemoryExecutionStore(() => new Date(storeNow));
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const crashingStore = storeWithClaim(store, async (input) => {
      const claimed = await store.claimStep(input);
      if (claimed.status === "claimed") throw new Error("simulated process interruption after claim");
      return claimed;
    });
    const interrupted = await runtime(crashingStore, executor).execute(handoff(), runtimeInput(), "retry-state-resume-key");
    expect(interrupted).toMatchObject({ kind: "recovery_required", failure: { code: "persistence_failed" } });
    expect(executor).not.toHaveBeenCalled();

    const persisted = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(persisted?.steps.map((step) => step.status)).toEqual(["running", "pending", "pending"]);
    const runActor = createExecutionRunLifecycle(persisted!.snapshot.snapshot.run);
    const stepActors = Object.fromEntries(Object.entries(persisted!.snapshot.snapshot.steps)
      .map(([stepId, snapshot]) => [stepId, createExecutionStepLifecycle(snapshot)]));
    stepActors["step-1"]!.scheduleRetry();
    const retryPendingSnapshot: ExecutionSnapshotEnvelope = {
      version: 1,
      runtimeVersion: 1,
      snapshot: {
        run: runActor.getPersistedSnapshot(),
        steps: Object.fromEntries(Object.entries(stepActors).map(([stepId, actor]) => [stepId, actor.getPersistedSnapshot()])),
      },
    };
    expect(await store.scheduleStepRetry({
      runId: RUN_ID,
      userId: USER_ID,
      stepId: "step-1",
      expectedRevision: persisted!.snapshotRevision,
      snapshot: retryPendingSnapshot,
      nextRetryAt: "2000-01-01T00:00:00.000Z",
    })).toEqual({ status: "saved", snapshotRevision: persisted!.snapshotRevision + 1 });

    const resumed = await runtime(store, executor).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(resumed).toMatchObject({
      kind: "retry_pending",
      stepId: "step-1",
      nextRetryAt: "2000-01-01T00:00:00.000Z",
      run: { status: "running" },
    });
    if (resumed.kind === "retry_pending") {
      expect(resumed.run.steps.map(({ status, attempt }) => [status, attempt]))
        .toEqual([["retry_pending", 1], ["pending", 1], ["pending", 1]]);
    }
    expect(executor).not.toHaveBeenCalled();

    storeNow = new Date("2000-01-01T00:00:00.000Z");
    stepActors["step-1"]!.claimRetry();
    const retryClaimSnapshot: ExecutionSnapshotEnvelope = {
      ...retryPendingSnapshot,
      snapshot: {
        ...retryPendingSnapshot.snapshot,
        steps: Object.fromEntries(Object.entries(stepActors).map(([stepId, actor]) => [stepId, actor.getPersistedSnapshot()])),
      },
    };
    expect(await store.claimRetryableStep({
      runId: RUN_ID,
      userId: USER_ID,
      stepId: "step-1",
      expectedRevision: persisted!.snapshotRevision + 1,
      snapshot: retryClaimSnapshot,
    })).toMatchObject({ status: "claimed", attempt: 2, snapshotRevision: persisted!.snapshotRevision + 2 });
    const inFlight = await runtime(store, executor).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(inFlight).toMatchObject({ kind: "recovery_required", stepId: "step-1", failure: { code: "indeterminate_step" } });
    expect(executor).not.toHaveBeenCalled();
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map((step) => step.status))
      .toEqual(["running", "pending", "pending"]);
    for (const actor of Object.values(stepActors)) actor.stop();
    runActor.stop();
  });

  it("does not let a step result rebind the immutable request message pair", async () => {
    const store = new InMemoryExecutionStore();
    const calls: CapabilityExecutionInput[] = [];
    let executorMutationRejected = false;
    const service = runtime(store, async (input) => {
      calls.push(input);
      executorMutationRejected = !Reflect.set(
        input.context.requestMessageBinding as unknown as { assistantMessageId: string },
        "assistantMessageId",
        "c2000000-0000-4000-8000-000000000004",
      );
      if (input.stepId === "step-1") {
        return {
          kind: "search_results",
          value: {
            requestMessageBinding: {
              ...REQUEST_BINDING,
              assistantMessageId: "c2000000-0000-4000-8000-000000000004",
            },
          },
        };
      }
      return mockResult(input);
    });
    const result = await service.execute(handoff([
      { id: "step-1", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
      { id: "step-2", capability: "standard", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "search_results" }], expectedOutput: "text" },
    ]), runtimeInput(), "immutable-message-binding");

    expect(result.kind).toBe("succeeded");
    expect(calls).toHaveLength(2);
    expect(executorMutationRejected).toBe(true);
    expect(calls.every(({ context }) => context.requestMessageBinding.assistantMessageId === REQUEST_BINDING.assistantMessageId)).toBe(true);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.runtimeContext.requestMessageBinding).toEqual(REQUEST_BINDING);
  });

  it("denies cross-user resume and does not retry ambiguous provider outcomes", async () => {
    const store = new InMemoryExecutionStore();
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      if (input.stepId === "step-2") throw new Error("private provider error");
      return mockResult(input);
    });
    const service = runtime(store, executor);
    const ambiguous = await service.execute(handoff(), runtimeInput(), "ambiguous-key");
    expect(ambiguous).toMatchObject({ kind: "recovery_required", stepId: "step-2", failure: { code: "executor_failed" } });
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map(({ status }) => status))
      .toEqual(["succeeded", "running", "pending"]);
    const callsBefore = executor.mock.calls.length;
    expect(await service.resume({ runId: RUN_ID, authenticatedUserId: OTHER_USER_ID })).toMatchObject({ kind: "rejected", failure: { code: "ownership_denied" } });
    expect(await service.resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "recovery_required", failure: { code: "indeterminate_step" } });
    expect(executor).toHaveBeenCalledTimes(callsBefore);
  });

  it("durably schedules a proven-safe retry, reclaims atomically, reauthorizes, and keeps the same bindings and execution key", async () => {
    const store = new InMemoryExecutionStore(() => new Date("2026-10-08T12:00:00.000Z"));
    const calls: CapabilityExecutionInput[] = [];
    const authorizations: string[] = [];
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      calls.push(input);
      if (input.stepId === "step-1" && calls.filter((call) => call.stepId === "step-1").length === 1) {
        throw new CapabilityAdapterError("transient_dependency_failure", { phase: "pre_provider", retrySafety: "SAFE_RETRY" });
      }
      return mockResult(input);
    });
    const now = () => new Date("2026-10-07T12:00:00.000Z");
    const plan = handoff([
      { id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" },
      { id: "step-2", capability: "document_generation", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "text" }], expectedOutput: "document" },
    ]);
    const first = await runtime(store, executor, async ({ stepId }) => {
      authorizations.push(stepId);
      return { allowed: true };
    }, async () => true, now).execute(plan, runtimeInput(), "safe-retry-key");

    expect(first).toMatchObject({ kind: "retry_pending", stepId: "step-1" });
    expect(first.kind === "retry_pending" ? Date.parse(first.nextRetryAt) - now().getTime() : null).toBe(1_000);
    expect(calls.map(({ stepId }) => stepId)).toEqual(["step-1"]);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map(({ status, attempt }) => [status, attempt]))
      .toEqual([["retry_pending", 1], ["pending", 1]]);

    // A reconstructed runtime claims the durable retry; the store remains the persistence authority.
    const resumed = await runtime(store, executor, async ({ stepId }) => {
      authorizations.push(stepId);
      return { allowed: true };
    }, async () => true, now).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });

    expect(resumed.kind).toBe("succeeded");
    expect(calls.map(({ stepId }) => stepId)).toEqual(["step-1", "step-1", "step-2"]);
    expect(calls[1]?.executionKey).toBe(calls[0]?.executionKey);
    expect(calls.every(({ context }) => context.requestMessageBinding === REQUEST_BINDING
      || JSON.stringify(context.requestMessageBinding) === JSON.stringify(REQUEST_BINDING))).toBe(true);
    expect(calls.every(({ context }) => context.requestMessageBinding.assistantMessageId === REQUEST_BINDING.assistantMessageId
      && context.requestMessageBinding.userMessageId === REQUEST_BINDING.userMessageId)).toBe(true);
    expect(authorizations).toEqual(["step-1", "step-1", "step-2"]);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map(({ status, attempt }) => [status, attempt]))
      .toEqual([["succeeded", 2], ["succeeded", 1]]);
  });

  it("fails a retry after reauthorization denial without invoking the executor again", async () => {
    const store = new InMemoryExecutionStore(() => new Date("2026-10-08T12:00:00.000Z"));
    let calls = 0;
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      calls += 1;
      if (calls === 1) throw new CapabilityAdapterError("transient_dependency_failure", { phase: "pre_provider", retrySafety: "SAFE_RETRY" });
      return mockResult(input);
    });
    const now = () => new Date("2026-10-07T12:00:00.000Z");
    const plan = handoff([{ id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }]);
    expect((await runtime(store, executor, undefined, undefined, now).execute(plan, runtimeInput(), "retry-auth-key")).kind).toBe("retry_pending");

    const denied = await runtime(store, executor, async () => ({ allowed: false }), async () => true, now)
      .resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(denied).toMatchObject({ kind: "failed", failure: { code: "authorization_denied" } });
    expect(executor).toHaveBeenCalledOnce();
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps[0]).toMatchObject({ status: "failed", attempt: 2 });
  });

  it("stops after exactly three proven-safe attempts and does not schedule a fourth", async () => {
    const store = new InMemoryExecutionStore(() => new Date("2026-10-08T12:00:00.000Z"));
    const attemptedSteps: string[] = [];
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      attemptedSteps.push(input.stepId);
      throw new CapabilityAdapterError("transient_dependency_failure", { phase: "pre_provider", retrySafety: "SAFE_RETRY" });
    });
    const now = () => new Date("2026-10-07T12:00:00.000Z");
    const plan = handoff([
      { id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" },
      { id: "step-2", capability: "document_generation", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "text" }], expectedOutput: "document" },
    ]);
    let outcome = await runtime(store, executor, undefined, undefined, now).execute(plan, runtimeInput(), "retry-ceiling-key");
    expect(outcome.kind).toBe("retry_pending");
    outcome = await runtime(store, executor, undefined, undefined, now).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(outcome.kind).toBe("retry_pending");
    outcome = await runtime(store, executor, undefined, undefined, now).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });

    expect(outcome).toMatchObject({ kind: "failed", failure: { code: "retry_exhausted" } });
    expect(executor).toHaveBeenCalledTimes(3);
    expect(attemptedSteps).toEqual(["step-1", "step-1", "step-1"]);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps.map(({ status, attempt }) => [status, attempt]))
      .toEqual([["failed", 3], ["skipped", 1]]);
  });

  it("allows only one concurrent resume to dispatch an eligible retry", async () => {
    const store = new InMemoryExecutionStore(() => new Date("2026-10-08T12:00:00.000Z"));
    let calls = 0;
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      calls += 1;
      if (calls === 1) throw new CapabilityAdapterError("transient_dependency_failure", { phase: "pre_provider", retrySafety: "SAFE_RETRY" });
      return mockResult(input);
    });
    const now = () => new Date("2026-10-07T12:00:00.000Z");
    const plan = handoff([{ id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }]);
    expect((await runtime(store, executor, undefined, undefined, now).execute(plan, runtimeInput(), "concurrent-retry-key")).kind).toBe("retry_pending");
    const concurrent = await Promise.all([
      runtime(store, executor, undefined, undefined, now).resume({ runId: RUN_ID, authenticatedUserId: USER_ID }),
      runtime(store, executor, undefined, undefined, now).resume({ runId: RUN_ID, authenticatedUserId: USER_ID }),
    ]);
    expect(concurrent.filter((item) => item.kind === "succeeded")).toHaveLength(1);
    expect(executor).toHaveBeenCalledTimes(2);
    expect((await store.getRun({ runId: RUN_ID, userId: USER_ID }))?.steps[0]).toMatchObject({ status: "succeeded", attempt: 2 });
  });
});
