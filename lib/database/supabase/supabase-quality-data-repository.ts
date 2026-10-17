import type postgres from "postgres";
import { createHash } from "node:crypto";

import type { QualityDataIngestionCommand, QualityDataIngestionReceipt } from "../../quality-data/quality-data-contract";
import type { QualityDataDatasetSnapshot, QualityDataPersistInput, QualityDataPersistResult, QualityDataReadScope, QualityDataRepository } from "../repositories/quality-data-repository";
import { QualityDataRepositoryError } from "../repositories/quality-data-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;

function jsonParameter(sql: postgres.TransactionSql, value: unknown) {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new QualityDataRepositoryError("The quality-data bundle could not be serialized.");
  }
  if (serialized === undefined) {
    throw new QualityDataRepositoryError("The quality-data bundle could not be serialized.");
  }
  return sql.json(JSON.parse(serialized) as postgres.JSONValue);
}

function safeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new QualityDataRepositoryError("The quality-data database returned an invalid count.");
  }
  return parsed;
}

function requireText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new QualityDataRepositoryError("The quality-data database returned invalid metadata.");
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function receipt(row: Row, status: QualityDataIngestionReceipt["status"]): QualityDataIngestionReceipt {
  return {
    status,
    ingestion_job_id: requireText(row.ingestion_job_id),
    source_id: requireText(row.source_id),
    source_version_id: requireText(row.source_version_id),
    dataset_id: requireText(row.dataset_id),
    dataset_version_id: requireText(row.dataset_version_id),
    record_count: safeInteger(row.record_count),
    field_count: safeInteger(row.field_count),
    review_state: "review_required",
  };
}

function resultFingerprint(command: QualityDataIngestionCommand): string {
  return sha256({
    idempotency_key: command.idempotency_key,
    source: {
      source_key: command.source.source_key,
      source_name: command.source.source_name,
      source_type: command.source.source_type,
      original_source_version: command.source.original_source_version,
      source_sha256: command.source.source_sha256,
      media_type: command.source.media_type,
      storage_reference: command.source.storage_reference,
      parser_version: command.source.parser_version,
      schema_version: command.source.schema_version,
    },
    dataset: command.dataset,
    records: command.records,
  });
}

function recordAndFieldRows(input: QualityDataPersistInput) {
  let fieldCount = 0;
  const records = input.command.records.map((record, index) => {
    const recordId = input.create_uuid();
    const fields = record.fields.map((field, fieldIndex) => {
      fieldCount += 1;
      return {
        field_id: input.create_uuid(),
        organization_id: input.organization_id,
        dataset_version_id: "", // Set after the database allocates the version ID.
        record_id: recordId,
        field_key: field.field_key,
        field_ordinal: fieldIndex + 1,
        value_type: field.value_type,
        original_value: field.original_value,
        normalized_value: field.normalized_value ?? null,
        normalized_unit: field.normalized_unit ?? null,
        source_worksheet: record.source_worksheet,
        source_row_number: record.source_row_number,
        source_cell_reference: field.source_cell_reference,
      };
    });
    return {
      record_id: recordId,
      organization_id: input.organization_id,
      dataset_version_id: "", // Set after the database allocates the version ID.
      record_ordinal: index + 1,
      source_worksheet: record.source_worksheet,
      source_row_number: record.source_row_number,
      fields,
    };
  });
  return { records, field_count: fieldCount };
}

