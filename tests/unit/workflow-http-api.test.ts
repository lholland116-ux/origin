import { describe, expect, it, vi } from "vitest";
import { createWorkflowHttpHandlers, readWorkflowFeatureGate, toWorkflowProgressDto } from "@/lib/agent-runtime/workflow-http-api";
import type { WorkflowHttpDependencies } from "@/lib/agent-runtime/workflow-http-api";
import type { AcceptedExecutionCompositionResult } from "@/lib/agent-runtime/accepted-execution-composition";
import type { DurableExecutionRun } from "@/lib/agent-runtime/execution-store";

const USER = "a3000000-0000-4000-8000-000000000001";
const OTHER_USER = "a3000000-0000-4000-8000-000000000002";
const CONVERSATION = "b3000000-0000-4000-8000-000000000001";
const RUN = "c3000000-0000-4000-8000-000000000001";
const REQUEST = "d3000000-0000-4000-8000-000000000001";
const USER_MESSAGE = "d3000000-0000-4000-8000-000000000002";
const ASSISTANT_MESSAGE = "d3000000-0000-4000-8000-000000000003";
const CHECKPOINT = "d3000000-0000-4000-8000-000000000004";
const IDEMPOTENCY = "e3000000-0000-4000-8000-000000000001";
const PILOT_GATE = { enabled: true, pilotUserIds: new Set([USER]) };
const requestBody = {
  conversationId: CONVERSATION,
  idempotencyKey: IDEMPOTENCY,
  message: "Search the latest FDA QMSR changes and create a PDF briefing.",
  documentIds: [],
  images: [],
  requestOptions: { routingMode: "auto" },
};

