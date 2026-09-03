import { isDeepStrictEqual } from "node:util";

import type postgres from "postgres";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationPlanAdvisoryResponse,
} from "../../capa/ai/capa-investigation-planning-advisory-contract";

import {
  CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION,
  type CapaInvestigationPlanningAdoptionId,
  type CapaInvestigationPlanningAdoptionRecord,
} from "../../capa/ai/capa-investigation-planning-adoption-contract";
import type { IsoDateTime } from "../../capa/domain/capa-types";

import {
  constructCapaInvestigationPlanningAdoption,
} from "../../capa/ai/capa-investigation-planning-adoption-validator";

import type {
  AppendCapaInvestigationPlanningAdoptionResult,
  CapaInvestigationPlanningAdoptionPersistenceInput,
  CapaInvestigationPlanningAdoptionRepository,
  PersistedCapaInvestigationPlanningAdoption,
} from "../repositories/capa-investigation-planning-adoption-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;
type QuerySql = postgres.Sql | postgres.TransactionSql;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class SupabaseCapaInvestigationPlanningAdoptionRepositoryError extends Error {
  constructor(
    message =
      "The governed CAPA investigation-planning adoption repository operation failed.",
  ) {
    super(message);
    this.name = "SupabaseCapaInvestigationPlanningAdoptionRepositoryError";
  }
}

function fail(): never {
  throw new SupabaseCapaInvestigationPlanningAdoptionRepositoryError();
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function iso(value: unknown): IsoDateTime {
  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) fail();
  return date.toISOString() as IsoDateTime;
}

function positiveVersion(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9][0-9]*$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail();
  return parsed;
}

function databaseJson(value: unknown): postgres.JSONValue {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail();
  }
  if (serialized === undefined) fail();
  return JSON.parse(serialized) as postgres.JSONValue;
}

function hasProposalKey(
  proposal: unknown,
  proposalKey: string,
): boolean {
  if (!isObject(proposal)) return false;
  return [
    proposal.investigation_questions,
    proposal.evidence_requests,
    proposal.method_suggestions,
    proposal.dependencies,
    proposal.proposed_owner_role,
    proposal.gaps,
  ].some((items) =>
    Array.isArray(items) && items.some((item) =>
      isObject(item) && item.proposal_key === proposalKey,
    ),
  );
}

function validateInput(
  transaction: TransactionContext,
  input: CapaInvestigationPlanningAdoptionPersistenceInput,
): void {
  const adoption = input.adoption;
  if (
    !isSha256(input.request_fingerprint) ||
    !isSha256(input.record_fingerprint) ||
    !isUuid(input.audit_event_id)
  ) {
    fail();
  }

  try {
    const canonical = constructCapaInvestigationPlanningAdoption({
      adoption_id: adoption.adoption_id,
      organization_id: adoption.organization_id,
      capa_case_id: adoption.capa_case_id,
      case_version_id: adoption.case_version_id,
      record_version: adoption.record_version,
      output_id: adoption.output_id,
      adopted_item: adoption.adopted_item,
      adopted_at: adoption.adopted_at,
      adopted_by: adoption.adopted_by,
      request_id: adoption.request_id,
      correlation_id: adoption.correlation_id,
      idempotency_key: adoption.idempotency_key,
      adoption_policy_version: adoption.adoption_policy_version,
    });
    if (!isDeepStrictEqual(canonical, adoption)) fail();
  } catch {
    fail();
  }
}

function adoptionFromRow(
  row: Row,
): PersistedCapaInvestigationPlanningAdoption {
  const adoptionRecord = row.adoption_record;
  if (!isObject(adoptionRecord)) fail();

  let adoption: CapaInvestigationPlanningAdoptionRecord;
  try {
    adoption = constructCapaInvestigationPlanningAdoption({
      adoption_id: row.adoption_id as CapaInvestigationPlanningAdoptionId,
      organization_id: row.organization_id as never,
      capa_case_id: row.capa_case_id as never,
      case_version_id: row.case_version_id as never,
      record_version: positiveVersion(row.record_version),
      output_id: row.output_id as CapaInvestigationPlanAdvisoryResponse["output_id"],
      adopted_item: row.adopted_item as never,
      adopted_at: iso(row.adopted_at),
      adopted_by: {
        actor_type: row.adopted_by_actor_type as "human",
        actor_id: row.adopted_by_actor_id as string,
      },
      request_id: row.request_id as never,
      correlation_id: row.correlation_id as never,
      idempotency_key: row.idempotency_key as never,
      adoption_policy_version: row.adoption_policy_version as never,
    });
  } catch {
    fail();
  }

  if (
    !isDeepStrictEqual(adoptionRecord, adoption) ||
    row.record_fingerprint_algorithm !== "sha256" ||
    adoption.proposal_key !== row.proposal_key ||
    !isSha256(row.request_fingerprint) ||
    !isSha256(row.record_fingerprint) ||
    !isUuid(row.audit_event_id)
  ) {
    fail();
  }

  return Object.freeze({
    adoption,
    request_fingerprint: row.request_fingerprint as never,
    record_fingerprint: row.record_fingerprint as never,
    audit_event_id: row.audit_event_id as never,
  });
}

