import { describe, expect, it, vi } from "vitest";
import {
  handleCapaImplementationReviewGet,
  handleCapaImplementationReviewPost,
  type CapaImplementationReviewApiDependencies,
} from "../../lib/capa/api/capa-implementation-review-route-handler";
import type { CapaImplementationReviewProjectionService } from "../../lib/capa/application/capa-implementation-review-projection-service";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const BASELINE = "50000000-0000-4000-8000-000000000001";
const RESULT = "60000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CORRELATION = "70000000-0000-4000-8000-000000000001";
const SCHEMA = "capa-implementation-review-decision-1.0.0";

const context = {
  authentication: {
    principal: { principal_type: "human", user_id: USER },
  },
  tenant: { organization_id: ORG },
  owner_user_id: USER,
} as any;

const projection = {
  trust: "authoritative_server_projection",
  organization_id: ORG,
  capa_case_id: CASE,
  workflow_state: "S90",
  current_case_version_id: SOURCE,
} as any;

function dependencies(
  projectionResult: any = { status: "resolved", projection },
): CapaImplementationReviewApiDependencies {
  const projectionService = {
    load: vi.fn(async () => projectionResult),
  } as unknown as CapaImplementationReviewProjectionService;
  const decisionDependencies = {} as any;
  return {
    get_session_facts: vi.fn(async () => ({
      verified_user_id: USER,
      authenticated_at: "2026-09-11T11:00:00.000Z",
      expires_at_epoch_seconds: 2_000_000_000,
    })),
    resolve_context: vi.fn(async () => context),
    create_projection_service: vi.fn(() => projectionService),
    get_decision_dependencies: vi.fn(() => decisionDependencies),
    now: () => new Date("2026-09-11T12:00:00.000Z"),
    generate_uuid: () => CORRELATION,
    logger: { error: vi.fn() },
  };
}

function decisionBody(decision: "accept" | "return" = "accept") {
  return {
    expected_record_version: 9,
    expected_current_version_id: SOURCE,
    schema_version: SCHEMA,
    source_case_version_id: SOURCE,
    implementation_review_baseline_section_version_id: BASELINE,
    decision,
    rationale: decision === "accept"
      ? "Accept the implementation evidence."
      : "Return the implementation for additional work.",
  };
}

