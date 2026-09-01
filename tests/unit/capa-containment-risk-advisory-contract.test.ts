import { describe, expect, it } from "vitest";
import {
  CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES,
  CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS,
  CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT,
  CAPA_CONTAINMENT_RISK_ADVISORY_PROPOSAL_FIELDS,
  CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS,
  CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS,
  CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES,
  type CapaContainmentRiskAdvisoryResponse,
  type CapaContainmentRiskAdvisoryUntrustedHumanDraft,
  type RawCapaContainmentRiskAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-containment-risk-advisory-contract";

describe("CAPA containment/risk advisory structural contract", () => {
  it("publishes controlled raw-model vocabulary without a containment summary", () => {
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT).toBe("containment_risk_analysis");
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_PROPOSAL_FIELDS).toEqual([
      "missing_risk_inputs", "missing_impact_dimensions",
      "human_review_questions", "evidence_provenance_gaps",
    ]);
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_PROPOSAL_FIELDS).not.toContain("containment_summary");
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS).toEqual(["product", "process", "data", "customer", "patient"]);
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS).toContain("containment_evidence");
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES).toContain("missing_provenance");
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS).toEqual(["containment", "impact", "risk", "evidence", "escalation", "other"]);
    expect(CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES).toContain("scope_limitation");
  });

  it("defines a strictly advisory raw model fixture", () => {
    const raw = {
      proposal: {
        missing_risk_inputs: [{ topic: "risk_method", human_review_question: "Is the risk method documented?" }],
        missing_impact_dimensions: [{ dimension: "patient", human_review_question: "Is patient impact documented?" }],
        human_review_questions: ["May distribution resume?"],
        evidence_provenance_gaps: [{ category: "missing_provenance", human_review_question: "Which source verifies the inventory count?" }],
      },
      assumptions: [{ unverified: true, related_area: "impact", verification_question: "Is the inventory scope complete?" }],
      uncertainty_and_limitations: [{ category: "insufficient_evidence", human_review_question: "Is additional evidence required?" }],
      citations: [], advisory_only: true, workflow_mutated: false,
      human_acceptance_required: true,
    } satisfies RawCapaContainmentRiskAdvisoryModelOutput;
    expect(raw.citations).toEqual([]);
  });

  it("reserves final summary, citations, and warnings for server construction", () => {
    const response = {
      run_id: "run" as CapaContainmentRiskAdvisoryResponse["run_id"],
      output_id: "output" as CapaContainmentRiskAdvisoryResponse["output_id"],
      output_schema_version: "schema-1" as CapaContainmentRiskAdvisoryResponse["output_schema_version"],
      status: "completed_draft", proposal: null, containment_summary: [], citations: [],
      assumptions: [], uncertainty_and_limitations: [], warnings: [],
      advisory_only: true, workflow_mutated: false, human_acceptance_required: true,
    } satisfies CapaContainmentRiskAdvisoryResponse;
    expect(response.containment_summary).toEqual([]);
  });

  it("retains exact flag and untrusted-draft literal types", () => {
    const content = { actions: [], impact_scope: { products: [], processes: [], data: [], customers: [], patients: [] }, risk_evaluation: null, missing_risk_information: [], escalations: [] };
    const draft = { trust: "untrusted_human_draft", content } satisfies CapaContainmentRiskAdvisoryUntrustedHumanDraft;
    expect(draft.trust).toBe("untrusted_human_draft");

    const invalidFlag = {
      // @ts-expect-error raw advisory_only is the true literal only.
      advisory_only: false,
    } satisfies Pick<RawCapaContainmentRiskAdvisoryModelOutput, "advisory_only">;
    expect(invalidFlag.advisory_only).toBe(false);

    const invalidDraft = {
      // @ts-expect-error authoritative is not an untrusted draft discriminator.
      trust: "authoritative", content,
    } satisfies CapaContainmentRiskAdvisoryUntrustedHumanDraft;
    expect(invalidDraft.trust).toBe("authoritative");
  });
});
