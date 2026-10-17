import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SupabaseCapaAuthorizationPolicy } from "../../lib/capa/authorization/supabase-capa-authorization-policy";
import { SupabaseCapaTenantAccessError, SupabaseCapaDurableContextResolver } from "../../lib/security/supabase-capa-durable-context";
import type { SupabaseCapaSessionFacts } from "../../lib/security/supabase-capa-context";
import { PolicyBackedQualityDataIngestionAuthorizer } from "../../lib/quality-data/quality-data-authorization";
import type { QualityDataIngestionCommand } from "../../lib/quality-data/quality-data-contract";
import { ingestQualityData, readQualityDatasetVersion } from "../../lib/quality-data/quality-data-service";
import { ingestQualityDataXlsx } from "../../lib/quality-data/xlsx-quality-data-ingestion";
import { QUALITY_DATA_XLSX_MEDIA_TYPE } from "../../lib/quality-data/xlsx-quality-data-parser";
import { SupabaseAuditRepository } from "../../lib/database/supabase/supabase-audit-repository";
import { SupabaseQualityDataRepository } from "../../lib/database/supabase/supabase-quality-data-repository";
import { SupabaseTransactionManager } from "../../lib/database/supabase/supabase-transactions";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";

const ENABLED = process.env.QUALITY_DATA_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.QUALITY_DATA_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57381/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;
const NOW = new Date("2026-10-16T12:00:00.000Z");

function requireDisposableLoopbackDatabase(connectionString: string): void {
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("Quality-data PostgreSQL qualification requires a local disposable database URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || parsed.port !== "57381" || parsed.pathname !== "/postgres") {
    throw new Error("Quality-data PostgreSQL qualification is restricted to the disposable loopback database on port 57381.");
  }
}

function facts(userId: string): SupabaseCapaSessionFacts {
  return {
    verified_user_id: userId,
    authenticated_at: "2026-10-16T11:00:00.000Z",
    expires_at_epoch_seconds: Date.parse("2026-10-16T14:00:00.000Z") / 1000,
  };
}

function trace(key = randomUUID()): RequestTrace {
  return {
    request_id: randomUUID() as never,
    correlation_id: randomUUID() as never,
    idempotency_key: key as never,
  };
}

function command(input: {
  readonly organization_id: string;
  readonly source_key?: string;
  readonly dataset_key?: string;
  readonly idempotency_key: string;
  readonly source_bytes?: QualityDataIngestionCommand["source"]["source_bytes"];
}): QualityDataIngestionCommand {
  const bytes = input.source_bytes ?? new TextEncoder().encode("synthetic quality inspection source");
  const sha256 = awaitlessSha256(bytes);
  const sourceToken = randomUUID();
  const versionToken = randomUUID();
  return {
    idempotency_key: input.idempotency_key,
    source: {
      source_key: input.source_key ?? `source-${randomUUID()}`,
      source_name: "Synthetic inspection source",
      source_type: "csv",
      original_source_version: "revision-1",
      source_sha256: sha256,
      source_bytes: bytes,
      media_type: "text/csv",
      storage_reference: `quality-data/${input.organization_id}/${sourceToken}/${versionToken}/original`,
      parser_version: "fixture-parser-1.0.0",
      schema_version: "inspection-schema-1.0.0",
    },
    dataset: {
      dataset_key: input.dataset_key ?? `dataset-${randomUUID()}`,
      dataset_name: "Synthetic inspections",
      schema_version: "inspection-schema-1.0.0",
    },
    records: [
      {
        source_worksheet: "Inspections",
        source_row_number: 2,
        fields: [
          { field_key: "inspection_id", value_type: "text", original_value: "I-001", normalized_value: "I-001", source_cell_reference: "A2" },
          { field_key: "defect_count", value_type: "number", original_value: 2, normalized_value: 2, normalized_unit: "count", source_cell_reference: "B2" },
          { field_key: "inspection_date", value_type: "date", original_value: "2026-10-01", normalized_value: "2026-10-01", source_cell_reference: "C2" },
          { field_key: "note", value_type: "blank", original_value: null, source_cell_reference: "D2" },
        ],
      },
    ],
  };
}

