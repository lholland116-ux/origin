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
    rpc: ReturnType<typeof vi.fn>;
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
vi.mock("@/lib/documents/prepare-context", () => ({
  buildDocumentContext: vi.fn((documents: Array<{ id: string; file_name: string; extracted_text: string | null }>) =>
    documents.map((document) => `Document ${document.id}: ${document.extracted_text}`).join("\n"),
  ),
  DocumentContextLimitError: class DocumentContextLimitError extends Error {},
}));
vi.mock("@/lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test system prompt" }));
vi.mock("@/lib/utils", () => ({ buildConversationTitle: vi.fn(() => "Generated title") }));

import { POST } from "@/app/api/chat-web/route";

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
  builder.insert = vi.fn(async () => insertResults.shift() ?? { data: null, error: null });
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.upsert = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve, reject) => Promise.resolve(config.awaitResult).then(resolve, reject);
  return builder;
}

function setup(params: {
  plan?: "free" | "pro";
  conversationTitle?: string;
  documentRows?: unknown[];
  assistantInsertError?: unknown;
} = {}) {
  const messages = query({
    awaitResult: {
      data: [{ id: "message-1", role: "user", content: "Find current information.", created_at: "2026-10-03T00:00:00.000Z" }],
      error: null,
    },
    insertResults: [
      { data: null, error: null },
      { data: null, error: params.assistantInsertError ?? null },
    ],
  });
  const queries = {
    profiles: query({ awaitResult: { data: { plan: params.plan ?? "free" }, error: null } }),
    conversations: query({
      awaitResult: { data: null, error: null },
      singleResult: {
        data: { id: CONVERSATION_ID, user_id: USER_ID, title: params.conversationTitle ?? "Existing conversation" },
        error: null,
      },
    }),
    usage: query({
      awaitResult: { data: null, error: null },
      maybeSingleResult: { data: { message_count: 0 }, error: null },
    }),
    messages,
    documents: query({
      awaitResult: {
        data: params.documentRows ?? [{
          id: "document-1",
          file_name: "pasted-text.txt",
          mime_type: "text/plain",
          size_bytes: 4001,
          extraction_status: "ready",
          extraction_error: null,
          conversation_id: CONVERSATION_ID,
          extracted_text: "Private pasted document context.",
        }],
        error: null,
      },
    }),
  };

  mocks.supabase = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
    from: vi.fn((table: string) => queries[table as keyof typeof queries]),
    rpc: vi.fn(async () => ({
      data: [{ allowed: true, message_count: 1 }],
      error: null,
    })),
  };
}

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/chat-web", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: CONVERSATION_ID, message: "What is photosynthesis?", ...body }),
  });
}

function primaryResponse(params: Record<string, unknown> = {}) {
  return {
    status: "completed",
    error: null,
    output_text: "Web answer with current information.",
    output: [],
    ...params,
  };
}

function telemetryCalls(): AiRequestTelemetryRecord[] {
  return mocks.writeAiRequestTelemetry.mock.calls.map(([record]) => record as AiRequestTelemetryRecord);
}

