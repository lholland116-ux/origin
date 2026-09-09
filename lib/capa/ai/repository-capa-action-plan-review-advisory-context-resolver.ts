import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { AuthenticationContext } from "../../security/auth-context";
import { getActiveRoleAssignments, type TenantContext } from "../../security/tenant-context";
import { CAPA_ACTION_PLAN_SCHEMA_VERSION, CAPA_ACTION_PLAN_SECTION_TYPE, validateCapaActionPlan } from "../domain/capa-action-plan";
import { CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION, CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE, validateCapaEvidenceAssumptionLedger } from "../domain/capa-evidence-assumption-ledger";
import { CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION, CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE, validateCapaRootCausePackage } from "../domain/capa-root-cause-package";
import type { CapaSectionVersion } from "../domain/capa-types";
import type { AuthoritativeS70ActionPlanReviewContext, CapaActionPlanReviewAdvisoryContextAssembly, CapaActionPlanReviewAdvisoryContextResolution, CapaActionPlanReviewAdvisoryModelSafeContext, CapaActionPlanReviewAdvisoryReferenceManifestEntry } from "./capa-action-plan-review-advisory-context";

function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; }
function snapshot<T>(section: CapaSectionVersion, content: T) { return freeze({ section_version_id: section.section_version_id, section_type: section.section_type, section_version_number: section.version_number, schema_version: section.schema_version, content }); }
function exactIds(ids: readonly string[]) { return Array.isArray(ids) && new Set(ids).size === ids.length; }
export interface RepositoryCapaActionPlanReviewAdvisoryContextResolverDependencies { readonly repository: CapaRepository; readonly authentication: AuthenticationContext; readonly tenant: TenantContext; readonly now: () => Date; }

