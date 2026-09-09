import type {
  CapaCaseVersionId,
  CapaSectionVersionId,
} from "./capa-types";

export const CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION =
  "capa-action-plan-review-decision-1.0.0" as const;

export const CAPA_ACTION_PLAN_REVIEW_DECISIONS = [
  "approve",
  "return",
] as const;

export type CapaActionPlanReviewDecision =
  (typeof CAPA_ACTION_PLAN_REVIEW_DECISIONS)[number];

export interface CapaActionPlanReviewDecisionContent {
  readonly schema_version:
    typeof CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION;
  readonly source_case_version_id:
    CapaCaseVersionId;
  readonly action_plan_section_version_id:
    CapaSectionVersionId;
  readonly decision:
    CapaActionPlanReviewDecision;
  readonly rationale:
    string;
}

export const CAPA_ACTION_PLAN_REVIEW_DECISION_VALIDATION_REASON_CODES = [
  "INVALID_ACTION_PLAN_REVIEW_DECISION_OBJECT",
  "INVALID_ACTION_PLAN_REVIEW_DECISION_FIELDS",
  "INVALID_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION",
  "INVALID_ACTION_PLAN_REVIEW_DECISION_SOURCE_CASE_VERSION_ID",
  "INVALID_ACTION_PLAN_REVIEW_DECISION_SECTION_VERSION_ID",
  "INVALID_ACTION_PLAN_REVIEW_DECISION",
  "INVALID_ACTION_PLAN_REVIEW_DECISION_RATIONALE",
] as const;

export type CapaActionPlanReviewDecisionValidationReasonCode =
  (typeof CAPA_ACTION_PLAN_REVIEW_DECISION_VALIDATION_REASON_CODES)[number];

export type CapaActionPlanReviewDecisionValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaActionPlanReviewDecisionContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        CapaActionPlanReviewDecisionValidationReasonCode;
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
    "action_plan_section_version_id",
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
  reason_code: CapaActionPlanReviewDecisionValidationReasonCode,
): CapaActionPlanReviewDecisionValidationResult {
  return Object.freeze({ status: "invalid", reason_code });
}

export function validateCapaActionPlanReviewDecision(
  value: unknown,
): CapaActionPlanReviewDecisionValidationResult {
  if (!record(value)) {
    return invalid("INVALID_ACTION_PLAN_REVIEW_DECISION_OBJECT");
  }
  if (!exactFields(value)) {
    return invalid("INVALID_ACTION_PLAN_REVIEW_DECISION_FIELDS");
  }
  if (
    value.schema_version !==
    CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION
  ) {
    return invalid("INVALID_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION");
  }
  if (!uuid(value.source_case_version_id)) {
    return invalid(
      "INVALID_ACTION_PLAN_REVIEW_DECISION_SOURCE_CASE_VERSION_ID",
    );
  }
  if (!uuid(value.action_plan_section_version_id)) {
    return invalid(
      "INVALID_ACTION_PLAN_REVIEW_DECISION_SECTION_VERSION_ID",
    );
  }
  if (
    typeof value.decision !== "string" ||
    !CAPA_ACTION_PLAN_REVIEW_DECISIONS.includes(
      value.decision as CapaActionPlanReviewDecision,
    )
  ) {
    return invalid("INVALID_ACTION_PLAN_REVIEW_DECISION");
  }
  if (!rationale(value.rationale)) {
    return invalid("INVALID_ACTION_PLAN_REVIEW_DECISION_RATIONALE");
  }

  return {
    status: "valid",
    value: Object.freeze({
      schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
      source_case_version_id:
        value.source_case_version_id as CapaCaseVersionId,
      action_plan_section_version_id:
        value.action_plan_section_version_id as CapaSectionVersionId,
      decision: value.decision as CapaActionPlanReviewDecision,
      rationale: value.rationale as string,
    }),
  };
}

export const validateCapaActionPlanReviewDecisionContent =
  validateCapaActionPlanReviewDecision;
