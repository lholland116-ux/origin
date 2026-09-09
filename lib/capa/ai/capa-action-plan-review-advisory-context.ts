import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext, TenantRoleAssignment } from "../../security/tenant-context";
import type { CapaActionPlanContent } from "../domain/capa-action-plan";
import type { CapaEvidenceAssumptionLedgerContent } from "../domain/capa-evidence-assumption-ledger";
import type { CapaRootCausePackageContent } from "../domain/capa-root-cause-package";
import type { CapaCaseId, CapaCaseVersionId, CapaSectionVersionId, OrganizationId, UserId } from "../domain/capa-types";

export interface CapaActionPlanReviewAdvisorySectionSnapshot<Content> { readonly section_version_id: CapaSectionVersionId; readonly section_type: string; readonly section_version_number: number; readonly schema_version: string; readonly content: Content; }
export interface AuthoritativeS70ActionPlanReviewContext {
  readonly trust: "authoritative_server_context"; readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly case_version_id: CapaCaseVersionId; readonly record_version: number; readonly workflow_state: "S70"; readonly actor: UserId; readonly active_roles: readonly TenantRoleAssignment[];
  readonly case_version: Readonly<{ version_number: number; parent_version_id: CapaCaseVersionId | null; change_reason: string }>;
  readonly sections: Readonly<{ action_plan: CapaActionPlanReviewAdvisorySectionSnapshot<CapaActionPlanContent>; investigation_ledger: CapaActionPlanReviewAdvisorySectionSnapshot<CapaEvidenceAssumptionLedgerContent>; root_cause_package: CapaActionPlanReviewAdvisorySectionSnapshot<CapaRootCausePackageContent> }>;
}
export interface CapaActionPlanReviewAdvisoryReferenceManifestEntry { readonly reference_key: string; readonly trust: "authoritative_server_context"; readonly source_kind: "ledger_item" | "causal_hypothesis" | "action_item" | "effectiveness_check"; readonly source_id: string; readonly version_scope: "current"; }
export interface CapaActionPlanReviewAdvisoryModelSafeContext { readonly trust: "model_safe_context"; readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly workflow_state: "S70"; readonly source_case_version_id: CapaCaseVersionId; readonly action_plan_section_version_id: CapaSectionVersionId; readonly record_version: number; readonly root_cause_package: CapaRootCausePackageContent; readonly investigation_ledger: CapaEvidenceAssumptionLedgerContent; readonly action_plan: CapaActionPlanContent; readonly references: readonly Readonly<Record<string, unknown>>[]; }
export interface CapaActionPlanReviewAdvisoryContextAssembly { readonly authoritative: AuthoritativeS70ActionPlanReviewContext; readonly reference_manifest: readonly CapaActionPlanReviewAdvisoryReferenceManifestEntry[]; readonly model_safe_context: CapaActionPlanReviewAdvisoryModelSafeContext; }
export type CapaActionPlanReviewAdvisoryContextResolution = { readonly status: "resolved"; readonly assembly: CapaActionPlanReviewAdvisoryContextAssembly } | { readonly status: "not_found_or_not_authorized" } | { readonly status: "wrong_workflow_state" } | { readonly status: "invalid_authoritative_context" };
export type CapaActionPlanReviewAdvisoryAuthentication = AuthenticationContext;
export type CapaActionPlanReviewAdvisoryTenant = TenantContext;
