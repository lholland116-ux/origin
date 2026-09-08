import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ControlledCode,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaPolicyDecision,
} from "../../lib/capa/authorization/capa-policy";

import type {
  CapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";

import {
  createCapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";

import {
  handleCapaGet,
  handleCapaPost,
  type CapaApiHandlerDependencies,
} from "../../lib/capa/api/capa-route-handler";

import {
  resolveDevelopmentCapaRequestContext,
  type SupabaseCapaSessionFacts,
} from "../../lib/security/supabase-capa-context";

import {
  SupabaseCapaTenantAccessError,
} from "../../lib/security/supabase-capa-durable-context";

import {
  CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SECTION_TYPE,
} from "../../lib/capa/domain/capa-root-cause-review-return-response";

const NOW =
  new Date("2026-08-12T14:00:00.000Z");

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

const REQUEST_ID =
  "98e82790-e9f9-4b3d-a7eb-ed0e99c3d444";

const CORRELATION_ID =
  "c206f86c-2ba7-490e-bbfd-e31f562c4f30";

const PROJECTION_RETURN_RESPONSE_SECTION_ID =
  "70000000-0000-4000-8000-000000000009";

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function allowDecision():
  CapaPolicyDecision {
  return {
    decision: "allow",
    reason_code:
      controlled("TEST_ALLOWED"),
    policy_version:
      "test-policy-1",
    evaluated_at:
      NOW.toISOString() as
        CapaPolicyDecision["evaluated_at"],
    relied_on_role_assignment_ids: [],
  };
}

function uuidGenerator(): () => string {
  let sequence = 0;

  return () => {
    sequence += 1;

    return `00000000-0000-4000-8000-${String(
      sequence,
    ).padStart(12, "0")}`;
  };
}

function validSessionFacts():
  SupabaseCapaSessionFacts {
  return {
    verified_user_id: USER_ID,
    authenticated_at:
      "2026-08-12T13:00:00.000Z",
    expires_at_epoch_seconds:
      Date.parse(
        "2026-08-12T15:00:00.000Z",
      ) / 1_000,
  };
}

function validBody() {
  return {
    initiating_event:
      "Seal defects exceeded the approved alert threshold.",
    source: {
      source_type: "NONCONFORMANCE",
      source_reference:
        "NCR-2026-0042",
    },
    organization_reference:
      "CAPA-LOCAL-19",
  };
}

function runtime(
  decision?: CapaPolicyDecision,
): CapaDevelopmentRuntime {
  const created =
    createCapaDevelopmentRuntime({
      environment: "test",
      now: () => NOW,
      generate_uuid:
        uuidGenerator(),
    });

  if (decision === undefined) {
    return created;
  }

  const authorizationPolicy = {
    async evaluate() {
      return decision;
    },
  };

  return {
    ...created,

    dependencies: {
      ...created.dependencies,
      authorization_policy:
        authorizationPolicy,
    },

    submit_intake_dependencies: {
      ...created
        .submit_intake_dependencies,
      authorization_policy:
        authorizationPolicy,
    },
  };
}

interface Harness {
  readonly dependencies:
    CapaApiHandlerDependencies;
  readonly runtime:
    CapaDevelopmentRuntime;
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
    readonly runtime?:
      CapaDevelopmentRuntime;
    readonly get_runtime_error?: unknown;
    readonly resolve_context_error?:
      unknown;
  } = {},
): Harness {
  const selectedRuntime =
    options.runtime ?? runtime();

  const errors: Harness["errors"] = [];

  const generatedUuid =
    uuidGenerator();

  return {
    runtime: selectedRuntime,
    errors,

    dependencies: {
      async get_session_facts() {
        return options.session_facts ===
          undefined
          ? validSessionFacts()
          : options.session_facts;
      },

      async resolve_context(
        facts,
        trustedNow,
      ) {
        if (
          "resolve_context_error" in
          options
        ) {
          throw options
            .resolve_context_error;
        }

        return resolveDevelopmentCapaRequestContext(
          facts,
          trustedNow,
        );
      },

      get_runtime() {
        if (
          "get_runtime_error" in options
        ) {
          throw options.get_runtime_error;
        }

        return selectedRuntime;
      },

      now() {
        return NOW;
      },

      generate_uuid:
        generatedUuid,

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

function postRequest(
  body: unknown,
  headers: HeadersInit = {},
): Request {
  return new Request(
    "http://localhost/api/capa",
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function rawPostRequest(
  body: string,
): Request {
  return new Request(
    "http://localhost/api/capa",
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

function getRequest(
  caseId?: string,
  headers: HeadersInit = {},
): Request {
  const url = new URL(
    "http://localhost/api/capa",
  );

  if (caseId !== undefined) {
    url.searchParams.set("id", caseId);
  }

  return new Request(url, {
    method: "GET",
    headers,
  });
}

const PROJECTION_CASE_ID =
  "70000000-0000-4000-8000-000000000001";
const PROJECTION_VERSION_ID =
  "70000000-0000-4000-8000-000000000002";
const PROJECTION_SECTION_ID =
  "70000000-0000-4000-8000-000000000003";
const PROJECTION_ACTOR_ID =
  "70000000-0000-4000-8000-000000000004";

function rootCauseReturnTransition(
  overrides: Record<string, unknown> = {},
) {
  return {
    event_id:
      "70000000-0000-4000-8000-000000000005",
    organization_id: USER_ID,
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    idempotency_key: "audit-idempotency-key",
    event_type: "EVT-STATE-TRANSITION",
    schema_version: "audit-schema-1.0.0",
    aggregate_type: "CAPA_CASE",
    aggregate_id: PROJECTION_CASE_ID,
    aggregate_version: 9,
    actor: {
      actor_type: "human",
      actor_id: PROJECTION_ACTOR_ID,
    },
    occurred_at: "2026-09-08T12:00:00.000Z",
    action: "DECIDE_CAPA_ROOT_CAUSE_GATE",
    target: {
      object_type: "CAPA_CASE",
      object_id: PROJECTION_CASE_ID,
      object_version_id: PROJECTION_VERSION_ID,
    },
    outcome: "succeeded",
    reason: "Additional evidence is required before root-cause approval.",
    change: {
      before_ref: {
        object_type: "CAPA_CASE_VERSION",
        object_id: PROJECTION_CASE_ID,
        object_version_id:
          "70000000-0000-4000-8000-000000000006",
      },
      after_ref: {
        object_type: "CAPA_CASE_VERSION",
        object_id: PROJECTION_CASE_ID,
        object_version_id: PROJECTION_VERSION_ID,
      },
    },
    configuration_versions: {},
    metadata: {
      from_state: "S50",
      to_state: "S40",
      rationale:
        "Additional evidence is required before root-cause approval.",
    },
    ...overrides,
  } as never;
}

function projectionRuntime(
  pages: readonly (readonly unknown[])[],
  status: "S40" | "S50" = "S40",
  includeReturnResponse = false,
) {
  const selected = runtime();
  const database = Object.create(selected.database) as any;
  database.findCaseById = async () => ({
    organization_id: USER_ID,
    capa_case_id: PROJECTION_CASE_ID,
    case_number: "CAPA-000010",
    current_version_id: PROJECTION_VERSION_ID,
    status,
    record_version: 9,
    owner_user_id: USER_ID,
    confidentiality: "CUSTOMER_CONFIDENTIAL",
    effective_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    created_by: { actor_type: "human", actor_id: USER_ID },
    updated_by: { actor_type: "human", actor_id: USER_ID },
  });
  database.findCaseVersionById = async () => ({
    organization_id: USER_ID,
    capa_case_id: PROJECTION_CASE_ID,
    case_version_id: PROJECTION_VERSION_ID,
    version_number: 9,
    status,
    section_version_ids: [
      PROJECTION_SECTION_ID,
      ...(includeReturnResponse
        ? [PROJECTION_RETURN_RESPONSE_SECTION_ID]
        : []),
    ],
    change_reason: "Qualification fixture",
    effective_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
    created_by: { actor_type: "human", actor_id: USER_ID },
  });
  database.findSectionVersionById = async (_organizationId: string, _caseId: string, sectionVersionId: string) =>
    sectionVersionId === PROJECTION_RETURN_RESPONSE_SECTION_ID
      ? {
          organization_id: USER_ID,
          capa_case_id: PROJECTION_CASE_ID,
          section_version_id: PROJECTION_RETURN_RESPONSE_SECTION_ID,
          section_type: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SECTION_TYPE,
          version_number: 1,
          schema_version: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
          content: {
            schema_version: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
            response_summary: "The reviewer concerns were addressed.",
            actions_taken: "Reviewed additional evidence.",
            disposition: "addressed",
            supporting_evidence_item_ids: [],
            return_transition_audit_event_id: "70000000-0000-4000-8000-000000000001",
            source_case_version_id: "70000000-0000-4000-8000-000000000006",
            resulting_case_version_id: PROJECTION_VERSION_ID,
            responded_by: { actor_type: "human", actor_id: PROJECTION_ACTOR_ID },
            responded_at: "2026-09-08T13:24:08.315Z",
          },
          change_reason: "Qualification fixture",
          effective_at: NOW.toISOString(),
          created_at: NOW.toISOString(),
          created_by: { actor_type: "human", actor_id: USER_ID },
        }
      : {
          organization_id: USER_ID,
          capa_case_id: PROJECTION_CASE_ID,
          section_version_id: PROJECTION_SECTION_ID,
          section_type: "CAPA.INTAKE",
          version_number: 1,
          schema_version: "capa-intake-1.0.0",
          content: validBody(),
          change_reason: "Qualification fixture",
          effective_at: NOW.toISOString(),
          created_at: NOW.toISOString(),
          created_by: { actor_type: "human", actor_id: USER_ID },
        };

  const auditRepository = Object.create(
    selected.decide_root_cause_gate_dependencies.audit_repository,
  ) as any;
  auditRepository.listEventsForAggregate = vi.fn(async (query: { readonly cursor?: string }) => {
    const pageIndex = query.cursor === undefined ? 0 : Number(query.cursor);
    const events = pages[pageIndex] ?? [];
    return {
      events,
      ...(pages[pageIndex + 1] === undefined ? {} : { next_cursor: String(pageIndex + 1) }),
    };
  });

  return {
    ...selected,
    database,
    decide_root_cause_gate_dependencies: {
      ...selected.decide_root_cause_gate_dependencies,
      audit_repository: auditRepository,
    },
  } as CapaDevelopmentRuntime;
}

function listRequest(
  parameters:
    Readonly<
      Record<
        string,
        string | undefined
      >
    > = {},
  headers: HeadersInit = {},
): Request {
  const url = new URL(
    "http://localhost/api/capa",
  );

  for (const [name, value] of
    Object.entries(parameters)) {
    if (value === undefined) {
      continue;
    }

    url.searchParams.set(
      name,
      value,
    );
  }

  return new Request(url, {
    method: "GET",
    headers,
  });
}

async function responseBody(
  response: Response,
): Promise<Record<string, any>> {
  return response.json() as Promise<
    Record<string, any>
  >;
}

describe("CAPA POST handler", () => {
  it(
    "returns 401 when no authenticated session exists",
    async () => {
      const testHarness = harness({
        session_facts: null,
      });

      const response =
        await handleCapaPost(
          postRequest(validBody()),
          testHarness.dependencies,
        );

      expect(response.status).toBe(401);
      expect(
        response.headers.get(
          "cache-control",
        ),
      ).toBe("no-store");

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code: "UNAUTHORIZED",
          message:
            "Authentication is required.",
        },
      });
    },
  );

  it(
    "returns 401 for an invalid verified session context",
    async () => {
      const testHarness = harness({
        session_facts: {
          ...validSessionFacts(),
          expires_at_epoch_seconds:
            NOW.getTime() / 1_000,
        },
      });

      const response =
        await handleCapaPost(
          postRequest(validBody()),
          testHarness.dependencies,
        );

      expect(response.status).toBe(401);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "INVALID_SESSION_CONTEXT",
        },
      });
    },
  );

  it(
    "returns tenant-safe 403 when durable membership cannot be resolved",
    async () => {
      const testHarness = harness({
        resolve_context_error:
          new SupabaseCapaTenantAccessError(
            "NO_ACTIVE_MEMBERSHIP",
          ),
      });

      const response =
        await handleCapaPost(
          postRequest(validBody()),
          testHarness.dependencies,
        );

      expect(response.status).toBe(403);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "CAPA_TENANT_ACCESS_DENIED",
          message:
            "The authenticated user is not authorized to access a CAPA organization.",
        },
      });

      expect(
        testHarness.errors,
      ).toHaveLength(1);

      expect(
        testHarness.errors[0],
      ).toMatchObject({
        message:
          "CAPA API tenant context resolution denied.",
        metadata: {
          correlation_id:
            expect.any(String),
          error_name:
            "SupabaseCapaTenantAccessError",
          reason_code:
            "NO_ACTIVE_MEMBERSHIP",
        },
      });
    },
  );

  it(
    "rejects malformed JSON",
    async () => {
      const response =
        await handleCapaPost(
          rawPostRequest("{invalid"),
          harness().dependencies,
        );

      expect(response.status).toBe(400);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code: "INVALID_JSON",
        },
      });
    },
  );

  it(
    "returns controlled field-validation issues",
    async () => {
      const response =
        await handleCapaPost(
          postRequest({
            initiating_event: "   ",
            source: {
              source_type:
                "INVALID SOURCE",
            },
          }),
          harness().dependencies,
        );

      expect(response.status).toBe(400);

      const body =
        await responseBody(response);

      expect(body).toMatchObject({
        error: {
          code:
            "CAPA_VALIDATION_FAILED",
          message:
            "The CAPA request contains invalid fields.",
        },
      });

      expect(
        body.error.issues.length,
      ).toBeGreaterThan(0);
    },
  );

  it(
    "returns a controlled policy denial",
    async () => {
      const testRuntime = runtime({
        decision: "deny",
        reason_code:
          controlled("DENIED"),
        policy_version:
          "test-policy-1",
        evaluated_at:
          "2026-08-12T14:00:00.000Z" as
            CapaPolicyDecision["evaluated_at"],
      });

      const response =
        await handleCapaPost(
          postRequest(validBody()),
          harness({
            runtime: testRuntime,
          }).dependencies,
        );

      expect(response.status).toBe(403);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "CAPA_ACCESS_DENIED",
        },
      });
    },
  );

  it(
    "returns a controlled step-up response",
    async () => {
      const testRuntime = runtime({
        decision: "step_up",
        reason_code:
          controlled("MFA_REQUIRED"),
        policy_version:
          "test-policy-1",
        evaluated_at:
          "2026-08-12T14:00:00.000Z" as
            CapaPolicyDecision["evaluated_at"],
        required_assurance:
          controlled(
            "PHISHING_RESISTANT_MFA",
          ),
      });

      const response =
        await handleCapaPost(
          postRequest(validBody()),
          harness({
            runtime: testRuntime,
          }).dependencies,
        );

      expect(response.status).toBe(403);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "CAPA_STEP_UP_REQUIRED",
        },
      });
    },
  );

  it(
    "creates a CAPA with controlled trace headers",
    async () => {
      const testHarness = harness();

      const response =
        await handleCapaPost(
          postRequest(validBody(), {
            "x-request-id":
              REQUEST_ID,
            "x-correlation-id":
              CORRELATION_ID,
            "idempotency-key":
              "create-capa-browser-1",
          }),
          testHarness.dependencies,
        );

      expect(response.status).toBe(201);

      const body =
        await responseBody(response);

      expect(body).toMatchObject({
        capa: {
          case_number:
            "CAPA-000001",
          status: "S00",
          record_version: 1,
        },
        correlation_id:
          CORRELATION_ID,
      });

      expect(
        body.capa.capa_case_id,
      ).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
    },
  );

  it(
    "replaces invalid tracing and idempotency headers",
    async () => {
      const response =
        await handleCapaPost(
          postRequest(validBody(), {
            "x-request-id":
              "not-a-uuid",
            "x-correlation-id":
              "not-a-uuid",
            "idempotency-key":
              "x".repeat(129),
          }),
          harness().dependencies,
        );

      expect(response.status).toBe(201);

      const body =
        await responseBody(response);

      expect(
        body.correlation_id,
      ).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
    },
  );

  it(
    "replaces an empty idempotency key",
    async () => {
      const response =
        await handleCapaPost(
          postRequest(validBody(), {
            "idempotency-key": "   ",
          }),
          harness().dependencies,
        );

      expect(response.status).toBe(201);
    },
  );

  it(
    "returns a safe error for an unexpected Error",
    async () => {
      const testHarness = harness({
        get_runtime_error:
          new Error(
            "Sensitive database details",
          ),
      });

      const response =
        await handleCapaPost(
          postRequest(validBody()),
          testHarness.dependencies,
        );

      expect(response.status).toBe(500);

      expect(
        await responseBody(response),
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
      ).toHaveLength(1);

      expect(
        testHarness.errors[0].metadata,
      ).toMatchObject({
        error_name: "Error",
      });

      expect(
        JSON.stringify(
          await responseBody(
            new Response(
              JSON.stringify({
                safe: true,
              }),
            ),
          ),
        ),
      ).not.toContain(
        "Sensitive database details",
      );
    },
  );

  it(
    "returns the authoritative CAPA with 200 for an exact creation retry",
    async () => {
      const testHarness = harness();
      const headers = {
        "x-request-id":
          REQUEST_ID,
        "x-correlation-id":
          CORRELATION_ID,
        "idempotency-key":
          "route-exact-retry-1",
      };

      const firstResponse =
        await handleCapaPost(
          postRequest(
            validBody(),
            headers,
          ),
          testHarness.dependencies,
        );

      const retryResponse =
        await handleCapaPost(
          postRequest(
            validBody(),
            headers,
          ),
          testHarness.dependencies,
        );

      expect(firstResponse.status)
        .toBe(201);
      expect(retryResponse.status)
        .toBe(200);

      const firstBody =
        await responseBody(
          firstResponse,
        );
      const retryBody =
        await responseBody(
          retryResponse,
        );

      expect(retryBody.capa)
        .toEqual(firstBody.capa);
      expect(retryBody.correlation_id)
        .toBe(CORRELATION_ID);

      const page =
        await testHarness.runtime
          .database.listCases({
            organization_id:
              resolveDevelopmentCapaRequestContext(
                validSessionFacts(),
                NOW,
              ).tenant.organization_id,
            limit: 100,
          });

      expect(page.cases)
        .toHaveLength(1);
    },
  );

  it(
    "returns controlled 409 when a creation key is reused for different content",
    async () => {
      const testHarness = harness();
      const headers = {
        "x-request-id":
          REQUEST_ID,
        "x-correlation-id":
          CORRELATION_ID,
        "idempotency-key":
          "route-conflict-1",
      };

      const firstResponse =
        await handleCapaPost(
          postRequest(
            validBody(),
            headers,
          ),
          testHarness.dependencies,
        );

      const conflictResponse =
        await handleCapaPost(
          postRequest(
            {
              ...validBody(),
              initiating_event:
                "Different controlled initiating event.",
            },
            headers,
          ),
          testHarness.dependencies,
        );

      expect(firstResponse.status)
        .toBe(201);
      expect(conflictResponse.status)
        .toBe(409);

      expect(
        await responseBody(
          conflictResponse,
        ),
      ).toMatchObject({
        error: {
          code:
            "CAPA_IDEMPOTENCY_CONFLICT",
          message:
            "The idempotency key was already used for a different CAPA request.",
          correlation_id:
            CORRELATION_ID,
        },
      });

      const page =
        await testHarness.runtime
          .database.listCases({
            organization_id:
              resolveDevelopmentCapaRequestContext(
                validSessionFacts(),
                NOW,
              ).tenant.organization_id,
            limit: 100,
          });

      expect(page.cases)
        .toHaveLength(1);
    },
  );

});

