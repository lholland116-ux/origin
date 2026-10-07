import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

type QueryResult = {
  data: unknown;
  error: unknown;
};

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

type MockSupabase = {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as MockSupabase,
  openai: {
    responses: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  },
  writeAiRequestTelemetry: vi.fn(),
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/openai", () => ({ openai: mocks.openai }));
vi.mock("../../lib/ai/request-telemetry-writer", () => ({
  writeAiRequestTelemetry: mocks.writeAiRequestTelemetry,
}));

vi.mock("../../lib/documents/prepare-context", () => ({
  buildDocumentContext: vi.fn((documents: Array<{
    id: string;
    file_name: string;
    extracted_text: string | null;
  }>) =>
    documents
      .filter((document) => document.extracted_text?.trim())
      .map(
        (document) =>
          `Document ID: ${document.id}\nFile Name: ${document.file_name}\nContent:\n${document.extracted_text}`,
      )
      .join("\n\n---\n\n"),
  ),
  DocumentContextLimitError: class DocumentContextLimitError extends Error {},
}));

vi.mock("../../lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test system prompt" }));

vi.mock("../../lib/utils", () => ({
  buildConversationTitle: vi.fn(() => "Generated title"),
}));

import { POST as postStandard } from "../../app/api/chat/route";
import { POST as postWebSearch } from "../../app/api/chat-web/route";
import { createStandardChatService } from "../../lib/ai/standard-chat-service";
import { createWebSearchService } from "../../lib/ai/web-search-service";
import {
  buildDocumentContext,
  DocumentContextLimitError,
} from "../../lib/documents/prepare-context";

function query(config: {
  awaitResult: QueryResult;
  maybeSingleResult?: QueryResult;
  singleResult?: QueryResult;
  insertResult?: QueryResult;
}) {
  const queryBuilder = {} as MockQuery;

  queryBuilder.select = vi.fn(() => queryBuilder);
  queryBuilder.eq = vi.fn(() => queryBuilder);
  queryBuilder.in = vi.fn(() => queryBuilder);
  queryBuilder.order = vi.fn(() => queryBuilder);
  queryBuilder.limit = vi.fn(() => queryBuilder);
  queryBuilder.maybeSingle = vi.fn(async () => config.maybeSingleResult ?? config.awaitResult);
  queryBuilder.single = vi.fn(async () => config.singleResult ?? config.awaitResult);
  queryBuilder.insert = vi.fn(async () => config.insertResult ?? { data: null, error: null });
  queryBuilder.update = vi.fn(() => queryBuilder);
  queryBuilder.delete = vi.fn(() => queryBuilder);
  queryBuilder.upsert = vi.fn(async () => ({ data: null, error: null }));
  queryBuilder.then = (onFulfilled, onRejected) =>
    Promise.resolve(config.awaitResult).then(onFulfilled, onRejected);

  return queryBuilder;
}

