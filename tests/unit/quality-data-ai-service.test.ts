import { beforeEach, describe, expect, it, vi } from "vitest";

const analyze = vi.hoisted(() => vi.fn());
const detect = vi.hoisted(() => vi.fn());
vi.mock("../../lib/quality-data/quality-data-stage3a-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/quality-data/quality-data-stage3a-service")>()),
  analyzeQualityDatasetVersion: analyze,
  detectQualityDatasetSignals: detect,
}));

import { interpretQualityDataAnalysis } from "../../lib/quality-data/quality-data-ai-service";
import type { QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const USER = "11000000-0000-4000-8000-000000000001";
const ORG = "11000000-0000-4000-8000-000000000002";
const MEMBERSHIP = "11000000-0000-4000-8000-000000000003";
const VERSION = "11000000-0000-4000-8000-000000000005";
const APPROVAL = "11000000-0000-4000-8000-000000000008";
const SOURCE = "11000000-0000-4000-8000-000000000006";
const SOURCE_VERSION = "11000000-0000-4000-8000-000000000007";
const RECORD = "21000000-0000-4000-8000-000000000001";
const HANDLE = "31000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const requestTrace = { request_id: "11000000-0000-4000-8000-000000000031" as never, correlation_id: "11000000-0000-4000-8000-000000000032" as never };

function context(): CapaRequestContext {
  return {
    owner_user_id: USER as never,
    authentication: { principal: { principal_type: "human", user_id: USER as never }, session_id: "session" as never,
      authentication_method: "SUPABASE_SESSION" as never, assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-10-18T10:00:00.000Z" as never, expires_at: "2026-10-18T14:00:00.000Z" as never },
    tenant: { organization_id: ORG as never, access_grant_id: MEMBERSHIP as never, access_path: "SUPABASE_MEMBERSHIP" as never,
      authorization_policy_version: "policy", resolved_at: NOW.toISOString() as never,
      role_assignments: [{ role_assignment_id: "11000000-0000-4000-8000-000000000009" as never, role_id: "CAPA_ORG_ADMIN" as never, scope: "ORGANIZATION" as never, effective_at: "2026-10-18T10:00:00.000Z" as never }] },
  };
}

const request = {
  schema_version: "quality-data-ai-analysis-request-1.0.0", dataset_version_id: VERSION,
  metrics: [{ metric_id: "mean", kind: "numeric_summary", field_key: "reject_count" }],
  signals: [{ signal_id: "recurring", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }],
};

const analysis = {
  schema_version: "quality-analysis-result-1.0.0", calculation_version: "quality-analysis-calculation-1.0.0", analysis_id: "b".repeat(64), status: "complete",
  time_window: "all_records_in_dataset_version", denominator_definition: "all records in the approved immutable dataset version", authorization_scope: "analytical_use_only", source_verification: "not_asserted",
  dataset: { organization_id: ORG, dataset_id: VERSION, dataset_version_id: VERSION, version_number: 1, schema_version: "q-1", review_state: "review_required" },
  approval: { approval_event_id: APPROVAL, transition_number: 1, reviewer_user_id: USER, approved_at: NOW.toISOString() },
  sources: [{ source_id: SOURCE, source_version_id: SOURCE_VERSION, source_sha256: SHA, original_source_version: "1", source_name: "SensitiveSource.xlsx" }], record_count: 1,
  metrics: [{ metric_id: "mean", kind: "numeric_summary", field_key: "reject_count", status: "complete", denominator_record_count: 1, numerator_record_count: 1,
    exclusions: { missing_field: 0, missing_value: 0, non_numeric: 0 }, unit: "count", unit_status: "consistent", value: 3, minimum: 3, maximum: 3,
    calculation_inputs: [{ dataset_id: VERSION, dataset_version_id: VERSION, record_id: RECORD, record_ordinal: 1, field_id: VERSION, field_key: "reject_count", value_type: "number", original_value: 3, normalized_value: 3, normalized_unit: "count", source_id: SOURCE, source_version_id: SOURCE_VERSION, source_sha256: SHA, source_worksheet: "Sensitive Sheet", source_row_number: 2, source_cell_reference: "B2" }] }],
  advisory_interpretation: { status: "not_requested", content: null },
};
const detection = {
  schema_version: "quality-signal-result-1.0.0", calculation_version: "quality-signal-calculation-1.0.0", detection_id: "c".repeat(64), status: "complete", authorization_scope: "analytical_use_only", source_verification: "not_asserted", causal_explanation: "not_assessed", regulatory_conclusion: "not_assessed",
  dataset: { organization_id: ORG, dataset_id: VERSION, dataset_version_id: VERSION, version_number: 1, schema_version: "q-1", review_state: "review_required", approval_event_id: APPROVAL, approval_transition_number: 1 },
  sources: [{ source_id: SOURCE, source_version_id: SOURCE_VERSION, source_sha256: SHA }], record_count: 1,
  signals: [{ signal_id: "recurring", kind: "recurring_category", semantic_role: "failure_mode", field_key: "failure_mode", status: "detected", sample_record_count: 1, minimum_sample_size: 1, minimum_occurrences: 1,
    exclusions: { missing_field: 0, missing_value: 0, invalid_number: 0, invalid_date: 0, zero_denominator: 0, missing_provenance: 0 }, excluded_inputs: [],
    observed_patterns: [{ value: "LOT-12345-seal", occurrence_count: 1, evidence: [{ record_id: RECORD, record_ordinal: 1, source_worksheet: "Sensitive Sheet", source_row_number: 2, cells: [{ field_key: "failure_mode", value_type: "text", original_value: "LOT-12345-seal", normalized_value: "LOT-12345-seal", normalized_unit: null, source_cell_reference: "C2" }] }] }], time_window: "all_records_in_dataset_version" }],
};

function dependencies(options: { readonly readAllowed?: boolean; readonly transferAllowed?: boolean; readonly optIn?: "enabled" | "disabled" } = {}) {
  const recordTelemetry = vi.fn(async (record: unknown) => { void record; });
  const generate = vi.fn(async (packet: { calculations: { evidence_handles: string[] }[] }) => ({
    output_text: JSON.stringify({ possible_causes: [{ text: "A process condition may contribute.", evidence_refs: [packet.calculations[0]!.evidence_handles[0]] }], uncertainty: [], human_investigation_steps: [], advisory_only: true, causal_proof: false, capa_decision: false }),
    usage: { input_tokens: 120, output_tokens: 36, total_tokens: 156 },
  }));
  const quality_data: QualityDataStage3AServiceDependencies = {
    repository: {
      findExternalAiOptInState: vi.fn(async () => options.optIn === "disabled" ? { organization_id: ORG, decision: "disabled", event_id: VERSION, transition_number: 2, actor_user_id: USER, actor_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Revoked" } : { organization_id: ORG, decision: "enabled", event_id: VERSION, transition_number: 1, actor_user_id: USER, actor_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Opted in" }),
      findApprovedDatasetVersion: vi.fn(async () => ({ status: "approved", snapshot: {}, approval: { approval_event_id: APPROVAL } } as never)),
    } as never,
    audit_repository: {} as never, transaction_manager: {} as never,
    authorizer: { authorizeRead: vi.fn(async () => options.readAllowed === false ? { allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const } : { allowed: true as const, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER }), authorizeApproval: vi.fn() } as never,
    external_ai_transfer_authorizer: { authorizeExternalAiTransfer: vi.fn(async () => options.transferAllowed === false ? { allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const } : { allowed: true as const, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER }) },
    ids: { audit_event_id: () => VERSION as never, uuid: () => VERSION }, clock: { now: () => new Date(NOW) },
  };
  const deps = { quality_data, model_client: { generate }, generate_handle: () => HANDLE, record_telemetry: recordTelemetry };
  return { deps, generate, recordTelemetry };
}

describe("Stage 3C evidence-grounded AI interpretation", () => {
  beforeEach(() => { analyze.mockReset(); detect.mockReset(); analyze.mockResolvedValue({ status: "complete", result: analysis }); detect.mockResolvedValue({ status: "complete", result: detection }); });

  it("uses only minimized evidence, validates citations locally, and records metadata-only telemetry", async () => {
    const deps = dependencies();
    const result = await interpretQualityDataAnalysis(deps.deps, context(), requestTrace, request);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.result.interpretation_status).toBe("unverified_advisory_hypotheses");
    expect(result.result.source_verification).toBe("not_asserted");
    expect(result.result.evidence_citations[0]).toMatchObject({ record_id: RECORD, source_worksheet: "Sensitive Sheet", source_cells: ["B2", "C2"] });
    const modelPacket = JSON.stringify(vi.mocked(deps.generate).mock.calls[0]?.[0]);
    for (const forbidden of [ORG, SOURCE, SOURCE_VERSION, SHA, "SensitiveSource.xlsx", "Sensitive Sheet", "LOT-12345-seal", RECORD, "B2", "C2"]) expect(modelPacket).not.toContain(forbidden);
    expect(deps.recordTelemetry).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna", outcome: "success", request_id: requestTrace.request_id, correlation_id: requestTrace.correlation_id }));
    const telemetry = JSON.stringify(deps.recordTelemetry.mock.calls[0]?.[0]);
    expect(telemetry).not.toContain("LOT-12345");
    expect(telemetry).not.toContain("Sensitive");
  });

  it("fails closed on missing read authorization, transfer permission, opt-in, or analytical approval", async () => {
    const noRead = dependencies({ readAllowed: false });
    expect((await interpretQualityDataAnalysis(noRead.deps, context(), requestTrace, request)).status).toBe("denied");
    expect(noRead.generate).not.toHaveBeenCalled();
    const noTransfer = dependencies({ transferAllowed: false });
    expect((await interpretQualityDataAnalysis(noTransfer.deps, context(), requestTrace, request)).status).toBe("denied");
    expect(noTransfer.generate).not.toHaveBeenCalled();
    const noOptIn = dependencies({ optIn: "disabled" });
    expect((await interpretQualityDataAnalysis(noOptIn.deps, context(), requestTrace, request)).status).toBe("denied");
    expect(noOptIn.generate).not.toHaveBeenCalled();
    analyze.mockResolvedValueOnce({ status: "not_approved", decision: "revoked" });
    const revoked = dependencies();
    expect((await interpretQualityDataAnalysis(revoked.deps, context(), requestTrace, request)).status).toBe("not_approved");
    expect(revoked.generate).not.toHaveBeenCalled();
  });

  it("rejects fabricated references and provider failures without returning model text", async () => {
    const fabricated = dependencies();
    fabricated.generate.mockResolvedValueOnce({ output_text: JSON.stringify({ possible_causes: [{ text: "A cause.", evidence_refs: ["41000000-0000-4000-8000-000000000001"] }], uncertainty: [], human_investigation_steps: [], advisory_only: true, causal_proof: false, capa_decision: false }), usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });
    expect((await interpretQualityDataAnalysis(fabricated.deps, context(), requestTrace, request)).status).toBe("invalid_model_output");
    expect(fabricated.recordTelemetry).toHaveBeenCalledWith(expect.objectContaining({ outcome: "invalid_output" }));
    const failed = dependencies();
    failed.generate.mockRejectedValueOnce(new Error("sensitive provider details"));
    expect(await interpretQualityDataAnalysis(failed.deps, context(), requestTrace, request)).toEqual({ status: "provider_error" });
    expect(failed.recordTelemetry).toHaveBeenCalledWith(expect.objectContaining({ outcome: "provider_error" }));
  });

  it("rejects invalid request shapes and returns no interpretation after opt-in revocation during generation", async () => {
    const invalid = dependencies();
    expect((await interpretQualityDataAnalysis(invalid.deps, context(), requestTrace, { ...request, extra: "leak" })).status).toBe("invalid_request");
    const revoked = dependencies();
    const states = vi.mocked(revoked.deps.quality_data.repository.findExternalAiOptInState!);
    states.mockResolvedValueOnce({ organization_id: ORG, decision: "enabled", event_id: VERSION, transition_number: 1, actor_user_id: USER, actor_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Enabled" });
    states.mockResolvedValueOnce({ organization_id: ORG, decision: "enabled", event_id: VERSION, transition_number: 1, actor_user_id: USER, actor_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Enabled" });
    states.mockResolvedValueOnce({ organization_id: ORG, decision: "disabled", event_id: VERSION, transition_number: 2, actor_user_id: USER, actor_membership_id: MEMBERSHIP, occurred_at: NOW.toISOString(), rationale: "Disabled" });
    expect((await interpretQualityDataAnalysis(revoked.deps, context(), requestTrace, request)).status).toBe("denied");
  });
});