describe("CAPA GET handler", () => {
  async function createCase(
    testHarness: Harness,
  ): Promise<string> {
    const response =
      await handleCapaPost(
        postRequest(validBody()),
        testHarness.dependencies,
      );

    expect(response.status).toBe(201);

    const body =
      await responseBody(response);

    return body.capa
      .capa_case_id as string;
  }

  it(
    "returns an authorized empty organization case list",
    async () => {
      const testHarness = harness({
        runtime: runtime(
          allowDecision(),
        ),
      });

      const response =
        await handleCapaGet(
          listRequest({}, {
            "x-correlation-id":
              CORRELATION_ID,
          }),
          testHarness.dependencies,
        );

      expect(response.status).toBe(200);

      expect(
        await responseBody(response),
      ).toEqual({
        capa_cases: [],
        correlation_id:
          CORRELATION_ID,
      });
    },
  );

  it(
    "returns a bounded case list with a continuation cursor",
    async () => {
      const testHarness = harness({
        runtime: runtime(
          allowDecision(),
        ),
      });

      await createCase(testHarness);
      await createCase(testHarness);

      const response =
        await handleCapaGet(
          listRequest({
            limit: "1",
          }),
          testHarness.dependencies,
        );

      expect(response.status).toBe(200);

      const body =
        await responseBody(response);

      expect(body.capa_cases)
        .toHaveLength(1);

      expect(body.capa_cases[0])
        .toMatchObject({
          case_number:
            "CAPA-000002",
          status: "S00",
          record_version: 1,
        });

      expect(body.next_cursor)
        .toEqual({
          created_at:
            body.capa_cases[0]
              .created_at,
          capa_case_id:
            body.capa_cases[0]
              .capa_case_id,
        });
    },
  );

  it(
    "continues a case list from its complete cursor",
    async () => {
      const testHarness = harness({
        runtime: runtime(
          allowDecision(),
        ),
      });

      await createCase(testHarness);
      await createCase(testHarness);

      const firstResponse =
        await handleCapaGet(
          listRequest({
            limit: "1",
          }),
          testHarness.dependencies,
        );

      const firstBody =
        await responseBody(
          firstResponse,
        );

      const response =
        await handleCapaGet(
          listRequest({
            limit: "1",
            cursor_created_at:
              firstBody.next_cursor
                .created_at,
            cursor_case_id:
              firstBody.next_cursor
                .capa_case_id,
          }),
          testHarness.dependencies,
        );

      expect(response.status).toBe(200);

      const body =
        await responseBody(response);

      expect(body.capa_cases)
        .toHaveLength(1);

      expect(body.capa_cases[0]
        .case_number)
        .toBe("CAPA-000001");

      expect(body).not
        .toHaveProperty("next_cursor");
    },
  );

  it(
    "returns a controlled denial for case listing",
    async () => {
      const testRuntime = runtime({
        decision: "deny",
        reason_code:
          controlled("VIEW_DENIED"),
        policy_version:
          "test-policy-1",
        evaluated_at:
          NOW.toISOString() as
            CapaPolicyDecision["evaluated_at"],
      });

      const response =
        await handleCapaGet(
          listRequest(),
          harness({
            runtime: testRuntime,
          }).dependencies,
        );

      expect(response.status).toBe(403);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "CAPA_ACCESS_DENIED",
        },
      });
    },
  );

  it(
    "returns a controlled step-up response for case listing",
    async () => {
      const testRuntime = runtime({
        decision: "step_up",
        reason_code:
          controlled("MFA_REQUIRED"),
        policy_version:
          "test-policy-1",
        evaluated_at:
          NOW.toISOString() as
            CapaPolicyDecision["evaluated_at"],
        required_assurance:
          controlled("MFA"),
      });

      const response =
        await handleCapaGet(
          listRequest(),
          harness({
            runtime: testRuntime,
          }).dependencies,
        );

      expect(response.status).toBe(403);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "CAPA_STEP_UP_REQUIRED",
        },
      });
    },
  );

  it.each([
    { limit: "0" },
    { limit: "01" },
    { limit: "1.5" },
    { limit: "101" },
    {
      limit:
        "9007199254740992",
    },
    {
      cursor_created_at:
        "2026-08-12T14:00:00.000Z",
    },
    {
      cursor_case_id:
        REQUEST_ID,
    },
    {
      cursor_created_at:
        "not-a-date",
      cursor_case_id:
        REQUEST_ID,
    },
    {
      cursor_created_at:
        "2026-08-12T14:00:00Z",
      cursor_case_id:
        REQUEST_ID,
    },
    {
      cursor_created_at:
        "2026-08-12T14:00:00.000Z",
      cursor_case_id:
        "not-a-uuid",
    },
  ])(
    "rejects invalid case-list query %#",
    async (parameters) => {
      const response =
        await handleCapaGet(
          listRequest(parameters),
          harness().dependencies,
        );

      expect(response.status).toBe(400);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "INVALID_CAPA_LIST_QUERY",
        },
      });
    },
  );

  it(
    "returns a created CAPA with its current version and sections",
    async () => {
      const testHarness = harness();

      const caseId =
        await createCase(testHarness);

      const response =
        await handleCapaGet(
          getRequest(caseId, {
            "x-request-id":
              REQUEST_ID,
            "x-correlation-id":
              CORRELATION_ID,
          }),
          testHarness.dependencies,
        );

      expect(response.status).toBe(200);

      const body =
        await responseBody(response);

      expect(body).toMatchObject({
        capa: {
          capa_case_id: caseId,
          case_number:
            "CAPA-000001",
          status: "S00",
          current_version: {
            status: "S00",
            version_number: 1,
          },
        },
        correlation_id:
          CORRELATION_ID,
      });

      expect(
        body.capa.sections,
      ).toHaveLength(1);

      expect(
        body.capa.sections[0].content,
      ).toEqual(validBody());
    },
  );

  it("projects the latest valid G-04 return across paginated audit events", async () => {
    const fillerEvents = Array.from({ length: 100 }, (_, index) =>
      rootCauseReturnTransition({
        event_id: `70000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        event_type: "EVT-NOTE",
        action: "NOTE_RECORDED",
        metadata: {},
      }),
    );
    const laterSameStateEvent = rootCauseReturnTransition({
      event_id: "70000000-0000-4000-8000-000000000007",
      event_type: "EVT-NOTE",
      action: "INVESTIGATION_NOTE_RECORDED",
      metadata: {},
    });
    const testHarness = harness({
      runtime: projectionRuntime([
        fillerEvents,
        [rootCauseReturnTransition(), laterSameStateEvent],
      ]),
    });

    const response = await handleCapaGet(
      getRequest(PROJECTION_CASE_ID, {
        "x-correlation-id": CORRELATION_ID,
      }),
      testHarness.dependencies,
    );

    expect(response.status).toBe(200);
    const body = await responseBody(response);
    expect(body.capa.root_cause_return_context).toEqual({
      returned_at: "2026-09-08T12:00:00.000Z",
      returned_by_actor_id: PROJECTION_ACTOR_ID,
      rationale: "Additional evidence is required before root-cause approval.",
      source_case_version_id:
        "70000000-0000-4000-8000-000000000006",
      resulting_case_version_id: PROJECTION_VERSION_ID,
      source_record_version: 8,
      resulting_record_version: 9,
    });

    const listEvents = (testHarness.runtime
      .decide_root_cause_gate_dependencies.audit_repository as any)
      .listEventsForAggregate;
    expect(listEvents).toHaveBeenCalledTimes(2);
    expect(listEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({
      organization_id: USER_ID,
      aggregate_type: "CAPA_CASE",
      aggregate_id: PROJECTION_CASE_ID,
      limit: 100,
    }));
    expect(listEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: "1",
      limit: 100,
    }));
  });

  it.each([
    ["no transition", []],
    [
      "normal S30 to S40 release",
      [rootCauseReturnTransition({
        action: "RELEASE_CAPA_INVESTIGATION",
        reason: "Investigation planning is complete.",
        metadata: {
          from_state: "S30",
          to_state: "S40",
          rationale: "Investigation planning is complete.",
        },
      })],
    ],
    [
      "later different transition into S40",
      [
        rootCauseReturnTransition(),
        rootCauseReturnTransition({
          event_id: "70000000-0000-4000-8000-000000000008",
          action: "RELEASE_CAPA_INVESTIGATION",
          reason: "A later investigation release superseded the return.",
          metadata: {
            from_state: "S30",
            to_state: "S40",
            rationale: "A later investigation release superseded the return.",
          },
        }),
      ],
    ],
    [
      "inconsistent return rationale",
      [rootCauseReturnTransition({
        metadata: {
          from_state: "S50",
          to_state: "S40",
          rationale: "A different rationale.",
        },
      })],
    ],
  ] as const)("fails closed for %s", async (_label, events) => {
    const testHarness = harness({
      runtime: projectionRuntime([events]),
    });
    const response = await handleCapaGet(
      getRequest(PROJECTION_CASE_ID),
      testHarness.dependencies,
    );

    expect(response.status).toBe(200);
    const body = await responseBody(response);
    expect(body.capa).not.toHaveProperty("root_cause_return_context");
  });

  it("does not read or project audit context when the current CAPA is not S40", async () => {
    const testHarness = harness({
      runtime: projectionRuntime(
        [[rootCauseReturnTransition()]],
        "S50",
      ),
    });

    const response = await handleCapaGet(
      getRequest(PROJECTION_CASE_ID),
      testHarness.dependencies,
    );

    expect(response.status).toBe(200);
    const body = await responseBody(response);
    expect(body.capa).not.toHaveProperty("root_cause_return_context");
    expect(
      (testHarness.runtime.decide_root_cause_gate_dependencies
        .audit_repository as any).listEventsForAggregate,
    ).not.toHaveBeenCalled();
  });

  it("reads and projects audit context for a returned S50 with an immutable response section", async () => {
    const testHarness = harness({
      runtime: projectionRuntime(
        [[rootCauseReturnTransition()]],
        "S50",
        true,
      ),
    });

    const response = await handleCapaGet(
      getRequest(PROJECTION_CASE_ID),
      testHarness.dependencies,
    );

    expect(response.status).toBe(200);
    const body = await responseBody(response);
    expect(body.capa.root_cause_return_context).toEqual({
      returned_at: "2026-09-08T12:00:00.000Z",
      returned_by_actor_id: PROJECTION_ACTOR_ID,
      rationale: "Additional evidence is required before root-cause approval.",
      source_case_version_id: "70000000-0000-4000-8000-000000000006",
      resulting_case_version_id: PROJECTION_VERSION_ID,
      source_record_version: 8,
      resulting_record_version: 9,
    });
    expect(body.capa.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        section_type: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SECTION_TYPE,
      }),
    ]));
    expect(
      (testHarness.runtime.decide_root_cause_gate_dependencies
        .audit_repository as any).listEventsForAggregate,
    ).toHaveBeenCalledTimes(1);
  });

  it(
    "returns 401 without a session",
    async () => {
      const response =
        await handleCapaGet(
          getRequest(REQUEST_ID),
          harness({
            session_facts: null,
          }).dependencies,
        );

      expect(response.status).toBe(401);
    },
  );

  it(
    "returns 401 for an invalid session context",
    async () => {
      const response =
        await handleCapaGet(
          getRequest(REQUEST_ID),
          harness({
            session_facts: {
              ...validSessionFacts(),
              authenticated_at:
                "not-a-date",
            },
          }).dependencies,
        );

      expect(response.status).toBe(401);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "INVALID_SESSION_CONTEXT",
        },
      });
    },
  );

  it(
    "returns tenant-safe 403 when durable tenant access is ambiguous",
    async () => {
      const testHarness = harness({
        resolve_context_error:
          new SupabaseCapaTenantAccessError(
            "AMBIGUOUS_ACTIVE_MEMBERSHIP",
          ),
      });

      const response =
        await handleCapaGet(
          getRequest(REQUEST_ID),
          testHarness.dependencies,
        );

      expect(response.status).toBe(403);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "CAPA_TENANT_ACCESS_DENIED",
          message:
            "The authenticated user is not authorized to access a CAPA organization.",
        },
      });

      expect(
        testHarness.errors,
      ).toHaveLength(1);

      expect(
        testHarness.errors[0],
      ).toMatchObject({
        message:
          "CAPA API tenant context resolution denied.",
        metadata: {
          correlation_id:
            expect.any(String),
          error_name:
            "SupabaseCapaTenantAccessError",
          reason_code:
            "AMBIGUOUS_ACTIVE_MEMBERSHIP",
        },
      });
    },
  );

  it.each([
    "",
    "not-a-uuid",
  ])(
    "rejects invalid case id %s",
    async (caseId) => {
      const response =
        await handleCapaGet(
          getRequest(caseId),
          harness().dependencies,
        );

      expect(response.status).toBe(400);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code:
            "INVALID_CAPA_CASE_ID",
        },
      });
    },
  );

  it(
    "returns tenant-safe not found",
    async () => {
      const response =
        await handleCapaGet(
          getRequest(REQUEST_ID),
          harness().dependencies,
        );

      expect(response.status).toBe(404);

      expect(
        await responseBody(response),
      ).toMatchObject({
        error: {
          code: "CAPA_NOT_FOUND",
        },
      });
    },
  );

  it(
    "fails safely when the current version is missing",
    async () => {
      const testHarness = harness();
      const caseId =
        await createCase(testHarness);

      testHarness.runtime.database
        .findCaseVersionById =
        async () => null;

      const response =
        await handleCapaGet(
          getRequest(caseId),
          testHarness.dependencies,
        );

      expect(response.status).toBe(500);
      expect(
        testHarness.errors[0].metadata,
      ).toMatchObject({
        error_name: "Error",
      });
    },
  );

  it(
    "fails safely when a referenced section is missing",
    async () => {
      const testHarness = harness();
      const caseId =
        await createCase(testHarness);

      testHarness.runtime.database
        .findSectionVersionById =
        async () => null;

      const response =
        await handleCapaGet(
          getRequest(caseId),
          testHarness.dependencies,
        );

      expect(response.status).toBe(500);
    },
  );

  it(
    "handles a non-Error failure safely",
    async () => {
      const testHarness = harness({
        get_runtime_error:
          "non-error failure",
      });

      const response =
        await handleCapaGet(
          getRequest(REQUEST_ID),
          testHarness.dependencies,
        );

      expect(response.status).toBe(500);

      expect(
        testHarness.errors[0].metadata,
      ).toMatchObject({
        error_name:
          "UnknownError",
      });
    },
  );
});
