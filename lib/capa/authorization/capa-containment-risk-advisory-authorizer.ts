import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { CapaContainmentRiskAdvisoryAuthorizer } from "../ai/capa-containment-risk-advisory-service";
import type { CapaAuthorizationPolicy } from "./capa-policy";
import type { ControlledCode } from "../domain/capa-types";

export interface CapaContainmentRiskAdvisoryAuthorizerDependencies {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
}

export class PolicyBackedCapaContainmentRiskAdvisoryAuthorizer implements CapaContainmentRiskAdvisoryAuthorizer {
  constructor(private readonly dependencies: CapaContainmentRiskAdvisoryAuthorizerDependencies) {}

  async authorize(input: Parameters<CapaContainmentRiskAdvisoryAuthorizer["authorize"]>[0]): Promise<boolean> {
    const principal = this.dependencies.authentication.principal;
    if (principal.principal_type !== "human" || principal.user_id !== input.context.actor || input.context.organization_id !== this.dependencies.tenant.organization_id || input.context.workflow_state !== "S20" || input.operation !== "analyze_containment_impact_risk") return false;
    let trustedNow: Date;
    try { trustedNow = this.dependencies.now(); } catch { return false; }
    if (!Number.isFinite(trustedNow.getTime())) return false;
    try {
      const decision = await this.dependencies.policy.evaluate({ authentication: this.dependencies.authentication, tenant: this.dependencies.tenant, operation: "request_ai_containment_risk_advisory", resource: { organization_id: input.context.organization_id, resource_type: "CAPA_CASE" as ControlledCode, resource_id: input.context.capa_case_id, resource_version_id: input.context.case_version_id, capa_case_id: input.context.capa_case_id, case_version_id: input.context.case_version_id, workflow_state: input.context.workflow_state }, purpose: "CAPA_AI_CONTAINMENT_RISK_ADVISORY" as ControlledCode, trusted_now: trustedNow });
      return decision.decision === "allow";
    } catch { return false; }
  }
}