async function existingRecord(
  sql: QuerySql,
  input: CapaInvestigationPlanningAdoptionPersistenceInput,
): Promise<PersistedCapaInvestigationPlanningAdoption | null> {
  const rows = await sql<Row[]>`
    select *
    from public.capa_investigation_planning_ai_adoptions
    where organization_id = ${input.adoption.organization_id}
      and (
        (idempotency_key = ${input.adoption.idempotency_key}
          and proposal_key = ${input.adoption.proposal_key})
        or adoption_id = ${input.adoption.adoption_id}
        or audit_event_id = ${input.audit_event_id}
      )
    order by case
      when idempotency_key = ${input.adoption.idempotency_key}
        and proposal_key = ${input.adoption.proposal_key} then 0
      when adoption_id = ${input.adoption.adoption_id} then 1
      else 2
    end, adoption_id
    limit 1
  `;
  return rows[0] === undefined ? null : adoptionFromRow(rows[0]);
}

function conflictForExisting(
  existing: PersistedCapaInvestigationPlanningAdoption,
  input: CapaInvestigationPlanningAdoptionPersistenceInput,
): AppendCapaInvestigationPlanningAdoptionResult {
  const adoption = input.adoption;
  if (
    existing.adoption.idempotency_key === adoption.idempotency_key &&
    existing.adoption.proposal_key === adoption.proposal_key
  ) {
    if (existing.request_fingerprint === input.request_fingerprint) {
      return { status: "already_recorded", record: existing };
    }
    return {
      status: "conflict",
      reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      record: existing,
    };
  }
  if (existing.adoption.adoption_id === adoption.adoption_id) {
    return {
      status: "conflict",
      reason_code: "ADOPTION_ID_REUSED_WITH_DIFFERENT_CONTENT",
      record: existing,
    };
  }
  return {
    status: "conflict",
    reason_code: "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_ADOPTION",
    record: existing,
  };
}

