import { describe, expect, it } from "vitest";
import {
  CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
  validateCapaActionPlanReviewReturnResponseDraft,
  validateCapaActionPlanReviewReturnResponseEditableContent,
} from "../../lib/capa/domain/capa-action-plan-review-return-response";

const SOURCE = "30000000-0000-4000-8000-000000000001";
const RESULT = "30000000-0000-4000-8000-000000000002";
const EVENT = "50000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const narrative = "The action plan was revised to address the review return.";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_ACTION_PLAN_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
    response_narrative: narrative,
    return_transition_audit_event_id: EVENT,
    source_case_version_id: SOURCE,
    resulting_case_version_id: RESULT,
    responded_by: { actor_type: "human", actor_id: USER },
    responded_at: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("S60 action-plan review return-response contract", () => {
  it("accepts the editable narrative and server-bound draft, returning frozen values", () => {
    const editable = validateCapaActionPlanReviewReturnResponseEditableContent({ response_narrative: narrative });
    expect(editable.status).toBe("valid");
    const result = validateCapaActionPlanReviewReturnResponseDraft(draft());
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.value).toEqual(draft());
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.responded_by)).toBe(true);
  });

  it("rejects malformed, blank, unbounded, unknown, and client-owned fields", () => {
    expect(validateCapaActionPlanReviewReturnResponseEditableContent(null)).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_RESPONSE_OBJECT" });
    expect(validateCapaActionPlanReviewReturnResponseEditableContent({ response_narrative: "  " })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_RESPONSE_NARRATIVE" });
    expect(validateCapaActionPlanReviewReturnResponseEditableContent({ response_narrative: narrative, reviewer_user_id: USER })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_RESPONSE_FIELDS" });
    expect(validateCapaActionPlanReviewReturnResponseDraft({ ...draft(), schema_version: "wrong" })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_RESPONSE_SCHEMA_VERSION" });
    expect(validateCapaActionPlanReviewReturnResponseDraft({ ...draft(), source_case_version_id: "not-a-uuid" })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_RESPONSE_CYCLE_IDENTITY" });
    expect(validateCapaActionPlanReviewReturnResponseDraft({ ...draft(), response_narrative: "x".repeat(4001) })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_RESPONSE_NARRATIVE" });
    expect(validateCapaActionPlanReviewReturnResponseDraft({ ...draft(), decided_at: "2026-09-10T12:00:00.000Z" })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_RESPONSE_FIELDS" });
  });
});
