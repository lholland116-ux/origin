import { describe, expect, it, vi } from "vitest";
import { CAPABILITY_REGISTRY, type CapabilityId, type CapabilityOutputKind } from "@/lib/ai/capability-registry";
import type { IntelligencePlan } from "@/lib/ai/intelligence-plan";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type {
  CapabilityExecutionInput,
  CapabilityExecutor,
  ExecutionAuthorizer,
  ExecutionRuntimeInput,
} from "@/lib/agent-runtime/capability-executor";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { InMemoryExecutionStore } from "@/lib/agent-runtime/in-memory-execution-store";
import {
  createExecutionRegistry,
  EXECUTION_CAPABILITY_IDS,
  type ExecutionRegistryExecutors,
} from "@/lib/agent-runtime/execution-registry";
import { createRegistryCapabilityExecutor } from "@/lib/agent-runtime/registry-capability-executor";

const USER_ID = "c3000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "c3000000-0000-4000-8000-000000000002";
const BINDING: RequestMessageBinding = Object.freeze({
  requestId: "c3000000-0000-4000-8000-000000000003",
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  userMessageId: "c3000000-0000-4000-8000-000000000004",
  assistantMessageId: "c3000000-0000-4000-8000-000000000005",
});

const capabilityOutputKinds: Readonly<Record<CapabilityId, CapabilityOutputKind>> = Object.freeze({
  standard: "text",
  web_search: "search_results",
  file_analysis: "structured_data",
  document_generation: "document",
  image_generation: "image",
  image_editing: "image",
});

function fakeExecutor(capabilityId: CapabilityId) {
  const result = { kind: capabilityOutputKinds[capabilityId], value: { selected: capabilityId } } as const;
  const execute = vi.fn(async (input: CapabilityExecutionInput) => {
    void input;
    return result;
  });
  return { executor: { execute } as CapabilityExecutor, execute, result };
}

function fakeExecutors(): {
  readonly dependencies: ExecutionRegistryExecutors;
  readonly calls: Readonly<Record<CapabilityId, ReturnType<typeof fakeExecutor>>>;
} {
  const calls = {
    standard: fakeExecutor("standard"),
    web_search: fakeExecutor("web_search"),
    file_analysis: fakeExecutor("file_analysis"),
    document_generation: fakeExecutor("document_generation"),
    image_generation: fakeExecutor("image_generation"),
    image_editing: fakeExecutor("image_editing"),
  };
  return {
    dependencies: {
      standardExecutor: calls.standard.executor,
      webSearchExecutor: calls.web_search.executor,
      fileAnalysisExecutor: calls.file_analysis.executor,
      documentGenerationExecutor: calls.document_generation.executor,
      imageGenerationExecutor: calls.image_generation.executor,
      imageEditingExecutor: calls.image_editing.executor,
    },
    calls,
  };
}

function executionInput(capabilityId: CapabilityId): CapabilityExecutionInput {
  return {
    executionId: "c3000000-0000-4000-8000-000000000006",
    stepId: "registry-step",
    executionKey: "c3000000-0000-4000-8000-000000000007",
    capabilityId,
    inputs: [{ source: "user", value: "Execute the authorized step." }],
    context: {
      authenticatedUserId: USER_ID,
      conversationId: CONVERSATION_ID,
      requestMessageBinding: BINDING,
      resourceReferences: [],
      requestId: BINDING.requestId,
    },
  };
}

function handoff(capability: CapabilityId = "standard"): PlannedExecutionHandoff {
  const plan: IntelligencePlan = {
    objective: "Run one registry test step.",
    steps: [{ id: "only", capability, dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }],
    status: "validated" as const,
  };
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid) throw new Error(`Invalid registry test handoff: ${validation.errors.join(", ")}`);
  return {
    version: 1,
    objective: plan.objective,
    plan,
    orderedStepIds: validation.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 1,
      capabilityIds: [capability as CapabilityId],
      modelPlanningAllowed: false,
      maxModelCalls: 0,
      maxRepairAttempts: 0,
      attachmentContextAllowed: true,
      handoffVersion: 1,
    },
  };
}

function runtimeInput(overrides: Partial<ExecutionRuntimeInput> = {}): ExecutionRuntimeInput {
  return {
    authenticatedUserId: USER_ID,
    conversationId: CONVERSATION_ID,
    requestMessageBinding: BINDING,
    userInput: "Execute the authorized step.",
    ...overrides,
  };
}

