import { describe, expect, it } from "vitest";
import { validateCapaContainmentRiskAdvisoryModelOutput } from "../../lib/capa/ai/capa-containment-risk-advisory-output-validator";

function output(): Record<string, any> {
  return {
    proposal: {
      missing_risk_inputs: [{ topic: "risk_method", human_review_question: "Is the risk method documented?" }],
      missing_impact_dimensions: [{ dimension: "patient", human_review_question: "Is patient impact documented?" }],
      human_review_questions: ["May distribution resume?"],
      evidence_provenance_gaps: [{ category: "missing_provenance", human_review_question: "Which source verifies the inventory count?" }],
    },
    assumptions: [{ unverified: true, related_area: "impact", verification_question: "Is the inventory scope complete?" }],
    uncertainty_and_limitations: [{ category: "insufficient_evidence", human_review_question: "Is additional evidence required?" }],
    citations: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true,
  };
}

function expectReason(value: unknown, reason: string): void {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  expect(() => validateCapaContainmentRiskAdvisoryModelOutput(raw)).toThrowError(
    expect.objectContaining({ name: "CapaContainmentRiskAdvisoryOutputValidationError", reason_code: reason }),
  );
}

const QUESTION_LOCATIONS = [
  ["standalone", (value: Record<string, any>, question: string) => { value.proposal.human_review_questions = [question]; }],
  ["missing risk", (value: Record<string, any>, question: string) => { value.proposal.missing_risk_inputs[0].human_review_question = question; }],
  ["missing impact", (value: Record<string, any>, question: string) => { value.proposal.missing_impact_dimensions[0].human_review_question = question; }],
  ["evidence gap", (value: Record<string, any>, question: string) => { value.proposal.evidence_provenance_gaps[0].human_review_question = question; }],
  ["assumption verification", (value: Record<string, any>, question: string) => { value.assumptions[0].verification_question = question; }],
  ["uncertainty", (value: Record<string, any>, question: string) => { value.uncertainty_and_limitations[0].human_review_question = question; }],
] as const;

