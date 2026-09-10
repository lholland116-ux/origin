import type {
  AuditEventId,
  CapaCaseVersionId,
  CapaSectionVersionId,
} from "../domain/capa-types";
import type {
  CapaImplementationEvidence,
} from "./capa-implementation-evidence-contract";
import type {
  CapaImplementationReviewReturnResponseDraft,
} from "./capa-implementation-return-response-contract";

export const CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION =
  "capa-implementation-workspace-draft-1.0.0" as const;

export const CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES = [
  "not_started",
  "in_progress",
  "reported_complete",
  "blocked",
] as const;

export type CapaImplementationOwnerReportedStatus =
  (typeof CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES)[number];

/**
 * Server-resolved identity of the approved S70 authority that S80 refers to.
 * The reference does not copy any mutable S70 action-plan fields.
 */
export interface CapaImplementationApprovedS70BaselineReference {
  readonly source_case_version_id: CapaCaseVersionId;
  readonly approved_action_plan_section_id: CapaSectionVersionId;
  readonly approval_decision_reference: AuditEventId;
}

export interface CapaImplementationActionProgress {
  /** Opaque reference to exactly one action in the approved S70 plan. */
  readonly approved_action_reference: string;
  readonly owner_reported_status:
    CapaImplementationOwnerReportedStatus;
  readonly implementation_narrative: string | null;
  readonly blocked_reason: string | null;
  readonly evidence: readonly CapaImplementationEvidence[];
}

/**
 * Mutable S80 workspace content. Approved S70 authority and server metadata
 * are deliberately represented by references outside this draft.
 */
export interface CapaImplementationWorkspaceDraft {
  readonly schema_version:
    typeof CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION;
  readonly action_progress: readonly CapaImplementationActionProgress[];
  readonly implementation_review_return_response:
    CapaImplementationReviewReturnResponseDraft | null;
}

export const CAPA_IMPLEMENTATION_WORKSPACE_FIELDS = [
  "schema_version",
  "action_progress",
  "implementation_review_return_response",
] as const;

export const CAPA_IMPLEMENTATION_ACTION_PROGRESS_FIELDS = [
  "approved_action_reference",
  "owner_reported_status",
  "implementation_narrative",
  "blocked_reason",
  "evidence",
] as const;
