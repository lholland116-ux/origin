import { describe, expect, it } from "vitest";
import type { AuditEvent, RequestTrace } from "../../lib/capa/domain/capa-types";
import type { CapaCase, CapaCaseVersion, CapaSectionVersion } from "../../lib/capa/domain/capa-types";
import type { CreateCapaDependencies } from "../../lib/capa/application/create-capa";
import type { CapaCreationIdempotencyRecord } from "../../lib/database/repositories/capa-creation-idempotency-repository";
import type { TransactionContext, TransactionManager, TransactionWork } from "../../lib/database/transactions";
import type { QualityDataCapaHandoffRepository, QualityDataCapaHandoffReserveInput, QualityDataCapaHandoffLinkInput } from "../../lib/database/repositories/quality-data-capa-handoff-repository";
import type { QualityDataCapaHandoffDependencies } from "../../lib/quality-data/quality-data-capa-handoff-service";
import { createCapaDraftFromQualityIntelligence } from "../../lib/quality-data/quality-data-capa-handoff-service";
import { resolveQualityDataIntelligenceFinding } from "../../lib/quality-data/quality-data-intelligence-finding";
import type { QualityDataAiAnalysisResult } from "../../lib/quality-data/quality-data-ai-contract";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";

const USER = "52000000-0000-4000-8000-000000000001";
const ORG = "52000000-0000-4000-8000-000000000002";
const MEMBERSHIP = "52000000-0000-4000-8000-000000000003";
const REPORT = "52000000-0000-4000-8000-000000000004";
const DATASET = "52000000-0000-4000-8000-000000000005";
const VERSION = "52000000-0000-4000-8000-000000000006";
const APPROVAL = "52000000-0000-4000-8000-000000000007";
const HANDLE = "52000000-0000-4000-8000-000000000008";
const NOW = new Date("2026-10-19T12:00:00.000Z");

const result: QualityDataAiAnalysisResult = {
  schema_version: "quality-data-ai-analysis-result-1.0.0", packet_version: "quality-evidence-packet-1.0.0", status: "complete",
  verified_calculations: [{ reference: "M1", kind: "NUMERIC_SUMMARY", status: "COMPLETE", sample_size: 4, numerator_count: 4, denominator_count: 4,
    excluded_counts: { missing_field: 0, missing_value: 0, non_numeric: 0 }, unit: "COUNT", value: 2.5, minimum: 1, maximum: 4, evidence_handles: [HANDLE] }],
  observed_signals: [], time_windows: ["ALL_APPROVED_RECORDS"], assumptions: [], data_quality_limitations: [],
  interpretation: { possible_causes: [{ text: "An advisory hypothesis; not an established cause.", evidence_refs: [HANDLE] }],
    uncertainty: [], human_investigation_steps: [], advisory_only: true, causal_proof: false, capa_decision: false },
  interpretation_status: "unverified_advisory_hypotheses", source_verification: "not_asserted", authorization_scope: "analytical_use_only",
  evidence_citations: [{ handle: HANDLE, record_id: "52000000-0000-4000-8000-000000000009", record_ordinal: 1,
    source_worksheet: "Inspection", source_row_number: 2, source_cells: ["B2"], source_id: "52000000-0000-4000-8000-000000000010",
    source_version_id: "52000000-0000-4000-8000-000000000011", source_sha256: "a".repeat(64) }],
};
const report = {
  report_id: REPORT, organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, approval_event_id: APPROVAL,
  requested_by_user_id: USER, requested_by_membership_id: MEMBERSHIP, request_payload: { schema_version: "quality-data-ai-analysis-request-1.0.0", dataset_version_id: VERSION, metrics: [], signals: [] },
  request_fingerprint: "b".repeat(64), status: "complete" as const, result, result_fingerprint: "c".repeat(64), failure_code: null,
  request_id: "52000000-0000-4000-8000-000000000012", correlation_id: "52000000-0000-4000-8000-000000000013",
  created_at: NOW.toISOString(), finalized_at: NOW.toISOString(),
};
function trace(key: string): RequestTrace {
  return { request_id: "52000000-0000-4000-8000-000000000014" as never, correlation_id: "52000000-0000-4000-8000-000000000015" as never, idempotency_key: key as never };
}
function context(overrides: { readonly organization?: string; readonly inactive?: boolean } = {}): CapaRequestContext {
  return {
    owner_user_id: USER as never,
    authentication: { principal: { principal_type: "human", user_id: USER as never }, session_id: "session" as never,
      authentication_method: "SUPABASE_SESSION" as never, assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: new Date(NOW.getTime() - 60_000).toISOString() as never,
      expires_at: (overrides.inactive ? new Date(NOW.getTime() - 1) : new Date(NOW.getTime() + 60_000)).toISOString() as never },
    tenant: { organization_id: (overrides.organization ?? ORG) as never, access_grant_id: MEMBERSHIP as never,
      access_path: "SUPABASE_MEMBERSHIP" as never, authorization_policy_version: "test-policy", resolved_at: NOW.toISOString() as never,
      role_assignments: [{ role_assignment_id: "52000000-0000-4000-8000-000000000016" as never, role_id: "CAPA_ORG_ADMIN" as never,
        scope: "ORGANIZATION" as never, effective_at: new Date(NOW.getTime() - 60_000).toISOString() as never }] },
  };
}
function command(findingKey = "metric:M1") {
  return { schema_version: "quality-data-capa-handoff-1.0.0", finding_key: findingKey,
    expected_result_fingerprint: report.result_fingerprint, decision: "create_capa_draft", rationale: "Human review requests a CAPA draft for investigation." };
}

