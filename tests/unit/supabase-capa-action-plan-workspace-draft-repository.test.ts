import { describe, expect, it, vi } from "vitest";
import { CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION } from "../../lib/capa/application/capa-action-plan-workspace-draft-contract";
import { SupabaseCapaActionPlanWorkspaceDraftRepository, SupabaseCapaActionPlanWorkspaceDraftRepositoryError } from "../../lib/database/supabase/supabase-capa-action-plan-workspace-draft-repository";

let transactionSql: any;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({ requireSupabaseTransaction: vi.fn(() => transactionSql) }));

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const AT = "2026-09-09T12:00:00.000Z";

function draft(revision = 1): any {
  return { schema_version: CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION, trust: "untrusted_human_draft", workflow_state: "S60", organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, record_version: 4, draft_revision: revision, action_plan: { items: [], effectiveness_checks: [] }, updated_by_user_id: USER, updated_at: AT };
}

const returnResponse = {
  schema_version: "capa-action-plan-review-return-response-draft-1.0.0",
  response_narrative: "The returned review comments were addressed.",
  return_transition_audit_event_id: "50000000-0000-4000-8000-000000000001",
  source_case_version_id: "30000000-0000-4000-8000-000000000002",
  resulting_case_version_id: VERSION,
  responded_by: { actor_type: "human", actor_id: USER },
  responded_at: AT,
};

function harness(...responses: unknown[]) {
  const queue = [...responses];
  const calls: any[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { calls.push({ text: strings.join("?"), values }); return queue.shift() ?? []; });
  const tagged = Object.assign(sql, { json: (value: unknown) => value });
  transactionSql = tagged;
  return { sql: tagged, calls, transaction: {} as never };
}

describe("Supabase S60 action-plan workspace draft repository", () => {
  it("reads only by organization and case and fails closed for malformed rows", async () => {
    const absent = harness([]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(absent.sql as never).findDraft(ORG as never, CASE as never)).resolves.toBeNull();
    expect(absent.calls[0].values).toEqual([ORG, CASE]);
    const valid = harness([draft()]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(valid.sql as never).findDraft(ORG as never, CASE as never)).resolves.toMatchObject({ draft_revision: 1 });
    const malformed = harness([{ ...draft(), workflow_state: "S50" }]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(malformed.sql as never).findDraft(ORG as never, CASE as never)).rejects.toThrow(SupabaseCapaActionPlanWorkspaceDraftRepositoryError);
    const returned = harness([{ ...draft(), action_plan_return_response: returnResponse }]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(returned.sql as never).findDraft(ORG as never, CASE as never)).resolves.toMatchObject({ action_plan_return_response: returnResponse });
  });

  it("reads the current workspace with a transaction-owned FOR UPDATE lock", async () => {
    const locked = harness([draft(4)]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(locked.sql as never).findDraftForUpdate(locked.transaction, ORG as never, CASE as never)).resolves.toMatchObject({ draft_revision: 4 });
    expect(locked.calls[0].text).toMatch(/select \* from public\.capa_action_plan_workspace_drafts[\s\S]*organization_id[\s\S]*capa_case_id[\s\S]*limit 2 for update/);
    expect(locked.calls[0].values).toEqual([ORG, CASE]);
    const duplicate = harness([draft(3), draft(4)]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(duplicate.sql as never).findDraftForUpdate(duplicate.transaction, ORG as never, CASE as never)).rejects.toThrow(SupabaseCapaActionPlanWorkspaceDraftRepositoryError);
  });

  it("uses insert-on-conflict create CAS and revision-constrained update CAS", async () => {
    const created = harness([draft()]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(created.sql as never).saveDraft(created.transaction, { draft: draft(), expected_draft_revision: null })).resolves.toMatchObject({ status: "saved" });
    expect(created.calls[0].text).toMatch(/insert into public\.capa_action_plan_workspace_drafts[\s\S]*on conflict/);
    expect(created.calls[0].text).toMatch(/action_plan_return_response/);
    const updated = harness([draft(2)]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(updated.sql as never).saveDraft(updated.transaction, { draft: draft(2), expected_draft_revision: 1 })).resolves.toMatchObject({ status: "saved" });
    expect(updated.calls[0].text).toMatch(/update public\.capa_action_plan_workspace_drafts[\s\S]*draft_revision = \? returning \*/);
    const stale = harness();
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(stale.sql as never).saveDraft(stale.transaction, { draft: draft(3), expected_draft_revision: 1 })).resolves.toEqual({ status: "concurrency_conflict" });
    expect(stale.calls).toHaveLength(0);
  });

  it("guards the CAPA case/version atomically and distinguishes case changes", async () => {
    const guarded = harness([draft()]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(guarded.sql as never).saveDraft(guarded.transaction, { draft: draft(), expected_draft_revision: null, expected_case_version_id: VERSION as never, expected_record_version: 4, expected_workflow_state: "S60" as never })).resolves.toMatchObject({ status: "saved" });
    expect(guarded.calls[0].text).toMatch(/public\.capa_cases as capa_case[\s\S]*public\.capa_case_versions as case_version[\s\S]*capa_case\.current_version_id/);
    const changed = harness([], []);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(changed.sql as never).saveDraft(changed.transaction, { draft: draft(), expected_draft_revision: null, expected_case_version_id: VERSION as never, expected_record_version: 3, expected_workflow_state: "S60" as never })).resolves.toEqual({ status: "case_changed" });
    const conflict = harness([], [{ current_version_id: VERSION, record_version: 4, status: "S60" }]);
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(conflict.sql as never).saveDraft(conflict.transaction, { draft: draft(2), expected_draft_revision: 1, expected_case_version_id: VERSION as never, expected_record_version: 4, expected_workflow_state: "S60" as never })).resolves.toEqual({ status: "concurrency_conflict" });
  });

  it("rejects malformed caller drafts before SQL", async () => {
    const h = harness();
    await expect(new SupabaseCapaActionPlanWorkspaceDraftRepository(h.sql as never).saveDraft(h.transaction, { draft: { ...draft(), action_plan: { items: {} } }, expected_draft_revision: null })).rejects.toThrow(SupabaseCapaActionPlanWorkspaceDraftRepositoryError);
    expect(h.calls).toHaveLength(0);
  });
});
