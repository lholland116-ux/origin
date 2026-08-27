import type {
  ActorReference,
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "./capa-prompt-contract";

import type {
  CapaIntakeAdvisoryProposal,
  CapaIntakeAdvisoryResponse,
} from "./capa-intake-advisory-contract";

import {
  CAPA_AI_OUTPUT_REVIEW_DECISIONS,
  CAPA_AI_OUTPUT_REVIEW_POLICY_VERSION,
  type CapaAiOutputReviewBrowserRequest,
  type CapaAiOutputReviewDecision,
  type CapaAiOutputReviewId,
  type CapaAiOutputReviewRecord,
} from "./capa-ai-output-review-contract";

/**
 * Construction boundary for an immutable human review of one stored
 * governed CAPA AI advisory output.
 *
 * Authorization, tenant resolution, stored-output reload and current-case
 * stale-state checks occur before this constructor is invoked.
 *
 * Traceability:
 * URS-AI-003, URS-AI-004
 * URS-WF-005 through URS-WF-007
 * SRS-REV-001 through SRS-REV-006
 * HRUI-D-001 through HRUI-D-008
 * HF-01, HF-02
 */

export const CAPA_AI_OUTPUT_REVIEW_VALIDATION_REASON_CODES = [
  "INVALID_REVIEW_INPUT",
  "INVALID_REVIEW_ID",
  "INVALID_ORGANIZATION",
  "INVALID_OUTPUT_ID",
  "INVALID_CASE_ID",
  "INVALID_CASE_VERSION_ID",
  "INVALID_RECORD_VERSION",
  "INVALID_DECISION",
  "RATIONALE_REQUIRED",
  "RATIONALE_NOT_PERMITTED",
  "HUMAN_REVISION_REQUIRED",
  "HUMAN_REVISION_NOT_PERMITTED",
  "INVALID_HUMAN_REVISION",
  "HUMAN_REVIEW_REQUIRED",
  "INVALID_REVIEW_TIMESTAMP",
  "INVALID_REVIEW_POLICY_VERSION",
  "INVALID_REQUEST_ID",
  "INVALID_CORRELATION_ID",
  "INVALID_IDEMPOTENCY_KEY",
] as const;

export type CapaAiOutputReviewValidationReasonCode =
  (typeof CAPA_AI_OUTPUT_REVIEW_VALIDATION_REASON_CODES)[number];

export class CapaAiOutputReviewValidationError
  extends Error {
  readonly reason_code:
    CapaAiOutputReviewValidationReasonCode;

  constructor(
    reasonCode:
      CapaAiOutputReviewValidationReasonCode,
  ) {
    super(
      "The governed CAPA AI-output human review is invalid.",
    );

    this.name =
      "CapaAiOutputReviewValidationError";

    this.reason_code =
      reasonCode;
  }
}

export interface ConstructCapaAiOutputReviewInput {
  readonly review_id:
    CapaAiOutputReviewId;

  readonly organization_id:
    OrganizationId;

  readonly output_id:
    CapaIntakeAdvisoryResponse["output_id"];

  readonly capa_case_id:
    CapaCaseId;

  readonly case_version_id:
    CapaCaseVersionId;

  readonly record_version:
    number;

  readonly decision:
    CapaAiOutputReviewDecision;

  readonly rationale:
    string | null;

  readonly human_revision:
    CapaIntakeAdvisoryProposal | null;

  readonly reviewed_at:
    IsoDateTime;

  readonly reviewed_by:
    ActorReference;

  readonly request_id:
    RequestId;

  readonly correlation_id:
    CorrelationId;

  readonly idempotency_key:
    IdempotencyKey;

  readonly review_policy_version?:
    ControlledVersion;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const DECISIONS =
  new Set<string>(
    CAPA_AI_OUTPUT_REVIEW_DECISIONS,
  );

const MAXIMUM_RATIONALE_CHARACTERS =
  4_000;

const MAXIMUM_PROPOSAL_STRING_CHARACTERS =
  8_000;

const MAXIMUM_PROPOSAL_LIST_ITEMS =
  100;

const MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS =
  128;

function fail(
  reasonCode:
    CapaAiOutputReviewValidationReasonCode,
): never {
  throw new CapaAiOutputReviewValidationError(
    reasonCode,
  );
}

function validUuid(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value)
  );
}

function validIsoTimestamp(
  value: unknown,
): value is IsoDateTime {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validControlledVersion(
  value: unknown,
): value is ControlledVersion {
  return (
    typeof value === "string" &&
    VERSION_PATTERN.test(value)
  );
}

function validRationale(
  value: string,
): boolean {
  return (
    value.trim() === value &&
    value.length >= 3 &&
    value.length <=
      MAXIMUM_RATIONALE_CHARACTERS
  );
}

function validProposalString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length >= 1 &&
    value.length <=
      MAXIMUM_PROPOSAL_STRING_CHARACTERS
  );
}

