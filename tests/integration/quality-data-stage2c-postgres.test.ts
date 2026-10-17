import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SupabaseCapaAuthorizationPolicy } from "../../lib/capa/authorization/supabase-capa-authorization-policy";
import { SupabaseAuditRepository } from "../../lib/database/supabase/supabase-audit-repository";
import { SupabaseQualityDataRepository } from "../../lib/database/supabase/supabase-quality-data-repository";
import { SupabaseTransactionManager } from "../../lib/database/supabase/supabase-transactions";
import { PolicyBackedQualityDataIngestionAuthorizer } from "../../lib/quality-data/quality-data-authorization";
import { parseQualityDataPilotGate } from "../../lib/quality-data/quality-data-pilot-gate";
import { handleQualityDataXlsxEligibilityGet, handleQualityDataXlsxPost, InMemoryQualityDataXlsxApiRateLimiter, type QualityDataXlsxApiDependencies } from "../../lib/quality-data/quality-data-xlsx-api";
import type { QualityDataXlsxIngestionDependencies } from "../../lib/quality-data/xlsx-quality-data-ingestion";
import { QUALITY_DATA_XLSX_MEDIA_TYPE } from "../../lib/quality-data/xlsx-quality-data-parser";
import { SupabaseCapaDurableContextResolver } from "../../lib/security/supabase-capa-durable-context";
import type { SupabaseCapaSessionFacts } from "../../lib/security/supabase-capa-context";

const ENABLED = process.env.QUALITY_DATA_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.QUALITY_DATA_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57381/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;
const NOW = new Date("2026-10-17T12:00:00.000Z");

function requireDisposableLoopbackDatabase(connectionString: string): void {
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("Stage 2C PostgreSQL qualification requires a local disposable database URL."); }
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && parsed.port === "57381" && parsed.pathname === "/postgres")) {
    throw new Error("Stage 2C PostgreSQL qualification is restricted to the disposable loopback database on port 57381.");
  }
}

function facts(userId: string): SupabaseCapaSessionFacts {
  return {
    verified_user_id: userId,
    authenticated_at: "2026-10-17T11:00:00.000Z",
    expires_at_epoch_seconds: Date.parse("2026-10-17T14:00:00.000Z") / 1000,
    verified_aal: "aal1",
  };
}

function makeWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Final Inspection");
  worksheet.addRow(["Lot", "Rejects", "Inspection Date"]);
  worksheet.addRow(["LOT-STAGE2C-001", 2, new Date("2026-10-16T00:00:00.000Z")]);
  return workbook.xlsx.writeBuffer().then((bytes) => new Uint8Array(bytes));
}

const MAPPING = {
  worksheet_name: "Final Inspection",
  header_row: 1,
  columns: [
    { header: "Lot", field_key: "lot_number", value_type: "text", required: true },
    { header: "Rejects", field_key: "reject_count", value_type: "number", required: true },
    { header: "Inspection Date", field_key: "inspection_date", value_type: "date", required: true },
  ],
  ignored_headers: [],
};

function form(bytes: Uint8Array, extra: Readonly<Record<string, string>> = {}): FormData {
  const data = new FormData();
  data.append("file", new File([Buffer.from(bytes)], "synthetic-inspection.xlsx", { type: QUALITY_DATA_XLSX_MEDIA_TYPE }));
  data.append("mapping", JSON.stringify(MAPPING));
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  return data;
}

