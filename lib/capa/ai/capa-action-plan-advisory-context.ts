import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext, TenantRoleAssignment } from "../../security/tenant-context";
import type { CapaEvidenceAssumptionLedgerContent } from "../domain/capa-evidence-assumption-ledger";
import type { CapaRootCausePackageContent } from "../domain/capa-root-cause-package";
import type { CapaActionPlanContent } from "../domain/capa-action-plan";
import type { CapaCaseId, CapaCaseVersionId, CapaSectionVersionId, OrganizationId, UserId } from "../domain/capa-types";

export interface CapaActionPlanAdvisorySectionSnapshot<Content> { readonly section_version_id: CapaSectionVersionId; readonly section_type: string; readonly section_version_number: number; readonly schema_version: string; readonly content: Content; }
export interface AuthoritativeS60ActionPlanContext {
  readonly trust: "authoritative_server_context";
  readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly case_version_id: CapaCaseVersionId; readonly record_version: number; readonly workflow_state: "S60"; readonly actor: UserId; readonly active_roles: readonly TenantRoleAssignment[];
  readonly case_version: Readonly<{ version_number: number; parent_version_id: CapaCaseVersionId | null; change_reason: string }>;
  readonly sections: Readonly<{ investigation_ledger: CapaActionPlanAdvisorySectionSnapshot<CapaEvidenceAssumptionLedgerContent>; root_cause_package: CapaActionPlanAdvisorySectionSnapshot<CapaRootCausePackageContent> }>;
  readonly workspace: Readonly<{ readonly trust: "untrusted_human_draft"; readonly draft_revision: number; readonly action_plan: CapaActionPlanContent } | null>;
}
export interface CapaActionPlanAdvisoryReferenceManifestEntry { readonly reference_key: string; readonly trust: "authoritative_server_context"; readonly source_kind: "ledger_item" | "causal_hypothesis"; readonly source_id: string; readonly version_scope: "current"; }
export interface CapaActionPlanAdvisoryModelSafeContext { readonly trust: "model_safe_context"; readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly workflow_state: "S60"; readonly case_version_id: CapaCaseVersionId; readonly record_version: number; readonly current_version_number: number; readonly current_section_versions: Readonly<{ investigation_ledger: string; root_cause_package: string }>; readonly root_cause_package: CapaRootCausePackageContent; readonly investigation_ledger: CapaEvidenceAssumptionLedgerContent; readonly untrusted_human_draft: CapaActionPlanContent | null; readonly workspace_revision: number | null; readonly deterministic_readiness: unknown; readonly references: readonly Readonly<Record<string, unknown>>[]; }
export interface CapaActionPlanAdvisoryContextAssembly { readonly authoritative: AuthoritativeS60ActionPlanContext; readonly reference_manifest: readonly CapaActionPlanAdvisoryReferenceManifestEntry[]; readonly model_safe_context: CapaActionPlanAdvisoryModelSafeContext; }
export type CapaActionPlanAdvisoryContextResolution = { readonly status: "resolved"; readonly assembly: CapaActionPlanAdvisoryContextAssembly } | { readonly status: "not_found_or_not_authorized" } | { readonly status: "wrong_workflow_state" } | { readonly status: "invalid_authoritative_context" };
export type CapaActionPlanAdvisoryAuthentication = AuthenticationContext;
export type CapaActionPlanAdvisoryTenant = TenantContext;
