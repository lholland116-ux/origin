import { createHmac, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleExecutionTrigger } from "@/lib/agent-runtime/execution-trigger";

const SECRET = "local-test-only-secret-material-at-least-32-bytes";
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const NONCE = "1234567890abcdef1234567890abcdef";
const PATH = "/api/internal/execution-wake";

function request(options: {
  nonce?: string;
  timestamp?: string;
  signature?: string;
  body?: string;
  bodyStream?: ReadableStream<Uint8Array>;
  contentLength?: string;
  signal?: AbortSignal;
} = {}): Request {
  const timestamp = options.timestamp ?? String(Math.floor(NOW / 1000));
  const nonce = options.nonce ?? NONCE;
  const signature = options.signature ?? createHmac("sha256", SECRET)
    .update(`v1\nPOST\n${PATH}\n${timestamp}\n${nonce.toLowerCase()}`, "utf8").digest("hex");
  const headers = new Headers({
    "x-lvtchat-timestamp": timestamp,
    "x-lvtchat-nonce": nonce,
    "x-lvtchat-signature": signature,
  });
  if (options.contentLength !== undefined) headers.set("content-length", options.contentLength);
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers,
    body: options.bodyStream ?? options.body,
    signal: options.signal,
  };
  if (options.bodyStream) init.duplex = "half";
  return new Request(`https://lvtchat.test${PATH}`, {
    ...init,
  });
}

function fixture(overrides: Record<string, unknown> = {}) {
  const consumed = new Set<string>();
  const consumeNonce = vi.fn(async (hash: string) => {
    if (consumed.has(hash)) return false;
    consumed.add(hash);
    return true;
  });
  const acquireInvocation = vi.fn(async () => ({ status: "acquired" as const, fencingGeneration: 1 }));
  const renewInvocation = vi.fn(async () => true);
  const releaseInvocation = vi.fn(async () => true);
  const runOnce = vi.fn(async () => ({ status: "step_completed", durationMs: 42, providerCalls: 1 }));
  const log = vi.fn();
  const dependencies = {
      enabled: true,
      secret: SECRET,
      now: () => NOW,
      createInvocationId: vi.fn().mockReturnValue("invocation-id"),
      createClaimId: vi.fn().mockReturnValue("claim-id"),
      consumeNonce,
      acquireInvocation,
      renewInvocation,
      releaseInvocation,
      runOnce,
      log,
      ...overrides,
  };
  return {
    dependencies,
    consumeNonce: dependencies.consumeNonce as typeof consumeNonce,
    acquireInvocation: dependencies.acquireInvocation as typeof acquireInvocation,
    renewInvocation: dependencies.renewInvocation as typeof renewInvocation,
    releaseInvocation: dependencies.releaseInvocation as typeof releaseInvocation,
    runOnce: dependencies.runOnce as typeof runOnce,
    log: dependencies.log as typeof log,
  };
}

