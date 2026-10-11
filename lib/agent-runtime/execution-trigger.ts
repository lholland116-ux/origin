import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ExecutionFailureCode } from "@/lib/agent-runtime/runtime-contracts";

const TRIGGER_PATH = "/api/internal/execution-wake";
const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_PATTERN = /^[0-9a-f]{32}$/i;
const HEX_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const SECRET_MIN_BYTES = 32;
const GATE_RENEWAL_INTERVAL_MS = 30_000;
const REQUEST_BODY_VALIDATION_TIMEOUT_MS = 1_000;
const MAX_EMPTY_BODY_CHUNKS = 16;

export type ExecutionTriggerWorkerResult = Readonly<{
  status: string;
  durationMs: number;
  providerCalls: number | null;
  /** Optional safe runtime diagnostics; logged internally and never included in the HTTP response. */
  diagnosticPhase?: "runtime_threw" | "runtime_recovery" | "runtime_rejected" | "post_runtime_read" | "post_runtime_state_check";
  diagnosticCode?: ExecutionFailureCode;
}>;

export type ExecutionTriggerDependencies = Readonly<{
  enabled: boolean;
  secret?: string;
  now?: () => number;
  createInvocationId?: () => string;
  createClaimId?: () => string;
  consumeNonce(nonceHash: string): Promise<boolean>;
  acquireInvocation(claimId: string): Promise<{ status: "acquired"; fencingGeneration: number } | { status: "busy" }>;
  renewInvocation(claimId: string, fencingGeneration: number): Promise<boolean>;
  releaseInvocation(claimId: string, fencingGeneration: number): Promise<boolean>;
  runOnce(): Promise<ExecutionTriggerWorkerResult>;
  log?(event: Readonly<Record<string, string | number | null>>): void;
}>;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function signable(timestamp: string, nonce: string): string {
  return `v1\nPOST\n${TRIGGER_PATH}\n${timestamp}\n${nonce.toLowerCase()}`;
}

function validSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= SECRET_MIN_BYTES;
}

export function signExecutionTrigger(secret: string, timestamp: string, nonce: string): string {
  return createHmac("sha256", secret).update(signable(timestamp, nonce), "utf8").digest("hex");
}

