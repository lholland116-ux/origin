import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { CapaActionPlanWorkspaceDraftRepository } from "../../database/repositories/capa-action-plan-workspace-draft-repository";
import type { AuthenticationContext } from "../../security/auth-context";
import { getActiveRoleAssignments, type TenantContext } from "../../security/tenant-context";
import { CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION, CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE, validateCapaEvidenceAssumptionLedger } from "../domain/capa-evidence-assumption-ledger";
import { CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION, CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE, validateCapaRootCausePackage } from "../domain/capa-root-cause-package";
import { evaluateCapaActionPlanReadiness } from "../domain/capa-action-plan";
import type { CapaSectionVersion } from "../domain/capa-types";
import type { CapaActionPlanWorkspaceDraft } from "../application/capa-action-plan-workspace-draft-contract";
import type { AuthoritativeS60ActionPlanContext, CapaActionPlanAdvisoryContextAssembly, CapaActionPlanAdvisoryContextResolution, CapaActionPlanAdvisoryModelSafeContext } from "./capa-action-plan-advisory-context";

function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; }
function section<T>(value: CapaSectionVersion, content: T) { return freeze({ section_version_id: value.section_version_id, section_type: value.section_type, section_version_number: value.version_number, schema_version: value.schema_version, content }); }
function exactIds(ids: readonly string[]): boolean { return Array.isArray(ids) && new Set(ids).size === ids.length; }

export interface RepositoryCapaActionPlanAdvisoryContextResolverDependencies { readonly repository: CapaRepository; readonly workspace_repository: CapaActionPlanWorkspaceDraftRepository; readonly authentication: AuthenticationContext; readonly tenant: TenantContext; readonly now: () => Date; }

