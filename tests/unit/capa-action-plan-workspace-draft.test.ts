import { describe, expect, it } from "vitest";
import {
  CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/application/capa-action-plan-workspace-draft-contract";
import {
  validateCapaActionPlanWorkspaceDraft,
} from "../../lib/capa/application/capa-action-plan-workspace-draft-validator";
import {
  validateCapaActionPlanWorkspaceDraftSaveRequest,
} from "../../lib/capa/application/capa-action-plan-workspace-draft-request";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const AT = "2026-09-09T12:00:00.000Z";

function actionPlan() {
  return { items: [], effectiveness_checks: [] };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION,
    trust: "untrusted_human_draft",
    workflow_state: "S60",
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION,
    record_version: 4,
    draft_revision: 1,
    action_plan: actionPlan(),
    updated_by_user_id: USER,
    updated_at: AT,
    ...overrides,
  };
}

function database() {
  let sequence = 0;
  return new InMemoryCapaDatabase({
    generate_transaction_id: () => `tx-${++sequence}` as never,
    now: () => new Date(AT),
  });
}

describe("S60 action-plan workspace contract and persistence", () => {
  it("validates an incomplete but structurally valid draft and freezes normalized output", () => {
    const result = validateCapaActionPlanWorkspaceDraft(draft());
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.value.workflow_state).toBe("S60");
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.action_plan)).toBe(true);
  });

  it("fails closed for envelope literals, IDs, revisions, timestamps, and malformed action plans", () => {
    const cases: readonly [Record<string, unknown>, string][] = [
      [draft({ schema_version: "wrong" }), "INVALID_WORKSPACE_DRAFT_SCHEMA_VERSION"],
      [draft({ trust: "authoritative_server_context" }), "INVALID_WORKSPACE_DRAFT_TRUST"],
      [draft({ workflow_state: "S50" }), "INVALID_WORKSPACE_DRAFT_WORKFLOW_STATE"],
      [draft({ organization_id: "not-a-uuid" }), "INVALID_WORKSPACE_DRAFT_IDENTITY"],
      [draft({ record_version: 0 }), "INVALID_WORKSPACE_DRAFT_RECORD_VERSION"],
      [draft({ draft_revision: Number.MAX_SAFE_INTEGER + 1 }), "INVALID_WORKSPACE_DRAFT_REVISION"],
      [draft({ updated_at: "not-a-time" }), "INVALID_WORKSPACE_DRAFT_UPDATED_AT"],
      [draft({ action_plan: { items: "not-an-array", effectiveness_checks: [] } }), "INVALID_WORKSPACE_DRAFT_ACTION_PLAN"],
    ];
    for (const [value, reason_code] of cases) {
      expect(validateCapaActionPlanWorkspaceDraft(value)).toEqual({ status: "invalid", reason_code, ...(reason_code === "INVALID_WORKSPACE_DRAFT_ACTION_PLAN" ? { detail_reason_code: "INVALID_ACTION_PLAN_ITEMS" } : {}) });
    }
  });

  it("accepts only the client-editable request fields and preserves domain failure detail", () => {
    expect(validateCapaActionPlanWorkspaceDraftSaveRequest({ expected_draft_revision: null, action_plan: actionPlan() })).toMatchObject({ status: "valid" });
    expect(validateCapaActionPlanWorkspaceDraftSaveRequest({ expected_draft_revision: 1, action_plan: actionPlan() })).toMatchObject({ status: "valid" });
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(validateCapaActionPlanWorkspaceDraftSaveRequest({ expected_draft_revision: revision, action_plan: actionPlan() })).toMatchObject({ status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_REVISION" });
    }
    expect(validateCapaActionPlanWorkspaceDraftSaveRequest({ expected_draft_revision: null, action_plan: actionPlan(), organization_id: ORG })).toMatchObject({ status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_FIELDS" });
    expect(validateCapaActionPlanWorkspaceDraftSaveRequest({ expected_draft_revision: null, action_plan: { items: {}, effectiveness_checks: [] } })).toEqual({ status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_ACTION_PLAN", detail_reason_code: "INVALID_ACTION_PLAN_ITEMS" });
  });

  it("uses organization/case scoped revision CAS and preserves rollback", async () => {
    const db = database();
    expect(await db.findActionPlanWorkspaceDraft(ORG as never, CASE as never)).toBeNull();
    await db.runInTransaction({ request_id: "r1" as never, correlation_id: "c1" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft() as never, expected_draft_revision: null }));
    expect(await db.runInTransaction({ request_id: "r2" as never, correlation_id: "c2" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft() as never, expected_draft_revision: null }))).toEqual({ status: "concurrency_conflict" });
    await db.runInTransaction({ request_id: "r3" as never, correlation_id: "c3" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 2 }) as never, expected_draft_revision: 1 }));
    expect((await db.findActionPlanWorkspaceDraft(ORG as never, CASE as never))?.draft_revision).toBe(2);
    await expect(db.runInTransaction({ request_id: "r4" as never, correlation_id: "c4" as never }, async (tx) => { await db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 3 }) as never, expected_draft_revision: 2 }); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect((await db.findActionPlanWorkspaceDraft(ORG as never, CASE as never))?.draft_revision).toBe(2);
  });

  it("reads the transaction-visible workspace revision for update", async () => {
    const db = database();
    await db.runInTransaction({ request_id: "seed-lock-1" as never, correlation_id: "seed-lock-1" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft() as never, expected_draft_revision: null }));
    await db.runInTransaction({ request_id: "seed-lock-2" as never, correlation_id: "seed-lock-2" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 2 }) as never, expected_draft_revision: 1 }));
    await db.runInTransaction({ request_id: "seed-lock-3" as never, correlation_id: "seed-lock-3" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 3 }) as never, expected_draft_revision: 2 }));
    await db.runInTransaction({ request_id: "lock" as never, correlation_id: "lock" as never }, async (tx) => {
      const locked = await db.findActionPlanWorkspaceDraftForUpdate(tx, ORG as never, CASE as never);
      expect(locked).toMatchObject({ draft_revision: 3 });
      await db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 4 }) as never, expected_draft_revision: 3 });
      await expect(db.findActionPlanWorkspaceDraftForUpdate(tx, ORG as never, CASE as never)).resolves.toMatchObject({ draft_revision: 4 });
    });
    await expect(db.findActionPlanWorkspaceDraft(ORG as never, CASE as never)).resolves.toMatchObject({ draft_revision: 4 });
  });

  it("round-trips the durable workspace through the development snapshot", async () => {
    const source = database();
    await source.runInTransaction({ request_id: "snapshot-1" as never, correlation_id: "snapshot-1" as never }, (tx) => source.saveActionPlanWorkspaceDraft(tx, { draft: draft() as never, expected_draft_revision: null }));
    const restored = databaseFromSnapshot(source.exportSnapshot());
    await expect(restored.findActionPlanWorkspaceDraft(ORG as never, CASE as never)).resolves.toMatchObject({ workflow_state: "S60", draft_revision: 1 });
  });

  it("guarded saves distinguish a changed authoritative S60 context", async () => {
    const db = database();
    const capaCase = { organization_id: ORG, capa_case_id: CASE, current_version_id: VERSION, status: "S60", record_version: 4 } as never;
    const caseVersion = { organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, version_number: 4, status: "S60", section_version_ids: [] } as never;
    await db.runInTransaction({ request_id: "seed" as never, correlation_id: "seed" as never }, async (tx) => { await db.insertCase(tx, capaCase); await db.insertCaseVersion(tx, caseVersion); });
    await expect(db.runInTransaction({ request_id: "r5" as never, correlation_id: "c5" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft() as never, expected_draft_revision: null, expected_case_version_id: VERSION as never, expected_record_version: 4, expected_workflow_state: "S60" as never }))).resolves.toMatchObject({ status: "saved" });
    await expect(db.runInTransaction({ request_id: "r6" as never, correlation_id: "c6" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 2 }) as never, expected_draft_revision: 1, expected_case_version_id: "39999999-0000-4000-8000-000000000001" as never, expected_record_version: 4, expected_workflow_state: "S60" as never }))).resolves.toEqual({ status: "case_changed" });
    await expect(db.runInTransaction({ request_id: "r7" as never, correlation_id: "c7" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 2 }) as never, expected_draft_revision: 1, expected_case_version_id: VERSION as never, expected_record_version: 3, expected_workflow_state: "S60" as never }))).resolves.toEqual({ status: "case_changed" });
    await expect(db.runInTransaction({ request_id: "r8" as never, correlation_id: "c8" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 2 }) as never, expected_draft_revision: 1, expected_case_version_id: VERSION as never, expected_record_version: 4, expected_workflow_state: "S50" as never }))).resolves.toEqual({ status: "case_changed" });
    await expect(db.runInTransaction({ request_id: "r9" as never, correlation_id: "c9" as never }, (tx) => db.saveActionPlanWorkspaceDraft(tx, { draft: draft({ draft_revision: 3 }) as never, expected_draft_revision: 1, expected_case_version_id: VERSION as never, expected_record_version: 4, expected_workflow_state: "S60" as never }))).resolves.toEqual({ status: "concurrency_conflict" });
  });
});

function databaseFromSnapshot(snapshot: ReturnType<InMemoryCapaDatabase["exportSnapshot"]>) {
  let sequence = 0;
  return new InMemoryCapaDatabase({
    generate_transaction_id: () => `restored-${++sequence}` as never,
    now: () => new Date(AT),
    initial_snapshot: snapshot,
  });
}
