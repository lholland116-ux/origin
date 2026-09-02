import { describe, expect, it } from "vitest";

import {
  buildCapaContainmentRiskAdvisoryRequest,
  parseCapaContainmentRiskAdvisoryFailure,
  parseCapaContainmentRiskAdvisorySuccess,
} from "../../app/capa/capa-containment-risk-advisory-client";

const CASE_ID = "30000000-0000-4000-8000-000000000001";
const VERSION_ID = "80000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "50000000-0000-4000-8000-000000000001";

function response() {
  return {
    advisory: {
      run_id: "70000000-0000-4000-8000-000000000001",
      output_id: "60000000-0000-4000-8000-000000000001",
      output_schema_version: "capa-containment-risk-advisory-1.0.0",
      status: "completed_draft",
      proposal: {
        missing_risk_inputs: [{ topic: "risk_result_input", human_review_question: "What risk result input remains to be verified?" }],
        missing_impact_dimensions: [{ dimension: "patient", human_review_question: "Is patient impact known?" }],
        human_review_questions: ["Could additional evidence change the review?"],
        evidence_provenance_gaps: [{ category: "missing_provenance", human_review_question: "Can the source provenance be verified?" }],
      },
      containment_summary: [],
      citations: [],
      assumptions: [{ unverified: true, related_area: "risk", verification_question: "Can the risk assumption be verified?" }],
      uncertainty_and_limitations: [{ category: "missing_information", human_review_question: "What information remains missing?" }],
      warnings: [],
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    },
    snapshot: {
      capa_case_id: CASE_ID,
      case_version_id: VERSION_ID,
      record_version: 3,
    },
    correlation_id: CORRELATION_ID,
  };
}

describe("CAPA containment/risk advisory browser client", () => {
  it("parses a valid governed response and exposes controlled browser data", () => {
    const parsed = parseCapaContainmentRiskAdvisorySuccess(response());
    expect(parsed).toEqual({
      advisory: {
        runId: "70000000-0000-4000-8000-000000000001",
        outputId: "60000000-0000-4000-8000-000000000001",
        proposal: {
          missingRiskInputs: [{ topic: "risk_result_input", humanReviewQuestion: "What risk result input remains to be verified?" }],
          missingImpactDimensions: [{ dimension: "patient", humanReviewQuestion: "Is patient impact known?" }],
          humanReviewQuestions: ["Could additional evidence change the review?"],
          evidenceProvenanceGaps: [{ category: "missing_provenance", humanReviewQuestion: "Can the source provenance be verified?" }],
        },
        assumptions: [{ relatedArea: "risk", verificationQuestion: "Can the risk assumption be verified?" }],
        uncertaintyAndLimitations: [{ category: "missing_information", humanReviewQuestion: "What information remains missing?" }],
      },
      snapshot: { capaCaseId: CASE_ID, caseVersionId: VERSION_ID, recordVersion: 3 },
      correlationId: CORRELATION_ID,
    });
  });

  it("parses only positive safe snapshot record versions", () => {
    expect(parseCapaContainmentRiskAdvisorySuccess(response())?.snapshot.recordVersion).toBe(3);
    for (const recordVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const value = response();
      value.snapshot.record_version = recordVersion;
      expect(parseCapaContainmentRiskAdvisorySuccess(value)).toBeNull();
    }
  });

  it.each([
    ["malformed snapshot", (value: ReturnType<typeof response>) => { value.snapshot.capa_case_id = "not-a-uuid"; }],
    ["wrong schema", (value: ReturnType<typeof response>) => { value.advisory.output_schema_version = "wrong"; }],
    ["wrong status", (value: ReturnType<typeof response>) => { value.advisory.status = "completed"; }],
    ["advisory flag", (value: ReturnType<typeof response>) => { value.advisory.advisory_only = false; }],
    ["workflow flag", (value: ReturnType<typeof response>) => { value.advisory.workflow_mutated = true; }],
    ["acceptance flag", (value: ReturnType<typeof response>) => { value.advisory.human_acceptance_required = false; }],
    ["citations", (value: ReturnType<typeof response>) => { Object.assign(value.advisory, { citations: [{}] }); }],
    ["containment summary", (value: ReturnType<typeof response>) => { Object.assign(value.advisory, { containment_summary: ["summary"] }); }],
    ["proposal shape", (value: ReturnType<typeof response>) => { Object.assign(value.advisory.proposal, { missing_risk_inputs: [{ topic: "risk_result_input" }] }); }],
    ["risk topic", (value: ReturnType<typeof response>) => { value.advisory.proposal.missing_risk_inputs[0]!.topic = "invalid"; }],
    ["impact dimension", (value: ReturnType<typeof response>) => { value.advisory.proposal.missing_impact_dimensions[0]!.dimension = "invalid"; }],
    ["evidence category", (value: ReturnType<typeof response>) => { value.advisory.proposal.evidence_provenance_gaps[0]!.category = "invalid"; }],
    ["assumption flag", (value: ReturnType<typeof response>) => { value.advisory.assumptions[0]!.unverified = false; }],
    ["assumption area", (value: ReturnType<typeof response>) => { value.advisory.assumptions[0]!.related_area = "invalid"; }],
    ["uncertainty category", (value: ReturnType<typeof response>) => { value.advisory.uncertainty_and_limitations[0]!.category = "invalid"; }],
    ["review question", (value: ReturnType<typeof response>) => { value.advisory.proposal.human_review_questions = ["not a question"]; }],
  ] as const)("rejects %s", (_name, mutate) => {
    const value = response();
    mutate(value);
    expect(parseCapaContainmentRiskAdvisorySuccess(value)).toBeNull();
  });

  it("constructs only allowed advisory request fields", () => {
    const content = {
      actions: [],
      impact_scope: { products: [], processes: [], data: [], customers: [], patients: [] },
      risk_evaluation: null,
      missing_risk_information: [],
      escalations: [],
    };
    expect(buildCapaContainmentRiskAdvisoryRequest("  focus  ", content)).toEqual({
      focus: "  focus  ",
      untrusted_human_draft: { trust: "untrusted_human_draft", content },
    });
    expect(buildCapaContainmentRiskAdvisoryRequest("  ", null)).toEqual({});
  });

  it("extracts safe API errors and hides arbitrary object details", () => {
    expect(parseCapaContainmentRiskAdvisoryFailure({ error: { code: "CAPA_INTERNAL_ERROR", message: "Safe message", correlation_id: CORRELATION_ID, secret: "ignored" } })).toEqual({ code: "CAPA_INTERNAL_ERROR", message: "Safe message", correlationId: CORRELATION_ID });
    expect(parseCapaContainmentRiskAdvisoryFailure({ secret: "provider output" }).message).not.toContain("provider output");
  });
});
