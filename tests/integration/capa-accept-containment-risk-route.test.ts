import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CapaRuntime,
} from "../../lib/capa/application/capa-runtime";

import type {
  CapaApiHandlerDependencies,
} from "../../lib/capa/api/capa-route-handler";

import {
  resolveDevelopmentCapaRequestContext,
  type SupabaseCapaSessionFacts,
} from "../../lib/security/supabase-capa-context";

const mocks =
  vi.hoisted(
    () => ({
      accept:
        vi.fn(),
    }),
  );

vi.mock(
  "../../lib/capa/application/accept-capa-containment-risk",
  () => ({
    acceptCapaContainmentRisk:
      mocks.accept,
  }),
);

import {
  handleCapaAcceptContainmentRisk,
} from "../../lib/capa/api/capa-route-handler";

const NOW =
  new Date(
    "2026-08-29T15:00:00.000Z",
  );

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";

const SOURCE_VERSION_ID =
  "20000000-0000-4000-8000-000000000002";

const RESULTING_VERSION_ID =
  "30000000-0000-4000-8000-000000000003";

const CONTAINMENT_RISK_SECTION_ID =
  "40000000-0000-4000-8000-000000000004";

const APPROVAL_AUDIT_ID =
  "50000000-0000-4000-8000-000000000005";

const TRANSITION_AUDIT_ID =
  "60000000-0000-4000-8000-000000000006";

const REQUEST_ID =
  "70000000-0000-4000-8000-000000000007";

const CORRELATION_ID =
  "80000000-0000-4000-8000-000000000008";

const ACCEPT_DEPENDENCIES =
  Object.freeze({
    marker:
      "accept-containment-risk-dependencies",
  });

function sessionFacts():
  SupabaseCapaSessionFacts {
  return {
    verified_user_id:
      USER_ID,

    authenticated_at:
      "2026-08-29T14:00:00.000Z",

    expires_at_epoch_seconds:
      Date.parse(
        "2026-08-29T16:00:00.000Z",
      ) / 1_000,

    verified_aal:
      "aal2",

    verified_reauthenticated_at_epoch_seconds:
      Date.parse(
        "2026-08-29T14:55:00.000Z",
      ) / 1_000,
  };
}

function successfulResult(
  status:
    | "approved"
    | "already_approved" =
      "approved",
) {
  return {
    status,

    capa_case: {
      capa_case_id:
        CASE_ID,

      case_number:
        "CAPA-000001",

      status:
        "S30",

      record_version:
        3,

      current_version_id:
        RESULTING_VERSION_ID,
    },

    case_version: {
      case_version_id:
        RESULTING_VERSION_ID,

      effective_at:
        "2026-08-29T15:00:00.000Z",
    },

    containment_risk_section_version: {
      section_version_id:
        CONTAINMENT_RISK_SECTION_ID,
    },

    approval_audit_event_id:
      APPROVAL_AUDIT_ID,

    transition_audit_event_id:
      TRANSITION_AUDIT_ID,
  };
}

interface Harness {
  readonly dependencies:
    CapaApiHandlerDependencies;

  readonly errors:
    Array<{
      readonly message:
        string;

      readonly metadata?:
        Readonly<
          Record<
            string,
            unknown
          >
        >;
    }>;
}

function harness(
  options: {
    readonly session_facts?:
      SupabaseCapaSessionFacts | null;
  } = {},
): Harness {
  const errors:
    Harness["errors"] = [];

  return {
    errors,

    dependencies: {
      async get_session_facts() {
        return options
          .session_facts ===
          undefined
          ? sessionFacts()
          : options
              .session_facts;
      },

      async resolve_context(
        facts,
        trustedNow,
      ) {
        return resolveDevelopmentCapaRequestContext(
          facts,
          trustedNow,
        );
      },

      get_runtime() {
        return {
          accept_containment_risk_dependencies:
            ACCEPT_DEPENDENCIES,
        } as unknown as
          CapaRuntime;
      },

      now() {
        return NOW;
      },

      generate_uuid() {
        return REQUEST_ID;
      },

      logger: {
        error(
          message,
          metadata,
        ) {
          errors.push({
            message,
            metadata,
          });
        },
      },
    },
  };
}

function validBody() {
  return {
    expected_record_version:
      2,

    expected_current_version_id:
      SOURCE_VERSION_ID,

    containment_risk: {
      problem_statement:
        "Thread depth is below the drawing requirement on sampled units.",
    },

    approval: {
      decision:
        "approve",

      confirmation:
        "G02_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMED",

      rationale:
        "I reviewed the scope and confirm it is adequate for G-02.",
    },
  };
}

function request(
  requestBody: unknown,
  headers:
    HeadersInit = {},
): Request {
  return new Request(
    `http://localhost/api/capa/${CASE_ID}/accept-containment-risk`,
    {
      method:
        "POST",

      headers: {
        "content-type":
          "application/json",

        "x-request-id":
          REQUEST_ID,

        "x-correlation-id":
          CORRELATION_ID,

        "idempotency-key":
          "accept-containment-risk-api-1",

        ...headers,
      },

      body:
        JSON.stringify(
          requestBody,
        ),
    },
  );
}

