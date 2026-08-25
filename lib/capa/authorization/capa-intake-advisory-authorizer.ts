import type {
  ControlledCode,
} from "../domain/capa-types";

import type {
  CapaIntakeAdvisoryAuthorizer,
} from "../ai/capa-intake-advisory-service";

import type {
  CapaAuthorizationPolicy,
} from "./capa-policy";

import type {
  AuthenticationContext,
} from "../../security/auth-context";

import type {
  TenantContext,
} from "../../security/tenant-context";

/** Policy-backed human authorization for advisory AI intake assistance. */

export interface CapaIntakeAdvisoryAuthorizerDependencies {
  readonly authentication:
    AuthenticationContext;
  readonly tenant: TenantContext;
  readonly policy:
    CapaAuthorizationPolicy;
  readonly now: () => Date;
}

export class PolicyBackedCapaIntakeAdvisoryAuthorizer
  implements CapaIntakeAdvisoryAuthorizer {
  constructor(
    private readonly dependencies:
      CapaIntakeAdvisoryAuthorizerDependencies,
  ) {}

  async authorize(
    input: Parameters<
      CapaIntakeAdvisoryAuthorizer["authorize"]
    >[0],
  ): Promise<boolean> {
    const principal =
      this.dependencies.authentication
        .principal;

    if (
      principal.principal_type !== "human" ||
      principal.user_id !==
        input.context.user_id ||
      input.context.organization_id !==
        this.dependencies.tenant
          .organization_id ||
      input.operation !==
        "draft_intake_analysis" ||
      input.context.workflow_state !== "S10"
    ) {
      return false;
    }

    let trustedNow: Date;

    try {
      trustedNow = this.dependencies.now();
    } catch {
      return false;
    }

    if (
      !Number.isFinite(
        trustedNow.getTime(),
      )
    ) {
      return false;
    }

    try {
      const decision =
        await this.dependencies.policy
          .evaluate({
            authentication:
              this.dependencies
                .authentication,
            tenant:
              this.dependencies.tenant,
            operation:
              "request_ai_intake_advisory",
            resource: {
              organization_id:
                input.context
                  .organization_id,
              resource_type: "CAPA_CASE" as ControlledCode,
              resource_id:
                input.context.capa_case_id,
              resource_version_id:
                input.context.case_version_id,
              capa_case_id:
                input.context.capa_case_id,
              case_version_id:
                input.context.case_version_id,
              workflow_state:
                input.context.workflow_state,
            },
            purpose: "CAPA_AI_INTAKE_ADVISORY" as ControlledCode,
            trusted_now: trustedNow,
          });

      return decision.decision === "allow";
    } catch {
      return false;
    }
  }
}
