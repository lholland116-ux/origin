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
});