describeDatabase("Stage 2C quality-data API through real PostgreSQL services (disposable loopback DB only)", () => {
  let sql: postgres.Sql;
  let organizationId: string;
  let adminId: string;
  let contributorId: string;
  let adminMembershipId: string;
  let contributorMembershipId: string;
  let storageBytes: Uint8Array | null;
  let dependencies: QualityDataXlsxApiDependencies;
  let ingestionDependencies: QualityDataXlsxIngestionDependencies;

  async function insertOrganization(): Promise<void> {
    await sql`
      insert into public.capa_organizations (
        organization_id, organization_name, authorization_policy_version,
        created_at, effective_at, updated_at,
        created_by_actor_type, created_by_actor_id,
        updated_by_actor_type, updated_by_actor_id
      ) values (
        ${organizationId}::uuid, 'Synthetic Stage 2C Organization', 'authorization-policy-1.0.0',
        ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
        ${NOW.toISOString()}::timestamptz, 'system', 'stage2c-test', 'system', 'stage2c-test'
      )
    `;
  }

  async function insertMember(userId: string, membershipId: string, role: string): Promise<void> {
    await sql`
      insert into public.capa_organization_memberships (
        membership_id, organization_id, user_id, status,
        effective_at, created_at, updated_at,
        created_by_actor_type, created_by_actor_id,
        updated_by_actor_type, updated_by_actor_id
      ) values (
        ${membershipId}::uuid, ${organizationId}::uuid, ${userId}::uuid, 'active',
        ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
        ${NOW.toISOString()}::timestamptz, 'system', 'stage2c-test', 'system', 'stage2c-test'
      )
    `;
    await sql`
      insert into public.capa_role_assignments (
        organization_id, membership_id, user_id, role_id, scope_code, status,
        effective_at, created_at, updated_at,
        granted_by_actor_type, granted_by_actor_id, grant_reason
      ) values (
        ${organizationId}::uuid, ${membershipId}::uuid, ${userId}::uuid,
        ${role}, 'ORGANIZATION', 'active', ${NOW.toISOString()}::timestamptz,
        ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
        'system', 'stage2c-test', 'Synthetic PostgreSQL qualification fixture'
      )
    `;
  }

  function apiDependencies(userId: string | null): QualityDataXlsxApiDependencies {
    const contextResolver = new SupabaseCapaDurableContextResolver(sql);
    return {
      get_session_facts: async () => userId === null ? null : facts(userId),
      resolve_context: contextResolver.resolve,
      get_ingestion_dependencies: () => ingestionDependencies,
      now: () => new Date(NOW),
      generate_uuid: randomUUID,
      configured_app_url: "http://127.0.0.1:57381",
      pilot_gate: parseQualityDataPilotGate("true", organizationId),
      rate_limiter: new InMemoryQualityDataXlsxApiRateLimiter(),
    };
  }

  beforeAll(async () => {
    requireDisposableLoopbackDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 8 });
    await sql`select 1`;
    organizationId = randomUUID();
    adminId = randomUUID();
    contributorId = randomUUID();
    adminMembershipId = randomUUID();
    contributorMembershipId = randomUUID();
    await insertOrganization();
    await insertMember(adminId, adminMembershipId, "CAPA_ORG_ADMIN");
    await insertMember(contributorId, contributorMembershipId, "CAPA_CONTRIBUTOR");

    const repository = new SupabaseQualityDataRepository(sql);
    const audit = new SupabaseAuditRepository(sql);
    const policy = new SupabaseCapaAuthorizationPolicy(sql, {
      step_up_maximum_age_ms: 5 * 60_000,
      required_step_up_assurance: "MULTI_FACTOR" as never,
    });
    const sourceStorage = {
      async storeOriginal(input: { organization_id: string; source_key: string; original_source_version: string; bytes: Uint8Array; sha256: string; media_type: string }) {
        storageBytes = new Uint8Array(input.bytes);
        return {
          status: "stored" as const,
          storage_reference: `quality-data/${input.organization_id}/${createHash("sha256").update(input.source_key).digest("hex")}/${createHash("sha256").update(input.original_source_version).digest("hex")}/original`,
        };
      },
    };
    ingestionDependencies = {
      repository,
      audit_repository: audit,
      transaction_manager: new SupabaseTransactionManager(sql),
      authorizer: new PolicyBackedQualityDataIngestionAuthorizer(policy),
      ids: { event_id: () => randomUUID() as never, uuid: randomUUID },
      clock: { now: () => new Date(NOW) },
      source_storage: sourceStorage,
    };
    storageBytes = null;
    dependencies = apiDependencies(adminId);
  });

  afterAll(async () => { if (sql) await sql.end(); });

  it("authenticates and authorizes an explicit workbook mapping through API, parser, repository, transaction and audit", async () => {
    const eligible = await handleQualityDataXlsxEligibilityGet(dependencies);
    expect(await eligible.json()).toEqual({ can_ingest: true });

    const bytes = await makeWorkbook();
    const idempotencyKey = `stage2c-${randomUUID()}`;
    const data = form(bytes, {
      dataset_key: `dataset-${randomUUID()}`,
      dataset_name: "Synthetic Final Inspection",
      source_key: `source-${randomUUID()}`,
    });
    const request = new Request("http://127.0.0.1:57381/api/quality-data/xlsx?action=ingest", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:57381", "idempotency-key": idempotencyKey },
      body: data,
    });
    const response = await handleQualityDataXlsxPost(request, dependencies);
    const body = await response.json() as { status: string; diagnostics?: readonly { code: string }[]; receipt: { dataset_version_id: string; record_count: number; field_count: number }; source: { sha256: string; original_source_version: string }; review_state: string };
    expect(response.status, JSON.stringify({ diagnostics: body.diagnostics ?? body, stored_bytes: storageBytes?.byteLength ?? null })).toBe(201);
    expect(body).toMatchObject({ status: "accepted", receipt: { record_count: 1, field_count: 3 }, review_state: "review_required" });
    expect(storageBytes).toEqual(bytes);

    const persisted = await ingestionDependencies.repository.findDatasetVersion({
      organization_id: organizationId,
      user_id: adminId,
      membership_id: adminMembershipId,
      now: NOW.toISOString(),
    }, body.receipt.dataset_version_id);
    expect(persisted).not.toBeNull();
    expect(persisted?.version.review_state).toBe("review_required");
    expect(persisted?.source_versions[0]?.source_sha256).toBe(body.source.sha256);
    const record = persisted?.records[0] as { source_worksheet: string; fields: readonly { source_cell_reference: string }[] } | undefined;
    expect(record?.source_worksheet).toBe("Final Inspection");
    expect(record?.fields.map((field) => field.source_cell_reference)).toEqual(["A2", "B2", "C2"]);
    expect(body.source.original_source_version).toBe(body.source.sha256);

    const auditRows = await sql<{ count: number }[]>`
      select count(*)::int as count from public.capa_audit_events
      where organization_id = ${organizationId}::uuid and idempotency_key = ${idempotencyKey}
    `;
    expect(auditRows[0]?.count).toBe(1);
  });

  it("denies a real active non-admin member at the API boundary without writing a source or job", async () => {
    const bytes = await makeWorkbook();
    const dependenciesForContributor = apiDependencies(contributorId);
    const before = await sql<{ sources: number; jobs: number }[]>`
      select
        (select count(*)::int from public.quality_data_sources where organization_id = ${organizationId}::uuid) as sources,
        (select count(*)::int from public.quality_data_ingestion_jobs where organization_id = ${organizationId}::uuid) as jobs
    `;
    const response = await handleQualityDataXlsxPost(new Request("http://127.0.0.1:57381/api/quality-data/xlsx?action=ingest", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:57381", "idempotency-key": `denied-${randomUUID()}` },
      body: form(bytes, { dataset_key: `denied-${randomUUID()}`, dataset_name: "Denied", source_key: `denied-${randomUUID()}` }),
    }), dependenciesForContributor);
    expect(response.status).toBe(403);
    const beforeCounts = before[0];
    expect(beforeCounts).toBeDefined();
    const after = await sql<{ sources: number; jobs: number }[]>`
      select
        (select count(*)::int from public.quality_data_sources where organization_id = ${organizationId}::uuid) as sources,
        (select count(*)::int from public.quality_data_ingestion_jobs where organization_id = ${organizationId}::uuid) as jobs
    `;
    expect(after[0]).toEqual(beforeCounts);
  });

  it("rejects client-supplied tenant scope and replays an identical request idempotently", async () => {
    const bytes = await makeWorkbook();
    const forged = form(bytes, { organization_id: randomUUID() });
    const forgedResponse = await handleQualityDataXlsxPost(new Request("http://127.0.0.1:57381/api/quality-data/xlsx?action=preview", {
      method: "POST", headers: { origin: "http://127.0.0.1:57381" }, body: forged,
    }), dependencies);
    expect(forgedResponse.status).toBe(400);

    const idempotencyKey = `replay-${randomUUID()}`;
    const extra = { dataset_key: `replay-${randomUUID()}`, dataset_name: "Replay fixture", source_key: `replay-${randomUUID()}` };
    const send = () => handleQualityDataXlsxPost(new Request("http://127.0.0.1:57381/api/quality-data/xlsx?action=ingest", {
      method: "POST", headers: { origin: "http://127.0.0.1:57381", "idempotency-key": idempotencyKey }, body: form(bytes, extra),
    }), dependencies);
    const first = await send();
    const firstBody = await first.json() as { status: string; diagnostics?: readonly { code: string }[] };
    expect(first.status, JSON.stringify({ diagnostics: firstBody.diagnostics ?? firstBody, stored_bytes: storageBytes?.byteLength ?? null })).toBe(201);
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ status: "already_registered" });
    const counts = await sql<{ jobs: number; audits: number }[]>`
      select
        (select count(*)::int from public.quality_data_ingestion_jobs where organization_id = ${organizationId}::uuid and idempotency_key = ${idempotencyKey}) as jobs,
        (select count(*)::int from public.capa_audit_events where organization_id = ${organizationId}::uuid and idempotency_key = ${idempotencyKey}) as audits
    `;
    expect(counts[0]).toEqual({ jobs: 1, audits: 1 });
  });
});
