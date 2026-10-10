import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
const previousAutostart = process.env.HOSTINGER_PROBE_DISABLE_AUTOSTART;
process.env.HOSTINGER_PROBE_DISABLE_AUTOSTART = "true";
const {
  createHostingerProbeServer,
  HEALTH_PATH,
  runtimeDetails,
  resolvePort,
  secretFromFile,
  signProbeRequest,
  STATUS_PATH,
  WAKE_PATH,
} = await import("../../scripts/hostinger-node-runtime-probe.mjs");
if (previousAutostart === undefined) delete process.env.HOSTINGER_PROBE_DISABLE_AUTOSTART;
else process.env.HOSTINGER_PROBE_DISABLE_AUTOSTART = previousAutostart;

const SECRET = "local-only-hostinger-probe-secret-at-least-32-bytes";
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const DEPLOYABLE_ENTRY = resolve("scripts/hostinger-node-runtime-probe.mjs");
type ProbeChild = ChildProcessByStdio<null, Readable, Readable>;

async function availablePort(requestedPort = 0): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local test port.");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

function launchEntry(portValue: string | undefined, keyPath: string, mode: "direct" | "import" = "import") {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "production",
    HOSTINGER_PROBE_KEY_FILE: keyPath,
    HOSTINGER_PROBE_ENTRY_URL: pathToFileURL(DEPLOYABLE_ENTRY).href,
  };
  if (portValue !== undefined) env.PORT = portValue;
  const args = mode === "direct"
    ? [DEPLOYABLE_ENTRY]
    : ["--input-type=module", "-e", "await import(process.env.HOSTINGER_PROBE_ENTRY_URL)"];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"] as const,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  return { child, output: () => output };
}

