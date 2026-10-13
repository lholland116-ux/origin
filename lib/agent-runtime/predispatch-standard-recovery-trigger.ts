import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PATH = "/api/internal/predispatch-standard-recovery";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE = /^[0-9a-f]{32}$/i;
const SIGNATURE = /^[0-9a-f]{64}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_EMPTY_BODY_CHUNKS = 16;

export type PredispatchRecoveryConfig = Readonly<{
  endpointEnabled: boolean;
  recoveryEnabled: boolean;
  valid: boolean;
  runId?: string;
  claimId?: string;
  executionKey?: string;
  snapshotRevision?: number;
  snapshotSha256?: string;
  fencingGeneration?: number;
  transportSecret?: string;
}>;

export type PredispatchRecoveryResult = Readonly<{
  status: "recovered" | "already_recovered" | "not_found" | "not_eligible" | "conflict" | "stale_claim";
}>;

export type PredispatchRecoveryDependencies = Readonly<{
  config: PredispatchRecoveryConfig;
  now?: () => number;
  consumeNonce: (nonceHash: string) => Promise<boolean>;
  recover: (input: Readonly<{
    runId: string;
    claimId: string;
    executionKey: string;
    snapshotRevision: number;
    snapshotSha256: string;
    fencingGeneration: number;
  }>) => Promise<PredispatchRecoveryResult>;
  log?: (event: Readonly<Record<string, string>>) => void;
}>;

