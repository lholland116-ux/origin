import { describe, expect, it, vi } from "vitest";
import type { IntelligencePlan, PlanStep } from "@/lib/ai/intelligence-plan";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import type {
  CapabilityExecutionInput,
  CapabilityExecutor,
  ExecutionAuthorizationInput,
  ExecutionAuthorizer,
  ExecutionRuntimeInput,
} from "@/lib/agent-runtime/capability-executor";
import type { ExecutionStepResult } from "@/lib/agent-runtime/runtime-contracts";
import { createLvtChatExecutionRuntime } from "@/lib/agent-runtime/execution-runtime";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";

function handoff(steps: PlanStep[]): PlannedExecutionHandoff {
  const objective = "Search guidance and create a report";
  const plan: IntelligencePlan = { objective, steps, status: "validated" };
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid) throw new Error(`Invalid test handoff: ${validation.errors.join(", ")}`);
  return {
    version: 1,
    objective,
    plan,
    orderedStepIds: validation.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 6,
      capabilityIds: [...new Set(steps.map((step) => step.capability))].sort(),
      modelPlanningAllowed: true,
      maxModelCalls: 2,
      maxRepairAttempts: 1,
      attachmentContextAllowed: true,
      handoffVersion: 1,
    },
  };
}

const sequentialPlan = () => handoff([
  { id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" },
  { id: "step-2", capability: "standard", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "text" }], expectedOutput: "text" },
  { id: "step-3", capability: "document_generation", dependsOn: ["step-2"], inputs: [{ source: "step", stepId: "step-2", output: "text" }], expectedOutput: "document" },
]);

const joinPlan = () => handoff([
  { id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" },
  { id: "step-2", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }], expectedOutput: "text" },
  { id: "step-3", capability: "standard", dependsOn: ["step-1", "step-2"], inputs: [
    { source: "step", stepId: "step-1", output: "text" },
    { source: "step", stepId: "step-2", output: "text" },
  ], expectedOutput: "text" },
  { id: "step-4", capability: "document_generation", dependsOn: ["step-3"], inputs: [{ source: "step", stepId: "step-3", output: "text" }], expectedOutput: "document" },
]);

function runtimeInput(overrides: Partial<ExecutionRuntimeInput> = {}): ExecutionRuntimeInput {
  return {
    authenticatedUserId: "a1000000-0000-4000-8000-000000000001",
    conversationId: "b1000000-0000-4000-8000-000000000001",
    requestMessageBinding: {
      requestId: "c1000000-0000-4000-8000-000000000001",
      userId: "a1000000-0000-4000-8000-000000000001",
      conversationId: "b1000000-0000-4000-8000-000000000001",
      userMessageId: "c1000000-0000-4000-8000-000000000002",
      assistantMessageId: "c1000000-0000-4000-8000-000000000003",
    },
    userInput: "find current guidance",
    ...overrides,
  };
}

function createRuntime(
  executor: CapabilityExecutor["execute"],
  authorize: ExecutionAuthorizer["authorize"] = async () => ({ allowed: true as const }),
  validateBinding: (input: ExecutionRuntimeInput["requestMessageBinding"]) => Promise<boolean> = async () => true,
) {
  return createLvtChatExecutionRuntime({
    executor: { execute: executor as CapabilityExecutor["execute"] },
    authorizer: { authorize },
    requestMessageBindingValidator: { validate: validateBinding },
    createExecutionId: () => "execution-test-1",
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 9, 6, 12, 0, tick++));
    })(),
  });
}

function mockResult(input: CapabilityExecutionInput): ExecutionStepResult {
  const kind: ExecutionStepResult["kind"] = {
    web_search: "search_results",
    file_analysis: "text",
    standard: "text",
    document_generation: "document",
    image_generation: "image",
    image_editing: "image",
  }[input.capabilityId] as ExecutionStepResult["kind"];
  return { kind, value: { from: input.stepId, prior: input.inputs.map((item) => item.source === "step" ? item.result.value ?? null : item.source) } };
}

