import type {
  AuditEventId,
  CapaCaseVersionId,
  CapaImplementationEvidenceId,
  CapaSectionVersionId,
} from "../domain/capa-types";
import {
  CAPA_IMPLEMENTATION_ACTION_PROGRESS_FIELDS,
  CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES,
  CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_WORKSPACE_FIELDS,
} from "./capa-implementation-contract";
import type {
  CapaImplementationActionProgress,
  CapaImplementationApprovedS70BaselineReference,
  CapaImplementationOwnerReportedStatus,
  CapaImplementationWorkspaceDraft,
} from "./capa-implementation-contract";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_FIELDS,
  CAPA_IMPLEMENTATION_EVIDENCE_KINDS,
  CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
} from "./capa-implementation-evidence-contract";
import type {
  CapaImplementationEvidence,
  CapaImplementationEvidenceKind,
} from "./capa-implementation-evidence-contract";
import {
  CAPA_IMPLEMENTATION_PROVENANCE_FIELDS,
  CAPA_IMPLEMENTATION_PROVENANCE_ORIGIN_KINDS,
  CAPA_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KINDS,
} from "./capa-implementation-provenance-contract";
import type {
  CapaImplementationEvidenceSource,
  CapaImplementationProvenanceOriginKind,
  CapaImplementationProvenanceSourceSystemKind,
} from "./capa-implementation-provenance-contract";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_RETURN_RESPONSE_FIELDS,
} from "./capa-implementation-return-response-contract";
import type {
  CapaImplementationReviewReturnResponseDraft,
} from "./capa-implementation-return-response-contract";

export const CAPA_IMPLEMENTATION_VALIDATION_REASON_CODES = [
  "INVALID_IMPLEMENTATION_WORKSPACE_OBJECT",
  "INVALID_IMPLEMENTATION_WORKSPACE_FIELDS",
  "INVALID_IMPLEMENTATION_WORKSPACE_SCHEMA_VERSION",
  "INVALID_IMPLEMENTATION_ACTION_PROGRESS_COLLECTION",
  "INVALID_IMPLEMENTATION_ACTION_PROGRESS_FIELDS",
  "DUPLICATE_IMPLEMENTATION_ACTION_PROGRESS_REFERENCE",
  "INVALID_APPROVED_ACTION_REFERENCE",
  "INVALID_OWNER_REPORTED_STATUS",
  "INVALID_IMPLEMENTATION_NARRATIVE",
  "INVALID_BLOCKED_REASON",
  "BLOCKED_REASON_REQUIRED",
  "INVALID_IMPLEMENTATION_EVIDENCE_COLLECTION",
  "INVALID_IMPLEMENTATION_EVIDENCE",
  "INVALID_IMPLEMENTATION_EVIDENCE_FIELDS",
  "INVALID_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION",
  "INVALID_IMPLEMENTATION_EVIDENCE_ID",
  "INVALID_IMPLEMENTATION_EVIDENCE_ACTION_REFERENCE",
  "INVALID_IMPLEMENTATION_EVIDENCE_KIND",
  "INVALID_IMPLEMENTATION_EVIDENCE_DESCRIPTION",
  "INVALID_IMPLEMENTATION_EVIDENCE_DATE",
  "INVALID_IMPLEMENTATION_EVIDENCE_PROVENANCE",
  "DUPLICATE_IMPLEMENTATION_EVIDENCE_ID",
  "INVALID_IMPLEMENTATION_PROVENANCE_OBJECT",
  "INVALID_IMPLEMENTATION_PROVENANCE_FIELDS",
  "INVALID_IMPLEMENTATION_PROVENANCE_ORIGIN_KIND",
  "INVALID_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KIND",
  "INVALID_IMPLEMENTATION_PROVENANCE_FIELD",
  "INVALID_IMPLEMENTATION_PROVENANCE_COMBINATION",
  "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE",
  "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_FIELDS",
  "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION",
  "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_NARRATIVE",
  "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_BINDING",
  "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_RESPONDED_BY",
  "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_RESPONDED_AT",
  "INVALID_APPROVED_S70_BASELINE_REFERENCE",
  "INVALID_APPROVED_S70_BASELINE_REFERENCE_FIELDS",
  "INVALID_APPROVED_S70_BASELINE_REFERENCE_IDENTITY",
  "INVALID_AUTHORITATIVE_ACTION_REFERENCE_SET",
  "APPROVED_ACTION_REFERENCE_NOT_AUTHORITATIVE",
] as const;

