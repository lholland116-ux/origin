import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";

import type {
  CapaAiOutputReviewRepository,
} from "../../database/repositories/capa-ai-output-review-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

import type {
  CapaRequestContext,
} from "../../security/supabase-capa-context";

import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";

import {
  PolicyBackedCapaAiOutputReviewAuthorizer,
} from "../authorization/capa-ai-output-review-authorizer";

import {
  reviewCapaAiOutput,
  type ReviewCapaAiOutputCommand,
  type ReviewCapaAiOutputIdGenerator,
  type ReviewCapaAiOutputResult,
} from "./review-capa-ai-output";

/**
 * Browser-independent command accepted by the request-scoped human-review
 * service.
 *
 * Tenant authority and reviewer identity are deliberately absent. They are
 * bound from trusted CapaRequestContext by the runtime factory.
 */
export type CapaAiOutputReviewServiceCommand =
  Pick<
    ReviewCapaAiOutputCommand,
    | "capa_case_id"
    | "output_id"
    | "review"
    | "request_trace"
  >;

export interface CapaAiOutputReviewService {
  review(
    command:
      CapaAiOutputReviewServiceCommand,
  ): Promise<ReviewCapaAiOutputResult>;
}

export interface CapaAiOutputReviewRuntimeFactoryDependencies {
  readonly request_context:
    CapaRequestContext;

  readonly transaction_manager:
    TransactionManager;

  readonly review_repository:
    CapaAiOutputReviewRepository;

  readonly audit_repository:
    AuditRepository;

  readonly authorization_policy:
    CapaAuthorizationPolicy;

  readonly now:
    () => Date;

  readonly generate_uuid:
    () => string;

  readonly audit_schema_version:
    string;
}

/**
 * Creates one request-scoped governed human-review service for immutable
 * CAPA AI intake-advisory output.
 *
 * Authentication, tenant authority and human reviewer identity are bound
 * from trusted server-resolved request context. Browser-controlled data
 * cannot select or impersonate the reviewer.
 *
 * This service has no CAPA workflow-mutation or gate-approval dependency.
 */
export function createRequestScopedCapaAiOutputReviewService(
  dependencies:
    CapaAiOutputReviewRuntimeFactoryDependencies,
): CapaAiOutputReviewService {
  const authorizer =
    new PolicyBackedCapaAiOutputReviewAuthorizer({
      authentication:
        dependencies.request_context
          .authentication,

      tenant:
        dependencies.request_context
          .tenant,

      policy:
        dependencies.authorization_policy,

      now:
        dependencies.now,
    });

  const idGenerator:
    ReviewCapaAiOutputIdGenerator = {
      generateReviewId() {
        return dependencies
          .generate_uuid() as
          ReturnType<
            ReviewCapaAiOutputIdGenerator[
              "generateReviewId"
            ]
          >;
      },

      generateAuditEventId() {
        return dependencies
          .generate_uuid() as
          ReturnType<
            ReviewCapaAiOutputIdGenerator[
              "generateAuditEventId"
            ]
          >;
      },
    };

  return Object.freeze({
    async review(
      command:
        CapaAiOutputReviewServiceCommand,
    ): Promise<ReviewCapaAiOutputResult> {
      return reviewCapaAiOutput(
        {
          transaction_manager:
            dependencies
              .transaction_manager,

          review_repository:
            dependencies
              .review_repository,

          authorizer,

          audit_repository:
            dependencies
              .audit_repository,

          id_generator:
            idGenerator,

          clock: {
            now:
              dependencies.now,
          },

          configuration: {
            audit_schema_version:
              dependencies
                .audit_schema_version,
          },
        },
        {
          tenant:
            dependencies.request_context
              .tenant,

          capa_case_id:
            command.capa_case_id,

          output_id:
            command.output_id,

          reviewed_by: {
            actor_type:
              "human",

            actor_id:
              dependencies
                .request_context
                .owner_user_id,
          },

          review:
            command.review,

          request_trace:
            command.request_trace,
        },
      );
    },
  });
}
