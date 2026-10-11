import type { WorkflowProgressDto } from "@/lib/agent-runtime/workflow-http-api";
import {
  parseWorkflowProgress,
  parseWorkflowStatusResponse,
  workflowProgressControls,
} from "@/lib/agent-runtime/workflow-progress-client";

export const CONVERSATION_A = "e5000000-0000-4000-8000-000000000001";
export const CONVERSATION_B = "e5000000-0000-4000-8000-000000000002";
export const RUN_A = "e5000000-0000-4000-8000-000000000011";
export const RUN_B = "e5000000-0000-4000-8000-000000000012";
export const ASSISTANT_A = "e5000000-0000-4000-8000-000000000021";
export const ASSISTANT_B = "e5000000-0000-4000-8000-000000000022";
export const CHECKPOINT_A = "e5000000-0000-4000-8000-000000000031";

export type Scenario =
  | "accepted"
  | "progress"
  | "prepared"
  | "approval"
  | "failed"
  | "recovery"
  | "reauthenticate"
  | "unavailable"
  | "network-failure"
  | "completed";

export type HarnessEvent = Readonly<{
  at: string;
  kind: "request" | "state" | "blocked" | "note";
  message: string;
}>;

export type HarnessApi = Readonly<{
  fetch: typeof fetch;
  setScenario: (conversationId: string, scenario: Scenario) => WorkflowProgressDto;
  advance: (conversationId: string) => WorkflowProgressDto;
  refresh: (conversationId: string) => WorkflowProgressDto;
  setNextControlConflict: () => void;
  setNextActionAmbiguous: () => void;
  subscribe: (listener: () => void) => () => void;
  getEvents: () => readonly HarnessEvent[];
  getRequestCount: () => number;
  getStatus: (conversationId: string) => WorkflowProgressDto;
}>;

const RUNS: Readonly<Record<string, string>> = Object.freeze({
  [CONVERSATION_A]: RUN_A,
  [CONVERSATION_B]: RUN_B,
});
function makeStatus(conversationId: string, scenario: Scenario): WorkflowProgressDto {
  const runId = RUNS[conversationId];
  const approval = scenario === "approval";
  const state: WorkflowProgressDto["state"] = scenario === "prepared" ? "prepared"
    : approval ? "approval_required"
        : scenario === "failed" ? "failed"
        : scenario === "recovery" ? "executing"
          : scenario === "completed" ? "completed"
            : "executing";
  const controlState: WorkflowProgressDto["controlState"] = scenario === "prepared" || scenario === "approval"
    ? "active"
    : scenario === "completed" ? "active" : "active";
  const dto: WorkflowProgressDto = {
    schemaVersion: 1,
    runId,
    conversationId,
    state,
    controlState,
    controlRevision: 3,
    createdAt: "2026-10-10T12:00:00.000Z",
    ...(scenario === "completed" ? { completedAt: "2026-10-10T12:01:00.000Z" } : {}),
    completedStepCount: scenario === "completed" ? 2 : scenario === "progress" ? 2 : 1,
    totalStepCount: 3,
    failurePresent: scenario === "failed" || scenario === "recovery",
    recoveryRequired: scenario === "recovery",
    approvalCheckpoints: approval ? [{ id: CHECKPOINT_A, stepId: "review", state: "pending" }] : [],
    steps: [
      { id: "research", capabilityLabel: "Research notes", state: "succeeded", approvalRequired: false },
      {
        id: "review",
        capabilityLabel: "Review draft",
        state: scenario === "progress" ? "succeeded" : approval ? "running" : "running",
        approvalRequired: approval,
      },
      { id: "report", capabilityLabel: "Prepare report", state: scenario === "completed" ? "succeeded" : "pending", approvalRequired: false },
    ],
  };
  const validated = parseWorkflowProgress(dto);
  if (!validated) throw new Error("Synthetic fixture failed the production workflow DTO validator.");
  return validated;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function routeError(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: "Synthetic harness response." } }, status);
}

