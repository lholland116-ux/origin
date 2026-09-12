import postgres from "postgres";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  OrganizationId,
} from "../../capa/domain/capa-types";
import {
  CAPA_ACTION_PLAN_SCHEMA_VERSION,
  CAPA_ACTION_PLAN_SECTION_TYPE,
  validateCapaActionPlan,
} from "../../capa/domain/capa-action-plan";
import {
  validateCapaImplementationDraftAgainstApprovedActionSet,
} from "../../capa/implementation/capa-implementation-validator";
import type {
  CapaImplementationApprovedS70BaselineReference,
} from "../../capa/implementation/capa-implementation-contract";
import {
  CapaImplementationWorkspaceRepositoryError,
  normalizeCapaImplementationWorkspaceRecord,
  normalizeCapaImplementationWorkspaceSaveInput,
  sameCapaImplementationBaseline,
  type CapaImplementationWorkspaceRecord,
  type CapaImplementationWorkspaceRepository,
  type SaveCapaImplementationWorkspaceInput,
  type SaveCapaImplementationWorkspaceResult,
} from "../repositories/capa-implementation-workspace-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;

export class SupabaseCapaImplementationWorkspaceRepositoryError
  extends CapaImplementationWorkspaceRepositoryError {
  constructor(
    message =
      "The Supabase S80 implementation workspace repository operation failed.",
  ) {
    super(message);
    this.name = "SupabaseCapaImplementationWorkspaceRepositoryError";
  }
}

function fail(message?: string): never {
  throw new SupabaseCapaImplementationWorkspaceRepositoryError(message);
}

