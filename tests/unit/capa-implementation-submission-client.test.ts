import { describe, expect, it, vi } from "vitest";
import { parseCapaImplementationSubmission, submitCapaImplementationForReview } from "../../app/capa/capa-implementation-workspace-client";

const CASE = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000002";
const RESULT = "30000000-0000-4000-8000-000000000003";
const SECTION = "40000000-0000-4000-8000-000000000002";
const AUDIT = "50000000-0000-4000-8000-000000000002";
const CORRELATION = "60000000-0000-4000-8000-000000000001";

function success(replayed = false) {
  return {
    status: "submitted",
    capa: {
      capa_case_id: CASE,
      case_number: "CAPA-1",
      status: "S90",
      workflow_state: "S90",
      record_version: 9,
      current_version_id: RESULT,
      source_case_version_id: SOURCE,
      resulting_case_version_id: RESULT,
      implementation_review_baseline_section_version_id: SECTION,
      submitted_at: "2026-09-10T12:00:00.000Z",
    },
    transition_audit_event_id: AUDIT,
    replayed,
    correlation_id: CORRELATION,
  };
}

describe("S80 implementation submission browser client", () => {
  it("sends only the durable workspace revision and parses the safe S90 response", async () => {
    let request: RequestInit | undefined;
    const result = await submitCapaImplementationForReview(CASE, 3, vi.fn(async (_url, init) => {
      request = init;
      return new Response(JSON.stringify(success()), { status: 200 });
    }));
    expect(result).toMatchObject({ status: "success", value: { capa: { status: "S90", resulting_case_version_id: RESULT }, replayed: false } });
    expect(JSON.parse(String(request?.body))).toEqual({ expected_draft_revision: 3 });
    expect(request?.headers).toEqual(expect.objectContaining({ "idempotency-key": expect.any(String), "content-type": "application/json" }));
  });

  it("surfaces server readiness and stale-revision errors without retrying locally", async () => {
    const notReady = parseCapaImplementationSubmission({ error: { code: "CAPA_IMPLEMENTATION_SUBMISSION_NOT_READY", message: "Not ready", issues: [{ path: "readiness.blocker_codes", message: "MISSING_IMPLEMENTATION_EVIDENCE" }] }, correlation_id: CORRELATION });
    expect(notReady).toMatchObject({ status: "failed", code: "CAPA_IMPLEMENTATION_SUBMISSION_NOT_READY", message: expect.stringContaining("not ready") });
    const stale = await submitCapaImplementationForReview(CASE, 3, vi.fn(async () => new Response(JSON.stringify({ error: { code: "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", message: "stale" }, correlation_id: CORRELATION }), { status: 409 })));
    expect(stale).toMatchObject({ status: "failed", code: "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" });
  });

  it("rejects malformed S90 success responses", () => {
    expect(parseCapaImplementationSubmission({ ...success(), capa: { ...success().capa, status: "S100" } })).toMatchObject({ status: "failed", code: "INVALID_IMPLEMENTATION_SUBMISSION_RESPONSE" });
  });
});
