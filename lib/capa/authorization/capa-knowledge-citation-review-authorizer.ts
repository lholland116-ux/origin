import type {
  ControlledCode,
} from "../domain/capa-types";

import type {
  CapaKnowledgeCitationHumanReviewAuthorizer,
} from "../knowledge/capa-knowledge-citation-review-service";

import type {
  CapaAuthorizationPolicy,
} from "./capa-policy";

import type {
  AuthenticationContext,
} from "../../security/auth-context";

import type {
  TenantContext,
} from "../../security/tenant-context";

export interface CapaKnowledgeCitationReviewAuthorizerDependencies {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
}

export class PolicyBackedCapaKnowledgeCitationReviewAuthorizer
  implements CapaKnowledgeCitationHumanReviewAuthorizer {
  constructor(
    private readonly dependencies:
      CapaKnowledgeCitationReviewAuthorizerDependencies,
  ) {}

  async authorizeCitationReview(
    input: Parameters<
      CapaKnowledgeCitationHumanReviewAuthorizer["authorizeCitationReview"]
    >[0],
  ): Promise<boolean> {
    const principal = this.dependencies.authentication.principal;
    if (
      input.reviewer.actor_type !== "human" ||
      principal.principal_type !== "human" ||
      input.reviewer.actor_id !== principal.user_id ||
      input.organization_id !== this.dependencies.tenant.organization_id
    ) {
      return false;
    }

    let trustedNow: Date;
    try {
      trustedNow = this.dependencies.now();
    } catch {
      return false;
    }
    if (!Number.isFinite(trustedNow.getTime())) {
      return false;
    }

    try {
      const decision = await this.dependencies.policy.evaluate({
        authentication: this.dependencies.authentication,
        tenant: this.dependencies.tenant,
        operation: "review_knowledge_citation",
        resource: {
          organization_id: input.organization_id,
          resource_type: "KNOWLEDGE_CITATION" as ControlledCode,
          resource_id: input.citation_id,
        },
        purpose: "CAPA_KNOWLEDGE_CITATION_REVIEW" as ControlledCode,
        trusted_now: trustedNow,
      });
      return decision.decision === "allow";
    } catch {
      return false;
    }
  }
}
