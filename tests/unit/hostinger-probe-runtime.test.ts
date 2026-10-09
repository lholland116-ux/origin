import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcessByStdio } from "node:child_process";
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
    expect(php).toContain("'delay-suite'");
    expect(php).toContain("$case === 'overlap'");
    expect(php).toContain("PROBE_HOST_FILE = __DIR__ . '/probe-host.allow'");
    expect(php).toContain("SITE_A_HOST = 'darkblue-bear-768036.hostingersite.com'");
    expect(php).toContain("return 'https://' . $host");
    expect(php).toContain("$host === SITE_A_HOST");
    expect(php).toContain("function_exists('curl_multi_init')");
    expect(php).toContain("'follow_location' => 0");
    expect(php).toContain("CURLOPT_FOLLOWLOCATION => false");
    expect(php).toContain("CURLOPT_SSL_VERIFYPEER => true");
    expect(php).toContain("CURLOPT_PROTOCOLS => CURLPROTO_HTTPS");
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
