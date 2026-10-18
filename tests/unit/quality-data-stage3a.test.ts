import { describe, expect, it, vi } from "vitest";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import type { QualityDataDatasetSnapshot } from "../../lib/database/repositories/quality-data-repository";
import type { QualityDataStage3ARepository } from "../../lib/database/repositories/quality-data-stage3a-repository";
import type { QualityDataApprovalAppendInput, QualityDataApprovalAppendResult, QualityDataApprovalSummary, QualityDataApprovedSnapshotResult } from "../../lib/database/repositories/quality-data-stage3a-repository";
import type { QualityDataReadScope } from "../../lib/database/repositories/quality-data-repository";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";
import type { TransactionContext, TransactionManager } from "../../lib/database/transactions";
import { analyzeQualityDatasetVersion, getQualityDataDatasetVersionApproval, transitionQualityDataDatasetVersionApproval, type QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";

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
});
