import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  handleCapaIntakeAdvisoryPost,
} from "../../lib/capa/api/capa-intake-advisory-route-handler";

import {
  CapaIntakeAdvisoryServiceError,
} from "../../lib/capa/ai/capa-intake-advisory-service";

import {
  SupabaseCapaContextError,
} from "../../lib/security/supabase-capa-context";

import {
  SupabaseCapaTenantAccessError,
} from "../../lib/security/supabase-capa-durable-context";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";

const USER_ID =
  "20000000-0000-4000-8000-000000000001";

const CASE_ID =
  "30000000-0000-4000-8000-000000000001";

const REQUEST_ID =
  "40000000-0000-4000-8000-000000000001";

const CORRELATION_ID =
  "50000000-0000-4000-8000-000000000001";

const OUTPUT_ID =
  "60000000-0000-4000-8000-000000000001";

const RUN_ID =
  "70000000-0000-4000-8000-000000000001";

const CASE_VERSION_ID =
  "80000000-0000-4000-8000-000000000001";

const RECORD_VERSION =
  2;

function completedAdvisory() {
  return {
    run_id:
      RUN_ID,

    output_id:
      OUTPUT_ID,

    output_schema_version:
      "capa-intake-draft-output-1.0.0",

    status:
      "completed_draft",

    proposal: {
      problem_statement_draft:
        "Seal defects exceeded the approved alert threshold.",

      scope_dimensions: [
        "Affected sealing operation",
      ],

      missing_dimensions: [],

      containment_risk_questions: [
        "Has affected product been contained?",
      ],

      investigation_questions: [
        "What changed before the defect increase?",
      ],
    },

    citations: [],
    assumptions: [],
    missing_information: [],
    conflicts_and_alternatives: [],
    uncertainty_and_limitations: [],

    human_action_required: [
      "Human review is required before use.",
    ],

    warnings: [],

    advisory_only:
      true,

    workflow_mutated:
      false,

    human_acceptance_required:
      true,
  } as const;
}

function setup() {
  const advise =
    vi.fn(
      async () => ({
        advisory:
          completedAdvisory(),

        snapshot: {
          capa_case_id:
            CASE_ID,

          case_version_id:
            CASE_VERSION_ID,

          record_version:
            RECORD_VERSION,
        },
      }),
    );

  const createAdvisoryService =
    vi.fn(
      () => ({
        advise,
      }),
    );

  const dependencies = {
    get_session_facts:
      vi.fn(
        async () => ({
          verified_user_id:
            USER_ID,
        }),
      ),

    resolve_context:
      vi.fn(
        async () => ({
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
              ORGANIZATION_ID,
          },

          owner_user_id:
            USER_ID,
        }),
      ),

    create_advisory_service:
      createAdvisoryService,

    now:
      () =>
        new Date(
          "2026-08-25T15:00:00.000Z",
        ),

    generate_uuid:
      vi.fn()
        .mockReturnValueOnce(
          REQUEST_ID,
        )
        .mockReturnValueOnce(
          CORRELATION_ID,
        )
        .mockReturnValue(
          "80000000-0000-4000-8000-000000000001",
        ),

    logger: {
      error:
        vi.fn(),
    },
  };

  return {
    dependencies,
    advise,
    createAdvisoryService,
  };
}

function request(
  body: unknown = {},
): Request {
  return new Request(
    `https://lvtchat.com/api/capa/${CASE_ID}/intake-advisory`,
    {
      method:
        "POST",

      headers: {
        "content-type":
          "application/json",
      },

      body:
        JSON.stringify(
          body,
        ),
    },
  );
}

