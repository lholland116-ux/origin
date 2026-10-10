import { agentRequestAcceptanceInputSchema, type AgentRequestAcceptanceInput } from "@/lib/agent-runtime/request-acceptance";
import type { AcceptedExecutionCompositionResult } from "@/lib/agent-runtime/accepted-execution-composition";
import type { DurableExecutionRun } from "@/lib/agent-runtime/execution-store";
import type { ExecutionControlCommandResult } from "@/lib/agent-runtime/runtime-contracts";
import { classifyTaskComplexity } from "@/lib/ai/task-complexity";
import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const WORKFLOW_START_MAX_BODY_BYTES = 65_536;
export const WORKFLOW_CONTROL_MAX_BODY_BYTES = 8_192;

export type WorkflowFeatureGate = Readonly<{
  enabled: boolean;
  pilotUserIds: ReadonlySet<string>;
}>;

export type WorkflowProgressDto = Readonly<{
  schemaVersion: 1;
  runId: string;
  conversationId: string;
  state: "prepared" | "executing" | "pause_requested" | "paused" | "stop_requested" | "stopped" | "returned" | "approval_required" | "completed" | "failed";
  controlState: DurableExecutionRun["controlState"];
  controlRevision: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  completedStepCount: number;
  totalStepCount: number;
  failurePresent: boolean;
  recoveryRequired: boolean;
  approvalCheckpoints: readonly Readonly<{
    id: string;
    stepId: string;
    state: "pending" | "approved" | "returned";
  }>[];
  steps: readonly Readonly<{
    id: string;
    capabilityLabel: string;
    state: DurableExecutionRun["steps"][number]["status"];
    approvalRequired: boolean;
    startedAt?: string;
    completedAt?: string;
  }>[];
}>;

export type WorkflowHttpDependencies = Readonly<{
  getGate: () => WorkflowFeatureGate;
  authenticate: () => Promise<string | null>;
  loadCurrentPlan: (userId: string) => Promise<"free" | "pro" | null>;
  prepare: (input: AgentRequestAcceptanceInput) => Promise<AcceptedExecutionCompositionResult>;
  getRun: (runId: string, userId: string) => Promise<DurableExecutionRun | null>;
  ownsConversation: (conversationId: string, userId: string) => Promise<boolean>;
  validateBinding: (run: DurableExecutionRun) => Promise<boolean>;
  validateAcceptance: (run: DurableExecutionRun) => Promise<boolean>;
  mutateControl: (input: { runId: string; userId: string; action: "pause" | "resume" | "stop"; expectedControlRevision: number }) => Promise<ExecutionControlCommandResult>;
  decideApproval: (input: { runId: string; userId: string; checkpointId: string; decision: "approve" | "return"; expectedControlRevision: number; rationale?: string }) => Promise<ExecutionControlCommandResult>;
  configuredAppUrl?: string;
}>;

export function readWorkflowFeatureGate(env: Readonly<Record<string, string | undefined>> = process.env): WorkflowFeatureGate {
  const enabled = env.LVTCHAT_AGENT_WORKFLOWS_ENABLED === "true";
  const rawUsers = env.LVTCHAT_AGENT_WORKFLOW_PILOT_USER_IDS;
  const databaseUrl = env.CAPA_DATABASE_URL;
  if (!enabled || !rawUsers || !databaseUrl) return { enabled: false, pilotUserIds: new Set() };

  let databaseUrlValid = false;
  try {
    const parsed = new URL(databaseUrl);
    databaseUrlValid = (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") && Boolean(parsed.hostname);
  } catch {
    databaseUrlValid = false;
  }
  const userIds = rawUsers.split(",").map((value) => value.trim());
  if (!databaseUrlValid || userIds.length === 0 || userIds.some((id) => !UUID.test(id))
    || new Set(userIds).size !== userIds.length) return { enabled: false, pilotUserIds: new Set() };

  return { enabled: true, pilotUserIds: new Set(userIds.map((id) => id.toLowerCase())) };
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function error(code: string, message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: { code, message }, ...extra }, status);
}

