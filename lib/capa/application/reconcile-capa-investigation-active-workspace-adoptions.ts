import type { CapaCaseId, RequestTrace } from "../domain/capa-types";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { CapaInvestigationActiveAdoptionRepository } from "../../database/repositories/capa-investigation-active-adoption-repository";
import { materializeCapaInvestigationActiveAdoptions } from "./capa-investigation-active-adoption-workspace-materializer";
import {
  createCapaInvestigationActiveWorkspaceDraftService,
  type CapaInvestigationActiveWorkspaceDraftService,
  type CapaInvestigationActiveWorkspaceDraftServiceResult,
} from "./capa-investigation-active-workspace-draft-service";
import type { CapaInvestigationActiveWorkspaceDraftRepository } from "../../database/repositories/capa-investigation-active-workspace-draft-repository";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { TransactionManager } from "../../database/transactions";

export type ReconcileCapaInvestigationActiveWorkspaceAdoptionsResult =
  | { readonly status: "reconciled"; readonly workspace: import("./capa-investigation-active-workspace-draft-contract").CapaInvestigationActiveWorkspaceDraft | null }
  | { readonly status: "not_found" }
  | { readonly status: "workflow_conflict" }
  | { readonly status: "authorization_denied" }
  | { readonly status: "case_changed" }
  | { readonly status: "concurrency_conflict" }
  | { readonly status: "legacy_causal_role_not_recorded" }
  | { readonly status: "failed" };

export interface ReconcileCapaInvestigationActiveWorkspaceAdoptionsDependencies {
  readonly request_context: CapaRequestContext;
  readonly capa_repository: CapaRepository;
  readonly adoption_repository: CapaInvestigationActiveAdoptionRepository;
  readonly workspace_repository: CapaInvestigationActiveWorkspaceDraftRepository;
  readonly transaction_manager: TransactionManager;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
}

function mapLoaded(result: CapaInvestigationActiveWorkspaceDraftServiceResult): ReconcileCapaInvestigationActiveWorkspaceAdoptionsResult | null {
  if (result.status === "loaded") return null;
  if (result.status === "not_found") return { status: "not_found" };
  if (result.status === "workflow_conflict") return { status: "workflow_conflict" };
  if (result.status === "authorization_denied") return { status: "authorization_denied" };
  return { status: "failed" };
}

export function createReconcileCapaInvestigationActiveWorkspaceAdoptionsService(
  dependencies: ReconcileCapaInvestigationActiveWorkspaceAdoptionsDependencies,
) {
  const workspaceService: CapaInvestigationActiveWorkspaceDraftService = createCapaInvestigationActiveWorkspaceDraftService({
    request_context: dependencies.request_context,
    capa_repository: dependencies.capa_repository,
    workspace_repository: dependencies.workspace_repository,
    transaction_manager: dependencies.transaction_manager,
    authorization_policy: dependencies.authorization_policy,
    now: dependencies.now,
  });
  return {
    async reconcile(input: { readonly capa_case_id: CapaCaseId; readonly request_trace: RequestTrace }): Promise<ReconcileCapaInvestigationActiveWorkspaceAdoptionsResult> {
      const loaded = await workspaceService.load({ capa_case_id: input.capa_case_id });
      const loadFailure = mapLoaded(loaded);
      if (loadFailure !== null) return loadFailure;
      if (loaded.status !== "loaded") return { status: "failed" };
      const adoptions = await dependencies.adoption_repository.listAdoptionsForCase(dependencies.request_context.tenant.organization_id, input.capa_case_id);
      if (adoptions.length === 0) return { status: "reconciled", workspace: loaded.workspace };
      if (adoptions.some((record) => record.adoption.proposal_category === "causal_hypothesis" && record.adoption.adopted_item.human_causal_role === undefined)) return { status: "legacy_causal_role_not_recorded" };
      let materialized;
      try {
        materialized = materializeCapaInvestigationActiveAdoptions({ ledger: loaded.workspace?.evidence_assumption_ledger ?? { items: [] }, root_cause_package: loaded.workspace?.root_cause_package ?? { hypotheses: [], root_cause_not_confirmed: null }, adoptions });
      } catch { return { status: "failed" }; }
      if (!materialized.changed) return { status: "reconciled", workspace: loaded.workspace };
      const saved = await workspaceService.save({ capa_case_id: input.capa_case_id, request_trace: input.request_trace, body: { expected_draft_revision: loaded.workspace?.draft_revision ?? null, evidence_assumption_ledger: materialized.ledger, root_cause_package: materialized.root_cause_package } });
      if (saved.status === "saved") return { status: "reconciled", workspace: saved.workspace };
      if (saved.status === "case_changed") return { status: "case_changed" };
      if (saved.status === "concurrency_conflict") return { status: "concurrency_conflict" };
      if (saved.status === "authorization_denied") return { status: "authorization_denied" };
      if (saved.status === "workflow_conflict") return { status: "workflow_conflict" };
      if (saved.status === "not_found") return { status: "not_found" };
      return { status: "failed" };
    },
  };
}
