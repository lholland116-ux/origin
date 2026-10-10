#!/usr/bin/env node

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";

export const WAKE_PATH = "/api/internal/execution-wake";
export const HEALTH_PATH = "/healthz";
export const STATUS_PATH = "/probe/status";
export const PROBE_DELAY_PATH = /^\/probe\/delay\/(1|5|30)$/;
export const MAX_CLOCK_SKEW_SECONDS = 300;
export const NONCE_TTL_MS = 10 * 60 * 1000;
export const MAX_ACTIVE_REQUESTS = 8;
export const SHUTDOWN_GRACE_MS = 5_000;
const NONCE_PATTERN = /^[0-9a-f]{32}$/i;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

export function signProbeRequest(secret, method, path, timestamp, nonce) {
  const message = `v1\n${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce.toLowerCase()}`;
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

export function secretFromFile(path) {
  if (typeof path !== "string" || path.length === 0) return null;
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) return null;
    const secret = readFileSync(path, "utf8").replace(/[\r\n]+$/u, "");
    return Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
  } catch {
    return null;
  }
}

export function runtimeDetails(version = process.versions.node) {
  const major = Number(version.split(".", 1)[0]);
  return { nodeMajor: Number.isSafeInteger(major) ? major : null, nodeVersion: version };
}

export function resolvePort(rawPort) {
  if (rawPort === undefined) return 3000;
  if (typeof rawPort !== "string") return null;
  const normalized = rawPort.trim();
  if (normalized.length === 0) return 3000;
  if (!/^\d+$/.test(normalized)) return null;
  const port = Number(normalized);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * @param {{ secret?: string | null, now?: () => number, log?: (event: Record<string, unknown>) => unknown, maxActiveRequests?: number, shutdownGraceMs?: number }} [options]
 */
export function createHostingerProbeServer({
  secret,
  now = Date.now,
  log = (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  maxActiveRequests = MAX_ACTIVE_REQUESTS,
  shutdownGraceMs = SHUTDOWN_GRACE_MS,
} = {}) {
  const instanceId = randomUUID();
  const keyAvailable = typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
  const nonceHashes = new Map();
  const activeResponses = new Set();
  let activeCount = 0;
  let maxObservedActive = 0;
  let shuttingDown = false;

  const emit = (event) => {
    const memory = process.memoryUsage();
    log({
      component: "hostinger_runtime_probe",
      instanceId,
      at: new Date(now()).toISOString(),
      ...event,
      activeCount,
      maxObservedActive,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    });
  };

  const consumeNonce = (nonce) => {
    const current = now();
    for (const [hash, expiry] of nonceHashes) {
      if (expiry <= current) nonceHashes.delete(hash);
    }
    const hash = createHash("sha256").update(nonce.toLowerCase(), "utf8").digest("hex");
    if (nonceHashes.has(hash)) return false;
    nonceHashes.set(hash, current + NONCE_TTL_MS);
    return true;
  };

  const authenticate = (request, pathname) => {
    if (!keyAvailable) return { status: 503 };
    const timestamp = request.headers["x-lvtchat-timestamp"] ?? "";
    const nonce = request.headers["x-lvtchat-nonce"] ?? "";
    const signature = request.headers["x-lvtchat-signature"] ?? "";
    if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp)
      || typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)
      || typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) return { status: 401 };
    if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return { status: 401 };
    const expected = Buffer.from(signProbeRequest(secret, "POST", pathname, timestamp, nonce), "hex");
    const supplied = Buffer.from(signature, "hex");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { status: 401 };
    if (!consumeNonce(nonce)) return { status: 409 };
    return { status: 200 };
  };

  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === HEALTH_PATH) {
      return json(response, 200, { status: "ok", ...runtimeDetails(), keyAvailable });
    }
    if (shuttingDown) {
      request.resume();
      return json(response, 503, { error: "probe_shutting_down" });
    }

    const delayMatch = request.method === "POST" ? PROBE_DELAY_PATH.exec(url.pathname) : null;
    const statusRequest = request.method === "POST" && url.pathname === STATUS_PATH;
    const path = request.method === "POST" && url.pathname === WAKE_PATH
      ? WAKE_PATH
      : delayMatch ? url.pathname : statusRequest ? STATUS_PATH : null;
    if (!path) {
      request.resume();
      return json(response, 404, { error: "not_found" });
    }
    if ((request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
      || request.headers["transfer-encoding"] !== undefined) {
      request.resume();
      return json(response, 400, { error: "invalid_request" });
    }

    const auth = authenticate(request, path);
    if (auth.status !== 200) {
      request.resume();
      emit({ event: "request_rejected", pathKind: delayMatch ? "delay" : statusRequest ? "status" : "wake", status: auth.status });
      return json(response, auth.status, { error: auth.status === 409 ? "duplicate_trigger" : "unauthorized" });
    }
    if (statusRequest) {
      request.resume();
      emit({ event: "status_observed" });
      return json(response, 200, { instanceId, activeCount, maxObservedActive });
    }
    if (activeCount >= maxActiveRequests) {
      request.resume();
      emit({ event: "request_rejected", pathKind: delayMatch ? "delay" : "wake", status: 503, reason: "capacity" });
      return json(response, 503, { error: "probe_capacity" });
    }

    const requestId = randomUUID();
    const startedAt = now();
    const pathKind = delayMatch ? "delay" : "wake";
    const delayMs = delayMatch ? Number(delayMatch[1]) * 1000 : 0;
    let settled = false;
    let timer;
    activeCount += 1;
    maxObservedActive = Math.max(maxObservedActive, activeCount);
    const finalize = (status, event, payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      activeCount -= 1;
      activeResponses.delete(finalize);
      const durationMs = Math.max(0, now() - startedAt);
      emit({ event, requestId, pathKind, status, durationMs });
      if (!response.destroyed) {
        json(response, status, pathKind === "delay" ? {
          ...payload,
          requestId,
          instanceId,
          durationMs,
          maxObservedActive,
        } : payload);
      }
    };
    activeResponses.add(finalize);
    response.on("close", () => {
      if (!response.writableFinished) finalize(499, "request_interrupted", { error: "probe_client_disconnected" });
    });
    request.on("aborted", () => finalize(499, "request_interrupted", { error: "probe_client_disconnected" }));
    emit({ event: "request_started", requestId, pathKind, delayMs });

    if (delayMs === 0) {
      finalize(200, "request_completed", {
        status: "accepted",
        probeOnly: true,
        requestId,
        durationMs: Math.max(0, now() - startedAt),
      });
      return;
    }
    timer = setTimeout(() => finalize(200, "request_completed", {
      status: "delay_completed",
      probeOnly: true,
      requestId,
      durationMs: Math.max(0, now() - startedAt),
    }), delayMs);
  });

  return {
    server,
    async shutdown(reason = "requested") {
      if (shuttingDown) return;
      shuttingDown = true;
      emit({ event: "shutdown_started", reason, activeCount });
      const closed = new Promise((resolve) => server.close(resolve));
      const graceTimer = setTimeout(() => {
        for (const finalize of [...activeResponses]) {
          finalize(503, "request_interrupted", { error: "probe_shutdown" });
        }
      }, shutdownGraceMs);
      await closed;
      clearTimeout(graceTimer);
      emit({ event: "shutdown_completed", reason });
    },
  };
}