function request(body: unknown, key = "implementation-review-1") {
  return new Request(`https://example.test/api/capa/${CASE}/implementation-review`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

function decisionResult(
  status: "decided" | "already_decided" = "decided",
  decision: "accept" | "return" = "accept",
) {
  const nextState = decision === "accept" ? "S100" : "S80";
  return {
    status,
    decision,
    capa_case: {
      organization_id: ORG,
      capa_case_id: CASE,
      case_number: "CAPA-1",
      status: nextState,
      current_version_id: RESULT,
      record_version: 10,
    },
    source_case_version_id: SOURCE,
    resulting_case_version_id: RESULT,
    workflow_state: nextState,
    implementation_review_baseline_section_version: {
      section_version_id: BASELINE,
    },
    review_decision: {
      schema_version: SCHEMA,
      decision,
      rationale: decisionBody(decision).rationale,
      reviewer_user_id: USER,
      decided_at: "2026-09-11T12:00:00.000Z",
    },
    transition_audit_event_id: "80000000-0000-4000-8000-000000000001",
  } as any;
}

describe("S90 implementation-review API route handlers", () => {
  it("returns the authoritative projection through GET", async () => {
    const deps = dependencies();
    const response = await handleCapaImplementationReviewGet(
      new Request(`https://example.test/api/capa/${CASE}/implementation-review`),
      CASE,
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projection,
      correlation_id: CORRELATION,
    });
    expect(deps.create_projection_service).toHaveBeenCalledWith(context);
  });

  it.each([
    [{ status: "not_found_or_not_authorized" }, 404, "CAPA_IMPLEMENTATION_REVIEW_CASE_NOT_FOUND"],
    [{ status: "wrong_workflow_state" }, 409, "CAPA_IMPLEMENTATION_REVIEW_CASE_STATE_CONFLICT"],
    [{ status: "authorization_denied", reason_code: "DENIED", policy_version: "policy-1" }, 403, "CAPA_IMPLEMENTATION_REVIEW_ACCESS_DENIED"],
    [{ status: "invalid_authoritative_context" }, 409, "CAPA_IMPLEMENTATION_REVIEW_INVALID_AUTHORITATIVE_CONTEXT"],
  ] as const)("maps projection %s", async (result, status, code) => {
    const response = await handleCapaImplementationReviewGet(
      new Request("https://example.test"),
      CASE,
      dependencies(result),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it.each([
    ["accept", "S100"],
    ["return", "S80"],
  ] as const)("sends the controlled %s decision to CS3", async (decision, state) => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/decide-capa-implementation-review");
    const decide = vi.spyOn(application, "decideCapaImplementationReview")
      .mockResolvedValue(decisionResult("decided", decision));
    const response = await handleCapaImplementationReviewPost(
      request(decisionBody(decision)),
      CASE,
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "decided",
      decision,
      capa: {
        status: state,
        workflow_state: state,
        source_case_version_id: SOURCE,
        implementation_review_baseline_section_version_id: BASELINE,
        resulting_case_version_id: RESULT,
      },
      replayed: false,
    });
    expect(decide).toHaveBeenCalledWith(
      deps.get_decision_dependencies(),
      expect.objectContaining({
        capa_case_id: CASE,
        expected_record_version: 9,
        expected_current_version_id: SOURCE,
        request_trace: expect.objectContaining({ idempotency_key: "implementation-review-1" }),
        body: {
          schema_version: SCHEMA,
          source_case_version_id: SOURCE,
          implementation_review_baseline_section_version_id: BASELINE,
          decision,
          rationale: decisionBody(decision).rationale,
        },
      }),
    );
    expect(decide.mock.calls[0]?.[1]).not.toHaveProperty("organization_id");
    expect(decide.mock.calls[0]?.[1]).not.toHaveProperty("resulting_case_version_id");
    decide.mockRestore();
  });

  it("maps replayed decisions and controlled CS3 failures", async () => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/decide-capa-implementation-review");
    const decide = vi.spyOn(application, "decideCapaImplementationReview");
    decide.mockResolvedValueOnce(decisionResult("already_decided"));
    const replay = await handleCapaImplementationReviewPost(
      request(decisionBody(), "replay-1"),
      CASE,
      deps,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    for (const [result, status, code] of [
      [{ status: "validation_failed", reason_code: "INVALID_IMPLEMENTATION_REVIEW_DECISION" }, 400, "CAPA_IMPLEMENTATION_REVIEW_VALIDATION_FAILED"],
      [{ status: "authorization_denied", reason_code: "DENIED", policy_version: "policy-1" }, 403, "CAPA_ACCESS_DENIED"],
      [{ status: "step_up_required", reason_code: "STEP_UP", policy_version: "policy-1", required_assurance: "MFA" }, 403, "CAPA_STEP_UP_REQUIRED"],
      [{ status: "not_found_or_not_authorized" }, 404, "CAPA_NOT_FOUND"],
      [{ status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" }, 409, "CAPA_IDEMPOTENCY_CONFLICT"],
      [{ status: "concurrency_conflict", reason_code: "CURRENT_VERSION_CONFLICT" }, 409, "CAPA_CONCURRENCY_CONFLICT"],
      [{ status: "workflow_conflict", reason_code: "DECISION_ALREADY_COMMITTED" }, 409, "CAPA_WORKFLOW_CONFLICT"],
    ] as const) {
      decide.mockResolvedValueOnce(result as any);
      const response = await handleCapaImplementationReviewPost(
        request(decisionBody(), `key-${code}`),
        CASE,
        deps,
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    decide.mockRestore();
  });

  it("rejects malformed transport input before invoking CS3", async () => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/decide-capa-implementation-review");
    const decide = vi.spyOn(application, "decideCapaImplementationReview");
    const malformed = await handleCapaImplementationReviewPost(
      request({ ...decisionBody(), organization_id: ORG }),
      CASE,
      deps,
    );
    expect(malformed.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
    decide.mockRestore();
  });
});
