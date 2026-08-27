import type postgres from "postgres";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRequestScopedCapaAiOutputReviewService,
} from "../../lib/capa/application/capa-ai-output-review-runtime-factory";

import {
  createCapaProductionRuntime,
} from "../../lib/capa/application/capa-production-runtime";

const ORG_ID =
  "10000000-0000-4000-8000-000000000001";

const USER_ID =
  "20000000-0000-4000-8000-000000000001";

const CASE_ID =
  "30000000-0000-4000-8000-000000000001";

const CASE_VERSION_ID =
  "40000000-0000-4000-8000-000000000001";

const OUTPUT_ID =
  "50000000-0000-4000-8000-000000000001";

const REQUEST_ID =
  "60000000-0000-4000-8000-000000000001";

const CORRELATION_ID =
  "70000000-0000-4000-8000-000000000001";

const GENERATED_ID =
  "80000000-0000-4000-8000-000000000001";

const NOW =
  new Date(
    "2026-08-26T20:00:00.000Z",
  );

function requestContext() {
  return {
    owner_user_id:
      USER_ID,

    authentication: {
      principal: {
        principal_type:
          "human",

        user_id:
          USER_ID,
      },
    },

    tenant: {
      organization_id:
        ORG_ID,
    },
  } as never;
}

describe(
  "CAPA AI-output review runtime integration",
  () => {
    it(
      "binds trusted tenant and authenticated human reviewer from request context",
      async () => {
        const captured:
          Array<{
            readonly review: {
              readonly organization_id:
                string;

              readonly capa_case_id:
                string;

              readonly output_id:
                string;

              readonly reviewed_by: {
                readonly actor_type:
                  string;

                readonly actor_id:
                  string;
              };
            };
          }> = [];

        const appendReview =
          vi.fn(
            async (
              _transaction:
                unknown,

              input: {
                readonly review: {
                  readonly organization_id:
                    string;

                  readonly capa_case_id:
                    string;

                  readonly output_id:
                    string;

                  readonly reviewed_by: {
                    readonly actor_type:
                      string;

                    readonly actor_id:
                      string;
                  };
                };
              },
            ) => {
              captured.push(
                input,
              );

              return {
                status:
                  "case_changed",
              } as const;
            },
          );

        const transactionManager = {
          runInTransaction:
            vi.fn(
              async (
                _trace:
                  unknown,

                work:
                  (
                    transaction:
                      unknown,
                  ) =>
                    Promise<unknown>,
              ) =>
                work({
                  transaction_id:
                    "tx-review-1",
                }),
            ),
        } as never;

        const reviewRepository = {
          appendReview,

          findReviewById:
            vi.fn(
              async () =>
                null,
            ),

          listReviewsForOutput:
            vi.fn(
              async () =>
                [],
            ),
        } as never;

        const policyEvaluate =
          vi.fn(
            async () => ({
              decision:
                "allow",
            }),
          );

        const service =
          createRequestScopedCapaAiOutputReviewService({
            request_context:
              requestContext(),

            transaction_manager:
              transactionManager,

            review_repository:
              reviewRepository,

            audit_repository:
              {} as never,

            authorization_policy: {
              evaluate:
                policyEvaluate,
            } as never,

            now:
              () => NOW,

            generate_uuid:
              () => GENERATED_ID,

            audit_schema_version:
              "audit-schema-1.0.0",
          });

        const result =
          await service.review({
            capa_case_id:
              CASE_ID as never,

            output_id:
              OUTPUT_ID as never,

            review: {
              decision:
                "accept",

              rationale:
                null,

              human_revision:
                null,

              expected_case_version_id:
                CASE_VERSION_ID as never,

              expected_record_version:
                2,
            },

            request_trace: {
              request_id:
                REQUEST_ID as never,

              correlation_id:
                CORRELATION_ID as never,

              idempotency_key:
                "review-runtime-001" as never,
            },
          });

        expect(result)
          .toEqual({
            status:
              "concurrency_conflict",

            reason_code:
              "CAPA_SNAPSHOT_CHANGED",
          });

        expect(captured)
          .toHaveLength(1);

        expect(
          captured[0]?.review,
        ).toMatchObject({
          organization_id:
            ORG_ID,

          capa_case_id:
            CASE_ID,

          output_id:
            OUTPUT_ID,

          reviewed_by: {
            actor_type:
              "human",

            actor_id:
              USER_ID,
          },
        });

        expect(
          policyEvaluate,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            operation:
              "review_ai_intake_advisory",

            resource:
              expect.objectContaining({
                organization_id:
                  ORG_ID,

                capa_case_id:
                  CASE_ID,

                resource_id:
                  OUTPUT_ID,
              }),
          }),
        );
      },
    );

    it(
      "exposes durable AI-output review independently of advisory model configuration",
      () => {
        const sql =
          vi.fn() as unknown as
            postgres.Sql;

        const runtime =
          createCapaProductionRuntime({
            sql,

            now:
              () => NOW,

            generate_uuid:
              () =>
                GENERATED_ID,
          });

        const factory =
          runtime
            .create_ai_output_review_service;

        if (
          factory ===
          undefined
        ) {
          throw new Error(
            "Production AI-output review factory is missing.",
          );
        }

        const service =
          factory(
            requestContext(),
          );

        expect(service.review)
          .toEqual(
            expect.any(
              Function,
            ),
          );
      },
    );
  },
);