export function createSyntheticWorkflowApi(): HarnessApi {
  const statusByConversation = new Map<string, WorkflowProgressDto>([
    [CONVERSATION_A, makeStatus(CONVERSATION_A, "accepted")],
    [CONVERSATION_B, makeStatus(CONVERSATION_B, "prepared")],
  ]);
  const scenarioByConversation = new Map<string, Scenario>([
    [CONVERSATION_A, "accepted"],
    [CONVERSATION_B, "prepared"],
  ]);
  const events: HarnessEvent[] = [];
  const listeners = new Set<() => void>();
  let requestCount = 0;
  let rejectNextControlRevision = false;
  let nextActionAmbiguous = false;

  const emit = (kind: HarnessEvent["kind"], message: string) => {
    events.push({ at: new Date().toLocaleTimeString(), kind, message });
    if (events.length > 100) events.shift();
    listeners.forEach((listener) => listener());
  };
  const getStatus = (conversationId: string) => {
    const status = statusByConversation.get(conversationId);
    if (!status) throw new Error("No synthetic workflow exists for this conversation.");
    return status;
  };
  const setStatus = (conversationId: string, status: WorkflowProgressDto, note: string) => {
    const validated = parseWorkflowProgress(status);
    if (!validated || validated.conversationId !== conversationId || validated.runId !== RUNS[conversationId]) {
      throw new Error("Synthetic state failed production DTO identity validation.");
    }
    statusByConversation.set(conversationId, validated);
    emit("state", note);
    return validated;
  };
  const respondStatus = (conversationId: string, statusCode = 200) => {
    const status = getStatus(conversationId);
    const parsed = parseWorkflowStatusResponse({ status }, status.runId, conversationId);
    if (!parsed) return routeError("invalid_fixture", 500);
    return jsonResponse({ status: parsed }, statusCode);
  };

  const fetchMock: typeof fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? input : input.url;
    let url: URL;
    try { url = new URL(rawUrl, window.location.origin); } catch {
      emit("blocked", "Blocked a request with an invalid URL.");
      throw new TypeError("Synthetic harness blocked an invalid request URL.");
    }
    if (url.origin !== window.location.origin) {
      emit("blocked", `Blocked non-loopback request to ${url.origin}.`);
      throw new TypeError("Synthetic harness blocks all non-origin requests.");
    }

    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const statusMatch = url.pathname.match(/^\/api\/v1\/agent-workflows\/([^/]+)$/);
    const controlsMatch = url.pathname.match(/^\/api\/v1\/agent-workflows\/([^/]+)\/controls$/);
    const approvalMatch = url.pathname.match(/^\/api\/v1\/agent-workflows\/([^/]+)\/approvals\/([^/]+)$/);
    const match = statusMatch ?? controlsMatch ?? approvalMatch;
    if (!match) {
      emit("blocked", `Rejected unexpected ${method} ${url.pathname}; nothing was forwarded.`);
      throw new TypeError("Synthetic harness has no proxy or fallback route.");
    }

    let runId: string;
    try { runId = decodeURIComponent(match[1]); } catch {
      emit("blocked", "Rejected malformed workflow identifier.");
      return routeError("not_found", 404);
    }
    const conversationId = Object.entries(RUNS).find(([, id]) => id === runId)?.[0];
    const expectedMethod = statusMatch ? "GET" : "POST";
    requestCount += 1;
    if (!conversationId || method !== expectedMethod || url.search || url.hash) {
      emit("request", `${method} ${url.pathname} → 404 (synthetic route/method mismatch)`);
      return routeError("not_found", 404);
    }

    const scenario = scenarioByConversation.get(conversationId) ?? "accepted";
    if (statusMatch) {
      if (scenario === "network-failure") {
        emit("request", `GET ${url.pathname} → network failure (synthetic)`);
        throw new TypeError("Synthetic status network failure.");
      }
      const response = scenario === "reauthenticate" ? routeError("unauthenticated", 401)
        : scenario === "unavailable" ? routeError("not_found", 404)
          : respondStatus(conversationId);
      emit("request", `GET ${url.pathname} → ${response.status}`);
      return response;
    }

    let body: unknown;
    try { body = JSON.parse(String(init.body ?? (input instanceof Request ? await input.clone().text() : ""))); } catch {
      emit("request", `POST ${url.pathname} → 400 (malformed synthetic body)`);
      return routeError("invalid_request", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return routeError("invalid_request", 400);
    const record = body as Record<string, unknown>;
    const current = getStatus(conversationId);
    const validRevision = Number.isSafeInteger(record.expectedControlRevision)
      && Number(record.expectedControlRevision) >= 0;
    if (!validRevision) {
      emit("request", `POST ${url.pathname} → 400 (invalid control revision)`);
      return routeError("invalid_request", 400);
    }
    if (record.expectedControlRevision !== current.controlRevision) {
      emit("request", `POST ${url.pathname} → 409 (revision conflict)`);
      return routeError("revision_conflict", 409);
    }
    if (rejectNextControlRevision) {
      rejectNextControlRevision = false;
      emit("request", `POST ${url.pathname} → 409 (simulated stale revision)`);
      return routeError("revision_conflict", 409);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 650));
    let updated: WorkflowProgressDto | undefined;
    if (controlsMatch) {
      const action = record.action;
      const eligible = workflowProgressControls(current);
      if (Object.keys(record).sort().join(",") !== "action,expectedControlRevision"
        || record.expectedControlRevision !== current.controlRevision
        || (action === "pause" && !eligible.pause)
        || (action === "resume" && !eligible.resume)
        || (action === "stop" && !eligible.stop)
        || !["pause", "resume", "stop"].includes(String(action))) {
        emit("request", `POST ${url.pathname} → 409 (invalid synthetic transition)`);
        return routeError("invalid_transition", 409);
      }
      updated = action === "pause"
        ? { ...current, state: "paused", controlState: "paused", controlRevision: current.controlRevision + 1 }
        : action === "resume"
          ? { ...current, state: "executing", controlState: "active", controlRevision: current.controlRevision + 1 }
          : { ...current, state: "stop_requested", controlState: "stop_requested", controlRevision: current.controlRevision + 1 };
    } else {
      let checkpointId: string;
      try { checkpointId = decodeURIComponent(approvalMatch![2]); } catch { return routeError("not_found", 404); }
      const decision = record.decision;
      const rationale = typeof record.rationale === "string" ? record.rationale.trim() : undefined;
      const isReturn = decision === "return";
      const keys = Object.keys(record).sort().join(",");
      if (!(["decision,expectedControlRevision", "decision,expectedControlRevision,rationale"].includes(keys))
        || !workflowProgressControls(current).approvalCheckpointId
        || checkpointId !== workflowProgressControls(current).approvalCheckpointId
        || (decision !== "approve" && decision !== "return")
        || (isReturn && (keys !== "decision,expectedControlRevision,rationale" || !rationale || rationale.length > 1000))
        || (!isReturn && keys !== "decision,expectedControlRevision")) {
        emit("request", `POST ${url.pathname} → 409 (invalid synthetic approval)`);
        return routeError("invalid_transition", 409);
      }
      updated = isReturn
        ? {
          ...current,
          state: "returned",
          controlState: "returned",
          controlRevision: current.controlRevision + 1,
          approvalCheckpoints: current.approvalCheckpoints.map((item) => ({ ...item, state: "returned" })),
          steps: current.steps.map((step) => ({ ...step, approvalRequired: false })),
        }
        : {
          ...current,
          state: "executing",
          controlState: "active",
          controlRevision: current.controlRevision + 1,
          approvalCheckpoints: current.approvalCheckpoints.map((item) => ({ ...item, state: "approved" })),
          steps: current.steps.map((step) => ({ ...step, approvalRequired: false })),
        };
    }
    if (!updated) return routeError("invalid_transition", 409);
    const operation = controlsMatch ? String(record.action) : String(record.decision);
    const rationaleNote = record.decision === "return"
      ? `; rationaleProvided=${typeof record.rationale === "string"}; rationaleLength=${typeof record.rationale === "string" ? record.rationale.trim().length : 0}`
      : "";
    setStatus(conversationId, updated, `${operation} accepted with expectedControlRevision=${current.controlRevision}${rationaleNote}; new revision ${updated.controlRevision}.`);
    emit("request", `POST ${url.pathname} → 200 (synthetic ${operation}, expectedControlRevision=${current.controlRevision}${rationaleNote})`);
    if (nextActionAmbiguous) {
      nextActionAmbiguous = false;
      throw new TypeError("Simulated lost response after synthetic state changed.");
    }
    return respondStatus(conversationId);
  };

  return Object.freeze({
    fetch: fetchMock,
    setScenario(conversationId, scenario) {
      if (!RUNS[conversationId]) throw new Error("Unknown synthetic conversation.");
      scenarioByConversation.set(conversationId, scenario);
      const status = makeStatus(conversationId, scenario);
      statusByConversation.set(conversationId, status);
      emit("state", `Loaded ${scenario} fixture for Conversation ${conversationId === CONVERSATION_A ? "A" : "B"}.`);
      return status;
    },
    advance(conversationId) {
      const current = getStatus(conversationId);
      const scenario = scenarioByConversation.get(conversationId);
      if (scenario === "progress") {
        return setStatus(conversationId, {
          ...current,
          completedStepCount: 3,
          steps: current.steps.map((step) => ({ ...step, state: "succeeded" })),
        }, "Advanced all synthetic steps to completed.");
      }
      if (scenario === "accepted") return this.setScenario(conversationId, "progress");
      return setStatus(conversationId, current, "No progress transition is defined for this fixture.");
    },
    refresh(conversationId) {
      const current = getStatus(conversationId);
      const updated = { ...current, createdAt: current.createdAt };
      statusByConversation.set(conversationId, updated);
      emit("note", "Simulated conversation message refresh; workflow panel remains mounted.");
      return updated;
    },
    setNextControlConflict() { rejectNextControlRevision = true; emit("note", "Next control will receive a synthetic stale-revision 409."); },
    setNextActionAmbiguous() { nextActionAmbiguous = true; emit("note", "Next control will change synthetic state, then lose its response; the UI must not retry it."); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getEvents() { return events; },
    getRequestCount() { return requestCount; },
    getStatus,
  });
}
