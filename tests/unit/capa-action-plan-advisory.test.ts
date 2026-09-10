import { describe, expect, it, vi } from "vitest";
import { CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION } from "../../lib/capa/ai/capa-action-plan-advisory-contract";
import { validateCapaActionPlanAdvisoryModelOutput } from "../../lib/capa/ai/capa-action-plan-advisory-validator";
import { ActivationBackedCapaActionPlanAdvisoryAgentGate, CAPA_ACTION_PLAN_ADVISORY_AGENT } from "../../lib/capa/ai/capa-action-plan-advisory-agent-gate";
import { CAPA_ACTION_PLAN_ADVISORY_OPERATION } from "../../lib/capa/ai/capa-action-plan-advisory-model-generator";
import { validateCapaActionPlanAdvisoryAuthoritativeBindings } from "../../lib/capa/ai/capa-action-plan-advisory-service";
import { createActionPlanItemFromAdvisoryCandidate } from "../../app/capa/CapaActionPlanWorkspace";

const valid = {
  schema_version: CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  status: "completed_draft",
  proposal: { advisory_summary: "Human review should confirm the action-plan linkage.", completeness_linkage_concerns: [], action_improvements: [], action_candidates: [], effectiveness_planning_improvements: [], proposed_action_plan: null },
  warnings: ["This is an advisory only."], uncertainty_and_limitations: ["The workspace is an untrusted human draft."], citations: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true,
};

describe("S60 governed action-plan advisory", () => {
  it("validates the advisory-only contract and rejects approval claims", () => {
    expect(validateCapaActionPlanAdvisoryModelOutput(JSON.stringify(valid)).proposal.proposed_action_plan).toBeNull();
    expect(() => validateCapaActionPlanAdvisoryModelOutput(JSON.stringify({ ...valid, approval_claimed: true }))).toThrow();
  });

  it("strictly validates an adoptable action candidate and rejects unsafe target shapes", () => {
    const candidate = {
      suggestion_key: "CAND-1",
      action_type: "corrective",
      description: "Add a controlled verification step.",
      deliverable: "Verification record",
      implementation_evidence: "Completed verification record and review log",
      unintended_consequence_assessment: "Confirm the added step does not delay release.",
      linked_targets: [{ target_type: "cause", target_id: "HYP-1", rationale: "Directly addresses the proposed root cause." }],
      effectiveness_planning: null,
      reference_keys: ["R1"],
      human_review_question: "Is this action feasible for the CAPA owner?",
    };
    const parsed = validateCapaActionPlanAdvisoryModelOutput(JSON.stringify({ ...valid, proposal: { ...valid.proposal, action_candidates: [candidate] } }));
    expect(parsed.proposal.action_candidates[0]).toMatchObject(candidate);
    expect(() => validateCapaActionPlanAdvisoryModelOutput(JSON.stringify({ ...valid, proposal: { ...valid.proposal, action_candidates: [{ ...candidate, linked_targets: [{ ...candidate.linked_targets[0], target_type: "risk" }] }] } }))).toThrow();
    expect(() => validateCapaActionPlanAdvisoryModelOutput(JSON.stringify({ ...valid, proposal: { ...valid.proposal, action_candidates: [{ ...candidate, description: "" }] } }))).toThrow();
  });

  it("creates only an incomplete local action with explicit human adoption provenance", () => {
    const candidate = {
      suggestion_key: "CAND-2",
      action_type: "preventive" as const,
      description: "Review the control before release.",
      deliverable: "Completed control review",
      implementation_evidence: "Signed control review record",
      unintended_consequence_assessment: "Confirm the review does not create a release bottleneck.",
      linked_targets: [{ target_type: "gap" as const, target_id: "LED-1", rationale: "Addresses the missing information." }],
      effectiveness_planning: null,
      reference_keys: ["R1"],
      human_review_question: "Should this action be added?",
    };
    const item = createActionPlanItemFromAdvisoryCandidate(candidate, "90000000-0000-4000-8000-000000000001", "2026-09-10T12:00:00.000Z", "80000000-0000-4000-8000-000000000001");
    expect(item.item_id).toBe("80000000-0000-4000-8000-000000000001");
    expect(item.owner_user_id).toBeNull();
    expect(item.due_date).toBeNull();
    expect(item.effectiveness_check_required).toBe(false);
    expect(item.draft_provenance).toEqual({ source_type: "ai_proposal", source_reference: "CAND-2", adopted_by_user_id: "90000000-0000-4000-8000-000000000001", adopted_at: "2026-09-10T12:00:00.000Z" });
  });

  it("binds candidate targets to the authoritative S60 root-cause and ledger content", () => {
    const context = {
      workspace: null,
      sections: {
        root_cause_package: { content: { hypotheses: [{ hypothesis_id: "HYP-1", causal_role: "proposed_root_cause" }] } },
        investigation_ledger: { content: { items: [{ item_id: "LED-1", information_class: "missing_information" }] } },
      },
    } as never;
    const candidate = {
      suggestion_key: "CAND-3", action_type: "corrective", description: "Close the gap.", deliverable: "Gap closure record", implementation_evidence: "Review record", unintended_consequence_assessment: "Check workload.", linked_targets: [{ target_type: "cause", target_id: "HYP-1", rationale: "Addresses the cause." }], effectiveness_planning: null, reference_keys: [], human_review_question: "Should this be adopted?",
    };
    const response = { proposal: { completeness_linkage_concerns: [], action_improvements: [], action_candidates: [candidate], effectiveness_planning_improvements: [] } };
    expect(validateCapaActionPlanAdvisoryAuthoritativeBindings(response as never, context, [])).toBe(true);
    expect(validateCapaActionPlanAdvisoryAuthoritativeBindings({ proposal: { ...response.proposal, action_candidates: [{ ...candidate, linked_targets: [{ ...candidate.linked_targets[0], target_id: "HYP-invented" }] }] } } as never, context, [])).toBe(false);
    expect(validateCapaActionPlanAdvisoryAuthoritativeBindings({ proposal: { ...response.proposal, action_candidates: [{ ...candidate, linked_targets: [{ ...candidate.linked_targets[0], target_type: "gap", target_id: "LED-1" }] }] } } as never, context, [])).toBe(true);
  });

  it("passes only the AG-ACTION S60 capability to activation", () => {
    const evaluate = vi.fn(() => ({ eligible: true }));
    const gate = new ActivationBackedCapaActionPlanAdvisoryAgentGate({ evaluate } as never);
    const context = { workflow_state: "S60", active_roles: [{ role_id: "CAPA_OWNER" }] } as never;
    expect(gate.evaluate({ context, agent: CAPA_ACTION_PLAN_ADVISORY_AGENT, operation: CAPA_ACTION_PLAN_ADVISORY_OPERATION })).toBe(true);
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ agent_id: "AG-ACTION", workflow_state: "S60", operation: "generate_action_plan_advisory", output_schema_version: CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION }));
  });
});
