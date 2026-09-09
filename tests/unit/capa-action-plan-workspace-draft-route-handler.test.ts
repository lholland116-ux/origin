import { describe, expect, it, vi } from "vitest";
import {
  handleCapaActionPlanWorkspaceDraftGet,
  handleCapaActionPlanWorkspaceDraftPut,
} from "../../lib/capa/api/capa-action-plan-workspace-draft-route-handler";

const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const CORRELATION = "50000000-0000-4000-8000-000000000001";
const PLAN = { items: [], effectiveness_checks: [] };
const WORKSPACE = { draft_revision: 1, case_version_id: VERSION, record_version: 4, action_plan: PLAN, updated_at: "2026-09-09T12:00:00.000Z", organization_id: "10000000-0000-4000-8000-000000000001", capa_case_id: CASE, updated_by_user_id: USER, trust: "untrusted_human_draft", workflow_state: "S60", schema_version: "capa-action-plan-workspace-draft-1.0.0" };

function dependencies(result: any = { status: "loaded", workspace: WORKSPACE }, saveResult?: any) {
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER, authenticated_at: "2026-09-09T11:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000 })),
    resolve_context: vi.fn(async () => ({ tenant: { organization_id: "10000000-0000-4000-8000-000000000001" }, owner_user_id: USER })),
    create_workspace_service: vi.fn(() => ({ load: vi.fn(async () => result), save: vi.fn(async () => saveResult ?? result) })),
    now: () => new Date("2026-09-09T12:00:00.000Z"),
    generate_uuid: () => CORRELATION,
    logger: { error: vi.fn() },
  } as any;
}

describe("S60 action-plan workspace API handler", () => {
  it("loads absent and saved workspaces without exposing server-owned envelope fields", async () => {
    const absent = await handleCapaActionPlanWorkspaceDraftGet(new Request("http://localhost"), CASE, dependencies({ status: "loaded", workspace: null }));
    expect(absent.status).toBe(200);
    expect(await absent.json()).toEqual({ workspace: null, correlation_id: CORRELATION });
    const saved = await handleCapaActionPlanWorkspaceDraftGet(new Request("http://localhost"), CASE, dependencies());
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body).toMatchObject({ workspace: { draft_revision: 1, case_version_id: VERSION, action_plan: PLAN } });
    expect(JSON.stringify(body)).not.toContain("organization_id");
    expect(JSON.stringify(body)).not.toContain("updated_by_user_id");
  });

  it("maps not-found, authorization, workflow, validation, concurrency, and case conflicts", async () => {
    const cases: readonly [any, number, string][] = [
      [{ status: "not_found" }, 404, "CAPA_ACTION_PLAN_WORKSPACE_CASE_NOT_FOUND"],
      [{ status: "authorization_denied", reason_code: "DENIED", policy_version: "p" }, 403, "CAPA_ACTION_PLAN_WORKSPACE_ACCESS_DENIED"],
      [{ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" }, 409, "CAPA_ACTION_PLAN_WORKSPACE_CASE_STATE_CONFLICT"],
      [{ status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_FIELDS" }, 400, "INVALID_CAPA_ACTION_PLAN_WORKSPACE_REQUEST"],
      [{ status: "concurrency_conflict" }, 409, "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT"],
      [{ status: "case_changed", reason_code: "WORKFLOW_MUTATION_DETECTED" }, 409, "WORKFLOW_MUTATION_DETECTED"],
    ];
    for (const [result, status, code] of cases) {
      const response = await handleCapaActionPlanWorkspaceDraftGet(new Request("http://localhost"), CASE, dependencies(result));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
  });

  it("saves only through the service and maps malformed JSON and success", async () => {
    const body = { expected_draft_revision: null, action_plan: PLAN };
    const save = await handleCapaActionPlanWorkspaceDraftPut(new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) }), CASE, dependencies(undefined, { status: "saved", workspace: WORKSPACE }));
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({ workspace: { draft_revision: 1, action_plan: PLAN } });
    const malformed = await handleCapaActionPlanWorkspaceDraftPut(new Request("http://localhost", { method: "PUT", body: "{" }), CASE, dependencies());
    expect(malformed.status).toBe(400);
  });
});