export type CapaImplementationValidationReasonCode =
  (typeof CAPA_IMPLEMENTATION_VALIDATION_REASON_CODES)[number];

export type CapaImplementationValidationResult<T> =
  | { readonly status: "valid"; readonly value: T }
  | {
      readonly status: "invalid";
      readonly reason_code: CapaImplementationValidationReasonCode;
      readonly detail_reason_code?: CapaImplementationValidationReasonCode;
    };

export const CAPA_IMPLEMENTATION_READINESS_BLOCKER_CODES = [
  "INVALID_DRAFT",
  "MISSING_APPROVED_ACTION_PROGRESS",
  "ACTION_NOT_REPORTED_COMPLETE",
  "MISSING_IMPLEMENTATION_NARRATIVE",
  "MISSING_IMPLEMENTATION_EVIDENCE",
] as const;

export type CapaImplementationReadinessBlockerCode =
  (typeof CAPA_IMPLEMENTATION_READINESS_BLOCKER_CODES)[number];

export type CapaImplementationSubmissionReadinessResult =
  | { readonly status: "ready_for_s90_review" }
  | {
      readonly status: "not_ready";
      readonly blocker_codes: readonly CapaImplementationReadinessBlockerCode[];
    };

const INVALID = Symbol("INVALID");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NARRATIVE_LENGTH = 4_000;
const MAX_REFERENCE_LENGTH = 200;
const MAX_SOURCE_FIELD_LENGTH = 1_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function boundedText(
  value: unknown,
  maxLength: number,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value;
}

