import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executionWakeSignature, runAgentWorkflow } from "../../scripts/run-agent-workflow.mjs";

const RUN_ID = "b2000000-0000-4000-8000-000000000001";
const OTHER_RUN_ID = "b2000000-0000-4000-8000-000000000002";
const SECRET = "unit-test-trigger-secret-material-at-least-32-bytes";
const COOKIE = "sb-access-token=synthetic-owner-session";
const NOW = Date.UTC(2026, 9, 13, 14, 0, 0);

function status(states: readonly string[], overrides: Record<string, unknown> = {}) {
  const steps = states.map((state, index) => ({
    id: `step-${index + 1}`, capabilityLabel: `Step ${index + 1}`, state,
    approvalRequired: false,
  }));
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    conversationId: "e2000000-0000-4000-8000-000000000001",
    state: states.every((item) => item === "succeeded") ? "completed"
      : states.every((item) => item === "pending") ? "prepared" : "executing",
    controlState: "active",
    controlRevision: 0,
    createdAt: "2026-10-13T13:00:00.000Z",
    completedStepCount: states.filter((item) => item === "succeeded").length,
    totalStepCount: states.length,
    failurePresent: false,
    recoveryRequired: false,
    approvalCheckpoints: [],
    steps,
    ...overrides,
  };
}

function response(body: unknown, statusCode = 200) {
  return Response.json(body, { status: statusCode });
}

function args(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    confirmation: `RUN ${RUN_ID}`,
    secret: SECRET,
    ownerCookie: COOKIE,
    fetchImpl,
    now: () => NOW,
    createNonce: vi.fn()
      .mockReturnValueOnce("10000000000000000000000000000001")
      .mockReturnValueOnce("20000000000000000000000000000002")
      .mockReturnValueOnce("30000000000000000000000000000003"),
    ...overrides,
  };
}

