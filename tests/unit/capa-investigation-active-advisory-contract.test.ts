import { describe, expect, it } from "vitest";

import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS,
  type RawCapaInvestigationActiveAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-investigation-active-advisory-contract";

describe("CAPA investigation-active advisory contract", () => {
  it("publishes advisory analysis fields without authoritative S40 fields", () => {
    expect(CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT).toBe(
      "investigation_analysis_draft",
    );

    expect(
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
    ).toBe(
      "capa_investigation_analysis_draft-1.0.0",
    );

    expect(
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS,
    ).toEqual([
      "evidence_gaps",
      "conflicting_information",
      "assumptions",
      "causal_hypotheses",
      "alternative_hypotheses",
      "investigation_recommendations",
    ]);

    expect(
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS,
    ).not.toEqual(
      expect.arrayContaining([
        "item_id",
        "hypothesis_id",
        "evidence_status",
        "assumption_status",
        "conflict_status",
        "status",
        "causal_role",
        "responsible_user_id",
        "provenance",
        "adopted_by_user_id",
        "adopted_at",
        "root_cause_not_confirmed",
      ]),
    );
  });

  it("defines raw output with literal advisory-only controls", () => {
    const raw = {
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
    } satisfies RawCapaInvestigationActiveAdvisoryModelOutput;

    expect(raw.citations).toEqual([]);
    expect(raw.advisory_only).toBe(true);
    expect(raw.workflow_mutated).toBe(false);
    expect(raw.human_acceptance_required).toBe(true);
  });
});
