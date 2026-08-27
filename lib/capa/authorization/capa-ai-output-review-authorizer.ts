import type {
  ActorReference,
  CapaCaseId,
  CapaCaseVersionId,
  ControlledCode,
  OrganizationId,
} from "../domain/capa-types";

import {
  CAPA_STATE,
} from "../domain/capa-state";

import type {
  CapaIntakeAdvisoryResponse,
} from "../ai/capa-intake-advisory-contract";

import type {
  CapaAuthorizationPolicy,
} from "./capa-policy";

import type {
  AuthenticationContext,
} from "../../security/auth-context";

import type {
  TenantContext,
} from "../../security/tenant-context";

/**
 * Trusted authorization request for governed human disposition of one
 * immutable CAPA AI intake-advisory output.
 *
 * The browser must never be trusted to supply reviewer identity,
 * organization authority, or policy configuration.
 */
export interface CapaAiOutputHumanReviewAuthorizationInput {
  readonly organization_id:
    OrganizationId;

  readonly capa_case_id:
    CapaCaseId;

  readonly case_version_id:
    CapaCaseVersionId;

  readonly record_version:
    number;

  readonly output_id:
    CapaIntakeAdvisoryResponse["output_id"];

  readonly reviewer:
    ActorReference;
}

export interface CapaAiOutputHumanReviewAuthorizer {
  authorizeAiOutputReview(
    input:
      CapaAiOutputHumanReviewAuthorizationInput,
  ): Promise<boolean>;
}

export interface CapaAiOutputReviewAuthorizerDependencies {
  readonly authentication:
    AuthenticationContext;

  readonly tenant:
    TenantContext;

  readonly policy:
    CapaAuthorizationPolicy;

  readonly now:
    () => Date;
}

/**
 * Policy-backed authorization for human review of governed CAPA AI output.
 *
 * This is review authority only. It does not confer CAPA gate approval,
 * workflow-transition authority, or controlled-record mutation authority.
 *
 * Fail-closed conditions include:
 *
 * - non-human authenticated principal;
 * - reviewer/authenticated-user mismatch;
 * - tenant mismatch;
 * - invalid review context;
 * - invalid trusted time;
 * - policy denial;
 * - policy evaluation failure.
 */
export class PolicyBackedCapaAiOutputReviewAuthorizer
  implements CapaAiOutputHumanReviewAuthorizer {
  constructor(
    private readonly dependencies:
      CapaAiOutputReviewAuthorizerDependencies,
  ) {}

  async authorizeAiOutputReview(
    input:
      CapaAiOutputHumanReviewAuthorizationInput,
  ): Promise<boolean> {
    const principal =
      this.dependencies.authentication
        .principal;

    if (
      input.reviewer.actor_type !==
        "human" ||
      principal.principal_type !==
        "human" ||
      input.reviewer.actor_id !==
        principal.user_id ||
      input.organization_id !==
        this.dependencies.tenant
          .organization_id ||
      typeof input.capa_case_id !==
        "string" ||
      input.capa_case_id.trim() !==
        input.capa_case_id ||
      input.capa_case_id.length ===
        0 ||
      typeof input.case_version_id !==
        "string" ||
      input.case_version_id.trim() !==
        input.case_version_id ||
      input.case_version_id.length ===
        0 ||
      typeof input.output_id !==
        "string" ||
      input.output_id.trim() !==
        input.output_id ||
      input.output_id.length ===
        0 ||
      !Number.isSafeInteger(
        input.record_version,
      ) ||
      input.record_version < 1
    ) {
      return false;
    }

    let trustedNow:
      Date;

    try {
      trustedNow =
        this.dependencies.now();
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
              "review_ai_intake_advisory",

            resource: {
              organization_id:
                input.organization_id,

              resource_type:
                "CAPA_AI_OUTPUT" as
                  ControlledCode,

              resource_id:
                input.output_id,

              resource_version_id:
                input.case_version_id,

              capa_case_id:
                input.capa_case_id,

              case_version_id:
                input.case_version_id,

              workflow_state:
                CAPA_STATE
                  .TRIAGE_AND_SCOPE,
            },

            purpose:
              "CAPA_AI_INTAKE_ADVISORY_REVIEW" as
                ControlledCode,

            trusted_now:
              trustedNow,
          });

      return (
        decision.decision ===
        "allow"
      );
    } catch {
      return false;
    }
  }
}
