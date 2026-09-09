import { describe, expect, it } from "vitest";
import {
  CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
  validateCapaActionPlanReviewDecision,
} from "../../lib/capa/domain/capa-action-plan-review-decision";

const SOURCE = "20000000-0000-4000-8000-000000000001";
const ACTION_PLAN = "30000000-0000-4000-8000-000000000001";

function decision(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
    source_case_version_id: SOURCE,
    action_plan_section_version_id: ACTION_PLAN,
    decision: "approve",
    rationale: "The action plan addresses the reviewed causes.",
    ...overrides,
  };
}

function invalid(result: { readonly status: string; readonly reason_code?: string }, reason: string) {
  expect(result).toEqual({ status: "invalid", reason_code: reason });
}

describe("CAPA action-plan review decision contract", () => {
  it("accepts approve and return decisions", () => {
    expect(validateCapaActionPlanReviewDecision(decision())).toMatchObject({ status: "valid" });
    expect(validateCapaActionPlanReviewDecision(decision({ decision: "return", rationale: "The owner and due date require revision." }))).toMatchObject({ status: "valid" });
  });

  it.each([null, [], "decision", 42])("rejects malformed non-object input: %s", (value) => {
    invalid(validateCapaActionPlanReviewDecision(value), "INVALID_ACTION_PLAN_REVIEW_DECISION_OBJECT");
  });

  it("rejects the wrong schema version and invalid UUID bindings", () => {
    invalid(validateCapaActionPlanReviewDecision(decision({ schema_version: "wrong" })), "INVALID_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION");
    invalid(validateCapaActionPlanReviewDecision(decision({ source_case_version_id: "not-a-uuid" })), "INVALID_ACTION_PLAN_REVIEW_DECISION_SOURCE_CASE_VERSION_ID");
    invalid(validateCapaActionPlanReviewDecision(decision({ action_plan_section_version_id: "not-a-uuid" })), "INVALID_ACTION_PLAN_REVIEW_DECISION_SECTION_VERSION_ID");
  });

  it("rejects unsupported decisions and blank rationale", () => {
    invalid(validateCapaActionPlanReviewDecision(decision({ decision: "defer" })), "INVALID_ACTION_PLAN_REVIEW_DECISION");
    invalid(validateCapaActionPlanReviewDecision(decision({ rationale: "" })), "INVALID_ACTION_PLAN_REVIEW_DECISION_RATIONALE");
    invalid(validateCapaActionPlanReviewDecision(decision({ rationale: "   " })), "INVALID_ACTION_PLAN_REVIEW_DECISION_RATIONALE");
  });

  it("rejects unknown fields and freezes the normalized valid value", () => {
    invalid(validateCapaActionPlanReviewDecision(decision({ reviewer_id: SOURCE })), "INVALID_ACTION_PLAN_REVIEW_DECISION_FIELDS");
    const result = validateCapaActionPlanReviewDecision(decision({ decision: "return" }));
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(result.value).toEqual({
        schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
        source_case_version_id: SOURCE,
        action_plan_section_version_id: ACTION_PLAN,
        decision: "return",
        rationale: "The action plan addresses the reviewed causes.",
      });
    }
  });
});
