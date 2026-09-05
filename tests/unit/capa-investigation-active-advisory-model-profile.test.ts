import { describe, expect, it } from "vitest";

import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS,
} from "../../lib/capa/ai/capa-investigation-active-advisory-contract";
import {
  validateCapaInvestigationActiveAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-investigation-active-advisory-output-validator";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-active-advisory-model-profile";

const validOutput = {
  proposal: {
    evidence_gaps: [],
    conflicting_information: [],
    assumptions: [],
    causal_hypotheses: [],
    alternative_hypotheses: [],
    investigation_recommendations: [],
  },
  uncertainty_and_limitations: [],
  citations: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
};

describe("S40 investigation-active advisory model profile", () => {
  it("uses a deterministic controlled S40 profile and strict output schema", () => {
    expect(CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE).toEqual({
      profile_version: "capa-investigation-active-model-profile-1.0.0",
      output_schema_name: "capa_investigation_active_advisory_1_0_0",
      output_schema_version:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
      maximum_output_characters: 40_000,
    });

    const schema = CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.proposal.required).toEqual(
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS,
    );
    expect(
      schema.properties.proposal.properties.causal_hypotheses.items.properties
        .suggested_role.enum,
    ).toEqual(["possible_root_cause", "possible_contributing_factor"]);
    expect(schema.properties.citations).toMatchObject({
      type: "array",
      maxItems: 0,
    });
    expect(schema.properties.advisory_only).toEqual({ type: "boolean", const: true });
    expect(schema.properties.workflow_mutated).toEqual({ type: "boolean", const: false });
    expect(schema.properties.human_acceptance_required).toEqual({
      type: "boolean",
      const: true,
    });
  });

  it("accepts a validator-conformant advisory-only output", () => {
    expect(
      validateCapaInvestigationActiveAdvisoryModelOutput(
        JSON.stringify(validOutput),
      ),
    ).toMatchObject(validOutput);
  });

  it("uses the controlled question schema only for review and verification questions", () => {
    const proposal = CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA
      .properties.proposal.properties;
    const questions = [
      proposal.evidence_gaps.items.properties.human_review_question,
      proposal.conflicting_information.items.properties.human_review_question,
      proposal.assumptions.items.properties.verification_question,
      proposal.assumptions.items.properties.human_review_question,
      proposal.causal_hypotheses.items.properties.human_review_question,
      proposal.alternative_hypotheses.items.properties.human_review_question,
      proposal.investigation_recommendations.items.properties.human_review_question,
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA.properties
        .uncertainty_and_limitations.items.properties.human_review_question,
    ];
    const narrative = proposal.evidence_gaps.items.properties.gap;

    for (const question of questions) {
      expect(question).toMatchObject({
        type: "string",
        minLength: 1,
        maxLength: 1_000,
        pattern: expect.any(String),
      });
    }
    expect(narrative).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 1_000,
    });
  });

  it("expresses the provider-supported controlled question grammar", () => {
    const pattern = new RegExp(
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA.properties.proposal
        .properties.assumptions.items.properties.verification_question.pattern,
    );

    for (const question of [
      "What record supports this hypothesis?",
      "Does the batch record support this hypothesis?",
      "Could the process history explain this observation?",
    ]) {
      expect(pattern.test(question)).toBe(true);
    }
    for (const question of [
      "Please review the batch record?",
      "Review the batch record?",
      "Determine whether the record is complete?",
      "Does the batch record, support this hypothesis?",
      "Does the batch record support this hypothesis? Why?",
      "Does the batch record support this hypothesis\n?",
    ]) {
      expect(pattern.test(question)).toBe(false);
    }
  });
});
