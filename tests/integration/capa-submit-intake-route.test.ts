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

const mocks = vi.hoisted(
  () => ({
    submit:
      vi.fn(),
  }),
);

vi.mock(
  "../../lib/capa/application/submit-capa-intake",
  () => ({
    submitCapaIntake:
      mocks.submit,
  }),
);

import {
  handleCapaSubmitIntake,
} from "../../lib/capa/api/capa-route-handler";

const NOW =
  new Date(
    "2026-08-23T16:00:00.000Z",
  );

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";

const SOURCE_VERSION_ID =
  "20000000-0000-4000-8000-000000000002";

const RESULTING_VERSION_ID =
  "30000000-0000-4000-8000-000000000003";

const AUDIT_EVENT_ID =
  "40000000-0000-4000-8000-000000000004";

const REQUEST_ID =
  "50000000-0000-4000-8000-000000000005";

const CORRELATION_ID =
  "60000000-0000-4000-8000-000000000006";

function sessionFacts():
  SupabaseCapaSessionFacts {
  return {
    verified_user_id:
      USER_ID,
    authenticated_at:
      "2026-08-23T15:00:00.000Z",
    expires_at_epoch_seconds:
      Date.parse(
        "2026-08-23T17:00:00.000Z",
      ) / 1_000,
  };
}

function successfulResult(
  status:
    | "submitted"
    | "already_submitted" =
      "submitted",
) {
  return {
    status,
    capa_case: {
      capa_case_id:
        CASE_ID,
      case_number:
        "CAPA-000001",
      status: "S10",
      record_version: 2,
      current_version_id:
        RESULTING_VERSION_ID,
    },
    case_version: {
      case_version_id:
        RESULTING_VERSION_ID,
      effective_at:
        "2026-08-23T16:00:00.000Z",
    },
    audit_event_id:
      AUDIT_EVENT_ID,
  };
}

interface Harness {
  readonly dependencies:
    CapaApiHandlerDependencies;
  readonly errors: Array<{
    readonly message: string;
    readonly metadata?: Readonly<
      Record<string, unknown>
    >;
  }>;
}

function harness(
  options: {
    readonly session_facts?:
      SupabaseCapaSessionFacts | null;
  } = {},
): Harness {
  const errors: Harness["errors"] =
    [];

  return {
    errors,
    dependencies: {
      async get_session_facts() {
        return options.session_facts ===
          undefined
          ? sessionFacts()
          : options.session_facts;
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
          submit_intake_dependencies: {
            marker:
              "submit-dependencies",
          },
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
        error(message, metadata) {
          errors.push({
            message,
            metadata,
          });
        },
      },
    },
  };
}

function request(
  body: unknown,
  headers: HeadersInit = {},
): Request {
  return new Request(
    `http://localhost/api/capa/${CASE_ID}/submit-intake`,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
        "x-request-id":
          REQUEST_ID,
        "x-correlation-id":
          CORRELATION_ID,
        "idempotency-key":
          "submit-intake-api-1",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function rawRequest(
  body: string,
): Request {
  return new Request(
    `http://localhost/api/capa/${CASE_ID}/submit-intake`,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
      },
      body,
    },
  );
}

function validBody() {
  return {
    expected_record_version: 1,
    expected_current_version_id:
      SOURCE_VERSION_ID,
  };
}

async function body(
  response: Response,
): Promise<Record<string, any>> {
  return response.json() as Promise<
    Record<string, any>
  >;
}

beforeEach(() => {
  mocks.submit.mockReset();
  mocks.submit.mockResolvedValue(
    successfulResult(),
  );
});

