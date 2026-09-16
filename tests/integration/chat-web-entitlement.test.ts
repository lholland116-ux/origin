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
};

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as MockSupabase,
  openai: {
    responses: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/openai", () => ({ openai: mocks.openai }));

vi.mock("../../lib/documents/prepare-context", () => ({
  buildDocumentContext: vi.fn(async () => ""),
  DocumentContextLimitError: class DocumentContextLimitError extends Error {},
}));

vi.mock("../../lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test system prompt" }));

vi.mock("../../lib/utils", () => ({
  buildConversationTitle: vi.fn(() => "Generated title"),
}));

import { POST as postStandard } from "../../app/api/chat/route";
import { POST as postWebSearch } from "../../app/api/chat-web/route";

function query(config: {
  awaitResult: QueryResult;
  maybeSingleResult?: QueryResult;
  singleResult?: QueryResult;
  insertResult?: QueryResult;
}) {
  const queryBuilder = {} as MockQuery;

  queryBuilder.select = vi.fn(() => queryBuilder);
  queryBuilder.eq = vi.fn(() => queryBuilder);
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
  plan?: "free" | "pro";
  usageCount?: number;
  usageError?: unknown;
}) {
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
      awaitResult: { data: { plan: params.plan ?? "free" }, error: null },
    }),
    conversations: query({
      awaitResult: { data: { error: null }, error: null },
      singleResult: {
        data: {
          id: CONVERSATION_ID,
          user_id: USER_ID,
          title: "Existing conversation",
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
  };

  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) => queries[table as keyof typeof queries]),
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

  return { queries };
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
    expect(queries.usage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, message_count: 1 }),
      { onConflict: "user_id,date" },
    );
    expect(queries.usage.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.create).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
    );
    expect(JSON.stringify(body)).not.toContain("PRO_REQUIRED");
  });

  it("accepts Free Web Search at 19 of 20 messages", async () => {
    const { queries } = setup({ plan: "free", usageCount: 19 });

    const response = await postWebSearch(request());

    expect(response.status).toBe(200);
    expect(queries.usage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ message_count: 20 }),
      { onConflict: "user_id,date" },
    );
  });

  it("rejects Free Web Search at the shared 20-message limit before model execution", async () => {
    const { queries } = setup({ plan: "free", usageCount: 20 });

    const response = await postWebSearch(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "LIMIT_REACHED", plan: "free", limit: 20 });
    expect(queries.usage.upsert).not.toHaveBeenCalled();
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
    expect(queries.usage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ message_count: 20 }),
      { onConflict: "user_id,date" },
    );
    expect(queries.usage.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.stream).toHaveBeenCalledTimes(1);
    expect(mocks.openai.responses.stream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
    );
  });

  it("uses one shared pool across mixed Standard and Web Search usage", async () => {
    const { queries } = setup({ plan: "free", usageCount: 19 });

    const webResponse = await postWebSearch(request());
    expect(webResponse.status).toBe(200);

    queries.usage.maybeSingle.mockResolvedValue({
      data: { message_count: 20 },
      error: null,
    });

    const standardResponse = await postStandard(standardRequest());
    expect(standardResponse.status).toBe(403);
    expect(queries.usage.upsert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["accepts", 299, 200],
    ["rejects", 300, 403],
  ] as const)("Pro Web Search %s at its unchanged 300-message limit", async (_label, usageCount, status) => {
    const { queries } = setup({ plan: "pro", usageCount });

    const response = await postWebSearch(request());

    expect(response.status).toBe(status);
    if (status === 200) {
      expect(queries.usage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ message_count: 300 }),
        { onConflict: "user_id,date" },
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
    expect(body).toContain("Failed to read usage.");
    expect(body).not.toContain("secret quota database detail");
    expect(queries.usage.upsert).not.toHaveBeenCalled();
  });
});
