import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import type { SaveCapaImplementationWorkspaceInput } from "../../lib/database/repositories/capa-implementation-workspace-repository";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import {
  CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-contract";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION as RETURN_SCHEMA,
} from "../../lib/capa/implementation/capa-implementation-return-response-contract";
import {
  SupabaseCapaImplementationWorkspaceRepository,
  SupabaseCapaImplementationWorkspaceRepositoryError,
} from "../../lib/database/supabase/supabase-capa-implementation-workspace-repository";

let transactionSql: postgres.TransactionSql;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({
  requireSupabaseTransaction: vi.fn(() => transactionSql),
}));

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "10000000-0000-4000-8000-000000000002";
const CASE = "20000000-0000-4000-8000-000000000001";
const OTHER_CASE = "20000000-0000-4000-8000-000000000002";
const SOURCE_VERSION = "30000000-0000-4000-8000-000000000001";
const CURRENT_VERSION = "30000000-0000-4000-8000-000000000002";
const OLD_VERSION = "30000000-0000-4000-8000-000000000003";
const ACTION_SECTION = "40000000-0000-4000-8000-000000000001";
const APPROVAL_AUDIT = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

const BASELINE = {
  source_case_version_id: SOURCE_VERSION,
  approved_action_plan_section_id: ACTION_SECTION,
  approval_decision_reference: APPROVAL_AUDIT,
};

const ACTION_PLAN = {
  items: [{
    item_id: "ACTION-1",
    action_type: null,
    description: "Complete the approved implementation action.",
    linked_targets: [],
    owner_user_id: null,
    due_date: null,
    status: "approved",
    deliverable: null,
    implementation_evidence: null,
    dependency_item_ids: [],
    unintended_consequence_assessment: null,
    effectiveness_check_required: false,
    draft_provenance: {
      source_type: "human",
      source_reference: null,
      adopted_by_user_id: null,
      adopted_at: null,
    },
  }],
  effectiveness_checks: [],
};

function source() {
  return {
    origin_kind: "uploaded_artifact",
    source_system_kind: "other",
    source_system_name: "Document store",
    source_record_reference: "TR-001",
    source_record_version: "1",
    artifact_reference: "artifact://TR-001",
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
    action_progress: [{
      approved_action_reference: "ACTION-1",
      owner_reported_status: "in_progress",
      implementation_narrative: "Implementation is underway.",
      blocked_reason: null,
      evidence: [{
        schema_version: CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
        evidence_id: "70000000-0000-4000-8000-000000000001",
        approved_action_reference: "ACTION-1",
        evidence_kind: "training_record",
        description: "Training completion record",
        evidence_date: "2026-09-10",
        source: source(),
      }],
    }],
    implementation_review_return_response: null,
    ...overrides,
  };
}

function response() {
  return {
    schema_version: RETURN_SCHEMA,
    return_transition_audit_event_id: "80000000-0000-4000-8000-000000000001",
    source_case_version_id: SOURCE_VERSION,
    resulting_case_version_id: CURRENT_VERSION,
    response_narrative: "The returned implementation comments were addressed.",
  };
}

function saveInput(
  overrides: Record<string, unknown> = {},
): SaveCapaImplementationWorkspaceInput {
  return {
    organization_id: ORG as never,
    capa_case_id: CASE as never,
    case_version_id: CURRENT_VERSION as never,
    record_version: 8,
    draft: draft() as never,
    draft_revision: 1,
    expected_draft_revision: null,
    actor_user_id: USER as never,
    approved_s70_baseline: BASELINE as never,
    ...overrides,
  } as SaveCapaImplementationWorkspaceInput;
}

function row(revision = 1, workspaceDraft = draft()) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: CURRENT_VERSION,
    record_version: 8,
    workflow_state: "S80",
    source_case_version_id: SOURCE_VERSION,
    approved_action_plan_section_id: ACTION_SECTION,
    approval_decision_reference: APPROVAL_AUDIT,
    draft_revision: revision,
    schema_version: CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
    workspace_draft: workspaceDraft,
    created_by_user_id: USER,
    created_at: AT,
    updated_by_user_id: USER,
    updated_at: AT,
  };
}

function oldRow(revision = 1, workspaceDraft = draft()) {
  return {
    ...row(revision, workspaceDraft),
    case_version_id: OLD_VERSION,
    record_version: 7,
  };
}

function harness(...responses: unknown[]) {
  const queue = [...responses];
  const calls: { readonly text: string; readonly values: readonly unknown[] }[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return queue.shift() ?? [];
  });
  const tagged = Object.assign(sql, { json: (value: unknown) => value }) as unknown as postgres.TransactionSql;
  transactionSql = tagged;
  return { sql: tagged, calls, transaction: {} as never };
}

