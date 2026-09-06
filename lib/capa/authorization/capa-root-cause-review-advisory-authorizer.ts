import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { CapaAuthorizationPolicy } from "./capa-policy";
import type { AuthoritativeS50RootCauseReviewContext } from "../ai/capa-root-cause-review-advisory-context";
import type { CapaRootCauseReviewAdvisoryAuthorizer } from "../ai/capa-root-cause-review-advisory-service";
import { CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION } from "../ai/capa-root-cause-review-advisory-agent-gate";

export interface CapaRootCauseReviewAdvisoryAuthorizerDependencies {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
}

export class PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer
  implements CapaRootCauseReviewAdvisoryAuthorizer {
  constructor(private readonly dependencies: CapaRootCauseReviewAdvisoryAuthorizerDependencies) {}

  async authorize(input: {
    readonly context: AuthoritativeS50RootCauseReviewContext;
    readonly operation: typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION;
  }): Promise<boolean> {
    const principal = this.dependencies.authentication.principal;
    if (
      principal?.principal_type !== "human" ||
      principal.user_id !== input.context.actor ||
      input.context.organization_id !== this.dependencies.tenant.organization_id ||
      input.context.workflow_state !== "S50" ||
      input.operation !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION ||
      input.context.active_roles.length === 0
    ) return false;

    let trustedNow: Date;
    try { trustedNow = this.dependencies.now(); } catch { return false; }
    if (!Number.isFinite(trustedNow.getTime())) return false;

    try {
      const decision = await this.dependencies.policy.evaluate({
        authentication: this.dependencies.authentication,
        tenant: this.dependencies.tenant,
        operation: "request_ai_root_cause_review_advisory",
        resource: {
          organization_id: input.context.organization_id,
          resource_type: "CAPA_CASE" as never,
          resource_id: input.context.capa_case_id,
          resource_version_id: input.context.case_version_id,
          capa_case_id: input.context.capa_case_id,
          case_version_id: input.context.case_version_id,
          workflow_state: "S50",
        },
        purpose: "CAPA_AI_ROOT_CAUSE_REVIEW_ADVISORY" as never,
        trusted_now: trustedNow,
      });
      return decision.decision === "allow";
    } catch {
      return false;
    }
  }
}
