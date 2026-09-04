import { describe, expect, it, vi } from "vitest";
import {
  buildCapaInvestigationPlanningAdvisoryRequest,
  fetchCapaInvestigationPlanningAdvisory,
  parseCapaInvestigationPlanningAdvisorySuccess,
} from "../../app/capa/capa-investigation-planning-advisory-client";
import { CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION } from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";

const CASE_ID = "10000000-0000-4000-8000-000000000001";
const VERSION_ID = "20000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "30000000-0000-4000-8000-000000000001";
const RUN_ID = "40000000-0000-4000-8000-000000000001";
const TRACE_ID = "50000000-0000-4000-8000-000000000001";

function response(): Record<string, unknown> {
  return {
    advisory: {
      run_id: RUN_ID,
      output_id: OUTPUT_ID,
      output_schema_version: CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      proposal: {
        investigation_questions: [{ proposal_key: "P1", investigation_question: "What caused the deviation?", scope_relationship: "Within the affected process.", due_date_consideration: "What target date is appropriate?", human_review_question: "What evidence confirms the cause?" }],
        evidence_requests: [{ proposal_key: "P1", evidence_target: "Batch records", human_review_question: "Which records should be reviewed?" }],
        method_suggestions: [{ proposal_key: "P1", investigation_method: "Document review", human_review_question: "Is this method sufficient?" }],
        dependencies: [],
        proposed_owner_role: [{ proposal_key: "P1", proposed_owner_role: "Investigator", suggested_sme_function: "Quality", human_review_question: "Who is eligible to own this?" }],
        gaps: [{ gap: "Additional evidence may be needed.", human_review_question: "What evidence remains unavailable?" }],
      },
      assumptions: [],
      uncertainty_and_limitations: [],
      citations: [],
      warnings: [],
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    },
    snapshot: { capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 3 },
    correlation_id: TRACE_ID,
  };
}

describe("S30 investigation-planning advisory browser client", () => {
  it("strips trusted provenance and sends only the committed untrusted draft fields", () => {
    const request = buildCapaInvestigationPlanningAdvisoryRequest(" focus ", { items: [{
      itemId: "AI-1", investigationQuestion: "Question", evidenceTarget: "Evidence",
      investigationMethod: "Method", scopeRelationship: "Scope", ownerUserId: "OWNER",
      dueDate: "2026-10-01", dependencyItemIds: [],
      provenance: { source_type: "ai_proposal", source_reference: "secret", adopted_by_user_id: "secret", adopted_at: "secret" },
    }] });
    expect(request).toEqual({ focus: " focus ", untrusted_human_draft: { trust: "untrusted_human_draft", content: { items: [{
      local_key: "D1", investigation_question: "Question", evidence_target: "Evidence", investigation_method: "Method",
      scope_relationship: "Scope", due_date_consideration: null, dependency_local_keys: [], owner_selected: true,
    }] } } });
    expect(JSON.stringify(request)).not.toContain("secret");
  });

  it("strictly parses completed advisory snapshots and rejects malformed output", () => {
    expect(parseCapaInvestigationPlanningAdvisorySuccess(response())).toMatchObject({
      advisory: { outputId: OUTPUT_ID, status: "completed_draft" },
      snapshot: { capaCaseId: CASE_ID, caseVersionId: VERSION_ID, recordVersion: 3 },
      correlationId: TRACE_ID,
    });
    const malformed = response();
    (malformed.advisory as Record<string, unknown>).workflow_mutated = true;
    expect(parseCapaInvestigationPlanningAdvisorySuccess(malformed)).toBeNull();
  });

  it("uses the exact S30 route and trace headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response()), { status: 201 }));
    const request = buildCapaInvestigationPlanningAdvisoryRequest("focus", { items: [] });
    await fetchCapaInvestigationPlanningAdvisory(CASE_ID, request, fetcher, { requestId: TRACE_ID, correlationId: TRACE_ID });
    expect(fetcher).toHaveBeenCalledWith(`/api/capa/${CASE_ID}/investigation-planning-advisory`, expect.objectContaining({
      method: "POST", body: JSON.stringify(request),
      headers: { "content-type": "application/json", "x-request-id": TRACE_ID, "x-correlation-id": TRACE_ID },
    }));
  });
});
