import { describe, expect, it, vi } from "vitest";
import { handleCapaInvestigationActiveWorkspaceReconciliationPost } from "../../lib/capa/api/capa-investigation-active-workspace-reconciliation-route-handler";

const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "40000000-0000-4000-8000-000000000001";

function dependencies(result: unknown): any {
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: "50000000-0000-4000-8000-000000000001", authenticated_at: "2026-09-05T00:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000 })),
    resolve_context: vi.fn(async () => ({ tenant: { organization_id: "10000000-0000-4000-8000-000000000001" }, owner_user_id: "50000000-0000-4000-8000-000000000001" })),
    create_reconciliation_service: vi.fn(() => ({ reconcile: vi.fn(async () => result) })),
    now: () => new Date("2026-09-05T00:00:00.000Z"),
    generate_uuid: () => CORRELATION_ID,
    logger: { error: vi.fn() },
  };
}

const workspace = {
  schema_version: "capa-investigation-active-workspace-draft-1.0.0",
  trust: "untrusted_human_draft",
  workflow_state: "S40",
  organization_id: "server-only-organization",
  capa_case_id: CASE_ID,
  case_version_id: VERSION_ID,
  record_version: 4,
  draft_revision: 7,
  evidence_assumption_ledger: { items: [] },
  root_cause_package: { hypotheses: [], root_cause_not_confirmed: null },
  updated_by_user_id: "server-only-user",
  updated_at: "2026-09-05T00:00:00.000Z",
};

async function post(result: unknown): Promise<Response> {
  return handleCapaInvestigationActiveWorkspaceReconciliationPost(new Request("http://localhost"), CASE_ID, dependencies(result));
}

describe("S40 workspace reconciliation route handler", () => {
  it("returns a safe projection for a reconciled workspace", async () => {
    const response = await post({ status: "reconciled", workspace });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: "reconciled", workspace: { draft_revision: 7, case_version_id: VERSION_ID, record_version: 4 }, correlation_id: CORRELATION_ID });
    expect(JSON.stringify(body)).not.toContain("server-only");
    expect(body).not.toHaveProperty("workspace.organization_id");
  });

  it("returns workspace:null when reconciliation has no durable workspace", async () => {
    await expect(post({ status: "reconciled", workspace: null })).resolves.toMatchObject({ status: 200 });
    const body = await (await post({ status: "reconciled", workspace: null })).json();
    expect(body).toMatchObject({ status: "reconciled", workspace: null, correlation_id: CORRELATION_ID });
  });

  it.each([
    ["not_found", 404, "CAPA_WORKSPACE_CASE_NOT_FOUND"],
    ["workflow_conflict", 409, "CAPA_WORKSPACE_CASE_STATE_CONFLICT"],
    ["authorization_denied", 403, "CAPA_WORKSPACE_ACCESS_DENIED"],
    ["case_changed", 409, "WORKFLOW_MUTATION_DETECTED"],
    ["concurrency_conflict", 409, "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT"],
    ["legacy_causal_role_not_recorded", 409, "LEGACY_CAUSAL_ROLE_NOT_RECORDED"],
    ["failed", 500, "CAPA_INTERNAL_ERROR"],
  ] as const)("maps %s without leaking repository details", async (status, expectedStatus, expectedCode) => {
    const response = await post({ status, internal_repository_detail: "database-secret" });
    expect(response.status).toBe(expectedStatus);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ error: { code: expectedCode, correlation_id: CORRELATION_ID } });
    expect(JSON.stringify(body)).not.toContain("database-secret");
  });
});