describe(
  "CAPA intake-submission handler",
  () => {
    it(
      "returns 401 without an authenticated session",
      async () => {
        const response =
          await handleCapaSubmitIntake(
            request(validBody()),
            CASE_ID,
            harness({
              session_facts: null,
            }).dependencies,
          );

        expect(response.status).toBe(401);
        expect(await body(response))
          .toMatchObject({
            error: {
              code: "UNAUTHORIZED",
            },
          });
        expect(mocks.submit)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "returns 401 for an invalid verified session context",
      async () => {
        const response =
          await handleCapaSubmitIntake(
            request(validBody()),
            CASE_ID,
            harness({
              session_facts: {
                ...sessionFacts(),
                verified_user_id:
                  "not-a-uuid",
              },
            }).dependencies,
          );

        expect(response.status).toBe(401);
        expect(await body(response))
          .toMatchObject({
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
      async (caseId) => {
        const response =
          await handleCapaSubmitIntake(
            request(validBody()),
            caseId,
            harness().dependencies,
          );

        expect(response.status).toBe(400);
        expect(await body(response))
          .toMatchObject({
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
          await handleCapaSubmitIntake(
            rawRequest("{invalid"),
            CASE_ID,
            harness().dependencies,
          );

        expect(response.status).toBe(400);
        expect(await body(response))
          .toMatchObject({
            error: {
              code: "INVALID_JSON",
            },
          });
      },
    );

    it.each([
      null,
      [],
      {},
      {
        ...validBody(),
        unexpected: true,
      },
      {
        ...validBody(),
        expected_record_version: 0,
      },
      {
        ...validBody(),
        expected_record_version: 1.5,
      },
      {
        ...validBody(),
        expected_record_version: "1",
      },
      {
        ...validBody(),
        expected_current_version_id: 42,
      },
      {
        ...validBody(),
        expected_current_version_id:
          "not-a-uuid",
      },
      {
        ...validBody(),
        expected_current_version_id:
          ` ${SOURCE_VERSION_ID} `,
      },
    ])(
      "rejects invalid submission body %#",
      async (invalidBody) => {
        const response =
          await handleCapaSubmitIntake(
            request(invalidBody),
            CASE_ID,
            harness().dependencies,
          );

        expect(response.status).toBe(400);
        expect(await body(response))
          .toMatchObject({
            error: {
              code:
                "INVALID_CAPA_SUBMISSION",
            },
          });
        expect(mocks.submit)
          .not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        applicationStatus:
          "submitted",
        replayed: false,
      },
      {
        applicationStatus:
          "already_submitted",
        replayed: true,
      },
    ] as const)(
      "returns 200 for $applicationStatus",
      async ({
        applicationStatus,
        replayed,
      }) => {
        mocks.submit.mockResolvedValue(
          successfulResult(
            applicationStatus,
          ),
        );

        const response =
          await handleCapaSubmitIntake(
            request(validBody()),
            CASE_ID,
            harness().dependencies,
          );

        expect(response.status).toBe(200);
        expect(await body(response))
          .toMatchObject({
            capa: {
              capa_case_id:
                CASE_ID,
              case_number:
                "CAPA-000001",
              status: "S10",
              record_version: 2,
              current_version_id:
                RESULTING_VERSION_ID,
              submitted_version_id:
                RESULTING_VERSION_ID,
              submitted_at:
                "2026-08-23T16:00:00.000Z",
              audit_event_id:
                AUDIT_EVENT_ID,
            },
            replayed,
            correlation_id:
              CORRELATION_ID,
          });

        expect(mocks.submit)
          .toHaveBeenCalledWith(
            expect.objectContaining({
              marker:
                "submit-dependencies",
            }),
            expect.objectContaining({
              capa_case_id:
                CASE_ID,
              expected_record_version: 1,
              expected_current_version_id:
                SOURCE_VERSION_ID,
              request_trace:
                expect.objectContaining({
                  idempotency_key:
                    "submit-intake-api-1",
                }),
            }),
          );
      },
    );

    it.each([
      {
        result: {
          status:
            "authorization_denied",
          reason_code: "DENIED",
          policy_version:
            "policy-1.0.0",
        },
        httpStatus: 403,
        code: "CAPA_ACCESS_DENIED",
      },
      {
        result: {
          status:
            "step_up_required",
          reason_code:
            "MFA_REQUIRED",
          policy_version:
            "policy-1.0.0",
          required_assurance: "MFA",
        },
        httpStatus: 403,
        code:
          "CAPA_STEP_UP_REQUIRED",
      },
      {
        result: {
          status:
            "not_found_or_not_authorized",
        },
        httpStatus: 404,
        code: "CAPA_NOT_FOUND",
      },
      {
        result: {
          status:
            "idempotency_conflict",
          reason_code:
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        },
        httpStatus: 409,
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
        httpStatus: 409,
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
        httpStatus: 409,
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
        mocks.submit.mockResolvedValue(
          result,
        );

        const response =
          await handleCapaSubmitIntake(
            request(validBody()),
            CASE_ID,
            harness().dependencies,
          );

        expect(response.status).toBe(
          httpStatus,
        );
        expect(await body(response))
          .toMatchObject({
            error: { code },
          });
      },
    );

    it(
      "returns and logs a safe unexpected error",
      async () => {
        const testHarness = harness();

        mocks.submit.mockRejectedValue(
          new Error(
            "Sensitive database details",
          ),
        );

        const response =
          await handleCapaSubmitIntake(
            request(validBody()),
            CASE_ID,
            testHarness.dependencies,
          );

        expect(response.status).toBe(500);
        expect(await body(response))
          .toMatchObject({
            error: {
              code:
                "CAPA_INTERNAL_ERROR",
              message:
                "The CAPA request could not be completed.",
            },
          });
        expect(testHarness.errors)
          .toEqual([
            {
              message:
                "CAPA API intake submission failed.",
              metadata: {
                correlation_id:
                  CORRELATION_ID,
                error_name: "Error",
              },
            },
          ]);
      },
    );
  },
);
