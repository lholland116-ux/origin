import type {
  AuditEventId,
  CapaCaseVersionId,
} from "../domain/capa-types";

export const CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION =
  "capa-implementation-review-return-response-draft-1.0.0" as const;

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
  extends CapaImplementationReviewReturnResponseCycleBinding {
  readonly schema_version:
    typeof CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION;
  readonly response_narrative: string;
}

export const CAPA_IMPLEMENTATION_RETURN_RESPONSE_FIELDS = [
  "schema_version",
  "return_transition_audit_event_id",
  "source_case_version_id",
  "resulting_case_version_id",
  "response_narrative",
] as const;
