import type { AuthenticationContext } from "../../security/auth-context";
import { getActiveRoleAssignments, type TenantContext, type TenantRoleAssignment } from "../../security/tenant-context";
import type { CapaCaseId, CapaCaseVersionId, CorrelationId, OrganizationId, RequestId, UserId } from "../domain/capa-types";
import type { CapaImplementationEvidenceAdvisoryCitation } from "./capa-implementation-evidence-advisory-contract";
import type { CapaImplementationWorkspaceProjection, CapaImplementationWorkspaceService } from "../application/capa-implementation-workspace-service";

export interface CapaImplementationEvidenceAdvisoryKnowledgeResult {
  readonly references: readonly Readonly<Record<string, unknown>>[];
  readonly citations: readonly CapaImplementationEvidenceAdvisoryCitation[];
  readonly warnings: readonly string[];
  readonly retrieval_provenance: Readonly<Record<string, unknown>> | null;
}

export interface CapaImplementationEvidenceAdvisoryKnowledgeProvider {
  retrieve(input: {
    readonly organization_id: OrganizationId;
    readonly capa_case_id: CapaCaseId;
    readonly case_version_id: CapaCaseVersionId;
    readonly user_id: UserId;
    readonly active_roles: readonly TenantRoleAssignment[];
    readonly request_id: RequestId;
    readonly correlation_id: CorrelationId;
    readonly workspace: CapaImplementationWorkspaceProjection;
  }): Promise<CapaImplementationEvidenceAdvisoryKnowledgeResult>;
}

export interface AuthoritativeS80ImplementationEvidenceContext {
  readonly trust: "authoritative_server_context";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: "S80";
  readonly actor: UserId;
  readonly active_roles: readonly TenantRoleAssignment[];
  readonly approved_s70_baseline: CapaImplementationWorkspaceProjection["approved_s70_baseline"];
  readonly approved_actions: CapaImplementationWorkspaceProjection["approved_actions"];
  readonly workspace: CapaImplementationWorkspaceProjection["draft"];
}

export interface CapaImplementationEvidenceAdvisoryReferenceManifestEntry {
  readonly reference_key: string;
  readonly source_kind: "approved_action" | "implementation_evidence" | "governed_knowledge";
  readonly source_reference: string;
  readonly source_status: "authoritative" | "untrusted_human_draft" | "governed_current_effective";
  readonly locator: string | null;
}

export interface CapaImplementationEvidenceAdvisoryModelSafeContext {
  readonly trust: "model_safe_context";
  readonly workflow_state: "S80";
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly approved_s70_baseline: Readonly<{
    source_case_version_id: string;
    approved_action_plan_section_id: string;
    approval_decision_reference: string;
  }>;
  readonly approved_actions: readonly Readonly<Record<string, unknown>>[];
  readonly untrusted_human_workspace: unknown;
  readonly references: readonly Readonly<Record<string, unknown>>[];
  readonly governed_knowledge: readonly Readonly<Record<string, unknown>>[];
}

export interface CapaImplementationEvidenceAdvisoryContextAssembly {
  readonly authoritative: AuthoritativeS80ImplementationEvidenceContext;
  readonly reference_manifest: readonly CapaImplementationEvidenceAdvisoryReferenceManifestEntry[];
  readonly model_safe_context: CapaImplementationEvidenceAdvisoryModelSafeContext;
  readonly citations: readonly CapaImplementationEvidenceAdvisoryCitation[];
  readonly knowledge_provenance: Readonly<Record<string, unknown>> | null;
  readonly knowledge_warnings: readonly string[];
}

export type CapaImplementationEvidenceAdvisoryContextResolution =
  | { readonly status: "resolved"; readonly assembly: CapaImplementationEvidenceAdvisoryContextAssembly }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "wrong_workflow_state" }
  | { readonly status: "workspace_not_found" }
  | { readonly status: "baseline_unavailable" }
  | { readonly status: "knowledge_unavailable" }
  | { readonly status: "invalid_authoritative_context" };

export type CapaImplementationEvidenceAdvisoryAuthentication = AuthenticationContext;
export type CapaImplementationEvidenceAdvisoryTenant = TenantContext;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function refCitation(entry: CapaImplementationEvidenceAdvisoryReferenceManifestEntry): CapaImplementationEvidenceAdvisoryCitation {
  return Object.freeze({ reference_key: entry.reference_key, source_kind: entry.source_kind, source_reference: entry.source_reference, source_status: entry.source_status, locator: entry.locator });
}

export interface RepositoryCapaImplementationEvidenceAdvisoryContextResolverDependencies {
  readonly workspace_service: CapaImplementationWorkspaceService;
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly now: () => Date;
  readonly knowledge_provider?: CapaImplementationEvidenceAdvisoryKnowledgeProvider;
}

export class RepositoryCapaImplementationEvidenceAdvisoryContextResolver {
  constructor(private readonly dependencies: RepositoryCapaImplementationEvidenceAdvisoryContextResolverDependencies) {}

