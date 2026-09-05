import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { CapaAuthorizationPolicy } from "./capa-policy";
import type { AuthoritativeS40InvestigationActiveContext } from "../ai/capa-investigation-active-advisory-context";
import type { CapaInvestigationActiveAdvisoryAuthorizer } from "../ai/capa-investigation-active-advisory-service";
import { CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION } from "../ai/capa-investigation-active-advisory-agent-gate";

export interface CapaInvestigationActiveAdvisoryAuthorizerDependencies {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
}

export class PolicyBackedCapaInvestigationActiveAdvisoryAuthorizer
  implements CapaInvestigationActiveAdvisoryAuthorizer {
  constructor(private readonly dependencies: CapaInvestigationActiveAdvisoryAuthorizerDependencies) {}

  async authorize(input: {
    readonly context: AuthoritativeS40InvestigationActiveContext;
    readonly operation: typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION;
  }): Promise<boolean> {
    const principal = this.dependencies.authentication.principal;
    if (principal?.principal_type !== "human" || principal.user_id !== input.context.actor ||
      input.context.organization_id !== this.dependencies.tenant.organization_id ||
      input.context.workflow_state !== "S40" || input.operation !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION ||
      input.context.active_roles.length === 0) return false;
    let trustedNow: Date;
    try { trustedNow = this.dependencies.now(); } catch { return false; }
    if (!Number.isFinite(trustedNow.getTime())) return false;
    try {
      const decision = await this.dependencies.policy.evaluate({
        authentication: this.dependencies.authentication,
        tenant: this.dependencies.tenant,
        operation: "request_ai_investigation_active_advisory",
        resource: {
          organization_id: input.context.organization_id,
          resource_type: "CAPA_CASE" as never,
          resource_id: input.context.capa_case_id,
          resource_version_id: input.context.case_version_id,
          capa_case_id: input.context.capa_case_id,
          case_version_id: input.context.case_version_id,
          workflow_state: "S40",
        },
        purpose: "CAPA_AI_INVESTIGATION_ACTIVE_ADVISORY" as never,
        trusted_now: trustedNow,
      });
      return decision.decision === "allow";
    } catch { return false; }
  }
}