async function main() {
  const runtime = runtimeDetails();
  if (process.env.HOSTINGER_PROBE_REQUIRE_NODE24 === "true" && runtime.nodeMajor !== 24) {
    process.stderr.write(`${JSON.stringify({ event: "probe_start_rejected", reason: "node24_required", nodeMajor: runtime.nodeMajor })}\n`);
    process.exitCode = 1;
    return;
  }
  const secret = secretFromFile(process.env.HOSTINGER_PROBE_KEY_FILE);
  const probe = createHostingerProbeServer({ secret });
  const port = resolvePort(process.env.PORT);
  if (port === null) {
    process.stderr.write(`${JSON.stringify({ event: "probe_start_rejected", reason: "port_unavailable" })}\n`);
    process.exitCode = 1;
    return;
  }
  probe.server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`${JSON.stringify({
      component: "hostinger_runtime_probe",
      event: "probe_started",
      ...runtime,
      keyAvailable: Boolean(secret),
      timestamp: new Date().toISOString(),
    })}\n`);
  });
  const shutdown = (signal) => {
    void probe.shutdown(signal).then(() => { process.exitCode = 0; });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// Hostinger may load the configured entry file through an ESM import rather
// than execute it as process.argv[1]. This file is the deployable application
// entry point, so start by default in either mode. Tests that import the module
// for its helpers can explicitly opt out.
if (process.env.HOSTINGER_PROBE_DISABLE_AUTOSTART !== "true") void main();
