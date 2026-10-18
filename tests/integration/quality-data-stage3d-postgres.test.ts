import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SupabaseCapaAuthorizationPolicy } from "../../lib/capa/authorization/supabase-capa-authorization-policy";
import { SupabaseAuditRepository } from "../../lib/database/supabase/supabase-audit-repository";
import { SupabaseQualityDataRepository } from "../../lib/database/supabase/supabase-quality-data-repository";
import { SupabaseQualityDataStage3ARepository } from "../../lib/database/supabase/supabase-quality-data-stage3a-repository";
import { SupabaseQualityDataStage3DRepository } from "../../lib/database/supabase/supabase-quality-data-stage3d-repository";
import { SupabaseTransactionManager } from "../../lib/database/supabase/supabase-transactions";
import { PolicyBackedQualityDataIngestionAuthorizer } from "../../lib/quality-data/quality-data-authorization";
import { createQualityDataIntelligenceReport, getQualityDataIntelligenceReport, reviewQualityDataIntelligenceFinding, type QualityDataStage3DServiceDependencies } from "../../lib/quality-data/quality-data-stage3d-service";
import { transitionQualityDataExternalAiOptIn } from "../../lib/quality-data/quality-data-external-ai-opt-in-service";
import { ingestQualityData } from "../../lib/quality-data/quality-data-service";
import { transitionQualityDataDatasetVersionApproval, type QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";
import type { QualityEvidencePacket } from "../../lib/quality-data/quality-data-ai-contract";
import { SupabaseCapaDurableContextResolver } from "../../lib/security/supabase-capa-durable-context";
import type { SupabaseCapaSessionFacts } from "../../lib/security/supabase-capa-context";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";

const ENABLED = process.env.QUALITY_DATA_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.QUALITY_DATA_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57381/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;
const NOW = new Date(Date.now() - 60_000);

function requireDisposableLoopbackDatabase(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Stage 3D integration requires a disposable loopback database."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.port !== "57381" || url.pathname !== "/postgres") throw new Error("Stage 3D integration is restricted to the disposable PostgreSQL fixture on 127.0.0.1:57381.");
}
function facts(userId: string): SupabaseCapaSessionFacts {
  return { verified_user_id: userId, authenticated_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(), expires_at_epoch_seconds: (NOW.getTime() + 60 * 60_000) / 1000 };
}
function trace(key: string = randomUUID()): RequestTrace { return { request_id: randomUUID() as never, correlation_id: randomUUID() as never, idempotency_key: key as never }; }

describeDatabase("Stage 3D intelligence reports and human review (disposable local PostgreSQL; mocked AI)", () => {
  let sql: postgres.Sql;
  let organizationId: string; let secondOrganizationId: string;
  let adminId: string; let ownerId: string; let otherAdminId: string;
  let adminMembershipId: string; let ownerMembershipId: string; let otherAdminMembershipId: string;
  let resolver: SupabaseCapaDurableContextResolver;
  let authorizer: PolicyBackedQualityDataIngestionAuthorizer;
  let stage3a: QualityDataStage3AServiceDependencies;
  let service: QualityDataStage3DServiceDependencies;
  let versionId: string;
  let reportId: string;
  let modelCalls: (packet: QualityEvidencePacket) => Promise<{ readonly output_text: string; readonly usage: { readonly input_tokens: number; readonly output_tokens: number; readonly total_tokens: number } }>;
  const reportTrace = trace("stage3d-report-idempotency");
  const reportRequest = {
    schema_version: "quality-data-ai-analysis-request-1.0.0",
    dataset_version_id: "" as string,
    metrics: [{ metric_id: "reject-total", kind: "numeric_summary", field_key: "reject_count" }],
    signals: [{ signal_id: "recurring-defect", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }],
  };

  async function insertOrganization(id: string, name: string): Promise<void> {
    await sql`insert into public.capa_organizations (
      organization_id, organization_name, authorization_policy_version, created_at, effective_at, updated_at,
      created_by_actor_type, created_by_actor_id, updated_by_actor_type, updated_by_actor_id
    ) values (${id}::uuid, ${name}, 'authorization-policy-1.0.0', ${NOW.toISOString()}::timestamptz,
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, 'system', 'stage3d-test', 'system', 'stage3d-test')`;
  }
  async function insertMember(org: string, user: string, membership: string, role: string): Promise<void> {
    await sql`insert into public.capa_organization_memberships (
      membership_id, organization_id, user_id, status, effective_at, created_at, updated_at,
      created_by_actor_type, created_by_actor_id, updated_by_actor_type, updated_by_actor_id
    ) values (${membership}::uuid, ${org}::uuid, ${user}::uuid, 'active', ${NOW.toISOString()}::timestamptz,
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, 'system', 'stage3d-test', 'system', 'stage3d-test')`;
    await sql`insert into public.capa_role_assignments (
      organization_id, membership_id, user_id, role_id, scope_code, status, effective_at, created_at, updated_at,
      granted_by_actor_type, granted_by_actor_id, grant_reason
    ) values (${org}::uuid, ${membership}::uuid, ${user}::uuid, ${role}, 'ORGANIZATION', 'active',
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
      'system', 'stage3d-test', 'Synthetic Stage 3D qualification')`;
  }
  async function context(userId: string) { return resolver.resolve(facts(userId), NOW); }
  async function setupApprovedVersion(): Promise<string> {
    const request = trace();
    const bytes = new TextEncoder().encode("synthetic manufacturing quality records");
    const sourceId = randomUUID(); const sourceVersionId = randomUUID();
    const command = {
      idempotency_key: request.idempotency_key,
      source: {
        source_key: `stage3d-${randomUUID()}`, source_name: "synthetic-inspection.csv", source_type: "csv",
        original_source_version: "synthetic-v1", source_sha256: createHash("sha256").update(bytes).digest("hex"),
        source_bytes: bytes, media_type: "text/csv",
        storage_reference: `quality-data/${organizationId}/${sourceId}/${sourceVersionId}/original`,
        parser_version: "stage3d-fixture-1.0.0", schema_version: "inspection-v1.0.0",
      },
      dataset: { dataset_key: `stage3d-${randomUUID()}`, dataset_name: "Synthetic inspection set", schema_version: "inspection-v1.0.0" },
      records: [
        { source_worksheet: "Inspection", source_row_number: 2, fields: [
          { field_key: "reject_count", value_type: "number", original_value: 2, normalized_value: 2, normalized_unit: "count", source_cell_reference: "B2" },
          { field_key: "failure_mode", value_type: "text", original_value: "seal_gap", normalized_value: "seal_gap", source_cell_reference: "C2" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 3, fields: [
          { field_key: "reject_count", value_type: "number", original_value: 4, normalized_value: 4, normalized_unit: "count", source_cell_reference: "B3" },
          { field_key: "failure_mode", value_type: "text", original_value: "seal_gap", normalized_value: "seal_gap", source_cell_reference: "C3" },
        ] },
        { source_worksheet: "Inspection", source_row_number: 4, fields: [
          { field_key: "reject_count", value_type: "number", original_value: 1, normalized_value: 1, normalized_unit: "count", source_cell_reference: "B4" },
          { field_key: "failure_mode", value_type: "text", original_value: "seal_gap", normalized_value: "seal_gap", source_cell_reference: "C4" },
        ] },
      ],
    };
    const ingested = await ingestQualityData({
      repository: new SupabaseQualityDataRepository(sql), audit_repository: new SupabaseAuditRepository(sql),
      transaction_manager: new SupabaseTransactionManager(sql), authorizer,
      ids: { event_id: () => randomUUID() as never, uuid: randomUUID }, clock: { now: () => new Date(NOW) },
    }, await context(adminId), request, command);
    if (ingested.status !== "accepted") throw new Error("Synthetic Stage 3D dataset setup failed.");
    const approved = await transitionQualityDataDatasetVersionApproval(stage3a, await context(adminId), trace(), {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: ingested.receipt.dataset_version_id,
      decision: "approved", expected_transition_number: 0, rationale: "Synthetic approved for analytical use",
    });
    if (approved.status !== "applied") throw new Error("Synthetic Stage 3D version approval setup failed.");
    const optIn = await transitionQualityDataExternalAiOptIn(stage3a, await context(adminId), trace(), {
      schema_version: "quality-data-external-ai-opt-in-1.0.0", decision: "enabled", expected_transition_number: 0,
      rationale: "Synthetic fixture only; mocked model client",
    });
    if (optIn.status !== "applied") throw new Error("Synthetic Stage 3D external-AI opt-in setup failed.");
    return ingested.receipt.dataset_version_id;
  }

  beforeAll(async () => {
    requireDisposableLoopbackDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 8 });
    await sql`select 1`;
    organizationId = randomUUID(); secondOrganizationId = randomUUID();
    adminId = randomUUID(); ownerId = randomUUID(); otherAdminId = randomUUID();
    adminMembershipId = randomUUID(); ownerMembershipId = randomUUID(); otherAdminMembershipId = randomUUID();
    await insertOrganization(organizationId, "Synthetic Stage 3D");
    await insertOrganization(secondOrganizationId, "Other Synthetic Stage 3D");
    await insertMember(organizationId, adminId, adminMembershipId, "CAPA_ORG_ADMIN");
    await insertMember(organizationId, ownerId, ownerMembershipId, "CAPA_OWNER");
    await insertMember(secondOrganizationId, otherAdminId, otherAdminMembershipId, "CAPA_ORG_ADMIN");
    resolver = new SupabaseCapaDurableContextResolver(sql);
    authorizer = new PolicyBackedQualityDataIngestionAuthorizer(new SupabaseCapaAuthorizationPolicy(sql, {
      step_up_maximum_age_ms: 300_000, required_step_up_assurance: "MULTI_FACTOR" as never,
    }));
    stage3a = {
      repository: new SupabaseQualityDataStage3ARepository(sql), audit_repository: new SupabaseAuditRepository(sql),
      transaction_manager: new SupabaseTransactionManager(sql), authorizer, external_ai_transfer_authorizer: authorizer,
      ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID }, clock: { now: () => new Date(NOW) },
    };
    modelCalls = vi.fn(async (packet: QualityEvidencePacket) => {
      const handle = packet.calculations[0]?.evidence_handles[0];
      if (!handle) throw new Error("Synthetic provider packet lacked an evidence handle.");
      return {
        output_text: JSON.stringify({
          possible_causes: [{ text: "A setup condition may warrant review.", evidence_refs: [handle] }],
          uncertainty: [], human_investigation_steps: [], advisory_only: true, causal_proof: false, capa_decision: false,
        }),
        usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
      };
    });
    service = {
      quality_data: stage3a,
      model_client: { generate: modelCalls }, generate_handle: randomUUID, record_telemetry: async () => undefined,
      repository: new SupabaseQualityDataStage3DRepository(sql), audit_repository: new SupabaseAuditRepository(sql),
      transaction_manager: new SupabaseTransactionManager(sql), authorizer,
      ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID }, clock: { now: () => new Date(NOW) },
    };
    versionId = await setupApprovedVersion();
    reportRequest.dataset_version_id = versionId;
  });

  afterAll(async () => { if (sql) await sql.end({ timeout: 5 }); });

  it("runs real approved retrieval, deterministic metrics/signals and a mocked AI, then persists a replay-safe report", async () => {
    const first = await createQualityDataIntelligenceReport(service, await context(adminId), reportTrace, reportRequest);
    expect(first.status).toBe("complete");
    if (first.status !== "complete") return;
    reportId = first.report.report_id;
    expect(first.report).toMatchObject({ status: "complete", dataset_version_id: versionId, result: {
      authorization_scope: "analytical_use_only", interpretation_status: "unverified_advisory_hypotheses",
      source_verification: "not_asserted", verified_calculations: [expect.objectContaining({ reference: "M1", value: 7 / 3 })],
      observed_signals: [expect.objectContaining({ reference: "S1", status: "DETECTED" })],
    } });
    expect(first.report.result?.evidence_citations[0]).toMatchObject({ source_worksheet: "Inspection", source_cells: ["B2", "C2"] });
    expect(first.report.result?.interpretation.possible_causes[0]?.evidence_refs).toHaveLength(1);
    expect(modelCalls).toHaveBeenCalledTimes(1);

    const replay = await createQualityDataIntelligenceReport(service, await context(adminId), reportTrace, reportRequest);
    expect(replay).toMatchObject({ status: "complete", replayed: true, report: { report_id: reportId } });
    expect(modelCalls).toHaveBeenCalledTimes(1);
    const rows = await sql<{ status: string; result_fingerprint: string }[]>`select status, result_fingerprint from public.quality_data_intelligence_reports where organization_id = ${organizationId}::uuid and report_id = ${reportId}::uuid`;
    expect(rows[0]).toMatchObject({ status: "complete", result_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const authenticatedReport = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${adminId}, true)`;
      return tx`select report_id from public.quality_data_intelligence_reports where report_id = ${reportId}::uuid`;
    });
    expect(authenticatedReport).toHaveLength(1);
  });

  it("records version-bound triage decisions with immutable audit history and serializes concurrent reviewers", async () => {
    const command = {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: reportId,
      finding_key: "possible_cause:0", expected_transition_number: 0,
      decision: "follow_up_requested", rationale: "Check the setup condition against local inspection records.",
    };
    const first = await reviewQualityDataIntelligenceFinding(service, await context(adminId), trace("stage3d-review-first"), command);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    expect(first.event).toMatchObject({ transition_number: 1, decision: "follow_up_requested", reviewer_user_id: adminId, dataset_version_id: versionId, approval_event_id: expect.any(String) });
    expect(first.event.finding_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const replay = await reviewQualityDataIntelligenceFinding(service, await context(adminId), trace("stage3d-review-first"), command);
    expect(replay).toMatchObject({ status: "already_recorded", event: { event_id: first.event.event_id } });
    const stale = await reviewQualityDataIntelligenceFinding(service, await context(adminId), trace("stage3d-review-stale"), command);
    expect(stale).toMatchObject({ status: "conflict", reason_code: "STALE_TRANSITION" });
    const concurrentCommand = { ...command, expected_transition_number: 1, decision: "deferred" as const, rationale: "Defer the synthetic follow-up for the next review window." };
    const concurrent = await Promise.all([
      reviewQualityDataIntelligenceFinding(service, await context(adminId), trace("stage3d-review-concurrent-a"), concurrentCommand),
      reviewQualityDataIntelligenceFinding(service, await context(adminId), trace("stage3d-review-concurrent-b"), concurrentCommand),
    ]);
    expect(concurrent.filter((entry) => entry.status === "applied")).toHaveLength(1);
    expect(concurrent.filter((entry) => entry.status === "conflict" && entry.reason_code === "STALE_TRANSITION")).toHaveLength(1);
    const audit = await sql<{ event_type: string; count: number }[]>`select event_type, count(*)::int as count from public.capa_audit_events where organization_id = ${organizationId}::uuid and metadata->>'review_event_id' = ${first.event.event_id} group by event_type`;
    expect(audit).toEqual([{ event_type: "QUALITY_DATA_INTELLIGENCE_HUMAN_REVIEW_RECORDED", count: 1 }]);
    const history = await service.repository.listReviewHistory(organizationId, reportId);
    expect(history.current_transition_number).toBe(2);
    expect(history.events).toHaveLength(2);
    expect(history.events[0]).toMatchObject({ event_id: first.event.event_id, finding_key: "possible_cause:0" });

    const failingAuditService: QualityDataStage3DServiceDependencies = {
      ...service,
      audit_repository: { appendEvent: async () => { throw new Error("Synthetic audit failure"); } } as never,
    };
    const rolledBack = await reviewQualityDataIntelligenceFinding(failingAuditService, await context(adminId), trace("stage3d-review-audit-rollback"), {
      ...command, expected_transition_number: 2, decision: "acknowledged", rationale: "Synthetic review must roll back with audit failure.",
    });
    expect(rolledBack.status).toBe("persistence_failed");
    const rollbackRows = await sql<{ count: number }[]>`select count(*)::int as count from public.quality_data_intelligence_review_events where organization_id = ${organizationId}::uuid and idempotency_key = 'stage3d-review-audit-rollback'`;
    expect(rollbackRows[0]?.count).toBe(0);
    const authenticatedReview = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${adminId}, true)`;
      return tx`select event_id from public.quality_data_intelligence_review_events where report_id = ${reportId}::uuid`;
    });
    expect(authenticatedReview).toHaveLength(2);
  });

  it("denies non-admin and cross-tenant review, validates finding references, and hides reports after approval revocation", async () => {
    const ownerResult = await reviewQualityDataIntelligenceFinding(service, await context(ownerId), trace(), {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: reportId, finding_key: "possible_cause:0",
      expected_transition_number: 0, decision: "acknowledged", rationale: "Synthetic non-admin attempt",
    });
    expect(ownerResult.status).toBe("denied");
    const fabricated = await reviewQualityDataIntelligenceFinding(service, await context(adminId), trace(), {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: reportId, finding_key: "possible_cause:7",
      expected_transition_number: 0, decision: "acknowledged", rationale: "Synthetic invalid target",
    });
    expect(fabricated.status).toBe("invalid_request");
    expect((await getQualityDataIntelligenceReport(service, await context(otherAdminId), reportId)).status).toBe("not_found_or_not_authorized");

    const revoked = await transitionQualityDataDatasetVersionApproval(stage3a, await context(adminId), trace(), {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: versionId, decision: "revoked",
      expected_transition_number: 1, rationale: "Synthetic revocation for qualification",
    });
    expect(revoked.status).toBe("applied");
    expect((await getQualityDataIntelligenceReport(service, await context(adminId), reportId)).status).toBe("not_approved");
    const afterRevocation = await reviewQualityDataIntelligenceFinding(service, await context(adminId), trace(), {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: reportId, finding_key: "possible_cause:0",
      expected_transition_number: 1, decision: "deferred", rationale: "Must not review a revoked dataset version",
    });
    expect(afterRevocation.status).toBe("not_approved");

    const hiddenReport = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${adminId}, true)`;
      return tx`select report_id from public.quality_data_intelligence_reports where report_id = ${reportId}::uuid`;
    });
    expect(hiddenReport).toHaveLength(0);
    const hiddenReviewHistory = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${adminId}, true)`;
      return tx`select event_id from public.quality_data_intelligence_review_events where report_id = ${reportId}::uuid`;
    });
    expect(hiddenReviewHistory).toHaveLength(0);
  });

  it("enforces RLS and least-privilege direct table access", async () => {
    // This test runs after the revocation test, so the report is intentionally
    // invisible even to the authorized organization administrator.
    const readable = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${adminId}, true)`;
      return tx`select report_id from public.quality_data_intelligence_reports where report_id = ${reportId}::uuid`;
    });
    expect(readable).toHaveLength(0);
    const hidden = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select pg_catalog.set_config('request.jwt.claim.sub', ${ownerId}, true)`;
      return tx`select report_id from public.quality_data_intelligence_reports where report_id = ${reportId}::uuid`;
    });
    expect(hidden).toHaveLength(0);
    await expect(sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`insert into public.quality_data_intelligence_review_events (event_id) values (${randomUUID()}::uuid)`;
    })).rejects.toThrow();
    const flags = await sql<{ report_rls: boolean; report_forced: boolean; review_rls: boolean; review_forced: boolean }[]>`
      select report.relrowsecurity as report_rls, report.relforcerowsecurity as report_forced,
        review.relrowsecurity as review_rls, review.relforcerowsecurity as review_forced
      from pg_class as report cross join pg_class as review
      where report.oid = 'public.quality_data_intelligence_reports'::regclass
        and review.oid = 'public.quality_data_intelligence_review_events'::regclass`;
    expect(flags[0]).toEqual({ report_rls: true, report_forced: true, review_rls: true, review_forced: true });
    const grants = await sql<{ authenticated_execute: boolean; anon_execute: boolean; service_role_execute: boolean }[]>`
      select has_function_privilege('authenticated', 'private.quality_data_intelligence_can_read(uuid,uuid,uuid,uuid)', 'EXECUTE') as authenticated_execute,
        has_function_privilege('anon', 'private.quality_data_intelligence_can_read(uuid,uuid,uuid,uuid)', 'EXECUTE') as anon_execute,
        has_function_privilege('service_role', 'private.quality_data_intelligence_can_read(uuid,uuid,uuid,uuid)', 'EXECUTE') as service_role_execute`;
    expect(grants[0]).toEqual({ authenticated_execute: true, anon_execute: false, service_role_execute: false });
  });
});
