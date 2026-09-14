import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchGeneratedImage,
  getImageGenerationErrorMessage,
  ImageGenerationClientError,
} from "@/app/chat/ChatClient";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");

describe("chat image-generation mode", () => {
  it("posts only the prompt and turns an accepted image response into a blob URL", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url).toBe("/api/image-generation");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: "A quiet mountain lake" });

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
      fetchGeneratedImage("A quiet mountain lake", { fetcher, createObjectUrl })
    ).resolves.toEqual({
      url: "blob:image-generation-test",
      mimeType: "image/webp",
      provider: "replicate",
      model: "black-forest-labs/flux-schnell",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
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

    await expect(fetchGeneratedImage("A prompt", { fetcher })).rejects.toEqual(
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

    await expect(fetchGeneratedImage("A prompt", { fetcher })).rejects.toEqual(
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
    expect(clientSource).toContain("generatedImage?: GeneratedImage;");
    expect(clientSource).toContain("URL.revokeObjectURL(url)");
    expect(clientSource).toContain("<NextImage");
  });

  it("keeps Standard and Web Search on their existing endpoints", () => {
    expect(clientSource).toContain('const endpoint = useWebSearch ? "/api/chat-web" : "/api/chat"');
    expect(clientSource).toContain('fetcher("/api/image-generation"');
    expect(clientSource).toContain('mode: useWebSearch ? "web_search" : "standard"');
  });

  it("maps status codes through the same safe error table used by the request helper", () => {
    expect(getImageGenerationErrorMessage(500)).toBe(
      "Image generation is not configured right now."
    );
    expect(new ImageGenerationClientError("network", "safe")).toBeInstanceOf(Error);
  });
});
