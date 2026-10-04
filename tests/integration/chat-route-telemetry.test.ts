import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiRequestTelemetryRecord } from "@/lib/ai/request-telemetry";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

type QueryResult = { data: unknown; error: unknown };

type MockQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  then: PromiseLike<QueryResult>["then"];
};

const mocks = vi.hoisted(() => ({
  openai: { responses: { create: vi.fn(), stream: vi.fn() } },
  supabase: null as unknown as {
    auth: { getUser: ReturnType<typeof vi.fn> };
    from: ReturnType<typeof vi.fn>;
  },
  writeAiRequestTelemetry: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({ openai: mocks.openai }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));
vi.mock("@/lib/ai/request-telemetry-writer", () => ({
  writeAiRequestTelemetry: mocks.writeAiRequestTelemetry,
}));
vi.mock("@/lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test system prompt" }));
vi.mock("@/lib/utils", () => ({
  buildConversationTitle: vi.fn(() => "Generated title"),
}));

import { POST } from "@/app/api/chat/route";

function query(config: {
  awaitResult: QueryResult;
  singleResult?: QueryResult;
  maybeSingleResult?: QueryResult;
  insertResults?: QueryResult[];
}) {
  const builder = {} as MockQuery;
  const insertResults = [...(config.insertResults ?? [])];
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.single = vi.fn(async () => config.singleResult ?? config.awaitResult);
  builder.maybeSingle = vi.fn(async () => config.maybeSingleResult ?? config.awaitResult);
  builder.insert = vi.fn(async () => insertResults.shift() ?? ({ data: null, error: null }));
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.upsert = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve, reject) => Promise.resolve(config.awaitResult).then(resolve, reject);
  return builder;
}

function setup(params: {
  plan?: "free" | "pro";
  conversationTitle?: string;
  assistantInsertError?: unknown;
  latestMessage?: string;
} = {}) {
  const queries = {
    conversations: query({
      awaitResult: { data: null, error: null },
      singleResult: {
        data: {
          id: CONVERSATION_ID,
          user_id: USER_ID,
          title: params.conversationTitle ?? "Existing conversation",
        },
        error: null,
      },
    }),
    profiles: query({
      awaitResult: { data: { plan: params.plan ?? "free" }, error: null },
    }),
    usage: query({
      awaitResult: { data: null, error: null },
      maybeSingleResult: { data: { message_count: 0 }, error: null },
    }),
    messages: query({
      awaitResult: {
        data: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            role: "user",
            content: params.latestMessage ?? "What is photosynthesis?",
            created_at: "2026-10-03T00:00:00.000Z",
          },
        ],
        error: null,
      },
      insertResults: [
        { data: null, error: null },
        { data: null, error: params.assistantInsertError ?? null },
      ],
    }),
  };

  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) => queries[table as keyof typeof queries]),
  };
}

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: CONVERSATION_ID,
      message: "What is photosynthesis?",
      ...body,
    }),
  });
}

async function* events(...values: Array<Record<string, unknown>>) {
  for (const value of values) yield value;
}

function completed(usage?: Record<string, unknown>) {
  return { type: "response.completed", response: usage ? { usage } : {} };
}

function telemetryCalls(): AiRequestTelemetryRecord[] {
  return mocks.writeAiRequestTelemetry.mock.calls.map(
    ([record]) => record as AiRequestTelemetryRecord,
  );
}

async function waitForTelemetry(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mocks.writeAiRequestTelemetry.mock.calls.length > 0) return;
    await Promise.resolve();
  }
  throw new Error("Telemetry was not written");
}

