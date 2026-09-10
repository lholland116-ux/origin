import type {
  ActorReference,
  AuditEventId,
  CapaCaseVersionId,
  IsoDateTime,
} from "./capa-types";

export const CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION =
  "capa-action-plan-review-return-response-draft-1.0.0" as const;
export const CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_SECTION_TYPE =
  "CAPA.ACTION_PLAN_REVIEW_RETURN_RESPONSE" as const;
export const CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION =
  "capa-action-plan-review-return-response-1.0.0" as const;

export interface CapaActionPlanReviewReturnResponseEditableContent {
  readonly response_narrative: string;
}

export interface CapaActionPlanReviewReturnResponseCycleBinding {
  readonly return_transition_audit_event_id: AuditEventId;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
}

/**
 * Durable, non-authoritative S60 response to one S70 return cycle.
 * The cycle binding, responder, and response time are resolved by the server.
 */
export interface CapaActionPlanReviewReturnResponseDraft
  extends CapaActionPlanReviewReturnResponseEditableContent,
    CapaActionPlanReviewReturnResponseCycleBinding {
  readonly schema_version:
    typeof CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION;
  readonly responded_by: ActorReference;
  readonly responded_at: IsoDateTime;
}

export interface CapaActionPlanReviewReturnResponseContent
  extends CapaActionPlanReviewReturnResponseEditableContent,
    CapaActionPlanReviewReturnResponseCycleBinding {
  readonly schema_version:
    typeof CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION;
  /** The immutable S70 case version created by the resubmission. */
  readonly resubmitted_case_version_id: CapaCaseVersionId;
  readonly responded_by: ActorReference;
  readonly responded_at: IsoDateTime;
}

export const CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_VALIDATION_REASON_CODES = [
  "INVALID_ACTION_PLAN_RETURN_RESPONSE_OBJECT",
  "INVALID_ACTION_PLAN_RETURN_RESPONSE_FIELDS",
  "INVALID_ACTION_PLAN_RETURN_RESPONSE_SCHEMA_VERSION",
  "INVALID_ACTION_PLAN_RETURN_RESPONSE_NARRATIVE",
  "INVALID_ACTION_PLAN_RETURN_RESPONSE_CYCLE_IDENTITY",
  "INVALID_ACTION_PLAN_RETURN_RESPONSE_RESPONDED_BY",
  "INVALID_ACTION_PLAN_RETURN_RESPONSE_RESPONDED_AT",
] as const;
export type CapaActionPlanReviewReturnResponseValidationReasonCode =
  (typeof CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_VALIDATION_REASON_CODES)[number];

export type CapaActionPlanReviewReturnResponseValidationResult<T> =
  | { readonly status: "valid"; readonly value: T }
  | {
      readonly status: "invalid";
      readonly reason_code: CapaActionPlanReviewReturnResponseValidationReasonCode;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_NARRATIVE_LENGTH = 4_000;

const EDITABLE_FIELDS = ["response_narrative"] as const;
const DRAFT_FIELDS = [
  "schema_version",
  ...EDITABLE_FIELDS,
  "return_transition_audit_event_id",
  "source_case_version_id",
  "resulting_case_version_id",
  "responded_by",
  "responded_at",
] as const;
const CONTENT_FIELDS = [...DRAFT_FIELDS, "resubmitted_case_version_id"] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function narrative(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NARRATIVE_LENGTH &&
    value.trim() === value;
}

function isoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === "string" &&
    ISO_DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function cycleBinding(value: Record<string, unknown>): boolean {
  return uuid(value.return_transition_audit_event_id) &&
    uuid(value.source_case_version_id) &&
    uuid(value.resulting_case_version_id);
}

function invalid<T>(
  reason_code: CapaActionPlanReviewReturnResponseValidationReasonCode,
): CapaActionPlanReviewReturnResponseValidationResult<T> {
  return Object.freeze({ status: "invalid", reason_code });
}

export function validateCapaActionPlanReviewReturnResponseEditableContent(
  value: unknown,
): CapaActionPlanReviewReturnResponseValidationResult<CapaActionPlanReviewReturnResponseEditableContent> {
  if (!record(value)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_OBJECT");
  if (!exactFields(value, EDITABLE_FIELDS)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_FIELDS");
  if (!narrative(value.response_narrative)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_NARRATIVE");
  return {
    status: "valid",
    value: Object.freeze({ response_narrative: value.response_narrative }),
  };
}

export function validateCapaActionPlanReviewReturnResponseDraft(
  value: unknown,
): CapaActionPlanReviewReturnResponseValidationResult<CapaActionPlanReviewReturnResponseDraft> {
  if (!record(value)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_OBJECT");
  if (!exactFields(value, DRAFT_FIELDS)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_FIELDS");
  if (value.schema_version !== CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION) {
    return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_SCHEMA_VERSION");
  }
  if (!narrative(value.response_narrative)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_NARRATIVE");
  if (!cycleBinding(value)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_CYCLE_IDENTITY");
  if (
    !record(value.responded_by) ||
    !exactFields(value.responded_by, ["actor_type", "actor_id"]) ||
    value.responded_by.actor_type !== "human" ||
    !uuid(value.responded_by.actor_id)
  ) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_RESPONDED_BY");
  if (!isoDateTime(value.responded_at)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_RESPONDED_AT");

  return {
    status: "valid",
    value: Object.freeze({
      schema_version: CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
      response_narrative: value.response_narrative,
      return_transition_audit_event_id: value.return_transition_audit_event_id as AuditEventId,
      source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
      resulting_case_version_id: value.resulting_case_version_id as CapaCaseVersionId,
      responded_by: Object.freeze({
        actor_type: "human" as const,
        actor_id: value.responded_by.actor_id as string,
      }),
      responded_at: value.responded_at as IsoDateTime,
    }),
  };
}

export function validateCapaActionPlanReviewReturnResponseContent(
  value: unknown,
): CapaActionPlanReviewReturnResponseValidationResult<CapaActionPlanReviewReturnResponseContent> {
  if (!record(value)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_OBJECT");
  if (!exactFields(value, CONTENT_FIELDS)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_FIELDS");
  if (value.schema_version !== CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION) {
    return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_SCHEMA_VERSION");
  }
  if (!narrative(value.response_narrative)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_NARRATIVE");
  if (!cycleBinding(value)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_CYCLE_IDENTITY");
  if (!uuid(value.resubmitted_case_version_id)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_CYCLE_IDENTITY");
  if (
    !record(value.responded_by) ||
    !exactFields(value.responded_by, ["actor_type", "actor_id"]) ||
    value.responded_by.actor_type !== "human" ||
    !uuid(value.responded_by.actor_id)
  ) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_RESPONDED_BY");
  if (!isoDateTime(value.responded_at)) return invalid("INVALID_ACTION_PLAN_RETURN_RESPONSE_RESPONDED_AT");

  return {
    status: "valid",
    value: Object.freeze({
      schema_version: CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
      response_narrative: value.response_narrative,
      return_transition_audit_event_id: value.return_transition_audit_event_id as AuditEventId,
      source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
      resulting_case_version_id: value.resulting_case_version_id as CapaCaseVersionId,
      resubmitted_case_version_id: value.resubmitted_case_version_id as CapaCaseVersionId,
      responded_by: Object.freeze({
        actor_type: "human" as const,
        actor_id: value.responded_by.actor_id as string,
      }),
      responded_at: value.responded_at as IsoDateTime,
    }),
  };
}
