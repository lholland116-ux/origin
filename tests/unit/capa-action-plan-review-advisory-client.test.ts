import { describe, expect, it, vi } from "vitest";
import {
  buildCapaActionPlanReviewAdvisoryRequest,
  fetchCapaActionPlanReviewAdvisory,
  parseCapaActionPlanReviewAdvisorySuccess,
} from "../../app/capa/capa-action-plan-review-advisory-client";
import { CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION } from "../../lib/capa/ai/capa-action-plan-review-advisory-contract";

const CASE = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const ACTION_PLAN = "30000000-0000-4000-8000-000000000001";
const RUN = "40000000-0000-4000-8000-000000000001";
const OUTPUT = "50000000-0000-4000-8000-000000000001";
const CORRELATION = "60000000-0000-4000-8000-000000000001";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function success(disposition: "approve" | "return" | "unable_to_recommend" = "approve") {
  return {
    advisory: {
      run_id: RUN,
      output_id: OUTPUT,
      output_schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
      source_case_version_id: VERSION,
      action_plan_section_version_id: ACTION_PLAN,
      proposal: {
        overall_assessment: "needs_attention",
        findings: [{
          finding_id: "F1",
          category: "owner_completeness",
          severity: "high",
          summary: "The owner should be confirmed.",
          rationale: "The controlled baseline does not establish the accountable owner.",
          affected_action_ids: [],
          affected_root_cause_ids: [],
          reference_keys: ["R1"],
          suggested_reviewer_attention: "Confirm the accountable owner before deciding.",
        }],
        recommended_disposition: disposition,
        limitations: ["This advisory is not a human review decision."],
      },
      citations: [],
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      approval_claimed: false,
      workflow_transition: null,
      human_acceptance_required: true,
    },
    snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 7 },
    correlation_id: CORRELATION,
  };
}

describe("S70 action-plan review advisory browser client", () => {
  it.each(["approve", "return", "unable_to_recommend"] as const)("parses %s as an advisory-only recommendation", (disposition) => {
    const parsed = parseCapaActionPlanReviewAdvisorySuccess(success(disposition), { caseId: CASE, caseVersionId: VERSION, actionPlanSectionVersionId: ACTION_PLAN, recordVersion: 7 });
    expect(parsed?.advisory.proposal.recommended_disposition).toBe(disposition);
    expect(parsed?.advisory.advisory_only).toBe(true);
    expect(parsed?.advisory.workflow_transition).toBeNull();
  });

  it("sends only the authoritative version request fields and parses success", async () => {
    const request = buildCapaActionPlanReviewAdvisoryRequest({ expectedCaseVersionId: VERSION, expectedRecordVersion: 7 });
    const fetcher = vi.fn().mockResolvedValue(response(success()));
    await expect(fetchCapaActionPlanReviewAdvisory(CASE, request, ACTION_PLAN, fetcher, { requestId: RUN, correlationId: CORRELATION })).resolves.toMatchObject({ advisory: { source_case_version_id: VERSION, action_plan_section_version_id: ACTION_PLAN } });
    expect(fetcher).toHaveBeenCalledWith(`/api/capa/${CASE}/action-plan-review-advisory`, expect.objectContaining({ body: JSON.stringify({ expected_case_version_id: VERSION, expected_record_version: 7 }) }));
  });

  it.each([
    ["malformed successful response", { advisory: { ...success().advisory, proposal: null } }, ACTION_PLAN],
    ["wrong source case version", { ...success(), advisory: { ...success().advisory, source_case_version_id: CASE } }, ACTION_PLAN],
    ["wrong action-plan section version", success(), CASE],
  ])("rejects %s", async (_label, body, expectedActionPlanSectionVersionId) => {
    const value = _label === "wrong action-plan section version" ? { ...success(), advisory: { ...success().advisory, action_plan_section_version_id: VERSION } } : body;
    await expect(fetchCapaActionPlanReviewAdvisory(CASE, { expected_case_version_id: VERSION, expected_record_version: 7 }, expectedActionPlanSectionVersionId, vi.fn().mockResolvedValue(response(value)), { requestId: RUN, correlationId: CORRELATION })).resolves.toMatchObject({ code: "INVALID_ADVISORY_RESPONSE" });
  });

  it("maps controlled failures and transport failures without exposing internals", async () => {
    await expect(fetchCapaActionPlanReviewAdvisory(CASE, { expected_case_version_id: VERSION, expected_record_version: 7 }, ACTION_PLAN, vi.fn().mockResolvedValue(response({ error: { code: "CAPA_ADVISORY_CASE_STATE_CONFLICT", message: "The CAPA case is not in S70 Action Plan Review.", correlation_id: CORRELATION } }, 409)), { requestId: RUN, correlationId: CORRELATION })).resolves.toMatchObject({ code: "CAPA_ADVISORY_CASE_STATE_CONFLICT", correlationId: CORRELATION });
    await expect(fetchCapaActionPlanReviewAdvisory(CASE, { expected_case_version_id: VERSION, expected_record_version: 7 }, ACTION_PLAN, vi.fn().mockRejectedValue(new Error("database secret")), { requestId: RUN, correlationId: CORRELATION })).resolves.toMatchObject({ code: null, message: "The governed S70 action-plan review advisory could not be completed." });
  });
});