describe("POST /api/chat telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
    mocks.writeAiRequestTelemetry.mockResolvedValue(undefined);
    mocks.openai.responses.stream.mockReturnValue(
      events(
        { type: "response.output_text.delta", delta: "Photosynthesis uses light." },
        completed(),
      ),
    );
    mocks.openai.responses.create.mockResolvedValue({ output_text: "Generated title" });
  });

  it("records a completed text-only primary invocation with exact usage and no request content", async () => {
    const usage = {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 80,
      output_tokens_details: { reasoning_tokens: 30 },
      total_tokens: 180,
    };
    mocks.openai.responses.stream.mockReturnValueOnce(
      events(
        { type: "response.output_text.delta", delta: "Photosynthesis uses light." },
        completed(usage),
      ),
    );

    const response = await POST(request());
    expect(await response.text()).toContain("Photosynthesis uses light.");

    expect(telemetryCalls()).toEqual([
      expect.objectContaining({
        route: "standard",
        attemptKind: "primary",
        model: "gpt-6-luna",
        webSearchCalls: 0,
        reasoningEffort: "medium",
        plan: "free",
        outcome: "success",
        hadImage: false,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 80,
        reasoningTokens: 30,
        totalTokens: 180,
        latencyMs: expect.any(Number),
      }),
    ]);
    expect(telemetryCalls()[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(telemetryCalls()[0] ?? {})).toEqual([
      "route", "attemptKind", "model", "webSearchCalls", "reasoningEffort", "plan", "outcome",
      "latencyMs", "hadImage", "inputTokens", "cachedInputTokens", "outputTokens",
      "reasoningTokens", "totalTokens",
    ]);
  });

  it("maps absent usage to null tokens and records the normalized Pro plan", async () => {
    setup({ plan: "pro" });

    const response = await POST(request());
    await response.text();

    expect(telemetryCalls()).toEqual([
      expect.objectContaining({
        plan: "pro",
        outcome: "success",
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      }),
    ]);
  });

  it("measures primary latency only across the provider attempt", async () => {
    const now = vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_037);
    const response = await POST(request());
    await response.text();
    expect(telemetryCalls()[0]).toMatchObject({ attemptKind: "primary", latencyMs: 37 });
    now.mockRestore();
  });

  it.each([
    [
      "response.failed",
      events({
        type: "response.failed",
        response: { usage: { input_tokens: 4, total_tokens: 5 } },
      }),
      { inputTokens: 4, totalTokens: 5 },
    ],
    ["error event", events({ type: "error", error: { message: "provider failure" } }), {}],
    ["stream end without terminal event", events({ type: "response.output_text.delta", delta: "partial" }), {}],
  ] as const)("records primary api_error for %s without duplicate rows", async (_name, stream, tokens) => {
    mocks.openai.responses.stream.mockReturnValueOnce(stream);

    const response = await POST(request());
    await response.text();

    expect(telemetryCalls()).toHaveLength(1);
    expect(telemetryCalls()[0]).toMatchObject({
      attemptKind: "primary",
      outcome: "api_error",
      ...tokens,
    });
  });

  it("records an iteration rejection as api_error while retaining the fallback response", async () => {
    mocks.openai.responses.stream.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        throw new Error("provider stream rejected");
      },
    });

    const response = await POST(request());
    expect(await response.text()).toContain("something went wrong");
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", outcome: "api_error" }),
    ]);
  });

  it("records incomplete terminal responses without changing the existing streamed reply", async () => {
    mocks.openai.responses.stream.mockReturnValueOnce(
      events(
        { type: "response.output_text.delta", delta: "Partial but useful." },
        {
          type: "response.incomplete",
          response: { usage: { input_tokens: 12, total_tokens: 16 } },
        },
      ),
    );

    const response = await POST(request());
    expect(await response.text()).toContain("Partial but useful.");
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({
        attemptKind: "primary",
        outcome: "incomplete",
        inputTokens: 12,
        totalTokens: 16,
      }),
    ]);
  });

  it("records route-observed cancellation before a primary terminal event once", async () => {
    mocks.openai.responses.stream.mockReturnValueOnce({
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<never>>(() => undefined) };
      },
    });

    const response = await POST(request());
    await vi.waitFor(() => expect(mocks.openai.responses.stream).toHaveBeenCalledOnce());
    await response.body?.getReader().cancel("consumer stopped");

    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", outcome: "cancelled" }),
    ]);
  });

  it("does not overwrite completed primary telemetry when the consumer cancels later", async () => {
    let resolveWrite!: () => void;
    mocks.writeAiRequestTelemetry.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const response = await POST(request());
    const reader = response.body!.getReader();
    await reader.read();
    await waitForTelemetry();

    const cancelled = reader.cancel("after completion");
    resolveWrite();
    await cancelled;

    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", outcome: "success" }),
    ]);
  });

  it("preserves provider success telemetry when downstream assistant persistence fails", async () => {
    setup({ assistantInsertError: { message: "private assistant persistence failure" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request());
    await response.text();
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", outcome: "success" }),
    ]);
    error.mockRestore();
  });

  it("records image-bearing weak-reply retry telemetry after the primary row", async () => {
    mocks.openai.responses.stream.mockReturnValueOnce(
      events(
        { type: "response.output_text.delta", delta: "No." },
        completed({ input_tokens: 10, total_tokens: 12 }),
      ),
    );
    mocks.openai.responses.create.mockResolvedValueOnce({
      status: "completed",
      error: null,
      output_text: "A complete image analysis.",
      usage: {
        input_tokens: 14,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens: 30,
        output_tokens_details: { reasoning_tokens: 11 },
        total_tokens: 44,
      },
    });

    const response = await POST(request({
      message: "Rewrite this image caption.",
      imageBase64: `data:image/png;base64,${"a".repeat(1_000)}`,
    }));
    expect(await response.text()).toContain("A complete image analysis.");

    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", outcome: "success", hadImage: true, webSearchCalls: 0 }),
      expect.objectContaining({
        attemptKind: "image_retry",
        outcome: "success",
        hadImage: true,
        webSearchCalls: 0,
        inputTokens: 14,
        cachedInputTokens: 2,
        outputTokens: 30,
        reasoningTokens: 11,
        totalTokens: 44,
      }),
    ]);
  });

  it("uses the primary model and effort while measuring retry latency from the retry attempt", async () => {
    mocks.openai.responses.stream.mockReturnValueOnce(
      events({ type: "response.output_text.delta", delta: "No." }, completed()),
    );
    mocks.openai.responses.create.mockResolvedValueOnce({
      status: "completed", error: null, output_text: "A complete image analysis.", usage: undefined,
    });
    const now = vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_029);
    const response = await POST(request({
      message: "Rewrite this image caption.", imageBase64: `data:image/png;base64,${"a".repeat(1_000)}`,
    }));
    await response.text();
    const [primary, retry] = telemetryCalls();
    expect(retry).toMatchObject({
      attemptKind: "image_retry", model: primary?.model, reasoningEffort: primary?.reasoningEffort,
      hadImage: true, webSearchCalls: 0, latencyMs: 29,
    });
    now.mockRestore();
  });

  it("does not invoke a retry for a non-weak image reply", async () => {
    mocks.openai.responses.stream.mockReturnValueOnce(
      events({ type: "response.output_text.delta", delta: "This is a complete image analysis response." }, completed()),
    );
    const response = await POST(request({ imageBase64: `data:image/png;base64,${"a".repeat(1_000)}` }));
    await response.text();
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", hadImage: true }),
    ]);
  });

  it.each([
    ["incomplete", { status: "incomplete", error: null, output_text: "partial", usage: undefined }, "incomplete"],
    ["failed response", { status: "failed", error: { message: "provider failure" }, output_text: "", usage: undefined }, "api_error"],
  ] as const)("records retry %s without replacing the primary answer", async (_name, retry, outcome) => {
    mocks.openai.responses.stream.mockReturnValueOnce(
      events({ type: "response.output_text.delta", delta: "No." }, completed()),
    );
    mocks.openai.responses.create.mockResolvedValueOnce(retry);

    const response = await POST(request({
      imageBase64: `data:image/png;base64,${"a".repeat(1_000)}`,
    }));
    expect(await response.text()).toContain("No.");

    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", outcome: "success" }),
      expect.objectContaining({
        attemptKind: "image_retry",
        outcome,
        inputTokens: null,
        totalTokens: null,
      }),
    ]);
  });

  it("records a rejected retry as api_error while preserving the primary answer", async () => {
    mocks.openai.responses.stream.mockReturnValueOnce(
      events({ type: "response.output_text.delta", delta: "No." }, completed()),
    );
    mocks.openai.responses.create.mockRejectedValueOnce(new Error("retry private failure"));

    const response = await POST(request({
      imageBase64: `data:image/png;base64,${"a".repeat(1_000)}`,
    }));
    expect(await response.text()).toContain("No.");
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", outcome: "success" }),
      expect.objectContaining({ attemptKind: "image_retry", outcome: "api_error" }),
    ]);
  });

  it("keeps title generation outside telemetry", async () => {
    setup({ conversationTitle: "New Chat" });

    const response = await POST(request());
    await response.text();

    expect(mocks.openai.responses.create).toHaveBeenCalledOnce();
    expect(telemetryCalls()).toHaveLength(1);
    expect(telemetryCalls()[0]).toMatchObject({ attemptKind: "primary" });
  });

  it("keeps document-intent planning outside telemetry", async () => {
    mocks.openai.responses.create.mockResolvedValueOnce({
      output_text: JSON.stringify({
        action: "none",
        templateId: "",
        formats: [],
        packageAsZip: false,
        title: "",
        variables: {},
      }),
    });

    const response = await POST(request({ message: "Create a PDF summary." }));

    expect(response.status).toBe(400);
    expect(mocks.openai.responses.create).toHaveBeenCalledOnce();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
    expect(telemetryCalls()).toHaveLength(0);
  });

  it.each([
    ["Rewrite this paragraph.", "low"],
    ["What is photosynthesis?", "medium"],
    ["Analyze the root cause of this failure.", "medium"],
  ] as const)("records the same selected %s effort used by the provider", async (message, effort) => {
    const response = await POST(request({ message }));
    await response.text();

    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort } }),
    );
    expect(telemetryCalls()[0]).toMatchObject({ reasoningEffort: effort });
  });

  it("isolates an unexpectedly rejected writer from the streamed result", async () => {
    mocks.writeAiRequestTelemetry.mockRejectedValueOnce(new Error("telemetry unavailable"));

    const response = await POST(request());
    expect(await response.text()).toContain("Photosynthesis uses light.");
    expect(mocks.writeAiRequestTelemetry).toHaveBeenCalledOnce();
  });

  it.each([
    ["instant", "none", "free"],
    ["medium", "medium", "free"],
    ["high", "high", "pro"],
  ] as const)("records explicit %s as provider effort %s", async (reasoningMode, effort, plan) => {
    setup({ plan });
    const response = await POST(request({ reasoningMode }));
    await response.text();

    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort } }),
    );
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ reasoningEffort: effort, attemptKind: "primary" }),
    ]);
  });

  it("rejects explicit Free High without a provider call or invocation telemetry", async () => {
    setup({ plan: "free" });
    const response = await POST(request({ reasoningMode: "high" }));

    expect(response.status).toBe(403);
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
    expect(telemetryCalls()).toEqual([]);
  });

  it("preserves the historical adaptive input for omitted-mode regeneration", async () => {
    setup({
      plan: "pro",
      latestMessage: "Analyze the root cause of this failure.",
    });

    const response = await POST(request({ regenerate: true, message: "" }));
    await response.text();

    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "high" } }),
    );
  });

  it("reuses explicit Instant for a weak-image retry", async () => {
    setup({ plan: "free" });
    mocks.openai.responses.stream.mockReturnValueOnce(events(
      { type: "response.output_text.delta", delta: "No." },
      completed({ input_tokens: 10, total_tokens: 12 }),
    ));
    mocks.openai.responses.create.mockResolvedValueOnce({
      status: "completed",
      output_text: "A complete image analysis response.",
    });

    const response = await POST(request({
      reasoningMode: "instant",
      imageBase64: `data:image/png;base64,${"a".repeat(1_000)}`,
    }));
    await response.text();

    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "none" } }),
    );
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "none" } }),
    );
    expect(telemetryCalls()).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptKind: "primary", reasoningEffort: "none" }),
      expect.objectContaining({ attemptKind: "image_retry", reasoningEffort: "none" }),
    ]));
  });
});
