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
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import { InMemoryExecutionStore } from "@/lib/agent-runtime/in-memory-execution-store";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
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
    now: (() => {
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
    expect(interrupted).toMatchObject({ kind: "rejected", failure: { code: "persistence_failed" } });
    expect(executor).not.toHaveBeenCalled();
    const recovered = await runtime(store, executor).resume({ runId: RUN_ID, authenticatedUserId: USER_ID });
    expect(recovered).toMatchObject({ kind: "recovery_required", stepId: "step-1", failure: { code: "indeterminate_step" } });
    expect(executor).not.toHaveBeenCalled();
    const uncertain = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(uncertain?.status).toBe("running");
    expect(uncertain?.runtimeContext.requestMessageBinding).toEqual(REQUEST_BINDING);
    expect(uncertain?.steps.map(({ status }) => status)).toEqual(["running", "pending", "pending"]);
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

  it("denies cross-user resume and does not restart failed terminal runs", async () => {
    const store = new InMemoryExecutionStore();
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      if (input.stepId === "step-2") throw new Error("private provider error");
      return mockResult(input);
    });
    const service = runtime(store, executor);
    const failed = await service.execute(handoff(), runtimeInput(), "failed-key");
    expect(failed.kind).toBe("failed");
    const callsBefore = executor.mock.calls.length;
    expect(await service.resume({ runId: RUN_ID, authenticatedUserId: OTHER_USER_ID })).toMatchObject({ kind: "rejected", failure: { code: "ownership_denied" } });
    expect(await service.resume({ runId: RUN_ID, authenticatedUserId: USER_ID })).toMatchObject({ kind: "failed", failure: { code: "executor_failed" } });
    expect(executor).toHaveBeenCalledTimes(callsBefore);
  });
});
