import { beforeEach, describe, expect, it, vi } from "vitest";

const interpret = vi.hoisted(() => vi.fn());
const calculate = vi.hoisted(() => vi.fn());
const detect = vi.hoisted(() => vi.fn());
const buildPacket = vi.hoisted(() => vi.fn());
vi.mock("../../lib/quality-data/quality-data-ai-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/quality-data/quality-data-ai-service")>()),
  interpretQualityDataAnalysis: interpret,
}));
vi.mock("../../lib/quality-data/quality-data-stage3a-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/quality-data/quality-data-stage3a-service")>()),
  analyzeQualityDatasetVersion: calculate,
  detectQualityDatasetSignals: detect,
}));
vi.mock("../../lib/quality-data/quality-data-evidence-packet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/quality-data/quality-data-evidence-packet")>()),
  buildQualityEvidencePacket: buildPacket,
}));

import type { RequestTrace } from "../../lib/capa/domain/capa-types";
import { createQualityDataDeterministicReport, createQualityDataIntelligenceReport, getQualityDataIntelligenceReport, reviewQualityDataIntelligenceFinding, type QualityDataStage3DServiceDependencies } from "../../lib/quality-data/quality-data-stage3d-service";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";

const USER = "51000000-0000-4000-8000-000000000001";
const ORG = "51000000-0000-4000-8000-000000000002";
const MEMBERSHIP = "51000000-0000-4000-8000-000000000003";
const VERSION = "51000000-0000-4000-8000-000000000004";
const DATASET = "51000000-0000-4000-8000-000000000005";
const APPROVAL = "51000000-0000-4000-8000-000000000006";
const REPORT = "51000000-0000-4000-8000-000000000007";
const NOW = new Date("2026-10-18T12:00:00.000Z");

