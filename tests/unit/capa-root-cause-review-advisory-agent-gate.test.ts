import { describe, expect, it, vi } from "vitest";
import {
  ActivationBackedCapaRootCauseReviewAdvisoryAgentGate,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-agent-gate";

const context: any = { workflow_state: "S50", active_roles: [{ role_id: "CAPA_REVIEWER" }] };

describe("S50 root-cause review activation-backed agent gate", () => {
  it("passes the exact governed capability facts", () => {
    const evaluate = vi.fn(() => ({ eligible: true }));
    const gate = new ActivationBackedCapaRootCauseReviewAdvisoryAgentGate({ evaluate } as never);
    expect(gate.evaluate({ context, agent: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT, operation: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION })).toBe(true);
    expect(evaluate).toHaveBeenCalledWith({ agent_id: "AG-REVIEW", agent_version: "ag-review-1.0.0", workflow_state: "S50", operation: "assemble_review_packet", active_role_ids: ["CAPA_REVIEWER"], requested_tool_ids: ["TOOL-CASE-READ", "TOOL-EVIDENCE-READ", "TOOL-STRUCTURED-DRAFT"], output_schema_version: "capa_review_packet_draft-1.0.0" });
  });

  it("fails closed for state, operation, and activation mismatches", () => {
    const evaluate = vi.fn(() => ({ eligible: false }));
    const gate = new ActivationBackedCapaRootCauseReviewAdvisoryAgentGate({ evaluate } as never);
    expect(gate.evaluate({ context: { ...context, workflow_state: "S60" }, agent: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT, operation: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION } as never)).toBe(false);
    expect(gate.evaluate({ context, agent: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT, operation: "approve_root_cause" } as never)).toBe(false);
    expect(gate.evaluate({ context, agent: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT, operation: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION })).toBe(false);
  });
});
