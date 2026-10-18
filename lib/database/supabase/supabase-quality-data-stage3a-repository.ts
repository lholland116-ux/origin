import type postgres from "postgres";
import type { QualityDataDatasetSnapshot, QualityDataReadScope } from "../repositories/quality-data-repository";
import type {
  QualityDataApprovalSummary,
  QualityDataApprovalAppendInput,
  QualityDataApprovalAppendResult,
  QualityDataApprovedSnapshotResult,
  QualityDataStage3ARepository,
  QualityDataExternalAiOptInAppendInput,
  QualityDataExternalAiOptInAppendResult,
} from "../repositories/quality-data-stage3a-repository";
import type { QualityDataVersionApprovalState } from "../../quality-data/quality-data-approval-contract";
import type { QualityDataExternalAiOptInState } from "../../quality-data/quality-data-ai-contract";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("QUALITY_DATA_DATABASE_VALUE_INVALID");
  return value;
}

function integer(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("QUALITY_DATA_DATABASE_COUNT_INVALID");
  return parsed;
}

function approvalState(row: Row): QualityDataVersionApprovalState {
  return {
    organization_id: text(row.organization_id),
    dataset_id: text(row.dataset_id),
    dataset_version_id: text(row.dataset_version_id),
    decision: text(row.decision) as QualityDataVersionApprovalState["decision"],
    approval_event_id: text(row.approval_event_id),
    transition_number: integer(row.transition_number),
    reviewer_user_id: text(row.reviewer_user_id),
    reviewer_membership_id: text(row.reviewer_membership_id),
    occurred_at: new Date(row.occurred_at as string | Date).toISOString(),
    rationale: text(row.rationale),
  };
}

function externalAiOptInState(row: Row): QualityDataExternalAiOptInState {
  const decision = text(row.decision);
  if (decision !== "enabled" && decision !== "disabled") throw new Error("QUALITY_DATA_EXTERNAL_AI_STATE_INVALID");
  return {
    organization_id: text(row.organization_id),
    decision,
    event_id: text(row.event_id),
    transition_number: integer(row.transition_number),
    actor_user_id: text(row.actor_user_id),
    actor_membership_id: text(row.actor_membership_id),
    occurred_at: new Date(row.occurred_at as string | Date).toISOString(),
    rationale: text(row.rationale),
  };
}

function currentDecision(value: unknown): "none" | "approved" | "rejected" | "revoked" {
  if (value === null || value === undefined) return "none";
  if (value === "approved" || value === "rejected" || value === "revoked") return value;
  throw new Error("QUALITY_DATA_APPROVAL_STATE_INVALID");
}

function isTransitionAllowed(previous: "none" | "approved" | "rejected" | "revoked", next: string): boolean {
  if (previous === "approved") return next === "revoked";
  if (previous === "rejected") return next === "approved";
  if (previous === "revoked") return next === "approved" || next === "rejected";
  return next === "approved" || next === "rejected";
}

export class SupabaseQualityDataStage3ARepository implements QualityDataStage3ARepository {
  constructor(private readonly sql: postgres.Sql) {}

