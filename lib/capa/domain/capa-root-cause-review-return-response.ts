import type {
  ActorReference,
  AuditEventId,
  CapaCaseVersionId,
  IsoDateTime,
} from "./capa-types";

export const CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SECTION_TYPE =
  "CAPA.ROOT_CAUSE_REVIEW_RETURN_RESPONSE" as const;
export const CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION =
  "capa-root-cause-review-return-response-1.0.0" as const;
export const CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION =
  "capa-root-cause-review-return-response-draft-1.0.0" as const;

export const CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DISPOSITIONS = [
  "addressed",
  "partially_addressed",
  "unable_to_address",
] as const;
export type CapaRootCauseReviewReturnResponseDisposition =
  (typeof CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DISPOSITIONS)[number];

export interface CapaRootCauseReviewReturnResponseEditableContent {
  readonly response_summary: string;
  readonly actions_taken: string;
  readonly disposition: CapaRootCauseReviewReturnResponseDisposition;
  readonly supporting_evidence_item_ids: readonly string[];
}

export interface CapaRootCauseReviewReturnResponseCycleBinding {
  readonly return_transition_audit_event_id: AuditEventId;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
}

export interface CapaRootCauseReviewReturnResponseDraft
  extends CapaRootCauseReviewReturnResponseEditableContent,
    CapaRootCauseReviewReturnResponseCycleBinding {
  readonly schema_version:
    typeof CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION;
  readonly responded_by: ActorReference;
  readonly responded_at: IsoDateTime;
}

export interface CapaRootCauseReviewReturnResponseContent
  extends CapaRootCauseReviewReturnResponseEditableContent,
    CapaRootCauseReviewReturnResponseCycleBinding {
  readonly schema_version:
    typeof CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION;
  readonly responded_by: ActorReference;
  readonly responded_at: IsoDateTime;
}

export const CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_VALIDATION_REASON_CODES = [
  "INVALID_RETURN_RESPONSE_OBJECT",
  "INVALID_RETURN_RESPONSE_FIELDS",
  "INVALID_RETURN_RESPONSE_SCHEMA_VERSION",
  "INVALID_RETURN_RESPONSE_SUMMARY",
  "INVALID_RETURN_RESPONSE_ACTIONS_TAKEN",
  "INVALID_RETURN_RESPONSE_DISPOSITION",
  "INVALID_RETURN_RESPONSE_EVIDENCE_IDS",
  "INVALID_RETURN_RESPONSE_CYCLE_IDENTITY",
  "INVALID_RETURN_RESPONSE_RESPONDED_BY",
  "INVALID_RETURN_RESPONSE_RESPONDED_AT",
] as const;
export type CapaRootCauseReviewReturnResponseValidationReasonCode =
  (typeof CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_VALIDATION_REASON_CODES)[number];

export type CapaRootCauseReviewReturnResponseValidationResult<T> =
  | { readonly status: "valid"; readonly value: T }
  | {
      readonly status: "invalid";
      readonly reason_code: CapaRootCauseReviewReturnResponseValidationReasonCode;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_TEXT_LENGTH = 4_000;
const MAX_EVIDENCE_ID_LENGTH = 200;

const EDITABLE_FIELDS = [
  "response_summary",
  "actions_taken",
  "disposition",
  "supporting_evidence_item_ids",
] as const;
const CYCLE_FIELDS = [
  "return_transition_audit_event_id",
  "source_case_version_id",
  "resulting_case_version_id",
] as const;
const DRAFT_FIELDS = [
  "schema_version",
  ...EDITABLE_FIELDS,
  ...CYCLE_FIELDS,
  "responded_by",
  "responded_at",
] as const;
const AUTHORITATIVE_FIELDS = [
  "schema_version",
  ...EDITABLE_FIELDS,
  ...CYCLE_FIELDS,
  "responded_by",
  "responded_at",
] as const;

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

function text(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TEXT_LENGTH &&
    value.trim() === value;
}

function evidenceId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_EVIDENCE_ID_LENGTH &&
    value.trim() === value;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isoDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    ISO_DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function disposition(
  value: unknown,
): value is CapaRootCauseReviewReturnResponseDisposition {
  return typeof value === "string" &&
    CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DISPOSITIONS.includes(
      value as CapaRootCauseReviewReturnResponseDisposition,
    );
}

function evidenceIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    value.every(evidenceId) &&
    new Set(value).size === value.length;
}

function cycleBinding(value: Record<string, unknown>): boolean {
  return uuid(value.return_transition_audit_event_id) &&
    uuid(value.source_case_version_id) &&
    uuid(value.resulting_case_version_id);
}

function editableContent(
  value: Record<string, unknown>,
): CapaRootCauseReviewReturnResponseValidationReasonCode | null {
  if (!text(value.response_summary)) return "INVALID_RETURN_RESPONSE_SUMMARY";
  if (!text(value.actions_taken)) return "INVALID_RETURN_RESPONSE_ACTIONS_TAKEN";
  if (!disposition(value.disposition)) return "INVALID_RETURN_RESPONSE_DISPOSITION";
  if (!evidenceIds(value.supporting_evidence_item_ids)) {
    return "INVALID_RETURN_RESPONSE_EVIDENCE_IDS";
  }
  return null;
}

function cycle(
  value: Record<string, unknown>,
): CapaRootCauseReviewReturnResponseValidationReasonCode | null {
  return cycleBinding(value) ? null : "INVALID_RETURN_RESPONSE_CYCLE_IDENTITY";
}

