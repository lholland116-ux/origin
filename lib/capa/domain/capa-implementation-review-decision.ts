import type {
  CapaCaseVersionId,
  CapaSectionVersionId,
} from "./capa-types";

export const CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION =
  "capa-implementation-review-decision-1.0.0" as const;

export const CAPA_IMPLEMENTATION_REVIEW_DECISIONS = [
  "accept",
  "return",
] as const;

export type CapaImplementationReviewDecision =
  (typeof CAPA_IMPLEMENTATION_REVIEW_DECISIONS)[number];

export interface CapaImplementationReviewDecisionContent {
  readonly schema_version:
    typeof CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION;
  readonly source_case_version_id:
    CapaCaseVersionId;
  readonly implementation_review_baseline_section_version_id:
    CapaSectionVersionId;
  readonly decision:
    CapaImplementationReviewDecision;
  readonly rationale:
    string;
}

export const CAPA_IMPLEMENTATION_REVIEW_DECISION_VALIDATION_REASON_CODES = [
  "INVALID_IMPLEMENTATION_REVIEW_DECISION_OBJECT",
  "INVALID_IMPLEMENTATION_REVIEW_DECISION_FIELDS",
  "INVALID_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION",
  "INVALID_IMPLEMENTATION_REVIEW_DECISION_SOURCE_CASE_VERSION_ID",
  "INVALID_IMPLEMENTATION_REVIEW_DECISION_BASELINE_SECTION_VERSION_ID",
  "INVALID_IMPLEMENTATION_REVIEW_DECISION",
  "INVALID_IMPLEMENTATION_REVIEW_DECISION_RATIONALE",
] as const;

export type CapaImplementationReviewDecisionValidationReasonCode =
  (typeof CAPA_IMPLEMENTATION_REVIEW_DECISION_VALIDATION_REASON_CODES)[number];

export type CapaImplementationReviewDecisionValidationResult =
  | {
      readonly status: "valid";
      readonly value:
        CapaImplementationReviewDecisionContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        CapaImplementationReviewDecisionValidationReasonCode;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
): boolean {
  const fields = [
    "schema_version",
    "source_case_version_id",
    "implementation_review_baseline_section_version_id",
    "decision",
    "rationale",
  ];
  return Object.keys(value).length === fields.length &&
    fields.every((field) =>
      Object.prototype.hasOwnProperty.call(value, field),
    );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function rationale(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value;
}

function invalid(
  reason_code:
    CapaImplementationReviewDecisionValidationReasonCode,
): CapaImplementationReviewDecisionValidationResult {
  return Object.freeze({ status: "invalid", reason_code });
}

export function validateCapaImplementationReviewDecision(
  value: unknown,
): CapaImplementationReviewDecisionValidationResult {
  if (!record(value)) {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_OBJECT",
    );
  }
  if (!exactFields(value)) {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_FIELDS",
    );
  }
  if (
    value.schema_version !==
    CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION
  ) {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION",
    );
  }
  if (!uuid(value.source_case_version_id)) {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_SOURCE_CASE_VERSION_ID",
    );
  }
  if (
    !uuid(
      value.implementation_review_baseline_section_version_id,
    )
  ) {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_BASELINE_SECTION_VERSION_ID",
    );
  }
  if (
    typeof value.decision !== "string" ||
    !CAPA_IMPLEMENTATION_REVIEW_DECISIONS.includes(
      value.decision as CapaImplementationReviewDecision,
    )
  ) {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_DECISION",
    );
  }
  if (!rationale(value.rationale)) {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_RATIONALE",
    );
  }

  return {
    status: "valid",
    value: Object.freeze({
      schema_version:
        CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
      source_case_version_id:
        value.source_case_version_id as CapaCaseVersionId,
      implementation_review_baseline_section_version_id:
        value.implementation_review_baseline_section_version_id as
          CapaSectionVersionId,
      decision:
        value.decision as CapaImplementationReviewDecision,
      rationale:
        value.rationale as string,
    }),
  };
}

export const validateCapaImplementationReviewDecisionContent =
  validateCapaImplementationReviewDecision;
