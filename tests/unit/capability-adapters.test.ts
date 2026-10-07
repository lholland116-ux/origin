import { describe, expect, it, vi } from "vitest";
import type { PlanStep } from "@/lib/ai/intelligence-plan";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import type { CapabilityExecutionInput, CapabilityExecutor, ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import type { RequestMessageBinding, StandardOperationResult, WebSearchOperationResult, FileContextResult, GeneratedDocumentReference, GeneratedImageReference } from "@/lib/agent-runtime/application-contracts";
import { FileContextPreparationError } from "@/lib/ai/file-context-service";
import type { FileContextServiceInput } from "@/lib/ai/file-context-service";
import { ImageGenerationServiceError } from "@/lib/ai/image-generation-service";
import { GeneratedDocumentPersistenceError } from "@/lib/ai/generated-document-persistence-service";
import { ImageEditOrchestrationError } from "@/lib/image-generation/image-edit-orchestrator";
import type { ImageEditExistingMessageOrchestratorInput } from "@/lib/image-generation/image-edit-orchestrator";
import type { StandardOperationInput } from "@/lib/ai/standard-operation-service";
import type { GeneratedArtifact } from "@/lib/documents/generation/contracts";
import type { DocumentRenderer, ExistingMessageDocumentPersister } from "@/lib/agent-runtime/capability-adapters/document-generation";
import type { ExistingMessageImageGenerator } from "@/lib/agent-runtime/capability-adapters/image-generation";
import type { ExistingMessageImageEditor, ExistingMessageImageEditDependenciesFactory } from "@/lib/agent-runtime/capability-adapters/image-editing";
import { CapabilityAdapterError } from "@/lib/agent-runtime/capability-adapters/common";
import { createStandardCapabilityAdapter, type StandardOperationRunner } from "@/lib/agent-runtime/capability-adapters/standard";
import { createWebSearchCapabilityAdapter, type WebSearchOperationRunner } from "@/lib/agent-runtime/capability-adapters/web-search";
import { createFileAnalysisCapabilityAdapter, type FileContextPreparer } from "@/lib/agent-runtime/capability-adapters/file-analysis";
import { createDocumentGenerationCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/document-generation";
import { createImageGenerationCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/image-generation";
import { createImageEditingCapabilityAdapter, type ImageEditingCapabilityResult } from "@/lib/agent-runtime/capability-adapters/image-editing";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { InMemoryExecutionStore } from "@/lib/agent-runtime/in-memory-execution-store";
import type { ExecutionStepResult } from "@/lib/agent-runtime/runtime-contracts";

vi.mock("@/lib/openai", () => ({ openai: { responses: { stream: vi.fn(), create: vi.fn() } } }));

const USER_ID = "a3100000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "a3100000-0000-4000-8000-000000000002";
const REQUEST_BINDING: RequestMessageBinding = {
  requestId: "a3100000-0000-4000-8000-000000000003",
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  userMessageId: "a3100000-0000-4000-8000-000000000004",
  assistantMessageId: "a3100000-0000-4000-8000-000000000005",
};
const OTHER_USER_ID = "a3100000-0000-4000-8000-000000000006";
const RUNTIME_REQUEST_ID = "a3100000-0000-4000-8000-000000000031";

function executionInput(
  capabilityId: CapabilityExecutionInput["capabilityId"],
  inputs: CapabilityExecutionInput["inputs"] = [{ source: "user", value: "Explain this request." }],
  overrides: Partial<CapabilityExecutionInput> = {},
): CapabilityExecutionInput {
  return {
    executionId: "a3100000-0000-4000-8000-000000000007",
    stepId: "adapter-step",
    executionKey: "a3100000-0000-4000-8000-000000000008",
    capabilityId,
    inputs,
    context: {
      authenticatedUserId: USER_ID,
      conversationId: CONVERSATION_ID,
      requestMessageBinding: REQUEST_BINDING,
      resourceReferences: [],
      requestId: REQUEST_BINDING.requestId,
    },
    ...overrides,
  };
}

function standardResult(reply = "A qualified Standard answer.", requestId = REQUEST_BINDING.requestId): StandardOperationResult {
  return {
    kind: "standard_operation",
    requestId,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    reply,
    model: "test-model",
    reasoningEffort: "medium",
    measurements: [],
  };
}

function webResult(reply = "A qualified web answer."): WebSearchOperationResult {
  return {
    kind: "web_search_operation",
    requestId: REQUEST_BINDING.requestId,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    reply,
    sources: [{ title: "Official source", url: "https://example.test", snippet: "bounded snippet" }],
    sourceCount: 1,
    widget: { type: "time", location: "Rentz, GA", timezone: "America/New_York" },
    web: true,
    webSearchCalls: 2,
    model: "test-model",
    reasoningEffort: "medium",
    outcome: "success",
    latencyMs: 12,
    usage: { inputTokens: 11, cachedInputTokens: 0, outputTokens: 13, reasoningTokens: 0, totalTokens: 24 },
  };
}

function fileResult(extractedText = "Extracted document content."): FileContextResult {
  return {
    kind: "file_context",
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    documents: [{
      documentId: "a3100000-0000-4000-8000-000000000009",
      fileName: "source.txt",
      mimeType: "text/plain",
      sizeBytes: 400,
      extractedText,
    }],
  };
}

function generatedImage(): GeneratedImageReference {
  return {
    kind: "generated_image",
    imageId: "a3100000-0000-4000-8000-000000000010",
    conversationId: CONVERSATION_ID,
    userMessageId: REQUEST_BINDING.userMessageId,
    assistantMessageId: REQUEST_BINDING.assistantMessageId,
    mimeType: "image/webp",
    provider: "replicate",
    model: "flux-schnell",
  };
}

function generatedDocument(): GeneratedDocumentReference {
  return {
    kind: "generated_document",
    artifactId: "a3100000-0000-4000-8000-000000000011",
    conversationId: CONVERSATION_ID,
    messageId: REQUEST_BINDING.assistantMessageId,
    filename: "generated-document.pdf",
    format: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    createdAt: "2026-10-07T12:00:00.000Z",
  };
}

async function* standardEvents(result: StandardOperationResult) {
  yield { type: "text_delta", text: result.reply.slice(0, 8) } as const;
  yield { type: "measurement", measurement: {
    attemptKind: "primary" as const, model: result.model, outcome: "success" as const, latencyMs: 1,
    hadImage: false, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
  } } as const;
  yield { type: "text_delta", text: result.reply.slice(8) } as const;
  yield { type: "completion", result } as const;
}

function standardRunner(result: StandardOperationResult) {
  return vi.fn(async function* (input: StandardOperationInput) { void input; yield* standardEvents(result); });
}

function runtimeHandoff(steps: PlanStep[]): PlannedExecutionHandoff {
  const objective = "Prepare the requested response and artifact.";
  const plan = { objective, steps, status: "validated" as const };
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid) throw new Error(`Invalid adapter integration plan: ${validation.errors.join(", ")}`);
  return {
    version: 1,
    objective,
    plan,
    orderedStepIds: validation.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 6,
      capabilityIds: [...new Set(steps.map((step) => step.capability))].sort() as PlannedExecutionHandoff["governance"]["capabilityIds"],
      modelPlanningAllowed: false,
      maxModelCalls: 0,
      maxRepairAttempts: 0,
      attachmentContextAllowed: true,
      handoffVersion: 1,
    },
  };
}

describe("six independent capability adapters", () => {
  it("assembles Standard deltas, retains completion metadata, invokes the core once, and returns a >64 KiB result", async () => {
    const result = standardResult("A".repeat(70_000));
    const runOperation = standardRunner(result);
    const adapter = createStandardCapabilityAdapter({ runOperation: runOperation as unknown as StandardOperationRunner });
    const output = await adapter.execute(executionInput("standard"));

    expect(runOperation).toHaveBeenCalledTimes(1);
    expect(runOperation).toHaveBeenCalledWith(expect.objectContaining({
      requestContext: expect.objectContaining(REQUEST_BINDING),
      objective: "Explain this request.",
      reasoningEffort: "medium",
      history: [{ role: "user", content: "Explain this request." }],
    }));
    expect(output).toEqual({ kind: "text", value: result });
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeGreaterThan(65_536);
  });

  it("accepts a validated File Context predecessor", async () => {
    const context = fileResult();
    const runOperation = standardRunner(standardResult());
    const adapter = createStandardCapabilityAdapter({ runOperation: runOperation as unknown as StandardOperationRunner });
    await adapter.execute(executionInput("standard", [
      { source: "user", value: "Summarize the attached file." },
      { source: "step", stepId: "file", result: { kind: "structured_data", value: context } },
    ]));
    expect(runOperation).toHaveBeenCalledTimes(1);
    expect(runOperation.mock.calls[0]![0].fileContext).toEqual(context);
  });

  it("accepts a validated Web Search predecessor", async () => {
    const research = webResult();
    const runOperation = standardRunner(standardResult());
    const adapter = createStandardCapabilityAdapter({ runOperation: runOperation as unknown as StandardOperationRunner });
    await adapter.execute(executionInput("standard", [
      { source: "user", value: "Summarize the research." },
      { source: "step", stepId: "web", result: { kind: "search_results", value: research } },
    ]));
    expect(runOperation).toHaveBeenCalledTimes(1);
    expect(runOperation.mock.calls[0]![0].webSearchResult).toEqual(research);
  });

  it("accepts File Context and Web Search predecessors together", async () => {
    const context = fileResult();
    const research = webResult();
    const runOperation = standardRunner(standardResult());
    const adapter = createStandardCapabilityAdapter({ runOperation: runOperation as unknown as StandardOperationRunner });
    await adapter.execute(executionInput("standard", [
      { source: "user", value: "Use both sources." },
      { source: "step", stepId: "file", result: { kind: "structured_data", value: context } },
      { source: "step", stepId: "web", result: { kind: "search_results", value: research } },
    ]));
    expect(runOperation.mock.calls[0]![0]).toMatchObject({ fileContext: context, webSearchResult: research });
  });

  it("rejects malformed or cross-request Standard predecessors before invoking the core", async () => {
    const runOperation = standardRunner(standardResult());
    const adapter = createStandardCapabilityAdapter({ runOperation });
    await expect(adapter.execute(executionInput("standard", [
      { source: "user", value: "Summarize." },
      { source: "step", stepId: "wrong", result: { kind: "structured_data", value: { userId: OTHER_USER_ID } } },
    ]))).rejects.toMatchObject({ code: "missing_predecessor_result" });
    await expect(adapter.execute(executionInput("standard", [
      { source: "user", value: "Summarize." },
      { source: "step", stepId: "wrong", result: { kind: "search_results", value: { ...webResult(), userId: OTHER_USER_ID } } },
    ]))).rejects.toMatchObject({ code: "missing_predecessor_result" });
    expect(runOperation).not.toHaveBeenCalled();
  });

  it("invokes Web Search once and preserves sources, widget, call count, and measurement metadata", async () => {
    const research = webResult("W".repeat(70_000));
    const runOperation = vi.fn(async () => ({
      ok: true as const,
      result: research,
      measurement: { model: research.model, webSearchCalls: research.webSearchCalls, outcome: "success", latencyMs: 12, usage: research.usage },
    }));
    const output = await createWebSearchCapabilityAdapter({ runOperation: runOperation as unknown as WebSearchOperationRunner }).execute(executionInput("web_search"));
    expect(runOperation).toHaveBeenCalledTimes(1);
    expect(runOperation).toHaveBeenCalledWith(expect.objectContaining({
      requestContext: expect.objectContaining(REQUEST_BINDING),
      objective: "Explain this request.", mode: "force", reasoningEffort: "medium",
    }));
    expect(output).toEqual({ kind: "search_results", value: research });
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeGreaterThan(65_536);
  });

  it("normalizes Web Search failures and rejects mismatched runtime identity", async () => {
    const runOperation = vi.fn(async () => ({
      ok: false as const,
      error: { code: "provider_failed" as const },
      measurement: { model: "test-model", webSearchCalls: 0, outcome: "api_error" as const, latencyMs: 1,
        usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null } },
    }));
    const adapter = createWebSearchCapabilityAdapter({ runOperation: runOperation as unknown as WebSearchOperationRunner });
    await expect(adapter.execute(executionInput("web_search"))).rejects.toMatchObject({ code: "executor_failed" });
    await expect(adapter.execute(executionInput("web_search", undefined, {
      context: { ...executionInput("web_search").context, authenticatedUserId: OTHER_USER_ID },
    }))).rejects.toMatchObject({ code: "ownership_denied" });
    expect(runOperation).toHaveBeenCalledTimes(1);
  });

  it("uses File Context once with binding identity and preserves large CJK context without truncation", async () => {
    const result = fileResult("漢字資料".repeat(7_000));
    const prepareMock = vi.fn(async (input: FileContextServiceInput) => { void input; return result; });
    const prepareFileContext = prepareMock as unknown as FileContextPreparer;
    const output = await createFileAnalysisCapabilityAdapter({ prepareFileContext }).execute(executionInput("file_analysis", [
      { source: "attachment", reference: { id: result.documents[0]!.documentId, kind: "file" } },
    ]));
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(prepareMock).toHaveBeenCalledWith({
      userId: USER_ID, conversationId: CONVERSATION_ID, documentIds: [result.documents[0]!.documentId],
    });
    expect(output).toEqual({ kind: "structured_data", value: result });
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeGreaterThan(65_536);
  });

  it("preserves File Context service ownership and document-count errors safely", async () => {
    const prepareMock = vi.fn(async (input: FileContextServiceInput) => { void input; throw new FileContextPreparationError("document_unavailable"); });
    const prepareFileContext = prepareMock as unknown as FileContextPreparer;
    const adapter = createFileAnalysisCapabilityAdapter({ prepareFileContext });
    await expect(adapter.execute(executionInput("file_analysis", [
      { source: "attachment", reference: { id: "a3100000-0000-4000-8000-000000000012", kind: "file" } },
    ]))).rejects.toMatchObject({ code: "ownership_denied" });
    expect(prepareMock).toHaveBeenCalledTimes(1);
    const tooMany = Array.from({ length: 11 }, (_, index) => ({ source: "attachment" as const,
      reference: { id: `a3100000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`, kind: "file" as const } }));
    const boundedMock = vi.fn(async (input: FileContextServiceInput) => { void input; throw new FileContextPreparationError("invalid_reference"); });
    const boundedService = boundedMock as unknown as FileContextPreparer;
    await expect(createFileAnalysisCapabilityAdapter({ prepareFileContext: boundedService }).execute(
      executionInput("file_analysis", tooMany),
    )).rejects.toMatchObject({ code: "missing_input" });
    expect(boundedMock).toHaveBeenCalledTimes(1);
    expect(boundedMock.mock.calls[0]![0].documentIds).toHaveLength(11);
  });

  it("renders once and links a safe document reference only to the bound assistant destination", async () => {
    const standard = standardResult("Validated document body.");
    const artifact = { bytes: new Uint8Array([1, 2, 3]), filename: "generated-document.pdf", format: "pdf", mimeType: "application/pdf", sizeBytes: 3 } as GeneratedArtifact;
    const renderMock = vi.fn(async () => artifact);
    const render = renderMock as unknown as DocumentRenderer;
    const persistMock = vi.fn(async () => ({ reference: generatedDocument(), delivery: { ...artifact } }));
    const persist = persistMock as unknown as ExistingMessageDocumentPersister;
    const output = await createDocumentGenerationCapabilityAdapter({ render, persist }).execute(executionInput("document_generation", [
      { source: "user", value: "Create a PDF titled \"Project Notes\"." },
      { source: "step", stepId: "standard", result: { kind: "text", value: standard } },
    ]));
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledWith({ templateId: "simple-document", formats: ["pdf"],
      variables: { title: "Project Notes", body: standard.reply }, packageAsZip: false });
    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      generationRequestId: "a3100000-0000-4000-8000-000000000008",
      assistantMessageId: REQUEST_BINDING.assistantMessageId,
      templateId: "simple-document",
      generatedOutput: artifact,
    }));
    expect(output).toEqual({ kind: "document", value: generatedDocument() });
    expect(JSON.stringify(output)).not.toContain("bytes");
  });

  it("rejects unsupported document predecessor types and normalizes persistence errors", async () => {
    const renderMock = vi.fn(async () => ({} as GeneratedArtifact));
    const render = renderMock as unknown as DocumentRenderer;
    const persistMock = vi.fn();
    const persist = persistMock as unknown as ExistingMessageDocumentPersister;
    const adapter = createDocumentGenerationCapabilityAdapter({ render, persist });
    await expect(adapter.execute(executionInput("document_generation", [
      { source: "user", value: "Create a PDF." },
      { source: "step", stepId: "web", result: { kind: "search_results", value: webResult() } },
    ]))).rejects.toMatchObject({ code: "missing_predecessor_result" });
    expect(renderMock).not.toHaveBeenCalled();
    await expect(adapter.execute(executionInput("document_generation", [
      { source: "user", value: "Create an XLSX spreadsheet." },
      { source: "step", stepId: "standard", result: { kind: "text", value: standardResult() } },
    ]))).rejects.toMatchObject({ code: "missing_input" });
    expect(renderMock).not.toHaveBeenCalled();
    const persistFailure = vi.fn(async () => { throw new GeneratedDocumentPersistenceError("storage_failure"); }) as unknown as ExistingMessageDocumentPersister;
    const standard = standardResult();
    await expect(createDocumentGenerationCapabilityAdapter({
      render: vi.fn(async () => ({ bytes: new Uint8Array([9]), filename: "generated-document.pdf", format: "pdf", mimeType: "application/pdf", sizeBytes: 1 }) as GeneratedArtifact) as unknown as DocumentRenderer,
      persist: persistFailure,
    }).execute(executionInput("document_generation", [
      { source: "user", value: "Create a PDF." },
      { source: "step", stepId: "standard", result: { kind: "text", value: standard } },
    ]))).rejects.toMatchObject({ code: "persistence_failed" });
    expect(persistFailure).toHaveBeenCalledTimes(1);
  });

  it("supports Standard -> document when the durable runtime has discarded user text", async () => {
    const standard = standardResult("Content survives as the document body.");
    const artifact = { bytes: new Uint8Array([1]), filename: "generated-document.pdf", format: "pdf", mimeType: "application/pdf", sizeBytes: 1 } as GeneratedArtifact;
    const renderMock = vi.fn(async () => artifact);
    const persistMock = vi.fn(async () => ({ reference: generatedDocument(), delivery: { ...artifact } }));
    await createDocumentGenerationCapabilityAdapter({
      render: renderMock as unknown as DocumentRenderer,
      persist: persistMock as unknown as ExistingMessageDocumentPersister,
    }).execute(executionInput("document_generation", [
      { source: "step", stepId: "standard", result: { kind: "text", value: standard } },
    ]));
    expect(renderMock).toHaveBeenCalledWith({ templateId: "simple-document", formats: ["pdf"],
      variables: { title: "Generated document", body: standard.reply }, packageAsZip: false });
    expect(persistMock).toHaveBeenCalledTimes(1);
  });

  it("does not mistake ordinary mentions of text for a TXT format option", async () => {
    const artifact = { bytes: new Uint8Array([1]), filename: "generated-document.pdf", format: "pdf", mimeType: "application/pdf", sizeBytes: 1 } as GeneratedArtifact;
    const renderMock = vi.fn(async () => artifact);
    const adapter = createDocumentGenerationCapabilityAdapter({
      render: renderMock as unknown as DocumentRenderer,
      persist: vi.fn(async () => ({ reference: generatedDocument(), delivery: { ...artifact } })) as unknown as ExistingMessageDocumentPersister,
    });
    await adapter.execute(executionInput("document_generation", [
      { source: "user", value: "Create a PDF about text formatting." },
      { source: "step", stepId: "standard", result: { kind: "text", value: standardResult() } },
    ]));
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ formats: ["pdf"] }));
  });

  it("uses the existing-message Image Generation service once and excludes transient bytes", async () => {
    const generateMock = vi.fn(async () => ({ reference: generatedImage(), responseBytes: new Uint8Array([1, 2, 3]) }));
    const generate = generateMock as unknown as ExistingMessageImageGenerator;
    const output = await createImageGenerationCapabilityAdapter({ generate }).execute(executionInput("image_generation"));
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledWith({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      userMessageId: REQUEST_BINDING.userMessageId,
      assistantMessageId: REQUEST_BINDING.assistantMessageId,
      request: { prompt: "Explain this request." },
    });
    expect(output).toEqual({ kind: "image", value: generatedImage() });
    expect(JSON.stringify(output)).not.toContain("responseBytes");
  });

  it("normalizes Image Generation quota/provider failures without retrying", async () => {
    const generateMock = vi.fn(async () => { throw new ImageGenerationServiceError("daily_limit_reached"); });
    const generate = generateMock as unknown as ExistingMessageImageGenerator;
    await expect(createImageGenerationCapabilityAdapter({ generate }).execute(executionInput("image_generation")))
      .rejects.toMatchObject({ code: "executor_failed" });
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("uses the exact generated predecessor, stable key, bound messages, and safe lineage for Image Editing", async () => {
    const source = generatedImage();
    const createDependencies: ExistingMessageImageEditDependenciesFactory = vi.fn(async () => ({} as never));
    const orchestrateMock = vi.fn(async (input: ImageEditExistingMessageOrchestratorInput, dependencies: never) => {
      void input;
      void dependencies;
      return {
        kind: "completed" as const,
        disposition: "claimed" as const,
        status: "completed" as const,
        conversationId: CONVERSATION_ID,
        imageEditRequestId: "a3100000-0000-4000-8000-000000000013",
        userMessageId: REQUEST_BINDING.userMessageId,
        assistantMessageId: REQUEST_BINDING.assistantMessageId,
        generatedImageId: "a3100000-0000-4000-8000-000000000014",
      };
    });
    const orchestrate = orchestrateMock as unknown as ExistingMessageImageEditor;
    const output = await createImageEditingCapabilityAdapter({ createDependencies, orchestrate }).execute(executionInput("image_editing", [
      { source: "user", value: "Make the image brighter." },
      { source: "step", stepId: "image", result: { kind: "image", value: source } },
    ]));
    expect(createDependencies).toHaveBeenCalledTimes(1);
    expect(createDependencies).toHaveBeenCalledWith({
      authenticatedUserId: USER_ID, conversationId: CONVERSATION_ID,
      userMessageId: REQUEST_BINDING.userMessageId, assistantMessageId: REQUEST_BINDING.assistantMessageId,
    });
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(orchestrateMock.mock.calls[0]![0]).toEqual({
      authenticatedUserId: USER_ID,
      conversationId: CONVERSATION_ID,
      userMessageId: REQUEST_BINDING.userMessageId,
      assistantMessageId: REQUEST_BINDING.assistantMessageId,
      sourceReference: { kind: "generated_image", generatedImageId: source.imageId },
      instruction: "Make the image brighter.",
      idempotencyKey: "a3100000-0000-4000-8000-000000000008",
    });
    const value = (output as ExecutionStepResult).value as ImageEditingCapabilityResult;
    expect(value).toMatchObject({
      kind: "image_edit",
      reference: { imageId: "a3100000-0000-4000-8000-000000000014", assistantMessageId: REQUEST_BINDING.assistantMessageId },
      lineage: { operation: "edit", source: { kind: "generated_image", generatedImageId: source.imageId }, derivativeGeneratedImageId: "a3100000-0000-4000-8000-000000000014", instruction: "Make the image brighter." },
    });
  });

  it("hands the exact Image Generation reference into the qualified Image Editing adapter", async () => {
    const generate = vi.fn(async () => ({ reference: generatedImage(), responseBytes: new Uint8Array([7, 8, 9]) }));
    const generated = await createImageGenerationCapabilityAdapter({ generate: generate as unknown as ExistingMessageImageGenerator })
      .execute(executionInput("image_generation", [{ source: "user", value: "Generate a blue landscape." }]));
    const orchestrateMock = vi.fn(async (input: ImageEditExistingMessageOrchestratorInput, dependencies: never) => {
      void input;
      void dependencies;
      return {
        kind: "completed" as const,
        disposition: "claimed" as const,
        status: "completed" as const,
        conversationId: CONVERSATION_ID,
        imageEditRequestId: "a3100000-0000-4000-8000-000000000016",
        userMessageId: REQUEST_BINDING.userMessageId,
        assistantMessageId: REQUEST_BINDING.assistantMessageId,
        generatedImageId: "a3100000-0000-4000-8000-000000000017",
      };
    });
    await createImageEditingCapabilityAdapter({
      createDependencies: vi.fn(async () => ({} as never)),
      orchestrate: orchestrateMock as unknown as ExistingMessageImageEditor,
    }).execute(executionInput("image_editing", [
      { source: "user", value: "Make the image brighter." },
      { source: "step", stepId: "generate", result: generated },
    ]));
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(orchestrateMock.mock.calls[0]![0].sourceReference).toEqual({
      kind: "generated_image", generatedImageId: generatedImage().imageId,
    });
  });

  it("runs the image_generation -> image_editing handoff through the durable runtime using only the step image as source", async () => {
    const generateMock = vi.fn(async () => ({ reference: generatedImage(), responseBytes: new Uint8Array([1]) }));
    const imageGeneration = createImageGenerationCapabilityAdapter({ generate: generateMock as unknown as ExistingMessageImageGenerator });
    const editDependencies: ExistingMessageImageEditDependenciesFactory = vi.fn(async () => ({} as never));
    const orchestrateMock = vi.fn(async (input: ImageEditExistingMessageOrchestratorInput, dependencies: never) => {
      void input;
      void dependencies;
      return {
        kind: "completed" as const,
        disposition: "claimed" as const,
        status: "completed" as const,
        conversationId: CONVERSATION_ID,
        imageEditRequestId: "a3100000-0000-4000-8000-000000000018",
        userMessageId: REQUEST_BINDING.userMessageId,
        assistantMessageId: REQUEST_BINDING.assistantMessageId,
        generatedImageId: "a3100000-0000-4000-8000-000000000019",
      };
    });
    const imageEditing = createImageEditingCapabilityAdapter({
      createDependencies: editDependencies,
      orchestrate: orchestrateMock as unknown as ExistingMessageImageEditor,
    });
    const testOnlyComposite: CapabilityExecutor = {
      execute(input) {
        switch (input.capabilityId) {
          case "image_generation": return imageGeneration.execute(input);
          case "image_editing": return imageEditing.execute(input);
          default: throw new Error("Unexpected test capability.");
        }
      },
    };
    const runtime = new DurableXStateExecutionRuntime({
      store: new InMemoryExecutionStore(),
      executor: testOnlyComposite,
      authorizer: { authorize: async () => ({ allowed: true }) },
      requestMessageBindingValidator: { validate: async () => true },
      createExecutionId: () => "a3100000-0000-4000-8000-000000000042",
      createExecutionKey: (() => {
        let sequence = 43;
        return () => `a3100000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
      })(),
      now: () => new Date("2026-10-07T12:00:00.000Z"),
    });
    const outcome = await runtime.execute(runtimeHandoff([
      { id: "generate", capability: "image_generation", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "image" },
      { id: "edit", capability: "image_editing", dependsOn: ["generate"], inputs: [
        { source: "user" },
        { source: "attachment", output: "image" },
        { source: "step", stepId: "generate", output: "image" },
      ], expectedOutput: "image" },
    ]), {
      authenticatedUserId: USER_ID,
      conversationId: CONVERSATION_ID,
      requestMessageBinding: REQUEST_BINDING,
      userInput: "Generate a landscape, then make the generated image brighter.",
      attachments: [{ id: "a3100000-0000-4000-8000-000000000020", kind: "image" }],
    }, "durable-image-generation-edit-handoff");
    expect(outcome.kind).toBe("succeeded");
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(orchestrateMock.mock.calls[0]![0].sourceReference).toEqual({
      kind: "generated_image", generatedImageId: generatedImage().imageId,
    });
    expect(orchestrateMock.mock.calls[0]![0].assistantMessageId).toBe(REQUEST_BINDING.assistantMessageId);
  });

  it("rejects arbitrary or cross-binding Image Editing predecessors before orchestration", async () => {
    const orchestrate = vi.fn() as unknown as ExistingMessageImageEditor;
    const adapter = createImageEditingCapabilityAdapter({
      createDependencies: vi.fn(async () => ({} as never)), orchestrate,
    });
    await expect(adapter.execute(executionInput("image_editing", [
      { source: "user", value: "Remove it." },
      { source: "step", stepId: "image", result: { kind: "image", value: { imageId: OTHER_USER_ID } } },
    ]))).rejects.toMatchObject({ code: "missing_predecessor_result" });
    await expect(adapter.execute(executionInput("image_editing", [
      { source: "user", value: "Remove it." },
      { source: "step", stepId: "image", result: { kind: "image", value: {
        ...generatedImage(), userMessageId: "a3100000-0000-4000-8000-000000000015",
      } } },
    ]))).rejects.toMatchObject({ code: "missing_predecessor_result" });
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it("normalizes Image Editing idempotency, ownership, and persistence failures safely", async () => {
    const common = {
      createDependencies: vi.fn(async () => ({} as never)),
    };
    const call = (error: ImageEditOrchestrationError) => createImageEditingCapabilityAdapter({
      ...common,
      orchestrate: vi.fn(async () => { throw error; }),
    }).execute(executionInput("image_editing", [
      { source: "user", value: "Replace it." },
      { source: "step", stepId: "image", result: { kind: "image", value: generatedImage() } },
    ]));
    await expect(call(new ImageEditOrchestrationError("idempotency_conflict"))).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(call(new ImageEditOrchestrationError("source_forbidden"))).rejects.toMatchObject({ code: "ownership_denied" });
    await expect(call(new ImageEditOrchestrationError("persistence_failure"))).rejects.toMatchObject({ code: "persistence_failed" });
  });

  it("rejects duplicated context identity overrides and unexpected input fields for all six adapters", async () => {
    const adapters: readonly [CapabilityExecutionInput["capabilityId"], CapabilityExecutor][] = [
      ["standard", createStandardCapabilityAdapter({ runOperation: standardRunner(standardResult()) })],
      ["web_search", createWebSearchCapabilityAdapter({ runOperation: vi.fn(async () => ({ ok: true as const, result: webResult(), measurement: { model: "test-model", webSearchCalls: 2, outcome: "success" as const, latencyMs: 1, usage: webResult().usage } })) as unknown as WebSearchOperationRunner })],
      ["file_analysis", createFileAnalysisCapabilityAdapter({ prepareFileContext: vi.fn(async () => fileResult()) })],
      ["document_generation", createDocumentGenerationCapabilityAdapter({ render: vi.fn(async () => ({} as GeneratedArtifact)) as unknown as DocumentRenderer, persist: vi.fn() as unknown as ExistingMessageDocumentPersister })],
      ["image_generation", createImageGenerationCapabilityAdapter({ generate: vi.fn(async () => ({ reference: generatedImage(), responseBytes: new Uint8Array() })) })],
      ["image_editing", createImageEditingCapabilityAdapter({ createDependencies: vi.fn(async () => ({} as never)), orchestrate: vi.fn() as unknown as ExistingMessageImageEditor })],
    ];
    for (const [capability, adapter] of adapters) {
      const wrongContext = { ...executionInput(capability).context, authenticatedUserId: OTHER_USER_ID };
      await expect(adapter.execute(executionInput(capability, undefined, { context: wrongContext })))
        .rejects.toMatchObject({ code: "ownership_denied" });
    }
    await expect(createStandardCapabilityAdapter().execute(executionInput("standard", [
      { source: "user", value: "hello", userId: OTHER_USER_ID } as never,
    ]))).rejects.toMatchObject({ code: "missing_input" });
  });

  it("surfaces only the runtime-safe adapter failure code, not raw service details", async () => {
    const adapter = createStandardCapabilityAdapter({ runOperation: vi.fn(() => { throw new Error("provider key, SQL, and stack details"); }) });
    let thrown: unknown;
    try { await adapter.execute(executionInput("standard")); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(CapabilityAdapterError);
    expect(thrown).toMatchObject({ code: "executor_failed", message: "The requested step could not be completed." });
    expect(String((thrown as Error).message)).not.toContain("provider key");
  });

  it("preserves an adapter's safe failure code through durable checkpoint and reload", async () => {
    const store = new InMemoryExecutionStore();
    const runtime = new DurableXStateExecutionRuntime({
      store,
      executor: { execute: async () => { throw new CapabilityAdapterError("ownership_denied"); } },
      authorizer: { authorize: async () => ({ allowed: true }) },
      requestMessageBindingValidator: { validate: async () => true },
      createExecutionId: () => "a3100000-0000-4000-8000-000000000040",
      createExecutionKey: () => "a3100000-0000-4000-8000-000000000041",
      now: () => new Date("2026-10-07T12:00:00.000Z"),
    });
    const outcome = await runtime.execute(runtimeHandoff([
      { id: "only", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" },
    ]), {
      authenticatedUserId: USER_ID,
      conversationId: CONVERSATION_ID,
      requestMessageBinding: REQUEST_BINDING,
      userInput: "Execute safely.",
    }, "safe-adapter-error-roundtrip");
    expect(outcome).toMatchObject({ kind: "failed", failure: { code: "ownership_denied", message: "This execution is unavailable." } });
    if (outcome.kind !== "failed") return;
    const resumed = await runtime.resume({ runId: outcome.run.id, authenticatedUserId: USER_ID });
    expect(resumed).toMatchObject({ kind: "failed", failure: { code: "ownership_denied", message: "This execution is unavailable." } });
  });

  it("qualifies a real durable runtime file -> Standard -> document flow with one explicit test-only dispatcher", async () => {
    const context = fileResult("Owned source material.");
    const standard = standardResult("A final response from the Standard core.", RUNTIME_REQUEST_ID);
    const artifact = { bytes: new Uint8Array([4, 5, 6]), filename: "generated-document.pdf", format: "pdf", mimeType: "application/pdf", sizeBytes: 3 } as GeneratedArtifact;
    const file = createFileAnalysisCapabilityAdapter({ prepareFileContext: vi.fn(async () => context) });
    const runStandard = vi.fn(async function* () { yield* standardEvents(standard); });
    const standardAdapter = createStandardCapabilityAdapter({ runOperation: runStandard as unknown as StandardOperationRunner });
    const renderMock = vi.fn(async () => artifact);
    const render = renderMock as unknown as DocumentRenderer;
    const persistMock = vi.fn(async () => ({ reference: generatedDocument(), delivery: { ...artifact } }));
    const persist = persistMock as unknown as ExistingMessageDocumentPersister;
    const document = createDocumentGenerationCapabilityAdapter({ render, persist });
    const calls: CapabilityExecutionInput[] = [];
    // This deterministic dispatch belongs only to this test; no production registry is created.
    const testOnlyComposite: CapabilityExecutor = {
      async execute(input) {
        calls.push(input);
        switch (input.capabilityId) {
          case "file_analysis": return file.execute(input);
          case "standard": return standardAdapter.execute(input);
          case "document_generation": return document.execute(input);
          default: throw new Error("Unexpected test capability.");
        }
      },
    };
    const store = new InMemoryExecutionStore();
    let sequence = 0;
    const runtime = new DurableXStateExecutionRuntime({
      store,
      executor: testOnlyComposite,
      authorizer: { authorize: async () => ({ allowed: true }) },
      requestMessageBindingValidator: { validate: async () => true },
      createExecutionId: () => "a3100000-0000-4000-8000-000000000030",
      createExecutionKey: () => `a3100000-0000-4000-8000-${String(31 + sequence++).padStart(12, "0")}`,
      now: () => new Date("2026-10-07T12:00:00.000Z"),
    });
    const steps: PlanStep[] = [
      { id: "files", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }], expectedOutput: "structured_data" },
      { id: "answer", capability: "standard", dependsOn: ["files"], inputs: [
        { source: "user" }, { source: "step", stepId: "files", output: "structured_data" },
      ], expectedOutput: "text" },
      { id: "document", capability: "document_generation", dependsOn: ["answer"], inputs: [
        { source: "user" }, { source: "step", stepId: "answer", output: "text" },
      ], expectedOutput: "document" },
    ];
    const runtimeBinding = { ...REQUEST_BINDING, requestId: RUNTIME_REQUEST_ID };
    const runtimeInput: ExecutionRuntimeInput = {
      authenticatedUserId: USER_ID,
      conversationId: CONVERSATION_ID,
      requestMessageBinding: runtimeBinding,
      userInput: "Create a PDF from the answer.",
      attachments: [{ id: context.documents[0]!.documentId, kind: "file" }],
    };
    const outcome = await runtime.execute(runtimeHandoff(steps), runtimeInput, "adapter-durable-integration");
    expect(outcome.kind).toBe("succeeded");
    expect(calls.map((call) => call.capabilityId)).toEqual(["file_analysis", "standard", "document_generation"]);
    expect(calls.every((call) => call.context.requestMessageBinding === runtimeBinding
      || JSON.stringify(call.context.requestMessageBinding) === JSON.stringify(runtimeBinding))).toBe(true);
    expect(calls[1]!.inputs).toContainEqual({ source: "step", stepId: "files", result: { kind: "structured_data", value: context } });
    expect(calls[2]!.inputs).toContainEqual({ source: "step", stepId: "answer", result: { kind: "text", value: standard } });
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledTimes(1);
    const saved = await store.getRun({ runId: "a3100000-0000-4000-8000-000000000030", userId: USER_ID });
    expect(saved?.status).toBe("succeeded");
    expect(saved?.runtimeContext.requestMessageBinding).toEqual(runtimeBinding);
    expect(saved?.steps.map((step) => step.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });
});
