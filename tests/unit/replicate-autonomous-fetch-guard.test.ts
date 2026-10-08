import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  options: null as null | { fetch?: typeof fetch },
  run: vi.fn(),
}));

vi.mock("replicate", () => ({
  default: class ReplicateMock {
    constructor(options: { fetch?: typeof fetch }) { mocks.options = options; }
    run(...args: unknown[]) { return mocks.run(...args); }
  },
}));

import { ReplicateFluxSchnellProvider } from "@/lib/image-generation/providers/replicate-flux-schnell";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mocks.options = null;
});

describe("autonomous Replicate request guard", () => {
  it("allows one prediction-creation POST and blocks an SDK retry before network dispatch", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "unit-test-token");
    const fetch = vi.fn<typeof globalThis.fetch>(async (...args) => {
      void args;
      return new Response(JSON.stringify({ id: "prediction-test-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const onPredictionId = vi.fn(async () => undefined);
    mocks.run.mockImplementation(async () => {
      const guardedFetch = mocks.options?.fetch;
      if (!guardedFetch) throw new Error("missing injected fetch");
      const url = "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions";
      await guardedFetch(url, { method: "POST" });
      await expect(guardedFetch(url, { method: "POST" })).rejects.toThrow("permits one prediction-creation POST");
      await guardedFetch("https://api.replicate.com/v1/predictions/prediction-test-1", { method: "GET" });
      return [{ blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }) }];
    });

    const provider = new ReplicateFluxSchnellProvider({ onPredictionId });
    await expect(provider.generateImage({ prompt: "A small test image" })).resolves.toMatchObject({
      provider: "replicate",
      model: "flux-schnell",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET"]);
    expect(onPredictionId).toHaveBeenCalledWith("prediction-test-1");
    expect(onPredictionId).toHaveBeenCalledOnce();
  });

  it("attaches the prediction identity and observed output count to malformed multi-output results", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "unit-test-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "prediction-test-many" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })));
    mocks.run.mockImplementation(async () => {
      const guardedFetch = mocks.options?.fetch;
      if (!guardedFetch) throw new Error("missing injected fetch");
      await guardedFetch("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions", { method: "POST" });
      return [
        { blob: async () => new Blob([new Uint8Array([1])], { type: "image/webp" }) },
        { blob: async () => new Blob([new Uint8Array([2])], { type: "image/webp" }) },
      ];
    });

    const provider = new ReplicateFluxSchnellProvider({ onPredictionId: async () => undefined });
    await expect(provider.generateImage({ prompt: "A small test image" })).rejects.toMatchObject({
      code: "invalid_output",
      observedImageCount: 2,
      providerOperationId: "prediction-test-many",
    });
  });
});
