import {
  validateCapaImplementationEvidenceAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-validator";
import type {
  CapaImplementationEvidenceAdvisoryCitation,
  CapaImplementationEvidenceAdvisoryFinding,
  CapaImplementationEvidenceAdvisoryResponse,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-contract";
import {
  validateCapaImplementationWorkspaceDraft,
} from "../../lib/capa/implementation/capa-implementation-validator";
import type {
  CapaImplementationActionProgress,
  CapaImplementationOwnerReportedStatus,
  CapaImplementationWorkspaceDraft,
} from "../../lib/capa/implementation/capa-implementation-contract";
import type {
  CapaImplementationEvidence,
  CapaImplementationEvidenceKind,
} from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import type {
  CapaImplementationEvidenceSource,
  CapaImplementationProvenanceOriginKind,
  CapaImplementationProvenanceSourceSystemKind,
} from "../../lib/capa/implementation/capa-implementation-provenance-contract";
import type {
  CapaImplementationReviewReturnResponseEditableContent,
} from "../../lib/capa/implementation/capa-implementation-return-response-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export interface CapaImplementationApprovedActionProjection {
  readonly approved_action_reference: string;
  readonly status: string | null;
  readonly action_type: string | null;
  readonly description: string | null;
  readonly due_date: string | null;
  readonly deliverable: string | null;
  readonly implementation_expectation: string | null;
  readonly effectiveness_check_required: boolean;
  readonly acceptance_criteria: readonly string[];
}

export interface CapaImplementationWorkspaceProjection {
  readonly draft_revision: number | null;
  readonly case_version_id: string;
  readonly record_version: number;
  readonly approved_s70_baseline: {
    readonly source_case_version_id: string;
    readonly approved_action_plan_section_id: string;
    readonly approval_decision_reference: string;
  };
  readonly approved_actions: readonly CapaImplementationApprovedActionProjection[];
  readonly draft: CapaImplementationWorkspaceDraft | null;
  readonly implementation_review_return_cycle: {
    readonly return_transition_audit_event_id: string;
    readonly source_case_version_id: string;
    readonly resulting_case_version_id: string;
    readonly returned_by_user_id: string;
    readonly returned_at: string;
    readonly rationale: string;
  } | null;
  readonly updated_at: string | null;
}

export interface CapaImplementationWorkspaceLoadSuccess {
  readonly status: "loaded";
  readonly workspace: CapaImplementationWorkspaceProjection;
  readonly correlation_id: string;
}

export interface CapaImplementationWorkspaceFailure {
  readonly status: "failed";
  readonly code: string | null;
  readonly message: string;
  readonly correlation_id: string | null;
}

export type CapaImplementationWorkspaceLoadResult = CapaImplementationWorkspaceLoadSuccess | CapaImplementationWorkspaceFailure;
export type CapaImplementationWorkspaceSaveResult =
  | { readonly status: "saved"; readonly workspace: CapaImplementationWorkspaceProjection; readonly correlation_id: string }
  | CapaImplementationWorkspaceFailure;

export interface CapaImplementationWorkspaceSaveInput {
  readonly expected_draft_revision: number | null;
  readonly action_progress: readonly CapaImplementationActionProgress[];
  readonly implementation_review_return_response?: CapaImplementationReviewReturnResponseEditableContent | null;
}

export interface CapaImplementationSubmissionSuccess {
  readonly status: "submitted";
  readonly capa: {
    readonly capa_case_id: string;
    readonly case_number: string;
    readonly status: "S90";
    readonly workflow_state: "S90";
    readonly record_version: number;
    readonly current_version_id: string;
    readonly source_case_version_id: string;
    readonly resulting_case_version_id: string;
    readonly implementation_review_baseline_section_version_id: string;
    readonly submitted_at: string;
  };
  readonly transition_audit_event_id: string;
  readonly replayed: boolean;
  readonly correlation_id: string;
}

export type CapaImplementationSubmissionResult =
  | { readonly status: "success"; readonly value: CapaImplementationSubmissionSuccess }
  | CapaImplementationWorkspaceFailure;

export interface CapaImplementationEvidenceAdvisoryClientSuccess {
  readonly advisory: CapaImplementationEvidenceAdvisoryResponse;
  readonly snapshot: {
    readonly capa_case_id: string;
    readonly case_version_id: string;
    readonly record_version: number;
  };
  readonly correlation_id: string;
}

export type CapaImplementationEvidenceAdvisoryClientResult =
  | { readonly status: "success"; readonly value: CapaImplementationEvidenceAdvisoryClientSuccess }
  | CapaImplementationWorkspaceFailure;

export interface CapaImplementationEvidenceAdvisoryAdoptionSuccess {
  readonly status: "prepared";
  readonly patch: {
    readonly output_id: string;
    readonly finding_id: string;
    readonly capa_case_id: string;
    readonly case_version_id: string;
    readonly record_version: number;
    readonly approved_action_reference: string;
    readonly field: "implementation_narrative";
    readonly value: string;
    readonly requires_human_review: true;
    readonly auto_saved: false;
    readonly auto_submitted: false;
    readonly evidence_created: false;
    readonly owner_reported_status_changed: false;
    readonly approved_baseline_changed: false;
    readonly audit_event_id: string | null;
  };
  readonly correlation_id: string;
}

export type CapaImplementationEvidenceAdvisoryAdoptionResult =
  | { readonly status: "success"; readonly value: CapaImplementationEvidenceAdvisoryAdoptionSuccess }
  | CapaImplementationWorkspaceFailure;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function text(value: unknown, maximum = 4_000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value;
}

function nullableText(value: unknown, maximum = 4_000): value is string | null {
  return value === null || text(value, maximum);
}

function correlation(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseFailure(value: unknown, fallback: string): CapaImplementationWorkspaceFailure {
  const error = record(value) && record(value.error) ? value.error : null;
  const code = error && typeof error.code === "string" ? error.code : null;
  const issueMessages = error && Array.isArray(error.issues)
    ? error.issues.flatMap((issue) => record(issue) && typeof issue.message === "string" ? [issue.message] : [])
    : [];
  const baseMessage = error && typeof error.message === "string" ? error.message : fallback;
  return {
    status: "failed",
    code,
    message: `${code === "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT"
      ? "The S80 workspace changed elsewhere. Reload it before saving again."
      : code === "WORKFLOW_MUTATION_DETECTED"
        ? "The CAPA changed while this workspace was being saved. Reload the authoritative case before continuing."
        : code === "CAPA_IMPLEMENTATION_WORKSPACE_ACCESS_DENIED"
          ? "You are not authorized to edit this S80 implementation workspace."
          : code === "CAPA_IMPLEMENTATION_WORKSPACE_CASE_STATE_CONFLICT"
            ? "The CAPA case is no longer in S80 Implementation."
    : code === "CAPA_IMPLEMENTATION_BASELINE_NOT_AVAILABLE"
              ? "The approved S70 action-plan baseline is not available."
              : code === "CAPA_IMPLEMENTATION_SUBMISSION_NOT_READY"
                ? "The implementation package is not ready for Implementation Review. Check each action's status, narrative, evidence, and provenance."
                : code === "CAPA_IMPLEMENTATION_SUBMISSION_ACCESS_DENIED"
                  ? "You are not authorized to submit this S80 implementation package for review."
                  : code === "CAPA_WORKFLOW_CONFLICT"
                    ? "The CAPA case is no longer in S80 Implementation."
                    : code === "CAPA_CONCURRENCY_CONFLICT"
                      ? "The CAPA changed before implementation submission. Reload the authoritative case before trying again."
                      : code === "CAPA_IMPLEMENTATION_SUBMISSION_VALIDATION_FAILED"
                        ? "The implementation package did not pass controlled validation."
              : code === "INVALID_CAPA_IMPLEMENTATION_WORKSPACE_REQUEST"
                ? "The S80 workspace contains invalid draft data."
                : baseMessage}${issueMessages.length === 0 ? "" : ` ${issueMessages.join(" ")}`}`,
    correlation_id: error && correlation(error.correlation_id)
      ? error.correlation_id
      : record(value) && correlation(value.correlation_id)
        ? value.correlation_id
        : null,
  };
}

function parseApprovedAction(value: unknown): CapaImplementationApprovedActionProjection | null {
  if (!record(value) || !exact(value, ["approved_action_reference", "status", "action_type", "description", "due_date", "deliverable", "implementation_expectation", "effectiveness_check_required", "acceptance_criteria"])) return null;
  if (!text(value.approved_action_reference, 256) || !nullableText(value.status, 64) || !nullableText(value.action_type, 64) || !nullableText(value.description) || !nullableText(value.due_date, 32) || !nullableText(value.deliverable) || !nullableText(value.implementation_expectation) || typeof value.effectiveness_check_required !== "boolean" || !Array.isArray(value.acceptance_criteria) || value.acceptance_criteria.some((item) => !text(item))) return null;
  return Object.freeze({
    approved_action_reference: value.approved_action_reference,
    status: value.status,
    action_type: value.action_type,
    description: value.description,
    due_date: value.due_date,
    deliverable: value.deliverable,
    implementation_expectation: value.implementation_expectation,
    effectiveness_check_required: value.effectiveness_check_required,
    acceptance_criteria: Object.freeze([...value.acceptance_criteria]),
  });
}

function parseReturnCycle(value: unknown): CapaImplementationWorkspaceProjection["implementation_review_return_cycle"] | null | undefined {
  if (value === null || value === undefined) return value;
  if (!record(value) || !exact(value, ["return_transition_audit_event_id", "source_case_version_id", "resulting_case_version_id", "returned_by_user_id", "returned_at", "rationale"]) || !correlation(value.return_transition_audit_event_id) || !correlation(value.source_case_version_id) || !correlation(value.resulting_case_version_id) || !correlation(value.returned_by_user_id) || typeof value.returned_at !== "string" || !ISO_DATE_TIME.test(value.returned_at) || Number.isNaN(Date.parse(value.returned_at)) || !text(value.rationale)) return null;
  return Object.freeze({ return_transition_audit_event_id: value.return_transition_audit_event_id, source_case_version_id: value.source_case_version_id, resulting_case_version_id: value.resulting_case_version_id, returned_by_user_id: value.returned_by_user_id, returned_at: value.returned_at, rationale: value.rationale });
}

function parseProjection(value: unknown): CapaImplementationWorkspaceProjection | null {
  if (!record(value)) return null;
  const projectionFields = Object.hasOwn(value, "implementation_review_return_cycle")
    ? ["draft_revision", "case_version_id", "record_version", "approved_s70_baseline", "approved_actions", "draft", "implementation_review_return_cycle", "updated_at"]
    : ["draft_revision", "case_version_id", "record_version", "approved_s70_baseline", "approved_actions", "draft", "updated_at"];
  if (!exact(value, projectionFields) || (value.draft_revision !== null && !positiveInteger(value.draft_revision)) || !correlation(value.case_version_id) || !positiveInteger(value.record_version) || !record(value.approved_s70_baseline) || !exact(value.approved_s70_baseline, ["source_case_version_id", "approved_action_plan_section_id", "approval_decision_reference"]) || !correlation(value.approved_s70_baseline.source_case_version_id) || !correlation(value.approved_s70_baseline.approved_action_plan_section_id) || !correlation(value.approved_s70_baseline.approval_decision_reference) || !Array.isArray(value.approved_actions) || value.approved_actions.length === 0 || value.approved_actions.some((item) => parseApprovedAction(item) === null) || (value.updated_at !== null && (typeof value.updated_at !== "string" || !ISO_DATE_TIME.test(value.updated_at) || Number.isNaN(Date.parse(value.updated_at))))) return null;
  let returnCycle = parseReturnCycle(value.implementation_review_return_cycle);
  if (returnCycle === undefined) returnCycle = null;
  if (returnCycle === null && value.implementation_review_return_cycle !== null && value.implementation_review_return_cycle !== undefined) return null;
  const actions = value.approved_actions.map((item) => parseApprovedAction(item)!).map((item) => item.approved_action_reference);
  if (new Set(actions).size !== actions.length) return null;
  const parsedDraft = value.draft === null ? null : validateCapaImplementationWorkspaceDraft(value.draft);
  if (parsedDraft !== null && parsedDraft.status !== "valid") return null;
  const baseline = {
    source_case_version_id: value.approved_s70_baseline.source_case_version_id,
    approved_action_plan_section_id: value.approved_s70_baseline.approved_action_plan_section_id,
    approval_decision_reference: value.approved_s70_baseline.approval_decision_reference,
  };
  return Object.freeze({
    draft_revision: value.draft_revision,
    case_version_id: value.case_version_id,
    record_version: value.record_version,
    approved_s70_baseline: Object.freeze(baseline),
    approved_actions: Object.freeze(value.approved_actions.map((item) => parseApprovedAction(item)!)),
    draft: parsedDraft === null ? null : parsedDraft.value,
    implementation_review_return_cycle: returnCycle,
    updated_at: value.updated_at,
  });
}

export function parseCapaImplementationWorkspaceLoad(value: unknown): CapaImplementationWorkspaceLoadResult {
  if (!record(value) || !Object.hasOwn(value, "workspace") || !correlation(value.correlation_id) || parseProjection(value.workspace) === null) return { ...parseFailure(value, "The S80 implementation workspace response could not be verified."), code: "INVALID_WORKSPACE_RESPONSE" };
  return Object.freeze({ status: "loaded", workspace: parseProjection(value.workspace)!, correlation_id: value.correlation_id });
}

export function parseCapaImplementationWorkspaceSave(value: unknown): CapaImplementationWorkspaceSaveResult {
  if (!record(value) || !correlation(value.correlation_id) || parseProjection(value.workspace) === null) return { ...parseFailure(value, "The S80 implementation workspace response could not be verified."), code: "INVALID_WORKSPACE_RESPONSE" };
  return Object.freeze({ status: "saved", workspace: parseProjection(value.workspace)!, correlation_id: value.correlation_id });
}

function trace(): { readonly requestId: string; readonly correlationId: string } {
  return { requestId: crypto.randomUUID(), correlationId: crypto.randomUUID() };
}

export async function loadCapaImplementationWorkspace(caseId: string, fetcher: typeof fetch = fetch): Promise<CapaImplementationWorkspaceLoadResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/implementation-workspace`, { method: "GET", cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    return response.ok ? parseCapaImplementationWorkspaceLoad(body) : parseFailure(body, "The S80 implementation workspace could not be loaded.");
  } catch {
    return { status: "failed", code: null, message: "The S80 implementation workspace could not be loaded.", correlation_id: null };
  }
}

export async function saveCapaImplementationWorkspace(caseId: string, input: CapaImplementationWorkspaceSaveInput, fetcher: typeof fetch = fetch): Promise<CapaImplementationWorkspaceSaveResult> {
  const requestTrace = trace();
  try {
    const payload = {
      expected_draft_revision: input.expected_draft_revision,
      action_progress: input.action_progress,
      ...(input.implementation_review_return_response === undefined ? {} : {
        implementation_review_return_response: input.implementation_review_return_response,
      }),
    };
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/implementation-workspace`, { method: "PUT", cache: "no-store", headers: { "content-type": "application/json", "x-request-id": requestTrace.requestId, "x-correlation-id": requestTrace.correlationId }, body: JSON.stringify(payload) });
    const body: unknown = await response.json().catch(() => null);
    return response.ok ? parseCapaImplementationWorkspaceSave(body) : parseFailure(body, "The S80 implementation workspace could not be saved.");
  } catch {
    return { status: "failed", code: null, message: "The S80 implementation workspace could not be saved.", correlation_id: null };
  }
}

