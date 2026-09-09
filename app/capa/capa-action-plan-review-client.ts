import {
  CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
  type CapaActionPlanReviewDecision,
} from "../../lib/capa/domain/capa-action-plan-review-decision";

export interface CapaActionPlanReviewAttempt {
  readonly caseId: string;
  readonly expectedCurrentVersionId: string;
  readonly expectedRecordVersion: number;
  readonly sourceCaseVersionId: string;
  readonly actionPlanSectionVersionId: string;
  readonly decision: CapaActionPlanReviewDecision;
  readonly rationale: string;
  readonly idempotencyKey: string;
  readonly requestBody: string;
}

export type CapaActionPlanReviewResult =
  | {
      readonly status: "decided";
      readonly decision: CapaActionPlanReviewDecision;
      readonly workflowState: "S80" | "S60";
      readonly currentCaseVersionId: string;
      readonly recordVersion: number;
      readonly sourceCaseVersionId: string;
      readonly actionPlanSectionVersionId: string;
      readonly resultingCaseVersionId: string;
      readonly replayed: boolean;
      readonly correlationId: string;
    }
  | {
      readonly status: "failed";
      readonly code: string | null;
      readonly message: string;
      readonly reasons: readonly string[];
      readonly correlationId: string | null;
      readonly retryableExact: boolean;
      readonly requiresRefresh: boolean;
    };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function createCapaActionPlanReviewAttempt(input: {
  readonly caseId: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly sourceCaseVersionId: string;
  readonly actionPlanSectionVersionId: string;
  readonly decision: CapaActionPlanReviewDecision;
  readonly rationale: string;
  readonly idempotencyKey: string;
}): CapaActionPlanReviewAttempt | null {
  if (
    !validUuid(input.caseId) ||
    !Number.isSafeInteger(input.recordVersion) ||
    input.recordVersion < 1 ||
    !validUuid(input.currentVersionId) ||
    !validUuid(input.sourceCaseVersionId) ||
    input.sourceCaseVersionId !== input.currentVersionId ||
    !validUuid(input.actionPlanSectionVersionId) ||
    (input.decision !== "approve" && input.decision !== "return") ||
    typeof input.rationale !== "string" ||
    input.rationale.length === 0 ||
    input.rationale.trim() !== input.rationale ||
    !input.idempotencyKey ||
    input.idempotencyKey.length > 128 ||
    input.idempotencyKey.trim() !== input.idempotencyKey
  ) {
    return null;
  }

  const requestBody = JSON.stringify({
    expected_record_version: input.recordVersion,
    expected_current_version_id: input.currentVersionId,
    schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
    source_case_version_id: input.sourceCaseVersionId,
    action_plan_section_version_id: input.actionPlanSectionVersionId,
    decision: input.decision,
    rationale: input.rationale,
  });

  return Object.freeze({
    caseId: input.caseId,
    expectedCurrentVersionId: input.currentVersionId,
    expectedRecordVersion: input.recordVersion,
    sourceCaseVersionId: input.sourceCaseVersionId,
    actionPlanSectionVersionId: input.actionPlanSectionVersionId,
    decision: input.decision,
    rationale: input.rationale,
    idempotencyKey: input.idempotencyKey,
    requestBody,
  });
}

function failure(
  response: Response | null,
  body: unknown,
  fallback: string,
): CapaActionPlanReviewResult {
  const envelope = record(body) && record(body.error) ? body.error : null;
  const code = envelope && typeof envelope.code === "string" ? envelope.code : null;
  const reasons = envelope && Array.isArray(envelope.issues)
    ? envelope.issues.flatMap((issue) =>
        record(issue) && typeof issue.message === "string" ? [issue.message] : [],
      )
    : [];
  const correlationId = envelope && validUuid(envelope.correlation_id)
    ? envelope.correlation_id
    : null;
  return {
    status: "failed",
    code,
    message: envelope && typeof envelope.message === "string" ? envelope.message : fallback,
    reasons: Object.freeze(reasons),
    correlationId,
    retryableExact: response === null || response.status >= 500,
    requiresRefresh:
      code === "CAPA_CONCURRENCY_CONFLICT" || code === "CAPA_WORKFLOW_CONFLICT",
  };
}

export async function submitCapaActionPlanReviewAttempt(
  attempt: CapaActionPlanReviewAttempt,
  fetcher: typeof fetch = fetch,
): Promise<CapaActionPlanReviewResult> {
  try {
    const response = await fetcher(
      `/api/capa/${encodeURIComponent(attempt.caseId)}/action-plan-review`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "idempotency-key": attempt.idempotencyKey,
        },
        body: attempt.requestBody,
      },
    );
    const body: unknown = await response.json().catch(() => null);
    const capa = record(body) && record(body.capa) ? body.capa : null;
    const reviewDecision = record(body) && record(body.review_decision)
      ? body.review_decision
      : null;
    const targetState = attempt.decision === "approve" ? "S80" : "S60";

    if (
      response.ok &&
      record(body) &&
      body.status === "decided" &&
      body.decision === attempt.decision &&
      capa !== null &&
      capa.capa_case_id === attempt.caseId &&
      typeof capa.case_number === "string" &&
      capa.case_number.length > 0 &&
      capa.status === targetState &&
      capa.workflow_state === targetState &&
      Number.isSafeInteger(capa.record_version) &&
      capa.record_version === attempt.expectedRecordVersion + 1 &&
      validUuid(capa.current_version_id) &&
      capa.current_version_id === capa.resulting_case_version_id &&
      validUuid(capa.source_case_version_id) &&
      capa.source_case_version_id === attempt.sourceCaseVersionId &&
      validUuid(capa.action_plan_section_version_id) &&
      capa.action_plan_section_version_id === attempt.actionPlanSectionVersionId &&
      validUuid(capa.resulting_case_version_id) &&
      capa.resulting_case_version_id !== attempt.sourceCaseVersionId &&
      reviewDecision !== null &&
      reviewDecision.schema_version === CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION &&
      reviewDecision.decision === attempt.decision &&
      reviewDecision.rationale === attempt.rationale &&
      validUuid(reviewDecision.reviewer_user_id) &&
      validIsoDate(reviewDecision.decided_at) &&
      validUuid(body.transition_audit_event_id) &&
      typeof body.replayed === "boolean" &&
      validUuid(body.correlation_id)
    ) {
      return {
        status: "decided",
        decision: attempt.decision,
        workflowState: targetState,
        currentCaseVersionId: capa.current_version_id,
        recordVersion: capa.record_version,
        sourceCaseVersionId: capa.source_case_version_id,
        actionPlanSectionVersionId: capa.action_plan_section_version_id,
        resultingCaseVersionId: capa.resulting_case_version_id,
        replayed: body.replayed,
        correlationId: body.correlation_id,
      };
    }

    return failure(response, body, "The action-plan review decision could not be completed.");
  } catch {
    return failure(null, null, "The action-plan review response was not received.");
  }
}
