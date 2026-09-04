import { describe, expect, it } from "vitest";

import {
  validateCapaInvestigationPlanAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-output-validator";

function validOutput(): Record<string, any> {
  return {
    proposal: {
      investigation_questions: [
        {
          proposal_key: "P1",
          investigation_question: "Why did the seal fail during inspection?",
          scope_relationship: "The affected packaging line and related batches.",
          due_date_consideration: "What target date is appropriate for this investigation?",
          human_review_question: "Does this question address the confirmed event?",
        },
        {
          proposal_key: "P2",
          investigation_question: "Why did the seal fail during inspection?",
          scope_relationship: "The equipment configuration and inspection process.",
          due_date_consideration: "What target date is appropriate for this scope?",
          human_review_question: "Does this question address the process evidence?",
        },
      ],
      evidence_requests: [
        {
          proposal_key: "P1",
          evidence_target: "Approved batch, equipment, and inspection records.",
          human_review_question: "Which records should a human investigator review?",
        },
      ],
      method_suggestions: [
        {
          proposal_key: "P1",
          investigation_method: "Compare controlled records and conduct structured interviews.",
          human_review_question: "Is this method suitable for the question?",
        },
      ],
      dependencies: [
        {
          dependent_proposal_key: "P1",
          prerequisite_proposal_key: "P2",
          sequencing_recommendation: "Confirm the affected scope before comparing records.",
          human_review_question: "Should the scope review precede this investigation?",
        },
      ],
      proposed_owner_role: [
        {
          proposal_key: "P1",
          proposed_owner_role: "Manufacturing quality investigator",
          suggested_sme_function: "Packaging engineering",
          human_review_question: "Which qualified function should review ownership?",
        },
      ],
      gaps: [
        {
          gap: "The available records do not identify the inspection equipment configuration.",
          human_review_question: "Is the equipment configuration evidence available?",
        },
      ],
    },
    assumptions: [
      {
        unverified: true,
        related_area: "evidence",
        verification_question: "Is the supplied record set complete?",
      },
    ],
    uncertainty_and_limitations: [
      {
        category: "insufficient_evidence",
        human_review_question: "Which missing evidence limits this recommendation?",
      },
    ],
    citations: [],
    advisory_only: true,
    workflow_mutated: false,
    human_acceptance_required: true,
  };
}

function expectReason(value: unknown, reasonCode: string): void {
  const raw = typeof value === "string" ? value : JSON.stringify(value);

  expect(() => validateCapaInvestigationPlanAdvisoryModelOutput(raw)).toThrowError(
    expect.objectContaining({
      name: "CapaInvestigationPlanAdvisoryOutputValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe("CAPA investigation-planning advisory raw output validation", () => {
  it("accepts and deeply freezes a valid controlled recommendation", () => {
    const result = validateCapaInvestigationPlanAdvisoryModelOutput(
      JSON.stringify(validOutput()),
    );

    expect(result.proposal.investigation_questions[0]?.investigation_question).toBe(
      "Why did the seal fail during inspection?",
    );
    expect(result.proposal.investigation_questions[0]?.proposal_key).toBe("P1");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.proposal)).toBe(true);
    expect(Object.isFrozen(result.proposal.investigation_questions)).toBe(true);
    expect(Object.isFrozen(result.proposal.investigation_questions[0])).toBe(true);
    expect(Object.isFrozen(result.assumptions[0])).toBe(true);
  });

  it("normalizes controlled text before returning it", () => {
    const output = validOutput();
    output.proposal.gaps[0].gap = "  The scope evidence is incomplete.  ";
    output.proposal.gaps[0].human_review_question =
      "  Is the scope evidence complete?  ";

    const result = validateCapaInvestigationPlanAdvisoryModelOutput(
      JSON.stringify(output),
    );

    expect(result.proposal.gaps[0]).toEqual({
      gap: "The scope evidence is incomplete.",
      human_review_question: "Is the scope evidence complete?",
    });
  });

  it("enforces required top-level and proposal structure", () => {
    const missingTopLevel = validOutput();
    delete missingTopLevel.proposal;
    expectReason(missingTopLevel, "MISSING_MODEL_OUTPUT_FIELD");

    const missingProposalField = validOutput();
    delete missingProposalField.proposal.gaps;
    expectReason(missingProposalField, "MISSING_MODEL_OUTPUT_FIELD");

    const malformedProposal = validOutput();
    malformedProposal.proposal = [];
    expectReason(malformedProposal, "INVALID_PROPOSAL");
  });

  it("rejects unknown fields at every controlled boundary", () => {
    const topLevel = validOutput();
    topLevel.approval = true;
    expectReason(topLevel, "UNSUPPORTED_MODEL_OUTPUT_FIELD");

    const proposal = validOutput();
    proposal.proposal.unreviewed_plan = [];
    expectReason(proposal, "UNSUPPORTED_MODEL_OUTPUT_FIELD");

    const item = validOutput();
    item.proposal.investigation_questions[0].owner_user_id = "user-1";
    expectReason(item, "UNSUPPORTED_MODEL_OUTPUT_FIELD");
  });

  it("allows duplicate question text and changing text without changing linkage", () => {
    const output = validOutput();
    output.proposal.investigation_questions[0].investigation_question =
      "How did the inspection detect the seal issue?";

    const result = validateCapaInvestigationPlanAdvisoryModelOutput(
      JSON.stringify(output),
    );

    expect(result.proposal.investigation_questions.map((item) => item.proposal_key))
      .toEqual(["P1", "P2"]);
    expect(result.proposal.evidence_requests[0]?.proposal_key).toBe("P1");
    expect(result.proposal.dependencies[0]).toMatchObject({
      dependent_proposal_key: "P1",
      prerequisite_proposal_key: "P2",
    });
  });

  it("rejects malformed recommendation items and invalid dependencies", () => {
    for (const [field, value, reason] of [
      ["investigation_questions", "not-an-array", "INVALID_OUTPUT_LIST"],
      ["evidence_requests", [1], "INVALID_EVIDENCE_REQUEST"],
      ["method_suggestions", [{ proposal_key: "P1" }], "MISSING_MODEL_OUTPUT_FIELD"],
      ["proposed_owner_role", [{ proposal_key: "P1", proposed_owner_role: "Quality" }], "MISSING_MODEL_OUTPUT_FIELD"],
      ["gaps", [{ gap: "Missing evidence" }], "MISSING_MODEL_OUTPUT_FIELD"],
    ] as const) {
      const output = validOutput();
      output.proposal[field] = value;
      expectReason(output, reason);
    }

    const selfDependency = validOutput();
    selfDependency.proposal.dependencies[0].prerequisite_proposal_key =
      selfDependency.proposal.dependencies[0].dependent_proposal_key;
    expectReason(selfDependency, "SELF_DEPENDENCY");

    const malformedDependency = validOutput();
    malformedDependency.proposal.dependencies[0].sequencing_recommendation = "";
    expectReason(malformedDependency, "INVALID_OUTPUT_TEXT");
  });

  it("rejects unknown cross-references and indirect dependency cycles", () => {
    for (const [field, value, reason] of [
      ["evidence_requests", [{ proposal_key: "P9", evidence_target: "Records", human_review_question: "Which records should be reviewed?" }], "UNKNOWN_PROPOSAL_KEY"],
      ["method_suggestions", [{ proposal_key: "P9", investigation_method: "Record review", human_review_question: "Is this method suitable?" }], "UNKNOWN_PROPOSAL_KEY"],
      ["proposed_owner_role", [{ proposal_key: "P9", proposed_owner_role: "Quality", suggested_sme_function: "Engineering", human_review_question: "Which function should review ownership?" }], "UNKNOWN_PROPOSAL_KEY"],
      ["dependencies", [{ dependent_proposal_key: "P9", prerequisite_proposal_key: "P1", sequencing_recommendation: "Review P1 first.", human_review_question: "Should P1 precede P9?" }], "UNKNOWN_PROPOSAL_KEY"],
    ] as const) {
      const output = validOutput();
      output.proposal[field] = value;
      expectReason(output, reason);
    }

    const cycle = validOutput();
    cycle.proposal.investigation_questions.push({
      proposal_key: "P3",
      investigation_question: "What evidence is missing?",
      scope_relationship: "The controlled evidence set.",
      due_date_consideration: "What target date is appropriate for this gap?",
      human_review_question: "Is this evidence gap correctly framed?",
    });
    cycle.proposal.dependencies = [
      {
        dependent_proposal_key: "P1",
        prerequisite_proposal_key: "P2",
        sequencing_recommendation: "Review P2 first.",
        human_review_question: "Should P2 precede P1?",
      },
      {
        dependent_proposal_key: "P2",
        prerequisite_proposal_key: "P3",
        sequencing_recommendation: "Review P3 first.",
        human_review_question: "Should P3 precede P2?",
      },
      {
        dependent_proposal_key: "P3",
        prerequisite_proposal_key: "P1",
        sequencing_recommendation: "Review P1 first.",
        human_review_question: "Should P1 precede P3?",
      },
    ];
    expectReason(cycle, "DEPENDENCY_CYCLE");
  });

  it("rejects duplicate proposal keys and dependency edges", () => {
    const invalidKey = validOutput();
    invalidKey.proposal.investigation_questions[0].proposal_key = "10000000-0000-4000-8000-000000000001";
    expectReason(invalidKey, "INVALID_PROPOSAL_KEY");

    const duplicateKey = validOutput();
    duplicateKey.proposal.investigation_questions[1].proposal_key = "P1";
    expectReason(duplicateKey, "DUPLICATE_PROPOSAL_KEY");

    const duplicateEdge = validOutput();
    duplicateEdge.proposal.dependencies.push({
      ...duplicateEdge.proposal.dependencies[0],
    });
    expectReason(duplicateEdge, "DUPLICATE_DEPENDENCY_EDGE");
  });

  it("rejects authoritative fields and decision claims", () => {
    for (const field of [
      "item_id",
      "owner_user_id",
      "due_date",
      "sme_user_ids",
      "status",
      "disposition",
      "draft_provenance",
      "adopted_by_user_id",
      "adopted_at",
      "release",
      "g03_confirmation",
    ]) {
      const output = validOutput();
      output.proposal.investigation_questions[0][field] = "forged";
      expectReason(output, "UNSUPPORTED_MODEL_OUTPUT_FIELD");
    }

    for (const claim of [
      "Release the plan after this review.",
      "The plan is approved.",
      "Advance this workflow to S40.",
      "G-03 is complete.",
    ]) {
      const output = validOutput();
      output.proposal.gaps[0].gap = claim;
      expectReason(output, "PROHIBITED_S30_DECISION_CLAIM");
    }
  });

  it("enforces advisory flags, empty model citations, and question shape", () => {
    for (const flags of [
      { advisory_only: false },
      { workflow_mutated: true },
      { human_acceptance_required: false },
    ]) {
      expectReason({ ...validOutput(), ...flags }, "INVALID_ADVISORY_FLAGS");
    }

    const citations = validOutput();
    citations.citations = [{ citation_id: "authoritative" }];
    expectReason(citations, "INVALID_CITATIONS");

    const malformedQuestion = validOutput();
    malformedQuestion.proposal.investigation_questions[0].investigation_question =
      "The cause was equipment wear.";
    expectReason(malformedQuestion, "INVALID_ADVISORY_QUESTION");
  });

  it("allows noun-phrase coordination but rejects compound and-clauses", () => {
    for (const question of [
      "Which process and equipment factors should be reviewed?",
      "What records and samples should be compared?",
    ]) {
      const output = validOutput();
      output.proposal.investigation_questions[0].investigation_question = question;
      expect(() => validateCapaInvestigationPlanAdvisoryModelOutput(
        JSON.stringify(output),
      )).not.toThrow();
    }

    for (const question of [
      "What failed and why did it fail?",
      "Does the record show wear and does the equipment show drift?",
      "Is the parameter correct and is the inspection result acceptable?",
    ]) {
      const output = validOutput();
      output.proposal.investigation_questions[0].investigation_question = question;
      expectReason(output, "INVALID_ADVISORY_QUESTION");
    }
  });
});
