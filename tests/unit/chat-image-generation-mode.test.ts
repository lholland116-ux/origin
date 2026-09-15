import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchGeneratedImage,
  downloadGeneratedImage,
  getImageGenerationErrorMessage,
  getImageGenerationQuotaMessage,
  ImageGenerationClientError,
  normalizeInitialMessages,
  reconcileGeneratedImageMessages,
  resolveGeneratedImagePrompt,
  shouldRevokeGeneratedImageUrl,
} from "@/app/chat/ChatClient";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

describe("chat image-generation mode", () => {
  it("posts only the conversation envelope and prompt, then turns an accepted image response into a blob URL", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url).toBe("/api/image-generation");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({
        conversationId: CONVERSATION_ID,
        prompt: "A quiet mountain lake",
      });

      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "X-LVTChat-Image-Provider": "replicate",
          "X-LVTChat-Image-Model": "black-forest-labs/flux-schnell",
        },
      });
    });
    const createObjectUrl = vi.fn(() => "blob:image-generation-test");

    await expect(
      fetchGeneratedImage("A quiet mountain lake", {
        conversationId: CONVERSATION_ID,
        fetcher,
        createObjectUrl,
      })
    ).resolves.toEqual({
      url: "blob:image-generation-test",
      mimeType: "image/webp",
      provider: "replicate",
      model: "black-forest-labs/flux-schnell",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("reads safe durable IDs without exposing storage paths", async () => {
    const fetcher = vi.fn(async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "X-LVTChat-User-Message-Id": "30000000-0000-4000-8000-000000000001",
          "X-LVTChat-Assistant-Message-Id": "30000000-0000-4000-8000-000000000002",
          "X-LVTChat-Generated-Image-Id": "30000000-0000-4000-8000-000000000003",
          "X-LVTChat-Storage-Path": "must-not-be-consumed",
        },
      })
    );

    await expect(
      fetchGeneratedImage("A prompt", {
        conversationId: CONVERSATION_ID,
        fetcher,
        createObjectUrl: () => "blob:durable-id-test",
      })
    ).resolves.toMatchObject({
      id: "30000000-0000-4000-8000-000000000003",
      userMessageId: "30000000-0000-4000-8000-000000000001",
      assistantMessageId: "30000000-0000-4000-8000-000000000002",
    });
  });

  it("reconciles optimistic image messages without duplicating the durable exchange", () => {
    const messages = [
      { id: "optimistic-user", role: "user" as const, content: "A prompt" },
      { id: "optimistic-assistant", role: "assistant" as const, content: "" },
    ];
    const result = {
      id: "generated-image",
      url: "blob:generated",
      mimeType: "image/webp",
      userMessageId: "durable-user",
      assistantMessageId: "durable-assistant",
    };

    const reconciled = reconcileGeneratedImageMessages(
      messages,
      "optimistic-user",
      "optimistic-assistant",
      result
    );

    expect(reconciled).toHaveLength(2);
    expect(reconciled.map((message) => message.id)).toEqual([
      "durable-user",
      "durable-assistant",
    ]);
    expect(reconciled[1]?.generatedImage).toEqual({
      id: "generated-image",
      url: "blob:generated",
      mimeType: "image/webp",
    });
  });

  it("resolves regeneration from the immediately preceding user prompt only", () => {
    const messages = [
      { id: "user-1", role: "user" as const, content: "First prompt" },
      { id: "assistant-1", role: "assistant" as const, content: "", generatedImage: undefined },
      { id: "user-2", role: "user" as const, content: "Second prompt" },
      { id: "assistant-2", role: "assistant" as const, content: "" },
    ];

    expect(resolveGeneratedImagePrompt(messages, "assistant-1")).toBe("First prompt");
    expect(resolveGeneratedImagePrompt(messages, "assistant-2")).toBe("Second prompt");
    expect(resolveGeneratedImagePrompt(messages, "user-1")).toBeNull();
    expect(
      resolveGeneratedImagePrompt(
        [{ id: "assistant-only", role: "assistant", content: "" }],
        "assistant-only",
      ),
    ).toBeNull();
  });

  it("downloads a durable image through its ID and revokes only the temporary download URL", async () => {
    const generatedImageId = "30000000-0000-4000-8000-000000000003";
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url).toBe(`/api/generated-images/${generatedImageId}/download`);
      expect(init).toMatchObject({ method: "GET", cache: "no-store" });

      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    const createObjectUrl = vi.fn((blob: Blob) => {
      expect(blob.size).toBe(3);
      return "blob:download-test";
    });
    const revokeObjectUrl = vi.fn();
    const click = vi.fn();
    const anchor = {
      click,
      download: "",
      href: "",
      rel: "",
    } as unknown as HTMLAnchorElement;

    await downloadGeneratedImage(generatedImageId, {
      fetcher,
      createObjectUrl,
      createAnchor: () => anchor,
      revokeObjectUrl,
      scheduleObjectUrlRevoke: (callback) => callback(),
    });

    expect(anchor.download).toBe(`lvtchat-image-${generatedImageId}.png`);
    expect(anchor.href).toBe("blob:download-test");
    expect(anchor.rel).toBe("noreferrer");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download-test");
  });

  it("keeps the browser download blob alive until scheduled cleanup", async () => {
    const generatedImageId = "30000000-0000-4000-8000-000000000003";
    const revokeObjectUrl = vi.fn();
    const scheduleObjectUrlRevoke = vi.fn();
    const anchor = {
      click: vi.fn(),
      download: "",
      href: "",
      rel: "",
    } as unknown as HTMLAnchorElement;

    await downloadGeneratedImage(generatedImageId, {
      fetcher: vi.fn(async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      ),
      createObjectUrl: () => "blob:scheduled-download-test",
      createAnchor: () => anchor,
      revokeObjectUrl,
      scheduleObjectUrlRevoke,
    });

    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(scheduleObjectUrlRevoke).toHaveBeenCalledTimes(1);

    const cleanup = scheduleObjectUrlRevoke.mock.calls[0]?.[0];
    cleanup?.();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:scheduled-download-test");
  });

  it("uses the native Android save path without creating a browser download URL", async () => {
    const generatedImageId = "30000000-0000-4000-8000-000000000003";
    const nativeSave = vi.fn(async () => undefined);
    const createObjectUrl = vi.fn(() => "blob:should-not-be-created");

    await downloadGeneratedImage(generatedImageId, {
      fetcher: vi.fn(async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      ),
      createObjectUrl,
      nativeSave,
    });

    expect(nativeSave).toHaveBeenCalledWith({
      base64: "AQID",
      fileName: `lvtchat-image-${generatedImageId}.png`,
      mimeType: "image/png",
    });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("revokes transient blob URLs but never durable signed URLs", () => {
    expect(shouldRevokeGeneratedImageUrl("blob:temporary")).toBe(true);
    expect(shouldRevokeGeneratedImageUrl("https://signed.example/image.webp")).toBe(false);
  });

  it("preserves signed generated-image history during client normalization", () => {
    const normalized = normalizeInitialMessages([
      {
        id: "30000000-0000-4000-8000-000000000002",
        role: "assistant",
        content: "",
        generatedImage: {
          id: "30000000-0000-4000-8000-000000000003",
          url: "https://signed.example/generated.webp",
          mimeType: "image/webp",
          provider: "replicate",
          model: "black-forest-labs/flux-schnell",
        },
      },
    ]);

    expect(normalized[0]?.generatedImage).toMatchObject({
      id: "30000000-0000-4000-8000-000000000003",
      url: "https://signed.example/generated.webp",
    });
  });

  it("rejects a successful response that is not an image", async () => {
    const fetcher = vi.fn(async () =>
      new Response("not an image", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(
      fetchGeneratedImage("A prompt", {
        conversationId: CONVERSATION_ID,
        fetcher,
        createObjectUrl: () => "blob:should-not-be-created",
      })
    ).rejects.toMatchObject({
      code: "invalid_response",
      message: "Image generation returned an invalid image. Please try again.",
    });
  });

  it.each([
    [400, "Please enter a valid image prompt."],
    [401, "Your session has expired. Please sign in again."],
    [413, "That image request is too large. Please shorten the prompt."],
    [415, "Image generation requires a JSON request."],
    [500, "Image generation is not configured right now."],
    [502, "Image generation is temporarily unavailable. Please try again."],
  ])("maps HTTP %s to a safe user-facing error", async (status, message) => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "INTERNAL", message: "provider secret" } }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(
      fetchGeneratedImage("A prompt", { conversationId: CONVERSATION_ID, fetcher })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "http",
        status,
        message,
      })
    );
    expect(message).not.toContain("provider secret");
  });

  it("converts network failures to a safe error without retrying", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("provider secret");
    });

    await expect(
      fetchGeneratedImage("A prompt", { conversationId: CONVERSATION_ID, fetcher })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "network",
        message: "Could not reach image generation. Please try again.",
      })
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("exposes the explicit Image mode, generating placeholder, and transient URL cleanup", () => {
    expect(clientSource).toContain("const [useImageGeneration, setUseImageGeneration] = useState(false);");
    expect(clientSource).toContain("Generate an image from your prompt");
    expect(clientSource).toContain("Generating image…");
    expect(clientSource).toContain('fetchGeneratedImage(effectiveMessage');
    expect(clientSource).toContain("conversationId,");
    expect(clientSource).toContain("generatedImage?: GeneratedImage;");
    expect(clientSource).toContain("URL.revokeObjectURL(url)");
    expect(clientSource).toContain("<NextImage");
    expect(clientSource).toContain('aria-label="Download image"');
    expect(clientSource).toContain('aria-label="Regenerate image"');
    expect(clientSource).toContain('content="Download image"');
    expect(clientSource).toContain('content={isRegeneratingImage ? "Regenerating image…" : "Regenerate image"}');
    expect(clientSource).toContain("/api/generated-images/");
    expect(clientSource).toContain("message.role === \"assistant\" && message.generatedImage?.id");
  });

  it("keeps Standard and Web Search on their existing endpoints", () => {
    expect(clientSource).toContain('const endpoint = useWebSearch ? "/api/chat-web" : "/api/chat"');
    expect(clientSource).toContain('fetcher("/api/image-generation"');
    expect(clientSource).toContain('mode: useWebSearch ? "web_search" : "standard"');
  });

  it("allows Free users to select Web Search without a Pro entitlement gate", () => {
    const modeHandlerStart = clientSource.indexOf("function handleModeChange");
    const modeHandlerEnd = clientSource.indexOf("function handleImageModeChange", modeHandlerStart);
    const modeHandlerSource = clientSource.slice(modeHandlerStart, modeHandlerEnd);

    expect(modeHandlerSource).toContain("setUseWebSearch(nextUseWebSearch)");
    expect(modeHandlerSource).not.toContain('plan !== "pro"');
    expect(modeHandlerSource).not.toContain("PRO_REQUIRED");
  });

  it("maps status codes through the same safe error table used by the request helper", () => {
    expect(getImageGenerationErrorMessage(500)).toBe(
      "Image generation is not configured right now."
    );
    expect(new ImageGenerationClientError("network", "safe")).toBeInstanceOf(Error);
  });

  it.each([
    ["free", "daily", "Daily image limit reached. Come back tomorrow or upgrade to Pro."],
    ["pro", "daily", "Daily image limit reached. Come back tomorrow."],
    ["free", "monthly", "Monthly image limit reached. Come back next month or upgrade to Pro."],
    ["pro", "monthly", "Monthly image limit reached. Come back next month."],
  ] as const)("uses plan-aware %s %s image-quota wording", (plan, window, message) => {
    expect(getImageGenerationQuotaMessage(plan, window)).toBe(message);
    expect(message).not.toContain("P0001");
  });

  it.each([
    ["free", "IMAGE_DAILY_LIMIT_REACHED", "Daily image limit reached. Come back tomorrow or upgrade to Pro."],
    ["pro", "IMAGE_DAILY_LIMIT_REACHED", "Daily image limit reached. Come back tomorrow."],
    ["free", "IMAGE_MONTHLY_LIMIT_REACHED", "Monthly image limit reached. Come back next month or upgrade to Pro."],
    ["pro", "IMAGE_MONTHLY_LIMIT_REACHED", "Monthly image limit reached. Come back next month."],
  ] as const)("maps %s %s to the matching safe client message", (plan, code, message) => {
    expect(getImageGenerationErrorMessage(429, code, plan)).toBe(message);
    expect(message).not.toContain("P0001");
  });
});
