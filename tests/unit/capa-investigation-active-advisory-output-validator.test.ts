import { describe, expect, it } from "vitest";

import {
  validateCapaInvestigationActiveAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-investigation-active-advisory-output-validator";

function validOutput(): Record<string, any> {
  return {
    proposal: {
      evidence_gaps: [
        {
          proposal_key: "P1",
          gap: "The equipment configuration at the time of the event is not established.",
          why_it_matters: "Configuration evidence may affect evaluation of possible process causes.",
          related_reference_keys: ["R1"],
          recommended_next_step: "Review the controlled equipment configuration records.",
          human_review_question: "Does this represent a material evidence gap?",
        },
      ],
      conflicting_information: [
        {
          proposal_key: "P2",
          conflict: "Two controlled records report different equipment settings for the same event period.",
          conflicting_reference_keys: ["R1", "R2"],
          why_it_matters: "The discrepancy may affect causal analysis.",
          human_review_question: "Are these records materially contradictory?",
        },
      ],
      assumptions: [
        {
          proposal_key: "P3",
          assumption: "The inspected units experienced the same equipment configuration.",
          related_reference_keys: ["R1"],
          verification_question: "Do controlled records establish the configuration for every affected unit?",
          human_review_question: "Should this remain an explicit unverified assumption?",
        },
      ],
      causal_hypotheses: [
        {
          proposal_key: "P4",
          hypothesis: "Equipment configuration variation may have contributed to the observed seal failure.",
          suggested_role: "possible_contributing_factor",
          rationale: "The available records indicate configuration variability that warrants human evaluation.",
          supporting_reference_keys: ["R1"],
          contradictory_reference_keys: ["R2"],
          human_review_question: "Should an investigator evaluate this as a causal hypothesis?",
        },
      ],
      alternative_hypotheses: [
        {
          proposal_key: "P5",
          hypothesis: "Material variation may provide an alternative explanation for the observed seal failure.",
          rationale: "Available information does not exclude material variability.",
          supporting_reference_keys: [],
          contradictory_reference_keys: [],
          human_review_question: "Should this alternative hypothesis remain under consideration?",
        },
      ],
      investigation_recommendations: [
        {
          proposal_key: "P6",
          recommendation: "Compare equipment configuration records with affected and unaffected production.",
          rationale: "The comparison may help discriminate between competing explanations.",
          related_reference_keys: ["R1", "R2"],
          human_review_question: "Would this comparison improve the investigation?",
        },
      ],
    },
    uncertainty_and_limitations: [
      {
        category: "insufficient_evidence",
        human_review_question: "Which additional evidence is needed before drawing a causal conclusion?",
      },
    ],
    citations: [],
    advisory_only: true,
    workflow_mutated: false,
    human_acceptance_required: true,
  };
}

function expectReason(
  value: unknown,
  reasonCode: string,
): void {
  const raw =
    typeof value === "string"
      ? value
      : JSON.stringify(value);

  expect(() =>
    validateCapaInvestigationActiveAdvisoryModelOutput(raw),
  ).toThrowError(
    expect.objectContaining({
      name:
        "CapaInvestigationActiveAdvisoryOutputValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe("CAPA investigation-active advisory raw output validation", () => {
  it("accepts and deeply freezes a valid advisory analysis", () => {
    const result =
      validateCapaInvestigationActiveAdvisoryModelOutput(
        JSON.stringify(validOutput()),
      );

    expect(
      result.proposal.causal_hypotheses[0]?.proposal_key,
    ).toBe("P4");

    expect(
      result.proposal.conflicting_information[0]
        ?.conflicting_reference_keys,
    ).toEqual(["R1", "R2"]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.proposal)).toBe(true);
    expect(
      Object.isFrozen(result.proposal.evidence_gaps),
    ).toBe(true);
    expect(
      Object.isFrozen(result.proposal.evidence_gaps[0]),
    ).toBe(true);
    expect(
      Object.isFrozen(
        result.proposal.evidence_gaps[0]
          ?.related_reference_keys,
      ),
    ).toBe(true);
  });

  it("normalizes controlled text", () => {
    const output = validOutput();

    output.proposal.evidence_gaps[0].gap =
      "  Equipment configuration evidence is incomplete.  ";

    const result =
      validateCapaInvestigationActiveAdvisoryModelOutput(
        JSON.stringify(output),
      );

    expect(result.proposal.evidence_gaps[0]?.gap).toBe(
      "Equipment configuration evidence is incomplete.",
    );
  });

  it("enforces required top-level and proposal structure", () => {
    const missingTop = validOutput();
    delete missingTop.proposal;
    expectReason(
      missingTop,
      "MISSING_MODEL_OUTPUT_FIELD",
    );

    const missingProposal = validOutput();
    delete missingProposal.proposal.assumptions;
    expectReason(
      missingProposal,
      "MISSING_MODEL_OUTPUT_FIELD",
    );

    const malformed = validOutput();
    malformed.proposal = [];
    expectReason(malformed, "INVALID_PROPOSAL");
  });

  it("rejects unsupported authoritative fields", () => {
    for (const field of [
      "item_id",
      "hypothesis_id",
      "evidence_status",
      "assumption_status",
      "gap_status",
      "conflict_status",
      "status",
      "causal_role",
      "responsible_user_id",
      "provenance",
      "adopted_by_user_id",
      "adopted_at",
      "root_cause_not_confirmed",
      "workflow_state",
    ]) {
      const output = validOutput();

      output.proposal.causal_hypotheses[0][field] =
        "forged";

      expectReason(
        output,
        "UNSUPPORTED_MODEL_OUTPUT_FIELD",
      );
    }
  });

  it("rejects duplicate and malformed proposal keys", () => {
    const malformed = validOutput();

    malformed.proposal.evidence_gaps[0].proposal_key =
      "10000000-0000-4000-8000-000000000001";

    expectReason(malformed, "INVALID_PROPOSAL_KEY");

    const duplicate = validOutput();

    duplicate.proposal.assumptions[0].proposal_key =
      "P1";

    expectReason(duplicate, "DUPLICATE_PROPOSAL_KEY");
  });

  it("validates advisory-local reference keys", () => {
    const malformed = validOutput();

    malformed.proposal.evidence_gaps[0]
      .related_reference_keys = ["ledger-item-1"];

    expectReason(malformed, "INVALID_REFERENCE_KEY");

    const duplicate = validOutput();

    duplicate.proposal.investigation_recommendations[0]
      .related_reference_keys = ["R1", "R1"];

    expectReason(
      duplicate,
      "DUPLICATE_REFERENCE_KEY",
    );
  });

  it("requires at least two references for a proposed conflict", () => {
    const output = validOutput();

    output.proposal.conflicting_information[0]
      .conflicting_reference_keys = ["R1"];

    expectReason(
      output,
      "CONFLICT_REQUIRES_MULTIPLE_REFERENCES",
    );
  });

  it("rejects invalid suggested causal roles", () => {
    const output = validOutput();

    output.proposal.causal_hypotheses[0]
      .suggested_role = "confirmed_root_cause";

    expectReason(
      output,
      "INVALID_CAUSAL_HYPOTHESIS",
    );
  });

  it("rejects authoritative decision and workflow claims", () => {
    for (const claim of [
      "The root cause is confirmed.",
      "The evidence is verified.",
      "This assumption is resolved.",
      "Advance this workflow to S50.",
      "Submit the root cause package.",
    ]) {
      const output = validOutput();

      output.proposal.investigation_recommendations[0]
        .recommendation = claim;

      expectReason(
        output,
        "PROHIBITED_S40_DECISION_CLAIM",
      );
    }
  });

  it("enforces advisory flags and empty raw-model citations", () => {
    for (const flags of [
      { advisory_only: false },
      { workflow_mutated: true },
      { human_acceptance_required: false },
    ]) {
      expectReason(
        { ...validOutput(), ...flags },
        "INVALID_ADVISORY_FLAGS",
      );
    }

    const citations = validOutput();
    citations.citations = [
      { citation_id: "authoritative" },
    ];

    expectReason(citations, "INVALID_CITATIONS");
  });

  it("enforces controlled human-review question shape", () => {
    const assertion = validOutput();

    assertion.proposal.evidence_gaps[0]
      .human_review_question =
      "This is a critical evidence gap.";

    expectReason(
      assertion,
      "INVALID_ADVISORY_QUESTION",
    );

    const compound = validOutput();

    compound.proposal.evidence_gaps[0]
      .human_review_question =
      "Is this a gap and does it block the investigation?";

    expectReason(
      compound,
      "INVALID_ADVISORY_QUESTION",
    );
  });

  it("rejects malformed lists and malformed proposal records", () => {
    const badList = validOutput();
    badList.proposal.assumptions = "not-an-array";

    expectReason(badList, "INVALID_OUTPUT_LIST");

    const badConflict = validOutput();
    badConflict.proposal.conflicting_information = [1];

    expectReason(badConflict, "INVALID_CONFLICT");

    const missingField = validOutput();

    delete missingField.proposal
      .investigation_recommendations[0].rationale;

    expectReason(
      missingField,
      "MISSING_MODEL_OUTPUT_FIELD",
    );
  });
});
