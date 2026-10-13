import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  handlePredispatchStandardRecovery,
  readPredispatchRecoveryConfig,
  signPredispatchRecoveryRequest,
} from "@/lib/agent-runtime/predispatch-standard-recovery-trigger";

const RUN_ID = "a2000000-0000-4000-8000-000000000001";
const CLAIM_ID = "b2000000-0000-4000-8000-000000000001";
const EXECUTION_KEY = "c2000000-0000-4000-8000-000000000001";
const SECRET = "local-only-predispatch-recovery-secret-for-tests";
const SNAPSHOT_SHA256 = "d".repeat(64);
const NOW = 1_791_830_000_000;
const TIMESTAMP = String(Math.floor(NOW / 1_000));
const NONCE = "0123456789abcdef0123456789abcdef";
const PATH = "https://local.test/api/internal/predispatch-standard-recovery";

function config(overrides: Record<string, string | undefined> = {}) {
  return readPredispatchRecoveryConfig({
    AGENT_PREDISPATCH_RECOVERY_ENDPOINT_ENABLED: "true",
    AGENT_PREDISPATCH_RECOVERY_ENABLED: "true",
    AGENT_PREDISPATCH_RECOVERY_RUN_ID: RUN_ID,
    AGENT_PREDISPATCH_RECOVERY_CLAIM_ID: CLAIM_ID,
    AGENT_PREDISPATCH_RECOVERY_EXECUTION_KEY: EXECUTION_KEY,
    AGENT_PREDISPATCH_RECOVERY_SNAPSHOT_REVISION: "4",
    AGENT_PREDISPATCH_RECOVERY_SNAPSHOT_SHA256: SNAPSHOT_SHA256,
    AGENT_PREDISPATCH_RECOVERY_FENCING_GENERATION: "2",
    AGENT_PREDISPATCH_RECOVERY_TRANSPORT_SECRET: SECRET,
    ...overrides,
  });
}

function request(options: {
  nonce?: string;
  timestamp?: string;
  signature?: string;
  body?: string;
  contentLength?: string;
  bodyStream?: ReadableStream<Uint8Array>;
  path?: string;
} = {}) {
  const timestamp = options.timestamp ?? TIMESTAMP;
  const nonce = options.nonce ?? NONCE;
  return new Request(options.path ?? PATH, {
    method: "POST",
    headers: {
      "x-lvtchat-timestamp": timestamp,
      "x-lvtchat-nonce": nonce,
      "x-lvtchat-signature": options.signature ?? signPredispatchRecoveryRequest(SECRET, timestamp, nonce),
      ...(options.contentLength ? { "content-length": options.contentLength } : {}),
    },
    ...(options.bodyStream ? { body: options.bodyStream, duplex: "half" as never }
      : options.body ? { body: options.body } : {}),
  });
}

function fixture(overrides: Record<string, unknown> = {}) {
  const consumed = new Set<string>();
  const recover = vi.fn(async () => ({ status: "recovered" as const }));
  const log = vi.fn();
  return {
    recover,
    log,
    dependencies: {
      config: config(),
      now: () => NOW,
      consumeNonce: async (hash: string) => {
        if (consumed.has(hash)) return false;
        consumed.add(hash);
        return true;
      },
      recover,
      log,
      ...overrides,
    },
  };
}

