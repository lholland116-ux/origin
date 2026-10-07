import { describe, expect, it } from "vitest";
import type { PlanStep } from "@/lib/ai/intelligence-plan";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import {
  fileContextResultSchema,
  generatedDocumentReferenceSchema,
  generatedImageReferenceSchema,
  standardOperationResultSchema,
  webSearchOperationResultSchema,
} from "@/lib/agent-runtime/application-contracts";
import {
  durablePayloadReferenceSchema,
  executionResultJsonBytes,
  executionResultSha256,
  executionResultsEqual,
  MAX_DURABLE_RESULT_PAYLOAD_BYTES,
  MAX_INLINE_RESULT_ENVELOPE_BYTES,
  resultStorageMode,
} from "@/lib/agent-runtime/result-payload-contract";
import type { ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import { validateExecutionStepResult, resolveExecutionInputs } from "@/lib/agent-runtime/xstate-runtime-adapter";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "b1000000-0000-4000-8000-000000000001";

function runtimeInput(): ExecutionRuntimeInput {
  return {
    authenticatedUserId: USER_ID,
    conversationId: CONVERSATION_ID,
    requestMessageBinding: {
      requestId: "c1000000-0000-4000-8000-000000000001",
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      userMessageId: "c1000000-0000-4000-8000-000000000002",
      assistantMessageId: "c1000000-0000-4000-8000-000000000003",
    },
  };
}

describe("durable execution result payload contract", () => {
  it("measures compact JSON as UTF-8 bytes and deterministically selects inline/reference bounds", () => {
    expect(executionResultJsonBytes({ kind: "text", value: "漢" })).toBe(Buffer.byteLength(JSON.stringify({ kind: "text", value: "漢" }), "utf8"));
    expect(resultStorageMode(MAX_INLINE_RESULT_ENVELOPE_BYTES)).toBe("inline");
    expect(resultStorageMode(MAX_INLINE_RESULT_ENVELOPE_BYTES + 1)).toBe("reference");
    expect(resultStorageMode(MAX_DURABLE_RESULT_PAYLOAD_BYTES * 2 + 1)).toBe("too_large");
    expect(resultStorageMode(Number.NaN)).toBe("too_large");
  });

  it("uses a strict typed payload reference and canonical integrity metadata", () => {
    const payload = { kind: "text", value: { reply: "large result" } };
    const reference = {
      storage: "payload_ref",
      payloadId: "d1000000-0000-4000-8000-000000000001",
      resultKind: "text",
      byteLength: executionResultJsonBytes(payload),
      sha256: executionResultSha256(payload),
    };
    expect(durablePayloadReferenceSchema.safeParse(reference).success).toBe(true);
    expect(durablePayloadReferenceSchema.safeParse({ ...reference, path: "/private/file" }).success).toBe(false);
    expect(durablePayloadReferenceSchema.safeParse({ ...reference, resultKind: "unknown" }).success).toBe(false);
    expect(executionResultsEqual({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(executionResultSha256({ b: 2, a: 1 })).toBe(executionResultSha256({ a: 1, b: 2 }));
  });

  it("rejects binary and class-instance values instead of persisting them as JSON results", () => {
    expect(validateExecutionStepResult({ kind: "text", value: Buffer.from("binary") }, "standard")).toBe(false);
    expect(validateExecutionStepResult({ kind: "text", value: new Date() }, "standard")).toBe(false);
  });

  it("keeps Standard, Web Search, and multibyte File Context contract outputs within the explicit bound", () => {
    const standard = {
      kind: "standard_operation" as const,
      requestId: "c1000000-0000-4000-8000-000000000001",
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      reply: "s".repeat(200_000),
      model: "m".repeat(100),
      reasoningEffort: "medium" as const,
      measurements: [],
    };
    const web = {
      kind: "web_search_operation" as const,
      requestId: standard.requestId,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      reply: "w".repeat(100_000),
      sources: Array.from({ length: 5 }, () => ({ title: "t".repeat(255), url: `https://${"u".repeat(2_040)}`, snippet: "s".repeat(4_000) })),
      sourceCount: 5,
      widget: null,
      web: true as const,
      webSearchCalls: 100,
      model: "m".repeat(100),
      reasoningEffort: "medium" as const,
      outcome: "success" as const,
      latencyMs: 10_000_000,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    };
    const fileContext = {
      kind: "file_context" as const,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      documents: [{
        documentId: "d1000000-0000-4000-8000-000000000001",
        fileName: "source.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        extractedText: "漢".repeat(22_000),
      }],
    };
    const standardResult = { kind: "text" as const, value: standard };
    const webResult = { kind: "search_results" as const, value: web };
    const fileResult = { kind: "structured_data" as const, value: fileContext };

    expect(standardOperationResultSchema.safeParse(standard).success).toBe(true);
    expect(webSearchOperationResultSchema.safeParse(web).success).toBe(true);
    expect(fileContextResultSchema.safeParse(fileContext).success).toBe(true);
    expect(executionResultJsonBytes(standardResult)).toBeGreaterThan(MAX_INLINE_RESULT_ENVELOPE_BYTES);
    expect(executionResultJsonBytes(webResult)).toBeGreaterThan(MAX_INLINE_RESULT_ENVELOPE_BYTES);
    expect(executionResultJsonBytes(fileResult)).toBeGreaterThan(MAX_INLINE_RESULT_ENVELOPE_BYTES);
    expect(executionResultJsonBytes(fileResult)).toBeGreaterThan(65_000);
    expect(executionResultJsonBytes(standardResult)).toBeLessThan(MAX_DURABLE_RESULT_PAYLOAD_BYTES);
    expect(executionResultJsonBytes(webResult)).toBeLessThan(MAX_DURABLE_RESULT_PAYLOAD_BYTES);
    expect(executionResultJsonBytes(fileResult)).toBeLessThan(MAX_DURABLE_RESULT_PAYLOAD_BYTES);
    expect(validateExecutionStepResult(standardResult, "standard")).toBe(true);
    expect(validateExecutionStepResult(webResult, "web_search")).toBe(true);
    expect(validateExecutionStepResult(fileResult, "file_analysis")).toBe(true);
  });

  it("preserves small reference results inline and accepts the exact payload byte maximum", () => {
    const generatedDocument = {
      kind: "generated_document" as const,
      artifactId: "d1000000-0000-4000-8000-000000000001",
      conversationId: CONVERSATION_ID,
      messageId: "c1000000-0000-4000-8000-000000000003",
      filename: "report.pdf",
      format: "pdf" as const,
      mimeType: "application/pdf",
      sizeBytes: 100,
      createdAt: "2026-10-07T12:00:00.000Z",
    };
    const generatedImage = {
      kind: "generated_image" as const,
      imageId: "d1000000-0000-4000-8000-000000000002",
      conversationId: CONVERSATION_ID,
      userMessageId: "c1000000-0000-4000-8000-000000000002",
      assistantMessageId: "c1000000-0000-4000-8000-000000000003",
      mimeType: "image/webp" as const,
      provider: "provider",
      model: "model",
    };
    for (const reference of [generatedDocument, generatedImage]) {
      const parsed = reference.kind === "generated_document"
        ? generatedDocumentReferenceSchema.safeParse(reference)
        : generatedImageReferenceSchema.safeParse(reference);
      expect(parsed.success).toBe(true);
      expect(resultStorageMode(executionResultJsonBytes({ kind: reference.kind === "generated_document" ? "document" : "image", value: reference })!)).toBe("inline");
    }

    const emptyResult = { kind: "text", value: "" };
    const exactMaximum = {
      kind: "text" as const,
      value: "x".repeat(MAX_DURABLE_RESULT_PAYLOAD_BYTES - executionResultJsonBytes(emptyResult)!),
    };
    const oversized = { ...exactMaximum, value: `${exactMaximum.value}x` };
    expect(executionResultJsonBytes(exactMaximum)).toBe(MAX_DURABLE_RESULT_PAYLOAD_BYTES);
    expect(validateExecutionStepResult(exactMaximum, "standard")).toBe(true);
    expect(executionResultJsonBytes(oversized)).toBe(MAX_DURABLE_RESULT_PAYLOAD_BYTES + 1);
    expect(validateExecutionStepResult(oversized, "standard")).toBe(false);
  });

  it("passes dereferenced results only through a declared predecessor with a compatible output kind", () => {
    const sourceResult = { kind: "search_results" as const, value: { exact: "original source metadata" } };
    const step: PlanStep = {
      id: "synthesize",
      capability: "standard",
      dependsOn: ["search"],
      inputs: [{ source: "step", stepId: "search", output: "search_results" }],
    };
    const handoff = { objective: "summarize", plan: { steps: [step] } } as PlannedExecutionHandoff;
    expect(resolveExecutionInputs(step, handoff, runtimeInput(), { search: sourceResult }).inputs?.[0]).toEqual({
      source: "step", stepId: "search", result: sourceResult,
    });
    expect(resolveExecutionInputs({ ...step, dependsOn: [] }, handoff, runtimeInput(), { search: sourceResult }).failure?.code)
      .toBe("missing_predecessor_result");
    expect(resolveExecutionInputs(step, handoff, runtimeInput(), { search: { ...sourceResult, kind: "text" } }).failure?.code)
      .toBe("missing_predecessor_result");
    expect(resolveExecutionInputs(step, handoff, runtimeInput(), {}).failure?.code).toBe("missing_predecessor_result");
  });
});
