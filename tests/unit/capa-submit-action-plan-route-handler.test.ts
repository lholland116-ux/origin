import { describe, expect, it, vi } from "vitest";
import { handleCapaSubmitActionPlan } from "../../lib/capa/api/capa-route-handler";

const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const SECTION = "70000000-0000-4000-8000-000000000002";
const AUDIT = "80000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const CORRELATION = "60000000-0000-4000-8000-000000000001";

function dependencies(result: any = { status: "submitted", capa_case: { capa_case_id: CASE, case_number: "CAPA-1", status: "S70", record_version: 5 }, case_version: { case_version_id: NEXT, effective_at: "2026-09-09T12:00:00.000Z" }, action_plan_section_version: { section_version_id: SECTION }, transition_audit_event_id: AUDIT }) {
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER, authenticated_at: "2026-09-09T11:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000 })),
    resolve_context: vi.fn(async () => ({ authentication: { principal: { principal_type: "human", user_id: USER } }, tenant: { organization_id: "20000000-0000-4000-8000-000000000001" } })),
    get_runtime: vi.fn(() => ({ submit_action_plan_dependencies: { marker: "dependencies" } })),
    now: () => new Date("2026-09-09T12:00:00.000Z"),
    generate_uuid: () => CORRELATION,
    logger: { error: vi.fn() },
    result,
  } as any;
}

describe("S60 action-plan submission API handler", () => {
  it("accepts only expected versions and maps the authoritative S70 result", async () => {
    const deps = dependencies();
    const runtime = deps.get_runtime();
    const submit = vi.fn(async (_dependencies: unknown, command: any) => {
      expect(command.body).toEqual({ expected_record_version: 4, expected_current_version_id: SOURCE });
      return deps.result;
    });
    deps.get_runtime = vi.fn(() => ({ submit_action_plan_dependencies: runtime.submit_action_plan_dependencies }));
    const module = await import("../../lib/capa/application/submit-capa-action-plan");
    const spy = vi.spyOn(module, "submitCapaActionPlan").mockImplementation(submit as any);
    const response = await handleCapaSubmitActionPlan(new Request("http://localhost", { method: "POST", headers: { "idempotency-key": "submit-1" }, body: JSON.stringify({ expected_record_version: 4, expected_current_version_id: SOURCE }) }), CASE, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ capa: { status: "S70", submitted_version_id: NEXT, action_plan_section_version_id: SECTION }, replayed: false });
    expect(submit).toHaveBeenCalledWith(runtime.submit_action_plan_dependencies, expect.objectContaining({ expected_record_version: 4, expected_current_version_id: SOURCE }));
    spy.mockRestore();
  });

  it("rejects content-bearing bodies and maps readiness, authorization, and workflow outcomes", async () => {
    const deps = dependencies();
    const submit = vi.fn();
    const module = await import("../../lib/capa/application/submit-capa-action-plan");
    const spy = vi.spyOn(module, "submitCapaActionPlan").mockImplementation(submit as any);
    const invalid = await handleCapaSubmitActionPlan(new Request("http://localhost", { method: "POST", headers: { "idempotency-key": "submit-1" }, body: JSON.stringify({ expected_record_version: 4, expected_current_version_id: SOURCE, action_plan: {} }) }), CASE, deps);
    expect(invalid.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    for (const [status, code] of [["submission_blocked", "CAPA_ACTION_PLAN_SUBMISSION_BLOCKED"], ["authorization_denied", "CAPA_ACCESS_DENIED"], ["workflow_conflict", "CAPA_WORKFLOW_CONFLICT"], ["idempotency_conflict", "CAPA_IDEMPOTENCY_CONFLICT"] as const]) {
      const outcome = status === "submission_blocked" ? { status, blocker_codes: ["EMPTY_ACTION_PLAN"] } : { status };
      submit.mockResolvedValueOnce(outcome);
      const response = await handleCapaSubmitActionPlan(new Request("http://localhost", { method: "POST", headers: { "idempotency-key": "submit-1" }, body: JSON.stringify({ expected_record_version: 4, expected_current_version_id: SOURCE }) }), CASE, dependencies(outcome));
      expect(response.status).toBe(status === "authorization_denied" ? 403 : 409);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    spy.mockRestore();
  });
});
