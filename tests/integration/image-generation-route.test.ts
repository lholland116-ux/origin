import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const ASSISTANT_MESSAGE_ID = "30000000-0000-4000-8000-000000000002";
const GENERATED_IMAGE_ID = "30000000-0000-4000-8000-000000000003";

const mocks = vi.hoisted(() => ({
  providerGenerateImage: vi.fn(),
  providerConstructed: vi.fn(),
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
  admin: {
    storage: {
      from: vi.fn(),
    },
  },
  conversationQuery: null as unknown as { maybeSingle: ReturnType<typeof vi.fn> },
  storage: null as unknown as {
    upload: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

vi.mock(
  "../../lib/image-generation/providers/replicate-flux-schnell",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../lib/image-generation/providers/replicate-flux-schnell")
    >("../../lib/image-generation/providers/replicate-flux-schnell");

    class MockProvider {
      constructor() {
        mocks.providerConstructed();
      }

      generateImage(request: unknown) {
        return mocks.providerGenerateImage(request);
      }
    }

    return {
      ...actual,
      ReplicateFluxSchnellProvider: MockProvider,
    };
  },
);

import { POST } from "../../app/api/image-generation/route";
import {
  ReplicateFluxSchnellProviderError,
} from "../../lib/image-generation/providers/replicate-flux-schnell";

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  const finalBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? { conversationId: CONVERSATION_ID, ...body }
      : body;

  return new Request("http://localhost/api/image-generation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body: typeof finalBody === "string" ? finalBody : JSON.stringify(finalBody),
  });
}

function requestWithoutConversation(body: unknown): Request {
  return new Request("http://localhost/api/image-generation", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function responseJson(response: Response) {
  return response.json() as Promise<{
    error?: { code?: string; message?: string };
  }>;
}

function successfulProviderResult() {
  return {
    provider: "replicate",
    model: "flux-schnell",
    mimeType: "image/webp",
    bytes: new Uint8Array([1, 2, 3, 255]),
  };
}

describe("POST /api/image-generation", () => {
  beforeEach(() => {
    mocks.providerGenerateImage.mockReset();
    mocks.providerConstructed.mockReset();
    mocks.supabase.auth.getUser.mockReset();
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    const conversationQuery = {} as {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
    };
    conversationQuery.select = vi.fn(() => conversationQuery);
    conversationQuery.eq = vi.fn(() => conversationQuery);
    conversationQuery.maybeSingle = vi.fn(async () => ({
      data: { id: CONVERSATION_ID },
      error: null,
    }));
    mocks.conversationQuery = conversationQuery;
    mocks.supabase.from.mockReset();
    mocks.supabase.from.mockReturnValue(conversationQuery);
    mocks.supabase.rpc.mockReset();
    mocks.supabase.rpc.mockResolvedValue({
      data: [
        {
          user_message_id: USER_MESSAGE_ID,
          assistant_message_id: ASSISTANT_MESSAGE_ID,
          generated_image_id: GENERATED_IMAGE_ID,
        },
      ],
      error: null,
    });
    const storage = {
      upload: vi.fn(async () => ({ data: { path: "generated/path.webp" }, error: null })),
      remove: vi.fn(async () => ({ data: [], error: null })),
    };
    mocks.storage = storage;
    mocks.admin.storage.from.mockReset();
    mocks.admin.storage.from.mockReturnValue(storage);
    mocks.providerGenerateImage.mockResolvedValue(successfulProviderResult());
  });

  it("rejects unauthenticated requests with 401", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(401);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
    expect(mocks.providerGenerateImage).not.toHaveBeenCalled();
  });

  it("rejects a wrong Content-Type", async () => {
    const response = await POST(
      request({ prompt: "A mountain lake" }, { "Content-Type": "text/plain" }),
    );

    expect(response.status).toBe(415);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(request("{\"prompt\":", {
      "Content-Type": "application/json",
    }));

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "INVALID_JSON" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("requires a conversationId", async () => {
    const response = await POST(requestWithoutConversation({ prompt: "A mountain lake" }));

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.providerGenerateImage).not.toHaveBeenCalled();
  });

  it("rejects a malformed conversationId before provider execution", async () => {
    const response = await POST(
      request({ conversationId: "not-a-uuid", prompt: "A mountain lake" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.providerGenerateImage).not.toHaveBeenCalled();
  });

  it("rejects an unowned conversation before provider execution", async () => {
    mocks.conversationQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(404);
    expect(mocks.providerGenerateImage).not.toHaveBeenCalled();
  });

  it("rejects non-object JSON", async () => {
    const response = await POST(request("[]"));

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it.each([
    ["empty prompt", ""],
    ["whitespace-only prompt", " \n\t"],
  ])("rejects %s", async (_label, prompt) => {
    const response = await POST(request({ prompt }));

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("rejects a prompt over 4000 characters", async () => {
    const response = await POST(request({ prompt: "x".repeat(4001) }));

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("accepts a valid minimum request and reaches the provider", async () => {
    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(200);
    expect(mocks.providerConstructed).toHaveBeenCalledOnce();
    expect(mocks.providerGenerateImage).toHaveBeenCalledWith({
      prompt: "A mountain lake",
    });
  });

  it("accepts a prompt at exactly 4000 characters", async () => {
    const prompt = "x".repeat(4000);
    const response = await POST(request({ prompt }));

    expect(response.status).toBe(200);
    expect(mocks.providerGenerateImage).toHaveBeenCalledWith({ prompt });
  });

  it("accepts an omitted model", async () => {
    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(200);
    expect(mocks.providerGenerateImage).toHaveBeenCalledOnce();
  });

  it("accepts the application model identifier", async () => {
    const response = await POST(
      request({ prompt: "A mountain lake", model: "flux-schnell" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.providerGenerateImage).toHaveBeenCalledWith({
      prompt: "A mountain lake",
      model: "flux-schnell",
    });
  });

  it("rejects an unsupported model before provider execution", async () => {
    const response = await POST(
      request({ prompt: "A mountain lake", model: "another-model" }),
    );

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
    expect(mocks.providerGenerateImage).not.toHaveBeenCalled();
  });

  it.each(["width", "height", "quality"])(
    "rejects unsupported %s before provider execution",
    async (field) => {
      const response = await POST(
        request({ prompt: "A mountain lake", [field]: field === "quality" ? "high" : 1024 }),
      );

      expect(response.status).toBe(400);
      expect(await responseJson(response)).toMatchObject({
        error: { code: "UNSUPPORTED_FIELD" },
      });
      expect(mocks.providerConstructed).not.toHaveBeenCalled();
      expect(mocks.providerGenerateImage).not.toHaveBeenCalled();
    },
  );

  it("rejects other unknown fields before provider execution", async () => {
    const response = await POST(
      request({ prompt: "A mountain lake", extra: true }),
    );

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "UNSUPPORTED_FIELD" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("forwards aspectRatio", async () => {
    const response = await POST(
      request({ prompt: "A mountain lake", aspectRatio: "16:9" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.providerGenerateImage).toHaveBeenCalledWith({
      prompt: "A mountain lake",
      aspectRatio: "16:9",
    });
  });

  it("forwards seed", async () => {
    const response = await POST(
      request({ prompt: "A mountain lake", seed: 42 }),
    );

    expect(response.status).toBe(200);
    expect(mocks.providerGenerateImage).toHaveBeenCalledWith({
      prompt: "A mountain lake",
      seed: 42,
    });
  });

  it("rejects a request exceeding the 16 KiB body limit", async () => {
    const response = await POST(request({ prompt: "x".repeat(20_000) }));

    expect(response.status).toBe(413);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const response = await POST(
      request({ prompt: "A mountain lake" }, { "Content-Length": "20000" }),
    );

    expect(response.status).toBe(413);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
    });
    expect(mocks.providerConstructed).not.toHaveBeenCalled();
  });

  it("maps provider configuration failure to a controlled 500", async () => {
    mocks.providerGenerateImage.mockRejectedValue(
      new ReplicateFluxSchnellProviderError(
        "configuration",
        "REPLICATE_API_TOKEN is required for image generation",
      ),
    );

    const response = await POST(request({ prompt: "A mountain lake" }));
    const body = await responseJson(response);

    expect(response.status).toBe(500);
    expect(body.error?.code).toBe("IMAGE_GENERATION_CONFIGURATION");
    expect(JSON.stringify(body)).not.toContain("REPLICATE_API_TOKEN");
  });

  it("maps provider generation failure to a controlled 502", async () => {
    mocks.providerGenerateImage.mockRejectedValue(
      new ReplicateFluxSchnellProviderError(
        "provider_failure",
        "Replicate response body should not escape",
      ),
    );

    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(502);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "IMAGE_GENERATION_PROVIDER" },
    });
    expect(mocks.storage.upload).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
  });

  it("maps invalid provider output to a controlled 502", async () => {
    mocks.providerGenerateImage.mockRejectedValue(
      new ReplicateFluxSchnellProviderError(
        "invalid_output",
        "Unexpected provider output should not escape",
      ),
    );

    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(502);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "INVALID_PROVIDER_OUTPUT" },
    });
  });

  it("returns exact generated bytes and required success headers", async () => {
    const generated = successfulProviderResult();
    mocks.providerGenerateImage.mockResolvedValue(generated);

    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-LVTChat-Image-Provider")).toBe("replicate");
    expect(response.headers.get("X-LVTChat-Image-Model")).toBe("flux-schnell");
    expect(response.headers.get("X-LVTChat-User-Message-Id")).toBe(USER_MESSAGE_ID);
    expect(response.headers.get("X-LVTChat-Assistant-Message-Id")).toBe(ASSISTANT_MESSAGE_ID);
    expect(response.headers.get("X-LVTChat-Generated-Image-Id")).toBe(GENERATED_IMAGE_ID);
    expect(response.headers.get("X-LVTChat-Storage-Path")).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1,
      2,
      3,
      255,
    ]);
  });

  it("uploads one server-scoped non-overwriting object before atomic persistence", async () => {
    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(200);
    expect(mocks.providerGenerateImage).toHaveBeenCalledOnce();
    expect(mocks.storage.upload).toHaveBeenCalledOnce();
    const [path, bytes, options] = mocks.storage.upload.mock.calls[0] as [
      string,
      Uint8Array,
      { contentType: string; upsert: boolean },
    ];
    expect(path).toMatch(
      new RegExp(`^generated/${USER_ID}/${CONVERSATION_ID}/[0-9a-f-]+\\.webp$`),
    );
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255]);
    expect(options).toMatchObject({ contentType: "image/webp", upsert: false });
    expect(mocks.supabase.rpc).toHaveBeenCalledOnce();
    expect(mocks.supabase.rpc.mock.calls[0]?.[0]).toBe(
      "create_generated_image_chat_exchange",
    );
    expect(mocks.supabase.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_conversation_id: CONVERSATION_ID,
      p_content: "A mountain lake",
      p_mime_type: "image/webp",
      p_provider: "replicate",
      p_model: "flux-schnell",
    });
    expect(JSON.stringify(mocks.supabase.rpc.mock.calls[0]?.[1])).not.toContain(
      "data:image",
    );
  });

  it("does not persist or retry when Storage upload fails", async () => {
    mocks.storage.upload.mockResolvedValueOnce({
      data: null,
      error: { message: "Storage unavailable." },
    });

    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(500);
    expect(mocks.providerGenerateImage).toHaveBeenCalledOnce();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.storage.remove).not.toHaveBeenCalled();
  });

  it("cleans up the uploaded object when atomic persistence fails without retrying", async () => {
    mocks.supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Database unavailable." },
    });

    const response = await POST(request({ prompt: "A mountain lake" }));

    expect(response.status).toBe(500);
    expect(mocks.providerGenerateImage).toHaveBeenCalledOnce();
    expect(mocks.storage.upload).toHaveBeenCalledOnce();
    expect(mocks.storage.remove).toHaveBeenCalledOnce();
    expect(mocks.providerGenerateImage).toHaveBeenCalledTimes(1);
  });

  it("does not expose an unexpected internal provider error", async () => {
    mocks.providerGenerateImage.mockRejectedValue(
      new Error("provider secret or raw response body"),
    );

    const response = await POST(request({ prompt: "A mountain lake" }));
    const body = await responseJson(response);

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("provider secret");
    expect(JSON.stringify(body)).not.toContain("raw response body");
  });
});
