import { describe, expect, it, vi } from "vitest";
import { CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION } from "../../lib/capa/ai/capa-action-plan-advisory-contract";
import { validateCapaActionPlanAdvisoryModelOutput } from "../../lib/capa/ai/capa-action-plan-advisory-validator";
import { ActivationBackedCapaActionPlanAdvisoryAgentGate, CAPA_ACTION_PLAN_ADVISORY_AGENT } from "../../lib/capa/ai/capa-action-plan-advisory-agent-gate";
import { CAPA_ACTION_PLAN_ADVISORY_OPERATION } from "../../lib/capa/ai/capa-action-plan-advisory-model-generator";

const valid = {
  schema_version: CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  status: "completed_draft",
  proposal: { advisory_summary: "Human review should confirm the action-plan linkage.", completeness_linkage_concerns: [], action_improvements: [], effectiveness_planning_improvements: [], proposed_action_plan: null },
  warnings: ["This is an advisory only."], uncertainty_and_limitations: ["The workspace is an untrusted human draft."], citations: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true,
};

describe("S60 governed action-plan advisory", () => {
  it("validates the advisory-only contract and rejects approval claims", () => {
    expect(validateCapaActionPlanAdvisoryModelOutput(JSON.stringify(valid)).proposal.proposed_action_plan).toBeNull();
    expect(() => validateCapaActionPlanAdvisoryModelOutput(JSON.stringify({ ...valid, approval_claimed: true }))).toThrow();
  });

  it("passes only the AG-ACTION S60 capability to activation", () => {
    const evaluate = vi.fn(() => ({ eligible: true }));
    const gate = new ActivationBackedCapaActionPlanAdvisoryAgentGate({ evaluate } as never);
    const context = { workflow_state: "S60", active_roles: [{ role_id: "CAPA_OWNER" }] } as never;
    expect(gate.evaluate({ context, agent: CAPA_ACTION_PLAN_ADVISORY_AGENT, operation: CAPA_ACTION_PLAN_ADVISORY_OPERATION })).toBe(true);
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ agent_id: "AG-ACTION", workflow_state: "S60", operation: "generate_action_plan_advisory", output_schema_version: CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION }));
  });
});