function integer(value: string | undefined): number | undefined {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function readPredispatchRecoveryConfig(env: Record<string, string | undefined> = process.env): PredispatchRecoveryConfig {
  const runId = env.AGENT_PREDISPATCH_RECOVERY_RUN_ID;
  const claimId = env.AGENT_PREDISPATCH_RECOVERY_CLAIM_ID;
  const executionKey = env.AGENT_PREDISPATCH_RECOVERY_EXECUTION_KEY;
  const snapshotRevision = integer(env.AGENT_PREDISPATCH_RECOVERY_SNAPSHOT_REVISION);
  const snapshotSha256 = env.AGENT_PREDISPATCH_RECOVERY_SNAPSHOT_SHA256;
  const fencingGeneration = integer(env.AGENT_PREDISPATCH_RECOVERY_FENCING_GENERATION);
  const transportSecret = env.AGENT_PREDISPATCH_RECOVERY_TRANSPORT_SECRET;
  return {
    endpointEnabled: env.AGENT_PREDISPATCH_RECOVERY_ENDPOINT_ENABLED === "true",
    recoveryEnabled: env.AGENT_PREDISPATCH_RECOVERY_ENABLED === "true",
    ...(runId ? { runId } : {}),
    ...(claimId ? { claimId } : {}),
    ...(executionKey ? { executionKey } : {}),
    ...(snapshotRevision !== undefined ? { snapshotRevision } : {}),
    ...(snapshotSha256 ? { snapshotSha256 } : {}),
    ...(fencingGeneration !== undefined ? { fencingGeneration } : {}),
    ...(transportSecret ? { transportSecret } : {}),
    valid: Boolean(runId && UUID.test(runId) && claimId && UUID.test(claimId)
      && executionKey && UUID.test(executionKey)
      && snapshotRevision !== undefined && snapshotRevision >= 0
      && snapshotSha256 && SHA256.test(snapshotSha256)
      && fencingGeneration !== undefined && fencingGeneration > 0
      && transportSecret && Buffer.byteLength(transportSecret, "utf8") >= 32
      && transportSecret !== env.AGENT_EXECUTION_TRIGGER_SECRET
      && transportSecret !== env.AGENT_EXECUTION_RECOVERY_TRANSPORT_SECRET
      && transportSecret !== env.AGENT_EXECUTION_RECOVERY_AUTHORIZATION),
  };
}

export function signPredispatchRecoveryRequest(secret: string, timestamp: string, nonce: string): string {
  return createHmac("sha256", secret)
    .update(`v1\nPOST\n${PATH}\n${timestamp}\n${nonce.toLowerCase()}`, "utf8")
    .digest("hex");
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function bodyHasBytes(body: ReadableStream<Uint8Array>): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = body.getReader(); } catch { return true; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 1_000); });
  try {
    for (let chunks = 0; chunks <= MAX_EMPTY_BODY_CHUNKS; chunks += 1) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === null) { void reader.cancel().catch(() => undefined); return true; }
      if (next.done) return false;
      if (next.value.byteLength > 0) { void reader.cancel().catch(() => undefined); return true; }
    }
    void reader.cancel().catch(() => undefined);
    return true;
  } catch {
    void reader.cancel().catch(() => undefined);
    return true;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Authenticates one fixed-run state repair. It never invokes the execution worker. */
export async function handlePredispatchStandardRecovery(
  request: Request,
  dependencies: PredispatchRecoveryDependencies,
): Promise<Response> {
  const config = dependencies.config;
  const log = (event: string, reason: string) => dependencies.log?.({ event, reason });
  if (!config.endpointEnabled || !config.recoveryEnabled) return json(404, { error: "not_found" });
  if (!config.valid || !config.runId || !config.claimId || !config.executionKey
    || config.snapshotRevision === undefined || !config.snapshotSha256
    || config.fencingGeneration === undefined
    || !config.transportSecret) {
    log("predispatch_recovery_rejected", "configuration_unavailable");
    return json(503, { error: "temporarily_unavailable" });
  }
  if (request.method !== "POST" || new URL(request.url).pathname !== PATH) return json(404, { error: "not_found" });
  const length = request.headers.get("content-length");
  if (length !== null && length !== "0") {
    void request.body?.cancel().catch(() => undefined);
    return json(400, { error: "invalid_request" });
  }
  if (request.body !== null && await bodyHasBytes(request.body)) return json(400, { error: "invalid_request" });

  const timestamp = request.headers.get("x-lvtchat-timestamp") ?? "";
  const nonce = request.headers.get("x-lvtchat-nonce") ?? "";
  const signature = request.headers.get("x-lvtchat-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !NONCE.test(nonce) || !SIGNATURE.test(signature)) {
    log("predispatch_recovery_rejected", "invalid_authentication");
    return json(401, { error: "unauthorized" });
  }
  const nowSeconds = Math.floor((dependencies.now ?? Date.now)() / 1_000);
  if (!Number.isSafeInteger(nowSeconds) || Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    log("predispatch_recovery_rejected", "stale_authentication");
    return json(401, { error: "unauthorized" });
  }
  const expected = Buffer.from(signPredispatchRecoveryRequest(config.transportSecret, timestamp, nonce), "hex");
  const supplied = Buffer.from(signature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    log("predispatch_recovery_rejected", "invalid_authentication");
    return json(401, { error: "unauthorized" });
  }
  try {
    const hash = createHash("sha256").update(nonce.toLowerCase(), "utf8").digest("hex");
    if (!await dependencies.consumeNonce(hash)) {
      log("predispatch_recovery_rejected", "replay");
      return json(409, { error: "duplicate_request" });
    }
  } catch {
    log("predispatch_recovery_rejected", "replay_store_unavailable");
    return json(503, { error: "temporarily_unavailable" });
  }
  try {
    const result = await dependencies.recover({
      runId: config.runId,
      claimId: config.claimId,
      executionKey: config.executionKey,
      snapshotRevision: config.snapshotRevision,
      snapshotSha256: config.snapshotSha256,
      fencingGeneration: config.fencingGeneration,
    });
    if (result.status === "recovered" || result.status === "already_recovered") {
      log("predispatch_recovery_completed", result.status);
      return json(200, { status: result.status });
    }
    log("predispatch_recovery_rejected", result.status);
    return json(409, { error: "recovery_not_applied", status: result.status });
  } catch {
    // A timeout can occur after PostgreSQL commits, so the result is unknown;
    // do not report failure or automatically retry the state-changing RPC.
    log("predispatch_recovery_outcome_unknown", "backend_unavailable");
    return json(503, { error: "temporarily_unavailable" });
  }
}