function parseSubmissionSuccess(value: unknown): CapaImplementationSubmissionSuccess | null {
  if (!record(value) || value.status !== "submitted" || !record(value.capa) || !correlation(value.correlation_id) || typeof value.replayed !== "boolean" || !UUID.test(String(value.transition_audit_event_id))) return null;
  const capa = value.capa;
  const fields = ["capa_case_id", "case_number", "status", "workflow_state", "record_version", "current_version_id", "source_case_version_id", "resulting_case_version_id", "implementation_review_baseline_section_version_id", "submitted_at"] as const;
  if (!exact(capa, fields) || capa.status !== "S90" || capa.workflow_state !== "S90" || !UUID.test(String(capa.capa_case_id)) || typeof capa.case_number !== "string" || capa.case_number.length === 0 || !positiveInteger(capa.record_version) || !UUID.test(String(capa.current_version_id)) || !UUID.test(String(capa.source_case_version_id)) || !UUID.test(String(capa.resulting_case_version_id)) || !UUID.test(String(capa.implementation_review_baseline_section_version_id)) || typeof capa.submitted_at !== "string" || !ISO_DATE_TIME.test(capa.submitted_at) || Number.isNaN(Date.parse(capa.submitted_at))) return null;
  return Object.freeze({ status: "submitted", capa: { capa_case_id: capa.capa_case_id as string, case_number: capa.case_number, status: "S90" as const, workflow_state: "S90" as const, record_version: capa.record_version as number, current_version_id: capa.current_version_id as string, source_case_version_id: capa.source_case_version_id as string, resulting_case_version_id: capa.resulting_case_version_id as string, implementation_review_baseline_section_version_id: capa.implementation_review_baseline_section_version_id as string, submitted_at: capa.submitted_at as string }, transition_audit_event_id: value.transition_audit_event_id as string, replayed: value.replayed, correlation_id: value.correlation_id as string });
}

