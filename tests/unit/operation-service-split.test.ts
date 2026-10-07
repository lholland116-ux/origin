import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: {
    responses: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  },
  createSupabaseClient: vi.fn(),
  reserveDailyUsage: vi.fn(),
  writeTelemetry: vi.fn(),
  buildDocumentContext: vi.fn((documents: Array<{ id: string; extracted_text: string }>) =>
    documents.map((document) => `${document.id}: ${document.extracted_text}`).join("\n")),
}));

vi.mock("@/lib/openai", () => ({ openai: mocks.provider }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createSupabaseClient }));
vi.mock("@/lib/capabilities/daily-usage", () => ({ reserveDailyUsage: mocks.reserveDailyUsage }));
vi.mock("@/lib/ai/request-telemetry-writer", () => ({ writeAiRequestTelemetry: mocks.writeTelemetry }));
vi.mock("@/lib/documents/prepare-context", () => ({ buildDocumentContext: mocks.buildDocumentContext }));
vi.mock("@/lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test system prompt" }));

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { reserveDailyUsage } from "@/lib/capabilities/daily-usage";
import { writeAiRequestTelemetry } from "@/lib/ai/request-telemetry-writer";
import {
  createStandardOperationService,
  StandardOperationError,
  type StandardOperationEvent,
  type StandardOperationInput,
} from "@/lib/ai/standard-operation-service";
import {
  createWebSearchOperationService,
  type WebSearchOperationInput,
} from "@/lib/ai/web-search-operation-service";
import type { RequestTransactionContext } from "@/lib/agent-runtime/application-contracts";

const context: RequestTransactionContext = {
  requestId: "30000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000001",
  conversationId: "20000000-0000-4000-8000-000000000001",
  userMessageId: "40000000-0000-4000-8000-000000000001",
};

const fileContext = {
  kind: "file_context" as const,
  userId: context.userId,
  conversationId: context.conversationId,
  documents: [{
    documentId: "50000000-0000-4000-8000-000000000001",
    fileName: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 20,
    extractedText: "Prepared, owner-scoped file context.",
  }],
};

function responseStream(...events: unknown[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

function standardInput(overrides: Partial<StandardOperationInput> = {}): StandardOperationInput {
  return {
    requestContext: context,
    objective: "Answer the original request.",
    reasoningEffort: "medium",
    history: [{ role: "user", content: "Answer the original request." }],
    ...overrides,
  };
}

function webInput(overrides: Partial<WebSearchOperationInput> = {}): WebSearchOperationInput {
  return {
    requestContext: context,
    objective: "Find recent information.",
    reasoningEffort: "medium",
    history: [{ role: "user", content: "Find recent information." }],
    ...overrides,
  };
}

function expectNoRequestSideEffects(): void {
  expect(createServerSupabaseClient).not.toHaveBeenCalled();
  expect(reserveDailyUsage).not.toHaveBeenCalled();
  expect(writeAiRequestTelemetry).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Standard core operation", () => {
  it("streams deltas and returns a bounded completion without request-level side effects", async () => {
    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.output_text.delta", delta: "A useful Standard answer." },
      { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 } } },
    ));
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    const events: StandardOperationEvent[] = [];
    for await (const event of operation.run(standardInput())) events.push(event);

    expect(mocks.provider.responses.stream).toHaveBeenCalledOnce();
    expect(mocks.provider.responses.create).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text_delta", text: "A useful Standard answer." }),
      expect.objectContaining({
        type: "measurement",
        measurement: expect.objectContaining({
          attemptKind: "primary",
          outcome: "success",
          usage: { inputTokens: 12, cachedInputTokens: null, outputTokens: 7, reasoningTokens: null, totalTokens: 19 },
        }),
      }),
      expect.objectContaining({
        type: "completion",
        result: expect.objectContaining({
          kind: "standard_operation",
          requestId: context.requestId,
          reply: "A useful Standard answer.",
        }),
      }),
    ]));
    expect(JSON.stringify(events)).not.toContain("responses");
    expectNoRequestSideEffects();
  });

  it("preserves the weak-image retry path and reports both provider measurements", async () => {
    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.output_text.delta", delta: "No." },
      { type: "response.completed" },
    ));
    mocks.provider.responses.create.mockResolvedValue({
      status: "completed",
      error: null,
      output_text: "A full image description with useful detail.",
      usage: { input_tokens: 9, total_tokens: 16 },
    });
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    const events: StandardOperationEvent[] = [];
    for await (const event of operation.run(standardInput({ imageDataUrl: `data:image/png;base64,${"a".repeat(1_000)}` }))) {
      events.push(event);
    }

    expect(mocks.provider.responses.stream).toHaveBeenCalledOnce();
    expect(mocks.provider.responses.create).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === "measurement")).toHaveLength(2);
    expect(events.find((event) => event.type === "completion")).toMatchObject({
      result: { reply: "A full image description with useful detail." },
    });
    expectNoRequestSideEffects();
  });

  it("accepts both approved Web and File predecessors for the same request", async () => {
    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.output_text.delta", delta: "Combined answer." },
      { type: "response.completed" },
    ));
    const webResult = {
      kind: "web_search_operation" as const,
      requestId: context.requestId,
      userId: context.userId,
      conversationId: context.conversationId,
      reply: "Bounded approved research.",
      sources: [{ title: "Example", url: "https://example.com" }],
      sourceCount: 1,
      widget: null,
      web: true as const,
      webSearchCalls: 1,
      model: "gpt-6-luna",
      reasoningEffort: "medium" as const,
      outcome: "success" as const,
      latencyMs: 4,
      usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null },
    };
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    const events: StandardOperationEvent[] = [];
    for await (const event of operation.run(standardInput({ fileContext, webSearchResult: webResult }))) events.push(event);

    const serializedProviderInput = JSON.stringify(mocks.provider.responses.stream.mock.calls[0]?.[0]);
    expect(serializedProviderInput).toContain("Prepared, owner-scoped file context.");
    expect(serializedProviderInput).toContain("Bounded approved research.");
    expect(serializedProviderInput).toContain("https://example.com");
    expect(JSON.parse(JSON.stringify(events.at(-1)))).toMatchObject({ type: "completion", result: { reply: "Combined answer." } });
    expectNoRequestSideEffects();
  });

  it("rejects a mismatched predecessor before calling the provider", async () => {
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    await expect(async () => {
      for await (const event of operation.run(standardInput({
        fileContext: { ...fileContext, userId: "90000000-0000-4000-8000-000000000009" },
      }))) expect(event).toBeDefined();
    }).rejects.toMatchObject({ code: "invalid_predecessor_context" });
    expect(mocks.provider.responses.stream).not.toHaveBeenCalled();
    expectNoRequestSideEffects();
  });

  it("converts raw provider failures into safe operation errors", async () => {
    mocks.provider.responses.stream.mockRejectedValue(new Error("private provider detail"));
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    const events: StandardOperationEvent[] = [];
    let caught: unknown;
    try {
      for await (const event of operation.run(standardInput())) events.push(event);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StandardOperationError);
    expect((caught as Error).message).not.toContain("private provider detail");
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "measurement", measurement: expect.objectContaining({ outcome: "api_error" }) }),
    ]));
    expectNoRequestSideEffects();
  });
});

