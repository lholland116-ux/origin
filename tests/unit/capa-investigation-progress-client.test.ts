import { describe, expect, it, vi } from "vitest";
import { createInvestigationProgressAttempt, submitInvestigationProgressAttempt } from "../../app/capa/capa-investigation-progress-client";

const CASE = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const KEY = "30000000-0000-4000-8000-000000000001";
function attempt(status: "in_progress" | "dispositioned" = "in_progress", key = KEY) {
  return createInvestigationProgressAttempt({ caseId: CASE, recordVersion: 4, currentVersionId: VERSION,
    itemId: "INV-1", newStatus: status, disposition: status === "dispositioned" ? "NOT_REQUIRED" : null,
    dispositionRationale: status === "dispositioned" ? "Controlled rationale." : null, idempotencyKey: key })!;
}
function response(overrides: Record<string, unknown> = {}) {
  return { capa: { capa_case_id: CASE, case_number: "CAPA-1", status: "S40", record_version: 5,
    current_version_id: "20000000-0000-4000-8000-000000000002",
    investigation_plan_section_version_id: "40000000-0000-4000-8000-000000000001",
    updated_item_id: "INV-1", previous_item_status: "planned", new_item_status: "in_progress",
    updated_at: "2026-09-01T12:00:00.000Z", audit_event_id: "50000000-0000-4000-8000-000000000001" },
    replayed: false, correlation_id: "60000000-0000-4000-8000-000000000001", ...overrides };
}
describe("investigation progress browser client", () => {
  it("freezes the exact six-key request and sends its idempotency key unchanged", async () => {
    const target = attempt(); const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response()), { status: 200 }));
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.keys(JSON.parse(target.requestBody))).toEqual(["expected_record_version", "expected_current_version_id", "item_id", "new_status", "disposition", "disposition_rationale"]);
    await submitInvestigationProgressAttempt(target, fetcher);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ body: target.requestBody, headers: expect.objectContaining({ "idempotency-key": KEY }) });
    await submitInvestigationProgressAttempt(target, fetcher);
    expect(fetcher.mock.calls[1][1].body).toBe(target.requestBody);
  });
  it("creates a distinct frozen request for a changed action", () => {
    expect(attempt("dispositioned", "new-key").requestBody).not.toBe(attempt().requestBody);
    expect(attempt("dispositioned", "new-key").idempotencyKey).toBe("new-key");
  });
  it("strictly parses normal and replayed success", async () => {
    for (const replayed of [false, true]) {
      const result = await submitInvestigationProgressAttempt(attempt(), vi.fn().mockResolvedValue(new Response(JSON.stringify(response({ replayed })), { status: 200 })));
      expect(result).toMatchObject({ status: "updated", value: { replayed, status: "S40", updatedItemId: "INV-1" } });
    }
  });
  it("treats malformed 2xx and 5xx as exact-retry candidates", async () => {
    for (const reply of [new Response("{}", { status: 200 }), new Response("{}", { status: 500 })]) {
      await expect(submitInvestigationProgressAttempt(attempt(), vi.fn().mockResolvedValue(reply))).resolves.toMatchObject({ status: "failed", retryableExact: true });
    }
  });
  it.each([
    ["CAPA_INVESTIGATION_PROGRESS_VALIDATION_FAILED", false], ["CAPA_INVESTIGATION_PROGRESS_TRANSITION_CONFLICT", false],
    ["CAPA_ACCESS_DENIED", false], ["CAPA_NOT_FOUND", false], ["CAPA_CONCURRENCY_CONFLICT", true],
    ["CAPA_WORKFLOW_CONFLICT", true], ["CAPA_IDEMPOTENCY_CONFLICT", false],
  ])("maps controlled failure %s", async (code, refresh) => {
    const body = { error: { code, message: "Safe failure", issues: [{ path: "item_id", message: code === "CAPA_INVESTIGATION_PROGRESS_TRANSITION_CONFLICT" ? "OPEN_INVESTIGATION_DEPENDENCY" : "reason" }] }, correlation_id: "trace" };
    await expect(submitInvestigationProgressAttempt(attempt(), vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })))).resolves.toMatchObject({ status: "failed", code, requiresRefresh: refresh, reasons: [code === "CAPA_INVESTIGATION_PROGRESS_TRANSITION_CONFLICT" ? "OPEN_INVESTIGATION_DEPENDENCY" : "reason"] });
  });
  it("maps a network failure to exact retry", async () => {
    await expect(submitInvestigationProgressAttempt(attempt(), vi.fn().mockRejectedValue(new Error("network")))).resolves.toMatchObject({ status: "failed", retryableExact: true });
  });
  it.each([
    ["capa_case_id", "10000000-0000-4000-8000-000000000099"],
    ["current_version_id", "not-a-uuid"], ["investigation_plan_section_version_id", "not-a-uuid"],
    ["audit_event_id", "not-a-uuid"], ["updated_at", "today"],
    ["updated_item_id", "INV-OTHER"], ["new_item_status", "completed"],
  ])("rejects malformed successful %s", async (field, value) => {
    const body = response(); body.capa = { ...body.capa, [field]: value };
    await expect(submitInvestigationProgressAttempt(attempt(), vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })))).resolves.toMatchObject({ status: "failed", retryableExact: true });
  });
});
