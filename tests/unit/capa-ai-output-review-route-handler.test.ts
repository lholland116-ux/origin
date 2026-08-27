import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  handleCapaAiOutputReviewPost,
} from "../../lib/capa/api/capa-ai-output-review-route-handler";

import type {
  CapaAiOutputReviewService,
  CapaAiOutputReviewServiceCommand,
} from "../../lib/capa/application/capa-ai-output-review-runtime-factory";

import type {
  ReviewCapaAiOutputResult,
} from "../../lib/capa/application/review-capa-ai-output";

import type {
  SupabaseCapaSessionFacts,
} from "../../lib/security/supabase-capa-context";

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

const REVIEW_ID =
  "60000000-0000-4000-8000-000000000001";

const AUDIT_EVENT_ID =
  "70000000-0000-4000-8000-000000000001";

const REQUEST_ID =
  "80000000-0000-4000-8000-000000000001";

const CORRELATION_ID =
  "90000000-0000-4000-8000-000000000001";

const IDEMPOTENCY_KEY =
  "review-request-001";

const VALID_REVIEW_BODY =
  Object.freeze({
    decision:
      "accept",

    expected_case_version_id:
      CASE_VERSION_ID,

    expected_record_version:
      2,
  });

const REVIEW_RECORD =
  Object.freeze({
    review_id:
      REVIEW_ID,

    organization_id:
      ORG_ID,

    output_id:
      OUTPUT_ID,

    capa_case_id:
      CASE_ID,

    case_version_id:
      CASE_VERSION_ID,

    record_version:
      2,

    decision:
      "accept",

    rationale:
      null,

    human_revision:
      null,

    reviewed_at:
      "2026-08-26T20:00:00.000Z",

    reviewed_by: {
      actor_type:
        "human",

      actor_id:
        USER_ID,
    },

    review_policy_version:
      "capa-ai-output-review-1.0.0",

    request_id:
      REQUEST_ID,

    correlation_id:
      CORRELATION_ID,

    idempotency_key:
      IDEMPOTENCY_KEY,

    workflow_mutated:
      false,

    controlled_record_mutated:
      false,

    gate_approved:
      false,
  });

interface RequestOptions {
  readonly body?:
    unknown;

  readonly raw_body?:
    string;

  readonly idempotency_key?:
    string | null;
}

function request(
  options:
    RequestOptions = {},
): Request {
  const headers =
    new Headers({
      "content-type":
        "application/json",

      "x-request-id":
        REQUEST_ID,

      "x-correlation-id":
        CORRELATION_ID,
    });

  const key =
    options.idempotency_key ===
      undefined
      ? IDEMPOTENCY_KEY
      : options.idempotency_key;

  if (key !== null) {
    headers.set(
      "idempotency-key",
      key,
    );
  }

  const body =
    options.raw_body !==
      undefined
      ? options.raw_body
      : JSON.stringify(
          options.body ??
            VALID_REVIEW_BODY,
        );

  return new Request(
    "http://localhost/api/capa/test/review",
    {
      method:
        "POST",

      headers,

      body,
    },
  );
}

function serviceReturning(
  result:
    ReviewCapaAiOutputResult,
) {
  const review =
    vi.fn(
      async (
        _command:
          CapaAiOutputReviewServiceCommand,
      ): Promise<ReviewCapaAiOutputResult> =>
        result,
    );

  const service:
    CapaAiOutputReviewService = {
    review,
  };

  return {
    service,
    review,
  };
}

function setup(
  result:
    ReviewCapaAiOutputResult = {
      status:
        "reviewed",

      review:
        REVIEW_RECORD,

      audit_event_id:
        AUDIT_EVENT_ID,
    } as never,
) {
  const service =
    serviceReturning(
      result,
    );

  const context = {
    owner_user_id:
      USER_ID,

    tenant: {
      organization_id:
        ORG_ID,
    },

    authentication: {
      principal: {
        principal_type:
          "human",

        user_id:
          USER_ID,
      },
    },
  } as never;

  const getSessionFacts =
    vi.fn<
      () =>
        Promise<
          SupabaseCapaSessionFacts | null
        >
    >(
      async () => ({
        verified_user_id:
          USER_ID,

        authenticated_at:
          "2026-08-26T19:00:00.000Z",

        expires_at_epoch_seconds:
          1_787_774_400,
      }),
    );

  const resolveContext =
    vi.fn(
      async () =>
        context,
    );

  const createReviewService =
    vi.fn(
      () =>
        service.service,
    );

  const logger = {
    error:
      vi.fn(),
  };

  const dependencies = {
    get_session_facts:
      getSessionFacts,

    resolve_context:
      resolveContext,

    create_review_service:
      createReviewService,

    now:
      () =>
        new Date(
          "2026-08-26T20:00:00.000Z",
        ),

    generate_uuid:
      vi.fn(
        () =>
          REQUEST_ID,
      ),

    logger,
  } as never;

  return {
    dependencies,
    service,
    getSessionFacts,
    resolveContext,
    createReviewService,
    logger,
    context,
  };
}

