import type postgres from "postgres";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  OrganizationId,
} from "../../capa/domain/capa-types";
import {
  CapaActionPlanReviewDecisionRepositoryError,
  normalizeCapaActionPlanReviewDecision,
  type CapaActionPlanReviewDecisionRecord,
  type CapaActionPlanReviewDecisionRepository,
  type SaveCapaActionPlanReviewDecisionResult,
} from "../repositories/capa-action-plan-review-decision-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;

export class SupabaseCapaActionPlanReviewDecisionRepositoryError
  extends CapaActionPlanReviewDecisionRepositoryError {
  constructor(message = "The Supabase CAPA action-plan review decision repository operation failed.") {
    super(message);
    this.name = "SupabaseCapaActionPlanReviewDecisionRepositoryError";
  }
}

function fail(message?: string): never {
  throw new SupabaseCapaActionPlanReviewDecisionRepositoryError(message);
}

function fromRow(row: Row): CapaActionPlanReviewDecisionRecord {
  try {
    return normalizeCapaActionPlanReviewDecision({
      organization_id: row.organization_id as OrganizationId,
      capa_case_id: row.capa_case_id as CapaCaseId,
      source_case_version_id: row.source_case_version_id as CapaCaseVersionId,
      action_plan_section_version_id: row.action_plan_section_version_id as CapaSectionVersionId,
      schema_version: row.schema_version as CapaActionPlanReviewDecisionRecord["schema_version"],
      decision: row.decision as CapaActionPlanReviewDecisionRecord["decision"],
      rationale: row.rationale as string,
      reviewer_user_id: row.reviewer_user_id as CapaActionPlanReviewDecisionRecord["reviewer_user_id"],
      decided_at: (row.decided_at instanceof Date ? row.decided_at.toISOString() : row.decided_at) as CapaActionPlanReviewDecisionRecord["decided_at"],
      resulting_case_version_id: row.resulting_case_version_id as CapaCaseVersionId,
      transition_audit_event_id: row.transition_audit_event_id as CapaActionPlanReviewDecisionRecord["transition_audit_event_id"],
    });
  } catch (error) {
    fail();
  }
}

function requireRows(
  rows: readonly Row[],
): CapaActionPlanReviewDecisionRecord {
  if (rows.length !== 1 || rows[0] === undefined) fail();
  return fromRow(rows[0]);
}

export class SupabaseCapaActionPlanReviewDecisionRepository
  implements CapaActionPlanReviewDecisionRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async saveDecision(
    transaction: TransactionContext,
    value: CapaActionPlanReviewDecisionRecord,
  ): Promise<SaveCapaActionPlanReviewDecisionResult> {
    let sql: postgres.TransactionSql;
    let decision: CapaActionPlanReviewDecisionRecord;
    try {
      sql = requireSupabaseTransaction(transaction);
      decision = normalizeCapaActionPlanReviewDecision(value);
    } catch (error) {
      if (error instanceof SupabaseCapaActionPlanReviewDecisionRepositoryError) throw error;
      fail();
    }

    const rows = await sql<Row[]>`
      insert into public.capa_action_plan_review_decisions (
        organization_id,
        capa_case_id,
        source_case_version_id,
        action_plan_section_version_id,
        schema_version,
        decision,
        rationale,
        reviewer_user_id,
        decided_at,
        resulting_case_version_id,
        transition_audit_event_id
      ) values (
        ${decision!.organization_id},
        ${decision!.capa_case_id},
        ${decision!.source_case_version_id},
        ${decision!.action_plan_section_version_id},
        ${decision!.schema_version},
        ${decision!.decision},
        ${decision!.rationale},
        ${decision!.reviewer_user_id},
        ${decision!.decided_at},
        ${decision!.resulting_case_version_id},
        ${decision!.transition_audit_event_id}
      )
      on conflict (organization_id, capa_case_id, source_case_version_id)
      do nothing
      returning *
    `;
    if (rows.length > 1) fail();
    if (rows.length === 1) {
      return { status: "saved", decision: requireRows(rows) };
    }

    const existing = await this.findDecisionInTransaction(
      sql!,
      decision!.organization_id,
      decision!.capa_case_id,
      decision!.source_case_version_id,
    );
    if (existing === null) fail("The committed CAPA action-plan review decision conflict could not be resolved.");
    return {
      status: "conflict",
      reason_code: "DECISION_ALREADY_COMMITTED",
      decision: existing,
    };
  }

  async findDecision(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaActionPlanReviewDecisionRecord | null> {
    const rows = await this.sql<Row[]>`
      select *
      from public.capa_action_plan_review_decisions
      where organization_id = ${organizationId}
        and capa_case_id = ${capaCaseId}
        and source_case_version_id = ${sourceCaseVersionId}
      limit 2
    `;
    if (rows.length > 1) fail();
    return rows[0] === undefined ? null : fromRow(rows[0]);
  }

  private async findDecisionInTransaction(
    sql: postgres.TransactionSql,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaActionPlanReviewDecisionRecord | null> {
    const rows = await sql<Row[]>`
      select *
      from public.capa_action_plan_review_decisions
      where organization_id = ${organizationId}
        and capa_case_id = ${capaCaseId}
        and source_case_version_id = ${sourceCaseVersionId}
      limit 2
    `;
    if (rows.length > 1) fail();
    return rows[0] === undefined ? null : fromRow(rows[0]);
  }
}
