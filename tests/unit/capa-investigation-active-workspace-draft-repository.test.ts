import { describe, expect, it } from "vitest";
import type { CapaCase, CapaCaseVersion } from "../../lib/capa/domain/capa-types";
import type {
  CapaInvestigationActiveWorkspaceDraft,
} from "../../lib/capa/application/capa-investigation-active-workspace-draft-contract";
import type {
  SaveCapaInvestigationActiveWorkspaceDraftInput,
  SaveCapaInvestigationActiveWorkspaceDraftResult,
} from "../../lib/database/repositories/capa-investigation-active-workspace-draft-repository";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";
import { CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION } from "../../lib/capa/application/capa-investigation-active-workspace-draft-contract";

const ORG = "10000000-0000-4000-8000-000000000001" as never;
const CASE = "20000000-0000-4000-8000-000000000001" as never;
const NOW = "2026-09-05T12:00:00.000Z" as never;
function draft(revision = 1, organization_id = ORG, capa_case_id = CASE): CapaInvestigationActiveWorkspaceDraft { return { schema_version: CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION, trust: "untrusted_human_draft", workflow_state: "S40", organization_id, capa_case_id, case_version_id: "30000000-0000-4000-8000-000000000001" as never, record_version: 4, draft_revision: revision, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_by_user_id: "40000000-0000-4000-8000-000000000001" as never, updated_at: NOW }; }
function database() { let id = 0; return new InMemoryCapaDatabase({ generate_transaction_id: () => `tx-${++id}` as never, now: () => new Date(NOW) }); }
const VERSION = "30000000-0000-4000-8000-000000000001" as never;
function authoritativeCase(): CapaCase { return { organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-000001", current_version_id: VERSION, status: "S40", record_version: 4 } as never; }
function authoritativeVersion(): CapaCaseVersion { return { organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, version_number: 4, status: "S40", section_version_ids: [] } as never; }
function authoritativeContext(overrides: Partial<Pick<SaveCapaInvestigationActiveWorkspaceDraftInput, "expected_case_version_id" | "expected_record_version" | "expected_workflow_state">> = {}): Pick<SaveCapaInvestigationActiveWorkspaceDraftInput, "expected_case_version_id" | "expected_record_version" | "expected_workflow_state"> { return { expected_case_version_id: VERSION, expected_record_version: 4, expected_workflow_state: "S40" as never, ...overrides }; }
async function seedAuthoritativeContext(db: InMemoryCapaDatabase): Promise<void> { await db.runInTransaction({ request_id: "seed-r" as never, correlation_id: "seed-c" as never }, async (tx) => { await db.insertCase(tx, authoritativeCase()); await db.insertCaseVersion(tx, authoritativeVersion()); }); }

describe("S40 investigation-active workspace draft repository contract", () => {
  it("defines case-scoped read and explicit compare-and-swap save results", () => {
    const draft = {} as CapaInvestigationActiveWorkspaceDraft;
    const create: SaveCapaInvestigationActiveWorkspaceDraftInput = { draft, expected_draft_revision: null };
    const update: SaveCapaInvestigationActiveWorkspaceDraftInput = { draft: { ...draft, draft_revision: 2 }, expected_draft_revision: 1 };
    const saved: SaveCapaInvestigationActiveWorkspaceDraftResult = { status: "saved", draft };
    const stale: SaveCapaInvestigationActiveWorkspaceDraftResult = { status: "concurrency_conflict" };

    expect(create.expected_draft_revision).toBeNull();
    expect(update.expected_draft_revision).toBe(1);
    expect(saved.status).toBe("saved");
    expect(stale.status).toBe("concurrency_conflict");
  });

  it("enforces case-and-organization scoped CAS with defensive transactional storage", async () => {
    const db = database();
    expect(await db.findDraft(ORG, CASE)).toBeNull();
    await db.runInTransaction({ request_id: "r" as never, correlation_id: "c" as never }, async (tx) => expect(await db.saveDraft(tx, { draft: draft(), expected_draft_revision: null })).toMatchObject({ status: "saved" }));
    expect(await db.runInTransaction({ request_id: "r2" as never, correlation_id: "c2" as never }, (tx) => db.saveDraft(tx, { draft: draft(), expected_draft_revision: null }))).toEqual({ status: "concurrency_conflict" });
    expect(await db.runInTransaction({ request_id: "r3" as never, correlation_id: "c3" as never }, (tx) => db.saveDraft(tx, { draft: draft(3), expected_draft_revision: 1 }))).toEqual({ status: "concurrency_conflict" });
    await db.runInTransaction({ request_id: "r4" as never, correlation_id: "c4" as never }, (tx) => db.saveDraft(tx, { draft: draft(2), expected_draft_revision: 1 }));
    const found = await db.findDraft(ORG, CASE); (found as any).draft_revision = 9; expect((await db.findDraft(ORG, CASE))?.draft_revision).toBe(2);
    await expect(db.runInTransaction({ request_id: "r5" as never, correlation_id: "c5" as never }, async (tx) => { await db.saveDraft(tx, { draft: draft(3), expected_draft_revision: 2 }); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect((await db.findDraft(ORG, CASE))?.draft_revision).toBe(2);
    expect(await db.findDraft("90000000-0000-4000-8000-000000000001" as never, CASE)).toBeNull();
  });

  it("requires the matching immutable CAPA case version for guarded saves", async () => {
    const matching = database();
    await seedAuthoritativeContext(matching);
    await expect(matching.runInTransaction({ request_id: "r6" as never, correlation_id: "c6" as never }, (tx) => matching.saveDraft(tx, { draft: draft(), expected_draft_revision: null, ...authoritativeContext() }))).resolves.toMatchObject({ status: "saved" });

    for (const context of [
      authoritativeContext({ expected_case_version_id: "39999999-0000-4000-8000-000000000001" as never }),
      authoritativeContext({ expected_record_version: 3 }),
      authoritativeContext({ expected_workflow_state: "S30" }),
    ]) {
      const changed = database();
      await seedAuthoritativeContext(changed);
      await expect(changed.runInTransaction({ request_id: "r7" as never, correlation_id: "c7" as never }, (tx) => changed.saveDraft(tx, { draft: draft(), expected_draft_revision: null, ...context }))).resolves.toEqual({ status: "case_changed" });
      expect(await changed.findDraft(ORG, CASE)).toBeNull();
    }

  });

  it("keeps guarded case checks separate from workspace revision CAS", async () => {
    const db = database();
    await seedAuthoritativeContext(db);
    await db.runInTransaction({ request_id: "r10" as never, correlation_id: "c10" as never }, (tx) => db.saveDraft(tx, { draft: draft(), expected_draft_revision: null, ...authoritativeContext() }));
    await expect(db.runInTransaction({ request_id: "r11" as never, correlation_id: "c11" as never }, (tx) => db.saveDraft(tx, { draft: draft(3), expected_draft_revision: 1, ...authoritativeContext() }))).resolves.toEqual({ status: "concurrency_conflict" });
    expect((await db.findDraft(ORG, CASE))?.draft_revision).toBe(1);
  });
});