describe("run-bound one-command workflow runner", () => {
  it("uses the v2 run-bound HMAC canonical message", () => {
    const timestamp = String(Math.floor(NOW / 1000));
    const nonce = "10000000000000000000000000000001";
    const expected = createHmac("sha256", SECRET)
      .update(`v2\nPOST\n/api/internal/execution-wake\n${RUN_ID}\n${timestamp}\n${nonce}`, "utf8")
      .digest("hex");
    expect(executionWakeSignature(SECRET, timestamp, nonce, RUN_ID)).toBe(expected);
  });

  it("advances sequentially only after owner status confirms each step, then confirms finalization", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const statuses = [status(["pending", "pending"]), status(["succeeded", "pending"]),
      status(["succeeded", "succeeded"]), status(["succeeded", "succeeded"])];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const href = String(url);
      calls.push({ url: href, init });
      if (href.includes("/api/v1/agent-workflows/")) return response({ status: statuses.shift() });
      const current = calls.filter((call) => call.url.endsWith("/api/internal/execution-wake")).length;
      return response({ status: current === 1 ? "bounded_yield"
        : current < 3 ? "step_completed" : "finalization_completed", durationMs: 10, providerCalls: 1 });
    });
    const progress: unknown[] = [];

    const result = await runAgentWorkflow(args(fetchImpl as typeof fetch, { onProgress: (event: unknown) => progress.push(event) }) as never);

    expect(result).toEqual({ status: "completed", completedStepCount: 2, totalStepCount: 2, wakeCount: 3 });
    const wakes = calls.filter((call) => call.url.endsWith("/api/internal/execution-wake"));
    expect(wakes).toHaveLength(3);
    expect(new Set(wakes.map((call) => (call.init.headers as Record<string, string>)["x-lvtchat-nonce"])).size).toBe(3);
    for (const call of wakes) {
      expect(call.init.method).toBe("POST");
      expect(call.init.body).toBe("");
      expect(call.init.redirect).toBe("error");
      expect((call.init.headers as Record<string, string>)["x-lvtchat-run-id"]).toBe(RUN_ID);
    }
    const ownerReads = calls.filter((call) => call.url.includes("/api/v1/agent-workflows/"));
    expect(ownerReads).toHaveLength(4);
    expect(ownerReads.every((call) => (call.init.headers as Record<string, string>).cookie === COOKIE)).toBe(true);
    expect(progress).toEqual([
      { kind: "step_completed", step: "step-1", completedStepCount: 1, totalStepCount: 2 },
      { kind: "step_completed", step: "step-2", completedStepCount: 2, totalStepCount: 2 },
      { kind: "finalized", completedStepCount: 2, totalStepCount: 2 },
    ]);
  });

  it("requires exact operator confirmation before making any request", async () => {
    const fetchImpl = vi.fn();
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch, { confirmation: "yes" }) as never))
      .rejects.toMatchObject({ code: "operator_confirmation_mismatch" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a status response for a different run without dispatching a wake", async () => {
    const fetchImpl = vi.fn(async () => response({ status: { ...status(["pending"]), runId: OTHER_RUN_ID } }));
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch) as never))
      .rejects.toMatchObject({ code: "unexpected_workflow_status" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("continues only after an explicit zero-provider bounded yield and uses a fresh nonce", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let wakeCount = 0;
    const statuses = [status(["pending"]), status(["pending"]), status(["succeeded"]), status(["succeeded"])];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const href = String(url);
      calls.push({ url: href, init });
      if (href.includes("/api/v1/agent-workflows/")) return response({ status: statuses.shift() });
      wakeCount += 1;
      return response({ status: wakeCount === 1 ? "bounded_yield" : wakeCount === 2 ? "step_completed" : "finalization_completed", providerCalls: 0 });
    });
    const nonce = args(fetchImpl as typeof fetch).createNonce;
    const result = await runAgentWorkflow(args(fetchImpl as typeof fetch, { createNonce: nonce }) as never);
    expect(result.wakeCount).toBe(3);
    const used = calls.filter((call) => call.url.endsWith("/api/internal/execution-wake"))
      .map((call) => (call.init.headers as Record<string, string>)["x-lvtchat-nonce"]);
    expect(new Set(used).size).toBe(3);
  });

  it("stops on recovery_required and does not issue a second wake", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      return href.includes("/api/v1/agent-workflows/")
        ? response({ status: status(["pending"]) })
        : response({ status: "recovery_required", providerCalls: null });
    });
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch) as never)).rejects.toMatchObject({ code: "recovery_required" });
    expect(calls.filter((url) => url.endsWith("/api/internal/execution-wake"))).toHaveLength(1);
  });

  it("surfaces recovery_required from authoritative owner status and stops", async () => {
    let statusReads = 0;
    let postCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/api/v1/agent-workflows/")) {
        statusReads += 1;
        return response({ status: status(["pending"], statusReads > 1 ? { recoveryRequired: true } : {}) });
      }
      postCount += 1;
      return response({ status: "bounded_yield", providerCalls: null });
    });
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch) as never))
      .rejects.toMatchObject({ code: "recovery_required" });
    expect(postCount).toBe(1);
  });

  it("stops when the governed worker reports an exhausted provider budget", async () => {
    let postCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/api/v1/agent-workflows/")) return response({ status: status(["pending"]) });
      postCount += 1;
      return response({ status: "budget_exhausted", providerCalls: 0 });
    });
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch) as never))
      .rejects.toMatchObject({ code: "budget_exhausted" });
    expect(postCount).toBe(1);
  });

  it("enforces a total runner deadline before sending another wake", async () => {
    let clock = NOW;
    const fetchImpl = vi.fn(async () => response({ status: status(["pending"]) }));
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch, {
      now: () => { clock += 601_000; return clock; },
    }) as never)).rejects.toMatchObject({ code: "runner_timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries a wake with an ambiguous network outcome", async () => {
    let postCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/api/v1/agent-workflows/")) return response({ status: status(["pending"]) });
      postCount += 1;
      throw new Error("synthetic network timeout");
    });
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch) as never)).rejects.toMatchObject({ code: "wake_outcome_ambiguous" });
    expect(postCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // before status, one wake, one read-only status check
  });

  it("stops on HTTP conflict and never repeats the state-changing request", async () => {
    let postCount = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/api/v1/agent-workflows/")) return response({ status: status(["pending"]) });
      postCount += 1;
      return response({ error: "duplicate_trigger" }, 409);
    });
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch) as never)).rejects.toMatchObject({ code: "wake_http_error" });
    expect(postCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // before status, one wake, after-error status
  });

  it("rejects duplicate nonces before a second wake", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("/api/v1/agent-workflows/")) return response({ status: status(["pending"]) });
      return response({ status: "bounded_yield", providerCalls: 0 });
    });
    await expect(runAgentWorkflow(args(fetchImpl as typeof fetch, {
      createNonce: () => "10000000000000000000000000000001",
    }) as never)).rejects.toMatchObject({ code: "nonce_not_unique" });
    expect(calls.filter((url) => url.endsWith("/api/internal/execution-wake"))).toHaveLength(1);
  });
});
