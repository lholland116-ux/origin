import { describe, expect, it, vi } from "vitest";
import {
  handleCapaInvestigationActiveWorkspaceDraftGet,
  handleCapaInvestigationActiveWorkspaceDraftPut,
} from "../../lib/capa/api/capa-investigation-active-workspace-draft-route-handler";

const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const WORKSPACE = { draft_revision: 1, case_version_id: VERSION, record_version: 4, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_at: "2026-09-05T12:00:00.000Z", organization_id: "10000000-0000-4000-8000-000000000001", updated_by_user_id: USER, trust: "untrusted_human_draft", workflow_state: "S40", schema_version: "private" };

function dependencies(result: any = { status: "loaded", workspace: WORKSPACE }) {
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER, authenticated_at: "2026-09-05T11:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000 })),
    resolve_context: vi.fn(async () => ({ tenant: { organization_id: "10000000-0000-4000-8000-000000000001" }, owner_user_id: USER })),
    create_workspace_service: vi.fn(() => ({ load: vi.fn(async () => result), save: vi.fn(async () => result) })),
    now: () => new Date("2026-09-05T12:00:00.000Z"),
    generate_uuid: () => "70000000-0000-4000-8000-000000000001",
    logger: { error: vi.fn() },
  } as any;
}

describe("S40 investigation-active workspace API handler", () => {
  it("returns a safe projection for an existing workspace and null when absent", async () => {
    const existing = await handleCapaInvestigationActiveWorkspaceDraftGet(new Request("http://localhost"), CASE, dependencies());
    expect(existing.status).toBe(200);
    expect(await existing.json()).toEqual({ workspace: { draft_revision: 1, case_version_id: VERSION, record_version: 4, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_at: WORKSPACE.updated_at }, correlation_id: "70000000-0000-4000-8000-000000000001" });
    const absent = await handleCapaInvestigationActiveWorkspaceDraftGet(new Request("http://localhost"), CASE, dependencies({ status: "loaded", workspace: null }));
    expect(await absent.json()).toMatchObject({ workspace: null });
  });

  it("keeps case changes and workspace CAS conflicts distinct and safe", async () => {
    const body = JSON.stringify({ expected_draft_revision: null, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null } });
    const success = await handleCapaInvestigationActiveWorkspaceDraftPut(new Request("http://localhost", { method: "PUT", body }), CASE, dependencies({ status: "saved", workspace: WORKSPACE }));
    expect(success.status).toBe(200);
    expect(JSON.stringify(await success.json())).not.toContain("organization_id");
    const conflict = await handleCapaInvestigationActiveWorkspaceDraftPut(new Request("http://localhost", { method: "PUT", body }), CASE, dependencies({ status: "concurrency_conflict" }));
    expect(conflict.status).toBe(409);
    const conflictBody = await conflict.json();
    expect(conflictBody).toMatchObject({ error: { code: "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" } });
    const changed = await handleCapaInvestigationActiveWorkspaceDraftPut(new Request("http://localhost", { method: "PUT", body }), CASE, dependencies({ status: "case_changed", reason_code: "WORKFLOW_MUTATION_DETECTED" }));
    expect(changed.status).toBe(409);
    const changedBody = await changed.json();
    expect(changedBody).toMatchObject({ error: { code: "WORKFLOW_MUTATION_DETECTED" } });
    expect(changedBody.error.code).not.toBe("WORKSPACE_DRAFT_CONCURRENCY_CONFLICT");
    expect(JSON.stringify(changedBody)).not.toContain("repository");
    expect(JSON.stringify(changedBody)).not.toContain("database");
    expect(JSON.stringify(changedBody)).not.toContain("reason_code");
    expect(JSON.stringify(conflictBody)).not.toContain("repository");
    expect(JSON.stringify(conflictBody)).not.toContain("database");
  });

  it("maps malformed JSON, authorization, and non-S40 failures to controlled responses", async () => {
    const malformed = await handleCapaInvestigationActiveWorkspaceDraftPut(new Request("http://localhost", { method: "PUT", body: "{" }), CASE, dependencies());
    expect(malformed.status).toBe(400);
    const denied = await handleCapaInvestigationActiveWorkspaceDraftGet(new Request("http://localhost"), CASE, dependencies({ status: "authorization_denied", reason_code: "DENIED", policy_version: "p" }));
    expect(denied.status).toBe(403);
    const wrongState = await handleCapaInvestigationActiveWorkspaceDraftGet(new Request("http://localhost"), CASE, dependencies({ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" }));
    expect(wrongState.status).toBe(409);
  });
});