function featureAllows(gate: WorkflowFeatureGate, userId?: string): boolean {
  return gate.enabled && (!userId || gate.pilotUserIds.has(userId.toLowerCase()));
}

function sameOrigin(request: Request, configuredAppUrl?: string): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader === "null" || request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (originHeader === "capacitor://localhost") return true;
  let origin: string;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originHeader);
    origin = parsedOrigin.origin;
  } catch {
    return false;
  }
  if (parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash
    || parsedOrigin.username || parsedOrigin.password || origin !== originHeader) return false;
  const allowed = new Set<string>();
  if (configuredAppUrl) {
    try { allowed.add(new URL(configuredAppUrl).origin); } catch { return false; }
  } else {
    try { allowed.add(new URL(request.url).origin); } catch { return false; }
  }
  return allowed.has(origin);
}

type ReadBodyResult = { kind: "ok"; value: unknown } | { kind: "invalid" } | { kind: "too_large" };

async function readBoundedJson(request: Request, maximumBytes = WORKFLOW_START_MAX_BODY_BYTES): Promise<ReadBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { kind: "invalid" };
    if (Number(contentLength) > maximumBytes) return { kind: "too_large" };
  }
  if (!request.body) return { kind: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { kind: "ok", value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

function timestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

const CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  standard: "Answer",
  web_search: "Web search",
  file_analysis: "File analysis",
  document_generation: "Document creation",
  image_generation: "Image creation",
  image_editing: "Image editing",
});
const RECOVERY_REQUIRED_CODES = new Set(["indeterminate_step", "invalid_persisted_state", "invalid_snapshot", "persistence_failed"]);
const controlRequestSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
  expectedControlRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
const approvalRequestSchema = z.object({
  decision: z.enum(["approve", "return"]),
  expectedControlRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  rationale: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "return" && value.rationale === undefined) {
    context.addIssue({ code: "custom", message: "A rationale is required to return a checkpoint." });
  }
  if (value.decision === "approve" && value.rationale !== undefined) {
    context.addIssue({ code: "custom", message: "Approval does not accept a rationale." });
  }
});

type OwnedRunResult =
  | { readonly kind: "ok"; readonly run: DurableExecutionRun }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable" };

async function loadOwnedControlRun(
  dependencies: WorkflowHttpDependencies,
  runId: string,
  userId: string,
): Promise<OwnedRunResult> {
  let run: DurableExecutionRun | null;
  try { run = await dependencies.getRun(runId, userId); } catch { return { kind: "unavailable" }; }
  if (!run || run.id !== runId || run.userId !== userId) return { kind: "not_found" };
  const binding = run.runtimeContext.requestMessageBinding;
  if (!UUID.test(run.runtimeContext.conversationId) || !run.acceptedRequestId
    || run.acceptedRequestId !== binding?.requestId || !run.acceptanceFingerprint
    || !/^[0-9a-f]{64}$/.test(run.acceptanceFingerprint)
    || binding?.userId !== userId || binding.conversationId !== run.runtimeContext.conversationId) return { kind: "not_found" };
  try {
    const [validBinding, validAcceptance, ownsConversation] = await Promise.all([
      dependencies.validateBinding(run),
      dependencies.validateAcceptance(run),
      dependencies.ownsConversation(run.runtimeContext.conversationId, userId),
    ]);
    return validBinding && validAcceptance && ownsConversation ? { kind: "ok", run } : { kind: "not_found" };
  } catch {
    return { kind: "unavailable" };
  }
}

function commandError(result: ExecutionControlCommandResult): Response | null {
  if (result.kind === "rejected") {
    const code = result.failure.code;
    if (code === "ownership_denied") return error("not_found", "The workflow was not found.", 404);
    if (code === "authorization_denied") return error("authorization_denied", "Current permissions do not allow this action.", 403);
    if (code === "authorization_failed") return error("authorization_unavailable", "Current permissions could not be verified.", 503);
    if (code === "snapshot_conflict") return error("revision_conflict", "Workflow state changed; refresh status and try again.", 409);
    if (code === "indeterminate_step") return error("unsafe_boundary", "The workflow is at an unsafe execution boundary.", 409);
    if (code === "invalid_persisted_state") return error("invalid_workflow_state", "The persisted workflow state is unavailable.", 503);
    if (code === "persistence_failed") return error("unavailable", "The workflow service is temporarily unavailable.", 503);
    return error("invalid_transition", "This workflow action is not currently available.", 409);
  }
  if (result.kind === "recovery_required") return error("unsafe_boundary", "The workflow is at an unsafe execution boundary.", 409);
  return null;
}