describe(
  "CAPA intake advisory route",
  () => {
    it(
      "derives organization and user identity from trusted context",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaIntakeAdvisoryPost(
            request({
              focus:
                "Clarify containment risk.",
            }),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(201);

        expect(
          test.createAdvisoryService,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            tenant: {
              organization_id:
                ORGANIZATION_ID,
            },

            owner_user_id:
              USER_ID,
          }),
        );

        expect(
          test.advise,
        ).toHaveBeenCalledWith({
          organization_id:
            ORGANIZATION_ID,

          capa_case_id:
            CASE_ID,

          user_id:
            USER_ID,

          request_id:
            REQUEST_ID,

          correlation_id:
            CORRELATION_ID,

          request: {
            requested_output:
              "intake_analysis",

            focus:
              "Clarify containment risk.",
          },
        });

        expect(
          response.headers.get(
            "cache-control",
          ),
        ).toBe(
          "no-store",
        );
      },
    );

    it(
      "propagates valid request and correlation identifiers from controlled headers",
      async () => {
        const test =
          setup();

        const headerRequestId =
          "81000000-0000-4000-8000-000000000001";

        const headerCorrelationId =
          "82000000-0000-4000-8000-000000000001";

        const tracedRequest =
          new Request(
            `https://lvtchat.com/api/capa/${CASE_ID}/intake-advisory`,
            {
              method:
                "POST",

              headers: {
                "content-type":
                  "application/json",

                "x-request-id":
                  headerRequestId,

                "x-correlation-id":
                  headerCorrelationId,
              },

              body:
                JSON.stringify({}),
            },
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            tracedRequest,
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(201);

        expect(
          test.advise,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            request_id:
              headerRequestId,

            correlation_id:
              headerCorrelationId,
          }),
        );

        expect(
          await response.json(),
        ).toMatchObject({
          correlation_id:
            headerCorrelationId,
        });
      },
    );

    it(
      "rejects malformed trace identifiers and replaces them with server-generated values",
      async () => {
        const test =
          setup();

        const malformedTraceRequest =
          new Request(
            `https://lvtchat.com/api/capa/${CASE_ID}/intake-advisory`,
            {
              method:
                "POST",

              headers: {
                "content-type":
                  "application/json",

                "x-request-id":
                  "browser-request-id",

                "x-correlation-id":
                  "browser-correlation-id",
              },

              body:
                JSON.stringify({}),
            },
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            malformedTraceRequest,
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(201);

        expect(
          test.advise,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            request_id:
              REQUEST_ID,

            correlation_id:
              CORRELATION_ID,
          }),
        );

        const body =
          await response.json();

        expect(
          body.correlation_id,
        ).toBe(
          CORRELATION_ID,
        );

        expect(
          body.correlation_id,
        ).not.toBe(
          "browser-correlation-id",
        );
      },
    );

    it(
      "returns the governed advisory and correlation identity",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(201);

        expect(
          await response.json(),
        ).toEqual({
          advisory:
            completedAdvisory(),

          snapshot: {
            capa_case_id:
              CASE_ID,

            case_version_id:
              CASE_VERSION_ID,

            record_version:
              RECORD_VERSION,
          },

          correlation_id:
            CORRELATION_ID,
        });
      },
    );

    it(
      "rejects unauthenticated requests before advisory creation",
      async () => {
        const test =
          setup();

        test.dependencies
          .get_session_facts =
          vi.fn(
            async () => null,
          ) as never;

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(401);

        expect(
          test.createAdvisoryService,
        ).not.toHaveBeenCalled();

        expect(
          test.advise,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an invalid CAPA case identifier",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            "not-a-uuid",
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          test.advise,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects browser authority fields",
      async () => {
        const test =
          setup();

        const response =
          await handleCapaIntakeAdvisoryPost(
            request({
              focus:
                "Review containment.",

              organization_id:
                "browser-controlled",

              workflow_state:
                "S90",

              model:
                "browser-model",
            }),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          test.advise,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects malformed JSON",
      async () => {
        const test =
          setup();

        const malformed =
          new Request(
            `https://lvtchat.com/api/capa/${CASE_ID}/intake-advisory`,
            {
              method:
                "POST",

              headers: {
                "content-type":
                  "application/json",
              },

              body:
                "{invalid-json",
            },
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            malformed,
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          test.advise,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "maps advisory authorization denial to HTTP 403",
      async () => {
        const test =
          setup();

        test.advise
          .mockRejectedValueOnce(
            new CapaIntakeAdvisoryServiceError(
              "ADVISORY_ACCESS_DENIED",
            ),
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(403);

        expect(
          await response.json(),
        ).toMatchObject({
          error: {
            code:
              "CAPA_ADVISORY_ACCESS_DENIED",
          },
        });
      },
    );

    it(
      "returns a tenant-safe not-found response",
      async () => {
        const test =
          setup();

        test.advise
          .mockRejectedValueOnce(
            new CapaIntakeAdvisoryServiceError(
              "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
            ),
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(404);

        expect(
          await response.text(),
        ).not.toContain(
          ORGANIZATION_ID,
        );
      },
    );

    it(
      "maps stale or changed CAPA state to HTTP 409",
      async () => {
        const test =
          setup();

        test.advise
          .mockRejectedValueOnce(
            new CapaIntakeAdvisoryServiceError(
              "WORKFLOW_MUTATION_DETECTED",
            ),
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(409);

        expect(
          await response.json(),
        ).toMatchObject({
          error: {
            code:
              "CAPA_ADVISORY_CASE_CHANGED",
          },
        });
      },
    );

    it(
      "maps invalid authenticated session context to HTTP 401",
      async () => {
        const test =
          setup();

        test.dependencies
          .resolve_context =
          vi.fn(
            async () => {
              throw new SupabaseCapaContextError(
                "SESSION_INACTIVE",
              );
            },
          ) as never;

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(401);

        expect(
          await response.json(),
        ).toMatchObject({
          error: {
            code:
              "INVALID_SESSION_CONTEXT",
          },
        });

        expect(
          test.advise,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "maps tenant access denial to HTTP 403 without exposing tenant details",
      async () => {
        const test =
          setup();

        test.dependencies
          .resolve_context =
          vi.fn(
            async () => {
              throw new SupabaseCapaTenantAccessError(
                "NO_ACTIVE_MEMBERSHIP",
              );
            },
          ) as never;

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(403);

        const body =
          await response.text();

        expect(body).toContain(
          "CAPA_TENANT_ACCESS_DENIED",
        );

        expect(body).not.toContain(
          ORGANIZATION_ID,
        );

        expect(
          test.advise,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "maps submitted-intake state conflict to HTTP 409",
      async () => {
        const test =
          setup();

        test.advise
          .mockRejectedValueOnce(
            new CapaIntakeAdvisoryServiceError(
              "CASE_NOT_IN_SUBMITTED_INTAKE",
            ),
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(409);

        expect(
          await response.json(),
        ).toMatchObject({
          error: {
            code:
              "CAPA_ADVISORY_CASE_STATE_CONFLICT",
          },
        });
      },
    );

    it(
      "maps agent ineligibility to HTTP 409",
      async () => {
        const test =
          setup();

        test.advise
          .mockRejectedValueOnce(
            new CapaIntakeAdvisoryServiceError(
              "AGENT_NOT_ELIGIBLE",
            ),
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(409);

        expect(
          await response.json(),
        ).toMatchObject({
          error: {
            code:
              "CAPA_ADVISORY_AGENT_NOT_ELIGIBLE",
          },
        });
      },
    );

    it.each([
      "EVIDENCE_RETRIEVAL_FAILED",
      "ADVISORY_GENERATION_FAILED",
      "INVALID_ADVISORY_RESULT",
      "ADVISORY_PERSISTENCE_FAILED",
    ] as const)(
      "maps internal advisory failure %s to sanitized HTTP 500",
      async (
        reasonCode,
      ) => {
        const test =
          setup();

        test.advise
          .mockRejectedValueOnce(
            new CapaIntakeAdvisoryServiceError(
              reasonCode,
            ),
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(500);

        const body =
          await response.text();

        expect(body).toContain(
          "CAPA_INTERNAL_ERROR",
        );

        expect(body).not.toContain(
          reasonCode,
        );

        expect(
          test.dependencies
            .logger.error,
        ).toHaveBeenCalledOnce();
      },
    );

    it(
      "suppresses unexpected advisory failure details",
      async () => {
        const test =
          setup();

        test.advise
          .mockRejectedValueOnce(
            new Error(
              "secret provider detail",
            ),
          );

        const response =
          await handleCapaIntakeAdvisoryPost(
            request(),
            CASE_ID,
            test.dependencies as never,
          );

        expect(
          response.status,
        ).toBe(500);

        expect(
          await response.text(),
        ).not.toContain(
          "secret provider detail",
        );

        expect(
          test.dependencies
            .logger.error,
        ).toHaveBeenCalledOnce();
      },
    );
  },
);
