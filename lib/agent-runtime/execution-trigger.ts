import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const TRIGGER_PATH = "/api/internal/execution-wake";
const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_PATTERN = /^[0-9a-f]{32}$/i;
const HEX_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const SECRET_MIN_BYTES = 32;
const GATE_RENEWAL_INTERVAL_MS = 30_000;

export type ExecutionTriggerWorkerResult = Readonly<{
  status: string;
  durationMs: number;
  providerCalls: number | null;
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
  if (request.body !== null || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) {
    await request.body?.cancel().catch(() => undefined);
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
  });
  return json(200, { status: result.status, durationMs, providerCalls: result.providerCalls });
}