function validProposalStringList(
  value: unknown,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <=
      MAXIMUM_PROPOSAL_LIST_ITEMS &&
    value.every(validProposalString)
  );
}

function validHumanRevision(
  value: unknown,
): value is CapaIntakeAdvisoryProposal {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const proposal =
    value as Readonly<
      Record<string, unknown>
    >;

  const expectedKeys = [
    "problem_statement_draft",
    "scope_dimensions",
    "missing_dimensions",
    "containment_risk_questions",
    "investigation_questions",
  ] as const;

  if (
    Object.keys(proposal).length !==
      expectedKeys.length ||
    !expectedKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(
          proposal,
          key,
        ),
    )
  ) {
    return false;
  }

  return (
    validProposalString(
      proposal.problem_statement_draft,
    ) &&
    validProposalStringList(
      proposal.scope_dimensions,
    ) &&
    validProposalStringList(
      proposal.missing_dimensions,
    ) &&
    validProposalStringList(
      proposal.containment_risk_questions,
    ) &&
    validProposalStringList(
      proposal.investigation_questions,
    )
  );
}

/**
 * Validates the narrow, untrusted browser-owned portion of a CAPA
 * AI-output human-review request.
 *
 * Authentication, tenant identity, reviewer identity, review timestamp,
 * request trace, policy version and server-generated identifiers must not
 * originate from this object.
 */
export function validateCapaAiOutputReviewBrowserRequest(
  value: unknown,
): CapaAiOutputReviewBrowserRequest {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail("INVALID_REVIEW_INPUT");
  }

  const body =
    value as Readonly<
      Record<string, unknown>
    >;

  const allowedKeys =
    new Set<string>([
      "decision",
      "rationale",
      "human_revision",
      "expected_case_version_id",
      "expected_record_version",
    ]);

  const requiredKeys = [
    "decision",
    "expected_case_version_id",
    "expected_record_version",
  ] as const;

  const keys =
    Object.keys(body);

  if (
    keys.some(
      (key) =>
        !allowedKeys.has(key),
    ) ||
    !requiredKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(
          body,
          key,
        ),
    )
  ) {
    fail("INVALID_REVIEW_INPUT");
  }

  if (
    typeof body.decision !== "string" ||
    !DECISIONS.has(body.decision)
  ) {
    fail("INVALID_DECISION");
  }

  if (
    !validUuid(
      body.expected_case_version_id,
    )
  ) {
    fail("INVALID_CASE_VERSION_ID");
  }

  if (
    !Number.isSafeInteger(
      body.expected_record_version,
    ) ||
    (
      body.expected_record_version as
        number
    ) < 1
  ) {
    fail("INVALID_RECORD_VERSION");
  }

  const rationaleValue =
    Object.prototype.hasOwnProperty.call(
      body,
      "rationale",
    )
      ? body.rationale
      : null;

  if (
    rationaleValue !== null &&
    (
      typeof rationaleValue !==
        "string" ||
      !validRationale(
        rationaleValue,
      )
    )
  ) {
    fail("RATIONALE_REQUIRED");
  }

  const humanRevisionValue =
    Object.prototype.hasOwnProperty.call(
      body,
      "human_revision",
    )
      ? body.human_revision
      : null;

  if (
    (
      body.decision === "accept" ||
      body.decision === "reject"
    ) &&
    humanRevisionValue !== null
  ) {
    fail(
      "HUMAN_REVISION_NOT_PERMITTED",
    );
  }

  if (
    body.decision === "reject" &&
    rationaleValue === null
  ) {
    fail("RATIONALE_REQUIRED");
  }

  if (
    body.decision === "revise" &&
    rationaleValue === null
  ) {
    fail("RATIONALE_REQUIRED");
  }

  if (
    body.decision === "revise" &&
    humanRevisionValue === null
  ) {
    fail("HUMAN_REVISION_REQUIRED");
  }

  if (
    humanRevisionValue !== null &&
    !validHumanRevision(
      humanRevisionValue,
    )
  ) {
    fail("INVALID_HUMAN_REVISION");
  }

  return Object.freeze({
    decision:
      body.decision as
        CapaAiOutputReviewDecision,

    rationale:
      rationaleValue,

    human_revision:
      humanRevisionValue,

    expected_case_version_id:
      body.expected_case_version_id as
        CapaCaseVersionId,

    expected_record_version:
      body.expected_record_version as
        number,
  });
}

