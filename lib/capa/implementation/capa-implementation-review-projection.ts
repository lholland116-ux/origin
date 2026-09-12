import type { CapaAuthorizationOperation } from "../authorization/capa-permissions";
import type { CapaActionPlanContent } from "../domain/capa-action-plan";
import type { CapaImplementationReviewDecision } from "../domain/capa-implementation-review-decision";
import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../domain/capa-types";
import type {
  CapaImplementationActionProgress,
  CapaImplementationApprovedS70BaselineReference,
} from "./capa-implementation-contract";
import type {
  CapaImplementationReviewBaselineContent,
} from "./capa-implementation-review-baseline";
import type {
  CapaImplementationReviewReturnResponseContent,
} from "./capa-implementation-return-response-contract";
import type { TenantRoleAssignment } from "../../security/tenant-context";

export const CAPA_IMPLEMENTATION_REVIEW_PROJECTION_TRUST =
  "authoritative_server_projection" as const;

export interface CapaImplementationReviewSectionSnapshot<Content> {
  readonly section_version_id: CapaSectionVersionId;
  readonly section_type: string;
  readonly section_version_number: number;
  readonly schema_version: string;
  readonly content: Content;
}

export interface CapaImplementationReviewApprovedS70Authority {
  readonly reference: CapaImplementationApprovedS70BaselineReference;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly source_case_version: Readonly<{
    readonly version_number: number;
    readonly status: "S70";
    readonly parent_version_id: CapaCaseVersionId | null;
    readonly change_reason: string;
  }>;
  readonly action_plan_section: CapaImplementationReviewSectionSnapshot<CapaActionPlanContent>;
  readonly action_plan: CapaActionPlanContent;
  readonly approval_decision: Readonly<{
    readonly schema_version: string;
    readonly decision: "approve";
    readonly rationale: string;
    readonly reviewer_user_id: UserId;
    readonly decided_at: IsoDateTime;
    readonly resulting_case_version_id: CapaCaseVersionId;
    readonly transition_audit_event_id: AuditEventId;
  }>;
}

export interface CapaImplementationReviewSubmittedImplementation {
  readonly source_s80_case_version_id: CapaCaseVersionId;
  readonly source_s80_workspace_revision: number;
  readonly resulting_s90_case_version_id: CapaCaseVersionId;
  readonly submitted_by_user_id: UserId;
  readonly submitted_at: IsoDateTime;
  readonly action_progress: readonly CapaImplementationActionProgress[];
}

export interface CapaImplementationReviewHistoryEntry {
  readonly source_case_version_id: CapaCaseVersionId;
  readonly implementation_review_baseline_section_version_id: CapaSectionVersionId;
  readonly decision: CapaImplementationReviewDecision;
  readonly rationale: string;
  readonly reviewer_user_id: UserId;
  readonly decided_at: IsoDateTime;
  readonly resulting_case_version_id: CapaCaseVersionId;
  readonly transition_audit_event_id: AuditEventId;
  readonly return_response?: Readonly<{
    readonly section_version_id: CapaSectionVersionId;
    readonly content: CapaImplementationReviewReturnResponseContent;
  }>;
}

export interface CapaImplementationReviewAuthorizationState {
  readonly read: Readonly<{
    readonly operation: "view_case";
    readonly status: "allowed";
    readonly reason_code: string;
    readonly policy_version: string;
    readonly relied_on_role_assignment_ids: readonly string[];
  }>;
  readonly decision: Readonly<{
    readonly operation: "accept_implementation";
    readonly status: "allowed" | "step_up_required" | "denied";
    readonly reason_code: string;
    readonly policy_version: string;
    readonly required_assurance?: ControlledCode;
    readonly human_only: true;
    readonly step_up_required: true;
  }>;
}

export interface CapaImplementationReviewReviewerState {
  readonly user_id: UserId;
  readonly active_roles: readonly TenantRoleAssignment[];
  readonly authorization: CapaImplementationReviewAuthorizationState;
}

export interface CapaImplementationReviewProjection {
  readonly trust: typeof CAPA_IMPLEMENTATION_REVIEW_PROJECTION_TRUST;
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly record_version: number;
  readonly current_case_version_id: CapaCaseVersionId;
  readonly workflow_state: "S90";
  readonly case_version: Readonly<{
    readonly version_number: number;
    readonly parent_version_id: CapaCaseVersionId;
    readonly change_reason: string;
  }>;
  readonly implementation_review_baseline_section_version_id: CapaSectionVersionId;
  readonly implementation_review_baseline: CapaImplementationReviewSectionSnapshot<CapaImplementationReviewBaselineContent>;
  readonly approved_s70_baseline: CapaImplementationReviewApprovedS70Authority;
  readonly submitted_implementation: CapaImplementationReviewSubmittedImplementation;
  readonly reviewer: CapaImplementationReviewReviewerState;
  readonly prior_review_history: readonly CapaImplementationReviewHistoryEntry[];
}
