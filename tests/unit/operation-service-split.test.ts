import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError } from "openai";

const mocks = vi.hoisted(() => ({
  provider: {
    responses: {
      create: vi.fn(),
      stream: vi.fn(),
      inputTokens: { count: vi.fn() },
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

  it("admits each durable OpenAI invocation against the exact counted input and output cap", async () => {
    mocks.provider.responses.inputTokens.count.mockResolvedValue({ input_tokens: 123 });
    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.created", response: { id: "resp_cost_bound_1" } },
      { type: "response.output_text.delta", delta: "A useful governed answer." },
      { type: "response.completed", response: { id: "resp_cost_bound_1", usage: {
        input_tokens: 123,
        input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
        output_tokens: 18,
        total_tokens: 141,
      } } },
    ));
    const ledger = {
      admit: vi.fn().mockResolvedValue({ id: "50000000-0000-4000-8000-000000000001", mayDispatch: true }),
      beginDispatch: vi.fn().mockResolvedValue(true),
      settle: vi.fn().mockResolvedValue(undefined),
      markUncertain: vi.fn().mockResolvedValue(undefined),
      releaseBeforeDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const providerCost = {
      context: {
        runId: "60000000-0000-4000-8000-000000000001",
        stepId: "answer",
        attemptId: "70000000-0000-4000-8000-000000000001",
        attemptNumber: 1,
        capabilityId: "file_analysis" as const,
        reauthorize: vi.fn().mockResolvedValue(true),
      },
      ledger,
    };
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    const events: StandardOperationEvent[] = [];
    for await (const event of operation.run(standardInput({
      executionMode: "durable_runtime_single_attempt",
      providerCost,
    }))) events.push(event);

    expect(mocks.provider.responses.inputTokens.count).toHaveBeenCalledOnce();
    expect(mocks.provider.responses.inputTokens.count).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-6-luna", instructions: expect.any(String), input: expect.any(Array) }),
      { maxRetries: 0, timeout: expect.any(Number) },
    );
    expect(ledger.admit).toHaveBeenCalledWith(providerCost.context, {
      invocationSequence: 1,
      provider: "openai",
      model: "gpt-6-luna",
      inputTokens: 123,
      maxOutputTokens: 4096,
    });
    expect(ledger.beginDispatch).toHaveBeenCalledOnce();
    expect(mocks.provider.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ max_output_tokens: 4096, store: false }),
      { maxRetries: 0, timeout: expect.any(Number) },
    );
    expect(ledger.markUncertain).toHaveBeenCalledWith(expect.objectContaining({
      admissionId: "50000000-0000-4000-8000-000000000001",
      providerOperationId: "resp_cost_bound_1",
    }));
    expect(ledger.settle).toHaveBeenCalledWith(expect.objectContaining({
      admissionId: "50000000-0000-4000-8000-000000000001",
      providerOperationId: "resp_cost_bound_1",
      usage: expect.objectContaining({ inputTokens: 123, cachedInputTokens: 20, cacheWriteTokens: 5, outputTokens: 18 }),
    }));
    expect(events.some((event) => event.type === "completion")).toBe(true);
  });

  it("fails closed before admission or generation when the exact OpenAI token count exceeds the cap", async () => {
    mocks.provider.responses.inputTokens.count.mockResolvedValue({ input_tokens: 16_001 });
    const ledger = {
      admit: vi.fn(),
      beginDispatch: vi.fn(),
      settle: vi.fn(),
      markUncertain: vi.fn(),
      releaseBeforeDispatch: vi.fn(),
    };
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    await expect(async () => {
      for await (const _event of operation.run(standardInput({
        executionMode: "durable_runtime_single_attempt",
        providerCost: {
          context: {
            runId: "60000000-0000-4000-8000-000000000001",
            stepId: "answer",
            attemptId: "70000000-0000-4000-8000-000000000001",
            attemptNumber: 1,
            capabilityId: "standard",
            reauthorize: vi.fn().mockResolvedValue(true),
          },
          ledger: ledger as never,
        },
      }))) void _event;
    }).rejects.toBeInstanceOf(StandardOperationError);
    expect(ledger.admit).not.toHaveBeenCalled();
    expect(mocks.provider.responses.stream).not.toHaveBeenCalled();
  });

  it("shares one absolute deadline across token counting and the model request", async () => {
    mocks.provider.responses.inputTokens.count.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { input_tokens: 10 };
    });
    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.output_text.delta", delta: "A bounded answer." },
      { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 4 } } },
    ));
    const ledger = {
      admit: vi.fn().mockResolvedValue({ id: "50000000-0000-4000-8000-000000000021", mayDispatch: true }),
      beginDispatch: vi.fn().mockResolvedValue(true), settle: vi.fn().mockResolvedValue(undefined),
      markUncertain: vi.fn().mockResolvedValue(undefined), releaseBeforeDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const deadline = Date.now() + 15_000;
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    for await (const event of operation.run(standardInput({
      executionMode: "durable_runtime_single_attempt",
      providerDeadlineAtMs: deadline,
      providerCost: { context: {
        runId: "60000000-0000-4000-8000-000000000001", stepId: "answer",
        attemptId: "70000000-0000-4000-8000-000000000021", attemptNumber: 1,
        capabilityId: "standard", reauthorize: vi.fn().mockResolvedValue(true),
      }, ledger },
    }))) void event;
    const countTimeout = Number(mocks.provider.responses.inputTokens.count.mock.calls[0]?.[1]?.timeout);
    const modelTimeout = Number(mocks.provider.responses.stream.mock.calls[0]?.[1]?.timeout);
    expect(countTimeout).toBeGreaterThan(0);
    expect(countTimeout).toBeLessThanOrEqual(15_000);
    expect(modelTimeout).toBeGreaterThan(0);
    expect(modelTimeout).toBeLessThan(countTimeout);
    expect(mocks.provider.responses.stream).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0, timeout: modelTimeout });
  });

  it("does not dispatch when the provider window is too short and retains ambiguous charges after timeout", async () => {
    const ledger = {
      admit: vi.fn().mockResolvedValue({ id: "50000000-0000-4000-8000-000000000022", mayDispatch: true }),
      beginDispatch: vi.fn().mockResolvedValue(true), settle: vi.fn().mockResolvedValue(undefined),
      markUncertain: vi.fn().mockResolvedValue(undefined), releaseBeforeDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const providerCost = { context: {
      runId: "60000000-0000-4000-8000-000000000001", stepId: "answer",
      attemptId: "70000000-0000-4000-8000-000000000022", attemptNumber: 1,
      capabilityId: "standard" as const, reauthorize: vi.fn().mockResolvedValue(true),
    }, ledger };
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    let caught: unknown;
    try {
      for await (const event of operation.run(standardInput({ executionMode: "durable_runtime_single_attempt",
        providerDeadlineAtMs: Date.now() + 4_000, providerCost }))) void event;
    } catch (error) { caught = error; }
    expect(caught).toMatchObject({ failureMetadata: { phase: "pre_provider", retrySafety: "SAFE_RETRY" } });
    expect(mocks.provider.responses.inputTokens.count).not.toHaveBeenCalled();
    expect(mocks.provider.responses.stream).not.toHaveBeenCalled();
    expect(ledger.admit).not.toHaveBeenCalled();

    mocks.provider.responses.inputTokens.count.mockResolvedValue({ input_tokens: 10 });
    mocks.provider.responses.stream.mockRejectedValue(new APIConnectionTimeoutError());
    caught = undefined;
    try {
      for await (const event of operation.run(standardInput({ executionMode: "durable_runtime_single_attempt",
        providerDeadlineAtMs: Date.now() + 15_000, providerCost }))) void event;
    } catch (error) { caught = error; }
    expect(caught).toMatchObject({ failureMetadata: { phase: "provider_in_flight", retrySafety: "RECOVERY_REQUIRED" } });
    expect(mocks.provider.responses.stream).toHaveBeenCalledOnce();
    expect(ledger.beginDispatch).toHaveBeenCalledOnce();
    expect(ledger.markUncertain).toHaveBeenCalledOnce();
    expect(ledger.settle).not.toHaveBeenCalled();
  });

  it("gives the internal image retry its own durable admission and counts it toward the two-call ceiling", async () => {
    mocks.provider.responses.inputTokens.count.mockResolvedValue({ input_tokens: 20 });
    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.created", response: { id: "resp_primary_retry" } },
      { type: "response.output_text.delta", delta: "No." },
      { type: "response.completed", response: { id: "resp_primary_retry", usage: { input_tokens: 20, output_tokens: 1 } } },
    ));
    mocks.provider.responses.create.mockResolvedValue({
      id: "resp_image_retry",
      status: "completed",
      error: null,
      output_text: "A detailed visual description that answers the request.",
      usage: { input_tokens: 20, output_tokens: 11 },
    });
    const ledger = {
      admit: vi.fn()
        .mockResolvedValueOnce({ id: "50000000-0000-4000-8000-000000000011", mayDispatch: true })
        .mockResolvedValueOnce({ id: "50000000-0000-4000-8000-000000000012", mayDispatch: true }),
      beginDispatch: vi.fn().mockResolvedValue(true),
      settle: vi.fn().mockResolvedValue(undefined),
      markUncertain: vi.fn().mockResolvedValue(undefined),
      releaseBeforeDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const providerCost = {
      context: {
        runId: "60000000-0000-4000-8000-000000000001",
        stepId: "answer",
        attemptId: "70000000-0000-4000-8000-000000000001",
        attemptNumber: 1,
        capabilityId: "standard" as const,
        reauthorize: vi.fn().mockResolvedValue(true),
      },
      ledger,
    };
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    const events: StandardOperationEvent[] = [];
    for await (const event of operation.run(standardInput({
      executionMode: "durable_runtime_single_attempt",
      providerCost,
      imageDataUrl: `data:image/png;base64,${"a".repeat(1_000)}`,
    }))) events.push(event);

    expect(ledger.admit.mock.calls.map(([context, request]) => [context, request.invocationSequence])).toEqual([
      [providerCost.context, 1], [providerCost.context, 2],
    ]);
    expect(ledger.beginDispatch).toHaveBeenCalledTimes(2);
    expect(ledger.settle).toHaveBeenCalledTimes(2);
    expect(ledger.settle.mock.calls.map(([input]) => input.admissionId)).toEqual([
      "50000000-0000-4000-8000-000000000011",
      "50000000-0000-4000-8000-000000000012",
    ]);
    expect(mocks.provider.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ max_output_tokens: 4096, store: false }),
      { maxRetries: 0, timeout: expect.any(Number) },
    );
    expect(events.find((event) => event.type === "completion")).toMatchObject({
      result: { reply: "A detailed visual description that answers the request." },
    });
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

  it("classifies only a pre-request DNS failure as retry-safe and disables SDK retries per durable attempt", async () => {
    const cause = Object.assign(new Error("private resolver detail"), { code: "EAI_AGAIN" });
    mocks.provider.responses.stream.mockRejectedValue(new APIConnectionError({ cause }));
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    let caught: unknown;
    try {
      for await (const event of operation.run(standardInput({ executionMode: "durable_runtime_single_attempt" }))) void event;
    } catch (error) {
      caught = error;
    }

    expect(mocks.provider.responses.stream).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0, timeout: expect.any(Number) });
    expect(caught).toBeInstanceOf(StandardOperationError);
    expect(caught).toMatchObject({ failureMetadata: { phase: "pre_provider", retrySafety: "SAFE_RETRY" } });
    expect(JSON.stringify(caught)).not.toContain("private resolver detail");

    mocks.provider.responses.stream.mockRejectedValue(new APIConnectionTimeoutError());
    caught = undefined;
    try {
      for await (const event of operation.run(standardInput({ executionMode: "durable_runtime_single_attempt" }))) void event;
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ failureMetadata: { phase: "provider_in_flight", retrySafety: "RECOVERY_REQUIRED" } });
    expectNoRequestSideEffects();
  });

  it("treats an incomplete durable Standard response as ambiguous recovery, not as a retry", async () => {
    mocks.provider.responses.stream.mockResolvedValue(responseStream(
      { type: "response.output_text.delta", delta: "Partial response." },
      { type: "response.incomplete", response: { usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } },
    ));
    const operation = createStandardOperationService({ provider: mocks.provider as never });
    let caught: unknown;
    try {
      for await (const event of operation.run(standardInput({ executionMode: "durable_runtime_single_attempt" }))) void event;
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ failureMetadata: { phase: "post_provider", retrySafety: "RECOVERY_REQUIRED" } });
    expect(mocks.provider.responses.stream).toHaveBeenCalledOnce();
    expect(mocks.provider.responses.stream).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0, timeout: expect.any(Number) });
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

  it("classifies pre-request DNS failure as retry-safe and disables SDK retries for durable search", async () => {
    const cause = Object.assign(new Error("private resolver detail"), { code: "EAI_AGAIN" });
    mocks.provider.responses.create.mockRejectedValue(new APIConnectionError({ cause }));
    const operation = createWebSearchOperationService({ provider: mocks.provider as never });
    const execution = await operation.run(webInput({ executionMode: "durable_runtime_single_attempt" }));

    expect(mocks.provider.responses.create).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0 });
    expect(execution).toMatchObject({
      ok: false,
      error: { code: "provider_failed", failureMetadata: { phase: "pre_provider", retrySafety: "SAFE_RETRY" } },
    });
    expect(JSON.stringify(execution)).not.toContain("private resolver detail");
    expectNoRequestSideEffects();
  });

  it("does not treat an incomplete provider response as a replay-safe Web result", async () => {
    mocks.provider.responses.create.mockResolvedValue({
      status: "incomplete",
      error: null,
      output_text: "Partial result that may have incurred provider side effects.",
      output: [{ id: "search-1", type: "web_search_call", action: { type: "search", sources: [] } }],
    });
    const operation = createWebSearchOperationService({ provider: mocks.provider as never });
    const execution = await operation.run(webInput({ executionMode: "durable_runtime_single_attempt" }));

    expect(execution).toMatchObject({
      ok: false,
      error: { code: "provider_failed", failureMetadata: { phase: "provider_in_flight", retrySafety: "RECOVERY_REQUIRED" } },
      measurement: { outcome: "incomplete", webSearchCalls: 1 },
    });
    expect(mocks.provider.responses.create).toHaveBeenCalledOnce();
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
