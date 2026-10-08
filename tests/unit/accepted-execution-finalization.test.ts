import { describe, expect, it, vi } from "vitest";
import {
  createAcceptedExecutionFinalizer,
  type AcceptedExecutionFinalizerDependencies,
} from "@/lib/agent-runtime/accepted-execution-finalization";
import type { DurableExecutionRun } from "@/lib/agent-runtime/execution-store";

const binding = {
  requestId: "a5000000-0000-4000-8000-000000000001",
  userId: "a5000000-0000-4000-8000-000000000002",
  conversationId: "b5000000-0000-4000-8000-000000000001",
  userMessageId: "c5000000-0000-4000-8000-000000000001",
  assistantMessageId: "c5000000-0000-4000-8000-000000000002",
};
const runId = "d5000000-0000-4000-8000-000000000001";

function completedRun(overrides: Partial<DurableExecutionRun> = {}): DurableExecutionRun {
  return {
    id: runId,
    userId: binding.userId,
    runtimeVersion: 1,
    handoffVersion: 1,
    acceptedRequestId: binding.requestId,
    acceptanceFingerprint: "a".repeat(64),
    idempotencyKey: "accepted-request-key",
    requestFingerprint: "b".repeat(64),
    executionPlan: {
      version: 1,
      steps: [{ id: "answer", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }],
      orderedStepIds: ["answer"],
      plannerSource: "deterministic",
      governance: { maxSteps: 1, capabilityIds: ["standard"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
    },
    runtimeContext: { conversationId: binding.conversationId, requestMessageBinding: binding, attachments: [], resourceReferences: [] },
    status: "succeeded",
    controlState: "active",
    controlRevision: 0,
    snapshotSchemaVersion: 1,
    snapshotRevision: 3,
    snapshot: { version: 1, runtimeVersion: 1, snapshot: { run: {}, steps: {} } },
    createdAt: "2026-10-08T12:00:00.000Z",
    completedAt: "2026-10-08T12:00:03.000Z",
    steps: [{
      runId,
      userId: binding.userId,
      stepId: "answer",
      capabilityId: "standard",
      dependencyIds: [],
      attempt: 1,
      executionKey: "e5000000-0000-4000-8000-000000000001",
      status: "succeeded",
      result: { kind: "text", value: {
        kind: "standard_operation",
        requestId: binding.requestId,
        userId: binding.userId,
        conversationId: binding.conversationId,
        reply: "The persisted final answer.",
        model: "test-model",
        reasoningEffort: "medium",
        measurements: [],
      } },
    }],
    approvalCheckpoints: [],
    ...overrides,
  } as DurableExecutionRun;
}

function dependencies(run: DurableExecutionRun | null = completedRun(), overrides: Partial<AcceptedExecutionFinalizerDependencies> = {}) {
  return {
    loadAcceptedRun: vi.fn(async () => run),
    finalizeAtomically: vi.fn(async ({ runId: selectedRunId, finalText }) => ({
      status: "finalized",
      runId: selectedRunId,
      assistantMessageId: binding.assistantMessageId,
      completionSha256: "c".repeat(64),
      finalizedAt: "2026-10-08T12:00:04.000Z",
      textSeenByDatabase: finalText,
    })),
    listPendingRunIds: vi.fn(async () => [runId]),
    ...overrides,
  } satisfies AcceptedExecutionFinalizerDependencies;
}

describe("accepted execution finalization", () => {
  it("finalizes a completed accepted run into its persisted assistant destination", async () => {
    const deps = dependencies();
    const result = await createAcceptedExecutionFinalizer(deps).finalize(runId);
    expect(result).toEqual({ status: "finalized", assistantMessageId: binding.assistantMessageId });
    expect(deps.loadAcceptedRun).toHaveBeenCalledWith(runId);
    expect(deps.finalizeAtomically).toHaveBeenCalledWith({ runId, finalText: "The persisted final answer." });
  });

  it("normalizes accepted run IDs before lookup and RPC calls", async () => {
    const deps = dependencies();
    const result = await createAcceptedExecutionFinalizer(deps).finalize(runId.toUpperCase());
    expect(result.status).toBe("finalized");
    expect(deps.loadAcceptedRun).toHaveBeenCalledWith(runId);
    expect(deps.finalizeAtomically).toHaveBeenCalledWith({ runId, finalText: "The persisted final answer." });
  });

  it("returns the same database identity on lost-ack replay without requiring owner input", async () => {
    const deps = dependencies(undefined, {
      finalizeAtomically: vi.fn(async ({ runId: selectedRunId }) => ({
        status: "replayed", runId: selectedRunId, assistantMessageId: binding.assistantMessageId,
        completionSha256: "c".repeat(64), finalizedAt: "2026-10-08T12:00:04.000Z",
      })),
    });
    const result = await createAcceptedExecutionFinalizer(deps).finalize(runId);
    expect(result).toEqual({ status: "replayed", assistantMessageId: binding.assistantMessageId });
    expect(deps.loadAcceptedRun).toHaveBeenCalledWith(runId);
  });

  it.each([
    ["run is not complete", { status: "running" as const }],
    ["human control is pending", { controlState: "paused" as const }],
    ["stop is pending", { controlState: "stop_requested" as const }],
    ["run was stopped", { controlState: "stopped" as const }],
    ["approval was returned", { controlState: "returned" as const }],
    ["approval is pending", { approvalCheckpoints: [{ id: "checkpoint", runId, userId: binding.userId, stepId: "answer", planFingerprint: "b".repeat(64), stepFingerprint: "c".repeat(64), status: "pending" as const, source: "runtime_policy" as const, createdAt: "2026-10-08T12:00:00.000Z" }] },],
    ["step is unresolved", { steps: [{ ...completedRun().steps[0]!, status: "running" as const, result: undefined }] }],
    ["persisted step differs from its plan", { executionPlan: {
      ...completedRun().executionPlan,
      steps: [{ ...completedRun().executionPlan.steps[0]!, dependsOn: ["unexpected-predecessor"] }],
    } }],
    ["acceptance identity is missing", { acceptedRequestId: undefined, acceptanceFingerprint: undefined }],
  ])("does not finalize when %s", async (_label, overrides) => {
    const deps = dependencies(completedRun(overrides));
    expect(await createAcceptedExecutionFinalizer(deps).finalize(runId)).toEqual({ status: "not_ready" });
    expect(deps.finalizeAtomically).not.toHaveBeenCalled();
  });

  it("rejects a conflicting durable RPC receipt and hides database details", async () => {
    const deps = dependencies(undefined, {
      finalizeAtomically: vi.fn(async () => { throw new Error("private SQL detail"); }),
    });
    const finalizer = createAcceptedExecutionFinalizer(deps);
    expect(await finalizer.finalize(runId)).toEqual({ status: "unavailable" });
    expect(await finalizer.finalize("not-a-uuid")).toEqual({ status: "not_found" });
  });

  it("preserves persisted search reply and does not fabricate citation identifiers", async () => {
    const searchRun = completedRun({
      executionPlan: {
        ...completedRun().executionPlan,
        steps: [{ id: "search", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" }],
        orderedStepIds: ["search"],
        governance: { ...completedRun().executionPlan.governance, capabilityIds: ["web_search"] },
      },
      steps: [{
        ...completedRun().steps[0]!,
        stepId: "search",
        capabilityId: "web_search",
        result: { kind: "search_results", value: {
          kind: "web_search_operation", requestId: binding.requestId, userId: binding.userId,
          conversationId: binding.conversationId, reply: "Answer with provider citation [1].",
          sources: [{ title: "Source", url: "https://example.test" }], sourceCount: 1,
          widget: null, web: true, webSearchCalls: 1, model: "test-model", reasoningEffort: "medium",
          outcome: "success", latencyMs: 1, usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 1, reasoningTokens: null, totalTokens: 2 },
        } },
      }],
    });
    const deps = dependencies(searchRun);
    await createAcceptedExecutionFinalizer(deps).finalize(runId);
    expect(deps.finalizeAtomically).toHaveBeenCalledWith({ runId, finalText: "Answer with provider citation [1]." });
  });

  it("keeps artifact references attached without serializing internal result envelopes", async () => {
    const imageRun = completedRun({
      executionPlan: {
        ...completedRun().executionPlan,
        steps: [{ id: "image", capability: "image_generation", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "image" }],
        orderedStepIds: ["image"],
        governance: { ...completedRun().executionPlan.governance, capabilityIds: ["image_generation"] },
      },
      steps: [{
        ...completedRun().steps[0]!, stepId: "image", capabilityId: "image_generation",
        result: { kind: "image", value: {
          kind: "generated_image", imageId: "f5000000-0000-4000-8000-000000000001",
          conversationId: binding.conversationId, userMessageId: binding.userMessageId,
          assistantMessageId: binding.assistantMessageId, mimeType: "image/png", provider: "test", model: "test",
        } },
      }],
    });
    const deps = dependencies(imageRun);
    await createAcceptedExecutionFinalizer(deps).finalize(runId);
    expect(deps.finalizeAtomically).toHaveBeenCalledWith({ runId, finalText: "Your requested image is ready." });
  });

  it("discovers only valid bounded run IDs for later recovery, without dispatch", async () => {
    const deps = dependencies(undefined, {
      listPendingRunIds: vi.fn(async () => [runId, "bad-id", "d5000000-0000-4000-8000-000000000002"]),
    });
    const finalizer = createAcceptedExecutionFinalizer(deps);
    expect(await finalizer.listPendingRunIds(2)).toEqual([runId, "d5000000-0000-4000-8000-000000000002"]);
    expect(await finalizer.listPendingRunIds(1001)).toEqual([]);
    expect(deps.finalizeAtomically).not.toHaveBeenCalled();
  });
});
