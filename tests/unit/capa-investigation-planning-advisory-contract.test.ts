import { describe, expect, it } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS,
  type RawCapaInvestigationPlanAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  createInitialCapaAgentRegistry,
} from "../../lib/capa/ai/capa-agent-registry";

describe("CAPA investigation-planning advisory contract", () => {
  it("publishes the AG-PLAN operation and only recommendation fields", () => {
    expect(CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT).toBe(
      "investigation_plan_draft",
    );
    expect(CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION).toBe(
      "capa_investigation_plan_draft-1.0.0",
    );
    expect(CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS).toEqual([
      "investigation_questions",
      "evidence_requests",
      "method_suggestions",
      "dependencies",
      "proposed_owner_role",
      "gaps",
    ]);
    expect(CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS).not.toContain(
      "dependent_question",
    );
    expect(
      CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS,
    ).not.toEqual(
      expect.arrayContaining([
        "item_id",
        "owner_user_id",
        "due_date",
        "sme_user_ids",
        "status",
        "draft_provenance",
      ]),
    );
  });

  it("defines a raw output with advisory-only literal flags", () => {
    const raw = {
      proposal: {
        investigation_questions: [],
        evidence_requests: [],
        method_suggestions: [],
        dependencies: [],
        proposed_owner_role: [],
        gaps: [],
      },
      assumptions: [],
      uncertainty_and_limitations: [],
      citations: [],
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    } satisfies RawCapaInvestigationPlanAdvisoryModelOutput;

    expect(raw.citations).toEqual([]);
    expect(raw.advisory_only).toBe(true);
  });

  it("matches the existing derived AG-PLAN capability without adding one", () => {
    const agent = createInitialCapaAgentRegistry().findExact(
      "AG-PLAN",
      "ag-plan-1.0.0",
    );

    expect(agent?.activation_capabilities).toHaveLength(1);
    expect(agent?.activation_capabilities[0]).toMatchObject({
      eligible_states: ["S30"],
      operation: "draft_investigation_plan",
      output_schema_version:
        CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
    });
  });
});