function nullableBoundedText(
  value: unknown,
  maxLength: number,
): string | null | typeof INVALID {
  return value === null
    ? null
    : boundedText(value, maxLength)
      ? value
      : INVALID;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function invalid<T>(
  reason_code: CapaImplementationValidationReasonCode,
  detail_reason_code?: CapaImplementationValidationReasonCode,
): CapaImplementationValidationResult<T> {
  return Object.freeze({
    status: "invalid",
    reason_code,
    ...(detail_reason_code === undefined ? {} : { detail_reason_code }),
  });
}

function valid<T>(value: T): CapaImplementationValidationResult<T> {
  return Object.freeze({ status: "valid", value });
}

function parseSourceVersion(
  value: unknown,
): string | number | null | typeof INVALID {
  if (value === null) return null;
  if (boundedText(value, MAX_SOURCE_FIELD_LENGTH)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return INVALID;
}

export function validateCapaImplementationEvidenceSource(
  value: unknown,
): CapaImplementationValidationResult<CapaImplementationEvidenceSource> {
  if (!record(value)) return invalid("INVALID_IMPLEMENTATION_PROVENANCE_OBJECT");
  if (!exactFields(value, CAPA_IMPLEMENTATION_PROVENANCE_FIELDS)) {
    return invalid("INVALID_IMPLEMENTATION_PROVENANCE_FIELDS");
  }
  if (!oneOf(value.origin_kind, CAPA_IMPLEMENTATION_PROVENANCE_ORIGIN_KINDS)) {
    return invalid("INVALID_IMPLEMENTATION_PROVENANCE_ORIGIN_KIND");
  }
  if (!oneOf(value.source_system_kind, CAPA_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KINDS)) {
    return invalid("INVALID_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KIND");
  }

  const sourceSystemName = nullableBoundedText(
    value.source_system_name,
    MAX_SOURCE_FIELD_LENGTH,
  );
  const sourceRecordReference = nullableBoundedText(
    value.source_record_reference,
    MAX_SOURCE_FIELD_LENGTH,
  );
  const sourceRecordVersion = parseSourceVersion(value.source_record_version);
  const artifactReference = nullableBoundedText(
    value.artifact_reference,
    MAX_SOURCE_FIELD_LENGTH,
  );

  if (
    sourceSystemName === INVALID ||
    sourceRecordReference === INVALID ||
    sourceRecordVersion === INVALID ||
    artifactReference === INVALID
  ) {
    return invalid("INVALID_IMPLEMENTATION_PROVENANCE_FIELD");
  }

  const originKind = value.origin_kind as CapaImplementationProvenanceOriginKind;
  const sourceSystemKind =
    value.source_system_kind as CapaImplementationProvenanceSourceSystemKind;

  if (
    (originKind === "lvtchat_record" && sourceSystemKind !== "lvtchat") ||
    (originKind === "external_system" && sourceSystemKind === "lvtchat") ||
    (originKind === "uploaded_artifact" && artifactReference === null) ||
    (originKind === "controlled_document" &&
      artifactReference === null && sourceRecordReference === null)
  ) {
    return invalid("INVALID_IMPLEMENTATION_PROVENANCE_COMBINATION");
  }

  return valid(Object.freeze({
    origin_kind: originKind,
    source_system_kind: sourceSystemKind,
    source_system_name: sourceSystemName,
    source_record_reference: sourceRecordReference,
    source_record_version: sourceRecordVersion,
    artifact_reference: artifactReference,
  }));
}

export function validateCapaImplementationEvidence(
  value: unknown,
): CapaImplementationValidationResult<CapaImplementationEvidence> {
  if (!record(value)) return invalid("INVALID_IMPLEMENTATION_EVIDENCE");
  if (!exactFields(value, CAPA_IMPLEMENTATION_EVIDENCE_FIELDS)) {
    return invalid("INVALID_IMPLEMENTATION_EVIDENCE_FIELDS");
  }
  if (value.schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION) {
    return invalid("INVALID_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION");
  }
  if (!uuid(value.evidence_id)) {
    return invalid("INVALID_IMPLEMENTATION_EVIDENCE_ID");
  }
  if (!boundedText(value.approved_action_reference, MAX_REFERENCE_LENGTH)) {
    return invalid("INVALID_APPROVED_ACTION_REFERENCE");
  }
  if (!oneOf(value.evidence_kind, CAPA_IMPLEMENTATION_EVIDENCE_KINDS)) {
    return invalid("INVALID_IMPLEMENTATION_EVIDENCE_KIND");
  }
  if (!boundedText(value.description, MAX_NARRATIVE_LENGTH)) {
    return invalid("INVALID_IMPLEMENTATION_EVIDENCE_DESCRIPTION");
  }
  if (!isoDate(value.evidence_date)) {
    return invalid("INVALID_IMPLEMENTATION_EVIDENCE_DATE");
  }

  const source = validateCapaImplementationEvidenceSource(value.source);
  if (source.status !== "valid") {
    return invalid(
      "INVALID_IMPLEMENTATION_EVIDENCE_PROVENANCE",
      source.reason_code,
    );
  }

  return valid(Object.freeze({
    schema_version: CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
    evidence_id: value.evidence_id as CapaImplementationEvidenceId,
    approved_action_reference: value.approved_action_reference,
    evidence_kind: value.evidence_kind as CapaImplementationEvidenceKind,
    description: value.description,
    evidence_date: value.evidence_date,
    source: source.value,
  }));
}

export function validateCapaImplementationReviewReturnResponseDraft(
  value: unknown,
): CapaImplementationValidationResult<CapaImplementationReviewReturnResponseDraft> {
  if (!record(value)) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE");
  }
  if (!exactFields(value, CAPA_IMPLEMENTATION_RETURN_RESPONSE_FIELDS)) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_FIELDS");
  }
  if (
    value.schema_version !==
    CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION
  ) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION");
  }
  if (!boundedText(value.response_narrative, MAX_NARRATIVE_LENGTH)) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_NARRATIVE");
  }
  if (
    !uuid(value.return_transition_audit_event_id) ||
    !uuid(value.source_case_version_id) ||
    !uuid(value.resulting_case_version_id)
  ) {
    return invalid("INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_BINDING");
  }

  return valid(Object.freeze({
    schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
    return_transition_audit_event_id:
      value.return_transition_audit_event_id as AuditEventId,
    source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
    resulting_case_version_id: value.resulting_case_version_id as CapaCaseVersionId,
    response_narrative: value.response_narrative,
  }));
}

export function validateCapaImplementationApprovedS70BaselineReference(
  value: unknown,
): CapaImplementationValidationResult<CapaImplementationApprovedS70BaselineReference> {
  const fields = [
    "source_case_version_id",
    "approved_action_plan_section_id",
    "approval_decision_reference",
  ] as const;
  if (!record(value)) {
    return invalid("INVALID_APPROVED_S70_BASELINE_REFERENCE");
  }
  if (!exactFields(value, fields)) {
    return invalid("INVALID_APPROVED_S70_BASELINE_REFERENCE_FIELDS");
  }
  if (
    !uuid(value.source_case_version_id) ||
    !uuid(value.approved_action_plan_section_id) ||
    !uuid(value.approval_decision_reference)
  ) {
    return invalid("INVALID_APPROVED_S70_BASELINE_REFERENCE_IDENTITY");
  }
  return valid(Object.freeze({
    source_case_version_id: value.source_case_version_id as CapaCaseVersionId,
    approved_action_plan_section_id:
      value.approved_action_plan_section_id as CapaSectionVersionId,
    approval_decision_reference: value.approval_decision_reference as AuditEventId,
  }));
}

