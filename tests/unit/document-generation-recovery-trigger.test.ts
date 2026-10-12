import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createDocumentGenerationReconciliationAuthorizationToken,
} from "@/lib/agent-runtime/document-generation-reconciliation";
import {
  handleDocumentGenerationRecovery,
  readDocumentGenerationRecoveryConfig,
  signDocumentGenerationRecoveryRequest,
  type DocumentGenerationRecoveryConfig,
  type DocumentGenerationRecoveryDependencies,
} from "@/lib/agent-runtime/document-generation-recovery-trigger";

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const RUN_ID = "901097af-197c-4800-a538-ef0ad4eb79f5";
const TRANSPORT_SECRET = "local-transport-secret-material-at-least-32-bytes";
const AUTHORIZATION_SECRET = "local-authorization-secret-material-at-least-32-bytes";
const NONCE = "1234567890abcdef1234567890abcdef";
const PATH = "/api/internal/document-generation-recovery";

const config: DocumentGenerationRecoveryConfig = {
  endpointEnabled: true,
  recoveryEnabled: true,
  runId: RUN_ID,
  transportSecret: TRANSPORT_SECRET,
  authorizationSecret: AUTHORIZATION_SECRET,
  valid: true,
};

function request(options: {
  nonce?: string;
  timestamp?: string;
  signature?: string;
  body?: string;
  bodyStream?: ReadableStream<Uint8Array>;
  contentLength?: string;
} = {}): Request {
  const timestamp = options.timestamp ?? String(Math.floor(NOW / 1000));
  const nonce = options.nonce ?? NONCE;
  const signature = options.signature ?? signDocumentGenerationRecoveryRequest(TRANSPORT_SECRET, timestamp, nonce);
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
  };
  if (options.bodyStream) init.duplex = "half";
  return new Request(`https://lvtchat.test${PATH}`, init);
}

function fixture(overrides: Partial<DocumentGenerationRecoveryDependencies> = {}) {
  const consumed = new Set<string>();
  const consumeNonce = vi.fn(async (hash: string) => {
    if (consumed.has(hash)) return false;
    consumed.add(hash);
    return true;
  });
  const reconcile = vi.fn(async () => ({ status: "reconciled" as const, snapshotRevision: 7 }));
  const finalize = vi.fn(async () => ({ status: "finalized" as const, assistantMessageId: "private" }));
  const log = vi.fn();
  const dependencies: DocumentGenerationRecoveryDependencies = {
    config,
    now: () => NOW,
    consumeNonce,
    reconcile,
    finalize,
    log,
    ...overrides,
  };
  return {
    dependencies,
    consumeNonce: dependencies.consumeNonce as typeof consumeNonce,
    reconcile: dependencies.reconcile as typeof reconcile,
    finalize: dependencies.finalize as typeof finalize,
    log: dependencies.log as typeof log,
  };
}

