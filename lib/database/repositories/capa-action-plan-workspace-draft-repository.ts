import type { CapaActionPlanWorkspaceDraft } from "../../capa/application/capa-action-plan-workspace-draft-contract";
import type { CapaCaseId, CapaCaseStatus, CapaCaseVersionId, OrganizationId } from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";

export interface SaveCapaActionPlanWorkspaceDraftInput {
  readonly draft: CapaActionPlanWorkspaceDraft;
  readonly expected_draft_revision: number | null;
  readonly expected_case_version_id?: CapaCaseVersionId;
  readonly expected_record_version?: number;
  readonly expected_workflow_state?: CapaCaseStatus;
}

export type SaveCapaActionPlanWorkspaceDraftResult =
  | { readonly status: "saved"; readonly draft: CapaActionPlanWorkspaceDraft }
  | { readonly status: "concurrency_conflict" }
  | { readonly status: "case_changed" };

/** Storage for one current non-authoritative S60 workspace per CAPA case. */
export interface CapaActionPlanWorkspaceDraftRepository {
  findDraft(organizationId: OrganizationId, capaCaseId: CapaCaseId): Promise<CapaActionPlanWorkspaceDraft | null>;
  findDraftForUpdate(transaction: TransactionContext, organizationId: OrganizationId, capaCaseId: CapaCaseId): Promise<CapaActionPlanWorkspaceDraft | null>;
  saveDraft(transaction: TransactionContext, input: SaveCapaActionPlanWorkspaceDraftInput): Promise<SaveCapaActionPlanWorkspaceDraftResult>;
}