describe("authenticated execution wake-up", () => {
  it("fails closed when the default-disabled gate is off", async () => {
    const f = fixture({ enabled: false });
    const response = await handleExecutionTrigger(request(), f.dependencies as never);
    expect(response.status).toBe(404);
    expect(f.consumeNonce).not.toHaveBeenCalled();
    expect(f.runOnce).not.toHaveBeenCalled();
  });

  it("fails closed when the trigger secret is missing or too short", async () => {
    for (const secret of [undefined, "short"]) {
      const f = fixture({ secret });
      const response = await handleExecutionTrigger(request(), f.dependencies as never);
      expect(response.status).toBe(503);
      expect(f.runOnce).not.toHaveBeenCalled();
    }
  });

  it("accepts a valid HMAC wake-up with a null body, invokes one bounded worker call, and sanitizes the result", async () => {
    const f = fixture();
    const response = await handleExecutionTrigger(request(), f.dependencies as never);
    expect(response.status).toBe(200);
    expect(f.consumeNonce).toHaveBeenCalledWith(createHash("sha256").update(NONCE).digest("hex"));
    expect(f.acquireInvocation).toHaveBeenCalledWith("claim-id");
    expect(f.runOnce).toHaveBeenCalledTimes(1);
    expect(f.releaseInvocation).toHaveBeenCalledWith("claim-id", 1);
    const body = await response.json();
    expect(body).toEqual({ status: "step_completed", durationMs: 0, providerCalls: 1 });
    expect(JSON.stringify(body)).not.toContain("runId");
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(SECRET);
  });

  it("accepts a zero-byte POST stream and continues through normal authentication", async () => {
    const bodyStream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const f = fixture();
    const response = await handleExecutionTrigger(request({ bodyStream }), f.dependencies as never);

    expect(response.status).toBe(200);
    expect(f.consumeNonce).toHaveBeenCalledOnce();
    expect(f.runOnce).toHaveBeenCalledOnce();
  });

  it("accepts Content-Length 0", async () => {
    const f = fixture();
    const response = await handleExecutionTrigger(request({ contentLength: "0" }), f.dependencies as never);

    expect(response.status).toBe(200);
    expect(f.runOnce).toHaveBeenCalledOnce();
  });

  it("rejects a non-empty body before nonce consumption or worker dispatch", async () => {
    const f = fixture();
    const response = await handleExecutionTrigger(request({ body: "unexpected" }), f.dependencies as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(f.consumeNonce).not.toHaveBeenCalled();
    expect(f.runOnce).not.toHaveBeenCalled();
  });

  it("rejects an explicit nonzero Content-Length before nonce consumption or worker dispatch", async () => {
    const f = fixture();
    const response = await handleExecutionTrigger(request({ contentLength: "1" }), f.dependencies as never);

    expect(response.status).toBe(400);
    expect(f.consumeNonce).not.toHaveBeenCalled();
    expect(f.runOnce).not.toHaveBeenCalled();
  });

  it("rejects a request body stream that does not finish within the validation bound", async () => {
    vi.useFakeTimers();
    try {
      const bodyStream = new ReadableStream<Uint8Array>({ start() {} });
      const f = fixture();
      const pendingResponse = handleExecutionTrigger(request({ bodyStream }), f.dependencies as never);

      await vi.advanceTimersByTimeAsync(1_000);
      const response = await pendingResponse;

      expect(response.status).toBe(400);
      expect(f.consumeNonce).not.toHaveBeenCalled();
      expect(f.runOnce).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a stream that emits repeated zero-length chunks", async () => {
    const bodyStream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(0)); },
    });
    const f = fixture();
    const response = await handleExecutionTrigger(request({ bodyStream }), f.dependencies as never);

    expect(response.status).toBe(400);
    expect(f.consumeNonce).not.toHaveBeenCalled();
    expect(f.runOnce).not.toHaveBeenCalled();
  });

  it("maps worker persistence unavailability to a retryable wake response", async () => {
    const f = fixture({ runOnce: vi.fn(async () => ({ status: "worker_unavailable", durationMs: 7, providerCalls: null })) });
    const response = await handleExecutionTrigger(request(), f.dependencies as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(f.releaseInvocation).toHaveBeenCalledOnce();
  });

  it("rejects bad signatures, stale timestamps, and malformed authentication", async () => {
    const badSignature = request({ signature: "a".repeat(64) });
    const stale = request({ timestamp: String(Math.floor(NOW / 1000) - 301), nonce: "2234567890abcdef1234567890abcdef" });
    const malformed = new Request(`https://lvtchat.test${PATH}`, { method: "POST" });
    for (const candidate of [badSignature, stale, malformed]) {
      const f = fixture();
      const response = await handleExecutionTrigger(candidate, f.dependencies as never);
      expect(response.status).toBe(401);
      expect(f.consumeNonce).not.toHaveBeenCalled();
      expect(f.runOnce).not.toHaveBeenCalled();
    }
  });

  it("rejects unsupported HTTP methods before consuming a nonce or dispatching work", async () => {
    const f = fixture();
    const unsupported = new Request(`https://lvtchat.test${PATH}`, { method: "PUT" });
    const response = await handleExecutionTrigger(unsupported, f.dependencies as never);
    expect(response.status).toBe(404);
    expect(f.consumeNonce).not.toHaveBeenCalled();
    expect(f.runOnce).not.toHaveBeenCalled();
  });

  it("durably rejects a replayed nonce before worker dispatch", async () => {
    const f = fixture();
    expect((await handleExecutionTrigger(request(), f.dependencies as never)).status).toBe(200);
    const replay = await handleExecutionTrigger(request(), f.dependencies as never);
    expect(replay.status).toBe(409);
    expect(f.runOnce).toHaveBeenCalledTimes(1);
  });

  it("does not run when another trigger holds the global database gate", async () => {
    const f = fixture({ acquireInvocation: vi.fn(async () => ({ status: "busy" as const })) });
    const response = await handleExecutionTrigger(request(), f.dependencies as never);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "busy" });
    expect(f.runOnce).not.toHaveBeenCalled();
    expect(f.releaseInvocation).not.toHaveBeenCalled();
  });

  it("fails closed when its bounded global invocation lease is lost before release", async () => {
    const f = fixture({ releaseInvocation: vi.fn(async () => false) });
    const response = await handleExecutionTrigger(request(), f.dependencies as never);
    expect(response.status).toBe(503);
    expect(f.runOnce).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain("runId");
  });

  it("renews the fenced global lease while the worker is still running", async () => {
    vi.useFakeTimers();
    try {
      let complete!: () => void;
      const pending = new Promise<{ status: string; durationMs: number; providerCalls: number | null }>((resolve) => {
        complete = () => resolve({ status: "no_work", durationMs: 3, providerCalls: 0 });
      });
      const f = fixture({ runOnce: vi.fn(() => pending) });
      const result = handleExecutionTrigger(request(), f.dependencies as never);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(f.renewInvocation).toHaveBeenCalledWith("claim-id", 1);
      complete();
      expect((await result).status).toBe(200);
      expect(f.releaseInvocation).toHaveBeenCalledWith("claim-id", 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report success if its fenced lease renewal is rejected", async () => {
    vi.useFakeTimers();
    try {
      let complete!: () => void;
      const pending = new Promise<{ status: string; durationMs: number; providerCalls: number | null }>((resolve) => {
        complete = () => resolve({ status: "no_work", durationMs: 3, providerCalls: 0 });
      });
      const f = fixture({
        renewInvocation: vi.fn(async () => false),
        runOnce: vi.fn(() => pending),
      });
      const result = handleExecutionTrigger(request(), f.dependencies as never);
      await vi.advanceTimersByTimeAsync(30_000);
      complete();
      expect((await result).status).toBe(503);
      expect(f.releaseInvocation).toHaveBeenCalledWith("claim-id", 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("awaits worker completion and releases the gate without detached execution", async () => {
    let complete!: () => void;
    const pending = new Promise<{ status: string; durationMs: number; providerCalls: number | null }>((resolve) => {
      complete = () => resolve({ status: "no_work", durationMs: 3, providerCalls: 0 });
    });
    const f = fixture({ runOnce: vi.fn(() => pending) });
    let settled = false;
    const result = handleExecutionTrigger(request(), f.dependencies as never).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    expect((await result).status).toBe(200);
    expect(f.releaseInvocation).toHaveBeenCalledTimes(1);
  });

  it("does not treat caller disconnect as proof that server-side work stopped", async () => {
    let complete!: () => void;
    const pending = new Promise<{ status: string; durationMs: number; providerCalls: number | null }>((resolve) => {
      complete = () => resolve({ status: "step_completed", durationMs: 20, providerCalls: 1 });
    });
    const controller = new AbortController();
    const f = fixture({ runOnce: vi.fn(() => pending) });
    let settled = false;
    const result = handleExecutionTrigger(request({ nonce: "9234567890abcdef1234567890abcdef", signal: controller.signal }), f.dependencies as never)
      .then((response) => { settled = true; return response; });
    await Promise.resolve();
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.runOnce).toHaveBeenCalledOnce();
    expect(f.releaseInvocation).not.toHaveBeenCalled();
    complete();
    expect((await result).status).toBe(200);
    expect(f.releaseInvocation).toHaveBeenCalledOnce();
  });

  it("fails closed when durable replay protection is unavailable", async () => {
    const f = fixture({ consumeNonce: vi.fn(async () => { throw new Error("private db detail"); }) });
    const response = await handleExecutionTrigger(request(), f.dependencies as never);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private db detail");
    expect(f.runOnce).not.toHaveBeenCalled();
  });
});