async function waitForHealth(child: ProbeChild, port: number) {
  const deadline = Date.now() + 3_000;
  let lastError = "listener did not respond";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Probe exited before listen(): ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
        signal: AbortSignal.timeout(200),
      });
      if (response.ok) return await response.json() as Record<string, unknown>;
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "health request failed";
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Probe listener was not reachable within three seconds: ${lastError}`);
}

async function terminateChild(child: ProbeChild): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code));
  });
  child.kill("SIGTERM");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Probe did not shut down within three seconds.")), 3_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function childExitCode(child: ProbeChild, timeoutMs = 3_000): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Probe did not exit within the expected interval.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
    const probeSource = readFileSync("scripts/hostinger-node-runtime-probe.mjs", "utf8");
    const packageJson = JSON.parse(readFileSync("deploy/hostinger-node-probe/package.json", "utf8")) as {
      engines: { node: string };
      scripts: { start: string };
      dependencies?: Record<string, string>;
    };
    expect(php).toContain("$signable = \"v1\\nPOST\\n\" . $path . \"\\n\" . $timestamp . \"\\n\" . strtolower($nonce)");
    expect(php).toContain("hash_hmac('sha256', $signable, $secret)");
    expect(php).toContain("'x-lvtchat-signature: ' . $signature");
    expect(php).toContain("['case' => 'replay', 'kind' => 'replay']");
    expect(php).toContain("['case' => 'invalid-signature', 'kind' => 'invalid']");
    expect(php).toContain("['case' => 'stale-timestamp', 'kind' => 'stale']");
    expect(php).toContain("['case' => 'missing-auth', 'kind' => 'missing-auth']");
    expect(php).toContain("'missing-key',");
    expect(php).toContain("'auth-suite'");
    expect(php).not.toContain("delay-suite");
    expect(probeSource).toContain("(1|5|30)");
    expect(probeSource).not.toContain("60|90|120");
    expect(php).toContain("$case === 'overlap'");
    expect(php).toContain("$case === 'restart-observe'");
    expect(php).toContain("/probe/status");
    expect(php).toContain("OBSERVATION_FILE = __DIR__ . '/probe-observation.json'");
    expect(php).toContain("'processIdChanged' => $processIdChanged");
    expect(php).toContain("'postStatusValid' => $postStatusValid");
    expect(php).toContain("function postRestartAssessment(");
    expect(php).toContain("'graceful_shutdown_requires_owner_review'");
    expect(php).toContain("'delay_completed_normally'");
    expect(php).toContain("MAX_OBSERVATION_BYTES = 32768");
    expect(php).toContain("'transport_error' => $body === false ? 'network_error' : null");
    expect(php).toContain("PROBE_HOST_FILE = __DIR__ . '/probe-host.allow'");
    expect(php).toContain("SITE_A_HOST = 'darkblue-bear-768036.hostingersite.com'");
    expect(php).toContain("return 'https://' . $host");
    expect(php).toContain("$host === SITE_A_HOST");
    expect(php).toContain("function_exists('curl_multi_init')");
    expect(php).toContain("'follow_location' => 0");
    expect(php).toContain("CURLOPT_FOLLOWLOCATION => false");
    expect(php).toContain("CURLOPT_SSL_VERIFYPEER => true");
    expect(php).toContain("CURLOPT_PROTOCOLS => CURLPROTO_HTTPS");
    expect(php).toContain("CURLOPT_HEADERFUNCTION");
    expect(php).toContain("function classifyRedirectLocation(");
    expect(php).toContain("function redirectDiagnostic(");
    expect(php).toContain("'response_error' => $responseError");
    expect(php).toContain("'unexpected_redirect'");
    expect(php).toContain("'redirect_diagnostic' => $redirectDiagnostic");
    expect(php).toContain("'approved_site_b'");
    expect(php).toContain("'approved_port'");
    expect(php).toContain("'intermediary_indicated'");
    expect(php).not.toMatch(/(?:var_dump|print_r)\s*\(/i);
    expect(php).toContain("hostingersite\\.com|hostinger-site\\.com");
    expect(php).toContain("__DIR__ . '/https-probe.key'");
    expect(php).not.toContain("https://lvtchat.com");
    expect(php).not.toContain("PROBE_ORIGIN =");
    expect(php).not.toContain("https://" + "darkblue-bear-768036.hostingersite.com");
    expect(php).not.toMatch(/echo\s+\$(?:secret|signature|nonce)\b|var_dump\s*\(/i);
    expect(packageJson).toMatchObject({
      engines: { node: "24.x" },
      scripts: { start: "node hostinger-node-runtime-probe.mjs" },
    });
    expect(packageJson.dependencies).toBeUndefined();
    expect(probeSource).toContain("resolvePort(process.env.PORT)");
    expect(probeSource).toContain("server.listen(port, \"0.0.0.0\"");
    expect(probeSource).toContain("HOSTINGER_PROBE_DISABLE_AUTOSTART !== \"true\"");
    expect(probeSource).not.toContain("directExecution");
    expect(probeSource).not.toMatch(/(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY)/);
  });

  it("starts the actual ESM-imported entry with PORT absent, serves health within three seconds, and shuts down cleanly", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lvtchat-hostinger-entry-"));
    const keyPath = join(directory, "test-only.key");
    writeFileSync(keyPath, SECRET, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    const port = 3000;
    await availablePort(port);
    const startedAt = Date.now();
    const running = launchEntry(undefined, keyPath, "import");
    try {
      const health = await waitForHealth(running.child, port);
      expect(Date.now() - startedAt).toBeLessThan(3_000);
      expect(health).toMatchObject({ status: "ok", keyAvailable: true });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = "7234567890abcdef1234567890abcdef";
      const headers = {
        "x-lvtchat-timestamp": timestamp,
        "x-lvtchat-nonce": nonce,
        "x-lvtchat-signature": signProbeRequest(SECRET, "POST", WAKE_PATH, timestamp, nonce),
      };
      const accepted = await post(`http://127.0.0.1:${port}`, WAKE_PATH, headers);
      expect(accepted.status).toBe(200);
      await accepted.arrayBuffer();
      const replay = await post(`http://127.0.0.1:${port}`, WAKE_PATH, headers);
      expect(replay.status).toBe(409);
      await replay.arrayBuffer();
      expect(running.output()).toContain("probe_started");
      expect(running.output()).not.toContain(SECRET);
      expect(await terminateChild(running.child)).toBe(0);
    } finally {
      if (running.child.exitCode === null) {
        const exited = new Promise<void>((resolveExit) => running.child.once("exit", () => resolveExit()));
        running.child.kill("SIGKILL");
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts the actual entry with empty PORT using the documented fallback", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lvtchat-hostinger-empty-port-"));
    const keyPath = join(directory, "test-only.key");
    writeFileSync(keyPath, SECRET, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    const port = 3000;
    await availablePort(port);
    const running = launchEntry("", keyPath, "direct");
    try {
      expect(await waitForHealth(running.child, port)).toMatchObject({ status: "ok", keyAvailable: true });
      expect(await terminateChild(running.child)).toBe(0);
    } finally {
      if (running.child.exitCode === null) {
        const exited = childExitCode(running.child);
        running.child.kill("SIGKILL");
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts direct execution with PORT=3000 even when the private key is unavailable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lvtchat-hostinger-no-key-"));
    const missingKeyPath = join(directory, "missing-test-only.key");
    const port = 3000;
    await availablePort(port);
    const running = launchEntry("3000", missingKeyPath, "direct");
    try {
      const health = await waitForHealth(running.child, port);
      expect(health).toMatchObject({ status: "ok", keyAvailable: false });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = "8234567890abcdef1234567890abcdef";
      const response = await post(`http://127.0.0.1:${port}`, WAKE_PATH, {
        "x-lvtchat-timestamp": timestamp,
        "x-lvtchat-nonce": nonce,
        "x-lvtchat-signature": signProbeRequest(SECRET, "POST", WAKE_PATH, timestamp, nonce),
      });
      expect(response.status).toBe(503);
      await response.arrayBuffer();
      expect(await terminateChild(running.child)).toBe(0);
    } finally {
      if (running.child.exitCode === null) {
        const exited = new Promise<void>((resolveExit) => running.child.once("exit", () => resolveExit()));
        running.child.kill("SIGKILL");
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed and out-of-range explicit ports without starting a listener", async () => {
    expect(resolvePort(undefined)).toBe(3000);
    expect(resolvePort("")).toBe(3000);
    expect(resolvePort("   ")).toBe(3000);
    expect(resolvePort("3000")).toBe(3000);
    expect(resolvePort(" 57222 ")).toBe(57222);
    expect(resolvePort("not-a-port")).toBeNull();
    expect(resolvePort("3e3")).toBeNull();
    expect(resolvePort("0")).toBeNull();
    expect(resolvePort("65536")).toBeNull();

    const directory = mkdtempSync(join(tmpdir(), "lvtchat-hostinger-invalid-port-"));
    const missingKeyPath = join(directory, "missing-test-only.key");
    const running = launchEntry("invalid", missingKeyPath, "import");
    try {
      expect(await childExitCode(running.child)).toBe(1);
      expect(running.output()).toContain('"reason":"port_unavailable"');
      expect(running.output()).not.toContain("probe_started");
    } finally {
      if (running.child.exitCode === null) {
        const exited = childExitCode(running.child);
        running.child.kill("SIGKILL");
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
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

  it("returns only authenticated live status metrics without counting status requests", async () => {
    const probe = await startProbe();
    shutdown = () => probe.shutdown();
    const path = STATUS_PATH;
    const validHeaders = authHeaders(path, "7234567890abcdef1234567890abcdef");
    const first = await post(probe.origin, path, validHeaders);
    expect(first.status).toBe(200);
    const snapshot = await first.json() as Record<string, unknown>;
    expect(Object.keys(snapshot).sort()).toEqual(["activeCount", "instanceId", "maxObservedActive"]);
    expect(snapshot).toMatchObject({ activeCount: 0, maxObservedActive: 0 });
    expect(typeof snapshot.instanceId).toBe("string");

    const invalid = { ...authHeaders(path, "8234567890abcdef1234567890abcdef"), "x-lvtchat-signature": "0".repeat(64) };
    expect((await post(probe.origin, path, invalid)).status).toBe(401);
    const staleTimestamp = String(Math.floor(NOW / 1000) - 301);
    expect((await post(probe.origin, path, authHeaders(
      path,
      "9234567890abcdef1234567890abcdef",
      staleTimestamp,
    ))).status).toBe(401);
    expect((await post(probe.origin, path, validHeaders)).status).toBe(409);

    const nextHeaders = authHeaders(path, "a234567890abcdef1234567890abcdef");
    const next = await post(probe.origin, path, nextHeaders);
    expect(await next.json()).toEqual(snapshot);
    expect(JSON.stringify(probe.events)).not.toContain(SECRET);
    expect(JSON.stringify(probe.events)).not.toContain(validHeaders["x-lvtchat-signature"]);
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
    expect((await post(noKey.origin, STATUS_PATH, valid)).status).toBe(503);
    await noKey.shutdown();
  });

  it("returns per-process delay observations and records overlapping requests without side effects", async () => {
    const probe = await startProbe();
    shutdown = () => probe.shutdown();
    const firstPath = "/probe/delay/1";
    const secondPath = "/probe/delay/1";
    const [first, second] = await Promise.all([
      post(probe.origin, firstPath, authHeaders(firstPath, "4234567890abcdef1234567890abcdef")),
      post(probe.origin, secondPath, authHeaders(secondPath, "5234567890abcdef1234567890abcdef")),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const firstBody = await first.json() as Record<string, unknown>;
    const secondBody = await second.json() as Record<string, unknown>;
    expect(firstBody.instanceId).toBe(secondBody.instanceId);
    expect(firstBody.maxObservedActive).toBeGreaterThanOrEqual(2);
    expect(secondBody.maxObservedActive).toBeGreaterThanOrEqual(2);
    expect(Object.keys(firstBody).sort()).toEqual([
      "durationMs", "instanceId", "maxObservedActive", "probeOnly", "requestId", "status",
    ]);
    expect(firstBody.requestId).not.toBe(secondBody.requestId);
    expect(firstBody.durationMs).toBeGreaterThanOrEqual(0);
    expect(probe.events.some((event) => Number(event.maxObservedActive) >= 2)).toBe(true);
    expect(probe.events.some((event) => event.event === "request_completed")).toBe(true);
  });

  it("reports an active delay in status while excluding status polling from the count", async () => {
    const probe = await startProbe();
    shutdown = () => probe.shutdown();
    const delayPath = "/probe/delay/1";
    const delayPromise = post(probe.origin, delayPath, authHeaders(delayPath, "b234567890abcdef1234567890abcdef"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const statusPath = STATUS_PATH;
    const status = await post(probe.origin, statusPath, authHeaders(statusPath, "c234567890abcdef1234567890abcdef"));
    const snapshot = await status.json() as Record<string, unknown>;
    expect(snapshot.activeCount).toBe(1);
    expect(snapshot.maxObservedActive).toBe(1);
    const delay = await delayPromise;
    expect(delay.status).toBe(200);
    const body = await delay.json() as Record<string, unknown>;
    expect(body.instanceId).toBe(snapshot.instanceId);
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
    expect(await response.json()).toMatchObject({
      error: "probe_shutdown",
      instanceId: expect.any(String),
      requestId: expect.any(String),
      durationMs: expect.any(Number),
      maxObservedActive: 1,
    });
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

  it.skipIf(process.env.LVTCHAT_PHP_CALLER_FUNCTIONAL !== "1")(
    "runs the PHP evidence validator and persistence helpers in the approved cached PHP image",
    () => {
      const image = "sha256:c24b55afdf860c874b9ec6267ced132ff52de97d308ab08e6cf41e8596e509f7";
      const directory = mkdtempSync(join(tmpdir(), "lvtchat-php-caller-qualification-"));
      try {
        chmodSync(directory, 0o777);
        writeFileSync(join(directory, "caller.source.php"), readFileSync("scripts/hostinger-probe-caller.php"), { mode: 0o644 });
        const runner = String.raw`<?php
declare(strict_types=1);
if (!function_exists('curl_init') || !function_exists('curl_multi_init')) {
    throw new RuntimeException('required cURL capabilities missing');
}
if (PHP_VERSION !== '8.3.35') {
    throw new RuntimeException('unexpected PHP version: ' . PHP_VERSION);
}
$private = __DIR__ . '/private';
if (!mkdir($private, 0700)) throw new RuntimeException('cannot create private fixture');
if (!copy(__DIR__ . '/caller.source.php', $private . '/caller.php')) throw new RuntimeException('cannot copy caller');
define('HOSTINGER_PROBE_CALLER_LIBRARY_ONLY', true);
require $private . '/caller.php';
$assertions = 0;
function check(bool $condition, string $message): void {
    global $assertions;
    if (!$condition) throw new RuntimeException($message);
    $assertions++;
}
$preAt = '2026-10-10T12:00:00+00:00';
$activeAt = '2026-10-10T12:00:01+00:00';
$delayAt = '2026-10-10T12:00:31+00:00';
$preId = 'c44b772e-45be-4002-b51d-cf6af4373c9b';
$newId = 'd44b772e-45be-4002-b51d-cf6af4373c9b';
$requestId = 'e44b772e-45be-4002-b51d-cf6af4373c9b';
function makeRecord(string $kind, bool $active = true): array {
    global $preAt, $activeAt, $delayAt, $preId, $newId, $requestId;
    $snapshot = $active ? [
        'capturedAt' => $activeAt, 'instanceId' => $preId,
        'activeCount' => 1, 'maxObservedActive' => 2,
    ] : null;
    $record = [
        'schemaVersion' => OBSERVATION_SCHEMA_VERSION,
        'runId' => 'f44b772e-45be-4002-b51d-cf6af4373c9b',
        'phase' => $active ? 'delay_result' : 'active_not_confirmed',
        'capturedAt' => $delayAt,
        'preRestartCapturedAt' => $preAt,
        'preRestartInstanceId' => $preId,
        'preRestartActiveCount' => 0,
        'preRestartMaxObservedActive' => 2,
        'activeObservation' => $snapshot,
        'instanceId' => $active ? $preId : null,
        'activeCount' => $active ? 1 : null,
        'maxObservedActive' => $active ? 2 : null,
        'delaySeconds' => 30,
        'delayResult' => null,
    ];
    $observation = [
        'status' => 'delay_completed', 'probeOnly' => true, 'requestId' => $requestId,
        'instanceId' => $preId, 'durationMs' => 30001, 'maxObservedActive' => 2,
    ];
    $result = [
        'capturedAt' => $delayAt, 'http_status' => 200, 'duration_ms' => 32000,
        'transport_error' => null, 'response_error' => null, 'observation' => $observation,
        'callerDeadlineReached' => false, 'disposition' => $active ? 'delay_completed_normally' : 'active_observation_missing',
    ];
    if ($kind === 'shutdown') {
        $result['http_status'] = 503;
        $result['observation'] = [
            'error' => 'probe_shutdown', 'requestId' => $requestId, 'instanceId' => $preId,
            'durationMs' => 5000, 'maxObservedActive' => 2,
        ];
        $result['disposition'] = 'graceful_shutdown_indicated';
    } elseif ($kind === 'redirect') {
        $result['http_status'] = 307;
        $result['response_error'] = 'unexpected_redirect';
        $result['observation'] = null;
        $result['redirect_diagnostic'] = [
            'status' => 307, 'locationPresent' => true, 'schemeKind' => 'https',
            'hostClassification' => 'approved_site_b', 'portClassification' => 'approved_port',
            'routeKind' => 'probe_delay', 'responderHint' => 'unknown',
        ];
        $result['disposition'] = 'redirect_ambiguous';
    } elseif ($kind === 'transport') {
        $result['http_status'] = null;
        $result['transport_error'] = 'network_error';
        $result['observation'] = null;
        $result['disposition'] = 'transport_ambiguous';
    } elseif ($kind === 'timeout') {
        $result['http_status'] = null;
        $result['transport_error'] = 'timeout';
        $result['callerDeadlineReached'] = true;
        $result['observation'] = null;
        $result['disposition'] = 'timeout_ambiguous';
    }
    $record['delayResult'] = $result;
    return $record;
}
$valid = makeRecord('normal');
check(validObservationRecord($valid), 'valid delay record rejected');
check(validFreshPreRestartRecord(array_replace($valid, ['phase' => 'pre_restart', 'capturedAt' => $preAt,
    'activeObservation' => null, 'instanceId' => $preId, 'activeCount' => 0, 'maxObservedActive' => 2,
    'delayResult' => null]), strtotime($preAt) + 60), 'fresh baseline rejected');
check(!validFreshPreRestartRecord(array_replace($valid, ['phase' => 'pre_restart', 'capturedAt' => $preAt,
    'activeObservation' => null, 'instanceId' => $preId, 'activeCount' => 0, 'maxObservedActive' => 2,
    'delayResult' => null]), strtotime($preAt) + 121), 'stale baseline accepted');
check(!validObservationRecord(array_replace($valid, ['preRestartInstanceId' => 'bad'])), 'invalid baseline ID accepted');
$mismatch = $valid;
$mismatch['activeObservation']['instanceId'] = $newId;
check(!validObservationRecord($mismatch), 'mismatched active instance accepted');
$malformed = $valid;
$malformed['delayResult']['observation']['extra'] = 'unapproved';
check(!validObservationRecord($malformed), 'malformed delay response accepted');
check(delayDisposition($valid['delayResult'], $valid['activeObservation']) === 'delay_completed_normally', 'normal completion misclassified');
check(delayDisposition(makeRecord('shutdown')['delayResult'], $valid['activeObservation']) === 'graceful_shutdown_indicated', 'shutdown response not recognized');
check(delayDisposition(makeRecord('redirect')['delayResult'], $valid['activeObservation']) === 'redirect_ambiguous', 'redirect not ambiguous');
check(delayDisposition(makeRecord('transport')['delayResult'], $valid['activeObservation']) === 'transport_ambiguous', 'transport not ambiguous');
check(delayDisposition(makeRecord('timeout')['delayResult'], $valid['activeObservation']) === 'timeout_ambiguous', 'timeout not ambiguous');
check(delayDisposition($valid['delayResult'], null) === 'active_observation_missing', 'missing activity not rejected');
$assessmentCases = [
    ['normal', true, true, 'process_replacement_observed', 'delay_completed_normally'],
    ['normal', true, false, 'process_replacement_not_observed', 'interruption_unproven'],
    ['shutdown', true, true, 'process_replacement_observed', 'graceful_shutdown_requires_owner_review'],
    ['shutdown', true, false, 'process_replacement_not_observed', 'interruption_unproven'],
    ['redirect', true, true, 'process_replacement_observed', 'interruption_unproven'],
    ['redirect', true, false, 'process_replacement_not_observed', 'interruption_unproven'],
    ['transport', true, true, 'process_replacement_observed', 'interruption_unproven'],
    ['transport', true, false, 'process_replacement_not_observed', 'interruption_unproven'],
    ['timeout', true, true, 'process_replacement_observed', 'interruption_unproven'],
    ['timeout', true, false, 'process_replacement_not_observed', 'interruption_unproven'],
    ['normal', false, true, 'process_replacement_observed', 'delay_completed_normally'],
];
foreach ($assessmentCases as [$kind, $active, $changed, $expected, $interruption]) {
    $assessment = postRestartAssessment(makeRecord($kind, $active), true, $changed);
    check($assessment['assessment'] === $expected, 'unexpected process assessment for ' . $kind);
    check($assessment['interruptionAssessment'] === $interruption, 'unsafe interruption claim for ' . $kind);
}
check(postRestartAssessment($valid, false, null)['assessment'] === 'post_status_unavailable', 'failed post status misclassified');
$postRecord = $valid;
$postRecord['postRestart'] = [
    'capturedAt' => $delayAt, 'postStatusValid' => true, 'httpStatus' => 200, 'durationMs' => 5,
    'transportError' => null, 'responseError' => null, 'postRestartInstanceId' => $newId,
    'activeCount' => 0, 'maxObservedActive' => 2, 'processIdChanged' => true,
    'assessment' => 'process_replacement_observed', 'interruptionAssessment' => 'delay_completed_normally',
];
check(validObservationRecord($postRecord), 'post-status structure rejected');
check(validObservationRecord($valid), 'evidence changed during assessment');
check(!postRestartEvidenceAlreadyRecorded($valid), 'unrecorded post status treated as recorded');
check(postRestartEvidenceAlreadyRecorded($postRecord), 'repeat post status was not blocked');
$activeOnly = $valid;
$activeOnly['phase'] = 'active_confirmed';
$activeOnly['capturedAt'] = $activeAt;
$activeOnly['delayResult'] = null;
check(validObservationRecord($activeOnly), 'active-only snapshot rejected');
check(postRestartAssessment($activeOnly, true, true)['interruptionAssessment'] === 'interruption_unproven',
    'missing delay result qualified interruption');
$privateFile = OBSERVATION_FILE;
check(writeObservationRecord($valid), 'atomic evidence write failed');
check(validObservationRecord(readObservationRecord() ?? []), 'saved evidence did not validate');
check((fileperms($privateFile) & 0077) === 0, 'evidence file is not mode 0600');
check(count(glob(OBSERVATION_FILE . '.*.tmp') ?: []) === 0, 'atomic temporary file remained after successful write');
$beforeFailure = file_get_contents($privateFile);
chmod(dirname($privateFile), 0500);
$failedWrite = writeObservationRecord($postRecord);
chmod(dirname($privateFile), 0700);
check(!$failedWrite, 'persistence failure was not detected');
check(file_get_contents($privateFile) === $beforeFailure, 'failed persistence damaged original evidence');
unlink($privateFile);
file_put_contents($privateFile, '{');
chmod($privateFile, 0600);
check(readObservationRecord() === null, 'corrupt JSON accepted');
unlink($privateFile);
file_put_contents($privateFile, json_encode($valid));
chmod($privateFile, 0644);
check(readObservationRecord() === null, 'unsafe permissions accepted');
chmod($privateFile, 0600);
unlink($privateFile);
file_put_contents(__DIR__ . '/target.json', json_encode($valid));
chmod(__DIR__ . '/target.json', 0600);
symlink(__DIR__ . '/target.json', $privateFile);
check(readObservationRecord() === null, 'symlinked evidence accepted');
check(!writeObservationRecord($valid), 'writer replaced symlink');
unlink($privateFile);
unlink(__DIR__ . '/target.json');
file_put_contents($private . '/probe-host.allow', 'fixture.hostingersite.com' . PHP_EOL);
chmod($private . '/probe-host.allow', 0600);
file_put_contents($private . '/https-probe.key', 'local-only-synthetic-caller-key-0123456789');
chmod($private . '/https-probe.key', 0600);
function invokeCaller(string $mode, bool $startServer = true): array {
    global $private, $preId;
    $server = null;
    $serverPipes = [];
    if ($startServer) {
        $server = proc_open([PHP_BINARY, __DIR__ . '/server.php'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $serverPipes, __DIR__, ['PATH' => getenv('PATH') ?: '/usr/bin', 'LVTCHAT_FIXTURE_MODE' => $mode,
                'LVTCHAT_FIXTURE_SECRET' => 'local-only-synthetic-caller-key-0123456789']);
        check(is_resource($server), 'cannot start local TLS fixture');
        check(trim((string)fgets($serverPipes[1])) === 'READY', 'local TLS fixture did not become ready');
    }
    $caller = proc_open([PHP_BINARY, '-d', 'openssl.cafile=' . __DIR__ . '/fixture.crt',
        $private . '/caller.php', 'restart-post'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $callerPipes, $private, ['PATH' => getenv('PATH') ?: '/usr/bin']);
    check(is_resource($caller), 'cannot start actual PHP caller');
    fclose($callerPipes[0]);
    $stdout = stream_get_contents($callerPipes[1]);
    $stderr = stream_get_contents($callerPipes[2]);
    fclose($callerPipes[1]);
    fclose($callerPipes[2]);
    $exitCode = proc_close($caller);
    if (is_resource($server)) {
        fclose($serverPipes[0]);
        stream_get_contents($serverPipes[1]);
        $serverError = stream_get_contents($serverPipes[2]);
        fclose($serverPipes[1]);
        fclose($serverPipes[2]);
        check(proc_close($server) === 0, 'local TLS fixture failed: ' . $serverError);
    }
    check(is_string($stdout) && $stdout !== '', 'caller emitted no JSON: ' . $stderr);
    $decoded = json_decode($stdout, true, 16, JSON_THROW_ON_ERROR);
    check(!str_contains($stdout, 'local-only-synthetic-caller-key-0123456789'), 'caller output disclosed test credential');
    return [$exitCode, $decoded];
}
function runPostCase(array $record, string $mode, bool $startServer = true): array {
    $saved = writeObservationRecord($record);
    check($saved, 'cannot install synthetic prior evidence valid=' . (int)validObservationRecord($record)
        . ' dirMode=' . decoct(fileperms(dirname(OBSERVATION_FILE)) & 0777)
        . ' link=' . (int)is_link(OBSERVATION_FILE));
    return invokeCaller($mode, $startServer);
}
$before = makeRecord('normal');
[$changedExit, $changedOutput] = runPostCase($before, 'changed');
$changedResult = $changedOutput['results'][0];
check($changedExit === 0 && $changedResult['postStatusValid'] === true, 'valid signed post-status failed');
check($changedResult['processIdChanged'] === true && $changedResult['assessment'] === 'process_replacement_observed',
    'changed instance was not reported as process replacement');
check($changedResult['interruptionAssessment'] === 'delay_completed_normally',
    'normal HTTP 200 completion was incorrectly qualified as interruption');
$after = readObservationRecord();
check(is_array($after) && $after['preRestartInstanceId'] === $preId
    && $after['activeObservation'] === $before['activeObservation']
    && $after['delayResult'] === $before['delayResult'], 'post-status append erased original evidence');
[$repeatExit, $repeatOutput] = invokeCaller('changed', false);
check($repeatExit === 1 && $repeatOutput['results'][0]['evidenceError'] === 'post_status_already_recorded',
    'repeated post status was not rejected');
$sameRecord = makeRecord('normal');
[$sameExit, $sameOutput] = runPostCase($sameRecord, 'same');
check($sameExit === 0 && $sameOutput['results'][0]['processIdChanged'] === false
    && $sameOutput['results'][0]['assessment'] === 'process_replacement_not_observed', 'unchanged process ID misreported');
$shutdownRecord = makeRecord('shutdown');
[$shutdownExit, $shutdownOutput] = runPostCase($shutdownRecord, 'changed');
check($shutdownExit === 0
    && $shutdownOutput['results'][0]['interruptionAssessment'] === 'graceful_shutdown_requires_owner_review',
    'graceful shutdown indicator was not left conditional on owner review');
foreach (['redirect', 'transport', 'timeout'] as $ambiguousKind) {
    foreach (['changed', 'same'] as $instanceMode) {
        $ambiguous = makeRecord($ambiguousKind);
        [$ambiguousExit, $ambiguousOutput] = runPostCase($ambiguous, $instanceMode);
        check($ambiguousExit === 0
            && $ambiguousOutput['results'][0]['interruptionAssessment'] === 'interruption_unproven',
            $ambiguousKind . ' plus ' . $instanceMode . ' instance incorrectly qualified interruption');
        $preserved = readObservationRecord();
        check(is_array($preserved) && $preserved['delayResult'] === $ambiguous['delayResult'],
            $ambiguousKind . ' evidence was not preserved');
    }
}
foreach (['invalid', 'unauthorized', 'disconnect'] as $failureMode) {
    $failureRecord = makeRecord('normal');
    [$failureExit, $failureOutput] = runPostCase($failureRecord, $failureMode);
    check($failureExit === 1 && $failureOutput['results'][0]['postStatusValid'] === false,
        'failed post-status was accepted: ' . $failureMode);
    $failureSaved = readObservationRecord();
    check(is_array($failureSaved) && $failureSaved['delayResult'] === $failureRecord['delayResult']
        && $failureSaved['postRestart']['assessment'] === 'post_status_unavailable',
        'failed post-status damaged prior evidence: ' . $failureMode);
}
$noActive = makeRecord('normal', false);
[$noActiveExit, $noActiveOutput] = runPostCase($noActive, 'changed');
check($noActiveExit === 0 && $noActiveOutput['results'][0]['interruptionAssessment'] === 'delay_completed_normally',
    'missing active snapshot was represented as interruption');
$persistFailureRecord = makeRecord('transport');
check(writeObservationRecord($persistFailureRecord), 'cannot install persistence-failure evidence');
$persistBefore = file_get_contents(OBSERVATION_FILE);
chmod($private, 0500);
[$persistExit, $persistOutput] = invokeCaller('same');
chmod($private, 0700);
check($persistExit === 1 && $persistOutput['results'][0]['evidenceSaved'] === false,
    'post-status persistence failure was accepted');
check(file_get_contents(OBSERVATION_FILE) === $persistBefore,
    'failed post-status persistence overwrote the earlier record');
check((fileperms(OBSERVATION_FILE) & 0077) === 0, 'actual caller evidence lost mode 0600');
chmod($private, 0777);
echo json_encode(['phpVersion' => PHP_VERSION, 'curl' => function_exists('curl_init'),
    'curlMulti' => function_exists('curl_multi_init'), 'assertions' => $assertions], JSON_THROW_ON_ERROR) . PHP_EOL;
`;
        writeFileSync(join(directory, "qualification.php"), runner, { mode: 0o644 });
        writeFileSync(join(directory, "server.php"), String.raw`<?php
declare(strict_types=1);
$mode = getenv('LVTCHAT_FIXTURE_MODE') ?: 'changed';
$secret = getenv('LVTCHAT_FIXTURE_SECRET') ?: '';
$context = stream_context_create(['ssl' => [
    'local_cert' => __DIR__ . '/fixture.crt', 'local_pk' => __DIR__ . '/fixture.key',
    'allow_self_signed' => true,
]]);
$server = stream_socket_server('tcp://0.0.0.0:443', $errno, $error, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN, $context);
if ($server === false) throw new RuntimeException('TLS fixture bind failed: ' . $error);
echo 'READY' . PHP_EOL;
$client = stream_socket_accept($server, 8);
if ($client === false) throw new RuntimeException('TLS fixture did not receive caller');
if (!stream_socket_enable_crypto($client, true, STREAM_CRYPTO_METHOD_TLS_SERVER)) {
    throw new RuntimeException('TLS handshake failed');
}
$requestLine = trim((string)fgets($client));
$headers = [];
while (($line = fgets($client)) !== false && trim($line) !== '') {
    if (str_contains($line, ':')) {
        [$name, $value] = explode(':', $line, 2);
        $headers[strtolower(trim($name))] = trim($value);
    }
}
$path = parse_url(explode(' ', $requestLine)[1] ?? '/', PHP_URL_PATH) ?: '/';
$timestamp = $headers['x-lvtchat-timestamp'] ?? '';
$nonce = strtolower($headers['x-lvtchat-nonce'] ?? '');
$signature = $headers['x-lvtchat-signature'] ?? '';
$message = "v1\nPOST\n" . $path . "\n" . $timestamp . "\n" . $nonce;
$valid = preg_match('/^POST /', $requestLine) === 1 && $path === '/probe/status'
    && preg_match('/^\d{10}$/D', $timestamp) === 1
    && abs(time() - (int)$timestamp) <= 300
    && preg_match('/^[0-9a-f]{32}$/D', $nonce) === 1
    && preg_match('/^[0-9a-f]{64}$/iD', $signature) === 1
    && hash_equals(hash_hmac('sha256', $message, $secret), $signature);
if ($mode === 'disconnect') {
    fclose($client);
    fclose($server);
    exit(0);
}
if (!$valid || $mode === 'unauthorized') {
    $status = 401;
    $body = '{"error":"unauthorized"}';
} elseif ($mode === 'invalid') {
    $status = 200;
    $body = '{}';
} else {
    $status = 200;
    $instanceId = $mode === 'same' ? 'c44b772e-45be-4002-b51d-cf6af4373c9b'
        : 'd44b772e-45be-4002-b51d-cf6af4373c9b';
    $body = json_encode(['instanceId' => $instanceId, 'activeCount' => 0, 'maxObservedActive' => 2], JSON_THROW_ON_ERROR);
}
fwrite($client, "HTTP/1.1 " . $status . " " . ($status === 200 ? 'OK' : 'Unauthorized') . "\r\n"
    . "Content-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: " . strlen($body)
    . "\r\nConnection: close\r\n\r\n" . $body);
fclose($client);
fclose($server);
` , { mode: 0o644 });
        execFileSync("openssl", [
          "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, "fixture.key"),
          "-out", join(directory, "fixture.crt"), "-days", "1", "-subj", "/CN=fixture.hostingersite.com",
          "-addext", "subjectAltName=DNS:fixture.hostingersite.com",
        ], { stdio: "ignore", timeout: 10_000 });
        chmodSync(join(directory, "fixture.key"), 0o600);
        chmodSync(join(directory, "fixture.crt"), 0o644);
        const testUid = String(process.getuid?.() ?? 65534);
        const testGid = String(process.getgid?.() ?? 65534);
        let output: string;
        try {
          output = execFileSync("docker", [
            "run", "--rm", "--network=none", "--cap-add=NET_BIND_SERVICE", "--add-host=fixture.hostingersite.com:127.0.0.1",
            "--user", `${testUid}:${testGid}`,
            "--volume", `${directory}:/qualification:rw`, image,
            "php", "/qualification/qualification.php",
          ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
        } catch (error) {
          const details = error as NodeJS.ErrnoException & { stderr?: Buffer; stdout?: Buffer };
          throw new Error(`PHP caller fixture failed: ${details.stderr?.toString() ?? ""}${details.stdout?.toString() ?? ""}`);
        }
        const result = JSON.parse(output.trim()) as Record<string, unknown>;
        expect(result).toMatchObject({ phpVersion: "8.3.35", curl: true, curlMulti: true });
        expect(result.assertions).toBeGreaterThan(100);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