describe("CAPA containment/risk raw model structural validation", () => {
  it("validates and deeply freezes the final structured speech acts", () => {
    const result = validateCapaContainmentRiskAdvisoryModelOutput(JSON.stringify(output()));
    expect(result.proposal.human_review_questions).toEqual(["May distribution resume?"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.proposal.evidence_provenance_gaps[0])).toBe(true);
    expect(Object.isFrozen(result.assumptions[0])).toBe(true);
    expect(Object.isFrozen(result.uncertainty_and_limitations[0])).toBe(true);
  });

  for (const [location, setQuestion] of QUESTION_LOCATIONS) {
    it(`accepts a valid single-sentence ${location} question`, () => {
      const value = output(); setQuestion(value, "Is authorized human review required?");
      expect(() => validateCapaContainmentRiskAdvisoryModelOutput(JSON.stringify(value))).not.toThrow();
    });

    for (const invalid of [
      "May distribution resume. Distribution can resume?",
      "Is ownership documented. Assign Jane?",
      "Is recall required! No recall is required?",
      "Is G-02 complete? Advance to S30?",
      "Is review required; approve it?",
      "Is review required\napprove it?",
      "Is review required, distribution can resume?",
      "Is review required: distribution can resume?",
      "Is ownership documented: assign Jane?",
      "Is review required\rDistribution can resume?",
      "Is review required\u2028Distribution can resume?",
      "Is review required\u2029Distribution can resume?",
      "Is review required - distribution can resume?",
      "Is review required — distribution can resume?",
      "Is review required and distribution can resume?",
    ]) {
      it(`rejects an assertion escape in ${location}: ${invalid}`, () => {
        const value = output(); setQuestion(value, invalid);
        expectReason(value, "INVALID_ADVISORY_QUESTION");
      });
    }
  }

  it("accepts controlled evidence-gap categories with question only", () => {
    for (const category of ["missing_evidence", "missing_provenance", "unverified_source", "contradictory_evidence", "insufficient_linkage"]) {
      const value = output(); value.proposal.evidence_provenance_gaps = [{ category, human_review_question: "Which evidence requires review?" }];
      expect(validateCapaContainmentRiskAdvisoryModelOutput(JSON.stringify(value)).proposal.evidence_provenance_gaps[0]?.category).toBe(category);
    }
  });

  it("rejects unknown and prose-bearing evidence gaps", () => {
    for (const gap of [
      { category: "approved_evidence", human_review_question: "Is review required?" },
      { category: "missing_evidence", description: "Distribution can resume.", human_review_question: "Is review required?" },
      { category: "missing_evidence", notes: "Decision", human_review_question: "Is review required?" },
      { category: "missing_evidence", detail: "Decision", human_review_question: "Is review required?" },
    ]) {
      const value = output(); value.proposal.evidence_provenance_gaps = [gap];
      expectReason(value, gap.category === "approved_evidence" ? "INVALID_EVIDENCE_GAP" : "UNSUPPORTED_MODEL_OUTPUT_FIELD");
    }
  });

  it("requires controlled explicitly unverified assumptions", () => {
    for (const related_area of ["containment", "impact", "risk", "evidence", "escalation", "other"]) {
      const value = output(); value.assumptions = [{ unverified: true, related_area, verification_question: "Is verification evidence available?" }];
      expect(validateCapaContainmentRiskAdvisoryModelOutput(JSON.stringify(value)).assumptions[0]?.related_area).toBe(related_area);
    }
    for (const assumption of [
      { unverified: false, related_area: "risk", verification_question: "Is it verified?" },
      { unverified: true, related_area: "approval", verification_question: "Is it verified?" },
      { unverified: true, assumption_or_topic: "Risk is acceptable", verification_question: "Is it verified?" },
      { unverified: true, related_area: "risk", rationale: "Acceptable", verification_question: "Is it verified?" },
      { unverified: true, related_area: "risk", notes: "Acceptable", verification_question: "Is it verified?" },
    ]) {
      const value = output(); value.assumptions = [assumption];
      expectReason(value, assumption.unverified === false || assumption.related_area === "approval" ? "INVALID_UNVERIFIED_ASSUMPTION" : "UNSUPPORTED_MODEL_OUTPUT_FIELD");
    }
  });

  it("requires controlled uncertainty category and question only", () => {
    for (const category of ["insufficient_evidence", "missing_information", "unresolved_conflict", "scope_limitation", "unknown_status"]) {
      const value = output(); value.uncertainty_and_limitations = [{ category, human_review_question: "Which information must an authorized human review?" }];
      expect(validateCapaContainmentRiskAdvisoryModelOutput(JSON.stringify(value)).uncertainty_and_limitations[0]?.category).toBe(category);
    }
    for (const uncertainty of [
      "Evidence is limited.",
      { category: "acceptable_status", human_review_question: "Is review required?" },
      { category: "missing_information", statement: "Distribution can resume", human_review_question: "Is review required?" },
      { category: "missing_information", description: "Decision", human_review_question: "Is review required?" },
      { category: "missing_information", rationale: "Decision", human_review_question: "Is review required?" },
    ]) {
      const value = output(); value.uncertainty_and_limitations = [uncertainty];
      expectReason(value, typeof uncertainty === "string" || uncertainty.category === "acceptable_status" ? "INVALID_UNCERTAINTY_OR_LIMITATION" : "UNSUPPORTED_MODEL_OUTPUT_FIELD");
    }
  });

  for (const field of ["containment_summary", "description", "rationale", "conclusion", "recommendation", "notes", "warnings", "factual_summary"]) {
    it(`rejects generic raw prose field ${field}`, () => {
      const value = output(); value[field] = "model prose";
      expectReason(value, "UNSUPPORTED_MODEL_OUTPUT_FIELD");
    });
  }

  it("rejects nested unknown decision fields", () => {
    const value = output(); value.proposal.missing_risk_inputs[0].risk_approval = true;
    expectReason(value, "UNSUPPORTED_MODEL_OUTPUT_FIELD");
  });

  it("rejects every nonempty model citation form", () => {
    for (const citation of [{ citation_id: "fake" }, { relationship: "supports" }, { validation_status: "valid" }]) {
      const value = output(); value.citations = [citation];
      expectReason(value, "INVALID_CITATIONS");
    }
  });

  for (const flags of [{ advisory_only: false }, { workflow_mutated: true }, { human_acceptance_required: false }]) {
    it("enforces exact advisory flags", () => expectReason({ ...output(), ...flags }, "INVALID_ADVISORY_FLAGS"));
  }

  it("enforces list and question bounds", () => {
    const many = output(); many.proposal.human_review_questions = Array.from({ length: 21 }, () => "Is review required?");
    expectReason(many, "INVALID_OUTPUT_LIST");
    const long = output(); long.proposal.human_review_questions = [`Is ${"x".repeat(1_001)}?`];
    expectReason(long, "INVALID_OUTPUT_TEXT");
  });
});
