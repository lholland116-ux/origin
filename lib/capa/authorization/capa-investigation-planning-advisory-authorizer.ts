import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type {
  AuthoritativeS30InvestigationPlanningContext,
} from "../ai/capa-investigation-planning-advisory-context";
import {
  CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
} from "../ai/capa-investigation-planning-advisory-agent-gate";
import type {
  CapaInvestigationPlanningAdvisoryAuthorizer,
} from "../ai/capa-investigation-planning-advisory-service";
import type { ControlledCode } from "../domain/capa-types";
import type { CapaAuthorizationPolicy } from "./capa-policy";

export interface CapaInvestigationPlanningAdvisoryAuthorizerDependencies {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
}

export class PolicyBackedCapaInvestigationPlanningAdvisoryAuthorizer
  implements CapaInvestigationPlanningAdvisoryAuthorizer {
  constructor(
    private readonly dependencies:
      CapaInvestigationPlanningAdvisoryAuthorizerDependencies,
  ) {}

  async authorize(
    input: Parameters<
      CapaInvestigationPlanningAdvisoryAuthorizer["authorize"]
    >[0],
  ): Promise<boolean> {
    const principal = this.dependencies.authentication.principal;

    if (
      principal === undefined ||
      principal.principal_type !== "human" ||
      principal.user_id !== input.context.actor ||
      input.context.organization_id !==
        this.dependencies.tenant.organization_id ||
      input.context.workflow_state !== "S30" ||
      input.operation !== CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION ||
      !Array.isArray(input.context.active_roles) ||
      input.context.active_roles.length === 0
    ) {
      return false;
    }

    let trustedNow: Date;
    try {
      trustedNow = this.dependencies.now();
    } catch {
      return false;
    }

    if (!Number.isFinite(trustedNow.getTime())) return false;

    try {
      const decision = await this.dependencies.policy.evaluate({
        authentication: this.dependencies.authentication,
        tenant: this.dependencies.tenant,
        operation: "request_ai_investigation_planning_advisory",
        resource: {
          organization_id: input.context.organization_id,
          resource_type: "CAPA_CASE" as ControlledCode,
          resource_id: input.context.capa_case_id,
          resource_version_id: input.context.case_version_id,
          capa_case_id: input.context.capa_case_id,
          case_version_id: input.context.case_version_id,
          workflow_state: input.context.workflow_state,
        },
        purpose: "CAPA_AI_INVESTIGATION_PLANNING_ADVISORY" as ControlledCode,
        trusted_now: trustedNow,
      });

      return decision.decision === "allow";
    } catch {
      return false;
    }
  }
}
