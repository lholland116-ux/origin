import postgres from "postgres";
import type { CapaActionPlanWorkspaceDraft } from "../../capa/application/capa-action-plan-workspace-draft-contract";
import { validateCapaActionPlanWorkspaceDraft } from "../../capa/application/capa-action-plan-workspace-draft-validator";
import type { CapaCaseId, OrganizationId } from "../../capa/domain/capa-types";
import type { CapaActionPlanWorkspaceDraftRepository, SaveCapaActionPlanWorkspaceDraftInput, SaveCapaActionPlanWorkspaceDraftResult } from "../repositories/capa-action-plan-workspace-draft-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;

export class SupabaseCapaActionPlanWorkspaceDraftRepositoryError extends Error {
  constructor() { super("The S60 action-plan workspace draft repository operation failed."); this.name = "SupabaseCapaActionPlanWorkspaceDraftRepositoryError"; }
}

function fail(): never { throw new SupabaseCapaActionPlanWorkspaceDraftRepositoryError(); }

function fromRow(row: Row): CapaActionPlanWorkspaceDraft {
  const value = {
    schema_version: row.schema_version,
    trust: row.trust,
    workflow_state: row.workflow_state,
    organization_id: row.organization_id,
    capa_case_id: row.capa_case_id,
    case_version_id: row.case_version_id,
    record_version: typeof row.record_version === "number" ? row.record_version : Number(row.record_version),
    draft_revision: typeof row.draft_revision === "number" ? row.draft_revision : Number(row.draft_revision),
    action_plan: row.action_plan,
    updated_by_user_id: row.updated_by_user_id,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
  const validated = validateCapaActionPlanWorkspaceDraft(value);
  if (validated.status !== "valid") fail();
  return validated.value;
}

function input(value: SaveCapaActionPlanWorkspaceDraftInput): CapaActionPlanWorkspaceDraft {
  const validated = validateCapaActionPlanWorkspaceDraft(value.draft);
  if (validated.status !== "valid") fail();
  return validated.value;
}

function json(value: unknown): postgres.JSONValue {
  try { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue; } catch { return fail(); }
}

async function caseContextMatches(
  sql: postgres.TransactionSql,
  draft: CapaActionPlanWorkspaceDraft,
  value: SaveCapaActionPlanWorkspaceDraftInput,
): Promise<boolean> {
  const rows = await sql<readonly { readonly current_version_id: string; readonly record_version: number | string; readonly status: string }[]>`select capa_case.current_version_id, capa_case.record_version, capa_case.status
    from public.capa_cases as capa_case
    where capa_case.organization_id = ${draft.organization_id}
      and capa_case.capa_case_id = ${draft.capa_case_id}
      and capa_case.current_version_id = ${value.expected_case_version_id!}
      and capa_case.record_version = ${value.expected_record_version!}
      and capa_case.status = ${value.expected_workflow_state!}
      and exists (
        select 1
        from public.capa_case_versions as case_version
        where case_version.organization_id = capa_case.organization_id
          and case_version.capa_case_id = capa_case.capa_case_id
          and case_version.case_version_id = capa_case.current_version_id
          and case_version.version_number = capa_case.record_version
          and case_version.status = capa_case.status
      )
    limit 2`;
  if (rows.length > 1) fail();
  return rows.length === 1;
}

export class SupabaseCapaActionPlanWorkspaceDraftRepository implements CapaActionPlanWorkspaceDraftRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async findDraft(organizationId: OrganizationId, capaCaseId: CapaCaseId): Promise<CapaActionPlanWorkspaceDraft | null> {
    const rows = await this.sql<Row[]>`select * from public.capa_action_plan_workspace_drafts where organization_id = ${organizationId} and capa_case_id = ${capaCaseId} limit 2`;
    if (rows.length > 1) fail();
    return rows[0] === undefined ? null : fromRow(rows[0]);
  }

  async saveDraft(transaction: TransactionContext, value: SaveCapaActionPlanWorkspaceDraftInput): Promise<SaveCapaActionPlanWorkspaceDraftResult> {
    let sql: postgres.TransactionSql;
    let draft: CapaActionPlanWorkspaceDraft;
    try { sql = requireSupabaseTransaction(transaction); draft = input(value); } catch { fail(); }
    const hasExpectedCaseContext = value.expected_case_version_id !== undefined || value.expected_record_version !== undefined || value.expected_workflow_state !== undefined;
    if (hasExpectedCaseContext && (value.expected_case_version_id === undefined || value.expected_record_version === undefined || value.expected_workflow_state === undefined)) return { status: "case_changed" };
    const expectedCaseVersionId = value.expected_case_version_id;
    const expectedRecordVersion = value.expected_record_version;
    const expectedWorkflowState = value.expected_workflow_state;

    if (value.expected_draft_revision === null) {
      if (draft.draft_revision !== 1) return { status: "concurrency_conflict" };
      if (hasExpectedCaseContext) {
        const rows = await sql<Row[]>`insert into public.capa_action_plan_workspace_drafts (organization_id, capa_case_id, case_version_id, record_version, draft_revision, schema_version, trust, workflow_state, action_plan, updated_by_user_id, updated_at) select ${draft.organization_id}, ${draft.capa_case_id}, ${draft.case_version_id}, ${draft.record_version}, ${draft.draft_revision}, ${draft.schema_version}, ${draft.trust}, ${draft.workflow_state}, ${sql.json(json(draft.action_plan))}, ${draft.updated_by_user_id}, ${draft.updated_at} where exists (
          select 1 from public.capa_cases as capa_case
          where capa_case.organization_id = ${draft.organization_id}
            and capa_case.capa_case_id = ${draft.capa_case_id}
            and capa_case.current_version_id = ${expectedCaseVersionId!}
            and capa_case.record_version = ${expectedRecordVersion!}
            and capa_case.status = ${expectedWorkflowState!}
            and exists (
              select 1 from public.capa_case_versions as case_version
              where case_version.organization_id = capa_case.organization_id
                and case_version.capa_case_id = capa_case.capa_case_id
                and case_version.case_version_id = capa_case.current_version_id
                and case_version.version_number = capa_case.record_version
                and case_version.status = capa_case.status
                and case_version.case_version_id = ${expectedCaseVersionId!}
                and case_version.version_number = ${expectedRecordVersion!}
                and case_version.status = ${expectedWorkflowState!}
            )
        ) on conflict (organization_id, capa_case_id) do nothing returning *`;
        if (rows.length === 0) return { status: await caseContextMatches(sql, draft, value) ? "concurrency_conflict" : "case_changed" };
        if (rows.length !== 1) fail();
        return { status: "saved", draft: fromRow(rows[0]) };
      }
      const rows = await sql<Row[]>`insert into public.capa_action_plan_workspace_drafts (organization_id, capa_case_id, case_version_id, record_version, draft_revision, schema_version, trust, workflow_state, action_plan, updated_by_user_id, updated_at) values (${draft.organization_id}, ${draft.capa_case_id}, ${draft.case_version_id}, ${draft.record_version}, ${draft.draft_revision}, ${draft.schema_version}, ${draft.trust}, ${draft.workflow_state}, ${sql.json(json(draft.action_plan))}, ${draft.updated_by_user_id}, ${draft.updated_at}) on conflict (organization_id, capa_case_id) do nothing returning *`;
      if (rows.length === 0) return { status: "concurrency_conflict" };
      if (rows.length !== 1) fail();
      return { status: "saved", draft: fromRow(rows[0]) };
    }

    if (draft.draft_revision !== value.expected_draft_revision + 1) return { status: "concurrency_conflict" };
    if (hasExpectedCaseContext) {
      const rows = await sql<Row[]>`update public.capa_action_plan_workspace_drafts set case_version_id = ${draft.case_version_id}, record_version = ${draft.record_version}, draft_revision = ${draft.draft_revision}, schema_version = ${draft.schema_version}, trust = ${draft.trust}, workflow_state = ${draft.workflow_state}, action_plan = ${sql.json(json(draft.action_plan))}, updated_by_user_id = ${draft.updated_by_user_id}, updated_at = ${draft.updated_at} where organization_id = ${draft.organization_id} and capa_case_id = ${draft.capa_case_id} and draft_revision = ${value.expected_draft_revision} and exists (
        select 1 from public.capa_cases as capa_case
        where capa_case.organization_id = ${draft.organization_id}
          and capa_case.capa_case_id = ${draft.capa_case_id}
          and capa_case.current_version_id = ${expectedCaseVersionId!}
          and capa_case.record_version = ${expectedRecordVersion!}
          and capa_case.status = ${expectedWorkflowState!}
          and exists (
            select 1 from public.capa_case_versions as case_version
            where case_version.organization_id = capa_case.organization_id
              and case_version.capa_case_id = capa_case.capa_case_id
              and case_version.case_version_id = capa_case.current_version_id
              and case_version.version_number = capa_case.record_version
              and case_version.status = capa_case.status
              and case_version.case_version_id = ${expectedCaseVersionId!}
              and case_version.version_number = ${expectedRecordVersion!}
              and case_version.status = ${expectedWorkflowState!}
          )
      ) returning *`;
      if (rows.length === 0) return { status: await caseContextMatches(sql, draft, value) ? "concurrency_conflict" : "case_changed" };
      if (rows.length !== 1) fail();
      return { status: "saved", draft: fromRow(rows[0]) };
    }
    const rows = await sql<Row[]>`update public.capa_action_plan_workspace_drafts set case_version_id = ${draft.case_version_id}, record_version = ${draft.record_version}, draft_revision = ${draft.draft_revision}, schema_version = ${draft.schema_version}, trust = ${draft.trust}, workflow_state = ${draft.workflow_state}, action_plan = ${sql.json(json(draft.action_plan))}, updated_by_user_id = ${draft.updated_by_user_id}, updated_at = ${draft.updated_at} where organization_id = ${draft.organization_id} and capa_case_id = ${draft.capa_case_id} and draft_revision = ${value.expected_draft_revision} returning *`;
    if (rows.length === 0) return { status: "concurrency_conflict" };
    if (rows.length !== 1) fail();
    return { status: "saved", draft: fromRow(rows[0]) };
  }
}
