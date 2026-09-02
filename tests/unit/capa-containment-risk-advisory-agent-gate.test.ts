import { describe, expect, it, vi } from "vitest";
import { ActivationBackedCapaContainmentRiskAdvisoryAgentGate } from "../../lib/capa/ai/capa-containment-risk-advisory-agent-gate";
import { CAPA_CONTAINMENT_RISK_ADVISORY_AGENT, CAPA_CONTAINMENT_RISK_ADVISORY_OPERATION } from "../../lib/capa/ai/capa-containment-risk-advisory-service";

const context: any = { workflow_state: "S20", active_roles: [{ role_id: "CAPA_OWNER" }, { role_id: "CAPA_CONTRIBUTOR" }] };

function input() { return { context, agent: CAPA_CONTAINMENT_RISK_ADVISORY_AGENT, operation: CAPA_CONTAINMENT_RISK_ADVISORY_OPERATION }; }

describe("S20 activation-backed agent gate", () => {
  it("maps trusted S20 facts to the common activation boundary", () => {
    const evaluate = vi.fn().mockReturnValue({ eligible: true, reason_code: "AGENT_ELIGIBLE" });
    expect(new ActivationBackedCapaContainmentRiskAdvisoryAgentGate({ evaluate } as never).evaluate(input())).toBe(true);
    expect(evaluate).toHaveBeenCalledWith({ agent_id: "AG-INTAKE", agent_version: "ag-intake-1.0.0", workflow_state: "S20", operation: "analyze_containment_impact_risk", active_role_ids: ["CAPA_OWNER", "CAPA_CONTRIBUTOR"], requested_tool_ids: ["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"], output_schema_version: "capa-containment-risk-advisory-1.0.0" });
  });

  it("returns false for a rejected activation decision", () => {
    const evaluate = vi.fn().mockReturnValue({ eligible: false, reason_code: "TOOL_NOT_ALLOWED" });
    expect(new ActivationBackedCapaContainmentRiskAdvisoryAgentGate({ evaluate } as never).evaluate(input())).toBe(false);
  });
});
