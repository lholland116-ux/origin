import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaRootCauseReviewAdvisoryResponse,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-contract";
import { validateCapaRootCauseReviewAdvisoryModelOutput } from "../../lib/capa/ai/capa-root-cause-review-advisory-validator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && value.trim() === value && UUID.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const safeWarnings = (value: unknown): readonly string[] | null => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0 && item.trim() === item) ? Object.freeze([...value]) : null;

export interface CapaRootCauseReviewAdvisoryRequest {
  readonly expected_case_version_id: string;
  readonly expected_record_version: number;
}

export interface CapaRootCauseReviewAdvisorySuccess {
  readonly advisory: CapaRootCauseReviewAdvisoryResponse;
  readonly snapshot: {
    readonly capaCaseId: string;
    readonly caseVersionId: string;
    readonly recordVersion: number;
  };
  readonly correlationId: string;
}

export interface CapaRootCauseReviewAdvisoryFailure {
  readonly code: string | null;
  readonly message: string;
  readonly correlationId: string | null;
}

const SAFE_FAILURE_MESSAGE = "The governed S50 advisory could not be completed.";
const INVALID_RESPONSE_MESSAGE = "The advisory response could not be verified.";

function parseAdvisory(value: unknown): CapaRootCauseReviewAdvisoryResponse | null {
  if (!record(value) || !exact(value, [
    "run_id", "output_id", "output_schema_version", "status", "proposal",
    "uncertainty_and_limitations", "citations", "warnings", "advisory_only",
    "workflow_mutated", "controlled_record_mutated", "review_disposition",
    "workflow_transition", "human_acceptance_required",
  ]) || !uuid(value.run_id) || !uuid(value.output_id) ||
    value.output_schema_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    value.status !== "completed_draft" || value.advisory_only !== true ||
    value.workflow_mutated !== false || value.controlled_record_mutated !== false ||
    value.review_disposition !== null || value.workflow_transition !== null ||
    value.human_acceptance_required !== true || !Array.isArray(value.citations) ||
    value.citations.length !== 0 || !Array.isArray(value.uncertainty_and_limitations)) {
    return null;
  }

  const warningList = safeWarnings(value.warnings);
  if (warningList === null) return null;

  let parsed: ReturnType<typeof validateCapaRootCauseReviewAdvisoryModelOutput>;
  try {
    parsed = validateCapaRootCauseReviewAdvisoryModelOutput(JSON.stringify({
      schema_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      proposal: value.proposal,
      uncertainty_and_limitations: value.uncertainty_and_limitations,
      citations: [],
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      review_disposition: null,
      workflow_transition: null,
      human_acceptance_required: true,
    }));
  } catch {
    return null;
  }

  return Object.freeze({
    run_id: value.run_id as CapaRootCauseReviewAdvisoryResponse["run_id"],
    output_id: value.output_id as CapaRootCauseReviewAdvisoryResponse["output_id"],
    output_schema_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION as CapaRootCauseReviewAdvisoryResponse["output_schema_version"],
    status: "completed_draft",
    proposal: parsed.proposal,
    uncertainty_and_limitations: parsed.uncertainty_and_limitations,
    citations: Object.freeze([]),
    warnings: warningList,
    advisory_only: true,
    workflow_mutated: false,
    controlled_record_mutated: false,
    review_disposition: null,
    workflow_transition: null,
    human_acceptance_required: true,
  });
}

export function buildCapaRootCauseReviewAdvisoryRequest(input: {
  readonly expectedCaseVersionId: string;
  readonly expectedRecordVersion: number;
}): CapaRootCauseReviewAdvisoryRequest {
  return Object.freeze({
    expected_case_version_id: input.expectedCaseVersionId,
    expected_record_version: input.expectedRecordVersion,
  });
}

export function parseCapaRootCauseReviewAdvisorySuccess(
  value: unknown,
  expected?: { readonly caseId: string; readonly caseVersionId: string; readonly recordVersion: number },
): CapaRootCauseReviewAdvisorySuccess | null {
  if (!record(value) || !exact(value, ["advisory", "snapshot", "correlation_id"]) ||
    !record(value.snapshot) || !exact(value.snapshot, ["capa_case_id", "case_version_id", "record_version"]) ||
    !uuid(value.snapshot.capa_case_id) || !uuid(value.snapshot.case_version_id) ||
    !positiveInteger(value.snapshot.record_version) || !uuid(value.correlation_id)) return null;

  if (expected !== undefined && (
    value.snapshot.capa_case_id !== expected.caseId ||
    value.snapshot.case_version_id !== expected.caseVersionId ||
    value.snapshot.record_version !== expected.recordVersion
  )) return null;

  const advisory = parseAdvisory(value.advisory);
  if (advisory === null) return null;

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

export function parseCapaRootCauseReviewAdvisoryFailure(value: unknown): CapaRootCauseReviewAdvisoryFailure {
  const error = record(value) && record(value.error) ? value.error : null;
  return Object.freeze({
    code: error && typeof error.code === "string" && error.code.trim() === error.code ? error.code : null,
    message: error && typeof error.message === "string" && error.message.trim() === error.message ? error.message : SAFE_FAILURE_MESSAGE,
    correlationId: error && uuid(error.correlation_id) ? error.correlation_id : null,
  });
}

export async function fetchCapaRootCauseReviewAdvisory(
  caseId: string,
  request: CapaRootCauseReviewAdvisoryRequest,
  fetcher: typeof fetch = fetch,
  trace: { readonly requestId: string; readonly correlationId: string } = {
    requestId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
  },
): Promise<CapaRootCauseReviewAdvisorySuccess | CapaRootCauseReviewAdvisoryFailure> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/root-cause-review-advisory`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-request-id": trace.requestId,
        "x-correlation-id": trace.correlationId,
      },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseCapaRootCauseReviewAdvisoryFailure(body);
    return parseCapaRootCauseReviewAdvisorySuccess(body, {
      caseId,
      caseVersionId: request.expected_case_version_id,
      recordVersion: request.expected_record_version,
    }) ?? { code: "INVALID_ADVISORY_RESPONSE", message: INVALID_RESPONSE_MESSAGE, correlationId: trace.correlationId };
  } catch {
    return { code: null, message: SAFE_FAILURE_MESSAGE, correlationId: trace.correlationId };
  }
}
