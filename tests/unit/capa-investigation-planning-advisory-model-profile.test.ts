import { describe, expect, it } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS,
  CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  validateCapaInvestigationPlanAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-output-validator";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-model-profile";

const validOutput = {
  proposal: {
    investigation_questions: [
      {
        proposal_key: "P1",
        investigation_question: "What record explains the deviation?",
        scope_relationship: "Covers the accepted machining scope",
        due_date_consideration: "When should the record be reviewed?",
        human_review_question: "Does the record explain the deviation?",
      },
    ],
    evidence_requests: [
      {
        proposal_key: "P1",
        evidence_target: "Setup record",
        human_review_question: "Which setup record should be reviewed?",
      },
    ],
    method_suggestions: [
      {
        proposal_key: "P1",
        investigation_method: "Controlled record review",
        human_review_question: "Is record review sufficient?",
      },
    ],
    dependencies: [],
    proposed_owner_role: [
      {
        proposal_key: "P1",
        proposed_owner_role: "Manufacturing quality role",
        suggested_sme_function: "Machining engineering",
        human_review_question: "Who reviews the setup record?",
      },
    ],
    gaps: [
      {
        gap: "The setup record has not been reviewed",
        human_review_question: "What record remains to be reviewed?",
      },
    ],
  },
  assumptions: [
    {
      unverified: true,
      related_area: "evidence",
      verification_question: "What evidence verifies the setup?",
    },
  ],
  uncertainty_and_limitations: [
    {
      category: "missing_information",
      human_review_question: "Which information remains unavailable?",
    },
  ],
  citations: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
};

describe("S30 investigation-planning advisory model profile", () => {
  it("uses the controlled profile and CS1 schema version", () => {
    expect(CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE).toMatchObject({
      profile_version: "capa-model-profile-1.0.0",
      output_schema_name: "capa_investigation_planning_advisory_1_0_0",
      output_schema_version:
        CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
      maximum_output_characters: 30_000,
    });
    expect(Object.isFrozen(CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE)).toBe(
      true,
    );
  });

  it("defines the exact CS1 top-level and proposal shape", () => {
    const schema = CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA;

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      "proposal",
      "assumptions",
      "uncertainty_and_limitations",
      "citations",
      "advisory_only",
      "workflow_mutated",
      "human_acceptance_required",
    ]);
    expect(schema.properties.proposal.required).toEqual(
      CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS,
    );
    expect(schema.properties.proposal.additionalProperties).toBe(false);
    expect(schema.properties.proposal.properties).toHaveProperty(
      "investigation_questions",
    );
    expect(schema.properties.proposal.properties).toHaveProperty(
      "evidence_requests",
    );
    expect(schema.properties.proposal.properties).toHaveProperty(
      "method_suggestions",
    );
    expect(schema.properties.proposal.properties).toHaveProperty(
      "dependencies",
    );
    expect(schema.properties.proposal.properties).toHaveProperty(
      "proposed_owner_role",
    );
    expect(schema.properties.proposal.properties).toHaveProperty("gaps");
  });

  it("bounds text and arrays, restricts proposal keys, and fixes governance fields", () => {
    const schema = CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA;
    const question = schema.properties.proposal.properties
      .investigation_questions;
    const proposalKey = question.items.properties.proposal_key;

    expect(question.maxItems).toBe(20);
    expect(question.items.additionalProperties).toBe(false);
    expect(question.items.properties.investigation_question).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 1_000,
    });
    expect(proposalKey.pattern).toBe("^P[1-9][0-9]{0,2}$");
    const keyPattern = new RegExp(`^${proposalKey.pattern.slice(1, -1)}$`);
    expect(["P1", "P999"].every((key) => keyPattern.test(key))).toBe(true);
    expect(["P0", "P1000", "550e8400-e29b-41d4-a716-446655440000"].some(
      (key) => keyPattern.test(key),
    )).toBe(false);

    expect(schema.properties.citations).toMatchObject({
      type: "array",
      maxItems: 0,
    });
    expect(schema.properties.advisory_only).toEqual({
      type: "boolean",
      const: true,
    });
    expect(schema.properties.workflow_mutated).toEqual({
      type: "boolean",
      const: false,
    });
    expect(schema.properties.human_acceptance_required).toEqual({
      type: "boolean",
      const: true,
    });
    expect(schema.properties.assumptions.items.properties.related_area.enum).toEqual(
      CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS,
    );
    expect(
      schema.properties.uncertainty_and_limitations.items.properties.category
        .enum,
    ).toEqual(CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES);

    const serializedSchema = JSON.stringify(schema);
    for (const forbiddenField of [
      "item_id",
      "owner_user_id",
      "sme_user_ids",
      "disposition",
      "adoption_timestamp",
      "audit_id",
      "g03_confirmation",
    ]) {
      expect(serializedSchema).not.toContain(`"${forbiddenField}"`);
    }
  });

  it("accepts a valid CS1 output fixture while semantic validation remains authoritative", () => {
    expect(
      validateCapaInvestigationPlanAdvisoryModelOutput(
        JSON.stringify(validOutput),
      ),
    ).toMatchObject({
      proposal: validOutput.proposal,
      citations: [],
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    });
  });
});
