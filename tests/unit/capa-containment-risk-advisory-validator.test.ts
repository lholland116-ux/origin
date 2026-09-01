import { describe, expect, it } from "vitest";

import {
  validateCapaContainmentRiskAdvisoryBrowserRequest,
} from "../../lib/capa/ai/capa-containment-risk-advisory-validator";

function draft(): Record<string, unknown> {
  return {
    actions: [{
      action_id: "A-1", action_type: "containment", description: "Hold affected inventory.",
      owner_user_id: null, action_date: null, target_date: "2026-09-02",
      completed_date: null, status: "in_progress", rationale: "Limit potential exposure.",
      supporting_evidence_references: ["EV-1"],
    }],
    impact_scope: { products: ["Product A"], processes: [], data: [], customers: [], patients: [] },
    risk_evaluation: { method: "Matrix", terminology_version: "1.0", result: "Human draft result", rationale: "Pending review." },
    missing_risk_information: ["Distribution extent"],
    escalations: [{ process: "Quality escalation", reference: "QE-1", status: "open", rationale: "Human review pending." }],
  };
}

function expectReason(value: unknown, reason: string): void {
  expect(() => validateCapaContainmentRiskAdvisoryBrowserRequest(value)).toThrowError(
    expect.objectContaining({ name: "CapaContainmentRiskAdvisoryValidationError", reason_code: reason }),
  );
}

describe("CAPA containment/risk advisory browser validation", () => {
  it("accepts and freezes the minimal request", () => {
    const result = validateCapaContainmentRiskAdvisoryBrowserRequest({});
    expect(result).toEqual({ requested_output: "containment_risk_analysis", focus: null, untrusted_human_draft: null });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("normalizes focus and accepts only a bounded exact untrusted human draft", () => {
    const result = validateCapaContainmentRiskAdvisoryBrowserRequest({
      focus: "  Review ｒisk inputs.  ",
      untrusted_human_draft: { trust: "untrusted_human_draft", content: draft() },
    });
    expect(result.focus).toBe("Review risk inputs.");
    expect(result.untrusted_human_draft?.trust).toBe("untrusted_human_draft");
    expect(result.untrusted_human_draft?.content.actions[0]?.description).toBe("Hold affected inventory.");
    expect(Object.isFrozen(result.untrusted_human_draft)).toBe(true);
    expect(Object.isFrozen(result.untrusted_human_draft?.content)).toBe(true);
  });

  for (const value of [null, [], "request", 1, true]) {
    it("rejects malformed request input", () => expectReason(value, "INVALID_ADVISORY_INPUT"));
  }

  for (const field of [
    "organization_id", "tenant", "workflow_state", "agent", "role", "authorization",
    "model", "prompt", "gate_result", "approval", "workflow_transition",
  ]) {
    it(`rejects browser authority field ${field}`, () =>
      expectReason({ [field]: "browser authority" }, "UNSUPPORTED_ADVISORY_INPUT_FIELD"));
  }

  it("rejects oversized focus", () =>
    expectReason({ focus: "x".repeat(1_001) }, "ADVISORY_FOCUS_TOO_LONG"));

  it("rejects unknown, partial, and malformed draft shapes", () => {
    expectReason({ untrusted_human_draft: { actions: [] } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
    expectReason({ untrusted_human_draft: draft() }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
    expectReason({ untrusted_human_draft: { trust: "authoritative", content: draft() } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
    expectReason({ untrusted_human_draft: { trust: "untrusted_human_draft", content: draft(), authority: true } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
    const value = draft(); value.approval = true;
    expectReason({ untrusted_human_draft: { trust: "untrusted_human_draft", content: value } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
  });

  it("rejects bounded-schema overflow", () => {
    const value = draft();
    (value.impact_scope as Record<string, unknown>).products = Array.from({ length: 101 }, () => "product");
    expectReason({ untrusted_human_draft: { trust: "untrusted_human_draft", content: value } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
  });
});