export class RepositoryCapaActionPlanAdvisoryContextResolver {
  constructor(private readonly dependencies: RepositoryCapaActionPlanAdvisoryContextResolverDependencies) {}
  async resolve(input: { readonly organization_id: string; readonly capa_case_id: string }): Promise<CapaActionPlanAdvisoryContextResolution> {
    const principal = this.dependencies.authentication.principal;
    if (principal.principal_type !== "human" || input.organization_id !== this.dependencies.tenant.organization_id) return { status: "not_found_or_not_authorized" };
    const now = this.dependencies.now();
    if (!Number.isFinite(now.getTime())) return { status: "invalid_authoritative_context" };
    const roles = getActiveRoleAssignments(this.dependencies.tenant, now);
    if (roles.length === 0) return { status: "not_found_or_not_authorized" };
    try {
      const capaCase = await this.dependencies.repository.findCaseById(input.organization_id as never, input.capa_case_id as never);
      if (capaCase === null || capaCase.organization_id !== input.organization_id || capaCase.capa_case_id !== input.capa_case_id) return { status: "not_found_or_not_authorized" };
      if (capaCase.status !== "S60") return { status: "wrong_workflow_state" };
      const version = await this.dependencies.repository.findCaseVersionById(input.organization_id as never, input.capa_case_id as never, capaCase.current_version_id);
      if (version === null || version.organization_id !== input.organization_id || version.capa_case_id !== input.capa_case_id || version.case_version_id !== capaCase.current_version_id || version.status !== "S60" || version.version_number !== capaCase.record_version || !Number.isSafeInteger(version.version_number) || !exactIds(version.section_version_ids)) return { status: "invalid_authoritative_context" };
      const sections = await Promise.all(version.section_version_ids.map((id) => this.dependencies.repository.findSectionVersionById(input.organization_id as never, input.capa_case_id as never, id as never)));
      if (sections.some((candidate, index) => candidate === null || candidate.section_version_id !== version.section_version_ids[index] || candidate.organization_id !== input.organization_id || candidate.capa_case_id !== input.capa_case_id)) return { status: "invalid_authoritative_context" };
      const available = sections as CapaSectionVersion[];
      const ledgers = available.filter((candidate) => candidate.section_type === CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE);
      const roots = available.filter((candidate) => candidate.section_type === CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE);
      if (ledgers.length !== 1 || roots.length !== 1 || ledgers[0]!.schema_version !== CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION || roots[0]!.schema_version !== CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION) return { status: "invalid_authoritative_context" };
      const ledger = validateCapaEvidenceAssumptionLedger(ledgers[0]!.content);
      if (ledger.status !== "valid") return { status: "invalid_authoritative_context" };
      const root = validateCapaRootCausePackage(roots[0]!.content, ledger.value);
      if (root.status !== "valid") return { status: "invalid_authoritative_context" };
      const workspace = await this.dependencies.workspace_repository.findDraft(input.organization_id as never, input.capa_case_id as never);
      if (workspace !== null && (workspace.organization_id !== input.organization_id || workspace.capa_case_id !== input.capa_case_id || workspace.case_version_id !== version.case_version_id || workspace.record_version !== version.version_number || workspace.workflow_state !== "S60")) return { status: "invalid_authoritative_context" };
      const authoritative: AuthoritativeS60ActionPlanContext = freeze({ trust: "authoritative_server_context", organization_id: capaCase.organization_id, capa_case_id: capaCase.capa_case_id, case_version_id: version.case_version_id, record_version: version.version_number, workflow_state: "S60", actor: principal.user_id, active_roles: Object.freeze(roles.map((role) => Object.freeze({ ...role }))), case_version: { version_number: version.version_number, parent_version_id: version.parent_version_id ?? null, change_reason: version.change_reason }, sections: { investigation_ledger: section(ledgers[0]!, ledger.value), root_cause_package: section(roots[0]!, root.value) }, workspace: workspace === null ? null : { trust: "untrusted_human_draft", draft_revision: workspace.draft_revision, action_plan: workspace.action_plan } });
      const manifest: { reference_key: string; trust: "authoritative_server_context"; source_kind: "ledger_item" | "causal_hypothesis"; source_id: string; version_scope: "current" }[] = [];
      const references: Readonly<Record<string, unknown>>[] = [];
      let index = 1;
      for (const item of ledger.value.items) { const key = `R${index++}`; manifest.push({ reference_key: key, trust: "authoritative_server_context", source_kind: "ledger_item", source_id: item.item_id, version_scope: "current" }); references.push({ reference_key: key, trust: "authoritative_server_context", source_kind: "ledger_item", version_scope: "current", statement: item.statement, evidence_status: item.evidence_status, gap_status: item.gap_status, conflict_status: item.conflict_status, material_to_conclusion: item.material_to_conclusion, critical_to_conclusion: item.critical_to_conclusion }); }
      for (const hypothesis of root.value.hypotheses) { const key = `R${index++}`; manifest.push({ reference_key: key, trust: "authoritative_server_context", source_kind: "causal_hypothesis", source_id: hypothesis.hypothesis_id, version_scope: "current" }); references.push({ reference_key: key, trust: "authoritative_server_context", source_kind: "causal_hypothesis", version_scope: "current", statement: hypothesis.statement, status: hypothesis.status, causal_role: hypothesis.causal_role, rationale: hypothesis.rationale, linked_evidence_item_ids: hypothesis.supporting_evidence_item_ids }); }
      const model_safe_context: CapaActionPlanAdvisoryModelSafeContext = freeze({ trust: "model_safe_context", organization_id: capaCase.organization_id, capa_case_id: capaCase.capa_case_id, workflow_state: "S60", case_version_id: version.case_version_id, record_version: version.version_number, current_version_number: version.version_number, current_section_versions: { investigation_ledger: ledgers[0]!.schema_version, root_cause_package: roots[0]!.schema_version }, root_cause_package: root.value, investigation_ledger: ledger.value, untrusted_human_draft: workspace?.action_plan ?? null, workspace_revision: workspace?.draft_revision ?? null, deterministic_readiness: evaluateCapaActionPlanReadiness(workspace?.action_plan ?? { items: [], effectiveness_checks: [] }), references: Object.freeze(references) });
      return { status: "resolved", assembly: freeze({ authoritative, reference_manifest: Object.freeze(manifest), model_safe_context }) };
    } catch { return { status: "invalid_authoritative_context" }; }
  }
  async assertCaseUnchanged(context: AuthoritativeS60ActionPlanContext): Promise<boolean> { try { const current = await this.dependencies.repository.findCaseById(context.organization_id, context.capa_case_id); if (current === null || current.current_version_id !== context.case_version_id || current.record_version !== context.record_version || current.status !== "S60") return false; const version = await this.dependencies.repository.findCaseVersionById(context.organization_id, context.capa_case_id, context.case_version_id); return version !== null && version.version_number === context.record_version && version.status === "S60"; } catch { return false; } }
}