function runtime(
  store: InMemoryExecutionStore,
  executor: CapabilityExecutor,
  authorize: ExecutionAuthorizer["authorize"] = async () => ({ allowed: true }),
) {
  return new DurableXStateExecutionRuntime({
    store,
    executor,
    authorizer: { authorize },
    requestMessageBindingValidator: { validate: async () => true },
    createExecutionId: () => "c3000000-0000-4000-8000-000000000008",
    createExecutionKey: () => "c3000000-0000-4000-8000-000000000009",
    now: () => new Date("2026-10-07T12:00:00.000Z"),
  });
}

describe("static execution registry", () => {
  it("contains exactly the six planning capabilities and maps each injected executor unchanged", () => {
    const { dependencies, calls } = fakeExecutors();
    const registry = createExecutionRegistry(dependencies);
    const plannedIds = CAPABILITY_REGISTRY.all().map(({ id }) => id).sort();
    const executionIds = [...registry.all()].sort();

    expect(EXECUTION_CAPABILITY_IDS).toHaveLength(6);
    expect(new Set(EXECUTION_CAPABILITY_IDS).size).toBe(6);
    expect(executionIds).toEqual(plannedIds);
    for (const capabilityId of EXECUTION_CAPABILITY_IDS) {
      expect(registry.has(capabilityId)).toBe(true);
      expect(registry.get(capabilityId)).toBe(calls[capabilityId].executor);
    }
    expect(registry.all()).toBe(EXECUTION_CAPABILITY_IDS);
  });

  it("is immutable and rejects missing, malformed, or extra executor dependencies", () => {
    const { dependencies } = fakeExecutors();
    const registry = createExecutionRegistry(dependencies);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.all())).toBe(true);
    expect(() => Object.assign(registry, { get: () => dependencies.standardExecutor })).toThrow(TypeError);
    expect(() => (registry.all() as CapabilityId[]).push("standard")).toThrow(TypeError);
    expect(() => createExecutionRegistry({ ...dependencies, imageEditingExecutor: undefined } as never)).toThrow(TypeError);
    expect(() => createExecutionRegistry({ ...dependencies, standardExecutor: {} } as never)).toThrow(TypeError);
    expect(() => createExecutionRegistry({ ...dependencies, webSearchExecutor: dependencies.standardExecutor })).toThrow(TypeError);
    expect(registry.get("standard")).toBe(dependencies.standardExecutor);

    const extraDependencies = { ...dependencies, extraExecutor: dependencies.standardExecutor };
    const compileTimeExtraKeyRejection = () => {
      // @ts-expect-error The factory type rejects unknown executor dependency keys.
      createExecutionRegistry(extraDependencies);
    };
    expect(compileTimeExtraKeyRejection).toBeTypeOf("function");
  });

  it.each([
    "unknown",
    "__proto__",
    "constructor",
    "../standard",
    "./image-generation",
    "https://example.com/x",
    "file:///tmp/x",
    "standard.ts",
  ])("fails closed for capability string %s", async (untrustedCapability) => {
    const { dependencies, calls } = fakeExecutors();
    const registry = createExecutionRegistry(dependencies);
    expect(registry.get(untrustedCapability)).toBeUndefined();
    expect(registry.has(untrustedCapability)).toBe(false);
    const dispatcher = createRegistryCapabilityExecutor(registry);
    await expect(dispatcher.execute({
      ...executionInput("standard"), capabilityId: untrustedCapability as CapabilityId,
    })).rejects.toMatchObject({ code: "unsupported_capability" });
    for (const call of Object.values(calls)) expect(call.execute).not.toHaveBeenCalled();
  });

  it.each(EXECUTION_CAPABILITY_IDS)("dispatches %s to its executor only, unchanged", async (capabilityId) => {
    const { dependencies, calls } = fakeExecutors();
    const registry = createExecutionRegistry(dependencies);
    const dispatcher = createRegistryCapabilityExecutor(registry);
    const input = executionInput(capabilityId);
    const output = await dispatcher.execute(input);

    expect(output).toBe(calls[capabilityId].result);
    expect(calls[capabilityId].execute).toHaveBeenCalledTimes(1);
    expect(calls[capabilityId].execute).toHaveBeenCalledWith(input);
    for (const other of EXECUTION_CAPABILITY_IDS.filter((item) => item !== capabilityId)) {
      expect(calls[other].execute).not.toHaveBeenCalled();
    }
  });

  it("preserves object and request-binding identity at the adapter boundary", async () => {
    const { dependencies, calls } = fakeExecutors();
    const registry = createExecutionRegistry(dependencies);
    const dispatcher = createRegistryCapabilityExecutor(registry);
    const input = executionInput("standard");
    await dispatcher.execute(input);
    expect(calls.standard.execute.mock.calls[0]![0]).toBe(input);
    expect(calls.standard.execute.mock.calls[0]![0].context.requestMessageBinding).toBe(BINDING);
  });

  it("keeps authorization ahead of registry dispatch and fails malformed bindings before dispatch", async () => {
    const { dependencies, calls } = fakeExecutors();
    const dispatcher = createRegistryCapabilityExecutor(createExecutionRegistry(dependencies));
    const events: string[] = [];
    const authorizedRuntime = runtime(new InMemoryExecutionStore(), {
      execute: async (input) => {
        events.push("dispatch");
        return dispatcher.execute(input);
      },
    }, async () => {
      events.push("authorize");
      return { allowed: false };
    });

    const denied = await authorizedRuntime.execute(handoff(), runtimeInput(), "registry-auth-denied");
    expect(denied).toMatchObject({ kind: "failed", failure: { code: "authorization_denied" } });
    expect(events).toEqual(["authorize"]);
    for (const call of Object.values(calls)) expect(call.execute).not.toHaveBeenCalled();

    const invalidBinding = { ...BINDING, userId: "c3000000-0000-4000-8000-000000000010" };
    const malformed = await runtime(new InMemoryExecutionStore(), dispatcher).execute(
      handoff(), runtimeInput({ requestMessageBinding: invalidBinding }), "registry-invalid-binding",
    );
    expect(malformed).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });
    const invalidConversationBinding = { ...BINDING, conversationId: "c3000000-0000-4000-8000-000000000011" };
    const wrongConversation = await runtime(new InMemoryExecutionStore(), dispatcher).execute(
      handoff(), runtimeInput({ requestMessageBinding: invalidConversationBinding }), "registry-invalid-conversation-binding",
    );
    expect(wrongConversation).toMatchObject({ kind: "rejected", failure: { code: "invalid_handoff" } });
    for (const call of Object.values(calls)) expect(call.execute).not.toHaveBeenCalled();
  });

  it("rejects an unknown plan capability before any executor or authorizer runs", async () => {
    const { dependencies, calls } = fakeExecutors();
    const authorize = vi.fn(async () => ({ allowed: true as const }));
    const valid = handoff();
    const unknownPlan = {
      ...valid,
      plan: { ...valid.plan, steps: valid.plan.steps.map((step) => ({ ...step, capability: "unknown" })) },
      governance: { ...valid.governance, capabilityIds: ["unknown"] },
    };
    const outcome = await runtime(new InMemoryExecutionStore(), createRegistryCapabilityExecutor(
      createExecutionRegistry(dependencies),
    ), authorize).execute(unknownPlan as never, runtimeInput(), "registry-unknown-plan");
    expect(outcome.kind).toBe("rejected");
    expect(authorize).not.toHaveBeenCalled();
    for (const call of Object.values(calls)) expect(call.execute).not.toHaveBeenCalled();
  });

  it.each(["web", "prior-run-step"])(
    "does not expose undeclared or cross-run predecessor %s to registry adapters",
    async (referencedStepId) => {
      const { dependencies, calls } = fakeExecutors();
      const authorize = vi.fn(async () => ({ allowed: true as const }));
      const invalid = {
        ...handoff(),
        plan: {
          objective: "Attempt an undeclared predecessor handoff.",
          status: "validated",
          steps: [
            { id: "web", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
            { id: "answer", capability: "standard", dependsOn: [], inputs: [
              { source: "user" }, { source: "step", stepId: referencedStepId, output: "search_results" },
            ], expectedOutput: "text" },
          ],
        },
        orderedStepIds: ["web", "answer"],
        governance: { ...handoff().governance, capabilityIds: ["web_search", "standard"] },
      };
      const outcome = await runtime(new InMemoryExecutionStore(), createRegistryCapabilityExecutor(
        createExecutionRegistry(dependencies),
      ), authorize).execute(invalid as never, runtimeInput(), `registry-predecessor-${referencedStepId}`);

      expect(outcome.kind).toBe("rejected");
      expect(authorize).not.toHaveBeenCalled();
      for (const call of Object.values(calls)) expect(call.execute).not.toHaveBeenCalled();
    },
  );
});
