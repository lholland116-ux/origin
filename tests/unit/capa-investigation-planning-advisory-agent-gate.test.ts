import { describe, expect, it, vi } from "vitest";

import {
  ActivationBackedCapaInvestigationPlanningAdvisoryAgentGate,
  CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
  CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-agent-gate";

const context: any = {
  workflow_state: "S30",
  active_roles: [
    { role_id: "CAPA_OWNER" },
    { role_id: "CAPA_CONTRIBUTOR" },
  ],
};

function input() {
  return {
    context,
    agent: CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
    operation: CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
  };
}

describe("S30 investigation-planning activation-backed agent gate", () => {
  it("passes exact AG-PLAN activation facts to the common service", () => {
    const evaluate = vi.fn().mockReturnValue({
      eligible: true,
      reason_code: "AGENT_ELIGIBLE",
    });
    const gate = new ActivationBackedCapaInvestigationPlanningAdvisoryAgentGate({
      evaluate,
    } as never);

    expect(gate.evaluate(input())).toBe(true);
    expect(evaluate).toHaveBeenCalledWith({
      agent_id: "AG-PLAN",
      agent_version: "ag-plan-1.0.0",
      workflow_state: "S30",
      operation: "draft_investigation_plan",
      active_role_ids: ["CAPA_OWNER", "CAPA_CONTRIBUTOR"],
      requested_tool_ids: [
        "TOOL-CASE-READ",
        "TOOL-STRUCTURED-DRAFT",
        "TOOL-FEEDBACK",
      ],
      output_schema_version: "capa_investigation_plan_draft-1.0.0",
    });
  });

  it("returns false for ineligible or failed activation decisions", () => {
    const rejected = vi.fn().mockReturnValue({
      eligible: false,
      reason_code: "TOOL_NOT_ALLOWED",
    });
    expect(
      new ActivationBackedCapaInvestigationPlanningAdvisoryAgentGate({
        evaluate: rejected,
      } as never).evaluate(input()),
    ).toBe(false);

    const failed = vi.fn().mockImplementation(() => {
      throw new Error("activation failure");
    });
    expect(
      new ActivationBackedCapaInvestigationPlanningAdvisoryAgentGate({
        evaluate: failed,
      } as never).evaluate(input()),
    ).toBe(false);
  });
});