function json(value: unknown): postgres.JSONValue {
  try {
    return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
  } catch {
    return fail("The S80 implementation workspace JSON content is invalid.");
  }
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function fromRow(row: Row): CapaImplementationWorkspaceRecord {
  try {
    return normalizeCapaImplementationWorkspaceRecord({
      organization_id: row.organization_id,
      capa_case_id: row.capa_case_id,
      case_version_id: row.case_version_id,
      record_version: typeof row.record_version === "number"
        ? row.record_version
        : Number(row.record_version),
      workflow_state: row.workflow_state,
      approved_s70_baseline: {
        source_case_version_id: row.source_case_version_id,
        approved_action_plan_section_id: row.approved_action_plan_section_id,
        approval_decision_reference: row.approval_decision_reference,
      },
      draft_revision: typeof row.draft_revision === "number"
        ? row.draft_revision
        : Number(row.draft_revision),
      draft: row.workspace_draft,
      created_by_user_id: row.created_by_user_id,
      created_at: timestamp(row.created_at),
      updated_by_user_id: row.updated_by_user_id,
      updated_at: timestamp(row.updated_at),
    });
  } catch {
    return fail("The persisted S80 implementation workspace row is invalid.");
  }
}

function input(
  value: SaveCapaImplementationWorkspaceInput,
  requireBaseline: boolean,
): SaveCapaImplementationWorkspaceInput {
  try {
    return normalizeCapaImplementationWorkspaceSaveInput(value, requireBaseline);
  } catch {
    return fail("The S80 implementation workspace save input is invalid.");
  }
}

async function findInTransaction(
  sql: postgres.TransactionSql,
  organizationId: OrganizationId,
  capaCaseId: CapaCaseId,
  forUpdate: boolean,
): Promise<CapaImplementationWorkspaceRecord | null> {
  const rows = forUpdate
    ? await sql<Row[]>`select * from public.capa_implementation_workspace_drafts
        where organization_id = ${organizationId}
          and capa_case_id = ${capaCaseId}
        limit 2
        for update`
    : await sql<Row[]>`select * from public.capa_implementation_workspace_drafts
        where organization_id = ${organizationId}
          and capa_case_id = ${capaCaseId}
        limit 2`;
  if (rows.length > 1) return fail("The S80 implementation workspace identity is not unique.");
  return rows[0] === undefined ? null : fromRow(rows[0]);
}

async function currentS80ContextMatches(
  sql: postgres.TransactionSql,
  value: SaveCapaImplementationWorkspaceInput,
): Promise<boolean> {
  const rows = await sql<readonly { readonly current_version_id: string }[]>`
    select capa_case.current_version_id
    from public.capa_cases as capa_case
    join public.capa_case_versions as current_version
      on current_version.organization_id = capa_case.organization_id
     and current_version.capa_case_id = capa_case.capa_case_id
     and current_version.case_version_id = capa_case.current_version_id
     and current_version.version_number = capa_case.record_version
     and current_version.status = 'S80'
    where capa_case.organization_id = ${value.organization_id}
      and capa_case.capa_case_id = ${value.capa_case_id}
      and capa_case.current_version_id = ${value.case_version_id}
      and capa_case.record_version = ${value.record_version}
      and capa_case.status = 'S80'
    limit 2`;
  if (rows.length > 1) return fail("The S80 implementation case identity is not unique.");
  return rows.length === 1;
}

async function authoritativeActionReferences(
  sql: postgres.TransactionSql,
  organizationId: OrganizationId,
  capaCaseId: CapaCaseId,
  baseline: CapaImplementationApprovedS70BaselineReference,
  resultingCaseVersionId: CapaCaseVersionId,
): Promise<readonly string[] | null> {
  const rows = await sql<readonly { readonly content: unknown }[]>`
    select action_section.content
    from public.capa_section_versions as action_section
    where action_section.organization_id = ${organizationId}
      and action_section.capa_case_id = ${capaCaseId}
      and action_section.section_version_id = ${baseline.approved_action_plan_section_id}
      and action_section.section_type = ${CAPA_ACTION_PLAN_SECTION_TYPE}
      and action_section.schema_version = ${CAPA_ACTION_PLAN_SCHEMA_VERSION}
      and exists (
        select 1
        from public.capa_case_versions as source_version
        join public.capa_case_version_sections as source_section
          on source_section.organization_id = source_version.organization_id
         and source_section.capa_case_id = source_version.capa_case_id
         and source_section.case_version_id = source_version.case_version_id
         and source_section.section_version_id = ${baseline.approved_action_plan_section_id}
        where source_version.organization_id = ${organizationId}
          and source_version.capa_case_id = ${capaCaseId}
          and source_version.case_version_id = ${baseline.source_case_version_id}
          and source_version.status = 'S70'
      )
      and exists (
        select 1
        from public.capa_action_plan_review_decisions as decision
        where decision.organization_id = ${organizationId}
          and decision.capa_case_id = ${capaCaseId}
          and decision.source_case_version_id = ${baseline.source_case_version_id}
          and decision.action_plan_section_version_id = ${baseline.approved_action_plan_section_id}
          and decision.transition_audit_event_id = ${baseline.approval_decision_reference}
          and decision.decision = 'approve'
      )
    limit 2`;
  if (rows.length > 1) return fail("The S70 action-plan baseline is not unique.");
  if (rows.length === 0 || rows[0] === undefined) return null;
  const actionPlan = validateCapaActionPlan(rows[0].content);
  if (actionPlan.status !== "valid") {
    return fail("The approved S70 action-plan baseline is invalid.");
  }
  return actionPlan.value.items.map((item) => item.item_id);
}

function validateContextualDraft(
  draft: SaveCapaImplementationWorkspaceInput["draft"],
  actionReferences: readonly string[],
): void {
  const validated = validateCapaImplementationDraftAgainstApprovedActionSet(
    draft,
    actionReferences,
  );
  if (validated.status !== "valid") {
    return fail("The S80 implementation workspace references a non-authoritative S70 action.");
  }
}

export class SupabaseCapaImplementationWorkspaceRepository
  implements CapaImplementationWorkspaceRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async findWorkspace(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaImplementationWorkspaceRecord | null> {
    return findInTransaction(
      this.sql as unknown as postgres.TransactionSql,
      organizationId,
      capaCaseId,
      false,
    );
  }

  async findWorkspaceForUpdate(
    transaction: TransactionContext,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaImplementationWorkspaceRecord | null> {
    let sql: postgres.TransactionSql;
    try {
      sql = requireSupabaseTransaction(transaction);
    } catch {
      return fail();
    }
    return findInTransaction(sql, organizationId, capaCaseId, true);
  }

  async initializeWorkspace(
    transaction: TransactionContext,
    value: SaveCapaImplementationWorkspaceInput,
  ): Promise<SaveCapaImplementationWorkspaceResult> {
    if (value.expected_draft_revision !== null) {
      return fail("S80 workspace initialization requires a null expected revision.");
    }
    return this.saveWorkspace(transaction, value);
  }

  async saveWorkspace(
    transaction: TransactionContext,
    value: SaveCapaImplementationWorkspaceInput,
  ): Promise<SaveCapaImplementationWorkspaceResult> {
    let sql: postgres.TransactionSql;
    try {
      sql = requireSupabaseTransaction(transaction);
    } catch {
      return fail();
    }
    const normalized = input(
      value,
      value.expected_draft_revision === null,
    );

    if (normalized.expected_draft_revision === null) {
      const baseline = normalized.approved_s70_baseline;
      if (baseline === undefined) return fail("S80 initialization requires a baseline.");
      const actionReferences = await authoritativeActionReferences(
        sql,
        normalized.organization_id,
        normalized.capa_case_id,
        baseline,
        normalized.case_version_id,
      );
      if (actionReferences === null) return { status: "baseline_conflict" };
      validateContextualDraft(normalized.draft, actionReferences);
      const rows = await sql<Row[]>`
        insert into public.capa_implementation_workspace_drafts (
          organization_id,
          capa_case_id,
          case_version_id,
          record_version,
          source_case_version_id,
          approved_action_plan_section_id,
          approval_decision_reference,
          draft_revision,
          schema_version,
          workspace_draft,
          created_by_user_id,
          updated_by_user_id
        )
        select
          ${normalized.organization_id},
          ${normalized.capa_case_id},
          ${normalized.case_version_id},
          ${normalized.record_version},
          ${baseline.source_case_version_id},
          ${baseline.approved_action_plan_section_id},
          ${baseline.approval_decision_reference},
          ${normalized.draft_revision},
          ${normalized.draft.schema_version},
          ${sql.json(json(normalized.draft))},
          ${normalized.actor_user_id},
          ${normalized.actor_user_id}
        where exists (
          select 1
          from public.capa_cases as capa_case
          join public.capa_case_versions as current_version
            on current_version.organization_id = capa_case.organization_id
           and current_version.capa_case_id = capa_case.capa_case_id
           and current_version.case_version_id = capa_case.current_version_id
           and current_version.version_number = capa_case.record_version
           and current_version.status = 'S80'
          where capa_case.organization_id = ${normalized.organization_id}
            and capa_case.capa_case_id = ${normalized.capa_case_id}
            and capa_case.current_version_id = ${normalized.case_version_id}
            and capa_case.record_version = ${normalized.record_version}
            and capa_case.status = 'S80'
        )
        on conflict (organization_id, capa_case_id)
        do nothing
        returning *`;
      if (rows.length === 1 && rows[0] !== undefined) {
        return { status: "saved", workspace: fromRow(rows[0]) };
      }
      if (rows.length > 1) return fail("The S80 implementation workspace identity is not unique.");
      const existing = await findInTransaction(
        sql,
        normalized.organization_id,
        normalized.capa_case_id,
        false,
      );
      if (existing !== null) {
        if (existing.case_version_id === normalized.case_version_id) {
          return { status: "concurrency_conflict" };
        }
        const rollover = await sql<Row[]>`
          update public.capa_implementation_workspace_drafts
          set case_version_id = ${normalized.case_version_id},
              record_version = ${normalized.record_version},
              source_case_version_id = ${baseline.source_case_version_id},
              approved_action_plan_section_id = ${baseline.approved_action_plan_section_id},
              approval_decision_reference = ${baseline.approval_decision_reference},
              draft_revision = ${normalized.draft_revision},
              schema_version = ${normalized.draft.schema_version},
              workspace_draft = ${sql.json(json(normalized.draft))},
              updated_by_user_id = ${normalized.actor_user_id},
              updated_at = statement_timestamp()
          where organization_id = ${normalized.organization_id}
            and capa_case_id = ${normalized.capa_case_id}
            and case_version_id = ${existing.case_version_id}
            and exists (
              select 1
              from public.capa_cases as capa_case
              join public.capa_case_versions as current_version
                on current_version.organization_id = capa_case.organization_id
               and current_version.capa_case_id = capa_case.capa_case_id
               and current_version.case_version_id = capa_case.current_version_id
               and current_version.version_number = capa_case.record_version
               and current_version.status = 'S80'
              where capa_case.organization_id = ${normalized.organization_id}
                and capa_case.capa_case_id = ${normalized.capa_case_id}
                and capa_case.status = 'S80'
                and capa_case.current_version_id = ${normalized.case_version_id}
                and capa_case.record_version = ${normalized.record_version}
            )
          returning *`;
        if (rollover.length === 1 && rollover[0] !== undefined) {
          return { status: "saved", workspace: fromRow(rollover[0]) };
        }
        return { status: "concurrency_conflict" };
      }
      return (await currentS80ContextMatches(sql, normalized))
        ? { status: "concurrency_conflict" }
        : { status: "case_changed" };
    }

    if (
      normalized.draft_revision !== normalized.expected_draft_revision + 1
    ) {
      return { status: "concurrency_conflict" };
    }
    const existing = await findInTransaction(
      sql,
      normalized.organization_id,
      normalized.capa_case_id,
      true,
    );
    if (existing === null) return { status: "concurrency_conflict" };
    if (
      normalized.approved_s70_baseline !== undefined &&
      !sameCapaImplementationBaseline(
        normalized.approved_s70_baseline,
        existing.approved_s70_baseline,
      )
    ) {
      return { status: "baseline_conflict" };
    }
    if (
      existing.draft_revision !== normalized.expected_draft_revision ||
      existing.case_version_id !== normalized.case_version_id ||
      existing.record_version !== normalized.record_version
    ) {
      return existing.case_version_id !== normalized.case_version_id ||
        existing.record_version !== normalized.record_version
        ? { status: "case_changed" }
        : { status: "concurrency_conflict" };
    }
    if (!(await currentS80ContextMatches(sql, normalized))) {
      return { status: "case_changed" };
    }
    const actionReferences = await authoritativeActionReferences(
      sql,
      existing.organization_id,
      existing.capa_case_id,
      existing.approved_s70_baseline,
      normalized.case_version_id,
    );
    if (actionReferences === null) return { status: "baseline_conflict" };
    validateContextualDraft(normalized.draft, actionReferences);
    const rows = await sql<Row[]>`
      update public.capa_implementation_workspace_drafts
      set case_version_id = ${normalized.case_version_id},
          record_version = ${normalized.record_version},
          draft_revision = ${normalized.draft_revision},
          schema_version = ${normalized.draft.schema_version},
          workspace_draft = ${sql.json(json(normalized.draft))},
          updated_by_user_id = ${normalized.actor_user_id},
          updated_at = statement_timestamp()
      where organization_id = ${normalized.organization_id}
        and capa_case_id = ${normalized.capa_case_id}
        and case_version_id = ${existing.case_version_id}
        and record_version = ${existing.record_version}
        and source_case_version_id = ${existing.approved_s70_baseline.source_case_version_id}
        and approved_action_plan_section_id = ${existing.approved_s70_baseline.approved_action_plan_section_id}
        and approval_decision_reference = ${existing.approved_s70_baseline.approval_decision_reference}
        and draft_revision = ${normalized.expected_draft_revision}
      returning *`;
    if (rows.length === 0) {
      return (await currentS80ContextMatches(sql, normalized))
        ? { status: "concurrency_conflict" }
        : { status: "case_changed" };
    }
    if (rows.length !== 1 || rows[0] === undefined) {
      return fail("The S80 implementation workspace identity is not unique.");
    }
    return { status: "saved", workspace: fromRow(rows[0]) };
  }
}