export function toWorkflowProgressDto(run: DurableExecutionRun): WorkflowProgressDto | null {
  const conversationId = run.runtimeContext.conversationId;
  const orderedIds = run.executionPlan.orderedStepIds;
  if (!UUID.test(run.id) || !UUID.test(conversationId) || !Array.isArray(orderedIds) || orderedIds.length !== run.steps.length
    || !Number.isSafeInteger(run.controlRevision) || run.controlRevision < 0) return null;
  const stepsById = new Map(run.steps.map((step) => [step.stepId, step]));
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !stepsById.has(id))) return null;
  if (!Array.isArray(run.approvalCheckpoints) || run.approvalCheckpoints.some((checkpoint) =>
    !UUID.test(checkpoint.id) || checkpoint.runId !== run.id || checkpoint.userId !== run.userId
    || !stepsById.has(checkpoint.stepId) || !["pending", "approved", "returned"].includes(checkpoint.status))) return null;

  const pendingApprovals = new Set(run.approvalCheckpoints.filter((item) => item.status === "pending").map((item) => item.stepId));
  const steps = orderedIds.map((id) => {
    const step = stepsById.get(id)!;
    return {
      id,
      capabilityLabel: CAPABILITY_LABELS[step.capabilityId] ?? "Workflow step",
      state: step.status,
      approvalRequired: pendingApprovals.has(id),
      ...(timestamp(step.startedAt) ? { startedAt: timestamp(step.startedAt) } : {}),
      ...(timestamp(step.completedAt) ? { completedAt: timestamp(step.completedAt) } : {}),
    };
  });
  const hasPendingApproval = steps.some((step) => step.approvalRequired);
  const state: WorkflowProgressDto["state"] = hasPendingApproval ? "approval_required"
    : run.controlState === "pause_requested" || run.controlState === "paused" || run.controlState === "stop_requested"
      ? run.controlState
      : run.controlState === "stopped" || run.controlState === "returned"
        ? run.controlState
        : run.status === "pending" ? "prepared"
          : run.status === "running" ? "executing"
            : run.status === "succeeded" ? "completed" : "failed";
  const failureCodes = [run.failureCode, ...run.steps.map((step) => step.failureCode)].filter((value): value is string => Boolean(value));
  return {
    schemaVersion: 1,
    runId: run.id,
    conversationId,
    state,
    controlState: run.controlState,
    controlRevision: run.controlRevision,
    createdAt: timestamp(run.createdAt) ?? run.createdAt,
    ...(timestamp(run.startedAt) ? { startedAt: timestamp(run.startedAt) } : {}),
    ...(timestamp(run.completedAt) ? { completedAt: timestamp(run.completedAt) } : {}),
    completedStepCount: run.steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length,
    totalStepCount: run.steps.length,
    failurePresent: run.status === "failed" || failureCodes.length > 0,
    recoveryRequired: failureCodes.some((code) => RECOVERY_REQUIRED_CODES.has(code)),
    approvalCheckpoints: run.approvalCheckpoints.map(({ id, stepId, status }) => ({ id, stepId, state: status })),
    steps,
  };
}

function postAcceptanceExtra(result: Extract<AcceptedExecutionCompositionResult, { kind: "rejected" | "single_step" | "unable_to_plan" }>, idempotencyKey: string): Record<string, unknown> {
  return result.acceptedRequest
    ? { accepted: true, recovery: result.acceptedRequest }
    : result.kind === "rejected" && result.reason === "unavailable"
      ? { accepted: "unknown", recovery: { idempotencyKey } }
    : { accepted: false };
}