describe("fixed-run pre-dispatch recovery endpoint", () => {
  it("is disabled by default and rejects malformed configuration", async () => {
    const disabled = fixture({ config: readPredispatchRecoveryConfig({}) });
    expect((await handlePredispatchStandardRecovery(request(), disabled.dependencies)).status).toBe(404);
    expect(disabled.recover).not.toHaveBeenCalled();
    for (const env of [
      { AGENT_PREDISPATCH_RECOVERY_CLAIM_ID: "bad" },
      { AGENT_PREDISPATCH_RECOVERY_SNAPSHOT_REVISION: "-1" },
      { AGENT_PREDISPATCH_RECOVERY_SNAPSHOT_SHA256: "bad" },
      { AGENT_PREDISPATCH_RECOVERY_FENCING_GENERATION: "0" },
      { AGENT_PREDISPATCH_RECOVERY_TRANSPORT_SECRET: "short" },
      { AGENT_EXECUTION_TRIGGER_SECRET: SECRET },
      { AGENT_EXECUTION_RECOVERY_TRANSPORT_SECRET: SECRET },
      { AGENT_EXECUTION_RECOVERY_AUTHORIZATION: SECRET },
    ]) {
      const f = fixture({ config: config(env) });
      expect((await handlePredispatchStandardRecovery(request(), f.dependencies)).status).toBe(503);
      expect(f.recover).not.toHaveBeenCalled();
    }
  });

  it("signs the canonical path and invokes only the server-fixed identity", async () => {
    const f = fixture();
    const response = await handlePredispatchStandardRecovery(request(), f.dependencies);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "recovered" });
    expect(f.recover).toHaveBeenCalledWith({ runId: RUN_ID, claimId: CLAIM_ID,
      executionKey: EXECUTION_KEY, snapshotRevision: 4,
      snapshotSha256: SNAPSHOT_SHA256, fencingGeneration: 2 });
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(RUN_ID);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(NONCE);
    expect(signPredispatchRecoveryRequest(SECRET, TIMESTAMP, NONCE)).toMatch(/^[0-9a-f]{64}$/);
    const wrongPath = request({ path: "https://local.test/api/internal/execution-wake" });
    expect((await handlePredispatchStandardRecovery(wrongPath, fixture().dependencies)).status).toBe(404);
  });

  it("rejects bad signatures, stale timestamps, and replay before recovery", async () => {
    for (const bad of [
      { signature: "0".repeat(64) },
      { timestamp: String(Math.floor(NOW / 1_000) - 301) },
      { nonce: "bad" },
    ]) {
      const f = fixture();
      expect((await handlePredispatchStandardRecovery(request(bad), f.dependencies)).status).toBe(401);
      expect(f.recover).not.toHaveBeenCalled();
    }
    const f = fixture();
    const [first, second] = await Promise.all([
      handlePredispatchStandardRecovery(request(), f.dependencies),
      handlePredispatchStandardRecovery(request(), f.dependencies),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(f.recover).toHaveBeenCalledOnce();
  });

  it("accepts empty streams but rejects bytes, positive length, and stalled streams", async () => {
    const empty = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    expect((await handlePredispatchStandardRecovery(request({ bodyStream: empty }), fixture().dependencies)).status).toBe(200);
    for (const bad of [{ body: "x" }, { contentLength: "1" }]) {
      const f = fixture();
      expect((await handlePredispatchStandardRecovery(request(bad), f.dependencies)).status).toBe(400);
      expect(f.recover).not.toHaveBeenCalled();
    }
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    const f = fixture();
    expect((await handlePredispatchStandardRecovery(request({ bodyStream: stalled }), f.dependencies)).status).toBe(400);
    expect(f.recover).not.toHaveBeenCalled();
  });

  it("returns only allowlisted conflict or idempotency statuses and makes no worker call", async () => {
    for (const status of ["already_recovered", "not_found", "not_eligible", "conflict", "stale_claim"] as const) {
      const f = fixture({ recover: vi.fn(async () => ({ status })) });
      const response = await handlePredispatchStandardRecovery(request(), f.dependencies);
      expect(response.status).toBe(status === "already_recovered" ? 200 : 409);
      expect(await response.json()).toEqual(status === "already_recovered"
        ? { status } : { error: "recovery_not_applied", status });
    }
    const f = fixture({ consumeNonce: vi.fn(async () => { throw new Error("secret database error"); }) });
    const response = await handlePredispatchStandardRecovery(request(), f.dependencies);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret database error");
    expect(f.recover).not.toHaveBeenCalled();
    expect(createHash("sha256").update(NONCE).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports an RPC timeout as an unknown outcome without exposing error details", async () => {
    const f = fixture({ recover: vi.fn(async () => { throw new Error("private database diagnostic"); }) });
    const response = await handlePredispatchStandardRecovery(request(), f.dependencies);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(f.log).toHaveBeenCalledWith({
      event: "predispatch_recovery_outcome_unknown",
      reason: "backend_unavailable",
    });
    expect(JSON.stringify(f.log.mock.calls)).not.toContain("private database diagnostic");
  });
});
