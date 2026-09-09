import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { CapaAuthorizationPolicy } from "./capa-policy";
import type { AuthoritativeS60ActionPlanContext } from "../ai/capa-action-plan-advisory-context";
import type { CapaActionPlanAdvisoryAuthorizer } from "../ai/capa-action-plan-advisory-service";
import { CAPA_ACTION_PLAN_ADVISORY_OPERATION } from "../ai/capa-action-plan-advisory-model-generator";

export class PolicyBackedCapaActionPlanAdvisoryAuthorizer implements CapaActionPlanAdvisoryAuthorizer {
  constructor(private readonly dependencies: { readonly authentication: AuthenticationContext; readonly tenant: TenantContext; readonly policy: CapaAuthorizationPolicy; readonly now: () => Date }) {}
  async authorize(input: { readonly context: AuthoritativeS60ActionPlanContext; readonly operation: typeof CAPA_ACTION_PLAN_ADVISORY_OPERATION }): Promise<boolean> {
    const principal = this.dependencies.authentication.principal;
    if (principal.principal_type !== "human" || principal.user_id !== input.context.actor || input.context.organization_id !== this.dependencies.tenant.organization_id || input.context.workflow_state !== "S60" || input.operation !== CAPA_ACTION_PLAN_ADVISORY_OPERATION || input.context.active_roles.length === 0) return false;
    try { const decision = await this.dependencies.policy.evaluate({ authentication: this.dependencies.authentication, tenant: this.dependencies.tenant, operation: "request_ai_action_plan_advisory", resource: { organization_id: input.context.organization_id, resource_type: "CAPA_CASE" as never, resource_id: input.context.capa_case_id, resource_version_id: input.context.case_version_id, capa_case_id: input.context.capa_case_id, case_version_id: input.context.case_version_id, workflow_state: "S60" }, purpose: "CAPA_AI_ACTION_PLAN_ADVISORY" as never, trusted_now: this.dependencies.now() }); return decision.decision === "allow"; } catch { return false; }
  }
}