describe(
  "CAPA AI-output review route handler",
  () => {
    it(
      "requires an explicit Idempotency-Key before authentication or persistence",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaAiOutputReviewPost(
            request({
              idempotency_key:
                null,
            }),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(400);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_AI_REVIEW_IDEMPOTENCY_KEY_REQUIRED",

            correlation_id:
              CORRELATION_ID,
          },
        });

        expect(
          test.getSessionFacts,
        ).not.toHaveBeenCalled();

        expect(
          test.service.review,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "requires an authenticated session",
      async () => {
        const test =
          setup();

        test.getSessionFacts
          .mockResolvedValueOnce(
            null,
          );

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(401);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "UNAUTHORIZED",
          },
        });

        expect(
          test.createReviewService,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an invalid CAPA case identifier",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            "not-a-case-id",
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(400);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "INVALID_CAPA_CASE_ID",
          },
        });

        expect(
          test.createReviewService,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an invalid CAPA AI-output identifier",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            "not-an-output-id",
            test.dependencies,
          );

        expect(response.status)
          .toBe(400);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "INVALID_CAPA_AI_OUTPUT_ID",
          },
        });

        expect(
          test.createReviewService,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects malformed JSON and hostile browser-controlled authority fields",
      async () => {
        const malformed =
          setup();

        const malformedResponse =
          await handleCapaAiOutputReviewPost(
            request({
              raw_body:
                "{",
            }),
            CASE_ID,
            OUTPUT_ID,
            malformed.dependencies,
          );

        expect(
          malformedResponse.status,
        ).toBe(400);

        expect(
          malformed.service.review,
        ).not.toHaveBeenCalled();

        const hostile =
          setup();

        const hostileResponse =
          await handleCapaAiOutputReviewPost(
            request({
              body: {
                ...VALID_REVIEW_BODY,

                organization_id:
                  ORG_ID,

                reviewed_by: {
                  actor_type:
                    "human",

                  actor_id:
                    "attacker-controlled-user",
                },
              },
            }),
            CASE_ID,
            OUTPUT_ID,
            hostile.dependencies,
          );

        expect(
          hostileResponse.status,
        ).toBe(400);

        await expect(
          hostileResponse.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_AI_OUTPUT_REVIEW_VALIDATION_FAILED",
          },
        });

        expect(
          hostile.service.review,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "records a new review and passes only validated route and browser review data to the request-scoped service",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(201);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          ai_output_review: {
            review_id:
              REVIEW_ID,

            decision:
              "accept",
          },

          audit_event_id:
            AUDIT_EVENT_ID,

          replayed:
            false,

          correlation_id:
            CORRELATION_ID,
        });

        expect(
          test.createReviewService,
        ).toHaveBeenCalledWith(
          test.context,
        );

        expect(
          test.service.review,
        ).toHaveBeenCalledTimes(
          1,
        );

        const submitted =
          test.service.review
            .mock.calls[0]?.[0];

        expect(submitted)
          .toEqual({
            capa_case_id:
              CASE_ID,

            output_id:
              OUTPUT_ID,

            review: {
              decision:
                "accept",

              rationale:
                null,

              human_revision:
                null,

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,
            },

            request_trace: {
              request_id:
                REQUEST_ID,

              correlation_id:
                CORRELATION_ID,

              idempotency_key:
                IDEMPOTENCY_KEY,
            },
          });

        expect(submitted)
          .not.toHaveProperty(
            "reviewed_by",
          );

        expect(submitted)
          .not.toHaveProperty(
            "tenant",
          );

        expect(submitted)
          .not.toHaveProperty(
            "organization_id",
          );
      },
    );

    it(
      "returns 200 for an exact idempotent replay",
      async () => {
        const test =
          setup({
            status:
              "already_reviewed",

            review:
              REVIEW_RECORD,

            audit_event_id:
              AUDIT_EVENT_ID,
          } as never);

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(200);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          replayed:
            true,

          ai_output_review: {
            review_id:
              REVIEW_ID,
          },
        });
      },
    );

    it(
      "returns 403 when policy-backed human review authorization is denied",
      async () => {
        const test =
          setup({
            status:
              "authorization_denied",

            reason_code:
              "HUMAN_REVIEW_NOT_AUTHORIZED",
          });

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(403);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_AI_OUTPUT_REVIEW_ACCESS_DENIED",
          },
        });
      },
    );

    it(
      "returns one nondisclosing 404 for output missing or unauthorized",
      async () => {
        const test =
          setup({
            status:
              "output_not_found_or_not_authorized",
          });

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(404);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_AI_OUTPUT_NOT_FOUND",
          },
        });
      },
    );

    it(
      "returns 409 when the persisted AI output is not reviewable",
      async () => {
        const test =
          setup({
            status:
              "output_not_reviewable",
          });

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(409);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_AI_OUTPUT_NOT_REVIEWABLE",
          },
        });
      },
    );

    it(
      "returns 409 when the CAPA snapshot changed before commit",
      async () => {
        const test =
          setup({
            status:
              "concurrency_conflict",

            reason_code:
              "CAPA_SNAPSHOT_CHANGED",
          });

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(409);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_AI_OUTPUT_REVIEW_STALE",
          },
        });
      },
    );

    it(
      "returns 409 when an Idempotency-Key is reused for different review content",
      async () => {
        const test =
          setup({
            status:
              "idempotency_conflict",

            reason_code:
              "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          });

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(409);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_AI_OUTPUT_REVIEW_IDEMPOTENCY_CONFLICT",
          },
        });
      },
    );

    it(
      "returns a generic 500 and logs correlation-safe metadata on unexpected failure",
      async () => {
        const test =
          setup();

        test.service.review
          .mockRejectedValueOnce(
            new Error(
              "controlled test failure",
            ),
          );

        const response =
          await handleCapaAiOutputReviewPost(
            request(),
            CASE_ID,
            OUTPUT_ID,
            test.dependencies,
          );

        expect(response.status)
          .toBe(500);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          error: {
            code:
              "CAPA_INTERNAL_ERROR",

            correlation_id:
              CORRELATION_ID,
          },
        });

        expect(
          test.logger.error,
        ).toHaveBeenCalledWith(
          "CAPA API AI-output review failed.",
          {
            correlation_id:
              CORRELATION_ID,

            error_name:
              "Error",
          },
        );
      },
    );
  },
);
