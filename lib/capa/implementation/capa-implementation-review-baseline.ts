import type {
  AuditEventId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  IsoDateTime,
  UserId,
} from "../domain/capa-types";
import type {
  CapaImplementationActionProgress,
  CapaImplementationApprovedS70BaselineReference,
} from "./capa-implementation-contract";
import {
  validateCapaImplementationApprovedS70BaselineReference,
  validateCapaImplementationDraftAgainstApprovedActionSet,
} from "./capa-implementation-validator";

/**
 * Immutable controlled material submitted from S80 for later S90 review.
 *
 * The section deliberately contains the human-owned implementation package,
 * not raw AI advisory output or mutable workspace metadata. The section's
 * CapaSectionVersion envelope and the transition audit event independently
 * carry authoritative actor and timestamp attribution.
 */
export const CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE =
  "CAPA.IMPLEMENTATION_REVIEW_BASELINE" as const;

export const CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION =
  "capa-implementation-review-baseline-1.0.0" as const;

export interface CapaImplementationReviewBaselineContent {
  readonly approved_s70_baseline:
    CapaImplementationApprovedS70BaselineReference;
  readonly source_s80_case_version_id: CapaCaseVersionId;
  readonly source_s80_workspace_revision: number;
  readonly resulting_s90_case_version_id: CapaCaseVersionId;
  readonly transition_audit_event_id: AuditEventId;
  readonly submitted_by_user_id: UserId;
  readonly submitted_at: IsoDateTime;
  readonly action_progress: readonly CapaImplementationActionProgress[];
}

export const CAPA_IMPLEMENTATION_REVIEW_BASELINE_FIELDS = [
  "approved_s70_baseline",
  "source_s80_case_version_id",
  "source_s80_workspace_revision",
  "resulting_s90_case_version_id",
  "transition_audit_event_id",
  "submitted_by_user_id",
  "submitted_at",
  "action_progress",
] as const;

export const CAPA_IMPLEMENTATION_REVIEW_BASELINE_VALIDATION_REASON_CODES = [
  "INVALID_IMPLEMENTATION_REVIEW_BASELINE",
  "INVALID_IMPLEMENTATION_REVIEW_BASELINE_FIELDS",
  "INVALID_IMPLEMENTATION_REVIEW_BASELINE_IDENTITY",
  "INVALID_IMPLEMENTATION_REVIEW_BASELINE_REVISION",
  "INVALID_IMPLEMENTATION_REVIEW_BASELINE_TIMESTAMP",
  "INVALID_IMPLEMENTATION_REVIEW_BASELINE_ACTION_PROGRESS",
  "IMPLEMENTATION_REVIEW_BASELINE_ACTION_SET_MISMATCH",
] as const;

export type CapaImplementationReviewBaselineValidationReasonCode =
  (typeof CAPA_IMPLEMENTATION_REVIEW_BASELINE_VALIDATION_REASON_CODES)[number];

export type CapaImplementationReviewBaselineValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaImplementationReviewBaselineContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code: CapaImplementationReviewBaselineValidationReasonCode;
      readonly detail_reason_code?: string;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === "string" && ISO_DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function invalid(
  reason_code: CapaImplementationReviewBaselineValidationReasonCode,
  detail_reason_code?: string,
): CapaImplementationReviewBaselineValidationResult {
  return Object.freeze({
    status: "invalid",
    reason_code,
    ...(detail_reason_code === undefined ? {} : { detail_reason_code }),
  });
}

export function validateCapaImplementationReviewBaselineContent(
  value: unknown,
): CapaImplementationReviewBaselineValidationResult {
  if (!record(value)) return invalid("INVALID_IMPLEMENTATION_REVIEW_BASELINE");
  if (!exactFields(value, CAPA_IMPLEMENTATION_REVIEW_BASELINE_FIELDS)) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_BASELINE_FIELDS");
  }
  const baseline = validateCapaImplementationApprovedS70BaselineReference(
    value.approved_s70_baseline,
  );
  if (baseline.status !== "valid") {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_BASELINE_IDENTITY",
      baseline.reason_code,
    );
  }
  if (
    !uuid(value.source_s80_case_version_id) ||
    !uuid(value.resulting_s90_case_version_id) ||
    !uuid(value.transition_audit_event_id) ||
    !uuid(value.submitted_by_user_id)
  ) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_BASELINE_IDENTITY");
  }
  if (
    !Number.isSafeInteger(value.source_s80_workspace_revision) ||
    (value.source_s80_workspace_revision as number) < 1
  ) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_BASELINE_REVISION");
  }
  if (!isoDateTime(value.submitted_at)) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_BASELINE_TIMESTAMP");
  }
  if (!Array.isArray(value.action_progress)) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_BASELINE_ACTION_PROGRESS");
  }

  const draft = validateCapaImplementationDraftAgainstApprovedActionSet(
    {
      schema_version: "capa-implementation-workspace-draft-1.0.0",
      action_progress: value.action_progress,
      implementation_review_return_response: null,
    },
    value.action_progress.map((item) =>
      record(item) && typeof item.approved_action_reference === "string"
        ? item.approved_action_reference
        : "",
    ),
  );
  if (draft.status !== "valid") {
    return invalid(
      "INVALID_IMPLEMENTATION_REVIEW_BASELINE_ACTION_PROGRESS",
      draft.reason_code,
    );
  }

  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      approved_s70_baseline: baseline.value,
      source_s80_case_version_id: value.source_s80_case_version_id as CapaCaseVersionId,
      source_s80_workspace_revision: value.source_s80_workspace_revision as number,
      resulting_s90_case_version_id: value.resulting_s90_case_version_id as CapaCaseVersionId,
      transition_audit_event_id: value.transition_audit_event_id as AuditEventId,
      submitted_by_user_id: value.submitted_by_user_id as UserId,
      submitted_at: value.submitted_at,
      action_progress: draft.value.action_progress,
    }),
  });
}

export function validateCapaImplementationReviewBaselineAgainstApprovedActionSet(
  value: unknown,
  authoritativeApprovedActionReferences: readonly string[],
): CapaImplementationReviewBaselineValidationResult {
  const baseline = validateCapaImplementationReviewBaselineContent(value);
  if (baseline.status !== "valid") return baseline;
  const draft = validateCapaImplementationDraftAgainstApprovedActionSet(
    {
      schema_version: "capa-implementation-workspace-draft-1.0.0",
      action_progress: baseline.value.action_progress,
      implementation_review_return_response: null,
    },
    authoritativeApprovedActionReferences,
  );
  if (draft.status !== "valid") {
    return invalid(
      "IMPLEMENTATION_REVIEW_BASELINE_ACTION_SET_MISMATCH",
      draft.reason_code,
    );
  }
  return baseline;
}

export function createCapaImplementationReviewBaselineContent(
  input: CapaImplementationReviewBaselineContent,
): CapaImplementationReviewBaselineContent {
  const validated = validateCapaImplementationReviewBaselineContent(input);
  if (validated.status !== "valid") {
    throw new Error(
      `The immutable implementation-review baseline is invalid: ${validated.reason_code}.`,
    );
  }
  return validated.value;
}

export type {
  CapaImplementationApprovedS70BaselineReference,
};