describe("controlled document-generation recovery endpoint", () => {
  it("validates the two gates, fixed run, and both separate secrets", () => {
    expect(readDocumentGenerationRecoveryConfig({
      AGENT_EXECUTION_RECOVERY_ENDPOINT_ENABLED: "true",
      AGENT_EXECUTION_RECOVERY_ENABLED: "true",
      AGENT_EXECUTION_RECOVERY_RUN_ID: RUN_ID,
      AGENT_EXECUTION_RECOVERY_TRANSPORT_SECRET: TRANSPORT_SECRET,
      AGENT_EXECUTION_RECOVERY_AUTHORIZATION: AUTHORIZATION_SECRET,
    })).toMatchObject({ endpointEnabled: true, recoveryEnabled: true, runId: RUN_ID, valid: true });
    expect(readDocumentGenerationRecoveryConfig({
      AGENT_EXECUTION_RECOVERY_ENDPOINT_ENABLED: "true",
      AGENT_EXECUTION_RECOVERY_ENABLED: "true",
      AGENT_EXECUTION_RECOVERY_RUN_ID: RUN_ID,
      AGENT_EXECUTION_RECOVERY_TRANSPORT_SECRET: "short",
      AGENT_EXECUTION_RECOVERY_AUTHORIZATION: AUTHORIZATION_SECRET,
    }).valid).toBe(false);
  });

  it("is disabled unless both recovery gates are enabled", async () => {
    for (const disabled of [
      { ...config, endpointEnabled: false },
      { ...config, recoveryEnabled: false },
    ]) {
      const f = fixture({ config: disabled });
      const response = await handleDocumentGenerationRecovery(request(), f.dependencies);
      expect(response.status).toBe(404);
      expect(f.consumeNonce).not.toHaveBeenCalled();
      expect(f.reconcile).not.toHaveBeenCalled();
    }
  });

  it("fails closed on missing or malformed configuration", async () => {
    const f = fixture({ config: { ...config, valid: false, transportSecret: "short" } });
    const response = await handleDocumentGenerationRecovery(request(), f.dependencies);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(f.consumeNonce).not.toHaveBeenCalled();
  });

  it("accepts a valid signed empty request, derives the fixed run token, and finalizes", async () => {
    const f = fixture();
    const response = await handleDocumentGenerationRecovery(request(), f.dependencies);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "reconciled", finalization: "finalized" });
    expect(f.consumeNonce).toHaveBeenCalledWith(createHash("sha256").update(NONCE).digest("hex"));
    expect(f.reconcile).toHaveBeenCalledWith({
      runId: RUN_ID,
      authorization: {
        kind: "owner_approved_document_reconciliation",
        token: createDocumentGenerationReconciliationAuthorizationToken(AUTHORIZATION_SECRET, RUN_ID),
      },
    });
    expect(f.finalize).toHaveBeenCalledWith(RUN_ID);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(RUN_ID);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(TRANSPORT_SECRET);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(NONCE);
  });

  it("accepts null, Content-Length zero, and zero-byte stream bodies", async () => {
    for (const options of [{ contentLength: "0" }, {}]) {
      const f = fixture();
      await expect(handleDocumentGenerationRecovery(request(options), f.dependencies)).resolves.toHaveProperty("status", 200);
    }
    const bodyStream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const f = fixture();
    await expect(handleDocumentGenerationRecovery(request({ bodyStream }), f.dependencies)).resolves.toHaveProperty("status", 200);
    expect(f.reconcile).toHaveBeenCalledOnce();
  });

  it("bounds a body stream that never completes", async () => {
    const bodyStream = new ReadableStream<Uint8Array>({ start() {} });
    const f = fixture();
    const response = await handleDocumentGenerationRecovery(request({ bodyStream }), f.dependencies);
    expect(response.status).toBe(400);
    expect(f.consumeNonce).not.toHaveBeenCalled();
    expect(f.reconcile).not.toHaveBeenCalled();
  });

  it("rejects nonempty and explicitly nonzero bodies before replay or recovery", async () => {
    for (const options of [{ body: "unexpected" }, { contentLength: "1" }]) {
      const f = fixture();
      const response = await handleDocumentGenerationRecovery(request(options), f.dependencies);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(f.consumeNonce).not.toHaveBeenCalled();
      expect(f.reconcile).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed, stale, and incorrectly signed requests", async () => {
    const cases = [
      { signature: "bad" },
      { timestamp: String(Math.floor(NOW / 1000) - 301) },
      { signature: "0".repeat(64) },
      { nonce: "not-a-nonce" },
    ];
    for (const options of cases) {
      const f = fixture();
      const response = await handleDocumentGenerationRecovery(request(options), f.dependencies);
      expect(response.status).toBe(401);
      expect(f.consumeNonce).not.toHaveBeenCalled();
      expect(f.reconcile).not.toHaveBeenCalled();
    }
  });

  it("rejects a replayed nonce and never invokes the governed operation", async () => {
    const f = fixture({ consumeNonce: vi.fn(async () => false) });
    const response = await handleDocumentGenerationRecovery(request(), f.dependencies);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "duplicate_request" });
    expect(f.reconcile).not.toHaveBeenCalled();
  });

  it("allows only one of two simultaneous submissions with the same nonce", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      handleDocumentGenerationRecovery(request(), f.dependencies),
      handleDocumentGenerationRecovery(request(), f.dependencies),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(f.reconcile).toHaveBeenCalledOnce();
    expect(f.finalize).toHaveBeenCalledOnce();
  });

  it("supports an idempotent reconciliation replay and finalization replay", async () => {
    const f = fixture({
      reconcile: vi.fn(async () => ({ status: "already_reconciled" as const, snapshotRevision: 7 })),
      finalize: vi.fn(async () => ({ status: "replayed" as const })),
    });
    const response = await handleDocumentGenerationRecovery(request(), f.dependencies);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_reconciled", finalization: "replayed" });
  });

  it("preserves reconciliation when finalization is temporarily unavailable", async () => {
    const f = fixture({ finalize: vi.fn(async () => ({ status: "unavailable" as const })) });
    const response = await handleDocumentGenerationRecovery(request(), f.dependencies);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "reconciled", finalization: "pending" });
    expect(f.reconcile).toHaveBeenCalledOnce();
    expect(f.finalize).toHaveBeenCalledOnce();
  });

  it("does not retry or dispatch a worker when reconciliation is not applied", async () => {
    const f = fixture({ reconcile: vi.fn(async () => ({ status: "conflict" as const })) });
    const response = await handleDocumentGenerationRecovery(request(), f.dependencies);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "recovery_not_applied" });
    expect(f.finalize).not.toHaveBeenCalled();
  });

  it("serializes replay decisions through the nonce and governed repository boundaries", async () => {
    const f = fixture();
    const second = request({ nonce: "abcdefabcdefabcdefabcdefabcdefab" });
    const [firstResponse, secondResponse] = await Promise.all([
      handleDocumentGenerationRecovery(request(), f.dependencies),
      handleDocumentGenerationRecovery(second, f.dependencies),
    ]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(f.reconcile).toHaveBeenCalledTimes(2);
    expect(f.finalize).toHaveBeenCalledTimes(2);
  });
});
