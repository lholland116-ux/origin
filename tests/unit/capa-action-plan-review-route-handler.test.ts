import { describe, expect, it, vi } from "vitest";
import { handleCapaActionPlanReview } from "../../lib/capa/api/capa-route-handler";

const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const RESULT = "40000000-0000-4000-8000-000000000002";
const SECTION = "50000000-0000-4000-8000-000000000001";
const AUDIT = "60000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000001";
const CORRELATION = "70000000-0000-4000-8000-000000000001";
const SCHEMA = "capa-action-plan-review-decision-1.0.0";

function request(body: unknown, key = "review-1") {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

function body(decision: "approve" | "return" = "approve") {
  return {
    expected_record_version: 7,
    expected_current_version_id: SOURCE,
    schema_version: SCHEMA,
    source_case_version_id: SOURCE,
    action_plan_section_version_id: SECTION,
    decision,
    rationale: decision === "approve"
      ? "The submitted action plan is suitable for implementation."
      : "The plan needs revision before implementation.",
  };
}

function result(status: "decided" | "already_decided" = "decided", decision: "approve" | "return" = "approve") {
  const target = decision === "approve" ? "S80" : "S60";
  return {
    status,
    decision,
    capa_case: {
      organization_id: ORG,
      capa_case_id: CASE,
      case_number: "CAPA-1",
      current_version_id: RESULT,
      status: target,
      record_version: 8,
    },
    source_case_version_id: SOURCE,
    resulting_case_version_id: RESULT,
    record_version: 8,
    workflow_state: target,
    action_plan_section_version: { section_version_id: SECTION },
    review_decision: {
      schema_version: SCHEMA,
      decision,
      rationale: body(decision).rationale,
      reviewer_user_id: USER,
      decided_at: "2026-09-09T12:00:00.000Z",
    },
    transition_audit_event_id: AUDIT,
  } as any;
}

function dependencies() {
  const runtimeDependencies = { marker: "review-dependencies" };
  return {
    get_session_facts: vi.fn(async () => ({
      verified_user_id: USER,
      authenticated_at: "2026-09-09T11:00:00.000Z",
      expires_at_epoch_seconds: 2_000_000_000,
    })),
    resolve_context: vi.fn(async () => ({
      authentication: { principal: { principal_type: "human", user_id: USER } },
      tenant: { organization_id: ORG },
    })),
    get_runtime: vi.fn(() => ({ decide_action_plan_review_dependencies: runtimeDependencies })),
    now: () => new Date("2026-09-09T12:00:00.000Z"),
    generate_uuid: () => CORRELATION,
    logger: { error: vi.fn() },
    runtimeDependencies,
  } as any;
}

describe("S70 action-plan review API handler", () => {
  it.each([
    ["approve", "S80"],
    ["return", "S60"],
  ] as const)("maps %s to the resulting workflow state", async (decision, state) => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/decide-capa-action-plan-review");
    const decide = vi.spyOn(application, "decideCapaActionPlanReview").mockResolvedValue(result("decided", decision));
    const response = await handleCapaActionPlanReview(request(body(decision)), CASE, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "decided",
      decision,
      capa: { status: state, source_case_version_id: SOURCE, action_plan_section_version_id: SECTION, resulting_case_version_id: RESULT },
      review_decision: { schema_version: SCHEMA, reviewer_user_id: USER },
      replayed: false,
      correlation_id: CORRELATION,
    });
    expect(decide).toHaveBeenCalledWith(deps.runtimeDependencies, expect.objectContaining({
      expected_record_version: 7,
      expected_current_version_id: SOURCE,
      body: { schema_version: SCHEMA, source_case_version_id: SOURCE, action_plan_section_version_id: SECTION, decision, rationale: body(decision).rationale },
    }));
    decide.mockRestore();
  });

  it("maps exact replay to 200 with replayed=true", async () => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/decide-capa-action-plan-review");
    const decide = vi.spyOn(application, "decideCapaActionPlanReview").mockResolvedValue(result("already_decided"));
    const response = await handleCapaActionPlanReview(request(body(), "replay-1"), CASE, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, capa: { status: "S80" } });
    decide.mockRestore();
  });

  it("strictly rejects malformed transport bodies and maps controlled failures", async () => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/decide-capa-action-plan-review");
    const decide = vi.spyOn(application, "decideCapaActionPlanReview").mockResolvedValue(result());
    const malformed = await handleCapaActionPlanReview(request({ ...body(), unexpected: true }), CASE, deps);
    expect(malformed.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
    for (const [outcome, status, code] of [
      [{ status: "validation_failed" }, 400, "CAPA_ACTION_PLAN_REVIEW_VALIDATION_FAILED"],
      [{ status: "authorization_denied", reason_code: "DENIED", policy_version: "p" }, 403, "CAPA_ACCESS_DENIED"],
      [{ status: "step_up_required", reason_code: "STEP_UP", policy_version: "p", required_assurance: "MFA" }, 403, "CAPA_STEP_UP_REQUIRED"],
      [{ status: "not_found_or_not_authorized" }, 404, "CAPA_NOT_FOUND"],
      [{ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" }, 409, "CAPA_WORKFLOW_CONFLICT"],
      [{ status: "concurrency_conflict", reason_code: "CURRENT_VERSION_CONFLICT" }, 409, "CAPA_CONCURRENCY_CONFLICT"],
      [{ status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" }, 409, "CAPA_IDEMPOTENCY_CONFLICT"],
    ] as const) {
      decide.mockResolvedValueOnce(outcome as any);
      const response = await handleCapaActionPlanReview(request(body(), `key-${String(code)}`), CASE, deps);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    decide.mockRestore();
  });
});
