import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseCapaAuthorizationPolicy } from "../../lib/capa/authorization/supabase-capa-authorization-policy";
import { SupabaseAuditRepository } from "../../lib/database/supabase/supabase-audit-repository";
import { SupabaseQualityDataRepository } from "../../lib/database/supabase/supabase-quality-data-repository";
import { SupabaseQualityDataStage3ARepository } from "../../lib/database/supabase/supabase-quality-data-stage3a-repository";
import { SupabaseTransactionManager } from "../../lib/database/supabase/supabase-transactions";
import { PolicyBackedQualityDataIngestionAuthorizer } from "../../lib/quality-data/quality-data-authorization";
import { analyzeQualityDatasetVersion, detectQualityDatasetSignals, getQualityDataDatasetVersionApproval, transitionQualityDataDatasetVersionApproval, type QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";
import { ingestQualityData } from "../../lib/quality-data/quality-data-service";
import { SupabaseCapaDurableContextResolver } from "../../lib/security/supabase-capa-durable-context";
import type { SupabaseCapaSessionFacts } from "../../lib/security/supabase-capa-context";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";

const ENABLED = process.env.QUALITY_DATA_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.QUALITY_DATA_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57381/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;
const NOW = new Date(Date.now() - 60_000);

function requireDisposableLoopbackDatabase(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Stage 3A integration requires a disposable loopback database."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.port !== "57381" || url.pathname !== "/postgres") {
    throw new Error("Stage 3A integration is restricted to the disposable loopback database on port 57381.");
  }
}

function facts(userId: string): SupabaseCapaSessionFacts {
  return {
    verified_user_id: userId,
    authenticated_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
    expires_at_epoch_seconds: (NOW.getTime() + 60 * 60_000) / 1000,
  };
}

function trace(key = randomUUID()): RequestTrace {
  return { request_id: randomUUID() as never, correlation_id: randomUUID() as never, idempotency_key: key as never };
}

