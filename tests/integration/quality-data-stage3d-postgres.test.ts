import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SupabaseCapaAuthorizationPolicy } from "../../lib/capa/authorization/supabase-capa-authorization-policy";
import { SupabaseAuditRepository } from "../../lib/database/supabase/supabase-audit-repository";
import { SupabaseCapaCreationIdempotencyRepository } from "../../lib/database/supabase/supabase-capa-creation-idempotency-repository";
import { SupabaseCapaCaseNumberAllocator } from "../../lib/database/supabase/supabase-capa-case-number-allocator";
import { SupabaseCapaRepository } from "../../lib/database/supabase/supabase-capa-repository";
import { SupabaseQualityDataRepository } from "../../lib/database/supabase/supabase-quality-data-repository";
import { SupabaseQualityDataStage3ARepository } from "../../lib/database/supabase/supabase-quality-data-stage3a-repository";
import { SupabaseQualityDataStage3DRepository } from "../../lib/database/supabase/supabase-quality-data-stage3d-repository";
import { SupabaseQualityDataCapaHandoffRepository } from "../../lib/database/supabase/supabase-quality-data-capa-handoff-repository";
import { SupabaseTransactionManager } from "../../lib/database/supabase/supabase-transactions";
import { PolicyBackedQualityDataIngestionAuthorizer } from "../../lib/quality-data/quality-data-authorization";
import { createQualityDataDeterministicReport, createQualityDataIntelligenceReport, getQualityDataIntelligenceReport, reviewQualityDataIntelligenceFinding, type QualityDataStage3DServiceDependencies } from "../../lib/quality-data/quality-data-stage3d-service";
import { transitionQualityDataExternalAiOptIn } from "../../lib/quality-data/quality-data-external-ai-opt-in-service";
import { ingestQualityData } from "../../lib/quality-data/quality-data-service";
import { transitionQualityDataDatasetVersionApproval, type QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";
import { createCapaDraftFromQualityIntelligence } from "../../lib/quality-data/quality-data-capa-handoff-service";
import { qualityDataCapaHandoffCommandSchema } from "../../lib/quality-data/quality-data-capa-handoff-contract";
import { getQualityDataCapaSupportingEvidence } from "../../lib/quality-data/quality-data-capa-evidence-service";
import { resolveQualityDataIntelligenceFinding } from "../../lib/quality-data/quality-data-intelligence-finding";
import type { CreateCapaDependencies } from "../../lib/capa/application/create-capa";
import type { TransactionWork } from "../../lib/database/transactions";
import type { AuditRepository } from "../../lib/database/repositories/audit-repository";
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
  let capaAuthorizationPolicy: SupabaseCapaAuthorizationPolicy;
  let versionId: string;
  let reportId: string;
  let deterministicReportId = "";
  let deterministicCapaCaseId = "";
  let modelCallCount = 0;
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
      'system', 'stage3d-test', 'Synthetic Stage 3D qualification') on conflict do nothing`;
  }
  async function assignRole(org: string, user: string, membership: string, role: string): Promise<void> {
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
        ["2025-01-06", "Seal leak", 1], ["2025-01-13", "Surface mark", 1], ["2025-01-20", null, 0], ["2025-01-27", null, 0],
        ["2025-02-03", "Seal leak", 2], ["2025-02-10", "Surface mark", 1], ["2025-02-17", "Packaging flaw", 1], ["2025-02-24", null, 0],
        ["2025-03-03", "Seal leak", 4], ["2025-03-10", "Surface mark", 2], ["2025-03-17", "Packaging flaw", 1], ["2025-03-24", "Handling mark", 1],
      ].map(([date, mode, count], index) => ({
        source_worksheet: "Synthetic Inspections", source_row_number: index + 2,
        fields: [
          { field_key: "reject_count", value_type: "number" as const, original_value: count, normalized_value: count, normalized_unit: "count", source_cell_reference: `C${index + 2}` },
          {
            field_key: "failure_mode",
            ...(mode === null
              ? { value_type: "blank" as const, original_value: null, normalized_value: null }
              : { value_type: "text" as const, original_value: mode, normalized_value: mode }),
            source_cell_reference: `B${index + 2}`,
          },
          { field_key: "inspection_date", value_type: "date" as const, original_value: date, normalized_value: date, source_cell_reference: `A${index + 2}` },
          { field_key: "inspected_quantity", value_type: "number" as const, original_value: 250, normalized_value: 250, normalized_unit: "units", source_cell_reference: `D${index + 2}` },
        ],
      })),
    };
    const ingested = await ingestQualityData({
      repository: new SupabaseQualityDataRepository(sql), audit_repository: new SupabaseAuditRepository(sql),
      transaction_manager: new SupabaseTransactionManager(sql), authorizer,
      ids: { event_id: () => randomUUID() as never, uuid: randomUUID }, clock: { now: () => new Date(NOW) },
    }, await context(adminId), request, command);
    if (ingested.status !== "accepted") {
      const reasonCode = "reason_code" in ingested ? ` (${ingested.reason_code})` : "";
      throw new Error(`Synthetic Stage 3D dataset setup failed: ${ingested.status}${reasonCode}.`);
    }
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
    capaAuthorizationPolicy = new SupabaseCapaAuthorizationPolicy(sql, {
      step_up_maximum_age_ms: 300_000, required_step_up_assurance: "MULTI_FACTOR" as never,
    });
    authorizer = new PolicyBackedQualityDataIngestionAuthorizer(capaAuthorizationPolicy);
    stage3a = {
      repository: new SupabaseQualityDataStage3ARepository(sql), audit_repository: new SupabaseAuditRepository(sql),
      transaction_manager: new SupabaseTransactionManager(sql), authorizer, external_ai_transfer_authorizer: authorizer,
      ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID }, clock: { now: () => new Date(NOW) },
    };
    modelCalls = vi.fn(async (packet: QualityEvidencePacket) => {
      modelCallCount += 1;
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
      source_verification: "not_asserted", verified_calculations: [expect.objectContaining({ reference: "M1", value: 7 / 6 })],
      observed_signals: [expect.objectContaining({ reference: "S1", status: "DETECTED" })],
    } });
    if (first.report.result?.interpretation_status !== "unverified_advisory_hypotheses" || !first.report.result.interpretation) throw new Error("Expected a persisted AI advisory result.");
    const citedHandle = first.report.result.interpretation.possible_causes[0]?.evidence_refs[0];
    const citedCitation = first.report.result?.evidence_citations.find((citation) => citation.handle === citedHandle);
    expect(citedCitation).toMatchObject({ source_worksheet: "Synthetic Inspections" });
    expect(citedCitation?.source_cells).toHaveLength(2);
    expect(citedCitation?.source_cells.slice().sort()).toEqual(["B2", "C2"]);
    expect(first.report.result.interpretation.possible_causes[0]?.evidence_refs).toHaveLength(1);
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

  it("persists a deterministic-only report from approved rows and records separate human triage without calling AI", async () => {
    const callsBefore = modelCallCount;
    const request = {
      schema_version: "quality-data-deterministic-analysis-request-1.0.0",
      mode: "deterministic_only",
      dataset_version_id: versionId,
      metrics: [{ metric_id: "reject-total", kind: "numeric_summary", field_key: "reject_count" }],
      signals: [
        { signal_id: "recurring-defect", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } },
        { signal_id: "monthly-rate-trend", kind: "defect_rate_trend", defect_count_field_key: "reject_count", production_quantity_field_key: "inspected_quantity", observation_date_field_key: "inspection_date", production_quantity_unit: "units", rate_per: 1_000, direction: "increase", minimum_absolute_change: 0.5, minimum_records_per_window: 3, time_window: { kind: "calendar_month" } },
      ],
    };
    const traceValue = trace("stage3d-deterministic-report");
    const created = await createQualityDataDeterministicReport(service, await context(adminId), traceValue, request);
    expect(created.status).toBe("complete");
    if (created.status !== "complete") return;
    deterministicReportId = created.report.report_id;
    expect(created.report).toMatchObject({ status: "complete", request_payload: { mode: "deterministic_only" }, result: {
      schema_version: "quality-data-deterministic-analysis-result-1.0.0", mode: "deterministic_only",
      interpretation: null, interpretation_status: "not_requested", source_verification: "not_asserted",
      verified_calculations: [expect.objectContaining({ reference: "M1", value: 7 / 6 })],
      observed_signals: [expect.objectContaining({ reference: "S1", kind: "RECURRING_CATEGORY", status: "DETECTED" }),
        expect.objectContaining({ reference: "S2", kind: "DEFECT_RATE_TREND", status: "DETECTED", monthly_buckets: [
          expect.objectContaining({ period: "2025-01", rate: 2 }), expect.objectContaining({ period: "2025-02", rate: 4 }), expect.objectContaining({ period: "2025-03", rate: 8 }),
        ] })],
    } });
    expect(created.report.result?.evidence_citations).toHaveLength(12);
    expect(modelCallCount).toBe(callsBefore);
    const stored = await new SupabaseQualityDataStage3DRepository(sql).findReport(organizationId, deterministicReportId);
    expect(stored?.result_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const audit = await sql<{ count: number; interpretation_status: string }[]>`
      select count(*)::int as count, max(metadata->>'interpretation_status') as interpretation_status
      from public.capa_audit_events where organization_id = ${organizationId}::uuid
        and aggregate_id = ${deterministicReportId} and event_type = 'QUALITY_DATA_INTELLIGENCE_REPORT_CREATED'`;
    expect(audit[0]).toEqual({ count: 1, interpretation_status: "not_requested" });

    const review = await reviewQualityDataIntelligenceFinding(service, await context(adminId), trace("stage3d-deterministic-review"), {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: deterministicReportId,
      finding_key: "signal:S2", expected_transition_number: 0, decision: "follow_up_requested",
      rationale: "Review the synthetic month-over-month rate increase against the source inspection rows.",
    });
    expect(review).toMatchObject({ status: "applied", event: { finding_key: "signal:S2", decision: "follow_up_requested", dataset_version_id: versionId } });
  });

  it("creates one traceable S00 CAPA draft only after an authorized human handoff decision", async () => {
    // The handoff reviewer must independently hold the Stage 3D quality-data
    // review/read role and the existing CAPA_OWNER create authority.
    await assignRole(organizationId, adminId, adminMembershipId, "CAPA_OWNER");
    const transactionDiagnostics: string[] = [];
    const baseTransactionManager = new SupabaseTransactionManager(sql);
    const diagnosticTransactionManager = {
      async runInTransaction<Result>(requestTrace: RequestTrace, work: TransactionWork<Result>): Promise<Result> {
        try {
          return await baseTransactionManager.runInTransaction(requestTrace, work);
        } catch (error) {
          const detail = error as { readonly name?: unknown; readonly code?: unknown; readonly constraint_name?: unknown; readonly column_name?: unknown; readonly table_name?: unknown };
          const safeParts = [detail.name, detail.code, detail.constraint_name, detail.column_name, detail.table_name]
            .filter((part): part is string => typeof part === "string" && /^[A-Za-z0-9_]+$/.test(part));
          if (error instanceof TypeError && /^[A-Za-z0-9_ .()'-]+$/.test(error.message)) safeParts.push(error.message);
          if (error instanceof Error && /^QUALITY_DATA_[A-Z0-9_]+$/.test(error.message)) safeParts.push(error.message);
          transactionDiagnostics.push(safeParts.join(":"));
          throw error;
        }
      },
    };
    const createDependencies: CreateCapaDependencies = {
      transaction_manager: diagnosticTransactionManager,
      capa_repository: new SupabaseCapaRepository(sql),
      audit_repository: new SupabaseAuditRepository(sql),
      creation_idempotency_repository: new SupabaseCapaCreationIdempotencyRepository(),
      case_number_allocator: new SupabaseCapaCaseNumberAllocator(),
      authorization_policy: capaAuthorizationPolicy,
      id_generator: {
        generateCapaCaseId: () => randomUUID() as never,
        generateCaseVersionId: () => randomUUID() as never,
        generateSectionVersionId: () => randomUUID() as never,
        generateAuditEventId: () => randomUUID() as never,
      },
      clock: { now: () => new Date(NOW) },
      configuration: {
        workflow_version: "capa-workflow-1.0.0", intake_schema_version: "capa-intake-1.0.0",
        audit_schema_version: "capa-audit-1.0.0", intake_section_type: "CAPA.INTAKE" as never,
        default_confidentiality: "CUSTOMER_CONFIDENTIAL" as never, authorization_purpose: "CAPA_CASE_CREATION" as never,
      },
    };
    const handoffDependencies = {
      quality_data: stage3a, stage3d_repository: new SupabaseQualityDataStage3DRepository(sql),
      handoff_repository: new SupabaseQualityDataCapaHandoffRepository(sql), authorizer,
      capa_creation_dependencies: createDependencies,
      ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID },
      clock: { now: () => new Date(NOW) },
    };
    const requestTrace = trace("stage3d-capa-handoff-integration");
    const command = {
      schema_version: "quality-data-capa-handoff-1.0.0", finding_key: "metric:M1",
      expected_result_fingerprint: "" as string, decision: "create_capa_draft", rationale: "Human review requests a draft for investigation.",
    };
    const storedReport = await new SupabaseQualityDataStage3DRepository(sql).findReport(organizationId, reportId);
    if (!storedReport?.result_fingerprint) throw new Error("Synthetic Stage 3D report was not persisted.");
    command.expected_result_fingerprint = storedReport.result_fingerprint;
    const adminContext = await context(adminId);
    const adminPrincipal = adminContext.authentication.principal;
    if (adminPrincipal.principal_type !== "human") throw new Error("Synthetic handoff fixture did not resolve a human principal.");
    expect(adminPrincipal.user_id).toBe(adminId);
    expect(adminContext.owner_user_id).toBe(adminId);
    expect(adminContext.tenant.organization_id).toBe(organizationId);
    expect(qualityDataCapaHandoffCommandSchema.safeParse(command).success).toBe(true);
    expect(resolveQualityDataIntelligenceFinding(storedReport.result!, command.finding_key)).not.toBeNull();

    const requests = await Promise.all([
      createCapaDraftFromQualityIntelligence(handoffDependencies, adminContext, requestTrace, reportId, command),
      createCapaDraftFromQualityIntelligence(handoffDependencies, adminContext, trace("stage3d-capa-handoff-race"), reportId, command),
    ]);
    const responseStatuses = requests.map((entry) => entry.status).sort();
    expect(responseStatuses, `Concurrent handoff response statuses: ${responseStatuses.join(", ")}; transaction diagnostics: ${transactionDiagnostics.join(" | ")}`)
      .toEqual(["conflict", "created"]);
    expect(requests.filter((entry) => entry.status === "created")).toHaveLength(1);
    expect(requests.filter((entry) => entry.status === "conflict")).toHaveLength(1);
    const created = requests.find((entry) => entry.status === "created");
    const handoffId = created?.handoff_id;
    const capaCaseId = created?.capa_case_id;
    if (!handoffId || !capaCaseId) return;

    const provenance = await sql<{ handoff_status: string; decision: string; finding_classification: string; capa_case_status: string; reviewer_user_id: string; source_verification: string; interpretation_status: string; dataset_schema_version: string; analysis_request_schema_version: string; analysis_result_schema_version: string; evidence_packet_version: string; evidence_count: number }[]>`
      select handoff.handoff_status, handoff.decision, handoff.finding_classification, handoff.capa_case_status,
        handoff.reviewer_user_id, handoff.source_verification, handoff.interpretation_status,
        handoff.dataset_schema_version, handoff.analysis_request_schema_version, handoff.analysis_result_schema_version,
        handoff.evidence_packet_version,
        jsonb_array_length(handoff.evidence_references)::int as evidence_count
      from public.quality_data_intelligence_capa_handoffs as handoff
      where handoff.organization_id = ${organizationId}::uuid and handoff.handoff_id = ${handoffId}::uuid`;
    expect(provenance[0]).toEqual({ handoff_status: "linked", decision: "create_capa_draft", finding_classification: "deterministic_calculation",
      capa_case_status: "S00", reviewer_user_id: adminId, source_verification: "not_asserted",
      interpretation_status: "unverified_advisory_hypotheses", dataset_schema_version: "inspection-v1.0.0",
      analysis_request_schema_version: "quality-data-ai-analysis-request-1.0.0",
      analysis_result_schema_version: "quality-data-ai-analysis-result-1.0.0",
      evidence_packet_version: "quality-evidence-packet-1.0.0", evidence_count: 12 });
    const linkedCase = await sql<{ status: string; closed_at: Date | null; record_version: number }[]>`
      select status, closed_at, record_version::int as record_version from public.capa_cases where organization_id = ${organizationId}::uuid and capa_case_id = ${capaCaseId}::uuid`;
    expect(linkedCase[0]).toEqual({ status: "S00", closed_at: null, record_version: 1 });
    const draftVersions = await sql<{ version_count: number; only_initial_state: boolean }[]>`
      select count(*)::int as version_count, bool_and(status = 'S00' and version_number = 1) as only_initial_state
      from public.capa_case_versions where organization_id = ${organizationId}::uuid and capa_case_id = ${capaCaseId}::uuid`;
    expect(draftVersions[0]).toEqual({ version_count: 1, only_initial_state: true });
    const auditCount = await sql<{ count: number }[]>`
      select count(*)::int as count from public.capa_audit_events
      where organization_id = ${organizationId}::uuid and aggregate_id = ${capaCaseId}::text
        and event_type in ('EVT-CASE-CREATED', 'QUALITY_DATA_INTELLIGENCE_CAPA_DRAFT_CREATED')`;
    expect(auditCount[0]?.count).toBe(2);

    const replay = await createCapaDraftFromQualityIntelligence(handoffDependencies, await context(adminId), requestTrace, reportId, command);
    expect(replay).toMatchObject({ status: "already_created", handoff_id: handoffId, capa_case_id: capaCaseId });
    const ownerAttempt = await createCapaDraftFromQualityIntelligence(handoffDependencies, await context(ownerId), trace(), reportId, command);
    expect(ownerAttempt.status).toBe("denied");
    const crossTenantAttempt = await createCapaDraftFromQualityIntelligence(handoffDependencies, await context(otherAdminId), trace(), reportId, command);
    expect(crossTenantAttempt.status).toBe("not_found_or_not_authorized");
    const caseCount = await sql<{ count: number }[]>`select count(*)::int as count from public.capa_cases where organization_id = ${organizationId}::uuid`;
    expect(caseCount[0]?.count).toBe(1);

    const beforeAuditFailure = await sql<{ handoffs: number; cases: number; case_audits: number; allocation: number }[]>`
      select
        (select count(*)::int from public.quality_data_intelligence_capa_handoffs where organization_id = ${organizationId}::uuid) as handoffs,
        (select count(*)::int from public.capa_cases where organization_id = ${organizationId}::uuid) as cases,
        (select count(*)::int from public.capa_audit_events where organization_id = ${organizationId}::uuid
          and aggregate_id in (select capa_case_id::text from public.capa_cases where organization_id = ${organizationId}::uuid)) as case_audits,
        (select last_allocated_number::int from public.capa_case_number_counters where organization_id = ${organizationId}::uuid) as allocation`;
    const auditDelegate = new SupabaseAuditRepository(sql);
    const failingHandoffAudit: AuditRepository = {
      appendEvent: async (...args: Parameters<typeof auditDelegate.appendEvent>) => {
        if (args[1].event_type === "QUALITY_DATA_INTELLIGENCE_CAPA_DRAFT_CREATED")
          throw new Error("Synthetic handoff audit failure");
        return auditDelegate.appendEvent(...args);
      },
      findEventById: (...args) => auditDelegate.findEventById(...args),
      listEventsForAggregate: (...args) => auditDelegate.listEventsForAggregate(...args),
    };
    const failedAuditHandoff = await createCapaDraftFromQualityIntelligence({
      ...handoffDependencies,
      capa_creation_dependencies: { ...createDependencies, audit_repository: failingHandoffAudit },
    }, adminContext, trace("stage3d-capa-handoff-audit-failure"), reportId, {
      ...command, finding_key: "possible_cause:0",
    });
    expect(failedAuditHandoff.status).toBe("persistence_failed");
    const afterAuditFailure = await sql<{ handoffs: number; cases: number; case_audits: number; allocation: number }[]>`
      select
        (select count(*)::int from public.quality_data_intelligence_capa_handoffs where organization_id = ${organizationId}::uuid) as handoffs,
        (select count(*)::int from public.capa_cases where organization_id = ${organizationId}::uuid) as cases,
        (select count(*)::int from public.capa_audit_events where organization_id = ${organizationId}::uuid
          and aggregate_id in (select capa_case_id::text from public.capa_cases where organization_id = ${organizationId}::uuid)) as case_audits,
        (select last_allocated_number::int from public.capa_case_number_counters where organization_id = ${organizationId}::uuid) as allocation`;
    expect(afterAuditFailure).toEqual(beforeAuditFailure);

    const access = await sql<{ rls: boolean; forced: boolean; anon_select: boolean; authenticated_select: boolean; service_select: boolean; service_insert: boolean; service_update: boolean; service_delete: boolean }[]>`
      select relation.relrowsecurity as rls, relation.relforcerowsecurity as forced,
        has_table_privilege('anon', relation.oid, 'SELECT') as anon_select,
        has_table_privilege('authenticated', relation.oid, 'SELECT') as authenticated_select,
        has_table_privilege('service_role', relation.oid, 'SELECT') as service_select,
        has_table_privilege('service_role', relation.oid, 'INSERT') as service_insert,
        has_table_privilege('service_role', relation.oid, 'UPDATE') as service_update,
        has_table_privilege('service_role', relation.oid, 'DELETE') as service_delete
      from pg_catalog.pg_class as relation
      where relation.oid = 'public.quality_data_intelligence_capa_handoffs'::regclass`;
    expect(access[0]).toEqual({ rls: true, forced: true, anon_select: false, authenticated_select: false,
      service_select: true, service_insert: true, service_update: true, service_delete: false });
    await expect(sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select handoff_id from public.quality_data_intelligence_capa_handoffs where handoff_id = ${handoffId}::uuid`;
    })).rejects.toThrow();
  });

  it("creates a deterministic S00 handoff and resolves supporting evidence only while source approval is current", async () => {
    if (!deterministicReportId) throw new Error("Deterministic report fixture was not created.");
    const createDependencies: CreateCapaDependencies = {
      transaction_manager: new SupabaseTransactionManager(sql),
      capa_repository: new SupabaseCapaRepository(sql), audit_repository: new SupabaseAuditRepository(sql),
      creation_idempotency_repository: new SupabaseCapaCreationIdempotencyRepository(),
      case_number_allocator: new SupabaseCapaCaseNumberAllocator(), authorization_policy: capaAuthorizationPolicy,
      id_generator: { generateCapaCaseId: () => randomUUID() as never, generateCaseVersionId: () => randomUUID() as never,
        generateSectionVersionId: () => randomUUID() as never, generateAuditEventId: () => randomUUID() as never },
      clock: { now: () => new Date(NOW) },
      configuration: { workflow_version: "capa-workflow-1.0.0", intake_schema_version: "capa-intake-1.0.0", audit_schema_version: "capa-audit-1.0.0",
        intake_section_type: "CAPA.INTAKE" as never, default_confidentiality: "CUSTOMER_CONFIDENTIAL" as never, authorization_purpose: "CAPA_CASE_CREATION" as never },
    };
    const handoffDependencies = { quality_data: stage3a, stage3d_repository: new SupabaseQualityDataStage3DRepository(sql),
      handoff_repository: new SupabaseQualityDataCapaHandoffRepository(sql), authorizer,
      capa_creation_dependencies: createDependencies, ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID },
      clock: { now: () => new Date(NOW) } };
    const stored = await new SupabaseQualityDataStage3DRepository(sql).findReport(organizationId, deterministicReportId);
    if (!stored?.result_fingerprint || !stored.result) throw new Error("Deterministic report result was not durably persisted.");
    const command = { schema_version: "quality-data-capa-handoff-1.0.0", finding_key: "signal:S2",
      expected_result_fingerprint: stored.result_fingerprint, decision: "create_capa_draft", rationale: "A human reviewer requests an S00 draft to investigate the observed synthetic trend." };
    const requestTrace = trace("stage3d-deterministic-capa-handoff");
    const created = await createCapaDraftFromQualityIntelligence(handoffDependencies, await context(adminId), requestTrace, deterministicReportId, command);
    expect(created).toMatchObject({ status: "created", capa_case_status: "S00", finding_classification: "deterministic_signal" });
    if (created.status !== "created") return;
    const caseId = created.capa_case_id;
    const handoffId = created.handoff_id;
    if (!caseId || !handoffId) throw new Error("Deterministic handoff did not return its durable identifiers.");
    deterministicCapaCaseId = caseId;
    const persisted = await sql<{ interpretation_status: string; analysis_request_schema_version: string; analysis_result_schema_version: string; decision: string; capa_case_status: string }[]>`
      select interpretation_status, analysis_request_schema_version, analysis_result_schema_version, decision, capa_case_status
      from public.quality_data_intelligence_capa_handoffs where organization_id = ${organizationId}::uuid and handoff_id = ${handoffId}::uuid`;
    expect(persisted[0]).toEqual({ interpretation_status: "not_requested",
      analysis_request_schema_version: "quality-data-deterministic-analysis-request-1.0.0",
      analysis_result_schema_version: "quality-data-deterministic-analysis-result-1.0.0",
      decision: "create_capa_draft", capa_case_status: "S00" });
    const linked = await getQualityDataCapaSupportingEvidence(handoffDependencies, await context(adminId), caseId);
    expect(linked).toMatchObject({ status: "found", report_id: deterministicReportId, finding_key: "signal:S2" });
    const replay = await createCapaDraftFromQualityIntelligence(handoffDependencies, await context(adminId), requestTrace, deterministicReportId, command);
    expect(replay).toMatchObject({ status: "already_created", capa_case_id: caseId });
    const count = await sql<{ count: number }[]>`select count(*)::int as count from public.capa_cases where organization_id = ${organizationId}::uuid`;
    expect(count[0]?.count).toBe(2);
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
    if (deterministicCapaCaseId) {
      const handoffDependencies = {
        quality_data: stage3a, stage3d_repository: new SupabaseQualityDataStage3DRepository(sql),
        handoff_repository: new SupabaseQualityDataCapaHandoffRepository(sql), authorizer,
        capa_creation_dependencies: {} as CreateCapaDependencies, ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID },
        clock: { now: () => new Date(NOW) },
      };
      expect(await getQualityDataCapaSupportingEvidence(handoffDependencies, await context(adminId), deterministicCapaCaseId)).toMatchObject({ status: "not_approved" });
    }
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