describe("Web Search core operation", () => {
  it("invokes the configured search tool once and returns safe sources and measurement data", async () => {
    mocks.provider.responses.create.mockResolvedValue({
      status: "completed",
      error: null,
      output_text: "Current answer from approved research.",
      output: [
        {
          id: "call-1",
          type: "web_search_call",
          action: { type: "search", sources: [{ title: "Example", url: "https://example.com", snippet: "A source." }] },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    const operation = createWebSearchOperationService({ provider: mocks.provider as never });
    const execution = await operation.run(webInput({ mode: "force" }));

    expect(mocks.provider.responses.create).toHaveBeenCalledOnce();
    expect(mocks.provider.responses.create).toHaveBeenCalledWith(expect.objectContaining({
      tools: [{ type: "web_search_preview" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      store: false,
    }));
    expect(execution).toMatchObject({
      ok: true,
      result: {
        kind: "web_search_operation",
        requestId: context.requestId,
        reply: "Current answer from approved research.",
        sources: [{ title: "Example", url: "https://example.com", snippet: "A source." }],
        webSearchCalls: 1,
      },
      measurement: { outcome: "success", webSearchCalls: 1 },
    });
    expect(JSON.stringify(execution)).not.toContain("private provider detail");
    expectNoRequestSideEffects();
  });

  it("returns a safe provider failure without leaking provider text or writing request side effects", async () => {
    mocks.provider.responses.create.mockRejectedValue(new Error("private provider detail"));
    const operation = createWebSearchOperationService({ provider: mocks.provider as never });
    const execution = await operation.run(webInput());

    expect(execution).toMatchObject({ ok: false, error: { code: "provider_failed" }, measurement: { outcome: "api_error" } });
    expect(JSON.stringify(execution)).not.toContain("private provider detail");
    expectNoRequestSideEffects();
  });
});

describe("request-semantics core harness", () => {
  it("runs Web Search then File Context and Standard under one request context without chat side effects", async () => {
    mocks.provider.responses.create.mockResolvedValue({
      status: "completed",
      error: null,
      output_text: "A bounded web research summary.",
      output: [],
      usage: undefined,
    });
    const webOperation = createWebSearchOperationService({ provider: mocks.provider as never });
    const webExecution = await webOperation.run(webInput());
    expect(webExecution.ok).toBe(true);
    if (!webExecution.ok) throw new Error("Expected Web Search completion.");

    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.output_text.delta", delta: "One final request-level answer." },
      { type: "response.completed" },
    ));
    const standardOperation = createStandardOperationService({ provider: mocks.provider as never });
    const standardEvents: StandardOperationEvent[] = [];
    for await (const event of standardOperation.run(standardInput({
      fileContext,
      webSearchResult: webExecution.result,
    }))) standardEvents.push(event);

    const completions = standardEvents.filter((event) => event.type === "completion");
    expect(completions).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(webExecution.result))).toMatchObject({
      requestId: context.requestId,
      userId: context.userId,
      conversationId: context.conversationId,
    });
    expect(JSON.stringify(completions[0])).toContain("One final request-level answer.");
    expect(mocks.provider.responses.create).toHaveBeenCalledOnce();
    expect(mocks.provider.responses.stream).toHaveBeenCalledOnce();
    expectNoRequestSideEffects();
  });
});