describeDatabase("Stage 3A PostgreSQL approval and analytical retrieval (disposable local DB only)", () => {
  let sql: postgres.Sql;
  let org: string;
  let otherOrg: string;
  let admin: string;
  let owner: string;
  let otherAdmin: string;
  let adminMembership: string;
  let ownerMembership: string;
  let otherAdminMembership: string;
  let authorization: PolicyBackedQualityDataIngestionAuthorizer;
  let service: QualityDataStage3AServiceDependencies;
  let resolver: SupabaseCapaDurableContextResolver;

  async function insertOrg(id: string, name: string): Promise<void> {
    await sql`insert into public.capa_organizations (
      organization_id, organization_name, authorization_policy_version, created_at, effective_at, updated_at,
      created_by_actor_type, created_by_actor_id, updated_by_actor_type, updated_by_actor_id
    ) values (
      ${id}::uuid, ${name}, 'authorization-policy-1.0.0', ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
      ${NOW.toISOString()}::timestamptz, 'system', 'stage3a-test', 'system', 'stage3a-test'
    )`;
  }

  async function insertMember(orgId: string, userId: string, membershipId: string, role: string): Promise<void> {
    await sql`insert into public.capa_organization_memberships (
      membership_id, organization_id, user_id, status, effective_at, created_at, updated_at,
      created_by_actor_type, created_by_actor_id, updated_by_actor_type, updated_by_actor_id
    ) values (${membershipId}::uuid, ${orgId}::uuid, ${userId}::uuid, 'active', ${NOW.toISOString()}::timestamptz,
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, 'system', 'stage3a-test', 'system', 'stage3a-test')`;
    await sql`insert into public.capa_role_assignments (
      organization_id, membership_id, user_id, role_id, scope_code, status, effective_at, created_at, updated_at,
      granted_by_actor_type, granted_by_actor_id, grant_reason
    ) values (${orgId}::uuid, ${membershipId}::uuid, ${userId}::uuid, ${role}, 'ORGANIZATION', 'active',
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
      'system', 'stage3a-test', 'Synthetic Stage 3A qualification')`;
  }

  async function context(userId: string) {
    return resolver.resolve(facts(userId), NOW);
  }

  async function createVersion(withSignalFields = false): Promise<string> {
    const request = trace();
    const bytes = new TextEncoder().encode("synthetic manufacturing inspection rows");
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const command = {
      idempotency_key: request.idempotency_key,
      source: {
        source_key: "src-" + randomUUID(), source_name: "synthetic.csv", source_type: "csv",
        original_source_version: "fixture-1", source_sha256: createHash("sha256").update(bytes).digest("hex"),
        source_bytes: bytes, media_type: "text/csv",
        storage_reference: "quality-data/" + org + "/" + sourceId + "/" + sourceVersionId + "/original",
        parser_version: "stage3a-fixture-1.0.0", schema_version: "inspection-1.0.0",
      },
      dataset: { dataset_key: "ds-" + randomUUID(), dataset_name: "Synthetic dataset", schema_version: "inspection-1.0.0" },
      records: withSignalFields ? [
        { source_worksheet: "Inspection", source_row_number: 2, fields: [
          { field_key: "defect_count", value_type: "number", original_value: 2, normalized_value: 2, normalized_unit: "count", source_cell_reference: "B2" },
          { field_key: "production_quantity", value_type: "number", original_value: 100, normalized_value: 100, normalized_unit: "unit", source_cell_reference: "C2" },
          { field_key: "observation_date", value_type: "date", original_value: "2026-01-03", normalized_value: "2026-01-03", source_cell_reference: "D2" },
          { field_key: "failure_mode", value_type: "text", original_value: "seal_leak", normalized_value: "seal_leak", source_cell_reference: "E2" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 3, fields: [
          { field_key: "defect_count", value_type: "number", original_value: 1, normalized_value: 1, normalized_unit: "count", source_cell_reference: "B3" },
          { field_key: "production_quantity", value_type: "number", original_value: 100, normalized_value: 100, normalized_unit: "unit", source_cell_reference: "C3" },
          { field_key: "observation_date", value_type: "date", original_value: "2026-01-10", normalized_value: "2026-01-10", source_cell_reference: "D3" },
          { field_key: "failure_mode", value_type: "text", original_value: "seal_leak", normalized_value: "seal_leak", source_cell_reference: "E3" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 4, fields: [
          { field_key: "defect_count", value_type: "number", original_value: 1, normalized_value: 1, normalized_unit: "count", source_cell_reference: "B4" },
          { field_key: "production_quantity", value_type: "number", original_value: 100, normalized_value: 100, normalized_unit: "unit", source_cell_reference: "C4" },
          { field_key: "observation_date", value_type: "date", original_value: "2026-01-17", normalized_value: "2026-01-17", source_cell_reference: "D4" },
          { field_key: "failure_mode", value_type: "text", original_value: "crack", normalized_value: "crack", source_cell_reference: "E4" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 5, fields: [
          { field_key: "defect_count", value_type: "number", original_value: 5, normalized_value: 5, normalized_unit: "count", source_cell_reference: "B5" },
          { field_key: "production_quantity", value_type: "number", original_value: 100, normalized_value: 100, normalized_unit: "unit", source_cell_reference: "C5" },
          { field_key: "observation_date", value_type: "date", original_value: "2026-02-02", normalized_value: "2026-02-02", source_cell_reference: "D5" },
          { field_key: "failure_mode", value_type: "text", original_value: "seal_leak", normalized_value: "seal_leak", source_cell_reference: "E5" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 6, fields: [
          { field_key: "defect_count", value_type: "number", original_value: 4, normalized_value: 4, normalized_unit: "count", source_cell_reference: "B6" },
          { field_key: "production_quantity", value_type: "number", original_value: 100, normalized_value: 100, normalized_unit: "unit", source_cell_reference: "C6" },
          { field_key: "observation_date", value_type: "date", original_value: "2026-02-09", normalized_value: "2026-02-09", source_cell_reference: "D6" },
          { field_key: "failure_mode", value_type: "text", original_value: "dent", normalized_value: "dent", source_cell_reference: "E6" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 7, fields: [
          { field_key: "defect_count", value_type: "number", original_value: 3, normalized_value: 3, normalized_unit: "count", source_cell_reference: "B7" },
          { field_key: "production_quantity", value_type: "number", original_value: 100, normalized_value: 100, normalized_unit: "unit", source_cell_reference: "C7" },
          { field_key: "observation_date", value_type: "date", original_value: "2026-02-16", normalized_value: "2026-02-16", source_cell_reference: "D7" },
          { field_key: "failure_mode", value_type: "text", original_value: "dent", normalized_value: "dent", source_cell_reference: "E7" },
        ] },
      ] : [
        { source_worksheet: "Inspection", source_row_number: 2, fields: [
          { field_key: "reject_count", value_type: "number", original_value: 2, normalized_value: 2, normalized_unit: "count", source_cell_reference: "B2" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 3, fields: [
          { field_key: "reject_count", value_type: "number", original_value: 4, normalized_value: 4, normalized_unit: "count", source_cell_reference: "B3" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 4, fields: [
          { field_key: "lot", value_type: "text", original_value: "LOT-3", normalized_value: "LOT-3", source_cell_reference: "A4" },
        ] },
      ],
    };
    const result = await ingestQualityData({
      repository: new SupabaseQualityDataRepository(sql), audit_repository: new SupabaseAuditRepository(sql),
      transaction_manager: new SupabaseTransactionManager(sql), authorizer: authorization,
      ids: { event_id: () => randomUUID() as never, uuid: randomUUID }, clock: { now: () => new Date(NOW) },
    }, await context(admin), request, command);
    if (result.status !== "accepted") throw new Error("Synthetic quality-data source setup failed.");
    return result.receipt.dataset_version_id;
  }

  async function change(versionId: string, decision: "approved" | "rejected" | "revoked", expected: number, key = randomUUID()) {
    return transitionQualityDataDatasetVersionApproval(service, await context(admin), trace(key), {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: versionId,
      decision, expected_transition_number: expected, rationale: "Synthetic " + decision + " rationale",
    });
  }

  beforeAll(async () => {
    requireDisposableLoopbackDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 8 });
    await sql`select 1`;
    org = randomUUID(); otherOrg = randomUUID(); admin = randomUUID(); owner = randomUUID(); otherAdmin = randomUUID();
    adminMembership = randomUUID(); ownerMembership = randomUUID(); otherAdminMembership = randomUUID();
    await insertOrg(org, "Synthetic Stage 3A"); await insertOrg(otherOrg, "Other Synthetic Stage 3A");
    await insertMember(org, admin, adminMembership, "CAPA_ORG_ADMIN");
    await insertMember(org, owner, ownerMembership, "CAPA_OWNER");
    await insertMember(otherOrg, otherAdmin, otherAdminMembership, "CAPA_ORG_ADMIN");
    resolver = new SupabaseCapaDurableContextResolver(sql);
    authorization = new PolicyBackedQualityDataIngestionAuthorizer(new SupabaseCapaAuthorizationPolicy(sql, {
      step_up_maximum_age_ms: 300_000, required_step_up_assurance: "MULTI_FACTOR" as never,
    }));
    service = {
      repository: new SupabaseQualityDataStage3ARepository(sql),
      audit_repository: new SupabaseAuditRepository(sql),
      transaction_manager: new SupabaseTransactionManager(sql),
      authorizer: authorization,
      ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID },
      clock: { now: () => new Date(NOW) },
    };
  });

  afterAll(async () => { if (sql) await sql.end(); });

  it("keeps approval permission distinct and granted only to CAPA_ORG_ADMIN", async () => {
    const roles = await sql<{ role_id: string; approval: boolean; read: boolean; ingest: boolean }[]>`
      select role_id, 'quality_data.version.approve' = any(permissions) as approval,
        'quality_data.source.read' = any(permissions) as read, 'quality_data.source.ingest' = any(permissions) as ingest
      from public.capa_roles
    `;
    expect(roles.find((row) => row.role_id === "CAPA_ORG_ADMIN")).toMatchObject({ approval: true, read: true, ingest: true });
    expect(roles.filter((row) => row.role_id !== "CAPA_ORG_ADMIN").every((row) => !row.approval)).toBe(true);
  });

  it("approves an exact version, preserves review_required, calculates deterministic metrics and binds source-cell provenance", async () => {
    const versionId = await createVersion();
    expect((await change(versionId, "approved", 0)).status).toBe("applied");
    const stored = await sql<{ review_state: string }[]>`select review_state from public.quality_data_dataset_versions where organization_id = ${org}::uuid and dataset_version_id = ${versionId}::uuid`;
    expect(stored[0]?.review_state).toBe("review_required");
    const result = await analyzeQualityDatasetVersion(service, await context(admin), {
      schema_version: "quality-analysis-request-1.0.0", dataset_version_id: versionId,
      time_window: { kind: "all_records_in_dataset_version" },
      metrics: [
        { metric_id: "completeness", kind: "field_completeness", field_key: "reject_count" },
        { metric_id: "mean", kind: "numeric_summary", field_key: "reject_count" },
      ],
    });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.result.metrics[0]).toMatchObject({ numerator_record_count: 2, denominator_record_count: 3, value: (2 / 3) * 100 });
    expect(result.result.metrics[1]).toMatchObject({ numerator_record_count: 2, denominator_record_count: 3, value: 3, minimum: 2, maximum: 4, unit: "count" });
    expect(result.result.metrics[1]?.calculation_inputs[0]).toMatchObject({ source_worksheet: "Inspection", source_row_number: 2, source_cell_reference: "B2", normalized_value: 2, source_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(result.result).toMatchObject({ authorization_scope: "analytical_use_only", source_verification: "not_asserted", advisory_interpretation: { status: "not_requested", content: null } });
  });

  it("records rejection and revocation transitions and denies analysis after either", async () => {
    const rejected = await createVersion();
    expect((await change(rejected, "rejected", 0)).status).toBe("applied");
    const request = { schema_version: "quality-analysis-request-1.0.0", dataset_version_id: rejected, time_window: { kind: "all_records_in_dataset_version" }, metrics: [{ metric_id: "m", kind: "numeric_summary", field_key: "reject_count" }] };
    await expect(analyzeQualityDatasetVersion(service, await context(admin), request)).resolves.toEqual({ status: "not_approved", decision: "rejected" });

    const revoked = await createVersion();
    expect((await change(revoked, "approved", 0)).status).toBe("applied");
    expect((await change(revoked, "revoked", 1)).status).toBe("applied");
    await expect(analyzeQualityDatasetVersion(service, await context(admin), { ...request, dataset_version_id: revoked })).resolves.toEqual({ status: "not_approved", decision: "revoked" });
    const events = await sql<{ decision: string; transition_number: number }[]>`
      select decision, transition_number from public.quality_data_dataset_version_approval_events
      where organization_id = ${org}::uuid and dataset_version_id = ${revoked}::uuid order by transition_number
    `;
    expect(events).toEqual([{ decision: "approved", transition_number: 1 }, { decision: "revoked", transition_number: 2 }]);
  });

  it("detects rate trends and recurring patterns from the real approved PostgreSQL snapshot and fails closed after revocation", async () => {
    const versionId = await createVersion(true);
    expect((await change(versionId, "approved", 0)).status).toBe("applied");
    const request = {
      schema_version: "quality-signal-request-1.0.0", dataset_version_id: versionId,
      signals: [
        { signal_id: "recurring-seal", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } },
        { signal_id: "monthly-trend", kind: "defect_rate_trend", defect_count_field_key: "defect_count", production_quantity_field_key: "production_quantity", observation_date_field_key: "observation_date", production_quantity_unit: "unit", rate_per: 100, direction: "increase", minimum_absolute_change: 1, minimum_records_per_window: 3, time_window: { kind: "calendar_month" } },
      ],
    };
    const result = await detectQualityDatasetSignals(service, await context(admin), request);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.result.signals[0]).toMatchObject({ status: "detected", observed_patterns: expect.arrayContaining([expect.objectContaining({ value: "seal_leak", occurrence_count: 3 })]) });
    expect(result.result.signals[1]).toMatchObject({
      status: "detected", rate_definition: { formula: "sum(defect_count) / sum(production_quantity) * rate_per" },
      comparisons: [expect.objectContaining({ from_period: "2026-01", to_period: "2026-02", triggered: true, calculation_inputs: expect.arrayContaining([expect.objectContaining({ cells: expect.arrayContaining([expect.objectContaining({ source_cell_reference: "B2" })]) })]) })],
    });
    await expect(detectQualityDatasetSignals(service, await context(owner), request)).resolves.toEqual({ status: "denied" });
    await expect(detectQualityDatasetSignals(service, await context(otherAdmin), request)).resolves.toEqual({ status: "not_found_or_not_authorized" });
    expect((await change(versionId, "revoked", 1)).status).toBe("applied");
    await expect(detectQualityDatasetSignals(service, await context(admin), request)).resolves.toEqual({ status: "not_approved", decision: "revoked" });
  });

  it("returns the exact current approval history only to a separately authorized approver", async () => {
    const versionId = await createVersion();
    expect((await change(versionId, "approved", 0)).status).toBe("applied");
    const current = await getQualityDataDatasetVersionApproval(service, await context(admin), versionId);
    expect(current).toMatchObject({
      status: "found",
      summary: { dataset_id: expect.any(String), dataset_version_id: versionId, current_decision: "approved", transition_number: 1,
        current_event: { decision: "approved", reviewer_user_id: admin, rationale: "Synthetic approved rationale" } },
    });
    await expect(getQualityDataDatasetVersionApproval(service, await context(owner), versionId)).resolves.toEqual({ status: "denied" });
    await expect(getQualityDataDatasetVersionApproval(service, await context(otherAdmin), versionId)).resolves.toEqual({ status: "not_found_or_not_authorized" });
  });

  it("keeps approval and read permissions independent and permits the authorized uploader-admin to approve", async () => {
    const versionId = await createVersion();
    const roles = await sql<{ permissions: string[] }[]>`select permissions from public.capa_roles where role_id = 'CAPA_ORG_ADMIN'`;
    const originalPermissions = roles[0]?.permissions;
    if (!originalPermissions) throw new Error("Synthetic CAPA_ORG_ADMIN role is missing.");
    try {
      await sql`update public.capa_roles set permissions = array_remove(permissions, 'quality_data.version.approve') where role_id = 'CAPA_ORG_ADMIN'`;
      const noApproval = await transitionQualityDataDatasetVersionApproval(service, await context(admin), trace(), {
        schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: versionId,
        decision: "approved", expected_transition_number: 0, rationale: "Approval requires its distinct permission",
      });
      expect(noApproval.status).toBe("denied");

      await sql`update public.capa_roles set permissions = ${originalPermissions}::text[] where role_id = 'CAPA_ORG_ADMIN'`;
      await sql`update public.capa_roles set permissions = array_remove(permissions, 'quality_data.source.read') where role_id = 'CAPA_ORG_ADMIN'`;
      const approved = await transitionQualityDataDatasetVersionApproval(service, await context(admin), trace(), {
        schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: versionId,
        decision: "approved", expected_transition_number: 0, rationale: "Approval does not imply source-read permission",
      });
      expect(approved.status).toBe("applied");
      await expect(analyzeQualityDatasetVersion(service, await context(admin), {
        schema_version: "quality-analysis-request-1.0.0", dataset_version_id: versionId,
        time_window: { kind: "all_records_in_dataset_version" }, metrics: [{ metric_id: "m", kind: "numeric_summary", field_key: "reject_count" }],
      })).resolves.toEqual({ status: "denied" });

      await sql`update public.capa_roles set permissions = ${originalPermissions}::text[] where role_id = 'CAPA_ORG_ADMIN'`;
      await sql`update public.capa_roles set permissions = array_remove(permissions, 'quality_data.version.approve') where role_id = 'CAPA_ORG_ADMIN'`;
      const readable = await analyzeQualityDatasetVersion(service, await context(admin), {
        schema_version: "quality-analysis-request-1.0.0", dataset_version_id: versionId,
        time_window: { kind: "all_records_in_dataset_version" }, metrics: [{ metric_id: "m", kind: "numeric_summary", field_key: "reject_count" }],
      });
      expect(readable.status).toBe("complete");
    } finally {
      await sql`update public.capa_roles set permissions = ${originalPermissions}::text[] where role_id = 'CAPA_ORG_ADMIN'`;
    }
  });

  it("replays an identical approval idempotently with one approval event and one audit event", async () => {
    const versionId = await createVersion();
    const key = randomUUID();
    const requestTrace = trace(key);
    const command = {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: versionId,
      decision: "approved" as const, expected_transition_number: 0, rationale: "Idempotent synthetic approval",
    };
    expect((await transitionQualityDataDatasetVersionApproval(service, await context(admin), requestTrace, command)).status).toBe("applied");
    expect((await transitionQualityDataDatasetVersionApproval(service, await context(admin), requestTrace, command)).status).toBe("already_recorded");
    const changedReplay = await transitionQualityDataDatasetVersionApproval(service, await context(admin), requestTrace, {
      ...command, rationale: "Changed content cannot reuse the original idempotency key",
    });
    expect(changedReplay).toMatchObject({ status: "conflict", reason_code: "IDEMPOTENCY_KEY_REUSED" });
    const counts = await sql<{ approval_count: number; audit_count: number }[]>`
      select
        (select count(*)::int from public.quality_data_dataset_version_approval_events where organization_id = ${org}::uuid and dataset_version_id = ${versionId}::uuid) as approval_count,
        (select count(*)::int from public.capa_audit_events where organization_id = ${org}::uuid and aggregate_id = ${versionId} and event_type = 'QUALITY_DATA_ANALYTICAL_APPROVAL_RECORDED') as audit_count
    `;
    expect(counts[0]).toEqual({ approval_count: 1, audit_count: 1 });
  });

  it("uses the existing shared database limiter for analytical and approval API actions", async () => {
    for (const action of ["analysis", "approval"] as const) {
      const userId = randomUUID();
      const consume = async () => sql.begin(async (transaction) => {
        await transaction`set local role service_role`;
        const rows = await transaction<{ allowed: boolean }[]>`
          select public.consume_quality_data_xlsx_api_rate_limit(${userId}::uuid, ${action}) as allowed
        `;
        return rows[0]?.allowed === true;
      });
      const results = await Promise.all(Array.from({ length: 14 }, () => consume()));
      expect(results.filter(Boolean), action).toHaveLength(12);
      expect(results.filter((allowed) => !allowed), action).toHaveLength(2);
      await sql`delete from public.quality_data_xlsx_api_rate_windows where user_id = ${userId}::uuid`;
    }
  });

  it("denies CAPA_OWNER approval and cross-organization analysis", async () => {
    const versionId = await createVersion();
    const ownerDecision = await transitionQualityDataDatasetVersionApproval(service, await context(owner), trace(), {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: versionId,
      decision: "approved", expected_transition_number: 0, rationale: "Owner must not inherit approval",
    });
    expect(ownerDecision.status).toBe("denied");
    const crossTenantApproval = await transitionQualityDataDatasetVersionApproval(service, await context(otherAdmin), trace(), {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: versionId,
      decision: "approved", expected_transition_number: 0, rationale: "Cross-organization approval must be denied",
    });
    expect(crossTenantApproval.status).toBe("not_found_or_not_authorized");
    const crossTenant = await analyzeQualityDatasetVersion(service, await context(otherAdmin), {
      schema_version: "quality-analysis-request-1.0.0", dataset_version_id: versionId,
      time_window: { kind: "all_records_in_dataset_version" }, metrics: [{ metric_id: "m", kind: "numeric_summary", field_key: "reject_count" }],
    });
    expect(crossTenant).toEqual({ status: "not_found_or_not_authorized" });
  });

  it("serializes concurrent approvals and makes event plus audit rollback atomic", async () => {
    const versionId = await createVersion();
    const results = await Promise.all([change(versionId, "approved", 0), change(versionId, "rejected", 0)]);
    expect(results.filter((result) => result.status === "applied")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);

    const rollbackVersion = await createVersion();
    const failingAudit: QualityDataStage3AServiceDependencies = {
      ...service,
      audit_repository: { appendEvent: async () => { throw new Error("synthetic audit interruption"); } } as never,
    };
    await expect(transitionQualityDataDatasetVersionApproval(failingAudit, await context(admin), trace(), {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: rollbackVersion,
      decision: "approved", expected_transition_number: 0, rationale: "Atomic audit rollback",
    })).rejects.toMatchObject({ reason_code: "PERSISTENCE_FAILED" });
    const rows = await sql<{ count: number }[]>`select count(*)::int as count from public.quality_data_dataset_version_approval_events where organization_id = ${org}::uuid and dataset_version_id = ${rollbackVersion}::uuid`;
    expect(rows[0]?.count).toBe(0);
  });

  it("enforces append-only history, RLS and least-privilege insert grants", async () => {
    const versionId = await createVersion();
    expect((await change(versionId, "approved", 0)).status).toBe("applied");
    const acl = await sql<{
      authenticated_insert: boolean; authenticated_select: boolean; authenticated_update: boolean;
      anon_select: boolean; service_insert: boolean; service_select: boolean; service_update: boolean;
      service_delete: boolean; force_rls: boolean;
    }[]>`
      select has_table_privilege('authenticated','public.quality_data_dataset_version_approval_events','INSERT') as authenticated_insert,
        has_table_privilege('authenticated','public.quality_data_dataset_version_approval_events','SELECT') as authenticated_select,
        has_table_privilege('authenticated','public.quality_data_dataset_version_approval_events','UPDATE') as authenticated_update,
        has_table_privilege('anon','public.quality_data_dataset_version_approval_events','SELECT') as anon_select,
        has_table_privilege('service_role','public.quality_data_dataset_version_approval_events','INSERT') as service_insert,
        has_table_privilege('service_role','public.quality_data_dataset_version_approval_events','SELECT') as service_select,
        has_table_privilege('service_role','public.quality_data_dataset_version_approval_events','UPDATE') as service_update,
        has_table_privilege('service_role','public.quality_data_dataset_version_approval_events','DELETE') as service_delete,
        (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.quality_data_dataset_version_approval_events'::regclass) as force_rls
    `;
    expect(acl[0]).toEqual({
      authenticated_insert: false, authenticated_select: true, authenticated_update: false, anon_select: false,
      service_insert: true, service_select: true, service_update: false, service_delete: false, force_rls: true,
    });
    const visible = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${admin}, true)`;
      return tx<{ count: number }[]>`select count(*)::int as count from public.quality_data_dataset_version_approval_events where dataset_version_id = ${versionId}::uuid`;
    });
    expect(visible[0]?.count).toBe(1);
    const crossTenantVisible = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${otherAdmin}, true)`;
      return tx<{ count: number }[]>`select count(*)::int as count from public.quality_data_dataset_version_approval_events where dataset_version_id = ${versionId}::uuid`;
    });
    expect(crossTenantVisible[0]?.count).toBe(0);
    await expect(sql`update public.quality_data_dataset_version_approval_events set rationale = 'tamper' where organization_id = ${org}::uuid and dataset_version_id = ${versionId}::uuid`).rejects.toBeDefined();
  });
});
