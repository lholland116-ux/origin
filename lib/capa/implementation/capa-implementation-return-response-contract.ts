import type {
  AuditEventId,
  CapaCaseVersionId,
  IsoDateTime,
  UserId,
} from "../domain/capa-types";

export const CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION =
  "capa-implementation-review-return-response-draft-1.0.0" as const;
export const CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE =
  "CAPA.IMPLEMENTATION_REVIEW_RETURN_RESPONSE" as const;
export const CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION =
  "capa-implementation-review-return-response-1.0.0" as const;

export interface CapaImplementationReviewReturnResponseEditableContent {
  readonly response_narrative: string;
}

export interface CapaImplementationReviewReturnResponseCycleBinding {
  readonly return_transition_audit_event_id: AuditEventId;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
}

/**
 * Future S90 -> S80 editable extension point. Reviewer identity, rationale,
 * and authoritative timestamps remain outside this client-owned draft.
 */
export interface CapaImplementationReviewReturnResponseDraft
  extends CapaImplementationReviewReturnResponseEditableContent,
    CapaImplementationReviewReturnResponseCycleBinding {
  readonly schema_version:
    typeof CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION;
  readonly response_narrative: string;
}

export interface CapaImplementationReviewReturnResponseContent
  extends CapaImplementationReviewReturnResponseEditableContent,
    CapaImplementationReviewReturnResponseCycleBinding {
  readonly schema_version:
    typeof CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION;
  readonly resubmitted_case_version_id: CapaCaseVersionId;
  readonly responded_by: Readonly<{
    readonly actor_type: "human";
    readonly actor_id: UserId;
  }>;
  readonly responded_at: IsoDateTime;
}

export const CAPA_IMPLEMENTATION_RETURN_RESPONSE_FIELDS = [
  "schema_version",
  "return_transition_audit_event_id",
  "source_case_version_id",
  "resulting_case_version_id",
  "response_narrative",
] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const EDITABLE_FIELDS = ["response_narrative"] as const;
const DRAFT_FIELDS = CAPA_IMPLEMENTATION_RETURN_RESPONSE_FIELDS;
const CONTENT_FIELDS = [
  ...CAPA_IMPLEMENTATION_RETURN_RESPONSE_FIELDS.filter((field) => field !== "schema_version"),
  "schema_version",
  "resubmitted_case_version_id",
  "responded_by",
  "responded_at",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function narrative(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_000 && value.trim() === value;
}

function isoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === "string" && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function invalid<T>(reason_code: string) {
  return { status: "invalid" as const, reason_code } as const;
}

export function validateCapaImplementationReviewReturnResponseEditableContent(
  value: unknown,
): { readonly status: "valid"; readonly value: CapaImplementationReviewReturnResponseEditableContent } | { readonly status: "invalid"; readonly reason_code: string } {
  if (!record(value) || !exactFields(value, EDITABLE_FIELDS)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_FIELDS");
  if (!narrative(value.response_narrative)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_NARRATIVE");
  return { status: "valid", value: Object.freeze({ response_narrative: value.response_narrative }) };
}

export function validateCapaImplementationReviewReturnResponseDraft(
  value: unknown,
): { readonly status: "valid"; readonly value: CapaImplementationReviewReturnResponseDraft } | { readonly status: "invalid"; readonly reason_code: string } {
  if (!record(value) || !exactFields(value, DRAFT_FIELDS)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_FIELDS");
  if (value.schema_version !== CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION");
  if (!narrative(value.response_narrative)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_NARRATIVE");
  if (!uuid(value.return_transition_audit_event_id) || !uuid(value.source_case_version_id) || !uuid(value.resulting_case_version_id)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_BINDING");
  return { status: "valid", value: Object.freeze({
    schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
    response_narrative: value.response_narrative,
    return_transition_audit_event_id: value.return_transition_audit_event_id as AuditEventId,
    source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
    resulting_case_version_id: value.resulting_case_version_id as CapaCaseVersionId,
  }) };
}

export function validateCapaImplementationReviewReturnResponseContent(
  value: unknown,
): { readonly status: "valid"; readonly value: CapaImplementationReviewReturnResponseContent } | { readonly status: "invalid"; readonly reason_code: string } {
  if (!record(value) || !exactFields(value, CONTENT_FIELDS)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_FIELDS");
  if (value.schema_version !== CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION");
  if (!narrative(value.response_narrative)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_NARRATIVE");
  if (!uuid(value.return_transition_audit_event_id) || !uuid(value.source_case_version_id) || !uuid(value.resulting_case_version_id) || !uuid(value.resubmitted_case_version_id)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_BINDING");
  if (!record(value.responded_by) || !exactFields(value.responded_by, ["actor_type", "actor_id"]) || value.responded_by.actor_type !== "human" || !uuid(value.responded_by.actor_id)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_RESPONDED_BY");
  if (!isoDateTime(value.responded_at)) return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_RESPONDED_AT");
  return { status: "valid", value: Object.freeze({
    schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
    response_narrative: value.response_narrative,
    return_transition_audit_event_id: value.return_transition_audit_event_id as AuditEventId,
    source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
    resulting_case_version_id: value.resulting_case_version_id as CapaCaseVersionId,
    resubmitted_case_version_id: value.resubmitted_case_version_id as CapaCaseVersionId,
    responded_by: Object.freeze({ actor_type: "human" as const, actor_id: value.responded_by.actor_id as UserId }),
    responded_at: value.responded_at as IsoDateTime,
  }) };
}