function parseActionProgress(
  value: unknown,
  evidenceIds: Set<string>,
): CapaImplementationActionProgress | typeof INVALID | CapaImplementationValidationReasonCode {
  if (!record(value) || !exactFields(value, CAPA_IMPLEMENTATION_ACTION_PROGRESS_FIELDS)) {
    return "INVALID_IMPLEMENTATION_ACTION_PROGRESS_FIELDS";
  }
  if (!boundedText(value.approved_action_reference, MAX_REFERENCE_LENGTH)) {
    return "INVALID_APPROVED_ACTION_REFERENCE";
  }
  if (!oneOf(value.owner_reported_status, CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES)) {
    return "INVALID_OWNER_REPORTED_STATUS";
  }

  const narrative = nullableBoundedText(
    value.implementation_narrative,
    MAX_NARRATIVE_LENGTH,
  );
  if (narrative === INVALID) return "INVALID_IMPLEMENTATION_NARRATIVE";

  const blockedReason = nullableBoundedText(
    value.blocked_reason,
    MAX_NARRATIVE_LENGTH,
  );
  if (blockedReason === INVALID) return "INVALID_BLOCKED_REASON";

  const status = value.owner_reported_status as CapaImplementationOwnerReportedStatus;
  if (status === "blocked" && blockedReason === null) {
    return "BLOCKED_REASON_REQUIRED";
  }
  if (status !== "blocked" && blockedReason !== null) {
    return "INVALID_BLOCKED_REASON";
  }
  if (!Array.isArray(value.evidence)) {
    return "INVALID_IMPLEMENTATION_EVIDENCE_COLLECTION";
  }

  const evidence: CapaImplementationEvidence[] = [];
  for (const candidate of value.evidence) {
    const parsed = validateCapaImplementationEvidence(candidate);
    if (parsed.status !== "valid") {
      return parsed.reason_code;
    }
    if (parsed.value.approved_action_reference !== value.approved_action_reference) {
      return "INVALID_IMPLEMENTATION_EVIDENCE_ACTION_REFERENCE";
    }
    if (evidenceIds.has(parsed.value.evidence_id)) {
      return "DUPLICATE_IMPLEMENTATION_EVIDENCE_ID";
    }
    evidenceIds.add(parsed.value.evidence_id);
    evidence.push(parsed.value);
  }

  return Object.freeze({
    approved_action_reference: value.approved_action_reference,
    owner_reported_status: status,
    implementation_narrative: narrative,
    blocked_reason: blockedReason,
    evidence: Object.freeze(evidence),
  });
}

export function validateCapaImplementationWorkspaceDraft(
  value: unknown,
): CapaImplementationValidationResult<CapaImplementationWorkspaceDraft> {
  if (!record(value)) return invalid("INVALID_IMPLEMENTATION_WORKSPACE_OBJECT");
  if (!exactFields(value, CAPA_IMPLEMENTATION_WORKSPACE_FIELDS)) {
    return invalid("INVALID_IMPLEMENTATION_WORKSPACE_FIELDS");
  }
  if (value.schema_version !== CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION) {
    return invalid("INVALID_IMPLEMENTATION_WORKSPACE_SCHEMA_VERSION");
  }
  if (!Array.isArray(value.action_progress)) {
    return invalid("INVALID_IMPLEMENTATION_ACTION_PROGRESS_COLLECTION");
  }

  const progress: CapaImplementationActionProgress[] = [];
  const actionReferences = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const candidate of value.action_progress) {
    const parsed = parseActionProgress(candidate, evidenceIds);
    if (typeof parsed === "string") return invalid(parsed);
    if (parsed === INVALID) {
      return invalid("INVALID_IMPLEMENTATION_ACTION_PROGRESS_FIELDS");
    }
    if (actionReferences.has(parsed.approved_action_reference)) {
      return invalid("DUPLICATE_IMPLEMENTATION_ACTION_PROGRESS_REFERENCE");
    }
    actionReferences.add(parsed.approved_action_reference);
    progress.push(parsed);
  }

  let returnResponse: CapaImplementationReviewReturnResponseDraft | null;
  if (value.implementation_review_return_response === null) {
    returnResponse = null;
  } else {
    const parsed = validateCapaImplementationReviewReturnResponseDraft(
      value.implementation_review_return_response,
    );
    if (parsed.status !== "valid") {
      return invalid(
        "INVALID_IMPLEMENTATION_REVIEW_RETURN_RESPONSE",
        parsed.reason_code,
      );
    }
    returnResponse = parsed.value;
  }

  return valid(Object.freeze({
    schema_version: CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
    action_progress: Object.freeze(progress),
    implementation_review_return_response: returnResponse,
  }));
}

