import type {
  CapaEvidenceAssumptionLedgerContent,
} from "../domain/capa-evidence-assumption-ledger";
import type {
  CapaRootCausePackageContent,
} from "../domain/capa-root-cause-package";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../domain/capa-types";

export const CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION =
  "capa-investigation-active-workspace-draft-1.0.0" as const;

/**
 * Durable S40 human workspace only. Persisting this snapshot does not make
 * either payload authoritative CAPA content or advance workflow state.
 */
export interface CapaInvestigationActiveWorkspaceDraft {
  readonly schema_version:
    typeof CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION;
  readonly trust: "untrusted_human_draft";
  readonly workflow_state: "S40";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly draft_revision: number;
  readonly evidence_assumption_ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
  readonly updated_by_user_id: UserId;
  readonly updated_at: IsoDateTime;
}