function persistedRun(overrides: Record<string, unknown> = {}): DurableExecutionRun {
  return {
    id: RUN,
    userId: USER,
    runtimeVersion: 1,
    handoffVersion: 1,
    idempotencyKey: IDEMPOTENCY,
    requestFingerprint: "f".repeat(64),
    acceptedRequestId: REQUEST,
    acceptanceFingerprint: "a".repeat(64),
    executionPlan: {
      version: 1,
      steps: [{ id: "research", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }],
      orderedStepIds: ["research"],
      plannerSource: "deterministic",
      governance: { maxSteps: 6, capabilityIds: ["web_search"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: true, handoffVersion: 1 },
    },
    runtimeContext: {
      conversationId: CONVERSATION,
      userInput: "private prompt",
      requestMessageBinding: { requestId: REQUEST, userId: USER, conversationId: CONVERSATION, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE },
      attachments: [], resourceReferences: [],
    },
    status: "pending",
    controlState: "active",
    controlRevision: 0,
    snapshotSchemaVersion: 1,
    snapshotRevision: 0,
    snapshot: { version: 1, runtimeVersion: 1, snapshot: { run: {}, steps: {} } },
    createdAt: "2026-10-08T12:00:00.000Z",
    steps: [{ runId: RUN, userId: USER, stepId: "research", capabilityId: "web_search", dependencyIds: [], attempt: 1, executionKey: "private-execution-key", status: "pending" }],
    approvalCheckpoints: [],
    ...overrides,
  } as DurableExecutionRun;
}

function associated(run = persistedRun(), status: "created" | "existing" = "created"): AcceptedExecutionCompositionResult {
  return { kind: "associated", status, run };
}

function fixture(overrides: Partial<WorkflowHttpDependencies> = {}) {
  const authenticate = vi.fn(async () => USER);
  const loadCurrentPlan = vi.fn(async () => "pro" as const);
  const prepare = vi.fn(async () => associated());
  const getRun = vi.fn(async () => persistedRun());
  const ownsConversation = vi.fn(async () => true);
  const validateBinding = vi.fn(async () => true);
  const validateAcceptance = vi.fn(async () => true);
  const mutateControl = vi.fn(async () => ({ kind: "rejected", failure: { code: "authorization_denied", message: "Denied." } } as const));
  const decideApproval = vi.fn(async () => ({ kind: "rejected", failure: { code: "authorization_denied", message: "Denied." } } as const));
  const getGate = vi.fn(() => PILOT_GATE);
  const handlers = createWorkflowHttpHandlers({
    getGate, authenticate, loadCurrentPlan, prepare, getRun, ownsConversation, validateBinding, validateAcceptance, mutateControl, decideApproval,
    configuredAppUrl: "https://app.example.test",
    ...overrides,
  });
  return { handlers, getGate, authenticate, loadCurrentPlan, prepare, getRun, ownsConversation, validateBinding, validateAcceptance, mutateControl, decideApproval };
}

function startRequest(body: unknown = requestBody, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.test/api/v1/agent-workflows", {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function controlRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.example.test/api/v1/agent-workflows/${RUN}/controls`, {
    method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

function approvalRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.example.test/api/v1/agent-workflows/${RUN}/approvals/${CHECKPOINT}`, {
    method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("server-controlled workflow feature gate", () => {
  it("is disabled when absent, malformed, or missing the durable database configuration", () => {
    expect(readWorkflowFeatureGate({})).toEqual({ enabled: false, pilotUserIds: new Set() });
    expect(readWorkflowFeatureGate({ LVTCHAT_AGENT_WORKFLOWS_ENABLED: "true", LVTCHAT_AGENT_WORKFLOW_PILOT_USER_IDS: USER }))
      .toMatchObject({ enabled: false });
    expect(readWorkflowFeatureGate({ LVTCHAT_AGENT_WORKFLOWS_ENABLED: "True", LVTCHAT_AGENT_WORKFLOW_PILOT_USER_IDS: USER, CAPA_DATABASE_URL: "postgres://db.example.test/app" }))
      .toMatchObject({ enabled: false });
    expect(readWorkflowFeatureGate({ LVTCHAT_AGENT_WORKFLOWS_ENABLED: "true", LVTCHAT_AGENT_WORKFLOW_PILOT_USER_IDS: "not-a-user", CAPA_DATABASE_URL: "postgres://db.example.test/app" }))
      .toMatchObject({ enabled: false });
  });

  it("enables only an explicitly allowlisted user with valid server configuration", () => {
    const gate = readWorkflowFeatureGate({
      LVTCHAT_AGENT_WORKFLOWS_ENABLED: "true",
      LVTCHAT_AGENT_WORKFLOW_PILOT_USER_IDS: USER,
      CAPA_DATABASE_URL: "postgresql://db.example.test/app",
    });
    expect(gate.enabled).toBe(true);
    expect(gate.pilotUserIds.has(USER)).toBe(true);
    expect(gate.pilotUserIds.has(OTHER_USER)).toBe(false);
  });
});

describe("authenticated workflow HTTP handlers", () => {
  it("disabled start is side-effect-free and cannot be enabled from request data", async () => {
    const deps = fixture({ getGate: () => ({ enabled: false, pilotUserIds: new Set() }) });
    const response = await deps.handlers.start(startRequest({ ...requestBody, enabled: true }));
    expect(response.status).toBe(404);
    expect(await responseBody(response)).toMatchObject({ error: { code: "feature_disabled" } });
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.loadCurrentPlan).not.toHaveBeenCalled();
    expect((await deps.handlers.status(new Request("https://app.example.test"), RUN)).status).toBe(404);
    expect(deps.getRun).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request before acceptance or planning", async () => {
    const deps = fixture({ authenticate: async () => null });
    const response = await deps.handlers.start(startRequest());
    expect(response.status).toBe(401);
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it("requires a server-side pilot allowlist and same-origin mutation", async () => {
    const denied = fixture({ authenticate: async () => OTHER_USER });
    expect((await denied.handlers.start(startRequest())).status).toBe(404);
    expect(denied.prepare).not.toHaveBeenCalled();
    const crossOrigin = fixture();
    expect((await crossOrigin.handlers.start(startRequest(requestBody, { origin: "https://attacker.example" }))).status).toBe(403);
    expect(crossOrigin.prepare).not.toHaveBeenCalled();
    const nativeOrigin = fixture();
    expect((await nativeOrigin.handlers.start(startRequest(requestBody, { origin: "capacitor://localhost" }))).status).toBe(201);
  });

  it("rejects malformed, oversized, and single-step bodies without accepting them", async () => {
    const deps = fixture();
    const malformed = await deps.handlers.start(new Request("https://app.example.test/api/v1/agent-workflows", {
      method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" }, body: "{",
    }));
    expect(malformed.status).toBe(400);
    const oversized = await deps.handlers.start(new Request("https://app.example.test/api/v1/agent-workflows", {
      method: "POST", headers: { origin: "https://app.example.test", "content-length": "70000" }, body: "{}",
    }));
    expect(oversized.status).toBe(413);
    expect((await deps.handlers.start(startRequest({ ...requestBody, message: "Hello" }))).status).toBe(422);
    expect((await deps.handlers.start(startRequest({ ...requestBody, requestOptions: { routingMode: "standard" } }))).status).toBe(422);
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it("explains that autonomous image generation is unavailable without dispatching it", async () => {
    const deps = fixture({ prepare: async () => ({ kind: "rejected", reason: "capability_unavailable" }) as never });
    const response = await deps.handlers.start(startRequest());
    expect(response.status).toBe(422);
    expect(await responseBody(response)).toMatchObject({ error: {
      code: "capability_unavailable",
      message: expect.stringContaining("standalone feature"),
    } });
  });

  it("checks current reasoning entitlement before request acceptance", async () => {
    const deps = fixture({ loadCurrentPlan: async () => "free" });
    const response = await deps.handlers.start(startRequest({ ...requestBody, requestOptions: { routingMode: "auto", reasoningMode: "high" } }));
    expect(response.status).toBe(403);
    expect(await responseBody(response)).toMatchObject({ error: { code: "authorization_denied" } });
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it("returns a prepared, sanitized response for an authorized owner", async () => {
    const deps = fixture();
    const response = await deps.handlers.start(startRequest());
    const body = await responseBody(response);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ accepted: true, acceptedRequest: { requestId: REQUEST, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE, idempotencyKey: IDEMPOTENCY }, status: {
      schemaVersion: 1, runId: RUN, conversationId: CONVERSATION, state: "prepared",
      totalStepCount: 1, completedStepCount: 0,
      steps: [{ id: "research", capabilityLabel: "Web search", state: "pending" }],
    } });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private-execution-key");
    expect(serialized).not.toContain("deterministic");
    expect(serialized).not.toContain("executionPlan");
  });

  it("returns an existing run as the same prepared replay without status mutation", async () => {
    const prepare = vi.fn(async () => associated(persistedRun(), "existing"));
    const deps = fixture({ prepare });
    const response = await deps.handlers.start(startRequest());
    expect(response.status).toBe(200);
    expect(await responseBody(response)).toMatchObject({ acceptedRequest: { requestId: REQUEST }, status: { runId: RUN, state: "prepared" } });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("maps post-acceptance planner and association failures with exact replay recovery identity", async () => {
    const postAccept: AcceptedExecutionCompositionResult = {
      kind: "rejected", reason: "unavailable",
      acceptedRequest: { requestId: REQUEST, userMessageId: "f3000000-0000-4000-8000-000000000001", assistantMessageId: "f3000000-0000-4000-8000-000000000002", idempotencyKey: IDEMPOTENCY },
    };
    const deps = fixture({ prepare: async () => postAccept });
    const response = await deps.handlers.start(startRequest());
    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ accepted: true, recovery: { requestId: REQUEST, idempotencyKey: IDEMPOTENCY }, error: { code: "unavailable" } });
  });

  it("never reports an ambiguous acceptance RPC failure as rolled back", async () => {
    const deps = fixture({ prepare: async () => ({ kind: "rejected", reason: "unavailable" }) });
    const response = await deps.handlers.start(startRequest());
    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ accepted: "unknown", recovery: { idempotencyKey: IDEMPOTENCY } });
  });

  it("maps inaccessible conversation, resource, quota, and idempotency errors without leaking details", async () => {
    const cases = [
      ["inaccessible_conversation", 404, "inaccessible_conversation"],
      ["inaccessible_resource", 404, "inaccessible_resource"],
      ["daily_usage_quota_exhausted", 429, "daily_usage_quota_exhausted"],
      ["conflict", 409, "idempotency_conflict"],
    ] as const;
    for (const [reason, status, code] of cases) {
      const deps = fixture({ prepare: async () => ({ kind: "rejected", reason }) as AcceptedExecutionCompositionResult });
      const response = await deps.handlers.start(startRequest());
      expect(response.status).toBe(status);
      expect(await responseBody(response)).toMatchObject({ error: { code } });
    }
  });

  it("uses persisted owner-scoped status only and never prepares or resumes work", async () => {
    const deps = fixture();
    const response = await deps.handlers.status(new Request(`https://app.example.test/api/v1/agent-workflows/${RUN}`), RUN);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await responseBody(response)).toMatchObject({ status: { runId: RUN, state: "prepared" } });
    expect(deps.getRun).toHaveBeenCalledWith(RUN, USER);
    expect(deps.ownsConversation).toHaveBeenCalledWith(CONVERSATION, USER);
    expect(deps.validateBinding).toHaveBeenCalled();
    expect(deps.validateAcceptance).toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
  });

  it("does not reveal foreign-run or foreign-conversation existence", async () => {
    const noRun = fixture({ getRun: async () => null });
    const missing = await noRun.handlers.status(new Request("https://app.example.test"), RUN);
    expect(missing.status).toBe(404);
    const foreignConversation = fixture({ ownsConversation: async () => false });
    const denied = await foreignConversation.handlers.status(new Request("https://app.example.test"), RUN);
    expect(denied.status).toBe(404);
    expect(await responseBody(denied)).toEqual(await responseBody(missing));
  });

  it("returns persisted step, control, approval, and failure state without internal payloads", () => {
    const run = persistedRun({
      status: "running",
      controlState: "active",
      failureCode: "indeterminate_step",
      steps: [{ runId: RUN, userId: USER, stepId: "research", capabilityId: "web_search", dependencyIds: [], attempt: 1, executionKey: "secret", status: "running", startedAt: "2026-10-08T12:01:00.000Z", result: { kind: "text", value: "secret reasoning" } }],
      approvalCheckpoints: [{ id: CHECKPOINT, runId: RUN, userId: USER, stepId: "research", planFingerprint: "private", stepFingerprint: "private", status: "pending", source: "runtime_policy", createdAt: "2026-10-08T12:01:00.000Z" }],
    });
    const dto = toWorkflowProgressDto(run)!;
    expect(dto).toMatchObject({ state: "approval_required", failurePresent: true, recoveryRequired: true, steps: [{ state: "running", approvalRequired: true }] });
    expect(dto).toMatchObject({ controlRevision: 0, approvalCheckpoints: [{ id: CHECKPOINT, stepId: "research", state: "pending" }] });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("reasoning");
    expect(serialized).not.toContain("fingerprint");
  });

  it("keeps every control mutation dormant when the feature gate is disabled", async () => {
    const deps = fixture({ getGate: () => ({ enabled: false, pilotUserIds: new Set() }) });
    expect((await deps.handlers.control(controlRequest({ action: "pause", expectedControlRevision: 0 }), RUN)).status).toBe(404);
    expect((await deps.handlers.decideApproval(approvalRequest({ decision: "approve", expectedControlRevision: 0 }), RUN, CHECKPOINT)).status).toBe(404);
    expect(deps.getRun).not.toHaveBeenCalled();
    expect(deps.mutateControl).not.toHaveBeenCalled();
    expect(deps.decideApproval).not.toHaveBeenCalled();
  });

  it("requires authentication, same-origin, and strict control payloads before mutation", async () => {
    const unauthenticated = fixture({ authenticate: async () => null });
    expect((await unauthenticated.handlers.control(controlRequest({ action: "pause", expectedControlRevision: 0 }), RUN)).status).toBe(401);
    const crossOrigin = fixture();
    expect((await crossOrigin.handlers.control(controlRequest({ action: "pause", expectedControlRevision: 0 }, { origin: "https://evil.example" }), RUN)).status).toBe(403);
    const invalid = fixture();
    expect((await invalid.handlers.control(controlRequest({ action: "pause", expectedControlRevision: 0, userId: USER }), RUN)).status).toBe(400);
    expect(invalid.mutateControl).not.toHaveBeenCalled();
  });

  it("allows an owner pause through the governed callback and returns the persisted DTO", async () => {
    const paused = persistedRun({ controlState: "paused", controlRevision: 1 });
    const deps = fixture({
      mutateControl: async (input) => {
        expect(input).toEqual({ runId: RUN, userId: USER, action: "pause", expectedControlRevision: 0 });
        return { kind: "paused", run: {} as never };
      },
      getRun: async () => paused,
    });
    const response = await deps.handlers.control(controlRequest({ action: "pause", expectedControlRevision: 0 }), RUN);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await responseBody(response)).toMatchObject({ result: "paused", status: { controlState: "paused", controlRevision: 1 } });
  });

  it("returns a refreshable conflict for stale control revisions", async () => {
    const deps = fixture({ mutateControl: async () => ({ kind: "rejected", failure: { code: "snapshot_conflict", message: "Conflict." } }) });
    const response = await deps.handlers.control(controlRequest({ action: "stop", expectedControlRevision: 0 }), RUN);
    expect(response.status).toBe(409);
    expect(await responseBody(response)).toMatchObject({ error: { code: "revision_conflict" } });
  });

  it("binds approval decisions to a pending checkpoint and requires return rationale", async () => {
    const run = persistedRun({ approvalCheckpoints: [{ id: CHECKPOINT, runId: RUN, userId: USER, stepId: "research", planFingerprint: "f".repeat(64), stepFingerprint: "e".repeat(64), status: "pending", source: "runtime_policy", createdAt: "2026-10-08T12:01:00.000Z" }] });
    const deps = fixture({ getRun: async () => run });
    expect((await deps.handlers.decideApproval(approvalRequest({ decision: "return", expectedControlRevision: 0 }), RUN, CHECKPOINT)).status).toBe(400);
    expect((await deps.handlers.decideApproval(approvalRequest({ decision: "approve", expectedControlRevision: 0 }), RUN, "d3000000-0000-4000-8000-000000000099")).status).toBe(404);
    expect(deps.decideApproval).not.toHaveBeenCalled();
  });

  it("commits an owner approval only for the exact pending checkpoint and returns refreshed safe status", async () => {
    const pending = persistedRun({ approvalCheckpoints: [{ id: CHECKPOINT, runId: RUN, userId: USER, stepId: "research", planFingerprint: "f".repeat(64), stepFingerprint: "e".repeat(64), status: "pending", source: "runtime_policy", createdAt: "2026-10-08T12:01:00.000Z" }] });
    const approved = persistedRun({ controlRevision: 1, approvalCheckpoints: [{ ...pending.approvalCheckpoints[0]!, status: "approved", decidedBy: USER, decidedAt: "2026-10-08T12:02:00.000Z" }] });
    const getRun = vi.fn().mockResolvedValueOnce(pending).mockResolvedValue(approved);
    const decideApproval = vi.fn(async (input) => {
      expect(input).toEqual({ runId: RUN, userId: USER, checkpointId: CHECKPOINT, decision: "approve", expectedControlRevision: 0 });
      return { kind: "approved", run: {} as never, checkpoint: { ...pending.approvalCheckpoints[0]!, status: "approved", decidedBy: USER, decidedAt: "2026-10-08T12:02:00.000Z" } } as const;
    });
    const deps = fixture({ getRun, decideApproval });
    const response = await deps.handlers.decideApproval(approvalRequest({ decision: "approve", expectedControlRevision: 0 }), RUN, CHECKPOINT);
    expect(response.status).toBe(200);
    const body = await responseBody(response);
    expect(body).toMatchObject({ result: "approved", status: { controlRevision: 1, approvalCheckpoints: [{ id: CHECKPOINT, state: "approved" }] } });
    expect(JSON.stringify(body)).not.toContain("fingerprint");
  });

  it("denies control mutations when the immutable acceptance binding cannot be verified", async () => {
    const deps = fixture({ validateAcceptance: async () => false });
    const response = await deps.handlers.control(controlRequest({ action: "stop", expectedControlRevision: 0 }), RUN);
    expect(response.status).toBe(404);
    expect(deps.mutateControl).not.toHaveBeenCalled();
  });

  it("allows exact approval replay after a lost response but rejects a competing decision", async () => {
    const approved = persistedRun({ controlRevision: 1, approvalCheckpoints: [{ id: CHECKPOINT, runId: RUN, userId: USER, stepId: "research", planFingerprint: "f".repeat(64), stepFingerprint: "e".repeat(64), status: "approved", source: "runtime_policy", createdAt: "2026-10-08T12:01:00.000Z", decidedBy: USER, decidedAt: "2026-10-08T12:02:00.000Z" }] });
    const exactReplay = fixture({
      getRun: async () => approved,
      decideApproval: async () => ({ kind: "already_applied", run: {} as never }),
    });
    const replay = await exactReplay.handlers.decideApproval(approvalRequest({ decision: "approve", expectedControlRevision: 0 }), RUN, CHECKPOINT);
    expect(replay.status).toBe(200);
    expect(await responseBody(replay)).toMatchObject({ result: "already_applied", status: { approvalCheckpoints: [{ state: "approved" }] } });

    const conflict = fixture({
      getRun: async () => approved,
      decideApproval: async () => ({ kind: "rejected", failure: { code: "snapshot_conflict", message: "Conflict." } }),
    });
    expect((await conflict.handlers.decideApproval(approvalRequest({ decision: "return", expectedControlRevision: 0, rationale: "Please revise." }), RUN, CHECKPOINT)).status).toBe(409);
  });
});
