import type { CapaRepository } from "../../database/repositories/capa-repository";
import { getActiveRoleAssignments, type TenantContext } from "../../security/tenant-context";
import { CAPA_CONTAINMENT_RISK_SECTION_TYPE, validateCapaContainmentRiskContent } from "../domain/capa-containment-risk";
import { validateCapaContainmentRiskAdvisoryBrowserRequest } from "./capa-containment-risk-advisory-validator";
import type { CapaContainmentRiskAdvisoryContextAssembly, CapaContainmentRiskAdvisoryContextInvocation } from "./capa-containment-risk-advisory-context";
import type { AuthenticationContext } from "../../security/auth-context";

export interface RepositoryCapaContainmentRiskAdvisoryContextResolverDependencies {
  readonly repository: CapaRepository;
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly intake_section_type: string;
  readonly now: () => Date;
}

export class RepositoryCapaContainmentRiskAdvisoryContextResolver {
  constructor(private readonly dependencies: RepositoryCapaContainmentRiskAdvisoryContextResolverDependencies) {}

  async resolve(invocation: CapaContainmentRiskAdvisoryContextInvocation): Promise<CapaContainmentRiskAdvisoryContextAssembly | null> {
    const principal = this.dependencies.authentication.principal;
    if (principal.principal_type !== "human" || invocation.organization_id !== this.dependencies.tenant.organization_id) return null;
    const actor = principal.user_id;
    let now: Date;
    try { now = this.dependencies.now(); } catch { return null; }
    if (!Number.isFinite(now.getTime())) return null;
    const activeRoles = getActiveRoleAssignments(this.dependencies.tenant, now);
    if (activeRoles.length === 0) return null;
    try {
      const capaCase = await this.dependencies.repository.findCaseById(invocation.organization_id, invocation.capa_case_id);
      if (!capaCase || capaCase.organization_id !== invocation.organization_id || capaCase.status !== "S20") return null;
      const version = await this.dependencies.repository.findCaseVersionById(invocation.organization_id, invocation.capa_case_id, capaCase.current_version_id);
      if (!version || version.organization_id !== invocation.organization_id || version.capa_case_id !== invocation.capa_case_id || version.case_version_id !== capaCase.current_version_id || version.status !== "S20" || version.version_number !== capaCase.record_version) return null;
      const sections = await Promise.all(version.section_version_ids.map((id) => this.dependencies.repository.findSectionVersionById(invocation.organization_id, invocation.capa_case_id, id).then((section) => ({ id, section }))));
      if (sections.some(({ id, section }) => !section || section.section_version_id !== id || section.organization_id !== invocation.organization_id || section.capa_case_id !== invocation.capa_case_id)) return null;
      const intakeSections = sections.filter(({ section }) => section?.section_type === this.dependencies.intake_section_type);
      if (intakeSections.length !== 1) return null;
      const intake = intakeSections[0]?.section;
      if (!intake || !intake.content || typeof intake.content !== "object" || Array.isArray(intake.content)) return null;
      const intakeContent = intake.content as Record<string, unknown>;
      if (typeof intakeContent.initiating_event !== "string" || typeof intakeContent.organization_reference !== "string" || !intakeContent.source || typeof intakeContent.source !== "object" || Array.isArray(intakeContent.source)) return null;
      const riskSections = sections.map(({ section }) => section).filter((section) => section?.section_type === CAPA_CONTAINMENT_RISK_SECTION_TYPE);
      if (riskSections.length > 1) return null;
      let persisted: import("../domain/capa-containment-risk").CapaContainmentRiskContent | null = null;
      if (riskSections[0]) {
        const result = validateCapaContainmentRiskContent(riskSections[0].content);
        if (result.status !== "valid") return null;
        persisted = result.value;
      }
      let draft = null;
      if (invocation.untrusted_human_draft !== undefined) {
        const validated = validateCapaContainmentRiskAdvisoryBrowserRequest({ untrusted_human_draft: invocation.untrusted_human_draft });
        draft = Object.freeze(validated.untrusted_human_draft);
      }
      const authoritative = Object.freeze({ trust: "authoritative_server_context" as const, organization_id: capaCase.organization_id, capa_case_id: capaCase.capa_case_id, case_version_id: version.case_version_id, record_version: version.version_number, workflow_state: "S20" as const, actor, active_roles: Object.freeze(activeRoles.map((role) => Object.freeze({ ...role }))), intake_scope: Object.freeze({ initiating_event: intakeContent.initiating_event, source: Object.freeze({ ...(intakeContent.source as Record<string, unknown>) }), organization_reference: intakeContent.organization_reference }), persisted_containment_risk: persisted && Object.freeze(persisted) });
      return Object.freeze({ authoritative, untrusted_human_draft: draft });
    } catch { return null; }
  }
}
