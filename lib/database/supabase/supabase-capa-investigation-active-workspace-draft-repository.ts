import postgres from "postgres";
import type { CapaInvestigationActiveWorkspaceDraft } from "../../capa/application/capa-investigation-active-workspace-draft-contract";
import { validateCapaInvestigationActiveWorkspaceDraft } from "../../capa/application/capa-investigation-active-workspace-draft-validator";
import type { CapaCaseId, OrganizationId } from "../../capa/domain/capa-types";
import type { CapaInvestigationActiveWorkspaceDraftRepository, SaveCapaInvestigationActiveWorkspaceDraftInput, SaveCapaInvestigationActiveWorkspaceDraftResult } from "../repositories/capa-investigation-active-workspace-draft-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;
export class SupabaseCapaInvestigationActiveWorkspaceDraftRepositoryError extends Error {
  constructor() { super("The S40 workspace draft repository operation failed."); this.name = "SupabaseCapaInvestigationActiveWorkspaceDraftRepositoryError"; }
}
function fail(): never { throw new SupabaseCapaInvestigationActiveWorkspaceDraftRepositoryError(); }
function fromRow(row: Row): CapaInvestigationActiveWorkspaceDraft {
  const value = { schema_version: row.schema_version, trust: row.trust, workflow_state: row.workflow_state, organization_id: row.organization_id, capa_case_id: row.capa_case_id, case_version_id: row.case_version_id, record_version: typeof row.record_version === "number" ? row.record_version : Number(row.record_version), draft_revision: typeof row.draft_revision === "number" ? row.draft_revision : Number(row.draft_revision), evidence_assumption_ledger: row.evidence_assumption_ledger, root_cause_package: row.root_cause_package, updated_by_user_id: row.updated_by_user_id, updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
  const validated = validateCapaInvestigationActiveWorkspaceDraft(value);
  if (validated.status !== "valid") fail();
  return validated.value;
}
function input(value: SaveCapaInvestigationActiveWorkspaceDraftInput): CapaInvestigationActiveWorkspaceDraft {
  const validated = validateCapaInvestigationActiveWorkspaceDraft(value.draft);
  if (validated.status !== "valid") fail();
  return validated.value;
}
function json(value: unknown): postgres.JSONValue { try { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue; } catch { return fail(); } }
export class SupabaseCapaInvestigationActiveWorkspaceDraftRepository implements CapaInvestigationActiveWorkspaceDraftRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async findDraft(organizationId: OrganizationId, capaCaseId: CapaCaseId): Promise<CapaInvestigationActiveWorkspaceDraft | null> {
    const rows = await this.sql<Row[]>`select * from public.capa_investigation_active_workspace_drafts where organization_id = ${organizationId} and capa_case_id = ${capaCaseId} limit 2`;
    if (rows.length > 1) fail();
    return rows[0] === undefined ? null : fromRow(rows[0]);
  }
  async saveDraft(transaction: TransactionContext, value: SaveCapaInvestigationActiveWorkspaceDraftInput): Promise<SaveCapaInvestigationActiveWorkspaceDraftResult> {
    let sql: postgres.TransactionSql; let draft: CapaInvestigationActiveWorkspaceDraft;
    try { sql = requireSupabaseTransaction(transaction); draft = input(value); } catch { fail(); }
    if (value.expected_draft_revision === null) {
      if (draft.draft_revision !== 1) return { status: "concurrency_conflict" };
      const rows = await sql<Row[]>`insert into public.capa_investigation_active_workspace_drafts (organization_id, capa_case_id, case_version_id, record_version, draft_revision, schema_version, trust, workflow_state, evidence_assumption_ledger, root_cause_package, updated_by_user_id, updated_at) values (${draft.organization_id}, ${draft.capa_case_id}, ${draft.case_version_id}, ${draft.record_version}, ${draft.draft_revision}, ${draft.schema_version}, ${draft.trust}, ${draft.workflow_state}, ${sql.json(json(draft.evidence_assumption_ledger))}, ${sql.json(json(draft.root_cause_package))}, ${draft.updated_by_user_id}, ${draft.updated_at}) on conflict (organization_id, capa_case_id) do nothing returning *`;
      if (rows.length === 0) return { status: "concurrency_conflict" }; if (rows.length !== 1) fail(); return { status: "saved", draft: fromRow(rows[0]) };
    }
    if (draft.draft_revision !== value.expected_draft_revision + 1) return { status: "concurrency_conflict" };
    const rows = await sql<Row[]>`update public.capa_investigation_active_workspace_drafts set case_version_id = ${draft.case_version_id}, record_version = ${draft.record_version}, draft_revision = ${draft.draft_revision}, schema_version = ${draft.schema_version}, trust = ${draft.trust}, workflow_state = ${draft.workflow_state}, evidence_assumption_ledger = ${sql.json(json(draft.evidence_assumption_ledger))}, root_cause_package = ${sql.json(json(draft.root_cause_package))}, updated_by_user_id = ${draft.updated_by_user_id}, updated_at = ${draft.updated_at} where organization_id = ${draft.organization_id}
      and capa_case_id = ${draft.capa_case_id}
      and draft_revision = ${value.expected_draft_revision} returning *`;
    if (rows.length === 0) return { status: "concurrency_conflict" }; if (rows.length !== 1) fail(); return { status: "saved", draft: fromRow(rows[0]) };
  }
}