function context(): CapaRequestContext {
  return {
    owner_user_id: USER as never,
    authentication: { principal: { principal_type: "human", user_id: USER as never }, session_id: "session" as never,
      authentication_method: "SUPABASE_SESSION" as never, assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-10-18T10:00:00.000Z" as never, expires_at: "2026-10-18T14:00:00.000Z" as never },
    tenant: { organization_id: ORG as never, access_grant_id: MEMBERSHIP as never, access_path: "SUPABASE_MEMBERSHIP" as never,
      authorization_policy_version: "policy", resolved_at: NOW.toISOString() as never, role_assignments: [
        { role_assignment_id: "51000000-0000-4000-8000-000000000008" as never, role_id: "CAPA_ORG_ADMIN" as never, scope: "ORGANIZATION" as never, effective_at: "2026-10-18T10:00:00.000Z" as never },
      ] },
  };
}
function trace(key = "stage3d-idempotency"): RequestTrace { return { request_id: "51000000-0000-4000-8000-000000000009" as never, correlation_id: "51000000-0000-4000-8000-000000000010" as never, idempotency_key: key as never }; }
const request = {
  schema_version: "quality-data-ai-analysis-request-1.0.0", dataset_version_id: VERSION,
  metrics: [{ metric_id: "reject-count", kind: "numeric_summary", field_key: "reject_count" }],
  signals: [{ signal_id: "repeat-failure", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }],
};
const result = {
  schema_version: "quality-data-ai-analysis-result-1.0.0", packet_version: "quality-evidence-packet-1.0.0", status: "complete",
  verified_calculations: [], observed_signals: [], time_windows: [], assumptions: [], data_quality_limitations: [],
  interpretation: { possible_causes: [{ text: "A process setting may be relevant.", evidence_refs: ["51000000-0000-4000-8000-000000000011"] }], uncertainty: [], human_investigation_steps: [], advisory_only: true, causal_proof: false, capa_decision: false },
  interpretation_status: "unverified_advisory_hypotheses", source_verification: "not_asserted", authorization_scope: "analytical_use_only",
  evidence_citations: [{ handle: "51000000-0000-4000-8000-000000000011", record_id: "51000000-0000-4000-8000-000000000012", record_ordinal: 1,
    source_worksheet: "Inspection", source_row_number: 2, source_cells: ["B2"], source_id: "51000000-0000-4000-8000-000000000013",
    source_version_id: "51000000-0000-4000-8000-000000000014", source_sha256: "a".repeat(64) }],
};

function dependencies(options: { readonly readAllowed?: boolean; readonly reviewAllowed?: boolean; readonly approval?: "approved" | "revoked" } = {}) {
  const report = {
    report_id: REPORT, organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, approval_event_id: APPROVAL,
    requested_by_user_id: USER, requested_by_membership_id: MEMBERSHIP, request_payload: request,
    request_fingerprint: "a".repeat(64), status: "processing" as const, result: null, result_fingerprint: null, failure_code: null,
    request_id: trace().request_id, correlation_id: trace().correlation_id, created_at: NOW.toISOString(), finalized_at: null,
  };
  const reviewEvent = {
    event_id: "51000000-0000-4000-8000-000000000015", organization_id: ORG, report_id: REPORT, dataset_id: DATASET,
    dataset_version_id: VERSION, approval_event_id: APPROVAL, finding_key: "possible_cause:0", finding_fingerprint: "b".repeat(64),
    transition_number: 1, decision: "follow_up_requested", reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP,
    occurred_at: NOW.toISOString(), rationale: "Review the synthetic process setting.", previous_event_id: null,
    request_id: trace().request_id, correlation_id: trace().correlation_id, idempotency_key: "review-one", request_fingerprint: "c".repeat(64),
  };
  const repository = {
    reserveReport: vi.fn(async () => ({ status: "reserved" as const, report })),
    completeReport: vi.fn(async (_tx: unknown, _org: string, _id: string, value: unknown) => ({ ...report, status: "complete" as const, result: value as typeof result, result_fingerprint: "d".repeat(64), finalized_at: NOW.toISOString() })),
    failReport: vi.fn(async () => undefined),
    findReport: vi.fn(async () => ({ ...report, status: "complete" as const, result, result_fingerprint: "d".repeat(64), finalized_at: NOW.toISOString() })),
    listReviewHistory: vi.fn(async () => ({ current_transition_number: 1, events: [reviewEvent] })),
    appendReview: vi.fn(async () => ({ status: "applied" as const, event: reviewEvent })),
  };
  const authorizeRead = vi.fn(async () => options.readAllowed === false
    ? { allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const }
    : { allowed: true as const, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER });
  const authorizeReview = vi.fn(async () => options.reviewAllowed === false
    ? { allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const }
    : { allowed: true as const, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER });
  const qualityRepository = {
    findApprovedDatasetVersion: vi.fn(async () => options.approval === "revoked"
      ? { status: "not_approved" as const, decision: "revoked" as const }
      : { status: "approved" as const, snapshot: { dataset: { dataset_id: DATASET } }, approval: { approval_event_id: APPROVAL } } as never),
  };
  const appendAudit = vi.fn(async (event: unknown) => {
    void event;
    return { status: "appended" as const, event_id: "51000000-0000-4000-8000-000000000016" as never };
  });
  const transactionErrors: string[] = [];
  const deps: QualityDataStage3DServiceDependencies = {
    quality_data: {
      repository: qualityRepository as never, authorizer: { authorizeRead },
      clock: { now: () => new Date(NOW) },
    } as never,
    model_client: { generate: vi.fn() }, generate_handle: () => "51000000-0000-4000-8000-000000000011",
    record_telemetry: async () => undefined,
    repository: repository as never,
    audit_repository: { appendEvent: appendAudit } as never,
    transaction_manager: { runInTransaction: async (_trace: unknown, action: (tx: object) => Promise<unknown>) => {
      try { return await action({}); } catch (error) { transactionErrors.push(String(error)); throw error; }
    } } as never,
    authorizer: { authorizeRead, authorizeIntelligenceReview: authorizeReview },
    ids: { audit_event_id: () => "51000000-0000-4000-8000-000000000016" as never, uuid: () => REPORT },
    clock: { now: () => new Date(NOW) },
  };
  return { deps, repository, appendAudit, authorizeRead, authorizeReview, transactionErrors };
}

describe("Stage 3D intelligence review service", () => {
  beforeEach(() => {
    interpret.mockReset().mockResolvedValue({ status: "complete", result });
    calculate.mockReset(); detect.mockReset(); buildPacket.mockReset();
  });

  it("persists a versioned deterministic-only report with cell provenance and zero provider calls", async () => {
    const deps = dependencies();
    const handle = "51000000-0000-4000-8000-000000000021";
    const citation = { handle, record_id: "51000000-0000-4000-8000-000000000012", record_ordinal: 3,
      source_worksheet: "Synthetic Inspections", source_row_number: 4, source_cells: ["B4", "C4"],
      source_id: "51000000-0000-4000-8000-000000000013", source_version_id: "51000000-0000-4000-8000-000000000014", source_sha256: "a".repeat(64) };
    calculate.mockResolvedValue({ status: "complete", result: {} });
    detect.mockResolvedValue({ status: "complete", result: {} });
    buildPacket.mockReturnValue({ packet: { schema_version: "quality-evidence-packet-1.0.0", packet_id: "51000000-0000-4000-8000-000000000022",
      calculation_versions: ["quality-analysis-1.0.0", "quality-signal-calculation-1.0.0"], time_windows: ["ALL_APPROVED_RECORDS"],
      assumptions: ["EXTERNAL_AI_NOT_REQUESTED"], data_quality_limitations: [],
      calculations: [{ reference: "M1", kind: "NUMERIC_SUMMARY", status: "COMPLETE", sample_size: 3, numerator_count: 3,
        denominator_count: 3, excluded_counts: { missing_field: 0, missing_value: 0, non_numeric: 0 }, unit: "COUNT", value: 4,
        minimum: 1, maximum: 2, evidence_handles: [handle] }], signals: [] }, citations: new Map([[handle, citation]]) });
    const deterministicRequest = { schema_version: "quality-data-deterministic-analysis-request-1.0.0", mode: "deterministic_only",
      dataset_version_id: VERSION, metrics: [{ metric_id: "defects", kind: "numeric_summary", field_key: "defect_count" }],
      signals: [{ signal_id: "failure-mode", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode",
        minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }] };
    const created = await createQualityDataDeterministicReport(deps.deps, context(), trace("deterministic-one"), deterministicRequest);
    expect(created).toMatchObject({ status: "complete", replayed: false, report: { result: {
      schema_version: "quality-data-deterministic-analysis-result-1.0.0", mode: "deterministic_only",
      interpretation_status: "not_requested", interpretation: null,
      evidence_citations: [{ source_row_number: 4, source_cells: ["B4", "C4"], source_sha256: "a".repeat(64) }],
    } } });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(deps.repository.completeReport).toHaveBeenCalledTimes(1);
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
    expect(interpret).not.toHaveBeenCalled();
    expect(deps.deps.model_client.generate).not.toHaveBeenCalled();

    deps.repository.completeReport.mockRejectedValueOnce(new Error("QUALITY_DATA_INTELLIGENCE_APPROVAL_REVOKED"));
    const revokedDuringCalculation = await createQualityDataDeterministicReport(deps.deps, context(), trace("deterministic-revoked-before-commit"), deterministicRequest);
    expect(revokedDuringCalculation.status).toBe("not_approved");
    expect(deps.repository.failReport).toHaveBeenCalledWith(expect.anything(), ORG, REPORT, "NOT_APPROVED", expect.any(String));
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
    expect(interpret).not.toHaveBeenCalled();
  });

  it("reserves and persists an integrated report; an idempotent replay returns it without a second model dispatch", async () => {
    const deps = dependencies();
    const created = await createQualityDataIntelligenceReport(deps.deps, context(), trace(), request);
    expect(deps.transactionErrors).toEqual([]);
    expect(created).toMatchObject({ status: "complete", replayed: false, report: { status: "complete", result: { source_verification: "not_asserted", interpretation_status: "unverified_advisory_hypotheses" } } });
    expect(deps.repository.reserveReport).toHaveBeenCalledTimes(1);
    expect(deps.repository.completeReport).toHaveBeenCalledTimes(1);
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);

    (deps.repository.reserveReport as unknown as { mockImplementationOnce: (callback: () => Promise<unknown>) => unknown }).mockImplementationOnce(async () => ({
      status: "existing", report: { report_id: REPORT, organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION,
        approval_event_id: APPROVAL, requested_by_user_id: USER, requested_by_membership_id: MEMBERSHIP, request_payload: request,
        request_fingerprint: "a".repeat(64), status: "complete", result, result_fingerprint: "d".repeat(64), failure_code: null,
        request_id: trace().request_id, correlation_id: trace().correlation_id, created_at: NOW.toISOString(), finalized_at: NOW.toISOString() },
    }));
    const replay = await createQualityDataIntelligenceReport(deps.deps, context(), trace(), request);
    expect(replay).toMatchObject({ status: "complete", replayed: true });
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing read permission, revoked approval, unknown findings, and missing reviewer permission", async () => {
    const noRead = dependencies({ readAllowed: false });
    expect((await createQualityDataIntelligenceReport(noRead.deps, context(), trace(), request)).status).toBe("denied");
    expect(interpret).not.toHaveBeenCalled();

    const revoked = dependencies({ approval: "revoked" });
    expect((await getQualityDataIntelligenceReport(revoked.deps, context(), REPORT)).status).toBe("not_approved");

    const unknown = dependencies();
    const unknownFinding = await reviewQualityDataIntelligenceFinding(unknown.deps, context(), trace("review-unknown"), {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: REPORT, finding_key: "possible_cause:7",
      expected_transition_number: 0, decision: "acknowledged", rationale: "A valid rationale",
    });
    expect(unknownFinding.status).toBe("invalid_request");
    expect(unknown.repository.appendReview).not.toHaveBeenCalled();

    const noReviewerPermission = dependencies({ reviewAllowed: false });
    const denied = await reviewQualityDataIntelligenceFinding(noReviewerPermission.deps, context(), trace("review-denied"), {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: REPORT, finding_key: "possible_cause:0",
      expected_transition_number: 0, decision: "follow_up_requested", rationale: "A valid reviewer rationale",
    });
    expect(denied.status).toBe("denied");
    expect(noReviewerPermission.repository.appendReview).not.toHaveBeenCalled();
  });

  it("records explicit review decisions and appends audit in the same transaction", async () => {
    const deps = dependencies();
    const reviewed = await reviewQualityDataIntelligenceFinding(deps.deps, context(), trace("review-one"), {
      schema_version: "quality-data-intelligence-review-1.0.0", report_id: REPORT, finding_key: "possible_cause:0",
      expected_transition_number: 0, decision: "follow_up_requested", rationale: "Check the inspected process setting.",
    });
    expect(deps.transactionErrors).toEqual([]);
    expect(reviewed).toMatchObject({ status: "applied", event: { decision: "follow_up_requested", transition_number: 1, finding_key: "possible_cause:0" } });
    expect(deps.repository.appendReview).toHaveBeenCalledTimes(1);
    expect(deps.appendAudit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(deps.appendAudit.mock.calls[0]?.[0])).not.toContain("process setting");
  });
});