function invalid<T>(
  reason_code: CapaRootCauseReviewReturnResponseValidationReasonCode,
): CapaRootCauseReviewReturnResponseValidationResult<T> {
  return Object.freeze({ status: "invalid", reason_code });
}

export function validateCapaRootCauseReviewReturnResponseEditableContent(
  value: unknown,
): CapaRootCauseReviewReturnResponseValidationResult<CapaRootCauseReviewReturnResponseEditableContent> {
  if (!record(value)) return invalid("INVALID_RETURN_RESPONSE_OBJECT");
  if (!exactFields(value, EDITABLE_FIELDS)) return invalid("INVALID_RETURN_RESPONSE_FIELDS");
  const reason = editableContent(value);
  if (reason !== null) return invalid(reason);
  return {
    status: "valid",
    value: Object.freeze({
      response_summary: value.response_summary as string,
      actions_taken: value.actions_taken as string,
      disposition: value.disposition as CapaRootCauseReviewReturnResponseDisposition,
      supporting_evidence_item_ids: Object.freeze([
        ...(value.supporting_evidence_item_ids as string[]),
      ]),
    }),
  };
}

export function validateCapaRootCauseReviewReturnResponseDraft(
  value: unknown,
): CapaRootCauseReviewReturnResponseValidationResult<CapaRootCauseReviewReturnResponseDraft> {
  if (!record(value)) return invalid("INVALID_RETURN_RESPONSE_OBJECT");
  if (!exactFields(value, DRAFT_FIELDS)) return invalid("INVALID_RETURN_RESPONSE_FIELDS");
  if (value.schema_version !== CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION) {
    return invalid("INVALID_RETURN_RESPONSE_SCHEMA_VERSION");
  }
  const editableReason = editableContent(value);
  if (editableReason !== null) return invalid(editableReason);
  const cycleReason = cycle(value);
  if (cycleReason !== null) return invalid(cycleReason);
  const respondedBy = value.responded_by;
  if (
    !record(respondedBy) ||
    !exactFields(respondedBy, ["actor_type", "actor_id"]) ||
    respondedBy.actor_type !== "human" ||
    !uuid(respondedBy.actor_id)
  ) return invalid("INVALID_RETURN_RESPONSE_RESPONDED_BY");
  if (!isoDateTime(value.responded_at)) return invalid("INVALID_RETURN_RESPONSE_RESPONDED_AT");
  return {
    status: "valid",
    value: Object.freeze({
      schema_version: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
      response_summary: value.response_summary as string,
      actions_taken: value.actions_taken as string,
      disposition: value.disposition as CapaRootCauseReviewReturnResponseDisposition,
      supporting_evidence_item_ids: Object.freeze([
        ...(value.supporting_evidence_item_ids as string[]),
      ]),
      return_transition_audit_event_id: value.return_transition_audit_event_id as AuditEventId,
      source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
      resulting_case_version_id: value.resulting_case_version_id as CapaCaseVersionId,
      responded_by: Object.freeze({
        actor_type: "human" as const,
        actor_id: respondedBy.actor_id as string,
      }),
      responded_at: value.responded_at as IsoDateTime,
    }),
  };
}

export function validateCapaRootCauseReviewReturnResponseContent(
  value: unknown,
): CapaRootCauseReviewReturnResponseValidationResult<CapaRootCauseReviewReturnResponseContent> {
  if (!record(value)) return invalid("INVALID_RETURN_RESPONSE_OBJECT");
  if (!exactFields(value, AUTHORITATIVE_FIELDS)) return invalid("INVALID_RETURN_RESPONSE_FIELDS");
  if (value.schema_version !== CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION) {
    return invalid("INVALID_RETURN_RESPONSE_SCHEMA_VERSION");
  }
  const editableReason = editableContent(value);
  if (editableReason !== null) return invalid(editableReason);
  const cycleReason = cycle(value);
  if (cycleReason !== null) return invalid(cycleReason);
  const respondedBy = value.responded_by;
  if (
    !record(respondedBy) ||
    !exactFields(respondedBy, ["actor_type", "actor_id"]) ||
    respondedBy.actor_type !== "human" ||
    !uuid(respondedBy.actor_id)
  ) return invalid("INVALID_RETURN_RESPONSE_RESPONDED_BY");
  if (!isoDateTime(value.responded_at)) return invalid("INVALID_RETURN_RESPONSE_RESPONDED_AT");
  return {
    status: "valid",
    value: Object.freeze({
      schema_version: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
      response_summary: value.response_summary as string,
      actions_taken: value.actions_taken as string,
      disposition: value.disposition as CapaRootCauseReviewReturnResponseDisposition,
      supporting_evidence_item_ids: Object.freeze([
        ...(value.supporting_evidence_item_ids as string[]),
      ]),
      return_transition_audit_event_id: value.return_transition_audit_event_id as AuditEventId,
      source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
      resulting_case_version_id: value.resulting_case_version_id as CapaCaseVersionId,
      responded_by: Object.freeze({
        actor_type: "human" as const,
        actor_id: respondedBy.actor_id as string,
      }),
      responded_at: value.responded_at as IsoDateTime,
    }),
  };
}

export const validateCapaRootCauseReviewReturnResponseAuthoritativeContent =
  validateCapaRootCauseReviewReturnResponseContent;