describe("LVTChat XState execution adapter", () => {
  it("executes a sequential three-step handoff once per step and passes outputs downstream", async () => {
    const order: string[] = [];
    const calls: CapabilityExecutionInput[] = [];
    const mutationAttempts: boolean[] = [];
    const authorizer = vi.fn(async ({ stepId }: ExecutionAuthorizationInput) => {
      order.push(`authorize:${stepId}`);
      return { allowed: true as const };
    });
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      order.push(`execute:${input.stepId}`);
      calls.push(input);
      mutationAttempts.push(!Reflect.set(
        input.context.requestMessageBinding as unknown as { assistantMessageId: string },
        "assistantMessageId",
        "c1000000-0000-4000-8000-000000000004",
      ));
      return mockResult(input);
    });
    const result = await createRuntime(executor, authorizer).execute(sequentialPlan(), runtimeInput());

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(order).toEqual([
      "authorize:step-1", "execute:step-1",
      "authorize:step-2", "execute:step-2",
      "authorize:step-3", "execute:step-3",
    ]);
    expect(calls.map(({ capabilityId }) => capabilityId)).toEqual(["standard", "standard", "document_generation"]);
    expect(calls[1]?.inputs).toEqual([{ source: "step", stepId: "step-1", result: result.stepResults["step-1"] }]);
    expect(calls[2]?.inputs[0]).toMatchObject({ source: "step", stepId: "step-2", result: result.stepResults["step-2"] });
    expect(executor).toHaveBeenCalledTimes(3);
    expect(mutationAttempts).toEqual([true, true, true]);
    expect(authorizer).toHaveBeenCalledTimes(3);
    expect(calls[0]).toMatchObject({ executionId: "execution-test-1", stepId: "step-1", capabilityId: "standard" });
    expect(calls[0]?.context).toMatchObject({
      authenticatedUserId: "a1000000-0000-4000-8000-000000000001",
      conversationId: "b1000000-0000-4000-8000-000000000001",
      requestMessageBinding: {
        requestId: "c1000000-0000-4000-8000-000000000001",
        userMessageId: "c1000000-0000-4000-8000-000000000002",
        assistantMessageId: "c1000000-0000-4000-8000-000000000003",
      },
    });
    expect(authorizer.mock.calls.every(([input]) => input.requestMessageBinding.userMessageId === "c1000000-0000-4000-8000-000000000002"
      && input.requestMessageBinding.assistantMessageId === "c1000000-0000-4000-8000-000000000003")).toBe(true);
    expect(result.run).toMatchObject({ status: "succeeded", handoffVersion: 1, orderedStepIds: ["step-1", "step-2", "step-3"] });
    expect(result.run.steps.map(({ status }) => status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(result.telemetry).toMatchObject({ execution_id: "execution-test-1", status: "succeeded", step_count: 3, completed_step_count: 3, failure_code: null });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("waits for both DAG prerequisites before the join and forwards each result", async () => {
    const calls: CapabilityExecutionInput[] = [];
    const result = await createRuntime(async (input) => {
      calls.push(input);
      return mockResult(input);
    }).execute(joinPlan(), runtimeInput({
      attachments: [{ id: "attachment-1", kind: "file" }],
      resourceReferences: ["case-1"],
    }));

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    const join = calls.find(({ stepId }) => stepId === "step-3");
    expect(join?.inputs).toHaveLength(2);
    expect(join?.inputs).toEqual([
      { source: "step", stepId: "step-1", result: result.stepResults["step-1"] },
      { source: "step", stepId: "step-2", result: result.stepResults["step-2"] },
    ]);
    expect(calls.map(({ stepId }) => stepId)).toEqual(["step-1", "step-2", "step-3", "step-4"]);
    expect(calls[1]?.inputs).toEqual([{ source: "attachment", reference: { id: "attachment-1", kind: "file" } }]);
    expect(calls[1]?.context.resourceReferences).toContain("attachment-1");
    expect(calls[1]?.context.resourceReferences).toContain("case-1");
    expect(result.run.steps.every(({ status }) => status === "succeeded")).toBe(true);
  });

  it("strips attachment input to metadata only before authorization and execution", async () => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const injected = { id: "attachment-1", kind: "file", name: "private-name.pdf", bytes: "private-bytes", contents: "private text" };
    const result = await createRuntime(executor).execute(joinPlan(), runtimeInput({
      attachments: [injected as unknown as NonNullable<ExecutionRuntimeInput["attachments"]>[number]],
    }));
    expect(result.kind).toBe("succeeded");
    const fileCall = executor.mock.calls.map(([input]) => input).find(({ capabilityId }) => capabilityId === "file_analysis");
    expect(fileCall?.inputs).toEqual([{ source: "attachment", reference: { id: "attachment-1", kind: "file" } }]);
    expect(JSON.stringify(fileCall)).not.toContain("private");
  });

  it("denies execution before the executor and skips downstream steps", async () => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const authorizer = vi.fn(async ({ stepId }: { stepId: string }) => ({ allowed: stepId !== "step-2" }));
    const result = await createRuntime(executor, authorizer).execute(sequentialPlan(), runtimeInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure).toEqual({ code: "authorization_denied", message: "This action is not authorized." });
    expect(executor.mock.calls.map(([input]) => input.stepId)).toEqual(["step-1"]);
    expect(authorizer.mock.calls.map(([input]) => input.stepId)).toEqual(["step-1", "step-2"]);
    expect(result.run.steps.map(({ status }) => status)).toEqual(["succeeded", "failed", "skipped"]);
    expect(result.run.steps[2]?.errorCode).toBe("dependency_failed");
    expect(result.telemetry.failure_code).toBe("authorization_denied");
  });

  it("maps executor failures safely, does not retry, and skips dependent steps", async () => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => {
      if (input.stepId === "step-2") throw new Error("provider secret raw failure");
      return mockResult(input);
    });
    const result = await createRuntime(executor).execute(sequentialPlan(), runtimeInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure).toEqual({ code: "executor_failed", message: "The requested step could not be completed." });
    expect(JSON.stringify(result)).not.toContain("provider secret");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.run.steps.map(({ attempt, status }) => [status, attempt])).toEqual([
      ["succeeded", 1], ["failed", 1], ["skipped", 1],
    ]);
  });

  it("fails safely if a declared predecessor result is missing or has the wrong kind", async () => {
    const plan = handoff([
      { id: "step-1", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }] },
      { id: "step-2", capability: "standard", dependsOn: ["step-1"], inputs: [{ source: "step", stepId: "step-1", output: "structured_data" }] },
    ]);
    const executor = vi.fn(async (): Promise<ExecutionStepResult> => ({ kind: "text", value: "analysis" }));
    const result = await createRuntime(executor).execute(plan, runtimeInput({ attachments: [{ id: "file-1", kind: "file" }] }));

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failure.code).toBe("missing_predecessor_result");
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.run.steps.map(({ status }) => status)).toEqual(["succeeded", "failed"]);
  });

  it("rejects incompatible handoff versions and unsupported capability IDs without executing", async () => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const runtime = createRuntime(executor);
    const valid = sequentialPlan();
    const wrongVersion = await runtime.execute({ ...valid, version: 2 }, runtimeInput());
    const unknownCapability = {
      ...valid,
      plan: { ...valid.plan, steps: [{ ...valid.plan.steps[0]!, capability: "arbitrary_tool" }, ...valid.plan.steps.slice(1)] },
      governance: { ...valid.governance, capabilityIds: [...valid.governance.capabilityIds, "arbitrary_tool"] },
    };
    const unsupported = await runtime.execute(unknownCapability, runtimeInput());

    expect(wrongVersion).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });
    expect(unsupported).toMatchObject({ kind: "rejected", failure: { code: "unsupported_capability" } });
    expect(executor).not.toHaveBeenCalled();
  });

  it.each(["web_search", "image_editing", "image_generation"] as const)("blocks autonomous %s handoffs before execution", async (capability) => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const expectedOutput = capability === "web_search" ? "search_results" : "image";
    const denied = await createRuntime(executor).execute(handoff([
      { id: "blocked", capability, dependsOn: [], inputs: capability === "image_editing"
        ? [{ source: "attachment", output: "image" }]
        : [{ source: "user" }], expectedOutput,
      },
    ]), runtimeInput());
    expect(denied).toMatchObject({ kind: "rejected", failure: { code: "unsupported_capability" } });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a missing conversation or message binding before authorization or capability execution", async () => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const authorizer = vi.fn(async () => ({ allowed: true as const }));
    const runtime = createRuntime(executor, authorizer);
    const result = await runtime.execute(
      sequentialPlan(),
      { authenticatedUserId: "a1000000-0000-4000-8000-000000000001", userInput: "find guidance" } as ExecutionRuntimeInput,
    );
    const missingMessages = await runtime.execute(sequentialPlan(), {
      authenticatedUserId: "a1000000-0000-4000-8000-000000000001",
      conversationId: "b1000000-0000-4000-8000-000000000001",
      userInput: "find guidance",
    } as ExecutionRuntimeInput);
    const wrongOwner = await runtime.execute(sequentialPlan(), runtimeInput({
      requestMessageBinding: {
        ...runtimeInput().requestMessageBinding,
        userId: "a1000000-0000-4000-8000-000000000002",
      },
    }));

    expect(result).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });
    expect(missingMessages).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });
    expect(wrongOwner).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });
    expect(authorizer).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("requires the injected authorizer even when the handoff is valid", async () => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const result = await createRuntime(executor, async () => ({ allowed: false, reasonCode: "BILLING_DENIED" }))
      .execute(sequentialPlan(), runtimeInput());
    expect(result.kind).toBe("failed");
    expect(executor).not.toHaveBeenCalled();
  });

  it("validates persisted message ownership before accepting an in-memory execution", async () => {
    const executor = vi.fn(async (input: CapabilityExecutionInput) => mockResult(input));
    const authorizer = vi.fn(async () => ({ allowed: true as const }));
    const result = await createRuntime(executor, authorizer, async () => false).execute(sequentialPlan(), runtimeInput());
    expect(result).toMatchObject({ kind: "rejected", failure: { code: "ownership_denied" } });
    expect(authorizer).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("models valid lifecycle transitions and ignores invalid transitions", () => {
    const run = createExecutionRunLifecycle();
    run.succeed();
    expect(run.status).toBe("pending");
    run.start();
    run.start();
    expect(run.status).toBe("running");
    run.succeed();
    run.fail();
    expect(run.status).toBe("succeeded");
    run.stop();

    const step = createExecutionStepLifecycle();
    step.succeed();
    expect(step.status).toBe("pending");
    step.start();
    step.skip();
    expect(step.status).toBe("running");
    step.fail();
    step.succeed();
    expect(step.status).toBe("failed");
    step.stop();

    const skipped = createExecutionStepLifecycle();
    skipped.skip();
    skipped.start();
    expect(skipped.status).toBe("skipped");
    skipped.stop();
  });

  it("produces JSON-safe persisted lifecycle snapshots without runtime collaborators or credentials", () => {
    const run = createExecutionRunLifecycle();
    run.start();
    const snapshot = run.getPersistedSnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(JSON.parse(serialized)).toEqual(snapshot);
    expect(snapshot).toMatchObject({ value: "running", context: {} });
    expect(serialized).not.toMatch(/executor|authorizer|client|credential|secret/i);
    run.stop();
  });
});
