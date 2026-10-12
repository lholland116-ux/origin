import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  createDocumentGenerationReconciliationAuthorizationToken,
  type DocumentGenerationReconciliationAuthorization,
  type DocumentGenerationReconciliationResult,
} from "@/lib/agent-runtime/document-generation-reconciliation";

const RECOVERY_PATH = "/api/internal/document-generation-recovery";
const MAX_CLOCK_SKEW_SECONDS = 300;
const SECRET_MIN_BYTES = 32;
const NONCE_PATTERN = /^[0-9a-f]{32}$/i;
const HEX_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const REQUEST_BODY_VALIDATION_TIMEOUT_MS = 1_000;
const MAX_EMPTY_BODY_CHUNKS = 16;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentGenerationRecoveryEnvironment = Readonly<Record<string, string | undefined>>;
export type DocumentGenerationRecoveryConfig = Readonly<{
  endpointEnabled: boolean;
  recoveryEnabled: boolean;
  runId?: string;
  transportSecret?: string;
  authorizationSecret?: string;
  valid: boolean;
}>;
export type DocumentGenerationRecoveryDependencies = Readonly<{
  config: DocumentGenerationRecoveryConfig;
  now?: () => number;
  consumeNonce: (nonceHash: string) => Promise<boolean>;
  reconcile: (input: Readonly<{
    runId: string;
    authorization: DocumentGenerationReconciliationAuthorization;
  }>) => Promise<DocumentGenerationReconciliationResult>;
  finalize: (runId: string) => Promise<{
    status: "finalized" | "replayed" | "not_found" | "not_ready" | "conflict" | "unavailable";
    assistantMessageId?: string;
  }>;
  log?: (event: Readonly<Record<string, string | number>>) => void;
}>;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function signable(timestamp: string, nonce: string): string {
  return `v1\nPOST\n${RECOVERY_PATH}\n${timestamp}\n${nonce.toLowerCase()}`;
}

function validSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= SECRET_MIN_BYTES;
}

function validRunId(runId: string | undefined): runId is string {
  return typeof runId === "string" && UUID_PATTERN.test(runId);
}

export function signDocumentGenerationRecoveryRequest(secret: string, timestamp: string, nonce: string): string {
  return createHmac("sha256", secret).update(signable(timestamp, nonce), "utf8").digest("hex");
}

export function readDocumentGenerationRecoveryConfig(
  env: DocumentGenerationRecoveryEnvironment = process.env,
): DocumentGenerationRecoveryConfig {
  const endpointEnabled = env.AGENT_EXECUTION_RECOVERY_ENDPOINT_ENABLED === "true";
  const recoveryEnabled = env.AGENT_EXECUTION_RECOVERY_ENABLED === "true";
  const runId = env.AGENT_EXECUTION_RECOVERY_RUN_ID;
  const transportSecret = env.AGENT_EXECUTION_RECOVERY_TRANSPORT_SECRET;
  const authorizationSecret = env.AGENT_EXECUTION_RECOVERY_AUTHORIZATION;
  return {
    endpointEnabled,
    recoveryEnabled,
    ...(runId ? { runId } : {}),
    ...(transportSecret ? { transportSecret } : {}),
    ...(authorizationSecret ? { authorizationSecret } : {}),
    valid: validRunId(runId) && validSecret(transportSecret) && validSecret(authorizationSecret),
  };
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

function safeLog(
  dependencies: DocumentGenerationRecoveryDependencies,
  event: string,
  extra: Readonly<Record<string, string | number>> = {},
): void {
  dependencies.log?.({ event, ...extra });
}

function reconciled(status: DocumentGenerationReconciliationResult["status"]): boolean {
  return status === "reconciled" || status === "already_reconciled";
}

/** Fixed-run, server-authenticated recovery boundary. */
export async function handleDocumentGenerationRecovery(
  request: Request,
  dependencies: DocumentGenerationRecoveryDependencies,
): Promise<Response> {
  const now = dependencies.now ?? Date.now;
  const config = dependencies.config;
  if (!config.endpointEnabled || !config.recoveryEnabled) return json(404, { error: "not_found" });
  if (!config.valid || !config.runId || !config.transportSecret || !config.authorizationSecret) {
    safeLog(dependencies, "recovery_rejected", { reason: "configuration_unavailable" });
    return json(503, { error: "temporarily_unavailable" });
  }
  if (request.method !== "POST" || new URL(request.url).pathname !== RECOVERY_PATH) {
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
    safeLog(dependencies, "recovery_rejected", { reason: "invalid_authentication" });
    return json(401, { error: "unauthorized" });
  }
  const nowSeconds = Math.floor(now() / 1000);
  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(nowSeconds) || Math.abs(nowSeconds - signedAt) > MAX_CLOCK_SKEW_SECONDS) {
    safeLog(dependencies, "recovery_rejected", { reason: "stale_authentication" });
    return json(401, { error: "unauthorized" });
  }
  const expected = Buffer.from(signDocumentGenerationRecoveryRequest(config.transportSecret, timestamp, nonce), "hex");
  const supplied = Buffer.from(signature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    safeLog(dependencies, "recovery_rejected", { reason: "invalid_authentication" });
    return json(401, { error: "unauthorized" });
  }

  let consumed: boolean;
  try {
    consumed = await dependencies.consumeNonce(createHash("sha256").update(nonce.toLowerCase(), "utf8").digest("hex"));
  } catch {
    safeLog(dependencies, "recovery_rejected", { reason: "replay_store_unavailable" });
    return json(503, { error: "temporarily_unavailable" });
  }
  if (!consumed) {
    safeLog(dependencies, "recovery_rejected", { reason: "replay" });
    return json(409, { error: "duplicate_request" });
  }

  const authorizationToken = createDocumentGenerationReconciliationAuthorizationToken(config.authorizationSecret, config.runId);
  if (!authorizationToken) {
    safeLog(dependencies, "recovery_rejected", { reason: "configuration_unavailable" });
    return json(503, { error: "temporarily_unavailable" });
  }
  let recovery: DocumentGenerationReconciliationResult;
  try {
    recovery = await dependencies.reconcile({
      runId: config.runId,
      authorization: { kind: "owner_approved_document_reconciliation", token: authorizationToken },
    });
  } catch {
    safeLog(dependencies, "recovery_completed", { status: "unavailable" });
    return json(503, { error: "temporarily_unavailable" });
  }
  if (!reconciled(recovery.status)) {
    safeLog(dependencies, "recovery_completed", { status: "not_applied" });
    return json(409, { error: "recovery_not_applied" });
  }

  let finalization: Awaited<ReturnType<DocumentGenerationRecoveryDependencies["finalize"]>>;
  try {
    finalization = await dependencies.finalize(config.runId);
  } catch {
    safeLog(dependencies, "recovery_completed", { status: "reconciled_finalization_pending" });
    return json(503, { status: recovery.status, finalization: "pending" });
  }
  if (finalization.status === "finalized" || finalization.status === "replayed") {
    safeLog(dependencies, "recovery_completed", { status: "finalized" });
    return json(200, { status: recovery.status, finalization: finalization.status });
  }
  if (finalization.status === "unavailable") {
    safeLog(dependencies, "recovery_completed", { status: "reconciled_finalization_pending" });
    return json(503, { status: recovery.status, finalization: "pending" });
  }
  safeLog(dependencies, "recovery_completed", { status: "finalization_not_applied" });
  return json(409, { error: "finalization_not_applied" });
}