interface State {
  sequence: number; handoffs: Map<string, Record<string, unknown>>; byKey: Map<string, string>; byFinding: Map<string, string>;
  cases: CapaCase[]; versions: CapaCaseVersion[]; sections: CapaSectionVersion[]; audits: AuditEvent[];
  creationKeys: Map<string, { fingerprint: string; case_id: string; case_version_id: string; section_version_id: string; audit_id: string }>;
  failHandoffAudit: boolean; allowRead: boolean; allowReview: boolean; allowCreate: boolean;
}

function makeHarness(options: { readonly read?: boolean; readonly review?: boolean; readonly create?: boolean; readonly auditFailure?: boolean } = {}) {
  let state: State = { sequence: 20, handoffs: new Map(), byKey: new Map(), byFinding: new Map(), cases: [], versions: [], sections: [],
    audits: [], creationKeys: new Map(), failHandoffAudit: options.auditFailure ?? false,
    allowRead: options.read ?? true, allowReview: options.review ?? true, allowCreate: options.create ?? true };
  let mutex = Promise.resolve();
  const next = () => { state.sequence += 1; return "52000000-0000-4000-8000-" + String(state.sequence).padStart(12, "0"); };
  const transactionManager: TransactionManager = {
    async runInTransaction<T>(requestTrace: RequestTrace, work: TransactionWork<T>): Promise<T> {
      let release!: () => void;
      const previous = mutex;
      mutex = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = structuredClone(state);
      const transaction = { transaction_id: next() as never, started_at: NOW.toISOString() as never, request_trace: requestTrace };
      try { return await work(transaction); } catch (error) { state = before; throw error; } finally { release(); }
    },
  };
  const capaRepository = {
    async findCaseById(org: string, id: string) { return org === ORG ? state.cases.find((entry) => entry.capa_case_id === id) ?? null : null; },
    async findCaseVersionById(org: string, caseId: string, versionId: string) { return org === ORG ? state.versions.find((entry) => entry.capa_case_id === caseId && entry.case_version_id === versionId) ?? null : null; },
    async findSectionVersionById(org: string, caseId: string, sectionId: string) { return org === ORG ? state.sections.find((entry) => entry.capa_case_id === caseId && entry.section_version_id === sectionId) ?? null : null; },
    async insertCase(_tx: TransactionContext, value: CapaCase) { state.cases.push(value); },
    async insertSectionVersion(_tx: TransactionContext, value: CapaSectionVersion) { state.sections.push(value); },
    async insertCaseVersion(_tx: TransactionContext, value: CapaCaseVersion) { state.versions.push(value); },
  };
  const auditRepository = {
    async appendEvent(_tx: TransactionContext, event: AuditEvent) {
      if (state.failHandoffAudit && event.event_type === "QUALITY_DATA_INTELLIGENCE_CAPA_DRAFT_CREATED") throw new Error("synthetic audit failure");
      state.audits.push(event);
      return { status: "appended" as const, event_id: event.event_id };
    },
    async findEventById() { return null; },
    async listEventsForAggregate() { return { events: [] }; },
  };
  const createDeps: CreateCapaDependencies = {
    transaction_manager: transactionManager, capa_repository: capaRepository as never, audit_repository: auditRepository as never,
    creation_idempotency_repository: {
      async claimCreation(_tx: TransactionContext, claim: CapaCreationIdempotencyRecord) {
        const key = claim.organization_id + ":" + claim.idempotency_key;
        const existing = state.creationKeys.get(key);
        if (existing) return { status: "already_claimed" as const, record: { ...claim, capa_case_id: existing.case_id as never,
          case_version_id: existing.case_version_id as never, section_version_id: existing.section_version_id as never, audit_event_id: existing.audit_id as never } };
        state.creationKeys.set(key, { fingerprint: claim.request_fingerprint, case_id: claim.capa_case_id,
          case_version_id: claim.case_version_id, section_version_id: claim.section_version_id, audit_id: claim.audit_event_id });
        return { status: "claimed" as const, record: claim };
      },
    } as never,
    case_number_allocator: { async allocateNextCaseNumber() { return "CAPA-" + state.sequence; } },
    authorization_policy: { async evaluate() { return state.allowCreate
      ? { decision: "allow" as const, reason_code: "CREATE_ALLOWED" as never, policy_version: "test-policy",
        evaluated_at: NOW.toISOString() as never, relied_on_role_assignment_ids: ["52000000-0000-4000-8000-000000000016" as never] }
      : { decision: "deny" as const, reason_code: "CREATE_DENIED" as never, policy_version: "test-policy", evaluated_at: NOW.toISOString() as never }; } },
    id_generator: { generateCapaCaseId: () => next() as never, generateCaseVersionId: () => next() as never,
      generateSectionVersionId: () => next() as never, generateAuditEventId: () => next() as never },
    clock: { now: () => new Date(NOW) },
    configuration: { workflow_version: "test-workflow", intake_schema_version: "test-intake", audit_schema_version: "test-audit",
      intake_section_type: "CAPA.INTAKE" as never, default_confidentiality: "CUSTOMER_CONFIDENTIAL" as never, authorization_purpose: "CAPA_CASE_CREATION" as never },
  };
  const handoffRepository: QualityDataCapaHandoffRepository = {
    async reserveDecision(_tx, input: QualityDataCapaHandoffReserveInput) {
      if (!state.allowRead || !state.allowReview || !state.allowCreate) return { status: "unauthorized" as const };
      if (input.organization_id !== ORG) return { status: "not_found" as const };
      if (input.expected_result_fingerprint !== report.result_fingerprint) return { status: "stale_evidence" as const };
      const target = resolveQualityDataIntelligenceFinding(result, input.finding_key);
      if (!target || target.fingerprint !== input.expected_finding_fingerprint) return { status: "stale_evidence" as const };
      const key = input.organization_id + ":" + input.idempotency_key;
      const existingId = state.byKey.get(key);
      const recordKey = input.organization_id + ":" + input.report_id + ":" + input.finding_key;
      const existingFinding = state.byFinding.get(recordKey);
      if (existingId) {
        const existing = state.handoffs.get(existingId)!;
        return existing.request_fingerprint === input.request_fingerprint && existing.handoff_status === "linked"
          ? { status: "already_created" as const, record: existing as never } : { status: "conflict" as const };
      }
      if (existingFinding) return { status: "conflict" as const };
      const record = { handoff_id: input.handoff_id, organization_id: input.organization_id, report_id: input.report_id,
        finding_key: input.finding_key, finding_classification: target.classification, finding_fingerprint: target.fingerprint,
        result_fingerprint: report.result_fingerprint, reviewer_user_id: input.reviewer_user_id, decision: input.decision,
        request_fingerprint: input.request_fingerprint, handoff_status: "pending", capa_case_id: null, capa_case_status: null };
      state.handoffs.set(input.handoff_id, record); state.byKey.set(key, input.handoff_id); state.byFinding.set(recordKey, input.handoff_id);
      return { status: "reserved" as const, record: record as never };
    },
    async linkCreatedDraft(_tx, input: QualityDataCapaHandoffLinkInput) {
      const record = state.handoffs.get(input.handoff_id);
      if (!record || record.handoff_status !== "pending" || input.capa_case_status !== "S00") throw new Error("link failed");
      Object.assign(record, { handoff_status: "linked", capa_case_id: input.capa_case_id, capa_case_status: input.capa_case_status });
    },
    async findLinkedForCase(org, caseId) {
      const matches = [...state.handoffs.values()].filter((entry) => entry.organization_id === org && entry.capa_case_id === caseId && entry.handoff_status === "linked");
      if (matches.length !== 1) return null;
      const record = matches[0]!;
      return { handoff_id: String(record.handoff_id), organization_id: String(record.organization_id), report_id: String(record.report_id),
        dataset_id: DATASET, dataset_version_id: VERSION, approval_event_id: APPROVAL, finding_key: String(record.finding_key),
        finding_classification: String(record.finding_classification) as never, finding_fingerprint: String(record.finding_fingerprint),
        result_fingerprint: String(record.result_fingerprint), capa_case_id: caseId, capa_case_status: String(record.capa_case_status) };
    },
  };
  const stage3d = { async findReport(org: string, id: string) { return org === ORG && id === REPORT ? report : null; } };
  const authorize = async (allowed: boolean) => allowed
    ? { allowed: true as const, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER }
    : { allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const };
  const dependencies: QualityDataCapaHandoffDependencies = {
    quality_data: { repository: { async findApprovedDatasetVersion() { return { status: "approved", snapshot: { dataset: { dataset_id: DATASET } },
      approval: { approval_event_id: APPROVAL } }; } } } as never,
    stage3d_repository: stage3d as never, handoff_repository: handoffRepository,
    authorizer: { authorizeRead: () => authorize(state.allowRead), authorizeIntelligenceReview: () => authorize(state.allowReview) },
    capa_creation_dependencies: createDeps, ids: { audit_event_id: () => next() as never, uuid: next }, clock: { now: () => new Date(NOW) },
  };
  return { dependencies, state: () => state };
}

