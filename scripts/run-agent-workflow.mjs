#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

const APP_ORIGIN = "https://lvtchat.com";
const WAKE_PATH = "/api/internal/execution-wake";
const STATUS_PATH = "/api/v1/agent-workflows";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE = /^[0-9a-f]{32}$/;
const MAX_STEPS = 64;
const MAX_NO_PROGRESS_WAKES_PER_STEP = 2;
const MAX_RUN_DURATION_MS = 10 * 60 * 1000;
const WAKE_TIMEOUT_MS = 35_000;
const STATUS_TIMEOUT_MS = 10_000;

export class WorkflowRunnerError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkflowRunnerError";
    this.code = code;
  }
}

export function executionWakeSignature(secret, timestamp, nonce, runId) {
  const message = `v2\nPOST\n${WAKE_PATH}\n${runId.toLowerCase()}\n${timestamp}\n${nonce.toLowerCase()}`;
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function validateStatus(payload, runId) {
  const status = payload && typeof payload === "object" ? payload.status : null;
  if (status && status.runId === runId) {
    if (status.recoveryRequired === true) throw new WorkflowRunnerError("recovery_required");
    if (status.failurePresent === true || status.state === "failed") throw new WorkflowRunnerError("workflow_failed");
    if (status.controlState && status.controlState !== "active") throw new WorkflowRunnerError("workflow_control_blocked");
    if (status.state === "approval_required" || (Array.isArray(status.approvalCheckpoints)
      && status.approvalCheckpoints.some((checkpoint) => checkpoint?.state === "pending"))) {
      throw new WorkflowRunnerError("approval_required");
    }
  }
  if (!status || status.schemaVersion !== 1 || status.runId !== runId
    || !["prepared", "executing", "completed"].includes(status.state)
    || status.controlState !== "active" || status.failurePresent !== false
    || status.recoveryRequired !== false || !Array.isArray(status.steps)
    || status.steps.length < 1 || status.steps.length > MAX_STEPS
    || !Number.isSafeInteger(status.totalStepCount) || status.totalStepCount !== status.steps.length
    || !Number.isSafeInteger(status.completedStepCount) || status.completedStepCount > status.totalStepCount
    || !Array.isArray(status.approvalCheckpoints)
    || status.approvalCheckpoints.length > MAX_STEPS
    || status.approvalCheckpoints.some((checkpoint) => !checkpoint || checkpoint.state !== "approved")) {
    throw new WorkflowRunnerError("unexpected_workflow_status");
  }
  const ids = new Set();
  for (const step of status.steps) {
    if (!step || typeof step.id !== "string" || step.id.length < 1 || step.id.length > 128
      || ids.has(step.id) || !["pending", "running", "retry_pending", "succeeded", "failed", "skipped"].includes(step.state)) {
      throw new WorkflowRunnerError("invalid_workflow_status");
    }
    ids.add(step.id);
  }
  if (status.completedStepCount !== status.steps.filter((step) => step.state === "succeeded").length) {
    throw new WorkflowRunnerError("invalid_workflow_status");
  }
  if (status.steps.some((step) => step.state === "running" || step.state === "retry_pending"
    || step.state === "failed" || step.state === "skipped")) {
    throw new WorkflowRunnerError("workflow_requires_operator_review");
  }
  return status;
}

function nextPendingStep(status) {
  const index = status.steps.findIndex((step) => step.state !== "succeeded");
  if (index < 0) return null;
  if (status.steps[index].state !== "pending"
    || status.steps.slice(0, index).some((step) => step.state !== "succeeded")) {
    throw new WorkflowRunnerError("workflow_step_order_conflict");
  }
  return { index, step: status.steps[index] };
}

function sameSteps(left, right, targetIndex, allowTargetCompletion) {
  return left.steps.length === right.steps.length && left.steps.every((step, index) => {
    if (index === targetIndex && allowTargetCompletion && step.state === "pending") {
      return right.steps[index].state === "succeeded";
    }
    return right.steps[index].id === step.id && right.steps[index].state === step.state;
  });
}

function timeoutSignal(ms) {
  if (typeof AbortSignal?.timeout !== "function") throw new WorkflowRunnerError("bounded_timeout_unavailable");
  return AbortSignal.timeout(ms);
}

async function getAuthoritativeStatus({ fetchImpl, runId, ownerCookie }) {
  let response;
  try {
    response = await fetchImpl(`${APP_ORIGIN}${STATUS_PATH}/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers: { accept: "application/json", cookie: ownerCookie },
      cache: "no-store",
      redirect: "error",
      signal: timeoutSignal(STATUS_TIMEOUT_MS),
    });
  } catch {
    throw new WorkflowRunnerError("status_request_failed");
  }
  if (response.status !== 200) throw new WorkflowRunnerError("status_not_authorized_or_unavailable");
  let payload;
  try { payload = await response.json(); } catch { throw new WorkflowRunnerError("invalid_status_response"); }
  return validateStatus(payload, runId);
}

function wakeHeaders({ secret, runId, timestamp, nonce }) {
  return {
    "x-lvtchat-run-id": runId,
    "x-lvtchat-timestamp": timestamp,
    "x-lvtchat-nonce": nonce,
    "x-lvtchat-signature": executionWakeSignature(secret, timestamp, nonce, runId),
  };
}

async function sendWake({ fetchImpl, runId, secret, nonce, now }) {
  const timestamp = String(Math.floor(now() / 1000));
  if (!/^\d{10}$/.test(timestamp) || !NONCE.test(nonce)) throw new WorkflowRunnerError("invalid_wake_auth_material");
  try {
    return await fetchImpl(`${APP_ORIGIN}${WAKE_PATH}`, {
      method: "POST",
      headers: wakeHeaders({ secret, runId, timestamp, nonce }),
      body: "",
      cache: "no-store",
      redirect: "error",
      signal: timeoutSignal(WAKE_TIMEOUT_MS),
    });
  } catch {
    throw new WorkflowRunnerError("wake_outcome_ambiguous");
  }
}

/** Executes only the supplied run. Network effects are one signed wake at a time. */
export async function runAgentWorkflow({
  runId,
  confirmation,
  secret,
  ownerCookie,
  fetchImpl = fetch,
  now = Date.now,
  createNonce = () => randomBytes(16).toString("hex"),
  onProgress = () => {},
}) {
  if (typeof runId !== "string" || !UUID.test(runId)) throw new WorkflowRunnerError("invalid_run_id");
  const targetRunId = runId.toLowerCase();
  if (confirmation !== `RUN ${runId}` && confirmation !== `RUN ${targetRunId}`) {
    throw new WorkflowRunnerError("operator_confirmation_mismatch");
  }
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new WorkflowRunnerError("trigger_secret_invalid");
  }
  if (typeof ownerCookie !== "string" || ownerCookie.length < 1 || ownerCookie.length > 16_384
    || /[\r\n]/.test(ownerCookie)) throw new WorkflowRunnerError("owner_session_invalid");

  const usedNonces = new Set();
  const maxWakes = MAX_STEPS * (MAX_NO_PROGRESS_WAKES_PER_STEP + 1) + 1;
  const deadline = now() + MAX_RUN_DURATION_MS;
  let status = await getAuthoritativeStatus({ fetchImpl, runId: targetRunId, ownerCookie });
  let wakeCount = 0;
  let lastSuccessfulWake = null;
  const boundedYields = new Map();

  while (wakeCount < maxWakes) {
    if (now() >= deadline) throw new WorkflowRunnerError("runner_timeout");
    const target = nextPendingStep(status);
    const finalizationWake = target === null;
    if (finalizationWake && status.steps.some((step) => step.state !== "succeeded")) {
      throw new WorkflowRunnerError("workflow_not_finalizable");
    }
    if (finalizationWake && status.state !== "completed") {
      throw new WorkflowRunnerError("workflow_not_finalizable");
    }
    if (finalizationWake && lastSuccessfulWake === "finalization_completed") {
      return Object.freeze({ status: "completed", completedStepCount: status.completedStepCount, totalStepCount: status.totalStepCount, wakeCount });
    }

    const nonce = createNonce();
    if (!NONCE.test(nonce) || usedNonces.has(nonce)) throw new WorkflowRunnerError("nonce_not_unique");
    usedNonces.add(nonce);
    const before = status;
    let wakeResponse;
    try {
      wakeResponse = await sendWake({ fetchImpl, runId: targetRunId, secret, nonce, now });
    } catch (error) {
      // One authenticated read may clarify state, but never turns an ambiguous wake into a retry.
      await getAuthoritativeStatus({ fetchImpl, runId: targetRunId, ownerCookie }).catch(() => undefined);
      throw error;
    }
    wakeCount += 1;
    if (wakeResponse.status !== 200) {
      await getAuthoritativeStatus({ fetchImpl, runId: targetRunId, ownerCookie }).catch(() => undefined);
      throw new WorkflowRunnerError("wake_http_error");
    }
    let wakePayload;
    try { wakePayload = await wakeResponse.json(); } catch { throw new WorkflowRunnerError("invalid_wake_response"); }
    if (!wakePayload || typeof wakePayload.status !== "string") throw new WorkflowRunnerError("invalid_wake_response");

    // Always obtain the owner-authorized persisted state before deciding whether to continue.
    status = await getAuthoritativeStatus({ fetchImpl, runId: targetRunId, ownerCookie });
    if (status.failurePresent || status.recoveryRequired || status.controlState !== "active") {
      throw new WorkflowRunnerError("workflow_requires_operator_review");
    }

    if (finalizationWake) {
      if (wakePayload.status !== "finalization_completed" || status.state !== "completed"
        || status.steps.some((step) => step.state !== "succeeded")) {
        throw new WorkflowRunnerError("finalization_not_confirmed");
      }
      lastSuccessfulWake = "finalization_completed";
      onProgress({ kind: "finalized", completedStepCount: status.completedStepCount, totalStepCount: status.totalStepCount });
      continue;
    }

    const expected = target.step.id;
    if (wakePayload.status === "step_completed") {
      if (!sameSteps(before, status, target.index, true) || status.steps[target.index].state !== "succeeded") {
        throw new WorkflowRunnerError("unexpected_step_progress");
      }
      boundedYields.delete(expected);
      lastSuccessfulWake = "step_completed";
      onProgress({ kind: "step_completed", step: expected, completedStepCount: status.completedStepCount, totalStepCount: status.totalStepCount });
      continue;
    }

    // The worker can checkpoint one step and yield its bounded slice before
    // returning. Persisted owner status, rather than the wake label, proves
    // whether that step completed and prevents a duplicate provider dispatch.
    if (wakePayload.status === "bounded_yield"
      && sameSteps(before, status, target.index, true)
      && status.steps[target.index].state === "succeeded") {
      boundedYields.delete(expected);
      lastSuccessfulWake = "step_completed";
      onProgress({ kind: "step_completed", step: expected, completedStepCount: status.completedStepCount, totalStepCount: status.totalStepCount });
      continue;
    }

    if (wakePayload.status === "bounded_yield" && wakePayload.providerCalls === 0
      && sameSteps(before, status, target.index, false)
      && status.steps[target.index].state === "pending") {
      const count = (boundedYields.get(expected) ?? 0) + 1;
      boundedYields.set(expected, count);
      if (count > MAX_NO_PROGRESS_WAKES_PER_STEP) throw new WorkflowRunnerError("bounded_yield_limit");
      lastSuccessfulWake = "bounded_yield";
      onProgress({ kind: "bounded_yield", step: expected, attempt: count });
      continue;
    }

    const rejectedStatusCodes = {
      recovery_required: "recovery_required",
      budget_exhausted: "budget_exhausted",
      authorization_denied: "authorization_denied",
      terminal: "workflow_failed",
      retry_pending: "retry_pending",
      waiting_for_approval: "approval_required",
      paused_or_stopped: "workflow_control_blocked",
      lease_lost: "execution_lease_lost",
    };
    throw new WorkflowRunnerError(rejectedStatusCodes[wakePayload.status] ?? "wake_not_progressed");
  }
  throw new WorkflowRunnerError("wake_limit_reached");
}

function readHidden(prompt, maximumLength) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new WorkflowRunnerError("interactive_terminal_required");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (buffer) => {
      for (const byte of buffer) {
        if (byte === 3) return finish(new WorkflowRunnerError("cancelled"));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 127 || byte === 8) { value = value.slice(0, -1); continue; }
        if (byte >= 32 && byte <= 126 && value.length < maximumLength) value += String.fromCharCode(byte);
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const runId = process.argv[2] ?? "";
  if (!UUID.test(runId)) {
    process.stderr.write("Usage: node scripts/run-agent-workflow.mjs <workflow-run-id>\n");
    process.exitCode = 2;
    return;
  }
  const target = runId.toLowerCase();
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let confirmation;
  try {
    confirmation = await readline.question(`This will execute only workflow ${target}. Type RUN ${target} to authorize: `);
  } finally {
    readline.close();
  }
  try {
    const secret = await readHidden("Execution trigger secret (hidden): ", 4096);
    const ownerCookie = await readHidden("Owner-authenticated browser Cookie header (hidden): ", 16_384);
    process.stdout.write("Checking owner-authorized workflow status…\n");
    const result = await runAgentWorkflow({
      runId: target, confirmation, secret, ownerCookie,
      onProgress(event) {
        if (event.kind === "step_completed") process.stdout.write(`Completed ${event.step} (${event.completedStepCount}/${event.totalStepCount}).\n`);
        else if (event.kind === "bounded_yield") process.stdout.write(`Safe bounded yield for ${event.step}; confirming status before a fresh wake.\n`);
        else process.stdout.write("All steps succeeded; workflow finalization confirmed.\n");
      },
    });
    process.stdout.write(`Workflow ${result.status}: ${result.completedStepCount}/${result.totalStepCount} steps; ${result.wakeCount} wake(s).\n`);
  } catch (error) {
    const code = error instanceof WorkflowRunnerError ? error.code : "runner_failed";
    process.stderr.write(`Stopped safely (${code}). Check the workflow status in LVTChat before any separately authorized action.\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
