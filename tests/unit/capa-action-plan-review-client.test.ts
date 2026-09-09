import { describe, expect, it, vi } from "vitest";
import {
  createCapaActionPlanReviewAttempt,
  submitCapaActionPlanReviewAttempt,
} from "../../app/capa/capa-action-plan-review-client";

const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const RESULT = "40000000-0000-4000-8000-000000000002";
const ACTION_PLAN = "50000000-0000-4000-8000-000000000001";
const REVIEWER = "60000000-0000-4000-8000-000000000001";
const AUDIT = "70000000-0000-4000-8000-000000000001";
const CORRELATION = "80000000-0000-4000-8000-000000000001";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function attempt(decision: "approve" | "return" = "approve") {
  return createCapaActionPlanReviewAttempt({
    caseId: CASE,
    recordVersion: 7,
    currentVersionId: SOURCE,
    sourceCaseVersionId: SOURCE,
    actionPlanSectionVersionId: ACTION_PLAN,
    decision,
    rationale: "The submitted plan is ready for the next controlled step.",
    idempotencyKey: "review-attempt-1",
  })!;
}

function success(decision: "approve" | "return" = "approve", replayed = false) {
  const state = decision === "approve" ? "S80" : "S60";
  return {
    status: "decided",
    decision,
    capa: {
      capa_case_id: CASE,
      case_number: "CAPA-1",
      status: state,
      workflow_state: state,
      record_version: 8,
      current_version_id: RESULT,
      source_case_version_id: SOURCE,
      action_plan_section_version_id: ACTION_PLAN,
      resulting_case_version_id: RESULT,
    },
    review_decision: {
      schema_version: "capa-action-plan-review-decision-1.0.0",
      decision,
      rationale: "The submitted plan is ready for the next controlled step.",
      reviewer_user_id: REVIEWER,
      decided_at: "2026-09-09T12:00:00.000Z",
    },
    transition_audit_event_id: AUDIT,
    replayed,
    correlation_id: CORRELATION,
  };
}

describe("S70 action-plan review browser client", () => {
  it("builds the exact approve/return request body", () => {
    const approve = attempt();
    expect(JSON.parse(approve.requestBody)).toEqual({
      expected_record_version: 7,
      expected_current_version_id: SOURCE,
      schema_version: "capa-action-plan-review-decision-1.0.0",
      source_case_version_id: SOURCE,
      action_plan_section_version_id: ACTION_PLAN,
      decision: "approve",
      rationale: "The submitted plan is ready for the next controlled step.",
    });
    expect(JSON.parse(attempt("return").requestBody).decision).toBe("return");
  });

  it("parses approve and return outcomes, including exact replay", async () => {
    await expect(submitCapaActionPlanReviewAttempt(attempt(), vi.fn().mockResolvedValue(response(success())))).resolves.toMatchObject({ status: "decided", workflowState: "S80", replayed: false });
    await expect(submitCapaActionPlanReviewAttempt(attempt("return"), vi.fn().mockResolvedValue(response(success("return", true))))).resolves.toMatchObject({ status: "decided", workflowState: "S60", replayed: true });
  });

  it("rejects malformed successful responses", async () => {
    const malformed = success();
    malformed.capa.action_plan_section_version_id = RESULT;
    await expect(submitCapaActionPlanReviewAttempt(attempt(), vi.fn().mockResolvedValue(response(malformed)))).resolves.toMatchObject({ status: "failed", retryableExact: false });
  });

  it("maps controlled failures without exposing internal details", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { code: "CAPA_WORKFLOW_CONFLICT", message: "The CAPA case is not available for Action Plan Review.", correlation_id: CORRELATION, issues: [{ path: "workflow", message: "S70 is required." }] } }, 409));
    await expect(submitCapaActionPlanReviewAttempt(attempt(), fetcher)).resolves.toMatchObject({ status: "failed", code: "CAPA_WORKFLOW_CONFLICT", requiresRefresh: true, reasons: ["S70 is required."] });
  });

  it("retains the exact idempotency key and body for ambiguous retry", async () => {
    const review = attempt();
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    await expect(submitCapaActionPlanReviewAttempt(review, fetcher)).resolves.toMatchObject({ status: "failed", retryableExact: true });
    expect(review.idempotencyKey).toBe("review-attempt-1");
    expect(review.requestBody).toBe(review.requestBody);
    await expect(submitCapaActionPlanReviewAttempt(review, fetcher)).resolves.toMatchObject({ status: "failed", retryableExact: true });
    expect(fetcher).toHaveBeenNthCalledWith(1, expect.stringContaining(`/action-plan-review`), expect.objectContaining({ "body": review.requestBody }));
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.stringContaining(`/action-plan-review`), expect.objectContaining({ "body": review.requestBody }));
  });

  it.each(["", " ", "  rationale"]) ("rejects rationale %j", (rationale) => {
    expect(createCapaActionPlanReviewAttempt({ ...attemptInput(), rationale })).toBeNull();
  });
});

function attemptInput() {
  return {
    caseId: CASE,
    recordVersion: 7,
    currentVersionId: SOURCE,
    sourceCaseVersionId: SOURCE,
    actionPlanSectionVersionId: ACTION_PLAN,
    decision: "approve" as const,
    rationale: "The submitted plan is ready for the next controlled step.",
    idempotencyKey: "review-attempt-1",
  };
}
