import type {
  CapaIntakeAdvisorySnapshot,
} from "./capa-intake-advisory-snapshot";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CAPA_AI_REVIEW_RATIONALE_MAXIMUM =
  4_000;

export const CAPA_AI_REVIEW_PROPOSAL_STRING_MAXIMUM =
  8_000;

export const CAPA_AI_REVIEW_PROPOSAL_LIST_MAXIMUM =
  100;

export type CapaAiOutputReviewDecision =
  | "accept"
  | "reject"
  | "revise";

export interface CapaAiOutputReviewHumanRevision {
  readonly problem_statement_draft:
    string;

  readonly scope_dimensions:
    readonly string[];

  readonly missing_dimensions:
    readonly string[];

  readonly containment_risk_questions:
    readonly string[];

  readonly investigation_questions:
    readonly string[];
}

export interface CapaAiOutputReviewDraft {
  readonly decision:
    CapaAiOutputReviewDecision | null;

  readonly rationale:
    string;

  readonly humanRevision:
    CapaAiOutputReviewHumanRevision | null;
}

export interface CapaAiOutputReviewBrowserRequest {
  readonly decision:
    CapaAiOutputReviewDecision;

  readonly rationale:
    string | null;

  readonly human_revision:
    CapaAiOutputReviewHumanRevision | null;

  readonly expected_case_version_id:
    string;

  readonly expected_record_version:
    number;
}

export type CapaAiOutputReviewDraftIssueField =
  | "decision"
  | "rationale"
  | "human_revision"
  | "snapshot";

export interface CapaAiOutputReviewDraftIssue {
  readonly field:
    CapaAiOutputReviewDraftIssueField;

  readonly message:
    string;
}

export type BuildCapaAiOutputReviewRequestResult =
  | {
      readonly valid: true;
      readonly request:
        CapaAiOutputReviewBrowserRequest;
    }
  | {
      readonly valid: false;
      readonly issue:
        CapaAiOutputReviewDraftIssue;
    };

export function createEmptyCapaAiOutputReviewDraft():
  CapaAiOutputReviewDraft {
  return Object.freeze({
    decision:
      null,

    rationale:
      "",

    humanRevision:
      null,
  });
}

function validUuid(
  value: string,
): boolean {
  return (
    value === value.trim() &&
    UUID_PATTERN.test(value)
  );
}

function validProposalString(
  value: string,
): boolean {
  return (
    value.trim() === value &&
    value.length >= 1 &&
    value.length <=
      CAPA_AI_REVIEW_PROPOSAL_STRING_MAXIMUM
  );
}

function validProposalList(
  value: readonly string[],
): boolean {
  return (
    value.length <=
      CAPA_AI_REVIEW_PROPOSAL_LIST_MAXIMUM &&
    value.every(
      validProposalString,
    )
  );
}

function validHumanRevision(
  value:
    CapaAiOutputReviewHumanRevision,
): boolean {
  return (
    validProposalString(
      value.problem_statement_draft,
    ) &&
    validProposalList(
      value.scope_dimensions,
    ) &&
    validProposalList(
      value.missing_dimensions,
    ) &&
    validProposalList(
      value.containment_risk_questions,
    ) &&
    validProposalList(
      value.investigation_questions,
    )
  );
}

function rationaleValue(
  value: string,
): string | null {
  const normalized =
    value.trim();

  return normalized.length === 0
    ? null
    : normalized;
}

function invalid(
  field:
    CapaAiOutputReviewDraftIssueField,
  message:
    string,
): BuildCapaAiOutputReviewRequestResult {
  return Object.freeze({
    valid:
      false,

    issue:
      Object.freeze({
        field,
        message,
      }),
  });
}

export function buildCapaAiOutputReviewRequest(
  draft:
    CapaAiOutputReviewDraft,
  snapshot:
    CapaIntakeAdvisorySnapshot,
): BuildCapaAiOutputReviewRequestResult {
  if (
    !validUuid(
      snapshot.caseVersionId,
    ) ||
    !Number.isSafeInteger(
      snapshot.recordVersion,
    ) ||
    snapshot.recordVersion < 1
  ) {
    return invalid(
      "snapshot",
      "The AI advisory is not bound to a valid CAPA version.",
    );
  }

  if (
    draft.decision === null
  ) {
    return invalid(
      "decision",
      "Select Accept, Reject, or Revise.",
    );
  }

  const rationale =
    rationaleValue(
      draft.rationale,
    );

  if (
    rationale !== null &&
    (
      rationale.length < 3 ||
      rationale.length >
        CAPA_AI_REVIEW_RATIONALE_MAXIMUM
    )
  ) {
    return invalid(
      "rationale",
      "Rationale must contain 3 to 4,000 characters.",
    );
  }

  if (
    draft.decision === "accept"
  ) {
    if (
      draft.humanRevision !== null
    ) {
      return invalid(
        "human_revision",
        "A human revision is not permitted when accepting the AI advisory.",
      );
    }

    return Object.freeze({
      valid:
        true,

      request:
        Object.freeze({
          decision:
            "accept",

          rationale,

          human_revision:
            null,

          expected_case_version_id:
            snapshot.caseVersionId,

          expected_record_version:
            snapshot.recordVersion,
        }),
    });
  }

  if (
    draft.decision === "reject"
  ) {
    if (
      rationale === null
    ) {
      return invalid(
        "rationale",
        "Rationale is required when rejecting the AI advisory.",
      );
    }

    if (
      draft.humanRevision !== null
    ) {
      return invalid(
        "human_revision",
        "A human revision is not permitted when rejecting the AI advisory.",
      );
    }

    return Object.freeze({
      valid:
        true,

      request:
        Object.freeze({
          decision:
            "reject",

          rationale,

          human_revision:
            null,

          expected_case_version_id:
            snapshot.caseVersionId,

          expected_record_version:
            snapshot.recordVersion,
        }),
    });
  }

  if (
    rationale === null
  ) {
    return invalid(
      "rationale",
      "Rationale is required when revising the AI advisory.",
    );
  }

  if (
    draft.humanRevision === null
  ) {
    return invalid(
      "human_revision",
      "A complete human revision is required.",
    );
  }

  if (
    !validHumanRevision(
      draft.humanRevision,
    )
  ) {
    return invalid(
      "human_revision",
      "The human revision contains invalid or incomplete content.",
    );
  }

  return Object.freeze({
    valid:
      true,

    request:
      Object.freeze({
        decision:
          "revise",

        rationale,

        human_revision:
          draft.humanRevision,

        expected_case_version_id:
          snapshot.caseVersionId,

        expected_record_version:
          snapshot.recordVersion,
      }),
  });
}