function mapPrepareFailure(result: Extract<AcceptedExecutionCompositionResult, { kind: "rejected" | "single_step" | "unable_to_plan" }>, idempotencyKey: string): Response {
  const extra = postAcceptanceExtra(result, idempotencyKey);
  if (result.kind === "single_step") return error("workflow_not_required", "This objective does not require a multi-step workflow.", 422, extra);
  if (result.kind === "unable_to_plan") {
    const transient = result.decision.failure.code === "planner_unavailable";
    return error(transient ? "transient_planning_failure" : "invalid_plan", result.decision.failure.message, transient ? 503 : 422, extra);
  }
  switch (result.reason) {
    case "invalid_request": return error("invalid_request", "The request is invalid.", 400);
    case "unauthorized": return error("unauthenticated", "Authentication is required.", 401);
    case "inaccessible_conversation": return error("inaccessible_conversation", "The conversation is unavailable.", 404);
    case "inaccessible_resource": return error("inaccessible_resource", "One or more resources are unavailable.", 404);
    case "daily_usage_quota_exhausted": return error("daily_usage_quota_exhausted", "The daily chat request quota has been reached.", 429);
    case "image_quota_exhausted": return error("image_quota_exhausted", "The image attachment quota has been reached.", 429);
    case "conflict": return error("idempotency_conflict", "The idempotency key was used for a different request.", 409, extra);
    case "invalid_handoff": return error("invalid_plan", "A safe workflow plan could not be validated.", 422, extra);
    case "capability_unavailable": return error("capability_unavailable", "This capability is not currently available in autonomous workflows. Use its standalone feature instead.", 422, extra);
    case "unavailable": return error("unavailable", "The workflow service is temporarily unavailable.", 503, extra);
  }
}

