import type {
  CapaInvestigationActiveWorkspaceDraft,
} from "../../capa/application/capa-investigation-active-workspace-draft-contract";
import type {
  CapaCaseId,
  OrganizationId,
} from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";

export interface SaveCapaInvestigationActiveWorkspaceDraftInput {
  readonly draft: CapaInvestigationActiveWorkspaceDraft;
  /** null creates revision 1; an integer updates that exact current revision. */
  readonly expected_draft_revision: number | null;
}

export type SaveCapaInvestigationActiveWorkspaceDraftResult =
  | { readonly status: "saved"; readonly draft: CapaInvestigationActiveWorkspaceDraft }
  | { readonly status: "concurrency_conflict" };

/**
 * Storage boundary for one current, non-authoritative S40 workspace per case.
 * It has no CAPA workflow, authoritative-section, or AI-adoption authority.
 */
export interface CapaInvestigationActiveWorkspaceDraftRepository {
  findDraft(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaInvestigationActiveWorkspaceDraft | null>;

  saveDraft(
    transaction: TransactionContext,
    input: SaveCapaInvestigationActiveWorkspaceDraftInput,
  ): Promise<SaveCapaInvestigationActiveWorkspaceDraftResult>;
}