async function hasRequestBodyBytes(body: ReadableStream<Uint8Array>): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    return true;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let emptyChunkCount = 0;
  const timedOut = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), REQUEST_BODY_VALIDATION_TIMEOUT_MS);
  });

  try {
    while (true) {
      const result = await Promise.race([reader.read(), timedOut]);
      if (result === null) {
        void reader.cancel().catch(() => undefined);
        return true;
      }
      if (result.done) return false;
      if (result.value.byteLength > 0) {
        void reader.cancel().catch(() => undefined);
        return true;
      }
      emptyChunkCount += 1;
      if (emptyChunkCount > MAX_EMPTY_BODY_CHUNKS) {
        void reader.cancel().catch(() => undefined);
        return true;
      }
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    return true;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Authenticated wake-up only: it accepts no run or owner arguments and performs one bounded worker call. */
export async function handleExecutionTrigger(
  request: Request,
  dependencies: ExecutionTriggerDependencies,
): Promise<Response> {
  const now = dependencies.now ?? Date.now;
  const invocationId = (dependencies.createInvocationId ?? randomUUID)();
  const startedAt = now();
  const log = (event: Readonly<Record<string, string | number | null>>) => dependencies.log?.({
    invocationId,
    at: new Date(now()).toISOString(),
    ...event,
  });

  if (!dependencies.enabled) return json(404, { error: "not_found" });
  if (!validSecret(dependencies.secret)) {
    log({ event: "trigger_rejected", reason: "configuration_unavailable" });
    return json(503, { error: "temporarily_unavailable" });
  }
  if (request.method !== "POST" || new URL(request.url).pathname !== TRIGGER_PATH) {
    return json(404, { error: "not_found" });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && contentLength !== "0") {
    void request.body?.cancel().catch(() => undefined);
    return json(400, { error: "invalid_request" });
  }
  if (request.body !== null && await hasRequestBodyBytes(request.body)) {
    return json(400, { error: "invalid_request" });
  }

  const timestamp = request.headers.get("x-lvtchat-timestamp") ?? "";
  const nonce = request.headers.get("x-lvtchat-nonce") ?? "";
  const signature = request.headers.get("x-lvtchat-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !NONCE_PATTERN.test(nonce) || !HEX_SIGNATURE_PATTERN.test(signature)) {
    log({ event: "trigger_rejected", reason: "invalid_authentication" });
    return json(401, { error: "unauthorized" });
  }

  const nowSeconds = Math.floor(now() / 1000);
  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(nowSeconds) || Math.abs(nowSeconds - signedAt) > MAX_CLOCK_SKEW_SECONDS) {
    log({ event: "trigger_rejected", reason: "stale_authentication" });
    return json(401, { error: "unauthorized" });
  }
  const expected = Buffer.from(signExecutionTrigger(dependencies.secret, timestamp, nonce), "hex");
  const supplied = Buffer.from(signature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    log({ event: "trigger_rejected", reason: "invalid_authentication" });
    return json(401, { error: "unauthorized" });
  }

  const nonceHash = createHash("sha256").update(nonce.toLowerCase(), "utf8").digest("hex");
  let consumed: boolean;
  try {
    consumed = await dependencies.consumeNonce(nonceHash);
  } catch {
    log({ event: "trigger_rejected", reason: "replay_store_unavailable" });
    return json(503, { error: "temporarily_unavailable" });
  }
  if (!consumed) {
    log({ event: "trigger_rejected", reason: "replay" });
    return json(409, { error: "duplicate_trigger" });
  }

  const claimId = (dependencies.createClaimId ?? randomUUID)();
  let gate: { status: "acquired"; fencingGeneration: number } | { status: "busy" };
  try {
    gate = await dependencies.acquireInvocation(claimId);
  } catch {
    log({ event: "trigger_rejected", reason: "concurrency_gate_unavailable" });
    return json(503, { error: "temporarily_unavailable" });
  }
  if (gate.status === "busy") {
    log({ event: "trigger_completed", status: "busy", durationMs: Math.max(0, now() - startedAt), workCount: 0 });
    return json(202, { status: "busy" });
  }

  let result: ExecutionTriggerWorkerResult;
  let released = false;
  let leaseLost = false;
  let pendingRenewal: Promise<void> | undefined;
  const renewalTimer = setInterval(() => {
    if (pendingRenewal || leaseLost) return;
    pendingRenewal = dependencies.renewInvocation(claimId, gate.fencingGeneration)
      .then((renewed) => { if (!renewed) leaseLost = true; })
      // A failed heartbeat makes ownership uncertain. Keep the gate closed
      // until its database lease expires, but never report this invocation as
      // safely completed if ownership could not be confirmed.
      .catch(() => { leaseLost = true; })
      .finally(() => { pendingRenewal = undefined; });
  }, GATE_RENEWAL_INTERVAL_MS);
  try {
    result = await dependencies.runOnce();
  } catch {
    result = { status: "worker_unavailable", durationMs: Math.max(0, now() - startedAt), providerCalls: null };
  } finally {
    clearInterval(renewalTimer);
    await pendingRenewal;
    try {
      released = await dependencies.releaseInvocation(claimId, gate.fencingGeneration);
    } catch {
      log({ event: "trigger_cleanup", status: "lease_expires", workCount: 0 });
    }
  }

  if (leaseLost || !released) {
    log({ event: "trigger_cleanup", status: "lease_lost", workCount: 0 });
    return json(503, { error: "temporarily_unavailable" });
  }

  const durationMs = Math.max(0, now() - startedAt);
  if (result.status === "worker_unavailable") {
    log({ event: "trigger_completed", status: "worker_unavailable", durationMs, workCount: 0 });
    return json(503, { error: "temporarily_unavailable" });
  }
  log({
    event: "trigger_completed",
    status: result.status,
    durationMs,
    workCount: result.status === "no_work" || result.status === "busy" ? 0 : 1,
    providerCalls: result.providerCalls,
    ...(result.diagnosticPhase ? { diagnosticPhase: result.diagnosticPhase } : {}),
    ...(result.diagnosticCode ? { diagnosticCode: result.diagnosticCode } : {}),
  });
  return json(200, { status: result.status, durationMs, providerCalls: result.providerCalls });
}