describe("Supabase S80 implementation workspace repository", () => {
  it("loads tenant-scoped rows, preserves nullable return responses, and locks transaction reads", async () => {
    const absent = harness([]);
    await expect(new SupabaseCapaImplementationWorkspaceRepository(absent.sql as never).findWorkspace(ORG as never, CASE as never)).resolves.toBeNull();
    expect(absent.calls[0].values).toEqual([ORG, CASE]);

    const persisted = draft({ implementation_review_return_response: response() });
    const loaded = harness([row(2, persisted)]);
    await expect(new SupabaseCapaImplementationWorkspaceRepository(loaded.sql as never).findWorkspace(ORG as never, CASE as never)).resolves.toMatchObject({
      draft_revision: 2,
      draft: persisted,
    });

    const locked = harness([row(2)]);
    await expect(new SupabaseCapaImplementationWorkspaceRepository(locked.sql as never).findWorkspaceForUpdate(locked.transaction, ORG as never, CASE as never)).resolves.toMatchObject({ draft_revision: 2 });
    expect(locked.calls[0].text).toMatch(/for update/);
  });

  it("A/B/C/D/E/F/G/H/J/K/M: initializes and updates atomically with server metadata and revision CAS", async () => {
    const created = harness([{ content: ACTION_PLAN }], [row()]);
    const repository = new SupabaseCapaImplementationWorkspaceRepository(created.sql as never);
    await expect(repository.initializeWorkspace(created.transaction, saveInput())).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: 1, draft: { implementation_review_return_response: null } } });
    expect(created.calls[0].text).toContain("capa_action_plan_review_decisions");
    expect(created.calls[0].text).toContain("capa_case_version_sections");
    expect(created.calls[0].text).not.toContain("source_version.section_version_ids");
    expect(created.calls[1].text).toMatch(/insert into public\.capa_implementation_workspace_drafts[\s\S]*on conflict/);
    expect(created.calls[1].text).toContain("workspace_draft");
    expect(created.calls[1].text).not.toContain("created_at");

    const updatedDraft = draft({
      action_progress: [{
        approved_action_reference: "ACTION-1",
        owner_reported_status: "blocked",
        implementation_narrative: "Implementation is paused.",
        blocked_reason: "Awaiting validated equipment access.",
        evidence: [],
      }],
    });
    const updated = harness(
      [row()],
      [{ current_version_id: CURRENT_VERSION }],
      [{ content: ACTION_PLAN }],
      [row(2, updatedDraft)],
    );
    await expect(new SupabaseCapaImplementationWorkspaceRepository(updated.sql as never).saveWorkspace(updated.transaction, saveInput({
      draft: updatedDraft,
      draft_revision: 2,
      expected_draft_revision: 1,
    }))).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: 2, draft: updatedDraft } });
    expect(updated.calls[3].text).toMatch(/update public\.capa_implementation_workspace_drafts[\s\S]*draft_revision = \?[\s\S]*returning \*/);
    expect(updated.calls[3].text).toContain("updated_at = statement_timestamp()");
    expect(updated.calls[3].text.split("where")[0]).not.toContain("source_case_version_id");
  });

  it("I: rejects stale revisions before issuing a write", async () => {
    const stale = harness();
    await expect(new SupabaseCapaImplementationWorkspaceRepository(stale.sql as never).saveWorkspace(stale.transaction, saveInput({
      draft_revision: 3,
      expected_draft_revision: 1,
    }))).resolves.toEqual({ status: "concurrency_conflict" });
    expect(stale.calls).toHaveLength(0);
  });

  it("K: rejects an attempted baseline replacement without issuing a write", async () => {
    const attempted = harness([row()]);
    await expect(new SupabaseCapaImplementationWorkspaceRepository(attempted.sql as never).saveWorkspace(attempted.transaction, saveInput({
      draft_revision: 2,
      expected_draft_revision: 1,
      approved_s70_baseline: {
        ...BASELINE,
        approval_decision_reference: "90000000-0000-4000-8000-000000000001",
      },
    }))).resolves.toEqual({ status: "baseline_conflict" });
    expect(attempted.calls).toHaveLength(1);
  });

  it("rolls an old S80 workspace forward only under an atomic authoritative S80 guard", async () => {
    const rolled = draft({ implementation_review_return_response: response() });
    const h = harness(
      [{ content: ACTION_PLAN }],
      [],
      [oldRow()],
      [row(1, rolled)],
    );
    const result = await new SupabaseCapaImplementationWorkspaceRepository(h.sql as never).saveWorkspace(
      h.transaction,
      saveInput({ draft: rolled }),
    );
    expect(result).toMatchObject({ status: "saved", workspace: { case_version_id: CURRENT_VERSION, record_version: 8, draft: rolled } });
    expect(h.calls).toHaveLength(4);
    expect(h.calls[3].text).toMatch(/update public\.capa_implementation_workspace_drafts[\s\S]*where organization_id = \?[\s\S]*and capa_case_id = \?[\s\S]*exists \([\s\S]*from public\.capa_cases as capa_case[\s\S]*join public\.capa_case_versions as current_version[\s\S]*current_version\.organization_id = capa_case\.organization_id[\s\S]*current_version\.capa_case_id = capa_case\.capa_case_id[\s\S]*current_version\.case_version_id = capa_case\.current_version_id[\s\S]*current_version\.version_number = capa_case\.record_version[\s\S]*current_version\.status = 'S80'[\s\S]*capa_case\.organization_id = \?[\s\S]*capa_case\.capa_case_id = \?[\s\S]*capa_case\.status = 'S80'[\s\S]*capa_case\.current_version_id = \?[\s\S]*capa_case\.record_version = \?/);
    expect(h.calls[3].values).toEqual(expect.arrayContaining([ORG, CASE, CURRENT_VERSION, 8]));
  });

  it.each([
    ["case leaves S80", {}],
    ["current version changes", { case_version_id: "30000000-0000-4000-8000-000000000004" }],
    ["record version changes", { record_version: 9 }],
  ] as const)("does not roll over when the authoritative S80 context no longer matches: %s", async (_label, inputOverrides) => {
    const h = harness(
      [{ content: ACTION_PLAN }],
      [],
      [oldRow()],
      [],
    );
    await expect(new SupabaseCapaImplementationWorkspaceRepository(h.sql as never).saveWorkspace(
      h.transaction,
      saveInput(inputOverrides),
    )).resolves.toEqual({ status: "concurrency_conflict" });
    expect(h.calls[3].text).toContain("exists (");
  });

  it.each([
    ["wrong organization", { organization_id: OTHER_ORG }],
    ["wrong case", { capa_case_id: OTHER_CASE }],
  ] as const)("does not roll over across the tenant/case boundary: %s", async (_label, inputOverrides) => {
    const h = harness(
      [{ content: ACTION_PLAN }],
      [],
      [],
      [],
    );
    await expect(new SupabaseCapaImplementationWorkspaceRepository(h.sql as never).saveWorkspace(
      h.transaction,
      saveInput(inputOverrides),
    )).resolves.toEqual({ status: "case_changed" });
    expect(h.calls).toHaveLength(4);
    expect(h.calls.some((call) => call.text.includes("update public.capa_implementation_workspace_drafts"))).toBe(false);
  });

  it("maps a guarded competing rollover miss to concurrency without overwriting the workspace", async () => {
    const h = harness(
      [{ content: ACTION_PLAN }],
      [],
      [oldRow()],
      [],
    );
    await expect(new SupabaseCapaImplementationWorkspaceRepository(h.sql as never).saveWorkspace(
      h.transaction,
      saveInput(),
    )).resolves.toEqual({ status: "concurrency_conflict" });
    expect(h.calls[3].text).toContain("exists (");
  });

  it("N: rejects malformed domain content before SQL", async () => {
    const malformed = harness();
    await expect(new SupabaseCapaImplementationWorkspaceRepository(malformed.sql as never).initializeWorkspace(malformed.transaction, saveInput({
      draft: { ...draft(), unexpected: true },
    }) as never)).rejects.toThrow(SupabaseCapaImplementationWorkspaceRepositoryError);
    expect(malformed.calls).toHaveLength(0);
  });

  it("validates the original and additive migration sources and storage constraints", () => {
    const originalMigration = readFileSync(
      "supabase/migrations/20260910100000_create_capa_implementation_workspace_drafts.sql",
      "utf8",
    );
    const rolloverMigration = readFileSync(
      "supabase/migrations/20260912133000_fix_capa_implementation_workspace_return_rollover_guard.sql",
      "utf8",
    );
    expect(originalMigration).toContain("create table public.capa_implementation_workspace_drafts");
    expect(originalMigration).toContain("primary key (organization_id, capa_case_id)");
    expect(originalMigration).toContain("jsonb_typeof(workspace_draft) = 'object'");
    expect(originalMigration).toContain("draft_revision >= 1");
    expect(originalMigration).toContain("source_case_version_id");
    expect(originalMigration).toContain("approved_action_plan_section_id");
    expect(originalMigration).toContain("approval_decision_reference");
    expect(originalMigration).toContain("workspace_draft");
    expect(originalMigration).toContain("capa_case_version_sections");
    expect(originalMigration).toContain("approved baseline is immutable");
    expect(originalMigration).toContain("capa_s80_implementation_workspace_baseline_guard");
    expect(originalMigration).toContain("decision.resulting_case_version_id = new.case_version_id");
    expect(originalMigration).not.toContain("old.case_version_id <> new.case_version_id");
    expect(originalMigration).not.toContain("Original S80 implementation workspace must bind the approved S70 decision result.");
    expect(originalMigration).not.toContain("review_decision.decision = 'return'");
    expect(rolloverMigration).toContain("create or replace function private.capa_s80_implementation_workspace_baseline_guard");
    expect(rolloverMigration).toContain("old.case_version_id <> new.case_version_id");
    expect(rolloverMigration).toContain("capa_implementation_review_decisions");
    expect(rolloverMigration).toContain("review_decision.decision = 'return'");
    expect(rolloverMigration).toContain("capa_case_version_sections");
    expect(rolloverMigration).not.toMatch(/create table|drop table|supabase db push/i);
    expect(RETURN_SCHEMA).toBe(
      "capa-implementation-review-return-response-draft-1.0.0",
    );
  });
});
