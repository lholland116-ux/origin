import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { AuthoritativeS80ImplementationEvidenceContext } from "./capa-implementation-evidence-advisory-context";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION } from "./capa-implementation-evidence-advisory-agent-gate";
import type { CapaImplementationEvidenceAdvisoryAuthorizer } from "./capa-implementation-evidence-advisory-service";

export class PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer implements CapaImplementationEvidenceAdvisoryAuthorizer {
  constructor(private readonly request_context: CapaRequestContext, private readonly policy: CapaAuthorizationPolicy, private readonly now: () => Date) {}
  async authorize(input: { readonly context: AuthoritativeS80ImplementationEvidenceContext; readonly operation: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION }): Promise<boolean> {
    const principal = this.request_context.authentication.principal;
    if (principal.principal_type !== "human" || principal.user_id !== input.context.actor || input.context.organization_id !== this.request_context.tenant.organization_id || input.context.workflow_state !== "S80" || input.operation !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION || input.context.active_roles.length === 0) return false;
    const trustedNow = this.now();
    const precondition = evaluateCapaAuthorizationPreconditions({ authentication: this.request_context.authentication, tenant: this.request_context.tenant, resource: { organization_id: input.context.organization_id }, operation: "request_ai_implementation_evidence_advisory", trusted_now: trustedNow });
    if (precondition.status === "denied") return false;
    try {
      const decision = await this.policy.evaluate({ authentication: this.request_context.authentication, tenant: this.request_context.tenant, operation: "request_ai_implementation_evidence_advisory", resource: { organization_id: input.context.organization_id, resource_type: "CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY" as never, resource_id: input.context.capa_case_id, resource_version_id: input.context.case_version_id, capa_case_id: input.context.capa_case_id, case_version_id: input.context.case_version_id, workflow_state: "S80" }, purpose: "CAPA_AI_IMPLEMENTATION_EVIDENCE_ADVISORY" as never, trusted_now: trustedNow });
      return decision.decision === "allow";
    } catch {
      return false;
    }
  }
}