describe("quality intelligence to CAPA draft handoff", () => {
  it("creates an S00 draft only after the explicit human decision and keeps provenance/audits atomic", async () => {
    const harness = makeHarness();
    const response = await createCapaDraftFromQualityIntelligence(harness.dependencies, context(), trace("handoff-one"), REPORT, command());
    expect(response).toMatchObject({ status: "created", capa_case_status: "S00", finding_classification: "deterministic_calculation" });
    const state = harness.state();
    expect(state.cases).toHaveLength(1);
    expect(state.cases[0]?.status).toBe("S00");
    expect(state.versions[0]?.status).toBe("S00");
    expect(state.handoffs.size).toBe(1);
    expect([...state.handoffs.values()][0]).toMatchObject({ decision: "create_capa_draft", reviewer_user_id: USER, handoff_status: "linked" });
    expect(state.audits.map((event) => event.event_type)).toEqual(["EVT-CASE-CREATED", "QUALITY_DATA_INTELLIGENCE_CAPA_DRAFT_CREATED"]);
    expect(state.audits[1]?.metadata).toMatchObject({ source_verification: "not_asserted", ai_interpretation: "unverified_advisory_hypotheses", capa_case_approved: false, capa_workflow_advanced: false });
    expect(JSON.stringify(state.sections[0]?.content)).toContain("Human rationale:");
    expect(JSON.stringify(state.sections[0]?.content)).not.toContain("An advisory hypothesis;");
  });
  it("classifies an AI finding as advisory and never copies its generated narrative into CAPA intake", async () => {
    const harness = makeHarness();
    const response = await createCapaDraftFromQualityIntelligence(harness.dependencies, context(), trace("handoff-ai"), REPORT, command("possible_cause:0"));
    expect(response).toMatchObject({ status: "created", finding_classification: "advisory_hypothesis", capa_case_status: "S00" });
    expect(JSON.stringify(harness.state().sections[0]?.content)).not.toContain("An advisory hypothesis;");
    expect([...harness.state().handoffs.values()][0]).toMatchObject({ finding_classification: "advisory_hypothesis", decision: "create_capa_draft" });
  });
  it("denies absent read/review/CAPA-create authority, inactive sessions, and cross-tenant report access", async () => {
    for (const options of [{ read: false }, { review: false }, { create: false }]) {
      const harness = makeHarness(options);
      const result = await createCapaDraftFromQualityIntelligence(harness.dependencies, context(), trace("denied-" + Object.keys(options)[0]), REPORT, command());
      expect(result.status).toBe("denied");
      expect(harness.state().cases).toHaveLength(0);
    }
    const inactive = makeHarness();
    expect((await createCapaDraftFromQualityIntelligence(inactive.dependencies, context({ inactive: true }), trace("inactive"), REPORT, command())).status).toBe("invalid_request");
    const crossTenant = makeHarness();
    expect((await createCapaDraftFromQualityIntelligence(crossTenant.dependencies, context({ organization: "52000000-0000-4000-8000-000000000099" }), trace("cross-tenant"), REPORT, command())).status).toBe("denied");
  });
  it("rejects authorizer identities or memberships that do not match the authenticated actor", async () => {
    const otherUser = "52000000-0000-4000-8000-000000000099";
    const otherMembership = "52000000-0000-4000-8000-000000000098";
    for (const mismatch of [
      { readUser: otherUser, reviewUser: USER, readMembership: MEMBERSHIP, reviewMembership: MEMBERSHIP },
      { readUser: USER, reviewUser: USER, readMembership: MEMBERSHIP, reviewMembership: otherMembership },
    ]) {
      const harness = makeHarness();
      harness.dependencies.authorizer.authorizeRead = async () => ({ allowed: true, organization_id: ORG, membership_id: mismatch.readMembership, uploader_user_id: mismatch.readUser });
      harness.dependencies.authorizer.authorizeIntelligenceReview = async () => ({ allowed: true, organization_id: ORG, membership_id: mismatch.reviewMembership, uploader_user_id: mismatch.reviewUser });
      const response = await createCapaDraftFromQualityIntelligence(harness.dependencies, context(), trace("mismatched-authority"), REPORT, command());
      expect(response.status).toBe("denied");
      expect(harness.state().cases).toHaveLength(0);
    }
  });
  it("rejects tampered hashes and malformed decisions before CAPA persistence", async () => {
    const harness = makeHarness();
    expect((await createCapaDraftFromQualityIntelligence(harness.dependencies, context(), trace("tampered"), REPORT, { ...command(), expected_result_fingerprint: "f".repeat(64) })).status).toBe("stale_evidence");
    expect((await createCapaDraftFromQualityIntelligence(harness.dependencies, context(), trace("bad-decision"), REPORT, { ...command(), decision: "approve_capa" })).status).toBe("invalid_request");
    expect(harness.state().cases).toHaveLength(0);
  });
  it("serializes replay and concurrent handoffs and creates at most one draft for a finding", async () => {
    const replayHarness = makeHarness();
    const replayTrace = trace("same-handoff-key");
    const same = await Promise.all([
      createCapaDraftFromQualityIntelligence(replayHarness.dependencies, context(), replayTrace, REPORT, command()),
      createCapaDraftFromQualityIntelligence(replayHarness.dependencies, context(), replayTrace, REPORT, command()),
    ]);
    expect(same.map((entry) => entry.status).sort()).toEqual(["already_created", "created"]);
    expect(replayHarness.state().cases).toHaveLength(1);
    const concurrentHarness = makeHarness();
    const concurrent = await Promise.all([
      createCapaDraftFromQualityIntelligence(concurrentHarness.dependencies, context(), trace("parallel-a"), REPORT, command("possible_cause:0")),
      createCapaDraftFromQualityIntelligence(concurrentHarness.dependencies, context(), trace("parallel-b"), REPORT, command("possible_cause:0")),
    ]);
    expect(concurrent.filter((entry) => entry.status === "created")).toHaveLength(1);
    expect(concurrent.filter((entry) => entry.status === "conflict")).toHaveLength(1);
    expect(concurrentHarness.state().cases).toHaveLength(1);
  });
  it("rolls back the handoff and CAPA aggregate if the correlated handoff audit cannot be appended", async () => {
    const harness = makeHarness({ auditFailure: true });
    const response = await createCapaDraftFromQualityIntelligence(harness.dependencies, context(), trace("audit-failure"), REPORT, command());
    expect(response.status).toBe("persistence_failed");
    expect(harness.state().cases).toHaveLength(0);
    expect(harness.state().versions).toHaveLength(0);
    expect(harness.state().sections).toHaveLength(0);
    expect(harness.state().handoffs.size).toBe(0);
    expect(harness.state().audits).toHaveLength(0);
  });
});