/**
 * Applies the authoritative S70 action-reference boundary after structural
 * parsing. The authoritative set is supplied by a future application layer;
 * this function performs no lookup and grants no workflow authority.
 */
export function validateCapaImplementationDraftAgainstApprovedActionSet(
  value: unknown,
  authoritativeApprovedActionReferences: readonly string[],
): CapaImplementationValidationResult<CapaImplementationWorkspaceDraft> {
  const draft = validateCapaImplementationWorkspaceDraft(value);
  if (draft.status !== "valid") return draft;
  if (
    !Array.isArray(authoritativeApprovedActionReferences) ||
    authoritativeApprovedActionReferences.some(
      (reference) => !boundedText(reference, MAX_REFERENCE_LENGTH),
    ) ||
    new Set(authoritativeApprovedActionReferences).size !==
      authoritativeApprovedActionReferences.length
  ) {
    return invalid("INVALID_AUTHORITATIVE_ACTION_REFERENCE_SET");
  }

  const authoritative = new Set(authoritativeApprovedActionReferences);
  for (const action of draft.value.action_progress) {
    if (!authoritative.has(action.approved_action_reference)) {
      return invalid("APPROVED_ACTION_REFERENCE_NOT_AUTHORITATIVE");
    }
    if (action.evidence.some((evidence) =>
      !authoritative.has(evidence.approved_action_reference),
    )) {
      return invalid("APPROVED_ACTION_REFERENCE_NOT_AUTHORITATIVE");
    }
  }

  return draft;
}

/** Alias emphasizing that this is a draft/domain boundary, not a workflow transition. */
export const validateCapaImplementationDraft =
  validateCapaImplementationWorkspaceDraft;

/**
 * Pure future-readiness calculation. It does not submit, transition, or
 * interpret reported_complete as S90 acceptance.
 */
export function evaluateCapaImplementationSubmissionReadiness(
  value: unknown,
  authoritativeApprovedActionReferences: readonly string[],
): CapaImplementationSubmissionReadinessResult {
  const validation = validateCapaImplementationDraftAgainstApprovedActionSet(
    value,
    authoritativeApprovedActionReferences,
  );
  if (validation.status !== "valid") {
    return Object.freeze({
      status: "not_ready",
      blocker_codes: Object.freeze(["INVALID_DRAFT" as const]),
    });
  }

  const progressByReference = new Map(
    validation.value.action_progress.map((action) =>
      [action.approved_action_reference, action] as const,
    ),
  );
  const blockers = new Set<CapaImplementationReadinessBlockerCode>();

  for (const reference of authoritativeApprovedActionReferences) {
    const action = progressByReference.get(reference);
    if (!action) {
      blockers.add("MISSING_APPROVED_ACTION_PROGRESS");
      continue;
    }
    if (action.owner_reported_status !== "reported_complete") {
      blockers.add("ACTION_NOT_REPORTED_COMPLETE");
    }
    if (action.implementation_narrative === null) {
      blockers.add("MISSING_IMPLEMENTATION_NARRATIVE");
    }
    if (action.evidence.length === 0) {
      blockers.add("MISSING_IMPLEMENTATION_EVIDENCE");
    }
  }

  const orderedBlockers: CapaImplementationReadinessBlockerCode[] =
    CAPA_IMPLEMENTATION_READINESS_BLOCKER_CODES.filter(
    (code) => blockers.has(code),
    );
  return orderedBlockers.length === 0
    ? Object.freeze({ status: "ready_for_s90_review" })
    : Object.freeze({
        status: "not_ready",
        blocker_codes: Object.freeze(orderedBlockers),
      });
}
