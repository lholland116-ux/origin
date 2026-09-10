import type { CapaActionPlanContent } from "../domain/capa-action-plan";
import type {
  CapaActionPlanReviewReturnResponseDraft,
} from "../domain/capa-action-plan-review-return-response";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../domain/capa-types";

export const CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION =
  "capa-action-plan-workspace-draft-1.0.0" as const;

/**
 * Durable S60 human workspace only. Persisting this snapshot does not make
 * the action plan authoritative CAPA content and does not advance workflow.
 */
export interface CapaActionPlanWorkspaceDraft {
  readonly schema_version:
    typeof CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION;
  readonly trust: "untrusted_human_draft";
  readonly workflow_state: "S60";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly draft_revision: number;
  readonly action_plan: CapaActionPlanContent;
  /** Null for first-entry S60 workspaces or before a return response is saved. */
  readonly action_plan_return_response?: CapaActionPlanReviewReturnResponseDraft | null;
  readonly updated_by_user_id: UserId;
  readonly updated_at: IsoDateTime;
}
