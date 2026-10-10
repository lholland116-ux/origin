import { createHmac, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleExecutionTrigger } from "@/lib/agent-runtime/execution-trigger";

const SECRET = "local-test-only-secret-material-at-least-32-bytes";
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const NONCE = "1234567890abcdef1234567890abcdef";
const PATH = "/api/internal/execution-wake";

function request(options: { nonce?: string; timestamp?: string; signature?: string; body?: string; signal?: AbortSignal } = {}): Request {
  const timestamp = options.timestamp ?? String(Math.floor(NOW / 1000));
  const nonce = options.nonce ?? NONCE;
  const signature = options.signature ?? createHmac("sha256", SECRET)
    .update(`v1\nPOST\n${PATH}\n${timestamp}\n${nonce.toLowerCase()}`, "utf8").digest("hex");
  return new Request(`https://lvtchat.test${PATH}`, {
    method: "POST",
    headers: {
      "x-lvtchat-timestamp": timestamp,
      "x-lvtchat-nonce": nonce,
      "x-lvtchat-signature": signature,
    },
    body: options.body,
    signal: options.signal,
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

  it("accepts a valid HMAC wake-up, invokes exactly one bounded worker call, and sanitizes the result", async () => {
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

  it("rejects bad signatures, stale timestamps, malformed authentication, and caller-supplied work arguments", async () => {
    const badSignature = request({ signature: "a".repeat(64) });
    const stale = request({ timestamp: String(Math.floor(NOW / 1000) - 301), nonce: "2234567890abcdef1234567890abcdef" });
    const malformed = new Request(`https://lvtchat.test${PATH}`, { method: "POST" });
    const body = request({ nonce: "3234567890abcdef1234567890abcdef", body: JSON.stringify({ runId: "caller-selected" }) });
    for (const candidate of [badSignature, stale, malformed, body]) {
      const f = fixture();
      const response = await handleExecutionTrigger(candidate, f.dependencies as never);
      expect([400, 401]).toContain(response.status);
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
