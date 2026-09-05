import { describe, expect, it, vi } from "vitest";

import {
  ActivationBackedCapaInvestigationActiveAdvisoryAgentGate,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION,
} from "../../lib/capa/ai/capa-investigation-active-advisory-agent-gate";

const context: any = {
  workflow_state: "S40",
  active_roles: [
    { role_id: "CAPA_OWNER" },
    { role_id: "CAPA_CONTRIBUTOR" },
  ],
};

function input() {
  return {
    context,
    agent: CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT,
    operation: CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION,
  };
}

describe("S40 investigation-active activation-backed agent gate", () => {
  it("passes exact qualified AG-RCA S40 capability facts to activation", () => {
    const evaluate = vi.fn().mockReturnValue({
      eligible: true,
      reason_code: "AGENT_ELIGIBLE",
    });
    const gate = new ActivationBackedCapaInvestigationActiveAdvisoryAgentGate({
      evaluate,
    } as never);

    expect(gate.evaluate(input())).toBe(true);
    expect(evaluate).toHaveBeenCalledWith({
      agent_id: "AG-RCA",
      agent_version: "ag-rca-1.0.0",
      workflow_state: "S40",
      operation: "facilitate_root_cause",
      active_role_ids: ["CAPA_OWNER", "CAPA_CONTRIBUTOR"],
      requested_tool_ids: ["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"],
      output_schema_version: "capa_investigation_analysis_draft-1.0.0",
    });
  });

  it("fails closed for mismatched state, version, schema, operation, role, or activation failure", () => {
    const evaluate = vi.fn().mockReturnValue({
      eligible: false,
      reason_code: "REQUESTER_ROLE_NOT_ELIGIBLE",
    });
    const gate = new ActivationBackedCapaInvestigationActiveAdvisoryAgentGate({
      evaluate,
    } as never);

    expect(gate.evaluate({ ...input(), context: { ...context, workflow_state: "S50" } } as never)).toBe(false);
    expect(gate.evaluate({ ...input(), agent: { ...CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT, agent_version: "wrong" } } as never)).toBe(false);
    expect(gate.evaluate({ ...input(), agent: { ...CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT, output_schema_version: "wrong" } } as never)).toBe(false);
    expect(gate.evaluate({ ...input(), operation: "draft_action_plan" } as never)).toBe(false);
    expect(gate.evaluate(input())).toBe(false);

    const failed = new ActivationBackedCapaInvestigationActiveAdvisoryAgentGate({
      evaluate: vi.fn(() => {
        throw new Error("activation failure");
      }),
    } as never);
    expect(failed.evaluate(input())).toBe(false);
  });
});