export function createWorkflowHttpHandlers(dependencies: WorkflowHttpDependencies) {
  return Object.freeze({
    async start(request: Request): Promise<Response> {
      if (request.method !== "POST") return error("method_not_allowed", "POST is required.", 405);
      let gate: WorkflowFeatureGate;
      try { gate = dependencies.getGate(); } catch { return error("feature_disabled", "Workflow preparation is unavailable.", 404); }
      if (!gate.enabled) return error("feature_disabled", "Workflow preparation is unavailable.", 404);
      let userId: string | null;
      try { userId = await dependencies.authenticate(); } catch { return error("unavailable", "The workflow service is temporarily unavailable.", 503); }
      if (!userId) return error("unauthenticated", "Authentication is required.", 401);
      if (!featureAllows(gate, userId)) return error("feature_disabled", "Workflow preparation is unavailable.", 404);
      if (!sameOrigin(request, dependencies.configuredAppUrl)) return error("origin_denied", "The request origin is not allowed.", 403);

      const body = await readBoundedJson(request);
      if (body.kind === "too_large") return error("invalid_request", "The request body is too large.", 413);
      if (body.kind !== "ok") return error("invalid_request", "The request body must be valid JSON.", 400);
      const parsed = agentRequestAcceptanceInputSchema.safeParse(body.value);
      if (!parsed.success) return error("invalid_request", "The workflow request is invalid.", 400);

      if (parsed.data.requestOptions.routingMode !== "auto" || classifyTaskComplexity(parsed.data.message) === "single_step") {
        return error("workflow_not_required", "Use the existing chat route for single-step requests.", 422, { accepted: false });
      }

      let currentPlan: "free" | "pro" | null;
      try { currentPlan = await dependencies.loadCurrentPlan(userId); } catch { return error("unavailable", "The workflow service is temporarily unavailable.", 503); }
      if (!currentPlan) return error("unavailable", "The account entitlement could not be verified.", 503);
      if (parsed.data.requestOptions.reasoningMode === "high" && currentPlan !== "pro") {
        return error("authorization_denied", "High reasoning is not available for this account.", 403);
      }

      let result: AcceptedExecutionCompositionResult;
      try { result = await dependencies.prepare(parsed.data); } catch {
        return error("unavailable", "The workflow service is temporarily unavailable; replay the exact request with the same idempotency key.", 503, {
          accepted: "unknown",
          recovery: { idempotencyKey: parsed.data.idempotencyKey },
        });
      }
      if (result.kind !== "associated") return mapPrepareFailure(result, parsed.data.idempotencyKey);
      const dto = toWorkflowProgressDto(result.run);
      const binding = result.run.runtimeContext.requestMessageBinding;
      if (!dto || !result.run.acceptedRequestId || !binding
        || result.run.userId !== userId
        || result.run.runtimeContext.conversationId !== parsed.data.conversationId
        || binding.userId !== userId || binding.conversationId !== parsed.data.conversationId
        || binding.requestId !== result.run.acceptedRequestId
        || !UUID.test(binding.userMessageId) || !UUID.test(binding.assistantMessageId)
        || !result.run.acceptanceFingerprint || !/^[0-9a-f]{64}$/.test(result.run.acceptanceFingerprint)
        || result.run.idempotencyKey !== parsed.data.idempotencyKey) return error("unavailable", "The persisted workflow status is unavailable.", 503, {
        accepted: true,
        recovery: { idempotencyKey: result.run.idempotencyKey },
      });
      return json({
        accepted: true,
        acceptedRequest: {
          requestId: binding.requestId,
          userMessageId: binding.userMessageId,
          assistantMessageId: binding.assistantMessageId,
          idempotencyKey: result.run.idempotencyKey,
        },
        status: dto,
      }, result.status === "created" ? 201 : 200);
    },

    async status(request: Request, runId: string): Promise<Response> {
      if (request.method !== "GET") return error("method_not_allowed", "GET is required.", 405);
      let gate: WorkflowFeatureGate;
      try { gate = dependencies.getGate(); } catch { return error("feature_disabled", "Workflow status is unavailable.", 404); }
      if (!gate.enabled) return error("feature_disabled", "Workflow status is unavailable.", 404);
      let userId: string | null;
      try { userId = await dependencies.authenticate(); } catch { return error("unavailable", "The workflow service is temporarily unavailable.", 503); }
      if (!userId) return error("unauthenticated", "Authentication is required.", 401);
      if (!featureAllows(gate, userId)) return error("feature_disabled", "Workflow status is unavailable.", 404);
      if (!UUID.test(runId)) return error("invalid_request", "The run identifier is invalid.", 400);

      const owned = await loadOwnedControlRun(dependencies, runId, userId);
      if (owned.kind === "unavailable") return error("unavailable", "Workflow status is temporarily unavailable.", 503);
      if (owned.kind !== "ok") return error("not_found", "The workflow was not found.", 404);
      const dto = toWorkflowProgressDto(owned.run);
      return dto ? json({ status: dto }, 200) : error("unavailable", "Workflow status is temporarily unavailable.", 503);
    },

    async control(request: Request, runId: string): Promise<Response> {
      if (request.method !== "POST") return error("method_not_allowed", "POST is required.", 405);
      let gate: WorkflowFeatureGate;
      try { gate = dependencies.getGate(); } catch { return error("feature_disabled", "Workflow controls are unavailable.", 404); }
      if (!gate.enabled) return error("feature_disabled", "Workflow controls are unavailable.", 404);
      let userId: string | null;
      try { userId = await dependencies.authenticate(); } catch { return error("unavailable", "The workflow service is temporarily unavailable.", 503); }
      if (!userId) return error("unauthenticated", "Authentication is required.", 401);
      if (!featureAllows(gate, userId)) return error("feature_disabled", "Workflow controls are unavailable.", 404);
      if (!sameOrigin(request, dependencies.configuredAppUrl)) return error("origin_denied", "The request origin is not allowed.", 403);
      if (!UUID.test(runId)) return error("invalid_request", "The run identifier is invalid.", 400);

      const body = await readBoundedJson(request, WORKFLOW_CONTROL_MAX_BODY_BYTES);
      if (body.kind === "too_large") return error("invalid_request", "The control request is too large.", 413);
      if (body.kind !== "ok") return error("invalid_request", "The control request must be valid JSON.", 400);
      const parsed = controlRequestSchema.safeParse(body.value);
      if (!parsed.success) return error("invalid_request", "The control request is invalid.", 400);

      const owned = await loadOwnedControlRun(dependencies, runId, userId);
      if (owned.kind === "unavailable") return error("unavailable", "Workflow ownership could not be verified.", 503);
      if (owned.kind !== "ok") return error("not_found", "The workflow was not found.", 404);
      let result: ExecutionControlCommandResult;
      try {
        result = await dependencies.mutateControl({
          runId, userId, action: parsed.data.action,
          expectedControlRevision: parsed.data.expectedControlRevision,
        });
      } catch { return error("unavailable", "The workflow service is temporarily unavailable.", 503); }
      const failed = commandError(result);
      if (failed) return failed;
      const updated = await loadOwnedControlRun(dependencies, runId, userId);
      if (updated.kind !== "ok") return error("unavailable", "The updated workflow status is unavailable.", 503);
      const dto = toWorkflowProgressDto(updated.run);
      return dto
        ? json({ result: result.kind, status: dto }, result.kind === "awaiting_human_approval" ? 409 : 200)
        : error("unavailable", "The updated workflow status is unavailable.", 503);
    },

    async decideApproval(request: Request, runId: string, checkpointId: string): Promise<Response> {
      if (request.method !== "POST") return error("method_not_allowed", "POST is required.", 405);
      let gate: WorkflowFeatureGate;
      try { gate = dependencies.getGate(); } catch { return error("feature_disabled", "Workflow approvals are unavailable.", 404); }
      if (!gate.enabled) return error("feature_disabled", "Workflow approvals are unavailable.", 404);
      let userId: string | null;
      try { userId = await dependencies.authenticate(); } catch { return error("unavailable", "The workflow service is temporarily unavailable.", 503); }
      if (!userId) return error("unauthenticated", "Authentication is required.", 401);
      if (!featureAllows(gate, userId)) return error("feature_disabled", "Workflow approvals are unavailable.", 404);
      if (!sameOrigin(request, dependencies.configuredAppUrl)) return error("origin_denied", "The request origin is not allowed.", 403);
      if (!UUID.test(runId) || !UUID.test(checkpointId)) return error("invalid_request", "The workflow or checkpoint identifier is invalid.", 400);

      const body = await readBoundedJson(request, WORKFLOW_CONTROL_MAX_BODY_BYTES);
      if (body.kind === "too_large") return error("invalid_request", "The approval request is too large.", 413);
      if (body.kind !== "ok") return error("invalid_request", "The approval request must be valid JSON.", 400);
      const parsed = approvalRequestSchema.safeParse(body.value);
      if (!parsed.success) return error("invalid_request", "The approval request is invalid.", 400);

      const owned = await loadOwnedControlRun(dependencies, runId, userId);
      if (owned.kind === "unavailable") return error("unavailable", "Workflow ownership could not be verified.", 503);
      if (owned.kind !== "ok") return error("not_found", "The workflow was not found.", 404);
      const checkpoint = owned.run.approvalCheckpoints.find((item) => item.id === checkpointId
        && item.runId === runId && item.userId === userId);
      if (!checkpoint) return error("not_found", "The approval checkpoint was not found.", 404);
      let result: ExecutionControlCommandResult;
      try {
        result = await dependencies.decideApproval({
          runId, userId, checkpointId, decision: parsed.data.decision,
          expectedControlRevision: parsed.data.expectedControlRevision,
          ...(parsed.data.rationale === undefined ? {} : { rationale: parsed.data.rationale }),
        });
      } catch { return error("unavailable", "The workflow service is temporarily unavailable.", 503); }
      const failed = commandError(result);
      if (failed) return failed;
      const updated = await loadOwnedControlRun(dependencies, runId, userId);
      if (updated.kind !== "ok") return error("unavailable", "The updated workflow status is unavailable.", 503);
      const dto = toWorkflowProgressDto(updated.run);
      return dto ? json({ result: result.kind, status: dto }, 200)
        : error("unavailable", "The updated workflow status is unavailable.", 503);
    },
  });
}
