import { describe, expect, it, vi } from "vitest";
import { createActionPlanSubmissionAttempt, submitActionPlanSubmissionAttempt } from "../../app/capa/capa-action-plan-submission-client";

const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const SECTION = "70000000-0000-4000-8000-000000000002";
const AUDIT = "80000000-0000-4000-8000-000000000001";
const CORRELATION = "60000000-0000-4000-8000-000000000001";

function attempt(key = "action-plan-1", version = 4) {
  return createActionPlanSubmissionAttempt({ caseId: CASE, recordVersion: version, currentVersionId: SOURCE, idempotencyKey: key })!;
}
function success(replayed = false) {
  return { capa: { capa_case_id: CASE, case_number: "CAPA-1", status: "S70", record_version: 5, current_version_id: NEXT, submitted_version_id: NEXT, action_plan_section_version_id: SECTION, submitted_at: "2026-09-09T12:00:00.000Z", transition_audit_event_id: AUDIT }, replayed, correlation_id: CORRELATION };
}

describe("action-plan submission browser client", () => {
  it("sends only the expected version body to the S60 submission endpoint", async () => {
    const target = attempt();
    const body = JSON.parse(target.requestBody);
    expect(Object.keys(body)).toEqual(["expected_record_version", "expected_current_version_id"]);
    expect(Object.isFrozen(target)).toBe(true);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(success()), { status: 200 }));
    await expect(submitActionPlanSubmissionAttempt(target, fetcher)).resolves.toMatchObject({ status: "submitted", replayed: false });
    expect(fetcher).toHaveBeenCalledWith(`/api/capa/${CASE}/submit-action-plan`, expect.objectContaining({ method: "POST", body: target.requestBody, headers: expect.objectContaining({ "idempotency-key": "action-plan-1" }) }));
  });

  it.each([false, true])("strictly parses S70 success replayed=%s", async (replayed) => {
    await expect(submitActionPlanSubmissionAttempt(attempt(), vi.fn().mockResolvedValue(new Response(JSON.stringify(success(replayed)), { status: 200 })))).resolves.toMatchObject({ status: "submitted", replayed });
  });

  it("preserves deterministic readiness/conflict issues and refresh signals", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "CAPA_ACTION_PLAN_SUBMISSION_BLOCKED", message: "Blocked", issues: [{ path: "readiness.blocker_codes", message: "EMPTY_ACTION_PLAN" }] }, correlation_id: CORRELATION }), { status: 409 }));
    await expect(submitActionPlanSubmissionAttempt(attempt(), fetcher)).resolves.toMatchObject({ status: "failed", code: "CAPA_ACTION_PLAN_SUBMISSION_BLOCKED", reasons: ["EMPTY_ACTION_PLAN"], requiresRefresh: false });
    const conflict = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "CAPA_CONCURRENCY_CONFLICT", message: "Changed" } }), { status: 409 }));
    await expect(submitActionPlanSubmissionAttempt(attempt(), conflict)).resolves.toMatchObject({ status: "failed", code: "CAPA_CONCURRENCY_CONFLICT", requiresRefresh: true });
  });

  it("treats malformed success and transport failure as exact retry candidates", async () => {
    await expect(submitActionPlanSubmissionAttempt(attempt(), vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))).resolves.toMatchObject({ status: "failed", retryableExact: true });
    await expect(submitActionPlanSubmissionAttempt(attempt(), vi.fn().mockRejectedValue(new Error("network")))).resolves.toMatchObject({ status: "failed", retryableExact: true });
  });
});
