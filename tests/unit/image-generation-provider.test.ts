import { describe, expect, it } from "vitest";
import {
  IMAGE_GENERATION_DEFAULT_MODEL,
  IMAGE_GENERATION_DEFAULT_PROVIDER,
  IMAGE_GENERATION_PROMPT_MAX_LENGTH,
} from "@/lib/image-generation/config";
import { validateImageGenerationRequest } from "@/lib/image-generation/validation";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "@/lib/image-generation/provider";

describe("image-generation foundation", () => {
  it("exposes the approved provider-neutral defaults", () => {
    expect(IMAGE_GENERATION_DEFAULT_PROVIDER).toBe("replicate");
    expect(IMAGE_GENERATION_DEFAULT_MODEL).toBe("flux-schnell");
    expect(IMAGE_GENERATION_PROMPT_MAX_LENGTH).toBe(4000);
  });

  it("supports a provider-neutral provider contract without making a provider call", async () => {
    const request: ImageGenerationRequest = { prompt: "A mountain lake" };
    const provider: ImageGenerationProvider = {
      async generateImage(generationRequest) {
        return {
          provider: "test-provider",
          model: generationRequest.model ?? "test-model",
          mimeType: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
        };
      },
    };

    await expect(provider.generateImage(request)).resolves.toMatchObject({
      provider: "test-provider",
      model: "test-model",
      mimeType: "image/png",
    });
  });

  it("accepts a valid request and preserves stable optional fields", () => {
    expect(
      validateImageGenerationRequest({
        prompt: "A red cabin beside a lake",
        model: "flux-schnell",
        width: 1024,
        height: 768,
        aspectRatio: "4:3",
        quality: "standard",
        seed: 42,
      }),
    ).toEqual({
      success: true,
      request: {
        prompt: "A red cabin beside a lake",
        model: "flux-schnell",
        width: 1024,
        height: 768,
        aspectRatio: "4:3",
        quality: "standard",
        seed: 42,
      },
    });
  });

  it("rejects a blank prompt", () => {
    const result = validateImageGenerationRequest({ prompt: " \n\t" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        field: "prompt",
        message: "prompt must be a non-empty string",
      });
    }
  });

  it("rejects an empty prompt", () => {
    const result = validateImageGenerationRequest({ prompt: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        field: "prompt",
        message: "prompt must be a non-empty string",
      });
    }
  });

  it("accepts a prompt at the exact application limit", () => {
    const prompt = "x".repeat(4000);

    expect(prompt).toHaveLength(4000);
    expect(validateImageGenerationRequest({ prompt })).toEqual({
      success: true,
      request: { prompt },
    });
  });

  it("rejects a prompt over the application limit", () => {
    const result = validateImageGenerationRequest({
      prompt: "x".repeat(IMAGE_GENERATION_PROMPT_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        field: "prompt",
        message: "prompt must be 4000 characters or fewer",
      });
    }
  });

  it("rejects malformed numeric fields", () => {
    const result = validateImageGenerationRequest({
      prompt: "A city skyline",
      width: 0,
      height: 768.5,
      seed: 1.25,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.field)).toEqual([
        "width",
        "height",
        "seed",
      ]);
    }
  });

  it("rejects negative and non-finite dimensions and seeds", () => {
    const invalidRequests = [
      { request: { prompt: "A city skyline", width: -1 }, field: "width" },
      { request: { prompt: "A city skyline", height: -1 }, field: "height" },
      { request: { prompt: "A city skyline", width: NaN }, field: "width" },
      { request: { prompt: "A city skyline", height: NaN }, field: "height" },
      {
        request: { prompt: "A city skyline", width: Infinity },
        field: "width",
      },
      {
        request: { prompt: "A city skyline", height: Infinity },
        field: "height",
      },
      { request: { prompt: "A city skyline", seed: NaN }, field: "seed" },
      {
        request: { prompt: "A city skyline", seed: Infinity },
        field: "seed",
      },
    ] as const;

    for (const { request, field } of invalidRequests) {
      const result = validateImageGenerationRequest(request);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues.map((issue) => issue.field)).toContain(field);
      }
    }
  });

  it("rejects malformed optional fields and non-object requests", () => {
    const malformedFields = validateImageGenerationRequest({
      prompt: "A forest",
      model: null,
      aspectRatio: 1,
      quality: "",
    });
    const malformedRequest = validateImageGenerationRequest(null);

    expect(malformedFields.success).toBe(false);
    if (!malformedFields.success) {
      expect(malformedFields.issues.map((issue) => issue.field)).toEqual([
        "model",
        "aspectRatio",
        "quality",
      ]);
    }
    expect(malformedRequest).toEqual({
      success: false,
      issues: [{ field: "request", message: "request must be an object" }],
    });
  });
});
