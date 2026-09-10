import {
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../../lib/capa/domain/capa-action-plan";
import {
  validateCapaActionPlanReviewReturnResponseDraft,
  type CapaActionPlanReviewReturnResponseEditableContent,
  type CapaActionPlanReviewReturnResponseDraft,
} from "../../lib/capa/domain/capa-action-plan-review-return-response";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const CONTROLLED_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  CAPA_ACTION_PLAN_WORKSPACE_CASE_NOT_FOUND: "The CAPA case was not found.",
  CAPA_ACTION_PLAN_WORKSPACE_CASE_STATE_CONFLICT: "The CAPA case is not in S60 Action Planning.",
  WORKFLOW_MUTATION_DETECTED: "The CAPA changed while the workspace was being saved. Reload the authoritative case before continuing.",
  CAPA_ACTION_PLAN_WORKSPACE_ACCESS_DENIED: "You are not authorized to edit this Action Planning workspace.",
  INVALID_CAPA_ACTION_PLAN_WORKSPACE_REQUEST: "The Action Planning workspace contains invalid draft data.",
  WORKSPACE_DRAFT_CONCURRENCY_CONFLICT: "The Action Planning workspace changed elsewhere. Reload it before saving again.",
  CAPA_INTERNAL_ERROR: "The Action Planning workspace could not be completed.",
};

export interface CapaActionPlanWorkspaceProjection {
  readonly draft_revision: number;
  readonly case_version_id: string;
  readonly record_version: number;
  readonly action_plan: CapaActionPlanContent;
  readonly action_plan_return_response?: CapaActionPlanWorkspaceReturnResponse | null;
  readonly updated_at: string;
}

export interface CapaActionPlanWorkspaceReturnResponse {
  readonly editable: CapaActionPlanReviewReturnResponseEditableContent;
  readonly metadata: {
    readonly schema_version: CapaActionPlanReviewReturnResponseDraft["schema_version"];
    readonly responded_by: CapaActionPlanReviewReturnResponseDraft["responded_by"];
    readonly responded_at: CapaActionPlanReviewReturnResponseDraft["responded_at"];
    readonly return_transition_audit_event_id: CapaActionPlanReviewReturnResponseDraft["return_transition_audit_event_id"];
    readonly source_case_version_id: CapaActionPlanReviewReturnResponseDraft["source_case_version_id"];
    readonly resulting_case_version_id: CapaActionPlanReviewReturnResponseDraft["resulting_case_version_id"];
  };
}

export interface CapaActionPlanWorkspaceLoadSuccess {
  readonly status: "loaded";
  readonly workspace: CapaActionPlanWorkspaceProjection | null;
  readonly correlation_id: string | null;
}

export interface CapaActionPlanWorkspaceFailure {
  readonly status: "failed";
  readonly code: string | null;
  readonly message: string;
  readonly correlation_id: string | null;
}

export type CapaActionPlanWorkspaceLoadResult = CapaActionPlanWorkspaceLoadSuccess | CapaActionPlanWorkspaceFailure;
export type CapaActionPlanWorkspaceSaveResult =
  | { readonly status: "saved"; readonly workspace: CapaActionPlanWorkspaceProjection; readonly correlation_id: string | null }
  | CapaActionPlanWorkspaceFailure;