function awaitlessSha256(bytes: Uint8Array): string {
  // The source fixture is synthetic and synchronously hashed for deterministic tests.
  return createHash("sha256").update(bytes).digest("hex");
}

describeDatabase("shared quality-data PostgreSQL foundation (disposable local PostgreSQL only)", () => {
  let sql: postgres.Sql;
  let repository: SupabaseQualityDataRepository;
  let transactions: SupabaseTransactionManager;
  let audit: SupabaseAuditRepository;
  let organizationId: string;
  let otherOrganizationId: string;
  let adminId: string;
  let ownerId: string;
  let contributorId: string;
  let inactiveAdminId: string;
  let otherMemberId: string;
  let adminMembershipId: string;
  let ownerMembershipId: string;
  let contributorMembershipId: string;
  let inactiveMembershipId: string;

  async function context(userId: string) {
    return new SupabaseCapaDurableContextResolver(sql).resolve(facts(userId), NOW);
  }

  async function directQualityDataCounts(userId: string): Promise<Record<string, number>> {
    return sql.begin(async (transaction) => {
      await transaction`set local role authenticated`;
      await transaction`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      const rows = await transaction<Record<string, number>[]>`
        select
          (select count(*)::int from public.quality_data_sources) as sources,
          (select count(*)::int from public.quality_data_source_versions) as source_versions,
          (select count(*)::int from public.quality_data_datasets) as datasets,
          (select count(*)::int from public.quality_data_dataset_versions) as dataset_versions,
          (select count(*)::int from public.quality_data_dataset_version_sources) as version_sources,
          (select count(*)::int from public.quality_data_ingestion_jobs) as ingestion_jobs,
          (select count(*)::int from public.quality_data_inspection_records) as inspection_records,
          (select count(*)::int from public.quality_data_inspection_fields) as inspection_fields,
          (select count(*)::int from public.quality_data_validation_outcomes) as validation_outcomes
      `;
      return rows[0] ?? {};
    });
  }

  function service(auditRepository = audit) {
    const policy = new SupabaseCapaAuthorizationPolicy(sql, {
      step_up_maximum_age_ms: 5 * 60_000,
      required_step_up_assurance: "MULTI_FACTOR" as never,
    });
    return {
      repository,
      audit_repository: auditRepository,
      transaction_manager: transactions,
      authorizer: new PolicyBackedQualityDataIngestionAuthorizer(policy),
      ids: { event_id: () => randomUUID() as never, uuid: () => randomUUID() },
      clock: { now: () => new Date(NOW) },
    };
  }

  async function insertOrganization(id: string, label: string): Promise<void> {
    await sql`
      insert into public.capa_organizations (
        organization_id, organization_name, authorization_policy_version,
        created_at, effective_at, updated_at,
        created_by_actor_type, created_by_actor_id,
        updated_by_actor_type, updated_by_actor_id
      ) values (
        ${id}::uuid, ${label}, 'authorization-policy-1.0.0',
        ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
        ${NOW.toISOString()}::timestamptz,
        'system', 'quality-data-fixture', 'system', 'quality-data-fixture'
      )
    `;
  }

  async function insertMember(input: { userId: string; membershipId: string; role: string; status?: string; organization_id?: string }): Promise<void> {
    const scopedOrganizationId = input.organization_id ?? organizationId;
    await sql`
      insert into public.capa_organization_memberships (
        membership_id, organization_id, user_id, status,
        effective_at, created_at, updated_at,
        created_by_actor_type, created_by_actor_id,
        updated_by_actor_type, updated_by_actor_id
      ) values (
        ${input.membershipId}::uuid, ${scopedOrganizationId}::uuid, ${input.userId}::uuid,
        ${input.status ?? "active"}, ${NOW.toISOString()}::timestamptz,
        ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
        'system', 'quality-data-fixture', 'system', 'quality-data-fixture'
      )
    `;
    await sql`
      insert into public.capa_role_assignments (
        organization_id, membership_id, user_id, role_id, scope_code, status,
        effective_at, created_at, updated_at,
        granted_by_actor_type, granted_by_actor_id, grant_reason
      ) values (
        ${scopedOrganizationId}::uuid, ${input.membershipId}::uuid, ${input.userId}::uuid,
        ${input.role}, 'ORGANIZATION', ${input.status ?? "active"},
        ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
        ${NOW.toISOString()}::timestamptz,
        'system', 'quality-data-fixture', 'Synthetic qualification fixture'
      )
    `;
  }

  async function xlsxFixture(): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Final Inspection");
    sheet.addRow(["Lot", "Rejects", "Inspection Date"]);
    sheet.addRow(["LOT-001", 2, "2026-10-15"]);
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    requireDisposableLoopbackDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 4 });
    await sql`select 1`;
    repository = new SupabaseQualityDataRepository(sql);
    transactions = new SupabaseTransactionManager(sql);
    audit = new SupabaseAuditRepository(sql);

    organizationId = randomUUID();
    otherOrganizationId = randomUUID();
    adminId = randomUUID();
    ownerId = randomUUID();
    contributorId = randomUUID();
    inactiveAdminId = randomUUID();
    otherMemberId = randomUUID();
    adminMembershipId = randomUUID();
    ownerMembershipId = randomUUID();
    contributorMembershipId = randomUUID();
    inactiveMembershipId = randomUUID();

    await insertOrganization(organizationId, "Synthetic Quality Org");
    await insertOrganization(otherOrganizationId, "Other Synthetic Org");
    await insertMember({ userId: adminId, membershipId: adminMembershipId, role: "CAPA_ORG_ADMIN" });
    await insertMember({ userId: ownerId, membershipId: ownerMembershipId, role: "CAPA_OWNER" });
    await insertMember({ userId: contributorId, membershipId: contributorMembershipId, role: "CAPA_CONTRIBUTOR" });
    await insertMember({ userId: inactiveAdminId, membershipId: inactiveMembershipId, role: "CAPA_ORG_ADMIN", status: "revoked" });
    await insertMember({ userId: otherMemberId, membershipId: randomUUID(), role: "CAPA_CONTRIBUTOR", organization_id: otherOrganizationId });
  });

  afterAll(async () => {
    if (sql) await sql.end();
  });

  it("grants the independent quality-data permissions only to the designated administrator role", async () => {
    const roles = await sql<{
      role_id: string;
      can_read: boolean;
      can_ingest: boolean;
    }[]>`
      select role_id,
        'quality_data.source.read' = any(permissions) as can_read,
        'quality_data.source.ingest' = any(permissions) as can_ingest
      from public.capa_roles
    `;
    expect(roles.find((row) => row.role_id === "CAPA_ORG_ADMIN")).toEqual({
      role_id: "CAPA_ORG_ADMIN", can_read: true, can_ingest: true,
    });
    for (const row of roles.filter((candidate) => candidate.role_id !== "CAPA_ORG_ADMIN")) {
      expect(row.can_read).toBe(false);
      expect(row.can_ingest).toBe(false);
    }
  });

  it("persists an authorized source, immutable dataset version, typed provenance and audit atomically", async () => {
    const requestTrace = trace();
    const body = command({ organization_id: organizationId, idempotency_key: requestTrace.idempotency_key! });
    const result = await ingestQualityData(
      service(), await context(adminId), requestTrace,
      body,
    );
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    expect(result.receipt.review_state).toBe("review_required");
    expect(result.receipt.record_count).toBe(1);
    expect(result.receipt.field_count).toBe(4);
    const snapshot = await readQualityDatasetVersion(service(), await context(adminId), result.receipt.dataset_version_id);
    expect(snapshot.status).toBe("found");
    if (snapshot.status !== "found") return;
    expect(snapshot.snapshot.dataset.organization_id).toBe(organizationId);
    const sourceVersion = snapshot.snapshot.source_versions[0] as {
      source_sha256: string;
      uploaded_by_user_id: string;
    } | undefined;
    expect(sourceVersion?.source_sha256).toBe(body.source.source_sha256);
    expect(sourceVersion?.uploaded_by_user_id).toBe(adminId);
    expect(snapshot.snapshot.records).toHaveLength(1);
    expect(snapshot.snapshot.validation_outcomes).toHaveLength(3);
    expect(snapshot.snapshot.validation_outcomes.map((outcome) => outcome.rule_code)).toEqual([
      "CELL_PROVENANCE_COMPLETE", "CONTRACT_SCHEMA_VALID", "SOURCE_SHA256_MATCH",
    ]);
    const fields = snapshot.snapshot.records[0]?.fields as Array<{ value_type: string; original_value: unknown; source_cell_reference: string }>;
    expect(fields.map((field) => field.value_type)).toEqual(["text", "number", "date", "blank"]);
    expect(fields[1]?.original_value).toBe(2);
    expect(fields[1]?.source_cell_reference).toBe("B2");
    const events = await sql<{ count: number }[]>`
      select count(*)::int as count from public.capa_audit_events
      where organization_id = ${organizationId}::uuid and action = 'QUALITY_DATA_INGESTED'
    `;
    expect(events[0]?.count).toBe(1);
  });

  it("ingests a synthetic XLSX through real authorization and PostgreSQL persistence with exact cell lineage", async () => {
    const requestTrace = trace();
    const bytes = await xlsxFixture();
    const storage = {
      storeOriginal: vi.fn(async (input: { organization_id: string; source_key: string; original_source_version: string; bytes: Uint8Array; sha256: string; media_type: string }) => ({
        status: "stored" as const,
        storage_reference: `quality-data/${input.organization_id}/${createHash("sha256").update(input.source_key).digest("hex")}/${createHash("sha256").update(input.original_source_version).digest("hex")}/original`,
      })),
    };
    const dependencies = { ...service(), source_storage: storage };
    const input = {
      idempotency_key: requestTrace.idempotency_key,
      source: { source_key: `xlsx-${randomUUID()}`, source_name: "Synthetic inspection.xlsx", original_source_version: "revision-1", bytes },
      dataset: { dataset_key: `xlsx-${randomUUID()}`, dataset_name: "Synthetic inspection dataset", schema_version: "inspection-v1.0.0" },
      mapping: {
        worksheet_name: "Final Inspection", header_row: 1,
        columns: [
          { header: "Lot", field_key: "lot_number", value_type: "text", required: true },
          { header: "Rejects", field_key: "reject_count", value_type: "number", required: true, normalized_unit: "count" },
          { header: "Inspection Date", field_key: "inspection_date", value_type: "date", required: true },
        ],
        ignored_headers: [],
      },
    };
    const result = await ingestQualityDataXlsx(dependencies, await context(adminId), requestTrace, input);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(storage.storeOriginal).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
    }));
    const snapshot = await readQualityDatasetVersion(service(), await context(adminId), result.receipt.dataset_version_id);
    expect(snapshot.status).toBe("found");
    if (snapshot.status !== "found") return;
    expect(snapshot.snapshot.records).toHaveLength(1);
    const record = snapshot.snapshot.records[0] as { source_worksheet: string; source_row_number: number; fields: Array<{ field_key: string; original_value: unknown; normalized_value: unknown; source_cell_reference: string }> };
    expect(record).toMatchObject({ source_worksheet: "Final Inspection", source_row_number: 2 });
    expect(record.fields).toEqual([
      expect.objectContaining({ field_key: "lot_number", original_value: "LOT-001", normalized_value: "LOT-001", source_cell_reference: "A2" }),
      expect.objectContaining({ field_key: "reject_count", original_value: 2, normalized_value: 2, source_cell_reference: "B2" }),
      expect.objectContaining({ field_key: "inspection_date", original_value: "2026-10-15", normalized_value: "2026-10-15", source_cell_reference: "C2" }),
    ]);
    expect(snapshot.snapshot.source_versions[0]).toMatchObject({
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
      storage_reference: expect.stringMatching(/^quality-data\/.+\/[0-9a-f]{64}\/[0-9a-f]{64}\/original$/),
      parser_version: "quality-data-xlsx-1.0.0",
    });
    const replay = await ingestQualityDataXlsx(dependencies, await context(adminId), requestTrace, input);
    expect(replay.status).toBe("already_registered");
    expect(storage.storeOriginal).toHaveBeenCalledTimes(2);
  });

  it("denies XLSX source storage access to a non-admin before any Storage or database persistence", async () => {
    const requestTrace = trace();
    const storage = { storeOriginal: vi.fn() };
    const dependencies = { ...service(), source_storage: storage };
    const input = {
      idempotency_key: requestTrace.idempotency_key,
      source: { source_key: `unauthorized-${randomUUID()}`, source_name: "Synthetic.xlsx", original_source_version: "revision-1", bytes: await xlsxFixture() },
      dataset: { dataset_key: `unauthorized-${randomUUID()}`, dataset_name: "Synthetic", schema_version: "inspection-v1.0.0" },
      mapping: {
        worksheet_name: "Final Inspection", header_row: 1,
        columns: [
          { header: "Lot", field_key: "lot_number", value_type: "text", required: true },
          { header: "Rejects", field_key: "reject_count", value_type: "number", required: true },
          { header: "Inspection Date", field_key: "inspection_date", value_type: "date", required: true },
        ],
        ignored_headers: [],
      },
    };
    const result = await ingestQualityDataXlsx(dependencies, await context(contributorId), requestTrace, input);
    expect(result).toMatchObject({ status: "denied" });
    expect(storage.storeOriginal).not.toHaveBeenCalled();
    const count = await sql<{ count: number }[]>`
      select count(*)::int as count from public.quality_data_ingestion_jobs
      where organization_id = ${organizationId}::uuid and idempotency_key = ${requestTrace.idempotency_key!}
    `;
    expect(count[0]?.count).toBe(0);
  });

  it("keeps quality source Storage private and blocks direct authenticated object visibility", async () => {
    const bucket = await sql<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }[]>`
      select public, file_size_limit::integer as file_size_limit, allowed_mime_types from storage.buckets where id = 'quality-data-sources'
    `;
    expect(bucket).toEqual([{
      public: false,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    }]);
    const policy = await sql<{ permissive: string; roles: string[]; qual: string; with_check: string }[]>`
      select permissive, roles, qual, with_check
      from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'quality_data_source_objects_server_only'
    `;
    expect(policy).toHaveLength(1);
    expect(policy[0]).toMatchObject({ permissive: "RESTRICTIVE", roles: expect.arrayContaining(["public"]) });
    expect(policy[0]?.qual).toContain("bucket_id <> 'quality-data-sources'");
    expect(policy[0]?.with_check).toContain("bucket_id <> 'quality-data-sources'");

    const objectName = `synthetic-policy-check-${randomUUID()}`;
    await sql`insert into storage.objects (bucket_id, name, metadata)
      values ('quality-data-sources', ${objectName}, '{}'::jsonb)`;
    try {
      const visible = await sql.begin(async (transaction) => {
        await transaction`set local role authenticated`;
        await transaction`select set_config('request.jwt.claim.sub', ${adminId}, true)`;
        return transaction<{ count: number }[]>`
          select count(*)::int as count from storage.objects
          where bucket_id = 'quality-data-sources' and name = ${objectName}
        `;
      });
      expect(visible[0]?.count).toBe(0);
    } finally {
      await sql`delete from storage.objects where bucket_id = 'quality-data-sources' and name = ${objectName}`;
    }
  });

  it("deduplicates exact idempotent requests and rejects key reuse with altered content", async () => {
    const requestTrace = trace();
    const original = command({ organization_id: organizationId, idempotency_key: requestTrace.idempotency_key! });
    const first = await ingestQualityData(service(), await context(adminId), requestTrace, original);
    const replay = await ingestQualityData(service(), await context(adminId), requestTrace, original);
    expect(first.status).toBe("accepted");
    expect(replay.status).toBe("already_registered");
    const changed = {
      ...original,
      records: [{ ...original.records[0]!, fields: [{ ...original.records[0]!.fields[0]!, original_value: "changed" }] }],
    };
    await expect(ingestQualityData(service(), await context(adminId), requestTrace, changed)).resolves.toMatchObject({
      status: "conflict", reason_code: "IDEMPOTENCY_CONFLICT",
    });
    const duplicateJobs = await sql<{ count: number }[]>`
      select count(*)::int as count from public.quality_data_ingestion_jobs
      where organization_id = ${organizationId}::uuid and idempotency_key = ${requestTrace.idempotency_key!}
    `;
    expect(duplicateJobs[0]?.count).toBe(1);
  });

  it("serializes concurrent duplicate requests to one source, dataset version and audit event", async () => {
    const requestTrace = trace();
    const body = command({ organization_id: organizationId, idempotency_key: requestTrace.idempotency_key! });
    const [first, second] = await Promise.all([
      ingestQualityData(service(), await context(adminId), requestTrace, body),
      ingestQualityData(service(), await context(adminId), requestTrace, body),
    ]);
    expect([first.status, second.status].sort()).toEqual(["accepted", "already_registered"]);
  });

  it("denies CAPA_OWNER and contributors without calling them quality-data administrators", async () => {
    for (const userId of [ownerId, contributorId]) {
      const requestTrace = trace();
      const result = await ingestQualityData(
        service(), await context(userId), requestTrace,
        command({ organization_id: organizationId, idempotency_key: requestTrace.idempotency_key! }),
      );
      expect(result).toMatchObject({ status: "denied" });
    }
    await expect(context(inactiveAdminId)).rejects.toBeInstanceOf(SupabaseCapaTenantAccessError);
  });

  it("rejects cross-tenant writes and conceals datasets from another active organization member", async () => {
    const requestTrace = trace();
    const body = command({ organization_id: otherOrganizationId, idempotency_key: requestTrace.idempotency_key! });
    const commandWithClaim = { ...body, organization_id: otherOrganizationId };
    const invalid = await ingestQualityData(service(), await context(adminId), requestTrace, commandWithClaim);
    expect(invalid.status).toBe("invalid_request");

    const write = await transactions.runInTransaction(requestTrace, (transaction) => repository.persistIngestion(transaction, {
      organization_id: otherOrganizationId,
      membership_id: adminMembershipId,
      uploader_user_id: adminId,
      request_id: requestTrace.request_id,
      correlation_id: requestTrace.correlation_id,
      idempotency_key: requestTrace.idempotency_key!,
      request_fingerprint: "a".repeat(64),
      command: body,
      validation_outcomes: [],
      now: NOW.toISOString(),
      create_uuid: randomUUID,
    }));
    expect(write.status).toBe("unauthorized");
  });

  it("rolls back every material row if the same-transaction audit append fails", async () => {
    const requestTrace = trace();
    const body = command({ organization_id: organizationId, idempotency_key: requestTrace.idempotency_key! });
    const failingAudit = {
      appendEvent: vi.fn().mockRejectedValue(new Error("synthetic audit failure")),
    } as unknown as SupabaseAuditRepository;
    await expect(ingestQualityData(service(failingAudit), await context(adminId), requestTrace, body))
      .rejects.toMatchObject({ reason_code: "PERSISTENCE_FAILED" });
    const rows = await sql<{ sources: number; jobs: number; datasets: number }[]>`
      select
        (select count(*)::int from public.quality_data_sources where organization_id = ${organizationId}::uuid and source_key = ${body.source.source_key}) as sources,
        (select count(*)::int from public.quality_data_ingestion_jobs where organization_id = ${organizationId}::uuid and idempotency_key = ${requestTrace.idempotency_key!}) as jobs,
        (select count(*)::int from public.quality_data_datasets where organization_id = ${organizationId}::uuid and dataset_key = ${body.dataset.dataset_key}) as datasets
    `;
    expect(rows[0]).toEqual({ sources: 0, jobs: 0, datasets: 0 });
  });

  it("enforces database immutability, cross-version foreign keys, RLS and least-privilege grants", async () => {
    const requestTrace = trace();
    const result = await ingestQualityData(service(), await context(adminId), requestTrace,
      command({ organization_id: organizationId, idempotency_key: requestTrace.idempotency_key! }));
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    await expect(sql`
      update public.quality_data_dataset_versions set review_state = 'verified'
      where dataset_version_id = ${result.receipt.dataset_version_id}::uuid
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      update public.quality_data_source_versions set parser_version = 'tampered'
      where source_version_id = ${result.receipt.source_version_id}::uuid
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      update public.quality_data_inspection_fields set original_value = '"tampered"'::jsonb
      where organization_id = ${organizationId}::uuid
        and dataset_version_id = ${result.receipt.dataset_version_id}::uuid
        and field_ordinal = 1
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      update public.quality_data_ingestion_jobs
      set dataset_version_id = ${randomUUID()}::uuid,
        status = 'failed', record_version = record_version + 1,
        updated_at = greatest(updated_at, clock_timestamp())
      where ingestion_job_id = ${result.receipt.ingestion_job_id}::uuid
    `).rejects.toMatchObject({ code: "55000" });
    await expect(sql`
      insert into public.quality_data_inspection_records (
        organization_id, dataset_version_id, record_ordinal, source_worksheet, source_row_number
      ) values (${organizationId}::uuid, ${randomUUID()}::uuid, 1, 'Bad', 1)
    `).rejects.toMatchObject({ code: "23503" });

    const privileges = await sql<{
      authenticated_insert: boolean;
      anon_insert: boolean;
      authenticated_job_update: boolean;
      service_job_update: boolean;
      service_delete: boolean;
      public_access: boolean;
      rls: boolean;
      force_rls: boolean;
    }[]>`
      select
        has_table_privilege('authenticated', 'public.quality_data_sources', 'INSERT') as authenticated_insert,
        has_table_privilege('anon', 'public.quality_data_sources', 'INSERT') as anon_insert,
        has_table_privilege('authenticated', 'public.quality_data_ingestion_jobs', 'UPDATE') as authenticated_job_update,
        has_table_privilege('service_role', 'public.quality_data_ingestion_jobs', 'UPDATE') as service_job_update,
        has_table_privilege('service_role', 'public.quality_data_sources', 'DELETE') as service_delete,
        exists (
          select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl
          where acl.grantee = 0
        ) as public_access,
        c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
      from pg_class c where c.oid = 'public.quality_data_sources'::regclass
    `;
    expect(privileges[0]).toEqual({
      authenticated_insert: false, anon_insert: false,
      authenticated_job_update: false, service_job_update: true,
      service_delete: false, public_access: false,
      rls: true, force_rls: true,
    });

    const personalLinks = await sql<{ count: number }[]>`
      select count(*)::int as count from information_schema.columns
      where table_schema = 'public' and table_name like 'quality_data_%'
        and column_name in ('personal_document_id', 'chat_document_id', 'documents_id')
    `;
    expect(personalLinks[0]?.count).toBe(0);

    const adminVisible = await directQualityDataCounts(adminId);
    expect(Object.values(adminVisible).every((count) => count > 0)).toBe(true);
    for (const userId of [ownerId, contributorId, inactiveAdminId, otherMemberId, randomUUID()]) {
      const invisible = await directQualityDataCounts(userId);
      expect(Object.values(invisible).every((count) => count === 0)).toBe(true);
    }

    for (const userId of [ownerId, contributorId]) {
      await expect(readQualityDatasetVersion(service(), await context(userId), result.receipt.dataset_version_id))
        .resolves.toEqual({ status: "not_found_or_not_authorized" });
    }
    await expect(readQualityDatasetVersion(service(), await context(otherMemberId), result.receipt.dataset_version_id))
      .resolves.toEqual({ status: "not_found_or_not_authorized" });

    const forgedOrganizationContext = await context(adminId);
    (forgedOrganizationContext.tenant as { organization_id: string }).organization_id = otherOrganizationId;
    await expect(readQualityDatasetVersion(service(), forgedOrganizationContext, result.receipt.dataset_version_id))
      .resolves.toEqual({ status: "not_found_or_not_authorized" });

    const policies = await sql<{ table_name: string; using_expression: string }[]>`
      select tablename as table_name, qual as using_expression
      from pg_policies
      where schemaname = 'public' and tablename like 'quality_data_%'
      order by tablename
    `;
    expect(policies).toHaveLength(9);
    expect(policies.every((policy) => policy.using_expression.includes("quality_data_can_read"))).toBe(true);

    const tablePrivileges = await sql<{
      table_name: string;
      authenticated_select: boolean;
      anon_select: boolean;
      service_select: boolean;
      rls: boolean;
      force_rls: boolean;
    }[]>`
      select c.relname as table_name,
        has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
        has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
        has_table_privilege('service_role', c.oid, 'SELECT') as service_select,
        c.relrowsecurity as rls,
        c.relforcerowsecurity as force_rls
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any(array[
          'quality_data_sources',
          'quality_data_source_versions',
          'quality_data_datasets',
          'quality_data_dataset_versions',
          'quality_data_dataset_version_sources',
          'quality_data_ingestion_jobs',
          'quality_data_inspection_records',
          'quality_data_inspection_fields',
          'quality_data_validation_outcomes'
        ])
        and c.relkind = 'r'
      order by c.relname
    `;
    expect(tablePrivileges).toHaveLength(9);
    expect(tablePrivileges.every((table) =>
      table.authenticated_select && !table.anon_select && table.service_select && table.rls && table.force_rls
    )).toBe(true);

    const functionPrivileges = await sql<{
      authenticated_execute: boolean;
      anon_execute: boolean;
      service_execute: boolean;
      public_execute: boolean;
    }[]>`
      select
        has_function_privilege('authenticated', 'private.quality_data_can_read(uuid)', 'EXECUTE') as authenticated_execute,
        has_function_privilege('anon', 'private.quality_data_can_read(uuid)', 'EXECUTE') as anon_execute,
        has_function_privilege('service_role', 'private.quality_data_can_read(uuid)', 'EXECUTE') as service_execute,
        exists (
          select 1 from pg_proc as function
          cross join lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) as acl
          where function.oid = 'private.quality_data_can_read(uuid)'::regprocedure
            and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        ) as public_execute
    `;
    expect(functionPrivileges[0]).toEqual({
      authenticated_execute: true,
      anon_execute: false,
      service_execute: false,
      public_execute: false,
    });

    await sql`update public.capa_roles set permissions = array_remove(permissions, 'quality_data.source.read') where role_id = 'CAPA_ORG_ADMIN'`;
    try {
      await expect(readQualityDatasetVersion(service(), await context(adminId), result.receipt.dataset_version_id))
        .resolves.toEqual({ status: "not_found_or_not_authorized" });
      const adminWithoutRead = await directQualityDataCounts(adminId);
      expect(Object.values(adminWithoutRead).every((count) => count === 0)).toBe(true);
      await expect(repository.findDatasetVersion({
        organization_id: organizationId,
        user_id: adminId,
        membership_id: adminMembershipId,
        now: NOW.toISOString(),
      }, result.receipt.dataset_version_id)).resolves.toBeNull();

      const ingestionTrace = trace();
      const ingestionWithoutRead = await ingestQualityData(
        service(), await context(adminId), ingestionTrace,
        command({ organization_id: organizationId, idempotency_key: ingestionTrace.idempotency_key! }),
      );
      expect(ingestionWithoutRead.status).toBe("accepted");
    } finally {
      await sql`update public.capa_roles set permissions = array_append(permissions, 'quality_data.source.read') where role_id = 'CAPA_ORG_ADMIN'`;
    }

    await sql`update public.capa_roles set permissions = array_remove(permissions, 'quality_data.source.ingest') where role_id = 'CAPA_ORG_ADMIN'`;
    try {
      const requestTrace = trace();
      await expect(ingestQualityData(
        service(), await context(adminId), requestTrace,
        command({ organization_id: organizationId, idempotency_key: requestTrace.idempotency_key! }),
      )).resolves.toMatchObject({ status: "denied", reason_code: "QUALITY_DATA_PERMISSION_DENIED" });
    } finally {
      await sql`update public.capa_roles set permissions = array_append(permissions, 'quality_data.source.ingest') where role_id = 'CAPA_ORG_ADMIN'`;
    }
  });
});