export function parseCapaImplementationSubmission(value: unknown, expectedCaseId?: string): CapaImplementationSubmissionResult {
  const success = parseSubmissionSuccess(value);
  if (success !== null && (expectedCaseId === undefined || success.capa.capa_case_id === expectedCaseId)) return Object.freeze({ status: "success", value: success });
  if (record(value) && record(value.error) && typeof value.error.code === "string") {
    return parseFailure(value, "The implementation submission could not be completed.");
  }
  return { ...parseFailure(value, "The implementation submission response could not be verified safely."), code: "INVALID_IMPLEMENTATION_SUBMISSION_RESPONSE" };
}

export async function submitCapaImplementationForReview(caseId: string, expectedDraftRevision: number, fetcher: typeof fetch = fetch): Promise<CapaImplementationSubmissionResult> {
  const requestTrace = trace();
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/submit-implementation`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-request-id": requestTrace.requestId, "x-correlation-id": requestTrace.correlationId }, body: JSON.stringify({ expected_draft_revision: expectedDraftRevision }) });
    const body: unknown = await response.json().catch(() => null);
    return parseCapaImplementationSubmission(body, caseId);
  } catch {
    return { status: "failed", code: null, message: "The implementation submission could not be completed.", correlation_id: null };
  }
}

export const submitCapaImplementationSubmission = submitCapaImplementationForReview;

function parseCitation(value: unknown): CapaImplementationEvidenceAdvisoryCitation | null {
  if (!record(value) || !exact(value, ["reference_key", "source_kind", "source_reference", "source_status", "locator"]) || !text(value.reference_key, 128) || !["approved_action", "implementation_evidence", "governed_knowledge"].includes(String(value.source_kind)) || !text(value.source_reference, 1_000) || !["authoritative", "untrusted_human_draft", "governed_current_effective"].includes(String(value.source_status)) || !nullableText(value.locator, 1_000)) return null;
  return value as unknown as CapaImplementationEvidenceAdvisoryCitation;
}

function parseAdvisory(value: unknown): CapaImplementationEvidenceAdvisoryResponse | null {
  if (!record(value) || typeof value.run_id !== "string" || !UUID.test(value.run_id) || typeof value.output_id !== "string" || !UUID.test(value.output_id) || value.output_schema_version !== "capa_implementation_evidence_advisory-1.0.0") return null;
  const { run_id: _runId, output_id: _outputId, output_schema_version: _schema, citations, ...modelOutput } = value;
  if (!Array.isArray(citations) || citations.some((item) => parseCitation(item) === null)) return null;
  try {
    const validated = validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify({ ...modelOutput, citations: [] }));
    return Object.freeze({ ...validated, run_id: value.run_id as never, output_id: value.output_id as never, output_schema_version: value.output_schema_version as never, citations: Object.freeze(citations.map((item) => parseCitation(item)!)) });
  } catch {
    return null;
  }
}

export function parseCapaImplementationEvidenceAdvisory(value: unknown): CapaImplementationEvidenceAdvisoryClientResult {
  if (!record(value) || !correlation(value.correlation_id) || !record(value.snapshot) || value.snapshot.capa_case_id === undefined || typeof value.snapshot.capa_case_id !== "string" || !correlation(value.snapshot.case_version_id) || !positiveInteger(value.snapshot.record_version) || parseAdvisory(value.advisory) === null) return parseFailure(value, "The governed S80 advisory response could not be verified.");
  return Object.freeze({ status: "success", value: { advisory: parseAdvisory(value.advisory)!, snapshot: { capa_case_id: value.snapshot.capa_case_id, case_version_id: value.snapshot.case_version_id, record_version: value.snapshot.record_version }, correlation_id: value.correlation_id } });
}

export async function generateCapaImplementationEvidenceAdvisory(caseId: string, caseVersionId: string, recordVersion: number, fetcher: typeof fetch = fetch): Promise<CapaImplementationEvidenceAdvisoryClientResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/implementation-evidence-advisory`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_case_version_id: caseVersionId, expected_record_version: recordVersion }) });
    const body: unknown = await response.json().catch(() => null);
    return response.ok ? parseCapaImplementationEvidenceAdvisory(body) : parseFailure(body, "The governed S80 advisory could not be generated.");
  } catch {
    return { status: "failed", code: null, message: "The governed S80 advisory could not be generated.", correlation_id: null };
  }
}