export function constructCapaAiOutputReview(
  input:
    ConstructCapaAiOutputReviewInput,
): CapaAiOutputReviewRecord {
  if (
    input === null ||
    typeof input !== "object"
  ) {
    fail("INVALID_REVIEW_INPUT");
  }

  if (!validUuid(input.review_id)) {
    fail("INVALID_REVIEW_ID");
  }

  if (!validUuid(input.organization_id)) {
    fail("INVALID_ORGANIZATION");
  }

  if (!validUuid(input.output_id)) {
    fail("INVALID_OUTPUT_ID");
  }

  if (!validUuid(input.capa_case_id)) {
    fail("INVALID_CASE_ID");
  }

  if (!validUuid(input.case_version_id)) {
    fail("INVALID_CASE_VERSION_ID");
  }

  if (
    !Number.isSafeInteger(
      input.record_version,
    ) ||
    input.record_version < 1
  ) {
    fail("INVALID_RECORD_VERSION");
  }

  if (
    typeof input.decision !== "string" ||
    !DECISIONS.has(input.decision)
  ) {
    fail("INVALID_DECISION");
  }

  if (
    input.rationale !== null &&
    !validRationale(input.rationale)
  ) {
    fail("RATIONALE_REQUIRED");
  }

  if (
    input.decision === "accept" &&
    input.human_revision !== null
  ) {
    fail("HUMAN_REVISION_NOT_PERMITTED");
  }

  if (
    input.decision === "reject" &&
    input.human_revision !== null
  ) {
    fail("HUMAN_REVISION_NOT_PERMITTED");
  }

  if (
    input.decision === "reject" &&
    input.rationale === null
  ) {
    fail("RATIONALE_REQUIRED");
  }

  if (
    input.decision === "revise" &&
    input.rationale === null
  ) {
    fail("RATIONALE_REQUIRED");
  }

  if (
    input.decision === "revise" &&
    input.human_revision === null
  ) {
    fail("HUMAN_REVISION_REQUIRED");
  }

  if (
    input.human_revision !== null &&
    !validHumanRevision(
      input.human_revision,
    )
  ) {
    fail("INVALID_HUMAN_REVISION");
  }

  if (
    input.reviewed_by === null ||
    typeof input.reviewed_by !==
      "object" ||
    input.reviewed_by.actor_type !==
      "human" ||
    typeof input.reviewed_by.actor_id !==
      "string" ||
    input.reviewed_by.actor_id.trim() !==
      input.reviewed_by.actor_id ||
    input.reviewed_by.actor_id.length < 1 ||
    input.reviewed_by.actor_id.length > 256
  ) {
    fail("HUMAN_REVIEW_REQUIRED");
  }

  if (
    !validIsoTimestamp(
      input.reviewed_at,
    )
  ) {
    fail("INVALID_REVIEW_TIMESTAMP");
  }

  const policyVersion =
    input.review_policy_version ??
      CAPA_AI_OUTPUT_REVIEW_POLICY_VERSION;

  if (
    !validControlledVersion(
      policyVersion,
    )
  ) {
    fail(
      "INVALID_REVIEW_POLICY_VERSION",
    );
  }

  if (!validUuid(input.request_id)) {
    fail("INVALID_REQUEST_ID");
  }

  if (!validUuid(input.correlation_id)) {
    fail("INVALID_CORRELATION_ID");
  }

  if (
    typeof input.idempotency_key !==
      "string" ||
    input.idempotency_key.trim() !==
      input.idempotency_key ||
    input.idempotency_key.length < 1 ||
    input.idempotency_key.length >
      MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS
  ) {
    fail("INVALID_IDEMPOTENCY_KEY");
  }

  const reviewer =
    Object.freeze({
      ...input.reviewed_by,
      actor_type:
        "human" as const,
    });

  const humanRevision =
    input.human_revision === null
      ? null
      : Object.freeze({
          problem_statement_draft:
            input.human_revision
              .problem_statement_draft,

          scope_dimensions:
            Object.freeze([
              ...input.human_revision
                .scope_dimensions,
            ]),

          missing_dimensions:
            Object.freeze([
              ...input.human_revision
                .missing_dimensions,
            ]),

          containment_risk_questions:
            Object.freeze([
              ...input.human_revision
                .containment_risk_questions,
            ]),

          investigation_questions:
            Object.freeze([
              ...input.human_revision
                .investigation_questions,
            ]),
        });

  return Object.freeze({
    review_id:
      input.review_id,

    organization_id:
      input.organization_id,

    output_id:
      input.output_id,

    capa_case_id:
      input.capa_case_id,

    case_version_id:
      input.case_version_id,

    record_version:
      input.record_version,

    decision:
      input.decision,

    rationale:
      input.rationale,

    human_revision:
      humanRevision,

    reviewed_at:
      input.reviewed_at,

    reviewed_by:
      reviewer,

    review_policy_version:
      policyVersion,

    request_id:
      input.request_id,

    correlation_id:
      input.correlation_id,

    idempotency_key:
      input.idempotency_key,

    workflow_mutated:
      false,

    controlled_record_mutated:
      false,

    gate_approved:
      false,
  } satisfies CapaAiOutputReviewRecord);
}