describe("POST /api/chat-web telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
    mocks.writeAiRequestTelemetry.mockResolvedValue(undefined);
    mocks.openai.responses.create.mockResolvedValue(primaryResponse());
  });

  it("records a completed primary invocation with exact usage and privacy-safe fields", async () => {
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse({
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 80,
        output_tokens_details: { reasoning_tokens: 30 },
        total_tokens: 180,
      },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(telemetryCalls()).toEqual([expect.objectContaining({
      route: "web_search", attemptKind: "primary", model: "gpt-6-luna",
      webSearchCalls: 0,
      reasoningEffort: "medium", plan: "free", outcome: "success", hadImage: false,
      inputTokens: 100, cachedInputTokens: 20, outputTokens: 80, reasoningTokens: 30, totalTokens: 180,
      latencyMs: expect.any(Number),
    })]);
    expect(telemetryCalls()[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(telemetryCalls()[0]?.latencyMs)).toBe(true);
    expect(Object.keys(telemetryCalls()[0] ?? {})).toEqual([
      "route", "attemptKind", "model", "webSearchCalls", "reasoningEffort", "plan", "outcome", "latencyMs", "hadImage",
      "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens",
    ]);
    expect(JSON.stringify(telemetryCalls()[0])).not.toContain(USER_ID);
    expect(JSON.stringify(telemetryCalls()[0])).not.toContain(CONVERSATION_ID);
    expect(JSON.stringify(telemetryCalls()[0])).not.toContain("photosynthesis");
  });

  it("maps absent usage to null token fields", async () => {
    await POST(request());
    expect(telemetryCalls()[0]).toMatchObject({
      outcome: "success", webSearchCalls: 0, inputTokens: null, cachedInputTokens: null, outputTokens: null,
      reasoningTokens: null, totalTokens: null,
    });
  });

  it("records zero search calls for Auto when the provider does not search", async () => {
    const response = await POST(request({ webSearchMode: "auto" }));

    expect(response.status).toBe(200);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ tool_choice: "auto", tools: [{ type: "web_search_preview" }] }),
    );
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ route: "web_search", webSearchCalls: 0 }),
    ]);
  });

  it("records actual optional search calls for Auto", async () => {
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse({
      output: [{ id: "auto-search-1", type: "web_search_call", action: { type: "search" } }],
    }));

    const response = await POST(request({ webSearchMode: "auto" }));

    expect(response.status).toBe(200);
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ route: "web_search", webSearchCalls: 1 }),
    ]);
  });

  it("records actual calls for forced Web Search", async () => {
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse({
      output: [{ id: "forced-search-1", type: "web_search_call", action: { type: "search" } }],
    }));

    const response = await POST(request({ webSearchMode: "force" }));

    expect(response.status).toBe(200);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ tool_choice: "required" }),
    );
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ route: "web_search", webSearchCalls: 1 }),
    ]);
  });

  it("counts only distinct chargeable search actions and ignores open/find actions", async () => {
    const searchOne = { id: "search-1", type: "web_search_call", action: { type: "search" } };
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse({
      output: [
        searchOne,
        { ...searchOne },
        { id: "open-1", type: "web_search_call", action: { type: "open_page" } },
        { id: "find-1", type: "web_search_call", action: { type: "find_in_page" } },
        { id: "search-2", type: "web_search_call", action: { type: "search" } },
      ],
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(telemetryCalls()[0]).toMatchObject({ route: "web_search", webSearchCalls: 2 });
  });

  it.each([
    ["open_page", { type: "open_page" }],
    ["find_in_page", { type: "find_in_page" }],
  ])("does not count a %s action as a chargeable search", async (_name, action) => {
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse({
      output: [{ id: "non-search-1", type: "web_search_call", action }],
    }));

    await POST(request());
    expect(telemetryCalls()[0]).toMatchObject({ webSearchCalls: 0 });
  });

  it("records each search action found in a failed or incomplete provider response", async () => {
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse({
      status: "incomplete",
      output_text: "",
      output: [
        { id: "search-1", type: "web_search_call", action: { type: "search" } },
      ],
    }));

    await POST(request());
    expect(telemetryCalls()[0]).toMatchObject({ outcome: "incomplete", webSearchCalls: 1 });
  });

  it("measures latency only from immediately before provider create until it settles", async () => {
    const now = vi.spyOn(performance, "now")
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_041);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ attemptKind: "primary", latencyMs: 41 }),
    ]);
    now.mockRestore();
  });

  it.each([
    ["incomplete", primaryResponse({ status: "incomplete", usage: { input_tokens: 7, total_tokens: 9 } }), "incomplete"],
    ["failed", primaryResponse({ status: "failed", output_text: "", usage: undefined }), "api_error"],
    ["cancelled", primaryResponse({ status: "cancelled", output_text: "" }), "cancelled"],
    ["queued", primaryResponse({ status: "queued", output_text: "" }), "api_error"],
    ["in progress", primaryResponse({ status: "in_progress", output_text: "" }), "api_error"],
    ["missing status", primaryResponse({ status: undefined, output_text: "" }), "api_error"],
    ["unknown status", primaryResponse({ status: "future_status", output_text: "" }), "api_error"],
  ] as const)("records %s provider response with outcome %s", async (_name, providerResponse, outcome) => {
    mocks.openai.responses.create.mockResolvedValueOnce(providerResponse);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(telemetryCalls()).toEqual([expect.objectContaining({ outcome })]);
  });

  it("classifies a non-null response error as api_error without retaining its details", async () => {
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse({
      error: { code: "server_error", message: "private provider failure" },
      usage: { input_tokens: 3, total_tokens: 4 },
    }));

    await POST(request());
    expect(telemetryCalls()).toEqual([expect.objectContaining({ outcome: "api_error", inputTokens: 3, totalTokens: 4 })]);
    expect(JSON.stringify(telemetryCalls()[0])).not.toContain("private provider failure");
  });

  it("records a rejected create as api_error with null usage and preserves the existing 500 response", async () => {
    mocks.openai.responses.create.mockRejectedValueOnce(new Error("private provider rejection"));

    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong in /api/chat-web." });
    expect(telemetryCalls()).toEqual([expect.objectContaining({
      outcome: "api_error", inputTokens: null, cachedInputTokens: null, outputTokens: null,
      reasoningTokens: null, totalTokens: null,
    })]);
  });

  it.each([
    ["Rewrite this paragraph.", "low"],
    ["What is photosynthesis?", "medium"],
    ["Analyze the root cause of this failure.", "medium"],
  ] as const)("uses the selected %s effort for both provider and telemetry", async (message, effort) => {
    await POST(request({ message }));
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(expect.objectContaining({ reasoning: { effort } }));
    expect(telemetryCalls()).toEqual([expect.objectContaining({ reasoningEffort: effort })]);
  });

  it.each([
    ["instant", "none", "free"],
    ["medium", "medium", "free"],
    ["high", "high", "pro"],
  ] as const)("records explicit %s as provider effort %s", async (reasoningMode, effort, plan) => {
    setup({ plan });
    const response = await POST(request({ reasoningMode }));

    expect(response.status).toBe(200);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort } }),
    );
    expect(telemetryCalls()).toEqual([
      expect.objectContaining({ reasoningEffort: effort, attemptKind: "primary" }),
    ]);
  });

  it("rejects explicit Free High without provider invocation telemetry", async () => {
    setup({ plan: "free" });
    const response = await POST(request({ reasoningMode: "high" }));

    expect(response.status).toBe(403);
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    expect(telemetryCalls()).toEqual([]);
  });

  it("records the normalized Pro plan", async () => {
    setup({ plan: "pro" });
    await POST(request());
    expect(telemetryCalls()).toEqual([expect.objectContaining({ plan: "pro" })]);
  });

  it("keeps pasted-text context out of telemetry and hadImage false", async () => {
    await POST(request({ message: "Use the attached text.", documentIds: ["document-1"] }));
    expect(telemetryCalls()).toEqual([expect.objectContaining({ hadImage: false })]);
    expect(JSON.stringify(telemetryCalls()[0])).not.toContain("Private pasted document context.");
  });

  it("does not create a second row for title generation", async () => {
    setup({ conversationTitle: "New Chat" });
    mocks.openai.responses.create.mockResolvedValueOnce(primaryResponse()).mockResolvedValueOnce({ output_text: "Generated title" });

    const response = await POST(request({ reasoningMode: "medium" }));
    expect(response.status).toBe(200);
    expect(mocks.openai.responses.create).toHaveBeenCalledTimes(2);
    expect(telemetryCalls()).toEqual([expect.objectContaining({ attemptKind: "primary", route: "web_search" })]);
  });

  it("isolates an unexpectedly rejected writer from the Web Search response", async () => {
    mocks.writeAiRequestTelemetry.mockRejectedValueOnce(new Error("telemetry unavailable"));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reply: "Web answer with current information." });
    expect(mocks.writeAiRequestTelemetry).toHaveBeenCalledOnce();
  });

  it("retains provider success when assistant persistence fails downstream", async () => {
    setup({ assistantInsertError: { message: "assistant persistence failed" } });

    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(telemetryCalls()).toEqual([expect.objectContaining({ outcome: "success" })]);
  });
});
