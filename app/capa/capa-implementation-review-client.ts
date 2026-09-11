import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
  type CapaImplementationReviewDecision,
} from "../../lib/capa/domain/capa-implementation-review-decision";
import type { CapaImplementationReviewProjection } from "../../lib/capa/implementation/capa-implementation-review-projection";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CapaImplementationReviewAttempt {
  readonly caseId: string;
  readonly expectedRecordVersion: number;
  readonly expectedCurrentVersionId: string;
  readonly sourceCaseVersionId: string;
  readonly implementationReviewBaselineSectionVersionId: string;
  readonly decision: CapaImplementationReviewDecision;
  readonly rationale: string;
  readonly idempotencyKey: string;
  readonly requestBody: string;
}

export type CapaImplementationReviewLoadResult =
  | { readonly status: "loaded"; readonly projection: CapaImplementationReviewProjection; readonly correlationId: string }
  | CapaImplementationReviewFailure;

export type CapaImplementationReviewResult =
  | {
      readonly status: "decided";
      readonly decision: CapaImplementationReviewDecision;
      readonly replayed: boolean;
      readonly resultingCaseVersionId: string;
      readonly correlationId: string;
    }
  | CapaImplementationReviewFailure;

export interface CapaImplementationReviewFailure {
  readonly status: "failed";
  readonly code: string | null;
  readonly message: string;
  readonly reasons: readonly string[];
  readonly correlationId: string | null;
  readonly retryableExact: boolean;
  readonly requiresRefresh: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseFailure(response: Response | null, body: unknown, fallback: string): CapaImplementationReviewFailure {
  const error = record(body) && record(body.error) ? body.error : null;
  const code = error && typeof error.code === "string" ? error.code : null;
  const reasons = error && Array.isArray(error.issues)
    ? error.issues.flatMap((issue) => record(issue) && typeof issue.message === "string" ? [issue.message] : [])
    : [];
  const requiresRefresh = code === "CAPA_CONCURRENCY_CONFLICT" ||
    code === "CAPA_WORKFLOW_CONFLICT" ||
    code === "CAPA_IMPLEMENTATION_REVIEW_CASE_STATE_CONFLICT" ||
    code === "CAPA_IMPLEMENTATION_REVIEW_INVALID_AUTHORITATIVE_CONTEXT";
  return {
    status: "failed",
    code,
    message: error && typeof error.message === "string" ? error.message : fallback,
    reasons: Object.freeze(reasons),
    correlationId: error && uuid(error.correlation_id)
      ? error.correlation_id
      : record(body) && uuid(body.correlation_id) ? body.correlation_id : null,
    retryableExact: response === null || response.status >= 500,
    requiresRefresh,
  };
}

/**
 * Fail closed at the browser boundary. The server projection remains the
 * source of truth; this only verifies the fields the reviewer UI consumes.
 */
export function parseCapaImplementationReviewProjection(value: unknown): CapaImplementationReviewProjection | null {
  if (!record(value) || value.trust !== "authoritative_server_projection" ||
    !uuid(value.organization_id) || !uuid(value.capa_case_id) ||
    !positiveInteger(value.record_version) || !uuid(value.current_case_version_id) ||
    value.workflow_state !== "S90" || !record(value.case_version) ||
    !positiveInteger(value.case_version.version_number) ||
    !uuid(value.case_version.parent_version_id) ||
    typeof value.case_version.change_reason !== "string" ||
    !uuid(value.implementation_review_baseline_section_version_id) ||
    !record(value.approved_s70_baseline) || !record(value.submitted_implementation) ||
    !record(value.reviewer) || !Array.isArray(value.prior_review_history)) {
    return null;
  }

  const authority = value.approved_s70_baseline;
  const submitted = value.submitted_implementation;
  const reviewer = value.reviewer;
  const authorization = reviewer.authorization;
  if (!record(authority) || !record(authority.reference) ||
    !uuid(authority.source_case_version_id) || !record(authority.source_case_version) ||
    authority.source_case_version.status !== "S70" ||
    !positiveInteger(authority.source_case_version.version_number) ||
    (authority.source_case_version.parent_version_id !== null && !uuid(authority.source_case_version.parent_version_id)) ||
    typeof authority.source_case_version.change_reason !== "string" ||
    !record(authority.action_plan_section) || !record(authority.action_plan) ||
    !record(authority.approval_decision) || authority.approval_decision.decision !== "approve" ||
    typeof authority.approval_decision.rationale !== "string" ||
    !uuid(authority.approval_decision.reviewer_user_id) ||
    !isoDate(authority.approval_decision.decided_at) ||
    !uuid(authority.approval_decision.resulting_case_version_id) ||
    !uuid(authority.approval_decision.transition_audit_event_id) ||
    !uuid(submitted.source_s80_case_version_id) ||
    !positiveInteger(submitted.source_s80_workspace_revision) ||
    !uuid(submitted.resulting_s90_case_version_id) ||
    !uuid(submitted.submitted_by_user_id) || !isoDate(submitted.submitted_at) ||
    !Array.isArray(submitted.action_progress) || !uuid(reviewer.user_id) ||
    !record(authorization) || !record(authorization.read) || !record(authorization.decision) ||
    authorization.read.status !== "allowed" ||
    !["allowed", "step_up_required", "denied"].includes(String(authorization.decision.status))) {
    return null;
  }

  return value as unknown as CapaImplementationReviewProjection;
}

export function createCapaImplementationReviewAttempt(input: {
  readonly caseId: string;
  readonly recordVersion: number;
  readonly currentCaseVersionId: string;
  readonly sourceCaseVersionId: string;
  readonly implementationReviewBaselineSectionVersionId: string;
  readonly decision: CapaImplementationReviewDecision;
  readonly rationale: string;
  readonly idempotencyKey: string;
}): CapaImplementationReviewAttempt | null {
  if (!uuid(input.caseId) || !positiveInteger(input.recordVersion) ||
    !uuid(input.currentCaseVersionId) || !uuid(input.sourceCaseVersionId) ||
    !uuid(input.implementationReviewBaselineSectionVersionId) ||
    (input.decision !== "accept" && input.decision !== "return") ||
    input.rationale.length === 0 || input.rationale.trim() !== input.rationale ||
    input.idempotencyKey.length === 0 || input.idempotencyKey.length > 128 ||
    input.idempotencyKey.trim() !== input.idempotencyKey) {
    return null;
  }

  const requestBody = JSON.stringify({
    expected_record_version: input.recordVersion,
    expected_current_version_id: input.currentCaseVersionId,
    source_case_version_id: input.sourceCaseVersionId,
    implementation_review_baseline_section_version_id: input.implementationReviewBaselineSectionVersionId,
    schema_version: CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
    decision: input.decision,
    rationale: input.rationale,
  });

  return Object.freeze({
    caseId: input.caseId,
    expectedRecordVersion: input.recordVersion,
    expectedCurrentVersionId: input.currentCaseVersionId,
    sourceCaseVersionId: input.sourceCaseVersionId,
    implementationReviewBaselineSectionVersionId: input.implementationReviewBaselineSectionVersionId,
    decision: input.decision,
    rationale: input.rationale,
    idempotencyKey: input.idempotencyKey,
    requestBody,
  });
}

export async function loadCapaImplementationReview(
  caseId: string,
  fetcher: typeof fetch = fetch,
): Promise<CapaImplementationReviewLoadResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/implementation-review`, {
      method: "GET",
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    const projection = record(body) ? parseCapaImplementationReviewProjection(body.projection) : null;
    if (response.ok && projection !== null && record(body) && uuid(body.correlation_id)) {
      return { status: "loaded", projection, correlationId: body.correlation_id };
    }
    return parseFailure(response, body, "The S90 implementation-review package could not be loaded.");
  } catch {
    return parseFailure(null, null, "The S90 implementation-review package could not be loaded.");
  }
}

export async function submitCapaImplementationReviewAttempt(
  attempt: CapaImplementationReviewAttempt,
  fetcher: typeof fetch = fetch,
): Promise<CapaImplementationReviewResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(attempt.caseId)}/implementation-review`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "idempotency-key": attempt.idempotencyKey,
      },
      body: attempt.requestBody,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && record(body) && body.status === "decided" &&
      body.decision === attempt.decision && record(body.capa) &&
      uuid(body.capa.resulting_case_version_id) && typeof body.replayed === "boolean" &&
      uuid(body.correlation_id)) {
      return {
        status: "decided",
        decision: attempt.decision,
        replayed: body.replayed,
        resultingCaseVersionId: body.capa.resulting_case_version_id,
        correlationId: body.correlation_id,
      };
    }
    return parseFailure(response, body, "The S90 implementation-review decision could not be completed.");
  } catch {
    return parseFailure(null, null, "The S90 implementation-review response was not received.");
  }
}
