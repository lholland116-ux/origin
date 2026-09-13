import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

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
};

type MockSupabase = {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
  rpc: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as MockSupabase,
  openai: {
    responses: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/openai", () => ({ openai: mocks.openai }));

vi.mock("../../lib/documents/prepare-context", () => ({
  buildDocumentContext: vi.fn(() => ""),
}));

vi.mock("../../lib/utils", () => ({
  buildConversationTitle: vi.fn(() => "Test conversation"),
}));

vi.mock("../../lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test system prompt" }));

import { POST } from "../../app/api/chat/route";

function queryResult(data: unknown, error: unknown = null) {
  const query = {} as MockQuery;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data, error }));
  query.single = vi.fn(async () => ({ data, error }));
  query.insert = vi.fn(async () => ({ data: null, error }));
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);

  return query;
}

function setupSupabase(params: {
  plan?: string | null;
  storageError?: { statusCode?: string } | null;
}) {
  const fromCalls: string[] = [];
  const queries = {
    conversations: queryResult({
      id: CONVERSATION_ID,
      user_id: USER_ID,
      title: "Existing conversation",
    }),
    profiles: queryResult({ plan: params.plan ?? "free" }),
    usage: queryResult({ message_count: 0 }),
  };

  const storageCreateSignedUrl = vi.fn(async () => ({
    data: params.storageError ? null : { signedUrl: "https://signed.example/image" },
    error: params.storageError,
  }));

  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return queries[table as keyof typeof queries] ?? queryResult(null);
    }),
    storage: {
      from: vi.fn(() => ({ createSignedUrl: storageCreateSignedUrl })),
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };

  return { fromCalls, storageCreateSignedUrl };
}

function request(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: CONVERSATION_ID,
        message: "Review these images.",
        ...body,
      }),
    })
  );
}

function image(name: string) {
  return {
    imagePath: `${USER_ID}/${name}`,
    imageName: name,
  };
}

describe("POST /api/chat stored image validation", () => {
  beforeEach(() => {
    mocks.openai.responses.stream.mockReset();
    mocks.openai.responses.create.mockReset();
  });

  it("rejects mixed legacy and stored image inputs before database work", async () => {
    const { fromCalls } = setupSupabase({});
    const response = await request({
      imageBase64: "data:image/jpeg;base64,encoded",
      images: [image("one.jpg")],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MIXED_IMAGE_INPUT" });
    expect(fromCalls).toEqual([]);
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("rejects Free users above one image before usage or model invocation", async () => {
    const { fromCalls } = setupSupabase({ plan: "free" });
    const response = await request({ images: [image("one.jpg"), image("two.jpg")] });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "IMAGE_LIMIT_EXCEEDED" });
    expect(fromCalls).toEqual(["conversations", "profiles"]);
    expect(mocks.supabase.storage.from).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("fails closed when the stored-image plan is unavailable", async () => {
    const { fromCalls } = setupSupabase({ plan: "unknown" });
    const response = await request({ images: [image("one.jpg")] });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PLAN_UNAVAILABLE" });
    expect(fromCalls).toEqual(["conversations", "profiles"]);
    expect(mocks.supabase.storage.from).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("rejects inaccessible stored images before usage or persistence", async () => {
    const { fromCalls, storageCreateSignedUrl } = setupSupabase({
      plan: "pro",
      storageError: { statusCode: "404" },
    });
    const response = await request({ images: [image("one.jpg")] });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect(storageCreateSignedUrl).toHaveBeenCalledOnce();
    expect(fromCalls).toEqual(["conversations", "profiles"]);
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("rejects stored images during regeneration without changing legacy regeneration", async () => {
    const { fromCalls } = setupSupabase({ plan: "pro" });
    const response = await request({ regenerate: true, images: [image("one.jpg")] });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "REGENERATE_IMAGES_NOT_SUPPORTED",
    });
    expect(fromCalls).toEqual([]);
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });
});
