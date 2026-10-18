import { describe, expect, it, vi } from "vitest";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import type { QualityDataDatasetSnapshot } from "../../lib/database/repositories/quality-data-repository";
import type { QualityDataStage3ARepository } from "../../lib/database/repositories/quality-data-stage3a-repository";
import type { QualityDataApprovalAppendInput, QualityDataApprovalAppendResult, QualityDataApprovalSummary, QualityDataApprovedSnapshotResult } from "../../lib/database/repositories/quality-data-stage3a-repository";
import type { QualityDataReadScope } from "../../lib/database/repositories/quality-data-repository";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";
import type { TransactionContext, TransactionManager } from "../../lib/database/transactions";
import { analyzeQualityDatasetVersion, detectQualityDatasetSignals, getQualityDataDatasetVersionApproval, transitionQualityDataDatasetVersionApproval, type QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const USER = "11000000-0000-4000-8000-000000000001";
const ORG = "11000000-0000-4000-8000-000000000002";
const MEMBERSHIP = "11000000-0000-4000-8000-000000000003";
const DATASET = "11000000-0000-4000-8000-000000000004";
const VERSION = "11000000-0000-4000-8000-000000000005";
const SOURCE = "11000000-0000-4000-8000-000000000006";
const SOURCE_VERSION = "11000000-0000-4000-8000-000000000007";
const APPROVAL_EVENT = "11000000-0000-4000-8000-000000000008";
const SHA = "a".repeat(64);

function context(): CapaRequestContext {
  return {
    owner_user_id: USER as never,
    authentication: {
      principal: { principal_type: "human", user_id: USER as never },
      session_id: "session-1" as never,
      authentication_method: "SUPABASE_SESSION" as never,
      assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-10-18T11:00:00.000Z" as never,
      expires_at: "2026-10-18T13:00:00.000Z" as never,
    },
    tenant: {
      organization_id: ORG as never,
      access_grant_id: MEMBERSHIP as never,
      access_path: "SUPABASE_MEMBERSHIP" as never,
      authorization_policy_version: "policy-1.0.0",
      resolved_at: NOW.toISOString() as never,
      role_assignments: [{
        role_assignment_id: "11000000-0000-4000-8000-000000000009" as never,
        role_id: "CAPA_ORG_ADMIN" as never,
        scope: "ORGANIZATION" as never,
        effective_at: "2026-10-18T10:00:00.000Z" as never,
      }],
    },
  };
}

function snapshot(): QualityDataDatasetSnapshot {
  return {
    dataset: { organization_id: ORG, dataset_id: DATASET, dataset_key: "inspection", dataset_name: "Inspection" },
    version: { dataset_version_id: VERSION, version_number: 1, schema_version: "inspection-1.0.0", review_state: "review_required", created_at: NOW.toISOString() },
    source_versions: [{
      source_id: SOURCE, source_version_id: SOURCE_VERSION, source_sha256: SHA,
      original_source_version: "rev-1", source_name: "Synthetic.xlsx",
    }],
    records: [
      { record_id: "11000000-0000-4000-8000-000000000011", record_ordinal: 1, source_worksheet: "Inspection", source_row_number: 2, fields: [
        { field_id: "11000000-0000-4000-8000-000000000021", field_key: "reject_count", field_ordinal: 1, value_type: "number", original_value: 2, normalized_value: 2, normalized_unit: "count", source_worksheet: "Inspection", source_row_number: 2, source_cell_reference: "B2" },
      ] },
      { record_id: "11000000-0000-4000-8000-000000000012", record_ordinal: 2, source_worksheet: "Inspection", source_row_number: 3, fields: [
        { field_id: "11000000-0000-4000-8000-000000000022", field_key: "reject_count", field_ordinal: 1, value_type: "number", original_value: 4, normalized_value: 4, normalized_unit: "count", source_worksheet: "Inspection", source_row_number: 3, source_cell_reference: "B3" },
      ] },
      { record_id: "11000000-0000-4000-8000-000000000013", record_ordinal: 3, source_worksheet: "Inspection", source_row_number: 4, fields: [
        { field_id: "11000000-0000-4000-8000-000000000023", field_key: "lot", field_ordinal: 1, value_type: "text", original_value: "LOT-3", normalized_value: "LOT-3", normalized_unit: null, source_worksheet: "Inspection", source_row_number: 4, source_cell_reference: "A4" },
      ] },
    ],
    validation_outcomes: [],
  };
}

function signalSnapshot(rows: readonly { date: string | null; defects: number | null; quantity: number | null; mode: string | null; omit?: readonly string[] }[] = [
  { date: "2026-01-03", defects: 2, quantity: 100, mode: "seal_leak" },
  { date: "2026-01-10", defects: 1, quantity: 100, mode: "seal_leak" },
  { date: "2026-01-17", defects: 1, quantity: 100, mode: "crack" },
  { date: "2026-02-02", defects: 5, quantity: 100, mode: "seal_leak" },
  { date: "2026-02-09", defects: 4, quantity: 100, mode: "dent" },
  { date: "2026-02-16", defects: 3, quantity: 100, mode: "dent" },
]) {
  const data = snapshot();
  return {
    ...data,
    records: rows.map((row, index) => {
      const ordinal = index + 1;
      const rowNumber = ordinal + 1;
      const makeField = (suffix: string, field_key: string, value_type: string, original_value: unknown, normalized_value: unknown, normalized_unit: string | null, column: string) => ({
        field_id: `11000000-0000-4000-8000-${String(ordinal * 10 + Number(suffix)).padStart(12, "0")}`,
        field_key, field_ordinal: Number(suffix), value_type, original_value, normalized_value, normalized_unit,
        source_worksheet: "Inspection", source_row_number: rowNumber, source_cell_reference: `${column}${rowNumber}`,
      });
      const fields = [
        makeField("1", "defect_count", row.defects === null ? "blank" : "number", row.defects, row.defects, "count", "B"),
        makeField("2", "production_quantity", row.quantity === null ? "blank" : "number", row.quantity, row.quantity, "unit", "C"),
        makeField("3", "observation_date", row.date === null ? "blank" : "date", row.date, row.date, null, "D"),
        makeField("4", "failure_mode", row.mode === null ? "blank" : "text", row.mode, row.mode, null, "E"),
      ].filter((field) => !row.omit?.includes(field.field_key));
      return {
        record_id: `21000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
        record_ordinal: ordinal,
        source_worksheet: "Inspection",
        source_row_number: rowNumber,
        fields,
      };
    }),
  } as QualityDataDatasetSnapshot;
}

function dependencies(options: { readonly approvalResult?: unknown; readonly approved?: boolean; readonly readAllowed?: boolean; readonly approveAllowed?: boolean } = {}) {
  let lastApprovalInput: unknown;
  const repository: QualityDataStage3ARepository = {
    appendVersionApproval: vi.fn(async (_transaction: TransactionContext, input: QualityDataApprovalAppendInput): Promise<QualityDataApprovalAppendResult> => {
      lastApprovalInput = input;
      return (options.approvalResult as QualityDataApprovalAppendResult | undefined) ?? {
        status: "applied",
        state: {
          organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION,
          decision: input.command.decision, approval_event_id: APPROVAL_EVENT,
          transition_number: input.command.expected_transition_number + 1,
          reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP,
          occurred_at: NOW.toISOString(), rationale: input.command.rationale,
        },
      };
    }),
    findApprovedDatasetVersion: vi.fn(async (scope: QualityDataReadScope): Promise<QualityDataApprovedSnapshotResult | null> => {
      if (scope.organization_id !== ORG || options.approved === false) {
        return options.approved === false ? { status: "not_approved", decision: "revoked" } : null;
      }
      return {
        status: "approved",
        snapshot: snapshot(),
        approval: {
          organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION,
          decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1,
          reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved for analysis",
        },
      } as never;
    }),
    findVersionApprovalSummary: vi.fn(async (scope: QualityDataReadScope): Promise<QualityDataApprovalSummary | null> => scope.organization_id !== ORG ? null : ({
      dataset_id: DATASET, dataset_version_id: VERSION, current_decision: "approved", transition_number: 1,
      current_event: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION,
        decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1,
        reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved for analysis" },
    })),
  };
  const auditAppend = vi.fn(async (_transaction, event) => ({ status: "appended" as const, event_id: event.event_id }));
  const deps: QualityDataStage3AServiceDependencies = {
    repository,
    audit_repository: { appendEvent: auditAppend } as never,
    transaction_manager: { runInTransaction: async <Result>(_trace: RequestTrace, work: (transaction: TransactionContext) => Promise<Result>): Promise<Result> => work({ transaction_id: "tx" as never, started_at: NOW.toISOString() as never, request_trace: {} as never }) } satisfies TransactionManager,
    authorizer: {
      authorizeRead: vi.fn(async () => options.readAllowed === false ? { allowed: false as const, reason_code: "ACTIVE_ORG_ADMIN_REQUIRED" as const } : { allowed: true as const, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER }),
      authorizeApproval: vi.fn(async () => options.approveAllowed === false ? { allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const } : { allowed: true as const, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER }),
    },
    ids: { audit_event_id: () => "11000000-0000-4000-8000-000000000099" as never, uuid: () => "11000000-0000-4000-8000-000000000088" },
    clock: { now: () => new Date(NOW) },
  };
  return { deps, repository, auditAppend, getLastApprovalInput: () => lastApprovalInput };
}

const trace = { request_id: "11000000-0000-4000-8000-000000000031" as never, correlation_id: "11000000-0000-4000-8000-000000000032" as never, idempotency_key: "approval-1" as never };
const analysisRequest = {
  schema_version: "quality-analysis-request-1.0.0",
  dataset_version_id: VERSION,
  time_window: { kind: "all_records_in_dataset_version" },
  metrics: [
    { metric_id: "reject-completeness", kind: "field_completeness", field_key: "reject_count" },
    { metric_id: "reject-summary", kind: "numeric_summary", field_key: "reject_count" },
  ],
};

describe("Layer 2 Stage 3A quality-data governance and deterministic analysis", () => {
  it("records an explicit approval atomically with the CAPA audit and permits uploader-admin self-approval", async () => {
    const fixture = dependencies();
    const result = await transitionQualityDataDatasetVersionApproval(fixture.deps, context(), trace, {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: VERSION,
      decision: "approved", expected_transition_number: 0, rationale: "Approved for analytical use",
    });
    expect(result.status).toBe("applied");
    expect(fixture.getLastApprovalInput()).toEqual(expect.objectContaining({
      organization_id: ORG, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP,
      request_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(fixture.auditAppend).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "QUALITY_DATA_VERSION_APPROVED",
      metadata: expect.objectContaining({ analytical_use_only: true, source_verification_asserted: false }),
    }));
  });

  it("does not append duplicate audit events on an exact idempotent approval replay", async () => {
    const fixture = dependencies({ approvalResult: {
      status: "already_recorded",
      state: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved for analysis" },
    } });
    const result = await transitionQualityDataDatasetVersionApproval(fixture.deps, context(), trace, {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: VERSION,
      decision: "approved", expected_transition_number: 0, rationale: "Approved for analysis",
    });
    expect(result.status).toBe("already_recorded");
    expect(fixture.auditAppend).not.toHaveBeenCalled();
  });

  it("returns approval history only to an authorized human approver for the resolved tenant", async () => {
    const fixture = dependencies();
    const result = await getQualityDataDatasetVersionApproval(fixture.deps, context(), VERSION);
    expect(result).toMatchObject({ status: "found", summary: { dataset_id: DATASET, current_decision: "approved", transition_number: 1 } });
    expect(fixture.repository.findVersionApprovalSummary).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: ORG, user_id: USER, membership_id: MEMBERSHIP,
    }), VERSION);

    const denied = dependencies({ approveAllowed: false });
    await expect(getQualityDataDatasetVersionApproval(denied.deps, context(), VERSION)).resolves.toEqual({ status: "denied" });
    expect(denied.repository.findVersionApprovalSummary).not.toHaveBeenCalled();
  });

  it("rejects absent approval permission and requires an idempotency key", async () => {
    const denied = dependencies({ approveAllowed: false });
    await expect(transitionQualityDataDatasetVersionApproval(denied.deps, context(), trace, {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: VERSION,
      decision: "approved", expected_transition_number: 0, rationale: "Approved",
    })).resolves.toEqual({ status: "denied" });
    const missingKey = dependencies();
    await expect(transitionQualityDataDatasetVersionApproval(missingKey.deps, context(), { ...trace, idempotency_key: undefined }, {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: VERSION,
      decision: "approved", expected_transition_number: 0, rationale: "Approved",
    })).resolves.toEqual({ status: "invalid_request", reason_code: "IDEMPOTENCY_KEY_REQUIRED" });
  });

  it("calculates bounded completeness and numeric summaries with exact provenance", async () => {
    const fixture = dependencies();
    const result = await analyzeQualityDatasetVersion(fixture.deps, context(), analysisRequest);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.result).toMatchObject({
      authorization_scope: "analytical_use_only",
      source_verification: "not_asserted",
      denominator_definition: "all records in the approved immutable dataset version",
      record_count: 3,
      advisory_interpretation: { status: "not_requested", content: null },
    });
    expect(result.result.metrics[0]).toMatchObject({
      status: "complete", numerator_record_count: 2, denominator_record_count: 3,
      value: (2 / 3) * 100, unit: "%", exclusions: { missing_field: 1, missing_value: 0, non_numeric: 0 },
    });
    expect(result.result.metrics[1]).toMatchObject({
      status: "complete", numerator_record_count: 2, denominator_record_count: 3,
      value: 3, minimum: 2, maximum: 4, unit: "count",
      exclusions: { missing_field: 1, missing_value: 0, non_numeric: 0 },
    });
    expect(result.result.metrics[1]?.calculation_inputs[0]).toMatchObject({
      dataset_version_id: VERSION, source_version_id: SOURCE_VERSION, source_sha256: SHA,
      record_id: "11000000-0000-4000-8000-000000000011", source_cell_reference: "B2", normalized_value: 2,
    });
  });

  it("fails closed when the version is absent, rejected or revoked, or the read permission is denied", async () => {
    const revoked = dependencies({ approved: false });
    await expect(analyzeQualityDatasetVersion(revoked.deps, context(), analysisRequest)).resolves.toEqual({ status: "not_approved", decision: "revoked" });
    expect(revoked.repository.findApprovedDatasetVersion).toHaveBeenCalledWith(expect.objectContaining({ organization_id: ORG }), VERSION);
    const crossTenant = dependencies();
    vi.mocked(crossTenant.repository.findApprovedDatasetVersion).mockResolvedValueOnce(null);
    await expect(analyzeQualityDatasetVersion(crossTenant.deps, context(), analysisRequest)).resolves.toEqual({ status: "not_found_or_not_authorized" });
    const noRead = dependencies({ readAllowed: false });
    await expect(analyzeQualityDatasetVersion(noRead.deps, context(), analysisRequest)).resolves.toEqual({ status: "denied" });
    expect(noRead.repository.findApprovedDatasetVersion).not.toHaveBeenCalled();
  });

  it("reports missing fields and mixed normalized units without fabricating a metric", async () => {
    const missing = dependencies();
    const result = await analyzeQualityDatasetVersion(missing.deps, context(), {
      ...analysisRequest,
      metrics: [{ metric_id: "missing", kind: "numeric_summary", field_key: "not_present" }],
    });
    expect(result.status).toBe("missing_data");
    if (result.status === "missing_data") expect(result.result.metrics[0]).toMatchObject({ reason_code: "FIELD_NOT_PRESENT", numerator_record_count: 0, denominator_record_count: 3, value: null });

    const mixed = dependencies();
    const data = snapshot();
    (data.records[1] as { fields: Array<Record<string, unknown>> }).fields[0]!.normalized_unit = "piece";
    vi.mocked(mixed.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved",
      snapshot: data,
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    } as never);
    const mixedResult = await analyzeQualityDatasetVersion(mixed.deps, context(), {
      ...analysisRequest,
      metrics: [{ metric_id: "mixed", kind: "numeric_summary", field_key: "reject_count" }],
    });
    expect(mixedResult.status).toBe("partial");
    if (mixedResult.status === "partial") expect(mixedResult.result.metrics[0]).toMatchObject({ status: "unit_mismatch", value: null, reason_code: "MIXED_UNITS" });
  });

  it("detects explicit recurring failure modes and threshold rates with exact approved-version cell provenance", async () => {
    const fixture = dependencies();
    vi.mocked(fixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: signalSnapshot(),
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved for analysis" },
    });
    const result = await detectQualityDatasetSignals(fixture.deps, context(), {
      schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION,
      signals: [
        { signal_id: "recurring-seal", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } },
        { signal_id: "high-rate", kind: "defect_rate_threshold", defect_count_field_key: "defect_count", production_quantity_field_key: "production_quantity", observation_date_field_key: "observation_date", production_quantity_unit: "unit", rate_per: 100, threshold: 3, minimum_records_per_window: 3, time_window: { kind: "calendar_month" } },
      ],
    });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.result).toMatchObject({
      schema_version: "quality-signal-result-1.0.0", authorization_scope: "analytical_use_only",
      source_verification: "not_asserted", causal_explanation: "not_assessed", regulatory_conclusion: "not_assessed",
      dataset: { dataset_version_id: VERSION, approval_event_id: APPROVAL_EVENT, approval_transition_number: 1 },
    });
    expect(result.result.signals[0]).toMatchObject({
      kind: "recurring_category", status: "detected", sample_record_count: 6,
      observed_patterns: expect.arrayContaining([expect.objectContaining({ value: "seal_leak", occurrence_count: 3, evidence: expect.arrayContaining([expect.objectContaining({ source_row_number: 2, cells: [expect.objectContaining({ field_key: "failure_mode", source_cell_reference: "E2" })] })]) })]),
    });
    expect(result.result.signals[1]).toMatchObject({
      kind: "defect_rate_threshold", status: "detected",
      rate_definition: { formula: "sum(defect_count) / sum(production_quantity) * rate_per", threshold: 3, production_quantity_unit: "unit" },
      buckets: expect.arrayContaining([expect.objectContaining({ period: "2026-01", rate: expect.closeTo(4 / 3), triggered: false, calculation_inputs: expect.arrayContaining([expect.objectContaining({ source_row_number: 2, cells: expect.arrayContaining([expect.objectContaining({ field_key: "defect_count", source_cell_reference: "B2" })]) })]) }), expect.objectContaining({ period: "2026-02", rate: 4, triggered: true })]),
    });
  });

  it("detects only configured adjacent monthly rate trends and reports sparse windows", async () => {
    const fixture = dependencies();
    vi.mocked(fixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: signalSnapshot(),
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    const result = await detectQualityDatasetSignals(fixture.deps, context(), {
      schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION,
      signals: [{ signal_id: "monthly-uptrend", kind: "defect_rate_trend", defect_count_field_key: "defect_count", production_quantity_field_key: "production_quantity", observation_date_field_key: "observation_date", production_quantity_unit: "unit", rate_per: 100, direction: "increase", minimum_absolute_change: 2, minimum_records_per_window: 3, time_window: { kind: "calendar_month" } }],
    });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.result.signals[0]).toMatchObject({
      kind: "defect_rate_trend", status: "detected",
      comparisons: [{ from_period: "2026-01", to_period: "2026-02", status: "evaluated", change: expect.closeTo(2.666666666666667), absolute_change: expect.closeTo(2.666666666666667), triggered: true, calculation_inputs: expect.arrayContaining([expect.objectContaining({ cells: expect.arrayContaining([expect.objectContaining({ field_key: "observation_date" })]) })]) }],
    });

    const sparse = dependencies();
    vi.mocked(sparse.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: signalSnapshot([
        { date: "2026-01-03", defects: 2, quantity: 100, mode: "A" },
        { date: "2026-01-10", defects: 1, quantity: 100, mode: "A" },
        { date: "2026-01-17", defects: 1, quantity: 100, mode: "A" },
        { date: "2026-02-02", defects: 5, quantity: 100, mode: "A" },
        { date: "2026-02-09", defects: 4, quantity: 100, mode: "A" },
        { date: "2026-02-16", defects: 3, quantity: 100, mode: "A" },
        { date: "2026-03-02", defects: 2, quantity: 100, mode: "A" },
      ]),
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    const sparseResult = await detectQualityDatasetSignals(sparse.deps, context(), {
      schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION,
      signals: [{ signal_id: "sparse-trend", kind: "defect_rate_trend", defect_count_field_key: "defect_count", production_quantity_field_key: "production_quantity", observation_date_field_key: "observation_date", production_quantity_unit: "unit", rate_per: 100, direction: "either", minimum_absolute_change: 1, minimum_records_per_window: 3, time_window: { kind: "calendar_month" } }],
    });
    expect(sparseResult.status).toBe("partial");
    if (sparseResult.status === "partial") expect(sparseResult.result.signals[0]).toMatchObject({ status: "partial", comparisons: expect.arrayContaining([expect.objectContaining({ status: "insufficient_data", reason_code: "INSUFFICIENT_SAMPLE" })]) });
  });

  it("explicitly excludes invalid dates, missing values, invalid counts, zero denominators, and small samples", async () => {
    const fixture = dependencies();
    const data = signalSnapshot([
      { date: "2026-01-01", defects: 1, quantity: 10, mode: "A" },
      { date: "2026-01-02", defects: 0, quantity: 0, mode: "A" },
      { date: "2026-02-30", defects: 2, quantity: 10, mode: "B" },
      { date: "2026-01-04", defects: -1, quantity: 10, mode: "B" },
      { date: null, defects: null, quantity: 10, mode: null },
    ]);
    vi.mocked(fixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: data,
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    const result = await detectQualityDatasetSignals(fixture.deps, context(), {
      schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION,
      signals: [{ signal_id: "sparse-rate", kind: "defect_rate_threshold", defect_count_field_key: "defect_count", production_quantity_field_key: "production_quantity", observation_date_field_key: "observation_date", production_quantity_unit: "unit", rate_per: 100, threshold: 2, minimum_records_per_window: 3, time_window: { kind: "calendar_month" } }],
    });
    expect(result.status).toBe("insufficient_data");
    if (result.status !== "insufficient_data") return;
    expect(result.result.signals[0]).toMatchObject({
      status: "insufficient_data", reason_code: "NO_VALID_WINDOWS",
      exclusions: { invalid_date: 1, invalid_number: 1, zero_denominator: 1, missing_value: 1 },
      excluded_inputs: expect.arrayContaining([expect.objectContaining({ reason: "invalid_date" }), expect.objectContaining({ reason: "zero_denominator" }), expect.objectContaining({ reason: "missing_value" })]),
    });
  });

  it("rejects unsupported units and duplicate source-row identities without producing signals", async () => {
    const fixture = dependencies();
    const wrongUnit = signalSnapshot();
    const firstRecord = wrongUnit.records[0] as { fields: Array<Record<string, unknown>> };
    firstRecord.fields.find((field) => field.field_key === "production_quantity")!.normalized_unit = "case";
    vi.mocked(fixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: wrongUnit,
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    const request = { schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION, signals: [{ signal_id: "unit-check", kind: "defect_rate_threshold", defect_count_field_key: "defect_count", production_quantity_field_key: "production_quantity", observation_date_field_key: "observation_date", production_quantity_unit: "unit", rate_per: 100, threshold: 2, minimum_records_per_window: 3, time_window: { kind: "calendar_month" } }] };
    const unsupported = await detectQualityDatasetSignals(fixture.deps, context(), request);
    expect(unsupported.status).toBe("insufficient_data");
    if (unsupported.status === "insufficient_data") expect(unsupported.result.signals[0]).toMatchObject({ status: "unsupported_schema", reason_code: "UNIT_MISMATCH" });

    const typeMismatch = signalSnapshot();
    for (const record of typeMismatch.records as Array<{ fields: Array<Record<string, unknown>> }>) {
      const quantity = record.fields.find((field) => field.field_key === "production_quantity")!;
      quantity.value_type = "text";
      quantity.original_value = String(quantity.original_value);
      quantity.normalized_value = String(quantity.normalized_value);
    }
    const typeFixture = dependencies();
    vi.mocked(typeFixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: typeMismatch,
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    const mismatch = await detectQualityDatasetSignals(typeFixture.deps, context(), request);
    expect(mismatch.status).toBe("insufficient_data");
    if (mismatch.status === "insufficient_data") expect(mismatch.result.signals[0]).toMatchObject({ status: "unsupported_schema", reason_code: "FIELD_TYPE_MISMATCH" });

    const missingField = signalSnapshot(Array.from({ length: 6 }, (_, index) => ({ date: `2026-${index < 3 ? "01" : "02"}-${String(index + 1).padStart(2, "0")}`, defects: index, quantity: 100, mode: "A", omit: ["defect_count"] })));
    const missingFixture = dependencies();
    vi.mocked(missingFixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: missingField,
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    const missing = await detectQualityDatasetSignals(missingFixture.deps, context(), request);
    expect(missing.status).toBe("insufficient_data");
    if (missing.status === "insufficient_data") expect(missing.result.signals[0]).toMatchObject({ status: "unsupported_schema", reason_code: "FIELD_NOT_PRESENT" });

    const longSpan = signalSnapshot([
      { date: "2010-01-01", defects: 1, quantity: 100, mode: "A" },
      { date: "2020-02-01", defects: 1, quantity: 100, mode: "A" },
    ]);
    const spanFixture = dependencies();
    vi.mocked(spanFixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: longSpan,
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    const span = await detectQualityDatasetSignals(spanFixture.deps, context(), request);
    expect(span.status).toBe("insufficient_data");
    if (span.status === "insufficient_data") expect(span.result.signals[0]).toMatchObject({ status: "unsupported_configuration", reason_code: "TIME_WINDOW_LIMIT_EXCEEDED" });

    const duplicate = signalSnapshot();
    const records = duplicate.records as Array<Record<string, unknown>>;
    records[1] = { ...records[1], record_id: records[0]!.record_id };
    const other = dependencies();
    vi.mocked(other.repository.findApprovedDatasetVersion).mockResolvedValueOnce({
      status: "approved", snapshot: duplicate,
      approval: { organization_id: ORG, dataset_id: DATASET, dataset_version_id: VERSION, decision: "approved", approval_event_id: APPROVAL_EVENT, transition_number: 1, reviewer_user_id: USER, reviewer_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Approved" },
    });
    await expect(detectQualityDatasetSignals(other.deps, context(), request)).resolves.toEqual({ status: "calculation_error", reason_code: "DUPLICATE_SOURCE_RECORD" });
  });

  it("fails closed for absent, rejected, revoked, cross-tenant, and unauthorized approved snapshots", async () => {
    for (const decision of ["none", "rejected", "revoked"] as const) {
      const fixture = dependencies({ approved: false });
      vi.mocked(fixture.repository.findApprovedDatasetVersion).mockResolvedValueOnce({ status: "not_approved", decision });
      await expect(detectQualityDatasetSignals(fixture.deps, context(), { schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION, signals: [{ signal_id: "r", kind: "recurring_category", semantic_role: "defect_code", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }] })).resolves.toEqual({ status: "not_approved", decision });
    }
    const crossTenant = dependencies();
    vi.mocked(crossTenant.repository.findApprovedDatasetVersion).mockResolvedValueOnce(null);
    await expect(detectQualityDatasetSignals(crossTenant.deps, context(), { schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION, signals: [{ signal_id: "r", kind: "recurring_category", semantic_role: "defect_code", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }] })).resolves.toEqual({ status: "not_found_or_not_authorized" });
    const denied = dependencies({ readAllowed: false });
    await expect(detectQualityDatasetSignals(denied.deps, context(), { schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION, signals: [{ signal_id: "r", kind: "recurring_category", semantic_role: "defect_code", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }] })).resolves.toEqual({ status: "denied" });
    expect(denied.repository.findApprovedDatasetVersion).not.toHaveBeenCalled();
  });
});
