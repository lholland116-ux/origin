import type postgres from "postgres";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  OrganizationId,
} from "../../capa/domain/capa-types";
import {
  CapaImplementationReviewDecisionRepositoryError,
  normalizeCapaImplementationReviewDecision,
  type CapaImplementationReviewDecisionRecord,
  type CapaImplementationReviewDecisionRepository,
  type CapaImplementationReviewDecisionTransactionReadRepository,
  type SaveCapaImplementationReviewDecisionResult,
} from "../repositories/capa-implementation-review-decision-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;

export class SupabaseCapaImplementationReviewDecisionRepositoryError
  extends CapaImplementationReviewDecisionRepositoryError {
  constructor(
    message =
      "The Supabase CAPA implementation-review decision repository operation failed.",
  ) {
    super(message);
    this.name =
      "SupabaseCapaImplementationReviewDecisionRepositoryError";
  }
}

function fail(message?: string): never {
  throw new SupabaseCapaImplementationReviewDecisionRepositoryError(
    message,
  );
}

function fromRow(
  row: Row,
): CapaImplementationReviewDecisionRecord {
  try {
    return normalizeCapaImplementationReviewDecision({
      organization_id: row.organization_id as OrganizationId,
      capa_case_id: row.capa_case_id as CapaCaseId,
      source_case_version_id:
        row.source_case_version_id as CapaCaseVersionId,
      implementation_review_baseline_section_version_id:
        row.implementation_review_baseline_section_version_id as
          CapaSectionVersionId,
      schema_version:
        row.schema_version as
          CapaImplementationReviewDecisionRecord["schema_version"],
      decision:
        row.decision as
          CapaImplementationReviewDecisionRecord["decision"],
      rationale: row.rationale as string,
      reviewer_user_id:
        row.reviewer_user_id as
          CapaImplementationReviewDecisionRecord["reviewer_user_id"],
      decided_at: (row.decided_at instanceof Date
        ? row.decided_at.toISOString()
        : row.decided_at) as
        CapaImplementationReviewDecisionRecord["decided_at"],
      resulting_case_version_id:
        row.resulting_case_version_id as CapaCaseVersionId,
      transition_audit_event_id:
        row.transition_audit_event_id as
          CapaImplementationReviewDecisionRecord["transition_audit_event_id"],
    });
  } catch {
    return fail("The persisted S90 implementation-review decision row is invalid.");
  }
}

function requireRows(
  rows: readonly Row[],
): CapaImplementationReviewDecisionRecord {
  if (rows.length !== 1 || rows[0] === undefined) return fail();
  return fromRow(rows[0]);
}

export class SupabaseCapaImplementationReviewDecisionRepository
  implements
    CapaImplementationReviewDecisionRepository,
    CapaImplementationReviewDecisionTransactionReadRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async saveDecision(
    transaction: TransactionContext,
    value: CapaImplementationReviewDecisionRecord,
  ): Promise<SaveCapaImplementationReviewDecisionResult> {
    let sql: postgres.TransactionSql;
    let decision: CapaImplementationReviewDecisionRecord;

    try {
      sql = requireSupabaseTransaction(transaction);
      decision = normalizeCapaImplementationReviewDecision(value);
    } catch (error) {
      if (error instanceof SupabaseCapaImplementationReviewDecisionRepositoryError) {
        throw error;
      }
      return fail();
    }

    let rows: Row[];
    try {
      rows = await sql<Row[]>`
        insert into public.capa_implementation_review_decisions (
          organization_id,
          capa_case_id,
          source_case_version_id,
          implementation_review_baseline_section_version_id,
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
          ${decision!.implementation_review_baseline_section_version_id},
          ${decision!.schema_version},
          ${decision!.decision},
          ${decision!.rationale},
          ${decision!.reviewer_user_id},
          ${decision!.decided_at},
          ${decision!.resulting_case_version_id},
          ${decision!.transition_audit_event_id}
        )
        on conflict (
          organization_id,
          capa_case_id,
          source_case_version_id
        ) do nothing
        returning *
      `;
    } catch {
      return fail();
    }

    if (rows.length > 1) return fail();
    if (rows.length === 1) {
      return {
        status: "saved",
        decision: requireRows(rows),
      };
    }

    let existing: CapaImplementationReviewDecisionRecord | null;
    try {
      existing = await this.findDecisionInTransactionSql(
        sql!,
        decision!.organization_id,
        decision!.capa_case_id,
        decision!.source_case_version_id,
      );
    } catch (error) {
      if (error instanceof SupabaseCapaImplementationReviewDecisionRepositoryError) {
        throw error;
      }
      return fail();
    }

    if (existing === null) {
      return fail(
        "The committed CAPA implementation-review decision conflict could not be resolved.",
      );
    }

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
  ): Promise<CapaImplementationReviewDecisionRecord | null> {
    let rows: Row[];
    try {
      rows = await this.sql<Row[]>`
        select *
        from public.capa_implementation_review_decisions
        where organization_id = ${organizationId}
          and capa_case_id = ${capaCaseId}
          and source_case_version_id = ${sourceCaseVersionId}
        limit 2
      `;
    } catch {
      return fail();
    }

    if (rows.length > 1) return fail();
    return rows[0] === undefined ? null : fromRow(rows[0]);
  }

  async findDecisionInTransaction(
    transaction: TransactionContext,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaImplementationReviewDecisionRecord | null> {
    let sql: postgres.TransactionSql;
    try {
      sql = requireSupabaseTransaction(transaction);
    } catch {
      return fail();
    }

    try {
      return await this.findDecisionInTransactionSql(
        sql,
        organizationId,
        capaCaseId,
        sourceCaseVersionId,
      );
    } catch (error) {
      if (error instanceof SupabaseCapaImplementationReviewDecisionRepositoryError) {
        throw error;
      }
      return fail();
    }
  }

  private async findDecisionInTransactionSql(
    sql: postgres.TransactionSql,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaImplementationReviewDecisionRecord | null> {
    const rows = await sql<Row[]>`
      select *
      from public.capa_implementation_review_decisions
      where organization_id = ${organizationId}
        and capa_case_id = ${capaCaseId}
        and source_case_version_id = ${sourceCaseVersionId}
      limit 2
    `;
    if (rows.length > 1) return fail();
    return rows[0] === undefined ? null : fromRow(rows[0]);
  }
}
