import { describe, expect, it, vi } from "vitest";
import { createRootCauseSubmissionAttempt, submitRootCauseSubmissionAttempt } from "../../app/capa/capa-root-cause-submission-client";
const CASE = "10000000-0000-4000-8000-000000000001";
function attempt(key = "d2-key", version = 7) { return createRootCauseSubmissionAttempt({ caseId: CASE, recordVersion: version,
  currentVersionId: `20000000-0000-4000-8000-00000000000${version}`, ledger: { items: [] },
  rootCausePackage: { hypotheses: [], root_cause_not_confirmed: null }, idempotencyKey: key })!; }
function success(replayed = false) { return { capa: { capa_case_id: CASE, case_number: "CAPA-1", status: "S50", record_version: 8,
  current_version_id: "20000000-0000-4000-8000-000000000008", submitted_version_id: "20000000-0000-4000-8000-000000000008",
  evidence_assumption_ledger_section_version_id: "30000000-0000-4000-8000-000000000001",
  root_cause_package_section_version_id: "40000000-0000-4000-8000-000000000001",
  submitted_at: "2026-09-01T12:00:00.000Z", transition_audit_event_id: "50000000-0000-4000-8000-000000000001" },
  replayed, correlation_id: "60000000-0000-4000-8000-000000000001" }; }
describe("root-cause submission browser client", () => {
  it("freezes and sends the exact four-key body without an investigation plan", async () => {
    const target = attempt(); const body = JSON.parse(target.requestBody); expect(Object.keys(body)).toEqual(["expected_record_version", "expected_current_version_id", "evidence_assumption_ledger", "root_cause_package"]);
    expect(body).not.toHaveProperty("investigation_plan"); expect(Object.isFrozen(target)).toBe(true);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(success()), { status: 200 }));
    await submitRootCauseSubmissionAttempt(target, fetcher); await submitRootCauseSubmissionAttempt(target, fetcher);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ body: target.requestBody, headers: expect.objectContaining({ "idempotency-key": "d2-key" }) });
    expect(fetcher.mock.calls[1][1].body).toBe(target.requestBody);
  });
  it("captures latest concurrency values in a new independent attempt", () => {
    expect(JSON.parse(attempt("new-d2", 9).requestBody)).toMatchObject({ expected_record_version: 9, expected_current_version_id: "20000000-0000-4000-8000-000000000009" });
  });
  it.each([false, true])("strictly parses S50 success replayed=%s", async (replayed) => {
    await expect(submitRootCauseSubmissionAttempt(attempt(), vi.fn().mockResolvedValue(new Response(JSON.stringify(success(replayed)), { status: 200 })))).resolves.toMatchObject({ status: "submitted", replayed });
  });
  it.each(["CAPA_ROOT_CAUSE_SUBMISSION_VALIDATION_FAILED", "CAPA_ROOT_CAUSE_SUBMISSION_BLOCKED", "CAPA_ACCESS_DENIED", "CAPA_NOT_FOUND", "CAPA_CONCURRENCY_CONFLICT", "CAPA_WORKFLOW_CONFLICT", "CAPA_IDEMPOTENCY_CONFLICT"])("maps %s and preserves blocker issues", async (code) => {
    const result = await submitRootCauseSubmissionAttempt(attempt(), vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code, message: "Safe", issues: [{ path: "readiness", message: "B-02" }] }, correlation_id: "trace" }), { status: 409 })));
    expect(result).toMatchObject({ status: "failed", code, reasons: ["B-02"], requiresRefresh: code === "CAPA_CONCURRENCY_CONFLICT" || code === "CAPA_WORKFLOW_CONFLICT" });
  });
  it("treats malformed success, 5xx, and network errors as exact-retry candidates", async () => {
    await expect(submitRootCauseSubmissionAttempt(attempt(), vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))).resolves.toMatchObject({ retryableExact: true });
    await expect(submitRootCauseSubmissionAttempt(attempt(), vi.fn().mockResolvedValue(new Response("{}", { status: 500 })))).resolves.toMatchObject({ retryableExact: true });
    await expect(submitRootCauseSubmissionAttempt(attempt(), vi.fn().mockRejectedValue(new Error("network")))).resolves.toMatchObject({ retryableExact: true });
  });
  it.each([
    ["capa_case_id", "10000000-0000-4000-8000-000000000099"],
    ["current_version_id", "not-a-uuid"], ["submitted_version_id", "not-a-uuid"],
    ["evidence_assumption_ledger_section_version_id", "not-a-uuid"],
    ["root_cause_package_section_version_id", "not-a-uuid"],
    ["transition_audit_event_id", "not-a-uuid"], ["submitted_at", "today"],
  ])("rejects malformed successful %s", async (field, value) => {
    const body = success(); body.capa = { ...body.capa, [field]: value };
    await expect(submitRootCauseSubmissionAttempt(attempt(), vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })))).resolves.toMatchObject({ status: "failed", retryableExact: true });
  });
});
