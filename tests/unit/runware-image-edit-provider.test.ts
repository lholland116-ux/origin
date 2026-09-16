import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUNWARE_IMAGE_EDIT_API_KEY_ENV,
  RUNWARE_IMAGE_EDIT_ENDPOINT,
  RUNWARE_IMAGE_EDIT_MODEL,
  RUNWARE_IMAGE_EDIT_TIMEOUT_MS,
} from "@/lib/image-generation/config";
import {
  RunwareImageEditProvider,
  RunwareImageEditProviderError,
} from "@/lib/image-generation/providers/runware-image-edit";
import { validateImageEditRequest } from "@/lib/image-generation/validation";

const SOURCE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SOURCE_BYTES = Uint8Array.from(Buffer.from(SOURCE_BASE64, "base64"));
const TASK_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    sourceImage: {
      bytes: SOURCE_BYTES,
      mimeType: "image/png",
    },
    instruction: "  Replace the sky with a clear blue sky.  ",
    width: 1024,
    height: 768,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function getChunkRange(bytes: Uint8Array, targetType: string): [number, number] {
  let offset = 8;

  while (offset < bytes.byteLength) {
    const length =
      bytes[offset] * 0x1000000 +
      bytes[offset + 1] * 0x10000 +
      bytes[offset + 2] * 0x100 +
      bytes[offset + 3];
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const end = offset + 12 + length;

    if (type === targetType) {
      return [offset, end];
    }

    offset = end;
  }

  throw new Error(`Missing ${targetType} chunk in test fixture`);
}

function concatenateBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function withoutChunk(bytes: Uint8Array, type: string): Uint8Array {
  const [start, end] = getChunkRange(bytes, type);
  return concatenateBytes(bytes.slice(0, start), bytes.slice(end));
}

function createOutputFetcher(options: {
  data?: (taskUUID: string) => Array<Record<string, unknown>>;
  imageBytes?: Uint8Array;
  includeImageBase64Data?: boolean;
  result?: Record<string, unknown>;
} = {}) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const tasks = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    const taskUUID = String(tasks[0]?.taskUUID);
    const defaultResult: Record<string, unknown> = {
      taskUUID,
      ...(options.includeImageBase64Data === false
        ? {}
        : {
            imageBase64Data: Buffer.from(options.imageBytes ?? SOURCE_BYTES).toString("base64"),
          }),
      ...options.result,
    };

    return jsonResponse({
      data: options.data ? options.data(taskUUID) : [defaultResult],
    });
  });
}

function createSuccessfulFetcher(options: { cost?: unknown; imageUUID?: string } = {}) {
  return createOutputFetcher({
    result: {
      imageUUID: options.imageUUID ?? "runware-image-1",
      ...(options.cost === undefined ? {} : { cost: options.cost }),
    },
  });
}