export interface CapaAiOutputReviewSuccessExpectation {
  readonly capaCaseId:
    string;

  readonly outputId:
    string;

  readonly snapshot:
    CapaIntakeAdvisorySnapshot;
}

export interface CapaAiOutputReviewSuccess {
  readonly reviewId:
    string;

  readonly decision:
    CapaAiOutputReviewDecision;

  readonly reviewedAt:
    string;

  readonly auditEventId:
    string;

  readonly replayed:
    boolean;

  readonly correlationId:
    string;
}

export type CapaAiOutputReviewFailureKind =
  | "authentication"
  | "authorization_denied"
  | "not_found"
  | "not_reviewable"
  | "stale"
  | "idempotency_conflict"
  | "invalid_request"
  | "unexpected";

export interface CapaAiOutputReviewFailure {
  readonly kind:
    CapaAiOutputReviewFailureKind;

  readonly message:
    string;

  readonly correlationId:
    string | null;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validIsoTimestamp(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      value,
    ) &&
    !Number.isNaN(
      Date.parse(value),
    )
  );
}

function validDecision(
  value: unknown,
): value is CapaAiOutputReviewDecision {
  return (
    value === "accept" ||
    value === "reject" ||
    value === "revise"
  );
}

export function parseCapaAiOutputReviewSuccess(
  value: unknown,
  expected:
    CapaAiOutputReviewSuccessExpectation,
): CapaAiOutputReviewSuccess | null {
  if (!isRecord(value)) {
    return null;
  }

  const review =
    value.ai_output_review;

  if (!isRecord(review)) {
    return null;
  }

  if (
    typeof review.review_id !== "string" ||
    !validUuid(review.review_id) ||
    review.output_id !==
      expected.outputId ||
    review.capa_case_id !==
      expected.capaCaseId ||
    review.case_version_id !==
      expected.snapshot.caseVersionId ||
    review.record_version !==
      expected.snapshot.recordVersion ||
    !validDecision(
      review.decision,
    ) ||
    !validIsoTimestamp(
      review.reviewed_at,
    ) ||
    review.workflow_mutated !== false ||
    review.controlled_record_mutated !== false ||
    review.gate_approved !== false ||
    typeof value.audit_event_id !== "string" ||
    !validUuid(
      value.audit_event_id,
    ) ||
    typeof value.replayed !== "boolean" ||
    typeof value.correlation_id !== "string" ||
    !validUuid(
      value.correlation_id,
    )
  ) {
    return null;
  }

  return Object.freeze({
    reviewId:
      review.review_id,

    decision:
      review.decision,

    reviewedAt:
      review.reviewed_at,

    auditEventId:
      value.audit_event_id,

    replayed:
      value.replayed,

    correlationId:
      value.correlation_id,
  });
}

export function parseCapaAiOutputReviewFailure(
  status: number,
  value: unknown,
): CapaAiOutputReviewFailure {
  const error =
    isRecord(value) &&
    isRecord(value.error)
      ? value.error
      : null;

  const code =
    error !== null &&
    typeof error.code === "string"
      ? error.code
      : null;

  const message =
    error !== null &&
    typeof error.message === "string"
      ? error.message
      : "The CAPA AI-output review could not be recorded.";

  const correlationId =
    error !== null &&
    typeof error.correlation_id === "string" &&
    validUuid(
      error.correlation_id,
    )
      ? error.correlation_id
      : null;

  let kind:
    CapaAiOutputReviewFailureKind;

  switch (code) {
    case "UNAUTHORIZED":
    case "INVALID_SESSION_CONTEXT":
      kind =
        "authentication";
      break;

    case "CAPA_AI_OUTPUT_REVIEW_ACCESS_DENIED":
      kind =
        "authorization_denied";
      break;

    case "CAPA_AI_OUTPUT_NOT_FOUND":
      kind =
        "not_found";
      break;

    case "CAPA_AI_OUTPUT_NOT_REVIEWABLE":
      kind =
        "not_reviewable";
      break;

    case "CAPA_AI_OUTPUT_REVIEW_STALE":
      kind =
        "stale";
      break;

    case "CAPA_AI_OUTPUT_REVIEW_IDEMPOTENCY_CONFLICT":
      kind =
        "idempotency_conflict";
      break;

    case "INVALID_CAPA_CASE_ID":
    case "INVALID_CAPA_AI_OUTPUT_ID":
    case "INVALID_CAPA_AI_OUTPUT_REVIEW":
    case "CAPA_AI_OUTPUT_REVIEW_VALIDATION_FAILED":
    case "CAPA_AI_REVIEW_IDEMPOTENCY_KEY_REQUIRED":
      kind =
        "invalid_request";
      break;

    default:
      kind =
        status >= 400 &&
        status < 500
          ? "invalid_request"
          : "unexpected";
  }

  return Object.freeze({
    kind,
    message,
    correlationId,
  });
}
