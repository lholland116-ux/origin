import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHostingerProbeServer,
  HEALTH_PATH,
  runtimeDetails,
  secretFromFile,
  signProbeRequest,
  WAKE_PATH,
} from "../../scripts/hostinger-node-runtime-probe.mjs";

const SECRET = "local-only-hostinger-probe-secret-at-least-32-bytes";
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

function authHeaders(path: string, nonce = "1234567890abcdef1234567890abcdef", timestamp = String(Math.floor(NOW / 1000))) {
  return {
    "x-lvtchat-timestamp": timestamp,
    "x-lvtchat-nonce": nonce,
    "x-lvtchat-signature": signProbeRequest(SECRET, "POST", path, timestamp, nonce),
  };
}

async function startProbe(options: { secret?: string | null; shutdownGraceMs?: number } = {}) {
  const events: Array<Record<string, unknown>> = [];
  const probe = createHostingerProbeServer({
    secret: options.secret === undefined ? SECRET : options.secret ?? undefined,
    now: () => NOW,
    log: (event: Record<string, unknown>) => {
      events.push(event);
      return true;
    },
    shutdownGraceMs: options.shutdownGraceMs ?? 20,
  });
  await new Promise<void>((resolve) => probe.server.listen(0, "127.0.0.1", resolve));
  const address = probe.server.address();
  if (!address || typeof address === "string") throw new Error("Local probe server did not bind a TCP port.");
  return { ...probe, events, origin: `http://127.0.0.1:${address.port}` };
}

async function post(origin: string, path: string, headers: Record<string, string>, signal?: AbortSignal) {
  return fetch(`${origin}${path}`, { method: "POST", headers, signal });
}

describe("Hostinger test probe protocol", () => {
  let shutdown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await shutdown?.();
    shutdown = undefined;
  });

  it("matches the documented PHP/Node HMAC-SHA256 byte contract", () => {
    expect(signProbeRequest(
      "test-only-secret-at-least-32-bytes",
      "POST",
      WAKE_PATH,
      "1791552000",
      "1234567890abcdef1234567890abcdef",
    )).toBe("5e96ee8cfc75918009d5c2a3653c584d5cf32f60a4cc49505c6eecd4402926a7");

    const php = readFileSync("scripts/hostinger-probe-caller.php", "utf8");
    expect(php).toContain("$signable = \"v1\\nPOST\\n\" . $cases[$case]['path']");
    expect(php).toContain("hash_hmac('sha256', $signable, $secret)");
    expect(php).toContain("'x-lvtchat-signature: ' . $signature");
    expect(php).toContain("'replay' => [");
    expect(php).toContain("'invalid-signature' => [");
    expect(php).toContain("'stale-timestamp' => [");
    expect(php).toContain("'missing-key' => [");
    expect(php).toContain("__DIR__ . '/https-probe.key'");
    expect(php).toContain("darkblue-bear-768036.hostingersite.com");
    expect(php).not.toContain("https://lvtchat.com");
    expect(php).not.toMatch(/echo\s+\$(?:secret|signature|nonce)\b|var_dump\s*\(/i);
  });

  it("accepts one authenticated wake request and rejects its exact replay", async () => {
    const probe = await startProbe();
    shutdown = () => probe.shutdown();
    const headers = authHeaders(WAKE_PATH);
    const first = await post(probe.origin, WAKE_PATH, headers);
    const second = await post(probe.origin, WAKE_PATH, headers);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await first.json()).toMatchObject({ status: "accepted", probeOnly: true });
    expect(JSON.stringify(probe.events)).not.toContain(SECRET);
    expect(JSON.stringify(probe.events)).not.toContain(headers["x-lvtchat-signature"]);
    expect(JSON.stringify(probe.events)).not.toContain(headers["x-lvtchat-nonce"]);
  });

  it("rejects stale and invalid MACs and reports missing test key only as a boolean", async () => {
    const probe = await startProbe();
    shutdown = () => probe.shutdown();
    const health = await fetch(`${probe.origin}${HEALTH_PATH}`);
    expect(await health.json()).toMatchObject({ status: "ok", keyAvailable: true });

    const valid = authHeaders(WAKE_PATH, "2234567890abcdef1234567890abcdef");
    const invalid = { ...valid, "x-lvtchat-signature": "0".repeat(64) };
    const staleTimestamp = String(Math.floor(NOW / 1000) - 301);
    const stale = authHeaders(WAKE_PATH, "3234567890abcdef1234567890abcdef", staleTimestamp);
    expect((await post(probe.origin, WAKE_PATH, invalid)).status).toBe(401);
    expect((await post(probe.origin, WAKE_PATH, stale)).status).toBe(401);

    const noKey = await startProbe({ secret: "short" });
    const healthWithoutKey = await fetch(`${noKey.origin}${HEALTH_PATH}`);
    expect(await healthWithoutKey.json()).toMatchObject({ keyAvailable: false });
    expect((await post(noKey.origin, WAKE_PATH, valid)).status).toBe(503);
    await noKey.shutdown();
  });

  it("measures bounded delays and records overlapping requests without side effects", async () => {
    const probe = await startProbe();
    shutdown = () => probe.shutdown();
    const firstPath = "/probe/delay/1";
    const secondPath = "/probe/delay/1";
    const [first, second] = await Promise.all([
      post(probe.origin, firstPath, authHeaders(firstPath, "4234567890abcdef1234567890abcdef")),
      post(probe.origin, secondPath, authHeaders(secondPath, "5234567890abcdef1234567890abcdef")),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(probe.events.some((event) => Number(event.maxObservedActive) >= 2)).toBe(true);
    expect(probe.events.some((event) => event.event === "request_completed")).toBe(true);
  });

  it("interrupts an in-flight harmless delay during graceful shutdown", async () => {
    const probe = await startProbe({ shutdownGraceMs: 20 });
    shutdown = () => probe.shutdown();
    const path = "/probe/delay/5";
    const responsePromise = post(probe.origin, path, authHeaders(path, "6234567890abcdef1234567890abcdef"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await probe.shutdown();
    shutdown = undefined;
    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(probe.events.some((event) => event.event === "request_interrupted")).toBe(true);
  });

  it("can identify a Node 24 runtime without treating local Node version as remote evidence", () => {
    expect(runtimeDetails("24.11.1").nodeMajor).toBe(24);
    expect(runtimeDetails("25.8.1").nodeMajor).toBe(25);
  });

  it("loads only a private regular test key and rejects group/world-readable files", () => {
    const directory = mkdtempSync(join(tmpdir(), "lvtchat-hostinger-probe-"));
    const keyPath = join(directory, "test-only.key");
    try {
      writeFileSync(keyPath, "local-only-probe-key-with-at-least-32-bytes\n", { mode: 0o600 });
      chmodSync(keyPath, 0o600);
      expect(secretFromFile(keyPath)).toBe("local-only-probe-key-with-at-least-32-bytes");
      chmodSync(keyPath, 0o644);
      expect(secretFromFile(keyPath)).toBeNull();
      expect(secretFromFile(join(directory, "missing.key"))).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