describe("Runware image-edit provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses only the production Runware credential when invoked", async () => {
    const fetcher = createSuccessfulFetcher();
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "");
    vi.stubEnv("RUNWARE_QUAL_API_KEY", "qualification-secret");

    const provider = new RunwareImageEditProvider({ fetcher });
    const error = await provider.editImage(validRequest()).catch((value: unknown) => value);

    expect(fetcher).not.toHaveBeenCalled();
    expect(error).toMatchObject({ code: "configuration" });
    expect(String((error as Error).message)).not.toContain("qualification-secret");
  });

  it.each(["", "   "])("rejects a missing or blank production credential", async (credential) => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, credential);
    const fetcher = createSuccessfulFetcher();

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest()),
    ).rejects.toMatchObject({ code: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the fixed minimal Runware request with an inline source data URI", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "  production-test-secret  ");
    const fetcher = createSuccessfulFetcher({ cost: 0.0042 });
    const provider = new RunwareImageEditProvider({ fetcher });

    const result = await provider.editImage({
      ...validRequest(),
      model: RUNWARE_IMAGE_EDIT_MODEL,
      seed: 42,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [endpoint, init] = fetcher.mock.calls[0];
    expect(endpoint).toBe(RUNWARE_IMAGE_EDIT_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer production-test-secret",
      "Content-Type": "application/json",
    });

    const tasks = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskType: "imageInference",
      model: RUNWARE_IMAGE_EDIT_MODEL,
      positivePrompt: "  Replace the sky with a clear blue sky.  ",
      width: 1024,
      height: 768,
      outputType: "base64Data",
      outputFormat: "PNG",
      numberResults: 1,
      includeCost: true,
      deliveryMethod: "sync",
      seed: 42,
    });
    expect(tasks[0]?.taskUUID).toMatch(TASK_UUID_PATTERN);

    const inputs = tasks[0]?.inputs as { referenceImages: string[] };
    expect(inputs.referenceImages).toEqual([`data:image/png;base64,${SOURCE_BASE64}`]);
    expect(result).toMatchObject({
      provider: "runware",
      model: RUNWARE_IMAGE_EDIT_MODEL,
      mimeType: "image/png",
      bytes: SOURCE_BYTES,
      generationId: "runware-image-1",
      width: 1024,
      height: 768,
      cost: { currency: "USD", amount: 0.0042 },
    });
  });

  it("accepts an omitted model and normalizes task UUID when image UUID is absent", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createSuccessfulFetcher();
    fetcher.mockImplementationOnce(async (_input, init) => {
      const tasks = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      return jsonResponse({
        data: [{ taskUUID: tasks[0]?.taskUUID, imageBase64Data: SOURCE_BASE64 }],
      });
    });

    const result = await new RunwareImageEditProvider({ fetcher }).editImage(validRequest());

    expect(result.generationId).toMatch(TASK_UUID_PATTERN);
  });

  it("omits absent or invalid provider cost", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");

    const absentCostResult = await new RunwareImageEditProvider({
      fetcher: createSuccessfulFetcher(),
    }).editImage(validRequest());
    expect(absentCostResult.cost).toBeUndefined();

    const invalidCostResult = await new RunwareImageEditProvider({
      fetcher: createSuccessfulFetcher({ cost: { amount: "invalid", currency: "USD" } }),
    }).editImage(validRequest());
    expect(invalidCostResult.cost).toBeUndefined();
  });

  it("rejects arbitrary models before making a request", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createSuccessfulFetcher();

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(
        validRequest({ model: "another-model" }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["missing width", { width: undefined, height: 1024 }],
    ["missing height", { width: 1024, height: undefined }],
    ["below minimum width", { width: 112, height: 1024 }],
    ["above maximum height", { width: 1024, height: 2064 }],
    ["width not divisible by 16", { width: 1025, height: 1024 }],
    ["height not divisible by 16", { width: 1024, height: 1025 }],
  ])("rejects %s before making a request", async (_label, dimensions) => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createSuccessfulFetcher();

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest(dimensions)),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts valid square and non-square Runware dimensions", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createSuccessfulFetcher();
    const provider = new RunwareImageEditProvider({ fetcher });

    await expect(provider.editImage(validRequest({ width: 1024, height: 1024 }))).resolves.toMatchObject({
      width: 1024,
      height: 1024,
    });
    await expect(provider.editImage(validRequest({ width: 128, height: 2048 }))).resolves.toMatchObject({
      width: 128,
      height: 2048,
    });
  });

  it("accepts only valid generic dimension pairs", () => {
    expect(validateImageEditRequest(validRequest())).toMatchObject({ success: true });
    expect(validateImageEditRequest(validRequest({ width: undefined }))).toMatchObject({
      success: false,
    });
    expect(validateImageEditRequest(validRequest({ height: undefined }))).toMatchObject({
      success: false,
    });
    expect(validateImageEditRequest(validRequest({ width: 0, height: 768 }))).toMatchObject({
      success: false,
    });
    expect(validateImageEditRequest(validRequest({ width: NaN, height: 768 }))).toMatchObject({
      success: false,
    });
  });

  it.each([
    ["HTTP error", async () => new Response("upstream", { status: 502 })],
    ["malformed JSON", async () => new Response("not-json", { status: 200 })],
  ])("handles %s without exposing provider data", async (_label, responseFactory) => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "super-secret");
    const fetcher = vi.fn(responseFactory);

    const error = await new RunwareImageEditProvider({ fetcher })
      .editImage(validRequest())
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(RunwareImageEditProviderError);
    expect(String((error as Error).message)).not.toContain("super-secret");
    expect(String((error as Error).message)).not.toContain(SOURCE_BASE64);
  });

  it.each([
    ["missing data", () => []],
    ["task mismatch", () => [{ taskUUID: "wrong", imageBase64Data: SOURCE_BASE64 }]],
    ["missing base64", (taskUUID: string) => [{ taskUUID }]],
    ["empty base64", (taskUUID: string) => [{ taskUUID, imageBase64Data: "" }]],
    ["malformed base64", (taskUUID: string) => [{ taskUUID, imageBase64Data: "%%%" }]],
  ])("rejects %s output", async (_label, data) => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createOutputFetcher({ data });

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest()),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it.each([
    ["signature-only", SOURCE_BYTES.slice(0, 8)],
    ["truncated IHDR", SOURCE_BYTES.slice(0, 20)],
    [
      "wrong first chunk",
      (() => {
        const bytes = Uint8Array.from(SOURCE_BYTES);
        bytes[12] = "s".charCodeAt(0);
        return bytes;
      })(),
    ],
    [
      "malformed chunk length",
      (() => {
        const bytes = Uint8Array.from(SOURCE_BYTES);
        const [idatStart] = getChunkRange(bytes, "IDAT");
        bytes[idatStart] = 0xff;
        return bytes;
      })(),
    ],
    ["missing IDAT", withoutChunk(SOURCE_BYTES, "IDAT")],
    ["missing IEND", SOURCE_BYTES.slice(0, getChunkRange(SOURCE_BYTES, "IEND")[0])],
    [
      "non-zero IEND length",
      (() => {
        const bytes = Uint8Array.from(SOURCE_BYTES);
        const [iendStart] = getChunkRange(bytes, "IEND");
        bytes[iendStart + 3] = 1;
        return bytes;
      })(),
    ],
    ["trailing bytes after IEND", concatenateBytes(SOURCE_BYTES, new Uint8Array([0]))],
  ])("rejects %s PNG output", async (_label, imageBytes) => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createOutputFetcher({ imageBytes });

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest()),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it.each([
    ["imageURL-only", { imageURL: "https://provider.invalid/image.png" }],
    ["dataURI-only", { dataURI: `data:image/png;base64,${SOURCE_BASE64}` }],
  ])("rejects %s provider output", async (_label, result) => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createOutputFetcher({
      includeImageBase64Data: false,
      result,
    });

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest()),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("rejects multiple provider result entries", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = createOutputFetcher({
      data: (taskUUID) => [
        { taskUUID, imageBase64Data: SOURCE_BASE64 },
        { taskUUID, imageBase64Data: SOURCE_BASE64 },
      ],
    });

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest()),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("maps an aborted fetch to a bounded timeout error", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      (init?.signal as AbortSignal).dispatchEvent(new Event("abort"));
      throw new DOMException("aborted", "AbortError");
    });

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest()),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("maps a stalled response body to a bounded timeout error", async () => {
    vi.useFakeTimers();
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");

    try {
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;

        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            }),
        } as Response;
      });

      const promise = new RunwareImageEditProvider({ fetcher }).editImage(validRequest());
      const timeoutAssertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(RUNWARE_IMAGE_EDIT_TIMEOUT_MS);

      await timeoutAssertion;
      expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout after successful response-body decoding", async () => {
    vi.useFakeTimers();
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");

    try {
      const result = await new RunwareImageEditProvider({
        fetcher: createSuccessfulFetcher(),
      }).editImage(validRequest());

      expect(result.bytes).toEqual(SOURCE_BYTES);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a known provider error from the fetcher", async () => {
    vi.stubEnv(RUNWARE_IMAGE_EDIT_API_KEY_ENV, "test-secret");
    const expected = new RunwareImageEditProviderError(
      "timeout",
      "Runware image editing timed out",
    );
    const fetcher = vi.fn(async () => {
      throw expected;
    });

    await expect(
      new RunwareImageEditProvider({ fetcher }).editImage(validRequest()),
    ).rejects.toBe(expected);
  });

  it("does not import application, Storage, Supabase, or qualification code", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../lib/image-generation/providers/runware-image-edit.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/app\/(api|chat)/);
    expect(source).not.toMatch(/supabase|storage|qualification/i);
    expect(source).not.toContain("replicate");
  });
});
