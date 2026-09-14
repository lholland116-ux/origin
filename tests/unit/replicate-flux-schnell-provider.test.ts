import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REPLICATE_FLUX_SCHNELL_MODEL,
  ReplicateFluxSchnellProvider,
  ReplicateFluxSchnellProviderError,
  type ReplicateRunner,
} from "@/lib/image-generation/providers/replicate-flux-schnell";

function createFileOutput(
  bytes = new Uint8Array([1, 2, 3]),
  mimeType = "image/webp",
): unknown {
  return {
    blob: async () => new Blob([bytes], { type: mimeType }),
  };
}

function createBlobLike(
  bytes: Uint8Array,
  mimeType?: string,
): unknown {
  return {
    size: bytes.byteLength,
    type: mimeType,
    arrayBuffer: async () => bytes.buffer,
  };
}

function createTestProvider(output: unknown = [createFileOutput()]) {
  const calls: Array<{
    model: string;
    input: Record<string, unknown>;
  }> = [];
  const runner: ReplicateRunner = async (model, options) => {
    calls.push({ model, input: options.input });
    return output;
  };

  return {
    provider: new ReplicateFluxSchnellProvider({ runner }),
    calls,
  };
}

function expectInvalidRequest(
  provider: ReplicateFluxSchnellProvider,
  request: Parameters<ReplicateFluxSchnellProvider["generateImage"]>[0],
) {
  return expect(provider.generateImage(request)).rejects.toMatchObject({
    code: "invalid_request",
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Replicate FLUX Schnell provider", () => {
  it("uses the authoritative Replicate model identifier", async () => {
    const { provider, calls } = createTestProvider();

    await provider.generateImage({ prompt: "A mountain lake" });

    expect(calls[0]?.model).toBe("black-forest-labs/flux-schnell");
    expect(REPLICATE_FLUX_SCHNELL_MODEL).toBe(
      "black-forest-labs/flux-schnell",
    );
  });

  it("maps the minimum request to the verified FLUX Schnell input", async () => {
    const { provider, calls } = createTestProvider();

    await provider.generateImage({ prompt: "A mountain lake" });

    expect(calls[0]?.input).toEqual({
      prompt: "A mountain lake",
      num_outputs: 1,
      go_fast: true,
      megapixels: "1",
      output_format: "webp",
      output_quality: 80,
      num_inference_steps: 4,
      aspect_ratio: "1:1",
    });
  });

  it("forwards an explicit aspect ratio", async () => {
    const { provider, calls } = createTestProvider();

    await provider.generateImage({
      prompt: "A mountain lake",
      aspectRatio: "16:9",
    });

    expect(calls[0]?.input.aspect_ratio).toBe("16:9");
  });

  it("forwards an explicit seed", async () => {
    const { provider, calls } = createTestProvider();

    await provider.generateImage({ prompt: "A mountain lake", seed: 42 });

    expect(calls[0]?.input.seed).toBe(42);
  });

  it("omits seed when it is absent", async () => {
    const { provider, calls } = createTestProvider();

    await provider.generateImage({ prompt: "A mountain lake" });

    expect("seed" in (calls[0]?.input ?? {})).toBe(false);
  });

  it("accepts the application model identifier", async () => {
    const { provider, calls } = createTestProvider();

    await provider.generateImage({
      prompt: "A mountain lake",
      model: "flux-schnell",
    });

    expect(calls).toHaveLength(1);
  });

  it("rejects an unsupported model before provider execution", async () => {
    const { provider, calls } = createTestProvider();

    await expectInvalidRequest(provider, {
      prompt: "A mountain lake",
      model: "another-model",
    });

    expect(calls).toHaveLength(0);
  });

  it("rejects width before provider execution", async () => {
    const { provider, calls } = createTestProvider();

    await expectInvalidRequest(provider, {
      prompt: "A mountain lake",
      width: 1024,
    });

    expect(calls).toHaveLength(0);
  });

  it("rejects height before provider execution", async () => {
    const { provider, calls } = createTestProvider();

    await expectInvalidRequest(provider, {
      prompt: "A mountain lake",
      height: 1024,
    });

    expect(calls).toHaveLength(0);
  });

  it("rejects quality before provider execution", async () => {
    const { provider, calls } = createTestProvider();

    await expectInvalidRequest(provider, {
      prompt: "A mountain lake",
      quality: "high",
    });

    expect(calls).toHaveLength(0);
  });

  it("converts a successful FileOutput to Uint8Array bytes", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const { provider } = createTestProvider([createFileOutput(bytes)]);

    const result = await provider.generateImage({ prompt: "A mountain lake" });

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.bytes)).toEqual([10, 20, 30, 40]);
  });

  it("normalizes available MIME type information", async () => {
    const { provider } = createTestProvider([
      createBlobLike(new Uint8Array([1, 2]), "IMAGE/PNG"),
    ]);

    const result = await provider.generateImage({ prompt: "A mountain lake" });

    expect(result.mimeType).toBe("image/png");
  });

  it("uses image/webp when MIME type information is unavailable", async () => {
    const { provider } = createTestProvider([
      createBlobLike(new Uint8Array([1, 2])),
    ]);

    const result = await provider.generateImage({ prompt: "A mountain lake" });

    expect(result.mimeType).toBe("image/webp");
  });

  it("rejects empty provider output", async () => {
    const { provider } = createTestProvider([]);

    await expect(provider.generateImage({ prompt: "A mountain lake" })).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("rejects multiple provider outputs", async () => {
    const { provider } = createTestProvider([
      createFileOutput(),
      createFileOutput(),
    ]);

    await expect(provider.generateImage({ prompt: "A mountain lake" })).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("rejects zero-byte output", async () => {
    const { provider } = createTestProvider([
      createBlobLike(new Uint8Array(), "image/webp"),
    ]);

    await expect(provider.generateImage({ prompt: "A mountain lake" })).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("rejects a non-image MIME type", async () => {
    const { provider } = createTestProvider([
      createBlobLike(new Uint8Array([1, 2]), "text/plain"),
    ]);

    await expect(provider.generateImage({ prompt: "A mountain lake" })).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("rejects an unreadable provider output", async () => {
    const { provider } = createTestProvider([
      { blob: async () => { throw new Error("read failed"); } },
    ]);

    await expect(provider.generateImage({ prompt: "A mountain lake" })).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("surfaces provider failures as controlled server-side errors", async () => {
    const runner: ReplicateRunner = async () => {
      throw new Error("provider internals should not escape");
    };
    const provider = new ReplicateFluxSchnellProvider({ runner });

    await expect(provider.generateImage({ prompt: "A mountain lake" }))
      .rejects.toEqual(
        expect.objectContaining({
          code: "provider_failure",
          message: "Replicate image generation failed",
        }),
      );
  });

  it("fails safely when the real client has no API token", () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "");

    expect(() => new ReplicateFluxSchnellProvider()).toThrow(
      new ReplicateFluxSchnellProviderError(
        "configuration",
        "REPLICATE_API_TOKEN is required for image generation",
      ),
    );
  });
});