  async resolve(input: { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly user_id: UserId; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<CapaImplementationEvidenceAdvisoryContextResolution> {
    if (input.organization_id !== this.dependencies.tenant.organization_id || this.dependencies.authentication.principal.principal_type !== "human" || this.dependencies.authentication.principal.user_id !== input.user_id) return { status: "not_found_or_not_authorized" };
    const now = this.dependencies.now();
    if (!Number.isFinite(now.getTime())) return { status: "invalid_authoritative_context" };
    let result: Awaited<ReturnType<CapaImplementationWorkspaceService["load"]>>;
    try { result = await this.dependencies.workspace_service.load({ capa_case_id: input.capa_case_id }); } catch { return { status: "invalid_authoritative_context" }; }
    if (result.status === "not_found" || result.status === "authorization_denied") return { status: "not_found_or_not_authorized" };
    if (result.status === "workflow_conflict") return { status: "wrong_workflow_state" };
    if (result.status === "baseline_unavailable") return { status: "baseline_unavailable" };
    if (result.status !== "loaded") return { status: "invalid_authoritative_context" };
    const workspace = result.workspace;
    if (workspace.record_version < 1) return { status: "invalid_authoritative_context" };
    const activeRoles = getActiveRoleAssignments(this.dependencies.tenant, now).map((assignment) => Object.freeze({ ...assignment }));
    if (activeRoles.length === 0) return { status: "not_found_or_not_authorized" };
    const authoritative: AuthoritativeS80ImplementationEvidenceContext = freeze({ trust: "authoritative_server_context", organization_id: input.organization_id, capa_case_id: input.capa_case_id, case_version_id: workspace.case_version_id, record_version: workspace.record_version, workflow_state: "S80", actor: input.user_id, active_roles: Object.freeze(activeRoles), approved_s70_baseline: workspace.approved_s70_baseline, approved_actions: workspace.approved_actions, workspace: workspace.draft });
    const manifest: CapaImplementationEvidenceAdvisoryReferenceManifestEntry[] = [];
    const safeReferences: Readonly<Record<string, unknown>>[] = [];
    let index = 1;
    for (const action of workspace.approved_actions) {
      const key = `R${index++}`;
      manifest.push({ reference_key: key, source_kind: "approved_action", source_reference: action.approved_action_reference, source_status: "authoritative", locator: null });
      safeReferences.push({ reference_key: key, source_kind: "approved_action", source_status: "authoritative", approved_action_reference: action.approved_action_reference, description: action.description, deliverable: action.deliverable, implementation_expectation: action.implementation_expectation, acceptance_criteria: action.acceptance_criteria });
    }
    for (const progress of workspace.draft?.action_progress ?? []) {
      for (const evidence of progress.evidence) {
        const key = `R${index++}`;
        manifest.push({ reference_key: key, source_kind: "implementation_evidence", source_reference: evidence.evidence_id, source_status: "untrusted_human_draft", locator: evidence.source.source_record_reference });
        safeReferences.push({ reference_key: key, source_kind: "implementation_evidence", source_status: "untrusted_human_draft", evidence_id: evidence.evidence_id, approved_action_reference: evidence.approved_action_reference, evidence_kind: evidence.evidence_kind, description: evidence.description, evidence_date: evidence.evidence_date, source: evidence.source });
      }
    }
    let knowledge: CapaImplementationEvidenceAdvisoryKnowledgeResult = { references: [], citations: [], warnings: [], retrieval_provenance: null };
    if (this.dependencies.knowledge_provider !== undefined) {
      try { knowledge = await this.dependencies.knowledge_provider.retrieve({ organization_id: input.organization_id, capa_case_id: input.capa_case_id, case_version_id: workspace.case_version_id, user_id: input.user_id, active_roles: activeRoles, request_id: input.request_id, correlation_id: input.correlation_id, workspace }); }
      catch { return { status: "knowledge_unavailable" }; }
      for (const reference of knowledge.references) {
        const key = `R${index++}`;
        const sourceReference = typeof reference.source_reference === "string" ? reference.source_reference : typeof reference.source_id === "string" ? reference.source_id : key;
        const locator = typeof reference.locator === "string" ? reference.locator : null;
        manifest.push({ reference_key: key, source_kind: "governed_knowledge", source_reference: sourceReference, source_status: "governed_current_effective", locator });
        safeReferences.push({ ...reference, reference_key: key, source_kind: "governed_knowledge", source_status: "governed_current_effective" });
      }
    }
    const cited = [...manifest].map(refCitation);
    const model_safe_context: CapaImplementationEvidenceAdvisoryModelSafeContext = freeze({ trust: "model_safe_context", workflow_state: "S80", case_version_id: workspace.case_version_id, record_version: workspace.record_version, approved_s70_baseline: workspace.approved_s70_baseline, approved_actions: Object.freeze(workspace.approved_actions.map((action) => ({ ...action }))), untrusted_human_workspace: workspace.draft, references: Object.freeze(safeReferences), governed_knowledge: Object.freeze(safeReferences.filter((reference) => reference.source_kind === "governed_knowledge")) });
    return { status: "resolved", assembly: freeze({ authoritative, reference_manifest: Object.freeze(manifest), model_safe_context, citations: Object.freeze([...knowledge.citations.length > 0 ? knowledge.citations : cited]), knowledge_provenance: knowledge.retrieval_provenance, knowledge_warnings: Object.freeze([...knowledge.warnings]) }) };
  }

  async assertCaseUnchanged(context: AuthoritativeS80ImplementationEvidenceContext): Promise<boolean> {
    try {
      const result = await this.dependencies.workspace_service.load({ capa_case_id: context.capa_case_id });
      return result.status === "loaded" && result.workspace.case_version_id === context.case_version_id && result.workspace.record_version === context.record_version;
    } catch { return false; }
  }
}