export async function prepareCapaImplementationEvidenceAdvisoryAdoption(caseId: string, input: { readonly output_id: string; readonly finding_id: string; readonly expected_case_version_id: string; readonly expected_record_version: number }, fetcher: typeof fetch = fetch): Promise<CapaImplementationEvidenceAdvisoryAdoptionResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/implementation-evidence-advisory/${encodeURIComponent(input.output_id)}/adoptions`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(input) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !record(body) || !correlation(body.correlation_id) || !record(body.adoption) || body.adoption.status !== "prepared" || !record(body.adoption.patch)) return parseFailure(body, "The advisory suggestion could not be adopted safely.");
    const patch = body.adoption.patch;
    if (!exact(patch, ["output_id", "finding_id", "capa_case_id", "case_version_id", "record_version", "approved_action_reference", "field", "value", "requires_human_review", "auto_saved", "auto_submitted", "evidence_created", "owner_reported_status_changed", "approved_baseline_changed", "audit_event_id"]) || patch.output_id !== input.output_id || patch.finding_id !== input.finding_id || patch.capa_case_id !== caseId || patch.case_version_id !== input.expected_case_version_id || patch.record_version !== input.expected_record_version || patch.field !== "implementation_narrative" || !text(patch.value) || patch.requires_human_review !== true || patch.auto_saved !== false || patch.auto_submitted !== false || patch.evidence_created !== false || patch.owner_reported_status_changed !== false || patch.approved_baseline_changed !== false || (patch.audit_event_id !== null && !UUID.test(String(patch.audit_event_id)))) return parseFailure(body, "The advisory suggestion could not be verified safely.");
    return Object.freeze({ status: "success", value: { status: "prepared" as const, patch: patch as CapaImplementationEvidenceAdvisoryAdoptionSuccess["patch"], correlation_id: body.correlation_id } });
  } catch {
    return { status: "failed", code: null, message: "The advisory suggestion could not be adopted safely.", correlation_id: null };
  }
}

export function createInitialCapaImplementationWorkspaceDraft(actions: readonly CapaImplementationApprovedActionProjection[]): CapaImplementationWorkspaceDraft {
  return {
    schema_version: "capa-implementation-workspace-draft-1.0.0",
    action_progress: actions.map((action) => ({ approved_action_reference: action.approved_action_reference, owner_reported_status: "not_started", implementation_narrative: null, blocked_reason: null, evidence: [] })),
    implementation_review_return_response: null,
  };
}

export function createEmptyCapaImplementationEvidence(actionReference: string): CapaImplementationEvidence {
  return { schema_version: "capa-implementation-evidence-1.0.0", evidence_id: crypto.randomUUID() as never, approved_action_reference: actionReference, evidence_kind: "other", description: "", evidence_date: "", source: emptyCapaImplementationEvidenceSource() };
}

export function emptyCapaImplementationEvidenceSource(): CapaImplementationEvidenceSource {
  return { origin_kind: "human_observation", source_system_kind: "other", source_system_name: null, source_record_reference: null, source_record_version: null, artifact_reference: null };
}

export function validateCapaImplementationWorkspaceForBrowser(draft: CapaImplementationWorkspaceDraft): string | null {
  const result = validateCapaImplementationWorkspaceDraft(draft);
  if (result.status === "valid") return null;
  const messages: Readonly<Record<string, string>> = {
    BLOCKED_REASON_REQUIRED: "Add a blocked reason before saving a blocked action.",
    INVALID_IMPLEMENTATION_EVIDENCE_DESCRIPTION: "Each evidence entry needs a description.",
    INVALID_IMPLEMENTATION_EVIDENCE_DATE: "Each evidence entry needs a valid evidence date.",
    INVALID_IMPLEMENTATION_PROVENANCE_COMBINATION: "The selected provenance fields are not a valid combination.",
    INVALID_IMPLEMENTATION_PROVENANCE_FIELD: "Check the provenance fields for length and value format.",
    INVALID_IMPLEMENTATION_NARRATIVE: "Implementation narrative text is empty or exceeds 4,000 characters.",
  };
  return messages[result.reason_code] ?? "Review the S80 workspace fields before saving.";
}

export type { CapaImplementationActionProgress, CapaImplementationEvidence, CapaImplementationEvidenceKind, CapaImplementationEvidenceSource, CapaImplementationOwnerReportedStatus, CapaImplementationProvenanceOriginKind, CapaImplementationProvenanceSourceSystemKind, CapaImplementationWorkspaceDraft, CapaImplementationEvidenceAdvisoryFinding };