export class SupabaseCapaInvestigationPlanningAdoptionRepository
  implements CapaInvestigationPlanningAdoptionRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async appendAdoption(
    transaction: TransactionContext,
    input: CapaInvestigationPlanningAdoptionPersistenceInput,
  ): Promise<AppendCapaInvestigationPlanningAdoptionResult> {
    let sql: postgres.TransactionSql;
    try {
      sql = requireSupabaseTransaction(transaction);
      validateInput(transaction, input);
    } catch {
      throw new SupabaseCapaInvestigationPlanningAdoptionRepositoryError();
    }

    const prior = await existingRecord(sql, input);
    if (prior !== null) return conflictForExisting(prior, input);

    if (
      transaction.request_trace.request_id !== input.adoption.request_id ||
      transaction.request_trace.correlation_id !== input.adoption.correlation_id
    ) {
      throw new SupabaseCapaInvestigationPlanningAdoptionRepositoryError();
    }

    const outputRows = await sql<Row[]>`
      select
        output_id, capa_case_id, case_version_id, record_version, status,
        agent_id, agent_version, output_schema_version, proposal,
        advisory_only, workflow_mutated, human_acceptance_required
      from public.capa_ai_outputs
      where organization_id = ${input.adoption.organization_id}
        and output_id = ${input.adoption.output_id}
      limit 2
    `;
    if (outputRows.length > 1) throw new SupabaseCapaInvestigationPlanningAdoptionRepositoryError();
    const output = outputRows[0];
    if (output === undefined) return { status: "output_not_found_or_not_authorized" };
    if (
      output.output_id !== input.adoption.output_id ||
      output.capa_case_id !== input.adoption.capa_case_id ||
      output.case_version_id !== input.adoption.case_version_id ||
      Number(output.record_version) !== input.adoption.record_version
    ) {
      return { status: "output_not_adoptable" };
    }
    if (
      output.status !== "completed_draft" ||
      output.agent_id !== "AG-PLAN" ||
      output.agent_version !== "ag-plan-1.0.0" ||
      output.output_schema_version !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
      output.advisory_only !== true ||
      output.workflow_mutated !== false ||
      output.human_acceptance_required !== true ||
      !hasProposalKey(output.proposal, input.adoption.proposal_key)
    ) {
      return { status: "output_not_adoptable" };
    }

    const caseRows = await sql<Row[]>`
      select current_version_id, record_version, status
      from public.capa_cases
      where organization_id = ${input.adoption.organization_id}
        and capa_case_id = ${input.adoption.capa_case_id}
      for update
    `;
    if (caseRows.length > 1) fail();
    const currentCase = caseRows[0];
    if (
      currentCase === undefined ||
      currentCase.current_version_id !== input.adoption.case_version_id ||
      Number(currentCase.record_version) !== input.adoption.record_version ||
      currentCase.status !== "S30"
    ) {
      return { status: "case_changed" };
    }

    const inserted = await sql<Row[]>`
      insert into public.capa_investigation_planning_ai_adoptions (
        organization_id, adoption_id, output_id, capa_case_id,
        case_version_id, record_version, output_status, proposal_key,
        adopted_item, adopted_at, adopted_by_actor_type, adopted_by_actor_id,
        adoption_policy_version, request_id, correlation_id, idempotency_key,
        request_fingerprint, audit_event_id, adoption_record,
        record_fingerprint_algorithm, record_fingerprint, workflow_mutated,
        controlled_record_mutated, gate_approved, created_at
      ) values (
        ${input.adoption.organization_id}, ${input.adoption.adoption_id},
        ${input.adoption.output_id}, ${input.adoption.capa_case_id},
        ${input.adoption.case_version_id}, ${input.adoption.record_version},
        'completed_draft', ${input.adoption.proposal_key},
        ${sql.json(databaseJson(input.adoption.adopted_item))},
        ${input.adoption.adopted_at}, ${input.adoption.adopted_by.actor_type},
        ${input.adoption.adopted_by.actor_id},
        ${input.adoption.adoption_policy_version ?? CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION},
        ${input.adoption.request_id}, ${input.adoption.correlation_id},
        ${input.adoption.idempotency_key}, ${input.request_fingerprint},
        ${input.audit_event_id}, ${sql.json(databaseJson(input.adoption))},
        'sha256', ${input.record_fingerprint},
        ${input.adoption.workflow_mutated},
        ${input.adoption.controlled_record_mutated},
        ${input.adoption.gate_approved}, ${input.adoption.adopted_at}
      )
      on conflict do nothing
      returning *
    `;
    if (inserted.length === 1) {
      return { status: "saved", record: adoptionFromRow(inserted[0]) };
    }
    if (inserted.length !== 0) fail();

    const concurrent = await existingRecord(sql, input);
    if (concurrent !== null) return conflictForExisting(concurrent, input);
    fail();
  }

  async findAdoptionById(
    organizationId: string,
    adoptionId: CapaInvestigationPlanningAdoptionId,
  ): Promise<PersistedCapaInvestigationPlanningAdoption | null> {
    const rows = await this.sql<Row[]>`
      select *
      from public.capa_investigation_planning_ai_adoptions
      where organization_id = ${organizationId}
        and adoption_id = ${adoptionId}
      limit 2
    `;
    if (rows.length > 1) fail();
    return rows[0] === undefined ? null : adoptionFromRow(rows[0]);
  }

  async listAdoptionsForOutput(
    organizationId: string,
    outputId: string,
  ): Promise<readonly PersistedCapaInvestigationPlanningAdoption[]> {
    const rows = await this.sql<Row[]>`
      select *
      from public.capa_investigation_planning_ai_adoptions
      where organization_id = ${organizationId}
        and output_id = ${outputId}
      order by adopted_at asc, adoption_id asc
    `;
    return Object.freeze(rows.map(adoptionFromRow));
  }
}

export function createSupabaseCapaInvestigationPlanningAdoptionRepository(
  sql: postgres.Sql,
): SupabaseCapaInvestigationPlanningAdoptionRepository {
  return new SupabaseCapaInvestigationPlanningAdoptionRepository(sql);
}