export class SupabaseQualityDataRepository implements QualityDataRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async persistIngestion(
    transaction: TransactionContext,
    input: QualityDataPersistInput,
  ): Promise<QualityDataPersistResult> {
    const sql = requireSupabaseTransaction(transaction);
    const command = input.command;
    const fingerprint = input.request_fingerprint || resultFingerprint(command);

    await sql`select pg_advisory_xact_lock(hashtext(${input.organization_id}), hashtext(${`quality-data:ingest:${input.idempotency_key}`}))`;

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
        and membership.membership_id = ${input.membership_id}::uuid
        and membership.user_id = ${input.uploader_user_id}::uuid
        and membership.status = 'active'
        and membership.effective_at <= ${input.now}::timestamptz
        and (membership.expires_at is null or membership.expires_at > ${input.now}::timestamptz)
        and organization.status = 'active'
        and organization.effective_at <= ${input.now}::timestamptz
        and (organization.superseded_at is null or organization.superseded_at > ${input.now}::timestamptz)
        and assignment.status = 'active'
        and assignment.scope_code = 'ORGANIZATION'
        and assignment.effective_at <= ${input.now}::timestamptz
        and (assignment.expires_at is null or assignment.expires_at > ${input.now}::timestamptz)
        and assignment.role_id = 'CAPA_ORG_ADMIN'
        and role.status = 'active'
        and role.human_authority
        and 'quality_data.source.ingest' = any(role.permissions)
      for share of membership, organization, assignment, role
      limit 1
    `;
    if (authority.length !== 1) return { status: "unauthorized" };

    const existingJobs = await sql<Row[]>`
      select ingestion_job_id, source_id, source_version_id, dataset_id,
        dataset_version_id, request_fingerprint, record_count, field_count
      from public.quality_data_ingestion_jobs
      where organization_id = ${input.organization_id}::uuid
        and idempotency_key = ${input.idempotency_key}
      limit 1
    `;
    const existingJob = existingJobs[0];
    if (existingJob !== undefined) {
      if (existingJob.request_fingerprint !== fingerprint) {
        return { status: "conflict", reason_code: "IDEMPOTENCY_KEY_REUSED" };
      }
      return { status: "already_registered", receipt: receipt(existingJob, "already_registered") };
    }

    await sql`select pg_advisory_xact_lock(hashtext(${input.organization_id}), hashtext(${"quality-data:source:" + command.source.source_key}))`;
    const sourceInsert = await sql<Row[]>`
      insert into public.quality_data_sources (
        organization_id, source_key, source_name, source_type, uploaded_by_user_id
      ) values (
        ${input.organization_id}::uuid, ${command.source.source_key}, ${command.source.source_name},
        ${command.source.source_type}, ${input.uploader_user_id}::uuid
      ) on conflict (organization_id, source_key) do nothing
      returning source_id
    `;
    let sourceId = sourceInsert[0]?.source_id;
    if (sourceId === undefined) {
      const sources = await sql<Row[]>`
        select source_id, source_name, source_type
        from public.quality_data_sources
        where organization_id = ${input.organization_id}::uuid
          and source_key = ${command.source.source_key}
        for update
      `;
      const source = sources[0];
      if (source === undefined || source.source_name !== command.source.source_name || source.source_type !== command.source.source_type) {
        return { status: "conflict", reason_code: "SOURCE_IDENTITY_CONFLICT" };
      }
      sourceId = source.source_id;
    }

    const priorVersions = await sql<Row[]>`
      select source_version_id, version_number, source_sha256, byte_length,
        media_type, storage_reference, parser_version, schema_version
      from public.quality_data_source_versions
      where organization_id = ${input.organization_id}::uuid
        and source_id = ${sourceId}::uuid
        and original_source_version = ${command.source.original_source_version}
      limit 1
    `;
    let sourceVersionId = priorVersions[0]?.source_version_id;
    let sourceVersionNumber = priorVersions[0]?.version_number;
    const priorVersion = priorVersions[0];
    if (priorVersion !== undefined) {
      const exact = priorVersion.source_sha256 === command.source.source_sha256
        && Number(priorVersion.byte_length) === command.source.source_bytes.byteLength
        && priorVersion.media_type === command.source.media_type
        && priorVersion.storage_reference === command.source.storage_reference
        && priorVersion.parser_version === command.source.parser_version
        && priorVersion.schema_version === command.source.schema_version;
      if (!exact) return { status: "conflict", reason_code: "SOURCE_VERSION_CONFLICT" };
    } else {
      const maximum = await sql<Row[]>`
        select coalesce(max(version_number), 0)::integer + 1 as next_version
        from public.quality_data_source_versions
        where organization_id = ${input.organization_id}::uuid and source_id = ${sourceId}::uuid
      `;
      sourceVersionNumber = safeInteger(maximum[0]?.next_version);
      const insertedVersion = await sql<Row[]>`
        insert into public.quality_data_source_versions (
          organization_id, source_id, version_number, original_source_version,
          source_sha256, byte_length, media_type, storage_reference,
          parser_version, schema_version, uploaded_by_user_id
        ) values (
          ${input.organization_id}::uuid, ${sourceId}::uuid, ${sourceVersionNumber},
          ${command.source.original_source_version}, ${command.source.source_sha256},
          ${command.source.source_bytes.byteLength}, ${command.source.media_type},
          ${command.source.storage_reference}, ${command.source.parser_version},
          ${command.source.schema_version}, ${input.uploader_user_id}::uuid
        ) returning source_version_id
      `;
      sourceVersionId = insertedVersion[0]?.source_version_id;
    }

    await sql`select pg_advisory_xact_lock(hashtext(${input.organization_id}), hashtext(${"quality-data:dataset:" + command.dataset.dataset_key}))`;
    const datasetInsert = await sql<Row[]>`
      insert into public.quality_data_datasets (
        organization_id, dataset_key, dataset_name, created_by_user_id
      ) values (
        ${input.organization_id}::uuid, ${command.dataset.dataset_key},
        ${command.dataset.dataset_name}, ${input.uploader_user_id}::uuid
      ) on conflict (organization_id, dataset_key) do nothing
      returning dataset_id
    `;
    let datasetId = datasetInsert[0]?.dataset_id;
    if (datasetId === undefined) {
      const datasets = await sql<Row[]>`
        select dataset_id, dataset_name from public.quality_data_datasets
        where organization_id = ${input.organization_id}::uuid
          and dataset_key = ${command.dataset.dataset_key}
        for update
      `;
      const dataset = datasets[0];
      if (dataset === undefined || dataset.dataset_name !== command.dataset.dataset_name) {
        return { status: "conflict", reason_code: "DATASET_IDENTITY_CONFLICT" };
      }
      datasetId = dataset.dataset_id;
    }

    const versionNumberRows = await sql<Row[]>`
      select coalesce(max(version_number), 0)::integer + 1 as next_version
      from public.quality_data_dataset_versions
      where organization_id = ${input.organization_id}::uuid and dataset_id = ${datasetId}::uuid
    `;
    const datasetVersionNumber = safeInteger(versionNumberRows[0]?.next_version);
    const datasetVersionId = input.create_uuid();
    await sql`
      insert into public.quality_data_dataset_versions (
        dataset_version_id, organization_id, dataset_id, version_number,
        schema_version, review_state, created_by_user_id, created_at
      ) values (
        ${datasetVersionId}::uuid, ${input.organization_id}::uuid, ${datasetId}::uuid,
        ${datasetVersionNumber}, ${command.dataset.schema_version}, 'review_required',
        ${input.uploader_user_id}::uuid, ${input.now}::timestamptz
      )
    `;
    if (sourceVersionId === undefined || sourceVersionNumber === undefined) {
      throw new QualityDataRepositoryError("The quality-data source version was not persisted.");
    }
    await sql`
      insert into public.quality_data_dataset_version_sources (
        organization_id, dataset_version_id, source_version_id
      ) values (${input.organization_id}::uuid, ${datasetVersionId}::uuid, ${sourceVersionId}::uuid)
    `;

    const { records, field_count: fieldCount } = recordAndFieldRows(input);
    const recordRows = records.map((record) => ({
      record_id: record.record_id,
      organization_id: record.organization_id,
      dataset_version_id: datasetVersionId,
      record_ordinal: record.record_ordinal,
      source_worksheet: record.source_worksheet,
      source_row_number: record.source_row_number,
    }));
    const fieldRows = records.flatMap((record) => record.fields.map((field) => ({
      field_id: field.field_id,
      organization_id: field.organization_id,
      dataset_version_id: datasetVersionId,
      record_id: field.record_id,
      field_key: field.field_key,
      field_ordinal: field.field_ordinal,
      value_type: field.value_type,
      original_value_json: JSON.stringify(field.original_value),
      normalized_value_json: field.normalized_value === null
        ? null
        : JSON.stringify(field.normalized_value),
      normalized_unit: field.normalized_unit,
      source_worksheet: field.source_worksheet,
      source_row_number: field.source_row_number,
      source_cell_reference: field.source_cell_reference,
    })));

    await sql`
      insert into public.quality_data_inspection_records (
        record_id, organization_id, dataset_version_id, record_ordinal,
        source_worksheet, source_row_number
      )
      select rows.record_id::uuid, rows.organization_id::uuid,
        rows.dataset_version_id::uuid, rows.record_ordinal,
        rows.source_worksheet, rows.source_row_number
      from jsonb_to_recordset(${jsonParameter(sql, recordRows)}::jsonb) as rows(
        record_id text, organization_id text, dataset_version_id text,
        record_ordinal integer, source_worksheet text, source_row_number integer
      )
    `;
    await sql`
      insert into public.quality_data_inspection_fields (
        field_id, organization_id, dataset_version_id, record_id, field_key, field_ordinal,
        value_type, original_value, normalized_value, normalized_unit,
        source_worksheet, source_row_number, source_cell_reference
      )
      select rows.field_id::uuid, rows.organization_id::uuid,
        rows.dataset_version_id::uuid, rows.record_id::uuid, rows.field_key,
        rows.field_ordinal, rows.value_type,
        rows.original_value_json::jsonb, rows.normalized_value_json::jsonb,
        rows.normalized_unit, rows.source_worksheet, rows.source_row_number,
        rows.source_cell_reference
      from jsonb_to_recordset(${jsonParameter(sql, fieldRows)}::jsonb) as rows(
        field_id text, organization_id text, dataset_version_id text,
        record_id text, field_key text, field_ordinal integer, value_type text,
        original_value_json text, normalized_value_json text, normalized_unit text,
        source_worksheet text, source_row_number integer,
        source_cell_reference text
      )
    `;

    const recordIds = new Map(records.map((record, index) => [index + 1, record.record_id]));
    const fieldIds = new Map<string, string>();
    records.forEach((record, index) => record.fields.forEach((field) => {
      fieldIds.set(`${index + 1}:${field.field_key}`, field.field_id);
    }));
    const validationRows = input.validation_outcomes.map((outcome) => ({
      validation_id: input.create_uuid(),
      organization_id: input.organization_id,
      dataset_version_id: datasetVersionId,
      record_id: outcome.target.scope === "dataset" ? null : recordIds.get(outcome.target.record_ordinal) ?? null,
      field_id: outcome.target.scope === "field" ? fieldIds.get(`${outcome.target.record_ordinal}:${outcome.target.field_key}`) ?? null : null,
      rule_code: outcome.rule_code,
      rule_version: outcome.rule_version,
      outcome: outcome.outcome,
      details: outcome.details,
    }));
    if (validationRows.length > 0) {
      await sql`
        insert into public.quality_data_validation_outcomes (
          validation_id, organization_id, dataset_version_id, record_id,
          field_id, rule_code, rule_version, outcome, details
        )
        select rows.validation_id::uuid, rows.organization_id::uuid,
          rows.dataset_version_id::uuid, rows.record_id::uuid,
          rows.field_id::uuid, rows.rule_code, rows.rule_version,
          rows.outcome, rows.details
        from jsonb_to_recordset(${jsonParameter(sql, validationRows)}::jsonb) as rows(
          validation_id text, organization_id text, dataset_version_id text,
          record_id text, field_id text, rule_code text, rule_version text,
          outcome text, details jsonb
        )
      `;
    }

    const jobId = input.create_uuid();
    await sql`
      insert into public.quality_data_ingestion_jobs (
        ingestion_job_id, organization_id, source_id, source_version_id,
        dataset_id, dataset_version_id, idempotency_key, request_fingerprint,
        status, record_count, field_count, request_id, correlation_id,
        created_by_user_id, created_at, updated_at
      ) values (
        ${jobId}::uuid, ${input.organization_id}::uuid, ${sourceId}::uuid,
        ${sourceVersionId}::uuid, ${datasetId}::uuid, ${datasetVersionId}::uuid,
        ${input.idempotency_key}, ${fingerprint}, 'accepted', ${records.length},
        ${fieldCount}, ${input.request_id}::uuid, ${input.correlation_id}::uuid,
        ${input.uploader_user_id}::uuid, ${input.now}::timestamptz, ${input.now}::timestamptz
      )
    `;
    await sql`
      update public.quality_data_ingestion_jobs
      set status = 'processing', record_version = 2, updated_at = ${input.now}::timestamptz
      where organization_id = ${input.organization_id}::uuid
        and ingestion_job_id = ${jobId}::uuid and status = 'accepted'
    `;
    await sql`
      update public.quality_data_ingestion_jobs
      set status = 'completed', record_version = 3, updated_at = ${input.now}::timestamptz
      where organization_id = ${input.organization_id}::uuid
        and ingestion_job_id = ${jobId}::uuid and status = 'processing'
    `;

    return {
      status: "inserted",
      receipt: {
        status: "accepted",
        ingestion_job_id: jobId,
        source_id: String(sourceId),
        source_version_id: String(sourceVersionId),
        dataset_id: String(datasetId),
        dataset_version_id: datasetVersionId,
        record_count: records.length,
        field_count: fieldCount,
        review_state: "review_required",
      },
    };
  }

  async findDatasetVersion(
    scope: QualityDataReadScope,
    datasetVersionId: string,
  ): Promise<QualityDataDatasetSnapshot | null> {
    return this.sql.begin(async (sql) => {
    const authority = await sql<Row[]>`
      select 1
      from public.capa_organization_memberships as membership
      join public.capa_organizations as organization
        on organization.organization_id = membership.organization_id
      join public.capa_role_assignments as assignment
        on assignment.organization_id = membership.organization_id
        and assignment.membership_id = membership.membership_id
        and assignment.user_id = membership.user_id
      join public.capa_roles as role
        on role.role_id = assignment.role_id
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
      for share of membership, organization, assignment, role
      limit 1
    `;
    if (authority.length !== 1) return null;
    const versions = await sql<Row[]>`
      select version.dataset_version_id, version.dataset_id, version.version_number,
        version.schema_version, version.review_state, version.created_at,
        dataset.organization_id, dataset.dataset_key, dataset.dataset_name
      from public.quality_data_dataset_versions as version
      join public.quality_data_datasets as dataset
        on dataset.organization_id = version.organization_id
        and dataset.dataset_id = version.dataset_id
      where version.organization_id = ${scope.organization_id}::uuid
        and version.dataset_version_id = ${datasetVersionId}::uuid
      limit 1
    `;
    const version = versions[0];
    if (version === undefined) return null;

    const sourceVersions = await sql<Row[]>`
      select source.source_id, source.source_key, source.source_name,
        source.source_type, source_version.source_version_id,
        source_version.version_number, source_version.original_source_version,
        source_version.fingerprint_algorithm, source_version.source_sha256,
        source_version.byte_length, source_version.media_type,
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
    const records = await sql<Row[]>`
      select record.record_id, record.record_ordinal, record.source_worksheet,
        record.source_row_number, record.created_at,
        coalesce(jsonb_agg(jsonb_build_object(
          'field_id', field.field_id, 'field_key', field.field_key,
          'field_ordinal', field.field_ordinal,
          'value_type', field.value_type, 'original_value', field.original_value,
          'normalized_value', field.normalized_value,
          'normalized_unit', field.normalized_unit,
          'source_worksheet', field.source_worksheet,
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
    const outcomes = await sql<Row[]>`
      select validation_id, record_id, field_id, rule_code, rule_version,
        outcome, details, created_at
      from public.quality_data_validation_outcomes
      where organization_id = ${scope.organization_id}::uuid
        and dataset_version_id = ${datasetVersionId}::uuid
      order by rule_code, rule_version, validation_id
    `;

    return {
      dataset: {
        dataset_id: requireText(version.dataset_id),
        dataset_key: requireText(version.dataset_key),
        dataset_name: requireText(version.dataset_name),
        organization_id: requireText(version.organization_id),
      },
      version: {
        dataset_version_id: requireText(version.dataset_version_id),
        version_number: safeInteger(version.version_number),
        schema_version: requireText(version.schema_version),
        review_state: "review_required",
        created_at: new Date(version.created_at as string | Date).toISOString(),
      },
      source_versions: sourceVersions.map((row) => ({ ...row })),
      records: records.map((row) => ({ ...row })),
      validation_outcomes: outcomes.map((row) => ({ ...row })),
    };
    });
  }
}