export interface CapaActionPlanWorkspaceSaveInput {
  readonly expected_draft_revision: number | null;
  readonly action_plan: CapaActionPlanContent;
  readonly action_plan_return_response?: CapaActionPlanReviewReturnResponseEditableContent | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function correlation(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function projection(value: unknown): CapaActionPlanWorkspaceProjection | null {
  if (!record(value) || !(exact(value, ["draft_revision", "case_version_id", "record_version", "action_plan", "updated_at"]) || exact(value, ["draft_revision", "case_version_id", "record_version", "action_plan", "action_plan_return_response", "updated_at"])) ||
    !positiveSafeInteger(value.draft_revision) || typeof value.case_version_id !== "string" || !UUID.test(value.case_version_id) ||
    !positiveSafeInteger(value.record_version) || typeof value.updated_at !== "string" || !ISO_DATE_TIME.test(value.updated_at) || Number.isNaN(Date.parse(value.updated_at))) return null;
  const actionPlan = validateCapaActionPlan(value.action_plan);
  if (actionPlan.status !== "valid") return null;
  const response = value.action_plan_return_response === undefined || value.action_plan_return_response === null
    ? null
    : validateCapaActionPlanReviewReturnResponseDraft(value.action_plan_return_response);
  if (response !== null && response.status !== "valid") return null;
  const responseValue = response === null ? null : response.value;
  return Object.freeze({
    draft_revision: value.draft_revision,
    case_version_id: value.case_version_id,
    record_version: value.record_version,
    action_plan: actionPlan.value,
    action_plan_return_response: responseValue === null ? null : Object.freeze({
      editable: Object.freeze({ response_narrative: responseValue.response_narrative }),
      metadata: Object.freeze({
        schema_version: responseValue.schema_version,
        responded_by: responseValue.responded_by,
        responded_at: responseValue.responded_at,
        return_transition_audit_event_id: responseValue.return_transition_audit_event_id,
        source_case_version_id: responseValue.source_case_version_id,
        resulting_case_version_id: responseValue.resulting_case_version_id,
      }),
    }),
    updated_at: value.updated_at,
  });
}

function parseCorrelation(value: unknown): string | null {
  return record(value) ? correlation(value.correlation_id) : null;
}

function parseFailure(value: unknown, fallback: string): CapaActionPlanWorkspaceFailure {
  const error = record(value) && record(value.error) ? value.error : null;
  const rawCode = error && typeof error.code === "string" ? error.code : null;
  const code = rawCode !== null && Object.prototype.hasOwnProperty.call(CONTROLLED_FAILURE_MESSAGES, rawCode) ? rawCode : null;
  return Object.freeze({ status: "failed", code, message: code === null ? fallback : CONTROLLED_FAILURE_MESSAGES[code]!, correlation_id: error ? correlation(error.correlation_id) : parseCorrelation(value) });
}

export function parseCapaActionPlanWorkspaceLoad(value: unknown): CapaActionPlanWorkspaceLoadResult {
  if (!record(value) || !exact(value, ["workspace", "correlation_id"]) || correlation(value.correlation_id) === null || (value.workspace !== null && projection(value.workspace) === null)) return { status: "failed", code: "INVALID_WORKSPACE_RESPONSE", message: "The Action Planning workspace response could not be verified.", correlation_id: parseCorrelation(value) };
  return Object.freeze({ status: "loaded", workspace: value.workspace === null ? null : projection(value.workspace)!, correlation_id: correlation(value.correlation_id) });
}

export function parseCapaActionPlanWorkspaceSave(value: unknown): CapaActionPlanWorkspaceSaveResult {
  if (!record(value) || !exact(value, ["workspace", "correlation_id"]) || correlation(value.correlation_id) === null || projection(value.workspace) === null) return { status: "failed", code: "INVALID_WORKSPACE_RESPONSE", message: "The Action Planning workspace response could not be verified.", correlation_id: parseCorrelation(value) };
  return Object.freeze({ status: "saved", workspace: projection(value.workspace)!, correlation_id: correlation(value.correlation_id) });
}

function trace(): { readonly requestId: string; readonly correlationId: string } {
  return { requestId: crypto.randomUUID(), correlationId: crypto.randomUUID() };
}

export async function loadActionPlanWorkspace(caseId: string, fetcher: typeof fetch = fetch): Promise<CapaActionPlanWorkspaceLoadResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/action-plan-workspace`, { method: "GET", cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseFailure(body, "The Action Planning workspace could not be loaded.");
    return parseCapaActionPlanWorkspaceLoad(body);
  } catch {
    return { status: "failed", code: null, message: "The Action Planning workspace could not be loaded.", correlation_id: null };
  }
}

export async function saveActionPlanWorkspace(caseId: string, input: CapaActionPlanWorkspaceSaveInput, fetcher: typeof fetch = fetch): Promise<CapaActionPlanWorkspaceSaveResult> {
  const requestTrace = trace();
  const safeInput = {
    expected_draft_revision: input.expected_draft_revision,
    action_plan: input.action_plan,
    ...(input.action_plan_return_response === undefined
      ? {}
      : { action_plan_return_response: input.action_plan_return_response === null ? null : { response_narrative: input.action_plan_return_response.response_narrative } }),
  };
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/action-plan-workspace`, {
      method: "PUT",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-request-id": requestTrace.requestId, "x-correlation-id": requestTrace.correlationId },
      body: JSON.stringify(safeInput),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseFailure(body, "The Action Planning workspace could not be saved.");
    return parseCapaActionPlanWorkspaceSave(body);
  } catch {
    return { status: "failed", code: null, message: "The Action Planning workspace could not be saved.", correlation_id: null };
  }
}
