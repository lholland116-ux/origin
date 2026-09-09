import {
  CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaActionPlanReviewAdvisoryResponse,
} from "../../lib/capa/ai/capa-action-plan-review-advisory-contract";
import { validateCapaActionPlanReviewAdvisoryModelOutput } from "../../lib/capa/ai/capa-action-plan-review-advisory-validator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && value.trim() === value && UUID.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export interface CapaActionPlanReviewAdvisoryRequest {
  readonly expected_case_version_id: string;
  readonly expected_record_version: number;
}

export interface CapaActionPlanReviewAdvisorySuccess {
  readonly advisory: CapaActionPlanReviewAdvisoryResponse;
  readonly snapshot: Readonly<{
    readonly capaCaseId: string;
    readonly caseVersionId: string;
    readonly recordVersion: number;
  }>;
  readonly correlationId: string;
}

export interface CapaActionPlanReviewAdvisoryFailure {
  readonly code: string | null;
  readonly message: string;
  readonly correlationId: string | null;
}

const SAFE_FAILURE_MESSAGE = "The governed S70 action-plan review advisory could not be completed.";
const INVALID_RESPONSE_MESSAGE = "The advisory response could not be verified.";

function parseAdvisory(value: unknown): CapaActionPlanReviewAdvisoryResponse | null {
  if (!record(value) || !exact(value, [
    "run_id", "output_id", "output_schema_version", "schema_version", "status", "source_case_version_id",
    "action_plan_section_version_id", "proposal", "citations", "advisory_only",
    "workflow_mutated", "controlled_record_mutated", "approval_claimed", "workflow_transition",
    "human_acceptance_required",
  ]) || !uuid(value.run_id) || !uuid(value.output_id) ||
    value.output_schema_version !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    value.schema_version !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    value.status !== "completed_draft" || !uuid(value.source_case_version_id) ||
    !uuid(value.action_plan_section_version_id) || value.advisory_only !== true ||
    value.workflow_mutated !== false || value.controlled_record_mutated !== false ||
    value.approval_claimed !== false || value.workflow_transition !== null ||
    value.human_acceptance_required !== true || !Array.isArray(value.citations) ||
    value.citations.length !== 0) {
    return null;
  }

  let parsed: ReturnType<typeof validateCapaActionPlanReviewAdvisoryModelOutput>;
  try {
    parsed = validateCapaActionPlanReviewAdvisoryModelOutput(JSON.stringify({
      schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      source_case_version_id: value.source_case_version_id,
      action_plan_section_version_id: value.action_plan_section_version_id,
      proposal: value.proposal,
      citations: [],
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      approval_claimed: false,
      workflow_transition: null,
      human_acceptance_required: true,
    }));
  } catch {
    return null;
  }

  return Object.freeze({
    run_id: value.run_id as CapaActionPlanReviewAdvisoryResponse["run_id"],
    output_id: value.output_id as CapaActionPlanReviewAdvisoryResponse["output_id"],
    output_schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION as CapaActionPlanReviewAdvisoryResponse["output_schema_version"],
    schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
    status: "completed_draft",
    source_case_version_id: parsed.source_case_version_id,
    action_plan_section_version_id: parsed.action_plan_section_version_id,
    proposal: parsed.proposal,
    citations: Object.freeze([]) as readonly [],
    advisory_only: true,
    workflow_mutated: false,
    controlled_record_mutated: false,
    approval_claimed: false,
    workflow_transition: null,
    human_acceptance_required: true,
  });
}

export function buildCapaActionPlanReviewAdvisoryRequest(input: {
  readonly expectedCaseVersionId: string;
  readonly expectedRecordVersion: number;
}): CapaActionPlanReviewAdvisoryRequest {
  return Object.freeze({
    expected_case_version_id: input.expectedCaseVersionId,
    expected_record_version: input.expectedRecordVersion,
  });
}

export function parseCapaActionPlanReviewAdvisorySuccess(
  value: unknown,
  expected?: { readonly caseId: string; readonly caseVersionId: string; readonly actionPlanSectionVersionId: string; readonly recordVersion: number },
): CapaActionPlanReviewAdvisorySuccess | null {
  if (!record(value) || !exact(value, ["advisory", "snapshot", "correlation_id"]) ||
    !record(value.snapshot) || !exact(value.snapshot, ["capa_case_id", "case_version_id", "record_version"]) ||
    !uuid(value.snapshot.capa_case_id) || !uuid(value.snapshot.case_version_id) ||
    !positiveInteger(value.snapshot.record_version) || !uuid(value.correlation_id)) return null;

  const advisory = parseAdvisory(value.advisory);
  if (advisory === null) return null;

  if (expected !== undefined && (
    value.snapshot.capa_case_id !== expected.caseId ||
    value.snapshot.case_version_id !== expected.caseVersionId ||
    value.snapshot.record_version !== expected.recordVersion ||
    advisory.source_case_version_id !== expected.caseVersionId ||
    advisory.action_plan_section_version_id !== expected.actionPlanSectionVersionId
  )) return null;

  return Object.freeze({
    advisory,
    snapshot: Object.freeze({
      capaCaseId: value.snapshot.capa_case_id,
      caseVersionId: value.snapshot.case_version_id,
      recordVersion: value.snapshot.record_version,
    }),
    correlationId: value.correlation_id,
  });
}

export function parseCapaActionPlanReviewAdvisoryFailure(value: unknown): CapaActionPlanReviewAdvisoryFailure {
  const error = record(value) && record(value.error) ? value.error : null;
  return Object.freeze({
    code: error && typeof error.code === "string" && error.code.trim() === error.code ? error.code : null,
    message: error && typeof error.message === "string" && error.message.trim() === error.message ? error.message : SAFE_FAILURE_MESSAGE,
    correlationId: error && uuid(error.correlation_id) ? error.correlation_id : null,
  });
}

export async function fetchCapaActionPlanReviewAdvisory(
  caseId: string,
  request: CapaActionPlanReviewAdvisoryRequest,
  expectedActionPlanSectionVersionId: string,
  fetcher: typeof fetch = fetch,
  trace: { readonly requestId: string; readonly correlationId: string } = {
    requestId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
  },
): Promise<CapaActionPlanReviewAdvisorySuccess | CapaActionPlanReviewAdvisoryFailure> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/action-plan-review-advisory`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": trace.requestId,
        "x-correlation-id": trace.correlationId,
      },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseCapaActionPlanReviewAdvisoryFailure(body);
    return parseCapaActionPlanReviewAdvisorySuccess(body, {
      caseId,
      caseVersionId: request.expected_case_version_id,
      actionPlanSectionVersionId: expectedActionPlanSectionVersionId,
      recordVersion: request.expected_record_version,
    }) ?? { code: "INVALID_ADVISORY_RESPONSE", message: INVALID_RESPONSE_MESSAGE, correlationId: trace.correlationId };
  } catch {
    return { code: null, message: SAFE_FAILURE_MESSAGE, correlationId: trace.correlationId };
  }
}