  async appendVersionApproval(
    transaction: TransactionContext,
    input: QualityDataApprovalAppendInput,
  ): Promise<QualityDataApprovalAppendResult> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(${input.organization_id}),
      pg_catalog.hashtext(${"quality-data:approval:" + input.request_trace.idempotency_key})
    )`;

    const authority = await sql<Row[]>`
      select membership.membership_id
      from public.capa_organization_memberships as membership
      join public.capa_organizations as organization
        on organization.organization_id = membership.organization_id
      join public.capa_role_assignments as assignment
        on assignment.organization_id = membership.organization_id
        and assignment.membership_id = membership.membership_id
        and assignment.user_id = membership.user_id
      join public.capa_roles as role on role.role_id = assignment.role_id
      where membership.organization_id = ${input.organization_id}::uuid
        and membership.membership_id = ${input.reviewer_membership_id}::uuid
        and membership.user_id = ${input.reviewer_user_id}::uuid
        and membership.status = 'active'
        and membership.effective_at <= ${input.now}::timestamptz
        and (membership.expires_at is null or membership.expires_at > ${input.now}::timestamptz)
        and organization.status = 'active'
        and organization.effective_at <= ${input.now}::timestamptz
        and (organization.superseded_at is null or organization.superseded_at > ${input.now}::timestamptz)
        and assignment.role_id = 'CAPA_ORG_ADMIN'
        and assignment.scope_code = 'ORGANIZATION'
        and assignment.scope_resource_type is null
        and assignment.scope_resource_id is null
        and assignment.status = 'active'
        and assignment.effective_at <= ${input.now}::timestamptz
        and (assignment.expires_at is null or assignment.expires_at > ${input.now}::timestamptz)
        and role.status = 'active'
        and role.human_authority
        and 'quality_data.version.approve' = any(role.permissions)
      for share of membership, organization, assignment, role
      limit 1
    `;
    if (authority.length !== 1) return { status: "unauthorized" };

    const versionRows = await sql<Row[]>`
      select version.organization_id, version.dataset_id, version.dataset_version_id
      from public.quality_data_dataset_versions as version
      join public.quality_data_datasets as dataset
        on dataset.organization_id = version.organization_id
        and dataset.dataset_id = version.dataset_id
      where version.organization_id = ${input.organization_id}::uuid
        and version.dataset_version_id = ${input.dataset_version_id}::uuid
      for update of version
    `;
    const version = versionRows[0];
    if (version === undefined) return { status: "not_found" };

    const existingRows = await sql<Row[]>`
      select * from public.quality_data_dataset_version_approval_events
      where organization_id = ${input.organization_id}::uuid
        and idempotency_key = ${input.request_trace.idempotency_key}
      limit 1
    `;
    const existing = existingRows[0];
    if (existing !== undefined) {
      if (existing.request_fingerprint !== input.request_fingerprint) {
        return { status: "conflict", reason_code: "IDEMPOTENCY_KEY_REUSED" };
      }
      return { status: "already_recorded", state: approvalState(existing) };
    }

    const previousRows = await sql<Row[]>`
      select approval_event_id, transition_number, decision
      from public.quality_data_dataset_version_approval_events
      where organization_id = ${input.organization_id}::uuid
        and dataset_id = ${String(version.dataset_id)}::uuid
        and dataset_version_id = ${String(version.dataset_version_id)}::uuid
      order by transition_number desc
      limit 1
    `;
    const previous = previousRows[0];
    const previousState = currentDecision(previous?.decision);
    const previousTransition = previous === undefined ? 0 : integer(previous.transition_number);
    if (input.command.expected_transition_number !== previousTransition) {
      return { status: "conflict", reason_code: "STALE_TRANSITION" };
    }
    if (!isTransitionAllowed(previousState, input.command.decision)) {
      return { status: "conflict", reason_code: "INVALID_TRANSITION" };
    }

    const insertedRows = await sql<Row[]>`
      insert into public.quality_data_dataset_version_approval_events (
        approval_event_id, organization_id, dataset_id, dataset_version_id,
        transition_number, decision, reviewer_user_id, reviewer_membership_id,
        occurred_at, rationale, previous_event_id, request_id, correlation_id,
        idempotency_key, request_fingerprint
      ) values (
        ${input.approval_event_id}::uuid, ${input.organization_id}::uuid,
        ${String(version.dataset_id)}::uuid, ${String(version.dataset_version_id)}::uuid,
        ${previousTransition + 1}, ${input.command.decision},
        ${input.reviewer_user_id}::uuid, ${input.reviewer_membership_id}::uuid,
        ${input.now}::timestamptz, ${input.command.rationale},
        ${previous === undefined ? null : String(previous.approval_event_id)}::uuid,
        ${input.request_trace.request_id}::uuid, ${input.request_trace.correlation_id}::uuid,
        ${input.request_trace.idempotency_key}, ${input.request_fingerprint}
      ) returning *
    `;
    const inserted = insertedRows[0];
    if (inserted === undefined) throw new Error("QUALITY_DATA_APPROVAL_INSERT_FAILED");
    return { status: "applied", state: approvalState(inserted) };
  }

  async findApprovedDatasetVersion(
    scope: QualityDataReadScope,
    datasetVersionId: string,
  ): Promise<QualityDataApprovedSnapshotResult | null> {
    return this.sql.begin(async (sql) => {
      await sql`set transaction isolation level repeatable read read only`;
      const authority = await sql<Row[]>`
        select 1
        from public.capa_organization_memberships as membership
        join public.capa_organizations as organization
          on organization.organization_id = membership.organization_id
        join public.capa_role_assignments as assignment
          on assignment.organization_id = membership.organization_id
          and assignment.membership_id = membership.membership_id
          and assignment.user_id = membership.user_id
        join public.capa_roles as role on role.role_id = assignment.role_id
        where membership.organization_id = ${scope.organization_id}::uuid
          and membership.membership_id = ${scope.membership_id}::uuid
          and membership.user_id = ${scope.user_id}::uuid
          and membership.status = 'active'
          and membership.effective_at <= ${scope.now}::timestamptz
          and (membership.expires_at is null or membership.expires_at > ${scope.now}::timestamptz)
          and organization.status = 'active'
          and organization.effective_at <= ${scope.now}::timestamptz
          and (organization.superseded_at is null or organization.superseded_at > ${scope.now}::timestamptz)
          and assignment.role_id = 'CAPA_ORG_ADMIN'
          and assignment.scope_code = 'ORGANIZATION'
          and assignment.scope_resource_type is null
          and assignment.scope_resource_id is null
          and assignment.status = 'active'
          and assignment.effective_at <= ${scope.now}::timestamptz
          and (assignment.expires_at is null or assignment.expires_at > ${scope.now}::timestamptz)
          and role.status = 'active'
          and role.human_authority
          and 'quality_data.source.read' = any(role.permissions)
        limit 1
      `;
      if (authority.length !== 1) return null;

      const versionRows = await sql<Row[]>`
        select version.organization_id, version.dataset_id, version.dataset_version_id,
          version.version_number, version.schema_version, version.review_state, version.created_at,
          dataset.dataset_key, dataset.dataset_name,
          latest.approval_event_id, latest.transition_number, latest.decision,
          latest.reviewer_user_id, latest.reviewer_membership_id, latest.occurred_at, latest.rationale
        from public.quality_data_dataset_versions as version
        join public.quality_data_datasets as dataset
          on dataset.organization_id = version.organization_id
          and dataset.dataset_id = version.dataset_id
        left join lateral (
          select event.approval_event_id, event.transition_number, event.decision,
            event.reviewer_user_id, event.reviewer_membership_id, event.occurred_at, event.rationale
          from public.quality_data_dataset_version_approval_events as event
          where event.organization_id = version.organization_id
            and event.dataset_id = version.dataset_id
            and event.dataset_version_id = version.dataset_version_id
          order by event.transition_number desc
          limit 1
        ) as latest on true
        where version.organization_id = ${scope.organization_id}::uuid
          and version.dataset_version_id = ${datasetVersionId}::uuid
        limit 1
      `;
      const version = versionRows[0];
      if (version === undefined) return null;
      const decision = currentDecision(version.decision);
      if (decision !== "approved") return { status: "not_approved", decision };

      const sourceRows = await sql<Row[]>`
        select source.source_id, source.source_key, source.source_name,
          source.source_type, source_version.source_version_id,
          source_version.version_number, source_version.original_source_version,
          source_version.fingerprint_algorithm, source_version.source_sha256,
          source_version.byte_length, source_version.media_type, source_version.storage_reference,
          source_version.parser_version, source_version.schema_version,
          source_version.uploaded_by_user_id, source_version.created_at
        from public.quality_data_dataset_version_sources as link
        join public.quality_data_source_versions as source_version
          on source_version.organization_id = link.organization_id
          and source_version.source_version_id = link.source_version_id
        join public.quality_data_sources as source
          on source.organization_id = source_version.organization_id
          and source.source_id = source_version.source_id
        where link.organization_id = ${scope.organization_id}::uuid
          and link.dataset_version_id = ${datasetVersionId}::uuid
        order by source_version.version_number
      `;
      const recordRows = await sql<Row[]>`
        select record.record_id, record.record_ordinal, record.source_worksheet,
          record.source_row_number, record.created_at,
          coalesce(jsonb_agg(jsonb_build_object(
            'field_id', field.field_id, 'field_key', field.field_key,
            'field_ordinal', field.field_ordinal, 'value_type', field.value_type,
            'original_value', field.original_value, 'normalized_value', field.normalized_value,
            'normalized_unit', field.normalized_unit, 'source_worksheet', field.source_worksheet,
            'source_row_number', field.source_row_number,
            'source_cell_reference', field.source_cell_reference
          ) order by field.field_ordinal) filter (where field.field_id is not null), '[]'::jsonb) as fields
        from public.quality_data_inspection_records as record
        left join public.quality_data_inspection_fields as field
          on field.organization_id = record.organization_id
          and field.dataset_version_id = record.dataset_version_id
          and field.record_id = record.record_id
        where record.organization_id = ${scope.organization_id}::uuid
          and record.dataset_version_id = ${datasetVersionId}::uuid
        group by record.record_id
        order by record.record_ordinal
      `;
      const outcomeRows = await sql<Row[]>`
        select validation_id, record_id, field_id, rule_code, rule_version,
          outcome, details, created_at
        from public.quality_data_validation_outcomes
        where organization_id = ${scope.organization_id}::uuid
          and dataset_version_id = ${datasetVersionId}::uuid
        order by rule_code, rule_version, validation_id
      `;

      const snapshot: QualityDataDatasetSnapshot = {
        dataset: {
          dataset_id: text(version.dataset_id),
          dataset_key: text(version.dataset_key),
          dataset_name: text(version.dataset_name),
          organization_id: text(version.organization_id),
        },
        version: {
          dataset_version_id: text(version.dataset_version_id),
          version_number: integer(version.version_number),
          schema_version: text(version.schema_version),
          review_state: "review_required",
          created_at: new Date(version.created_at as string | Date).toISOString(),
        },
        source_versions: sourceRows.map((row) => ({ ...row })),
        records: recordRows.map((row) => ({ ...row })),
        validation_outcomes: outcomeRows.map((row) => ({ ...row })),
      };
      return {
        status: "approved",
        snapshot,
        approval: approvalState(version),
      };
    });
  }

  async findVersionApprovalSummary(
    scope: QualityDataReadScope,
    datasetVersionId: string,
  ): Promise<QualityDataApprovalSummary | null> {
    const rows = await this.sql<Row[]>`
      select version.dataset_id, version.dataset_version_id,
        latest.approval_event_id, latest.organization_id as event_organization_id,
        latest.dataset_id as event_dataset_id, latest.dataset_version_id as event_dataset_version_id,
        latest.decision, latest.transition_number, latest.reviewer_user_id,
        latest.reviewer_membership_id, latest.occurred_at, latest.rationale
      from public.quality_data_dataset_versions as version
      join public.quality_data_datasets as dataset
        on dataset.organization_id = version.organization_id
        and dataset.dataset_id = version.dataset_id
      left join lateral (
        select event.approval_event_id, event.organization_id, event.dataset_id,
          event.dataset_version_id, event.decision, event.transition_number,
          event.reviewer_user_id, event.reviewer_membership_id, event.occurred_at, event.rationale
        from public.quality_data_dataset_version_approval_events as event
        where event.organization_id = version.organization_id
          and event.dataset_id = version.dataset_id
          and event.dataset_version_id = version.dataset_version_id
        order by event.transition_number desc
        limit 1
      ) as latest on true
      where version.organization_id = ${scope.organization_id}::uuid
        and version.dataset_version_id = ${datasetVersionId}::uuid
        and exists (
          select 1
          from public.capa_organization_memberships as membership
          join public.capa_organizations as organization
            on organization.organization_id = membership.organization_id
          join public.capa_role_assignments as assignment
            on assignment.organization_id = membership.organization_id
            and assignment.membership_id = membership.membership_id
            and assignment.user_id = membership.user_id
          join public.capa_roles as role on role.role_id = assignment.role_id
          where membership.organization_id = ${scope.organization_id}::uuid
            and membership.membership_id = ${scope.membership_id}::uuid
            and membership.user_id = ${scope.user_id}::uuid
            and membership.status = 'active'
            and membership.effective_at <= ${scope.now}::timestamptz
            and (membership.expires_at is null or membership.expires_at > ${scope.now}::timestamptz)
            and organization.status = 'active'
            and organization.effective_at <= ${scope.now}::timestamptz
            and (organization.superseded_at is null or organization.superseded_at > ${scope.now}::timestamptz)
            and assignment.role_id = 'CAPA_ORG_ADMIN'
            and assignment.scope_code = 'ORGANIZATION'
            and assignment.scope_resource_type is null
            and assignment.scope_resource_id is null
            and assignment.status = 'active'
            and assignment.effective_at <= ${scope.now}::timestamptz
            and (assignment.expires_at is null or assignment.expires_at > ${scope.now}::timestamptz)
            and role.status = 'active'
            and role.human_authority
            and 'quality_data.version.approve' = any(role.permissions)
        )
      limit 1
    `;
    const row = rows[0];
    if (row === undefined) return null;
    const decision = currentDecision(row.decision);
    const event = decision === "none" ? null : approvalState({
      ...row,
      organization_id: row.event_organization_id,
      dataset_id: row.event_dataset_id,
      dataset_version_id: row.event_dataset_version_id,
    });
    return {
      dataset_id: text(row.dataset_id),
      dataset_version_id: text(row.dataset_version_id),
      current_decision: decision === "none" ? null : decision,
      transition_number: event?.transition_number ?? 0,
      current_event: event,
    };
  }

  async appendExternalAiOptInEvent(
    transaction: TransactionContext,
    input: QualityDataExternalAiOptInAppendInput,
  ): Promise<QualityDataExternalAiOptInAppendResult> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(${input.organization_id}),
      pg_catalog.hashtext('quality-data:external-ai-opt-in')
    )`;
    const authority = await sql<Row[]>`
      select membership.membership_id
      from public.capa_organization_memberships as membership
      join public.capa_organizations as organization
        on organization.organization_id = membership.organization_id
      join public.capa_role_assignments as assignment
        on assignment.organization_id = membership.organization_id
        and assignment.membership_id = membership.membership_id
        and assignment.user_id = membership.user_id
      join public.capa_roles as role on role.role_id = assignment.role_id
      where membership.organization_id = ${input.organization_id}::uuid
        and membership.membership_id = ${input.actor_membership_id}::uuid
        and membership.user_id = ${input.actor_user_id}::uuid
        and membership.status = 'active'
        and membership.effective_at <= ${input.now}::timestamptz
        and (membership.expires_at is null or membership.expires_at > ${input.now}::timestamptz)
        and organization.status = 'active'
        and organization.effective_at <= ${input.now}::timestamptz
        and (organization.superseded_at is null or organization.superseded_at > ${input.now}::timestamptz)
        and assignment.role_id = 'CAPA_ORG_ADMIN'
        and assignment.scope_code = 'ORGANIZATION'
        and assignment.scope_resource_type is null
        and assignment.scope_resource_id is null
        and assignment.status = 'active'
        and assignment.effective_at <= ${input.now}::timestamptz
        and (assignment.expires_at is null or assignment.expires_at > ${input.now}::timestamptz)
        and role.status = 'active'
        and role.human_authority
        and 'quality_data.external_ai.manage' = any(role.permissions)
      for share of membership, organization, assignment, role
      limit 1
    `;
    if (authority.length !== 1) return { status: "unauthorized" };
    const existingRows = await sql<Row[]>`
      select * from public.quality_data_external_ai_opt_in_events
      where organization_id = ${input.organization_id}::uuid
        and idempotency_key = ${input.request_trace.idempotency_key}
      limit 1
    `;
    const existing = existingRows[0];
    if (existing) {
      if (existing.request_fingerprint !== input.request_fingerprint) return { status: "conflict", reason_code: "IDEMPOTENCY_KEY_REUSED" };
      return { status: "already_recorded", state: externalAiOptInState(existing) };
    }
    const previousRows = await sql<Row[]>`
      select event_id, transition_number from public.quality_data_external_ai_opt_in_events
      where organization_id = ${input.organization_id}::uuid
      order by transition_number desc limit 1
    `;
    const previous = previousRows[0];
    const previousTransition = previous === undefined ? 0 : integer(previous.transition_number);
    if (input.command.expected_transition_number !== previousTransition) return { status: "conflict", reason_code: "STALE_TRANSITION" };
    if ((previous === undefined && input.command.decision === "disabled")
      || (previous !== undefined && String(previous.decision) === input.command.decision)) {
      return { status: "conflict", reason_code: "STALE_TRANSITION" };
    }
    const rows = await sql<Row[]>`
      insert into public.quality_data_external_ai_opt_in_events (
        event_id, organization_id, transition_number, decision,
        actor_user_id, actor_membership_id, occurred_at, rationale,
        previous_event_id, request_id, correlation_id, idempotency_key, request_fingerprint
      ) values (
        ${input.event_id}::uuid, ${input.organization_id}::uuid, ${previousTransition + 1},
        ${input.command.decision}, ${input.actor_user_id}::uuid, ${input.actor_membership_id}::uuid,
        ${input.now}::timestamptz, ${input.command.rationale},
        ${previous === undefined ? null : String(previous.event_id)}::uuid,
        ${input.request_trace.request_id}::uuid, ${input.request_trace.correlation_id}::uuid,
        ${input.request_trace.idempotency_key}, ${input.request_fingerprint}
      ) returning *
    `;
    if (!rows[0]) throw new Error("QUALITY_DATA_EXTERNAL_AI_OPT_IN_INSERT_FAILED");
    return { status: "applied", state: externalAiOptInState(rows[0]) };
  }

  async findExternalAiOptInState(organizationId: string): Promise<QualityDataExternalAiOptInState | null> {
    const rows = await this.sql<Row[]>`
      select * from public.quality_data_external_ai_opt_in_events
      where organization_id = ${organizationId}::uuid
      order by transition_number desc limit 1
    `;
    return rows[0] ? externalAiOptInState(rows[0]) : null;
  }
}
