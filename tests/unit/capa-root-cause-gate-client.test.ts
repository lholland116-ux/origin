import { describe, expect, it, vi } from "vitest";
import {
  createCapaRootCauseGateAttempt,
  submitCapaRootCauseGateAttempt,
} from "../../app/capa/capa-root-cause-gate-client";

const CASE = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const CORRELATION = "50000000-0000-4000-8000-000000000001";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("S50 root-cause gate browser client", () => {
  it("builds exact approval and return bodies without trusted context fields", () => {
    const approval = createCapaRootCauseGateAttempt({ caseId: CASE, recordVersion: 5, currentVersionId: VERSION, decision: "approve", rationale: "Approved after review.", idempotencyKey: "gate-1" });
    expect(approval).not.toBeNull();
    expect(approval).toMatchObject({ expectedCurrentVersionId: VERSION, expectedRecordVersion: 5 });
    expect(JSON.parse(approval!.requestBody)).toEqual({ expected_record_version: 5, expected_current_version_id: VERSION, decision: "approve", rationale: "Approved after review.", confirmation: "G04_ROOT_CAUSE_APPROVAL_CONFIRMED" });
    const returned = createCapaRootCauseGateAttempt({ caseId: CASE, recordVersion: 5, currentVersionId: VERSION, decision: "return_for_investigation", rationale: "Investigate the remaining gap.", idempotencyKey: "gate-2" });
    expect(JSON.parse(returned!.requestBody)).toEqual({ expected_record_version: 5, expected_current_version_id: VERSION, decision: "return_for_investigation", rationale: "Investigate the remaining gap." });
    expect(JSON.stringify(JSON.parse(returned!.requestBody))).not.toContain("confirmation");
  });

  it("retains the exact idempotency key and validates state/decision consistency", async () => {
    const attempt = createCapaRootCauseGateAttempt({ caseId: CASE, recordVersion: 5, currentVersionId: VERSION, decision: "approve", rationale: "Approved after review.", idempotencyKey: "gate-retry" })!;
    const fetcher = vi.fn().mockResolvedValue(response({ status: "decided", decision: "approve", capa_case_id: CASE, previous_case_version_id: VERSION, current_case_version_id: NEXT, record_version: 6, workflow_state: "S60", replayed: false, correlation_id: CORRELATION }));
    expect(await submitCapaRootCauseGateAttempt(attempt, fetcher)).toMatchObject({ status: "decided", workflowState: "S60" });
    expect(fetcher).toHaveBeenCalledWith(`/api/capa/${CASE}/root-cause-gate`, expect.objectContaining({ method: "POST", cache: "no-store", body: attempt.requestBody, headers: expect.objectContaining({ "idempotency-key": "gate-retry" }) }));
    expect(attempt.expectedCurrentVersionId).toBe(VERSION);
    expect(attempt.expectedRecordVersion).toBe(5);
    const wrongState = await submitCapaRootCauseGateAttempt({ ...attempt, decision: "return_for_investigation" }, vi.fn().mockResolvedValue(response({ status: "decided", decision: "return_for_investigation", capa_case_id: CASE, previous_case_version_id: VERSION, current_case_version_id: NEXT, record_version: 6, workflow_state: "S60", replayed: false, correlation_id: CORRELATION })));
    expect(wrongState).toMatchObject({ status: "failed" });
  });

  it.each([
    ["previous snapshot", { previous_case_version_id: NEXT }],
    ["record version", { record_version: 7 }],
    ["case id", { capa_case_id: NEXT }],
    ["decision", { decision: "return_for_investigation" }],
    ["approve state", { workflow_state: "S40" }],
    ["malformed current UUID", { current_case_version_id: "not-a-uuid" }],
    ["malformed correlation UUID", { correlation_id: "not-a-uuid" }],
  ])("rejects a success response with a mismatched %s", async (_label, override) => {
    const attempt = createCapaRootCauseGateAttempt({ caseId: CASE, recordVersion: 5, currentVersionId: VERSION, decision: "approve", rationale: "Approved after review.", idempotencyKey: `negative-${_label}` })!;
    const body = { status: "decided", decision: "approve", capa_case_id: CASE, previous_case_version_id: VERSION, current_case_version_id: NEXT, record_version: 6, workflow_state: "S60", replayed: false, correlation_id: CORRELATION, ...override };
    await expect(submitCapaRootCauseGateAttempt(attempt, vi.fn().mockResolvedValue(response(body)))).resolves.toMatchObject({ status: "failed" });
  });

  it("rejects malformed or non-JSON success responses and network failures", async () => {
    const attempt = createCapaRootCauseGateAttempt({ caseId: CASE, recordVersion: 5, currentVersionId: VERSION, decision: "approve", rationale: "Approved after review.", idempotencyKey: "negative-malformed" })!;
    expect(await submitCapaRootCauseGateAttempt(attempt, vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })))).toMatchObject({ status: "failed" });
    expect(await submitCapaRootCauseGateAttempt(attempt, vi.fn().mockRejectedValue(new Error("network")))).toMatchObject({ status: "failed", retryableExact: true });
  });

  it("binds the return response to the original S50 attempt", async () => {
    const attempt = createCapaRootCauseGateAttempt({ caseId: CASE, recordVersion: 5, currentVersionId: VERSION, decision: "return_for_investigation", rationale: "Investigate further.", idempotencyKey: "return-negative" })!;
    const valid = { status: "decided", decision: "return_for_investigation", capa_case_id: CASE, previous_case_version_id: VERSION, current_case_version_id: NEXT, record_version: 6, workflow_state: "S40", replayed: true, correlation_id: CORRELATION };
    await expect(submitCapaRootCauseGateAttempt(attempt, vi.fn().mockResolvedValue(response(valid)))).resolves.toMatchObject({ status: "decided", workflowState: "S40", replayed: true });
    await expect(submitCapaRootCauseGateAttempt(attempt, vi.fn().mockResolvedValue(response({ ...valid, workflow_state: "S60" })))).resolves.toMatchObject({ status: "failed" });
  });

  it.each([400, 401, 403, 404, 409, 500])("maps HTTP %s safely", async (status) => {
    const attempt = createCapaRootCauseGateAttempt({ caseId: CASE, recordVersion: 5, currentVersionId: VERSION, decision: "approve", rationale: "Approved after review.", idempotencyKey: `gate-${status}` })!;
    const result = await submitCapaRootCauseGateAttempt(attempt, vi.fn().mockResolvedValue(response({ error: { code: `SAFE_${status}`, message: "Controlled message", correlation_id: CORRELATION, issues: [{ path: "gate", message: "Controlled issue" }] } }, status)));
    expect(result).toMatchObject({ status: "failed", code: `SAFE_${status}`, message: "Controlled message" });
  });
});