function rawRequest(
  requestBody:
    string,
): Request {
  return new Request(
    `http://localhost/api/capa/${CASE_ID}/accept-containment-risk`,
    {
      method:
        "POST",

      headers: {
        "content-type":
          "application/json",

        "x-request-id":
          REQUEST_ID,

        "x-correlation-id":
          CORRELATION_ID,

        "idempotency-key":
          "accept-containment-risk-api-1",
      },

      body:
        requestBody,
    },
  );
}

function isRecord(
  value: unknown,
): value is Readonly<
  Record<string, unknown>
> {
  return (
    typeof value ===
      "object" &&
    value !== null &&
    !Array.isArray(
      value,
    )
  );
}

async function responseBody(
  response:
    Response,
): Promise<
  Readonly<
    Record<string, unknown>
  >
> {
  const value:
    unknown =
      await response.json();

  if (!isRecord(value)) {
    throw new Error(
      "Expected an object response body.",
    );
  }

  return value;
}

beforeEach(() => {
  mocks.accept.mockReset();

  mocks.accept.mockResolvedValue(
    successfulResult(),
  );
});

describe(
  "CAPA G-02 scope-approval handler",
  () => {
    it(
      "returns 401 without an authenticated session",
      async () => {
        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              validBody(),
            ),

            CASE_ID,

            harness({
              session_facts:
                null,
            }).dependencies,
          );

        expect(
          response.status,
        ).toBe(401);

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code:
              "UNAUTHORIZED",
          },
        });

        expect(
          mocks.accept,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 401 for invalid verified session context",
      async () => {
        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              validBody(),
            ),

            CASE_ID,

            harness({
              session_facts: {
                ...sessionFacts(),

                verified_user_id:
                  "not-a-uuid",
              },
            }).dependencies,
          );

        expect(
          response.status,
        ).toBe(401);

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code:
              "INVALID_SESSION_CONTEXT",
          },
        });
      },
    );

    it.each([
      "not-a-uuid",
      ` ${CASE_ID} `,
    ])(
      "rejects invalid path case id %#",
      async (
        caseId,
      ) => {
        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              validBody(),
            ),

            caseId,

            harness()
              .dependencies,
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code:
              "INVALID_CAPA_CASE_ID",
          },
        });
      },
    );

    it(
      "rejects malformed JSON",
      async () => {
        const response =
          await handleCapaAcceptContainmentRisk(
            rawRequest(
              "{invalid",
            ),

            CASE_ID,

            harness()
              .dependencies,
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code:
              "INVALID_JSON",
          },
        });

        expect(
          mocks.accept,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([null, "", "x".repeat(129)])(
      "rejects missing or invalid idempotency key %#",
      async (key) => {
        const headers = new Headers({
          "content-type": "application/json",
          "x-request-id": REQUEST_ID,
          "x-correlation-id": CORRELATION_ID,
        });
        if (key !== null) headers.set("idempotency-key", key);
        const response = await handleCapaAcceptContainmentRisk(
          new Request(`http://localhost/api/capa/${CASE_ID}/accept-containment-risk`, {
            method: "POST",
            headers,
            body: JSON.stringify(validBody()),
          }),
          CASE_ID,
          harness().dependencies,
        );
        expect(response.status).toBe(400);
        expect(await responseBody(response)).toMatchObject({
          error: { code: "INVALID_IDEMPOTENCY_KEY" },
        });
        expect(mocks.accept).not.toHaveBeenCalled();
      },
    );

    it.each([
      null,
      [],
      {},
      {
        ...validBody(),
        unexpected:
          true,
      },
      {
        ...validBody(),
        expected_record_version:
          0,
      },
      {
        ...validBody(),
        expected_record_version:
          1.5,
      },
      {
        ...validBody(),
        expected_current_version_id:
          "not-a-uuid",
      },
      {
        expected_record_version:
          2,
        expected_current_version_id:
          SOURCE_VERSION_ID,
        approval:
          validBody()
            .approval,
      },
    ])(
      "rejects invalid scope-approval envelope %#",
      async (
        invalidBody,
      ) => {
        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              invalidBody,
            ),

            CASE_ID,

            harness()
              .dependencies,
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code:
              "INVALID_CAPA_CONTAINMENT_RISK_ACCEPTANCE",
          },
        });

        expect(
          mocks.accept,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        applicationStatus:
          "approved",
        replayed:
          false,
      },
      {
        applicationStatus:
          "already_approved",
        replayed:
          true,
      },
    ] as const)(
      "returns 200 for $applicationStatus",
      async ({
        applicationStatus,
        replayed,
      }) => {
        mocks.accept.mockResolvedValue(
          successfulResult(
            applicationStatus,
          ),
        );

        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              validBody(),
            ),

            CASE_ID,

            harness()
              .dependencies,
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          capa: {
            capa_case_id:
              CASE_ID,

            case_number:
              "CAPA-000001",

            status:
              "S30",

            record_version:
              3,

            current_version_id:
              RESULTING_VERSION_ID,

            accepted_version_id:
              RESULTING_VERSION_ID,

            containment_risk_section_version_id:
              CONTAINMENT_RISK_SECTION_ID,

            accepted_at:
              "2026-08-29T15:00:00.000Z",

            decision_audit_event_id:
              APPROVAL_AUDIT_ID,

            transition_audit_event_id:
              TRANSITION_AUDIT_ID,
          },

          replayed,

          correlation_id:
            CORRELATION_ID,
        });

        expect(
          mocks.accept,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            marker:
              "accept-containment-risk-dependencies",
          }),

          expect.objectContaining({
            capa_case_id:
              CASE_ID,

            expected_record_version:
              2,

            expected_current_version_id:
              SOURCE_VERSION_ID,

            request_trace:
              expect.objectContaining({
                idempotency_key:
                  "accept-containment-risk-api-1",
              }),

            body: {
              containment_risk:
                validBody()
                  .containment_risk,

              approval:
                validBody()
                  .approval,
            },
          }),
        );
      },
    );

    it.each([
      {
        result: {
          status:
            "validation_failed",

          reason_code:
            "INVALID_APPROVAL",
        },

        httpStatus:
          400,

        code:
          "CAPA_CONTAINMENT_RISK_ACCEPTANCE_VALIDATION_FAILED",
      },
      {
        result: {
          status:
            "gate_blocked",

          blocker_codes: [
            "MISSING_PRIORITY",
          ],
        },

        httpStatus:
          409,

        code:
          "CAPA_CONTAINMENT_RISK_GATE_BLOCKED",
      },
      {
        result: {
          status:
            "authorization_denied",

          reason_code:
            "DENIED",

          policy_version:
            "policy-1.0.0",
        },

        httpStatus:
          403,

        code:
          "CAPA_ACCESS_DENIED",
      },
      {
        result: {
          status:
            "step_up_required",

          reason_code:
            "MFA_REQUIRED",

          policy_version:
            "policy-1.0.0",

          required_assurance:
            "MFA",
        },

        httpStatus:
          403,

        code:
          "CAPA_STEP_UP_REQUIRED",
      },
      {
        result: {
          status:
            "not_found_or_not_authorized",
        },

        httpStatus:
          404,

        code:
          "CAPA_NOT_FOUND",
      },
      {
        result: {
          status:
            "idempotency_conflict",

          reason_code:
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        },

        httpStatus:
          409,

        code:
          "CAPA_IDEMPOTENCY_CONFLICT",
      },
      {
        result: {
          status:
            "concurrency_conflict",

          reason_code:
            "RECORD_VERSION_CONFLICT",
        },

        httpStatus:
          409,

        code:
          "CAPA_CONCURRENCY_CONFLICT",
      },
      {
        result: {
          status:
            "workflow_conflict",

          reason_code:
            "WORKFLOW_STATE_NOT_ALLOWED",
        },

        httpStatus:
          409,

        code:
          "CAPA_WORKFLOW_CONFLICT",
      },
    ])(
      "maps $result.status to $httpStatus $code",
      async ({
        result,
        httpStatus,
        code,
      }) => {
        mocks.accept.mockResolvedValue(
          result,
        );

        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              validBody(),
            ),

            CASE_ID,

            harness()
              .dependencies,
          );

        expect(
          response.status,
        ).toBe(
          httpStatus,
        );

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code,
          },
        });
      },
    );

    it(
      "returns controlled G-02 blocker codes as response issues",
      async () => {
        mocks.accept.mockResolvedValue({
          status:
            "gate_blocked",

          blocker_codes: [
            "MISSING_PRIORITY",
            "UNRESOLVED_SCOPE_GAPS",
          ],
        });

        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              validBody(),
            ),

            CASE_ID,

            harness()
              .dependencies,
          );

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code:
              "CAPA_CONTAINMENT_RISK_GATE_BLOCKED",

            issues: [
              {
                path:
                  "containment_risk",

                message:
                  "MISSING_PRIORITY",
              },
              {
                path:
                  "containment_risk",

                message:
                  "UNRESOLVED_SCOPE_GAPS",
              },
            ],
          },
        });
      },
    );

    it(
      "returns and logs a safe unexpected error",
      async () => {
        const testHarness =
          harness();

        mocks.accept.mockRejectedValue(
          new Error(
            "Sensitive database details",
          ),
        );

        const response =
          await handleCapaAcceptContainmentRisk(
            request(
              validBody(),
            ),

            CASE_ID,

            testHarness
              .dependencies,
          );

        expect(
          response.status,
        ).toBe(500);

        expect(
          await responseBody(
            response,
          ),
        ).toMatchObject({
          error: {
            code:
              "CAPA_INTERNAL_ERROR",

            message:
              "The CAPA request could not be completed.",
          },
        });

        expect(
          testHarness.errors,
        ).toEqual([
          {
            message:
              "CAPA API containment/risk acceptance failed.",

            metadata: {
              correlation_id:
                CORRELATION_ID,

              error_name:
                "Error",
            },
          },
        ]);
      },
    );
  },
);