export class RepositoryCapaActionPlanReviewAdvisoryContextResolver {
  constructor(private readonly dependencies: RepositoryCapaActionPlanReviewAdvisoryContextResolverDependencies) {}
  async resolve(input: { readonly organization_id: string; readonly capa_case_id: string }): Promise<CapaActionPlanReviewAdvisoryContextResolution> {
    const principal = this.dependencies.authentication.principal;
    if (principal.principal_type !== "human" || input.organization_id !== this.dependencies.tenant.organization_id) return { status: "not_found_or_not_authorized" };
    const roles = getActiveRoleAssignments(this.dependencies.tenant, this.dependencies.now());
    if (roles.length === 0) return { status: "not_found_or_not_authorized" };
    try {
      const capaCase = await this.dependencies.repository.findCaseById(input.organization_id as never, input.capa_case_id as never);
      if (capaCase === null || capaCase.status !== "S70") return capaCase === null ? { status: "not_found_or_not_authorized" } : { status: "wrong_workflow_state" };
      const version = await this.dependencies.repository.findCaseVersionById(input.organization_id as never, input.capa_case_id as never, capaCase.current_version_id);
      if (version === null || version.status !== "S70" || version.organization_id !== input.organization_id || version.capa_case_id !== input.capa_case_id || version.case_version_id !== capaCase.current_version_id || version.version_number !== capaCase.record_version || !Number.isSafeInteger(version.version_number) || !exactIds(version.section_version_ids)) return { status: "invalid_authoritative_context" };
      const loaded = await Promise.all(version.section_version_ids.map((id) => this.dependencies.repository.findSectionVersionById(input.organization_id as never, input.capa_case_id as never, id as never)));
      if (loaded.some((section, index) => section === null || section.section_version_id !== version.section_version_ids[index] || section.organization_id !== input.organization_id || section.capa_case_id !== input.capa_case_id)) return { status: "invalid_authoritative_context" };
      const sections = loaded as CapaSectionVersion[];
      const actionSections = sections.filter((section) => section.section_type === CAPA_ACTION_PLAN_SECTION_TYPE);
      const ledgerSections = sections.filter((section) => section.section_type === CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE);
      const rootSections = sections.filter((section) => section.section_type === CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE);
      if (actionSections.length !== 1 || ledgerSections.length !== 1 || rootSections.length !== 1 || actionSections[0]!.schema_version !== CAPA_ACTION_PLAN_SCHEMA_VERSION || ledgerSections[0]!.schema_version !== CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION || rootSections[0]!.schema_version !== CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION) return { status: "invalid_authoritative_context" };
      const action = validateCapaActionPlan(actionSections[0]!.content); const ledger = validateCapaEvidenceAssumptionLedger(ledgerSections[0]!.content); if (action.status !== "valid" || ledger.status !== "valid") return { status: "invalid_authoritative_context" };
      const root = validateCapaRootCausePackage(rootSections[0]!.content, ledger.value); if (root.status !== "valid") return { status: "invalid_authoritative_context" };
      const authoritative: AuthoritativeS70ActionPlanReviewContext = freeze({ trust: "authoritative_server_context", organization_id: capaCase.organization_id, capa_case_id: capaCase.capa_case_id, case_version_id: version.case_version_id, record_version: version.version_number, workflow_state: "S70", actor: principal.user_id, active_roles: Object.freeze(roles.map((role) => Object.freeze({ ...role }))), case_version: { version_number: version.version_number, parent_version_id: version.parent_version_id ?? null, change_reason: version.change_reason }, sections: { action_plan: snapshot(actionSections[0]!, action.value), investigation_ledger: snapshot(ledgerSections[0]!, ledger.value), root_cause_package: snapshot(rootSections[0]!, root.value) } });
      const manifest: CapaActionPlanReviewAdvisoryReferenceManifestEntry[] = []; const references: Readonly<Record<string, unknown>>[] = []; let n = 1;
      const add = (source_kind: CapaActionPlanReviewAdvisoryReferenceManifestEntry["source_kind"], source_id: string, value: Record<string, unknown>) => { const key = `R${n++}`; manifest.push({ reference_key: key, trust: "authoritative_server_context", source_kind, source_id, version_scope: "current" }); references.push({ reference_key: key, trust: "authoritative_server_context", ...value }); };
      for (const item of ledger.value.items) add("ledger_item", item.item_id, { source_kind: "ledger_item", statement: item.statement, evidence_status: item.evidence_status, information_class: item.information_class });
      for (const hypothesis of root.value.hypotheses) add("causal_hypothesis", hypothesis.hypothesis_id, { source_kind: "causal_hypothesis", statement: hypothesis.statement, causal_role: hypothesis.causal_role, rationale: hypothesis.rationale });
      for (const item of action.value.items) add("action_item", item.item_id, { source_kind: "action_item", description: item.description, action_type: item.action_type, owner_user_id: item.owner_user_id, due_date: item.due_date, deliverable: item.deliverable, dependency_item_ids: item.dependency_item_ids, effectiveness_check_required: item.effectiveness_check_required });
      for (const check of action.value.effectiveness_checks) add("effectiveness_check", check.check_id, { source_kind: "effectiveness_check", action_item_ids: check.action_item_ids, acceptance_criteria: check.acceptance_criteria, evaluation_method: check.evaluation_method, timing: check.timing });
      const model_safe_context: CapaActionPlanReviewAdvisoryModelSafeContext = freeze({ trust: "model_safe_context", organization_id: capaCase.organization_id, capa_case_id: capaCase.capa_case_id, workflow_state: "S70", source_case_version_id: version.case_version_id, action_plan_section_version_id: actionSections[0]!.section_version_id, record_version: version.version_number, root_cause_package: root.value, investigation_ledger: ledger.value, action_plan: action.value, references: Object.freeze(references) });
      return { status: "resolved", assembly: freeze({ authoritative, reference_manifest: Object.freeze(manifest), model_safe_context }) };
    } catch { return { status: "invalid_authoritative_context" }; }
  }
  async assertCaseUnchanged(context: AuthoritativeS70ActionPlanReviewContext): Promise<boolean> { try { const current = await this.dependencies.repository.findCaseById(context.organization_id, context.capa_case_id); return current !== null && current.status === "S70" && current.current_version_id === context.case_version_id && current.record_version === context.record_version; } catch { return false; } }
}