function setup(params: {
  plan?: string | null;
  profileError?: unknown;
  profileMissing?: boolean;
  usageCount?: number;
  usageError?: unknown;
  documentRows?: unknown[];
  conversationTitle?: string;
}) {
  let currentUsageCount = params.usageCount ?? 0;
  const messages = [
    {
      id: "message-1",
      role: "user",
      content: "Find current information.",
      created_at: new Date().toISOString(),
    },
  ];
  const queries = {
    profiles: query({
      awaitResult: {
        data: params.profileMissing ? null : { plan: params.plan ?? "free" },
        error: params.profileError ?? null,
      },
      maybeSingleResult: {
        data: params.profileMissing ? null : { plan: params.plan ?? "free" },
        error: params.profileError ?? null,
      },
    }),
    conversations: query({
      awaitResult: { data: { error: null }, error: null },
      singleResult: {
        data: {
          id: CONVERSATION_ID,
          user_id: USER_ID,
          title: params.conversationTitle ?? "Existing conversation",
        },
        error: null,
      },
    }),
    usage: query({
      awaitResult: { data: null, error: params.usageError ?? null },
      maybeSingleResult: {
        data: { message_count: params.usageCount ?? 0 },
        error: params.usageError ?? null,
      },
    }),
    messages: query({
      awaitResult: { data: messages, error: null },
    }),
    documents: query({
      awaitResult: {
        data: params.documentRows ?? [
          {
            id: "document-1",
            file_name: "pasted-text.txt",
            mime_type: "text/plain",
            size_bytes: 4001,
            extraction_status: "ready",
            extraction_error: null,
            conversation_id: CONVERSATION_ID,
            extracted_text: "Full pasted text for web-search context.",
          },
        ],
        error: null,
      },
    }),
  };

  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) => queries[table as keyof typeof queries]),
    rpc: vi.fn(async (functionName: string, args: { p_limit: number }) => {
      if (functionName !== "reserve_daily_usage") {
        return { data: null, error: { message: "unexpected RPC" } };
      }
      if (params.usageError) return { data: null, error: params.usageError };
      if (currentUsageCount >= args.p_limit) {
        return {
          data: [{ allowed: false, message_count: currentUsageCount }],
          error: null,
        };
      }
      currentUsageCount += 1;
      return {
        data: [{ allowed: true, message_count: currentUsageCount }],
        error: null,
      };
    }),
  };

  mocks.openai.responses.create.mockResolvedValue({
    output_text: "Web answer with current information.",
    output: [],
  });
  mocks.openai.responses.stream.mockResolvedValue(
    (async function* standardResponse() {
      yield { type: "response.output_text.delta", delta: "Standard answer." };
      yield { type: "response.completed" };
    })(),
  );

  return { queries, supabase: mocks.supabase };
}

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/chat-web", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: CONVERSATION_ID,
      message: "Find current information.",
      ...body,
    }),
  });
}

function standardRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: CONVERSATION_ID,
      message: "Ask a standard question.",
      ...body,
    }),
  });
}

describe("Free Web Search entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeAiRequestTelemetry.mockResolvedValue(undefined);
  });

  it("runs the shared Standard service through injected provider mocks and emits application events", async () => {
    const { queries } = setup({ plan: "free", usageCount: 0 });
    const service = createStandardChatService({
      createSupabaseClient: vi.fn(async () => mocks.supabase) as never,
      provider: mocks.openai as never,
      writeTelemetry: mocks.writeAiRequestTelemetry as never,
    });

    const result = await service.run({
      userId: USER_ID,
      body: { conversationId: CONVERSATION_ID, message: "Ask a standard question." },
    });

    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") throw new Error("Expected a Standard stream result.");
    const events = [];
    for await (const event of result.events) events.push(event);

    expect(events).toEqual([{ type: "text_delta", text: "Standard answer." }]);
    expect(mocks.openai.responses.stream).toHaveBeenCalledOnce();
    expect(mocks.supabase.rpc).toHaveBeenCalledOnce();
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(queries.messages.insert).toHaveBeenCalledTimes(2);
    expect(mocks.writeAiRequestTelemetry).toHaveBeenCalledOnce();
  });

  it("runs the shared Web Search service with mocked provider and returns its application result", async () => {
    setup({ plan: "free", usageCount: 0 });
    const service = createWebSearchService({
      createSupabaseClient: vi.fn(async () => mocks.supabase) as never,
      provider: mocks.openai as never,
      writeTelemetry: mocks.writeAiRequestTelemetry as never,
    });

    const result = await service.run({
      userId: USER_ID,
      body: { conversationId: CONVERSATION_ID, message: "Find current information." },
    });

    expect(result).toMatchObject({
      kind: "json",
      status: 200,
      body: { reply: "Web answer with current information.", web: true },
    });
    expect(mocks.openai.responses.create).toHaveBeenCalledOnce();
    expect(mocks.supabase.rpc).toHaveBeenCalledOnce();
    expect(mocks.writeAiRequestTelemetry).toHaveBeenCalledOnce();
  });

  it.each(["standard", "web_search"] as const)(
    "%s fails closed when profile lookup infrastructure fails",
    async (route) => {
      setup({ profileError: { message: "private profile database error" } });
      const response = route === "standard"
        ? await postStandard(standardRequest())
        : await postWebSearch(request());
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).toContain("ACCOUNT_STATE_UNAVAILABLE");
      expect(body).not.toContain("private profile database error");
      expect(mocks.supabase.rpc).not.toHaveBeenCalled();
      expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
      expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    },
  );

  it.each(["standard", "web_search"] as const)(
    "%s fails closed when the profile is missing",
    async (route) => {
      setup({ profileMissing: true });
      const response = route === "standard"
        ? await postStandard(standardRequest())
        : await postWebSearch(request());

      expect(response.status).toBe(503);
      expect(await response.text()).toContain("ACCOUNT_STATE_UNAVAILABLE");
      expect(mocks.supabase.rpc).not.toHaveBeenCalled();
      expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
      expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    },
  );

  it.each(["standard", "web_search"] as const)(
    "%s rejects an unknown plan without granting Pro or falling back to Free",
    async (route) => {
      setup({ plan: "enterprise" });
      const response = route === "standard"
        ? await postStandard(standardRequest())
        : await postWebSearch(request());

      expect(response.status).toBe(503);
      expect(await response.text()).toContain("INVALID_ACCOUNT_STATE");
      expect(mocks.supabase.rpc).not.toHaveBeenCalled();
      expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
      expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    },
  );

  it.each(["standard", "web_search"] as const)(
    "%s fails safely when atomic usage reservation storage fails",
    async (route) => {
      setup({ usageError: { message: "private usage database error" } });
      const response = route === "standard"
        ? await postStandard(standardRequest())
        : await postWebSearch(request());
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain("USAGE_UNAVAILABLE");
      expect(body).not.toContain("private usage database error");
      expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.supabase.rpc).toHaveBeenCalledWith(
        "reserve_daily_usage",
        expect.objectContaining({ p_user_id: USER_ID }),
      );
      expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
      expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["standard", "free", "instant", "none"],
    ["standard", "free", "medium", "medium"],
    ["standard", "pro", "instant", "none"],
    ["standard", "pro", "medium", "medium"],
    ["standard", "pro", "high", "high"],
    ["web_search", "free", "instant", "none"],
    ["web_search", "free", "medium", "medium"],
    ["web_search", "pro", "instant", "none"],
    ["web_search", "pro", "medium", "medium"],
    ["web_search", "pro", "high", "high"],
  ] as const)("uses explicit %s reasoning mode %s for %s as provider effort %s", async (route, plan, reasoningMode, effort) => {
    setup({ plan, usageCount: 0 });
    const response = route === "standard"
      ? await postStandard(standardRequest({ reasoningMode }))
      : await postWebSearch(request({ reasoningMode }));
    if (route === "standard") await response.text();

    expect(response.status).toBe(200);
    const providerCalls = route === "standard"
      ? mocks.openai.responses.stream
      : mocks.openai.responses.create;
    expect(providerCalls).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort } }),
    );
  });

  it.each(["standard", "web_search"] as const)("rejects explicit Free High on %s before side effects", async (route) => {
    const { queries } = setup({ plan: "free", usageCount: 0 });
    const response = route === "standard"
      ? await postStandard(standardRequest({ reasoningMode: "high" }))
      : await postWebSearch(request({ reasoningMode: "high" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "High reasoning is available with Pro.",
      code: "REASONING_MODE_NOT_ENTITLED",
    });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(queries.messages.insert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    expect(mocks.writeAiRequestTelemetry).not.toHaveBeenCalled();
  });

  it.each(["standard", "web_search"] as const)("rejects malformed explicit selector on %s before side effects", async (route) => {
    const { queries } = setup({ plan: "pro", usageCount: 0 });
    const response = route === "standard"
      ? await postStandard(standardRequest({ reasoningMode: "xhigh" }))
      : await postWebSearch(request({ reasoningMode: "xhigh" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REASONING_MODE" });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(queries.messages.insert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    expect(mocks.writeAiRequestTelemetry).not.toHaveBeenCalled();
  });

  it.each(["standard", "web_search"] as const)("caps omitted adaptive High to medium for Free on %s", async (route) => {
    setup({ plan: "free", usageCount: 0 });
    const message = "Analyze the root cause of this validation failure.";
    const response = route === "standard"
      ? await postStandard(standardRequest({ message }))
      : await postWebSearch(request({ message }));
    if (route === "standard") await response.text();

    const providerCalls = route === "standard"
      ? mocks.openai.responses.stream
      : mocks.openai.responses.create;
    expect(providerCalls).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "medium" } }),
    );
    expect(providerCalls).not.toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "high" } }),
    );
  });

  it.each(["standard", "web_search"] as const)("preserves omitted adaptive High for Pro on %s", async (route) => {
    setup({ plan: "pro", usageCount: 0 });
    const message = "Analyze the root cause of this validation failure.";
    const response = route === "standard"
      ? await postStandard(standardRequest({ message }))
      : await postWebSearch(request({ message }));
    if (route === "standard") await response.text();

    const providerCalls = route === "standard"
      ? mocks.openai.responses.stream
      : mocks.openai.responses.create;
    expect(providerCalls).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "high" } }),
    );
  });

  it("allows an authenticated Free user to use Web Search and counts one shared message", async () => {
    const { queries } = setup({ plan: "free", usageCount: 0 });

    const response = await postWebSearch(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      reply: "Web answer with current information.",
      web: true,
    });
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.supabase.rpc).toHaveBeenCalledWith(
      "reserve_daily_usage",
      expect.objectContaining({ p_user_id: USER_ID, p_limit: 20 }),
    );
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.create).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-luna",
        reasoning: { effort: "medium" },
        tools: [{ type: "web_search_preview" }],
        include: ["web_search_call.action.sources"],
        store: false,
      }),
    );
    expect(mocks.openai.responses.create.mock.calls[0]?.[0]).not.toHaveProperty("tool_choice");
    expect(JSON.stringify(body)).not.toContain("PRO_REQUIRED");
  });

  it.each([
    ["auto", "auto"],
    ["force", "required"],
  ] as const)("configures explicit Web Search mode %s as provider tool choice %s", async (webSearchMode, toolChoice) => {
    setup({ plan: "free", usageCount: 0 });

    const response = await postWebSearch(request({ webSearchMode }));

    expect(response.status).toBe(200);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ type: "web_search_preview" }],
        tool_choice: toolChoice,
      }),
    );
  });

  it.each([
    null,
    "",
    "standard",
    "web_search",
    "required",
    3,
    {},
    [],
    "unknown",
  ])("rejects malformed explicit webSearchMode %j before side effects", async (webSearchMode) => {
    const { queries } = setup({ plan: "free", usageCount: 0 });

    const response = await postWebSearch(request({ webSearchMode }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_WEB_SEARCH_MODE" });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
  });

  it("includes a ready pasted-text attachment in Web Search model context", async () => {
    const { queries } = setup({ plan: "free", usageCount: 0 });

    const response = await postWebSearch(
      request({
        message: "Use the attached text with current information.",
        documentIds: ["document-1"],
      }),
    );

    expect(response.status).toBe(200);
    expect(queries.documents.in).toHaveBeenCalledWith("id", ["document-1"]);
    expect(queries.messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        documents: [expect.objectContaining({ file_name: "pasted-text.txt" })],
      }),
    );
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: "medium" },
        input: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Full pasted text for web-search context."),
          }),
        ]),
      }),
    );
  });

  it("rejects an ordinary manual document from Web Search without consuming quota", async () => {
    const { queries } = setup({
      plan: "free",
      usageCount: 0,
      documentRows: [
        {
          id: "manual-document-1",
          file_name: "meeting-notes.txt",
          mime_type: "text/plain",
          size_bytes: 4001,
          extraction_status: "ready",
          extraction_error: null,
          conversation_id: CONVERSATION_ID,
          extracted_text: "Ordinary manually uploaded document content.",
        },
      ],
    });

    const response = await postWebSearch(
      request({ documentIds: ["manual-document-1"] }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "WEB_SEARCH_DOCUMENT_NOT_ALLOWED" });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
  });

  it("does not consume quota when Web Search document context cannot be prepared", async () => {
    const { queries } = setup({ plan: "free", usageCount: 0 });
    vi.mocked(buildDocumentContext).mockImplementationOnce(() => {
      throw new DocumentContextLimitError();
    });

    const response = await postWebSearch(
      request({ documentIds: ["document-1"] }),
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toMatchObject({ code: "DOCUMENT_CONTEXT_TOO_LARGE" });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
  });

  it("keeps the Web Search inline-message limit at 4,000 characters", async () => {
    const { queries } = setup({ plan: "free", usageCount: 0 });

    const response = await postWebSearch(request({ message: "x".repeat(4001) }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Message exceeds 4000 characters." });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
  });

  it("accepts Free Web Search at 19 of 20 messages", async () => {
    setup({ plan: "free", usageCount: 19 });

    const response = await postWebSearch(request());

    expect(response.status).toBe(200);
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.supabase.rpc).toHaveBeenCalledWith(
      "reserve_daily_usage",
      expect.objectContaining({ p_user_id: USER_ID, p_limit: 20 }),
    );
  });

  it("rejects Free Web Search at the shared 20-message limit before model execution", async () => {
    const { queries } = setup({ plan: "free", usageCount: 20 });

    const response = await postWebSearch(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "LIMIT_REACHED", plan: "free", limit: 20 });
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("database");
  });

  it("rejects Standard at the same Free 20-message limit", async () => {
    const { queries } = setup({ plan: "free", usageCount: 20 });

    const response = await postStandard(standardRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "LIMIT_REACHED", plan: "free", limit: 20 });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("keeps Standard below the shared limit and increments usage once", async () => {
    const { queries } = setup({ plan: "free", usageCount: 19 });

    const response = await postStandard(standardRequest());
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.supabase.rpc).toHaveBeenCalledWith(
      "reserve_daily_usage",
      expect.objectContaining({ p_user_id: USER_ID, p_limit: 20 }),
    );
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-6-luna" }),
    );
  });

  it.each([
    ["Rewrite this paragraph more clearly.", "low"],
    ["What is the latest Node.js version?", "medium"],
    [
      "Compare the current Node.js release with our production version and assess migration risks.",
      "medium",
    ],
  ] as const)("sends %s reasoning effort on the primary Web Search request", async (message, effort) => {
    setup({ plan: "free", usageCount: 0 });

    const response = await postWebSearch(request({ message }));
    expect(response.status).toBe(200);

    expect(mocks.openai.responses.create).toHaveBeenCalledOnce();
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-luna",
        reasoning: { effort },
      }),
    );
  });

  it("keeps an ordinary question at medium in both Standard and Web Search", async () => {
    const message = "What is photosynthesis?";
    setup({ plan: "free", usageCount: 0 });

    const standardResponse = await postStandard(standardRequest({ message }));
    await standardResponse.text();
    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "medium" } }),
    );

    vi.clearAllMocks();
    setup({ plan: "free", usageCount: 0 });
    const webResponse = await postWebSearch(request({ message }));
    expect(webResponse.status).toBe(200);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "medium" } }),
    );
  });

  it("does not let a valid pasted-text attachment elevate an ordinary Web Search question", async () => {
    setup({ plan: "free", usageCount: 0 });

    const response = await postWebSearch(
      request({
        message: "What does this text say?",
        documentIds: ["document-1"],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: "medium" } }),
    );
  });

  it("keeps Web Search title generation outside adaptive reasoning", async () => {
    setup({
      plan: "free",
      usageCount: 0,
      conversationTitle: "New Chat",
    });

    const response = await postWebSearch(
      request({ message: "What is the latest Node.js version?" }),
    );
    expect(response.status).toBe(200);

    expect(mocks.openai.responses.create).toHaveBeenCalledTimes(2);
    const primaryRequest = mocks.openai.responses.create.mock.calls[0]?.[0];
    const titleRequest = mocks.openai.responses.create.mock.calls[1]?.[0];
    expect(primaryRequest).toMatchObject({ reasoning: { effort: "medium" } });
    expect(titleRequest).toMatchObject({ model: "gpt-6-luna" });
    expect(titleRequest).not.toHaveProperty("reasoning");
  });

  it.each([
    ["Rewrite this paragraph more clearly.", "low"],
    ["What is photosynthesis?", "medium"],
    ["Analyze the root cause of this validation failure.", "medium"],
  ] as const)("sends %s reasoning effort on the primary Standard request", async (message, effort) => {
    setup({ plan: "free", usageCount: 0 });

    const response = await postStandard(standardRequest({ message }));
    await response.text();

    expect(mocks.openai.responses.stream).toHaveBeenCalledOnce();
    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-luna",
        reasoning: { effort },
      }),
    );
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
  });

  it("reuses the primary effort for a weak-image-response retry", async () => {
    setup({ plan: "free", usageCount: 0 });
    mocks.openai.responses.stream.mockResolvedValueOnce((async function* weakResponse() {
      yield { type: "response.output_text.delta", delta: "No." };
      yield { type: "response.completed" };
    })());
    mocks.openai.responses.create.mockResolvedValueOnce({
      output_text: "A complete image analysis response.",
    });

    const response = await postStandard(
      standardRequest({
        message: "Rewrite this image caption.",
        imageBase64: `data:image/png;base64,${"a".repeat(1_000)}`,
      }),
    );
    await response.text();

    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-luna",
        reasoning: { effort: "low" },
      }),
    );
    expect(mocks.openai.responses.create).toHaveBeenCalledOnce();
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-6-luna",
        reasoning: { effort: "low" },
      }),
    );
  });

  it("keeps conversation-title generation outside an explicit reasoning mode", async () => {
    setup({
      plan: "free",
      usageCount: 0,
      conversationTitle: "New Chat",
    });

    const response = await postStandard(
      standardRequest({ message: "What is photosynthesis?", reasoningMode: "medium" }),
    );
    await response.text();

    expect(mocks.openai.responses.create).toHaveBeenCalledOnce();
    const titleRequest = mocks.openai.responses.create.mock.calls[0]?.[0];
    expect(titleRequest).toMatchObject({ model: "gpt-6-luna" });
    expect(titleRequest).not.toHaveProperty("reasoning");
  });

  it("uses one shared pool across mixed Standard and Web Search usage", async () => {
    const { queries } = setup({ plan: "free", usageCount: 19 });

    const webResponse = await postWebSearch(request());
    expect(webResponse.status).toBe(200);

    const standardResponse = await postStandard(standardRequest());
    expect(standardResponse.status).toBe(403);
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(2);
    expect(queries.usage.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["accepts", 299, 200],
    ["rejects", 300, 403],
  ] as const)("Pro Web Search %s at its unchanged 300-message limit", async (_label, usageCount, status) => {
    const { queries } = setup({ plan: "pro", usageCount });

    const response = await postWebSearch(request());

    expect(response.status).toBe(status);
    if (status === 200) {
      expect(mocks.supabase.rpc).toHaveBeenCalledWith(
        "reserve_daily_usage",
        expect.objectContaining({ p_user_id: USER_ID, p_limit: 300 }),
      );
      expect(mocks.openai.responses.create).toHaveBeenCalledTimes(1);
    } else {
      expect(queries.usage.upsert).not.toHaveBeenCalled();
      expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    }
  });

  it("returns a safe quota-read error without exposing database details", async () => {
    const { queries } = setup({
      plan: "free",
      usageError: { message: "secret quota database detail" },
    });

    const response = await postWebSearch(request());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("USAGE_UNAVAILABLE");
    expect(body).not.toContain("secret quota database detail");
    expect(queries.usage.upsert).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
  });
});
