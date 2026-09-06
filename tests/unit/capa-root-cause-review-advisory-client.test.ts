import { describe, expect, it } from "vitest";
import {
  buildCapaRootCauseReviewAdvisoryRequest,
  fetchCapaRootCauseReviewAdvisory,
  parseCapaRootCauseReviewAdvisoryFailure,
  parseCapaRootCauseReviewAdvisorySuccess,
} from "../../app/capa/capa-root-cause-review-advisory-client";

const CASE = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const RUN = "30000000-0000-4000-8000-000000000001";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const CORRELATION = "50000000-0000-4000-8000-000000000001";

function response(overrides: Record<string, unknown> = {}) {
  return {
    advisory: {
      run_id: RUN,
      output_id: OUTPUT,
      output_schema_version: "capa_review_packet_draft-1.0.0",
      status: "completed_draft",
      proposal: {
        neutral_review_summary: "The submitted package contains material for human review.",
        version_changes: [],
        blockers_warnings: [],
        evidence_map: [],
      },
      uncertainty_and_limitations: [],
      citations: [],
      warnings: [],
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      review_disposition: null,
      workflow_transition: null,
      human_acceptance_required: true,
    },
    snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 5 },
    correlation_id: CORRELATION,
    ...overrides,
  };
}

describe("S50 root-cause review advisory browser client", () => {
  it("builds exactly the governed two-field request", () => {
    expect(buildCapaRootCauseReviewAdvisoryRequest({ expectedCaseVersionId: VERSION, expectedRecordVersion: 5 })).toEqual({
      expected_case_version_id: VERSION,
      expected_record_version: 5,
    });
  });

  it("posts without cache and verifies the response snapshot", async () => {
    const request = buildCapaRootCauseReviewAdvisoryRequest({ expectedCaseVersionId: VERSION, expectedRecordVersion: 5 });
    let url = "";
    let init: RequestInit | undefined;
    const result = await fetchCapaRootCauseReviewAdvisory(CASE, request, async (input, options) => {
      url = String(input);
      init = options;
      return new Response(JSON.stringify(response()), { status: 201 });
    }, { requestId: RUN, correlationId: CORRELATION });
    expect(url).toBe(`/api/capa/${CASE}/root-cause-review-advisory`);
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toMatchObject({ "x-request-id": RUN, "x-correlation-id": CORRELATION });
    expect(JSON.parse(String(init?.body))).toEqual({ expected_case_version_id: VERSION, expected_record_version: 5 });
    expect(result).toHaveProperty("advisory.output_id", OUTPUT);
  });

  it("fails closed on a stale or mismatched snapshot", () => {
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), snapshot: { ...response().snapshot, capa_case_id: "60000000-0000-4000-8000-000000000001" } }, { caseId: CASE, caseVersionId: VERSION, recordVersion: 5 })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), snapshot: { ...response().snapshot, case_version_id: "70000000-0000-4000-8000-000000000001" } }, { caseId: CASE, caseVersionId: VERSION, recordVersion: 5 })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), snapshot: { ...response().snapshot, record_version: 6 } }, { caseId: CASE, caseVersionId: VERSION, recordVersion: 5 })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), correlation_id: "not-a-uuid" }, { caseId: CASE, caseVersionId: VERSION, recordVersion: 5 })).toBeNull();
  });

  it("fails closed on altered advisory schema or governance flags", () => {
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, output_schema_version: "wrong" } })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, advisory_only: false } })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, workflow_mutated: true } })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, controlled_record_mutated: true } })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, review_disposition: "approved" } })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, workflow_transition: "S60" } })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, human_acceptance_required: false } })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, proposal: null } })).toBeNull();
  });

  it("rejects malformed or unexpectedly expanded successful envelopes", async () => {
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: undefined })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), unexpected: true })).toBeNull();
    expect(parseCapaRootCauseReviewAdvisorySuccess({ ...response(), advisory: { ...response().advisory, proposal: { neutral_review_summary: "missing fields" } } })).toBeNull();
    const malformedJson = await fetchCapaRootCauseReviewAdvisory(CASE, buildCapaRootCauseReviewAdvisoryRequest({ expectedCaseVersionId: VERSION, expectedRecordVersion: 5 }), async () => new Response("{", { status: 200 }), { requestId: RUN, correlationId: CORRELATION });
    expect(malformedJson).toEqual({ code: "INVALID_ADVISORY_RESPONSE", message: "The advisory response could not be verified.", correlationId: CORRELATION });
  });

  it("preserves only safe structured failures and never parses raw server text", () => {
    expect(parseCapaRootCauseReviewAdvisoryFailure({ error: { code: "CAPA_ADVISORY_CASE_CHANGED", message: "The CAPA case changed while the advisory was being generated.", correlation_id: CORRELATION, internal: "secret" } })).toEqual({
      code: "CAPA_ADVISORY_CASE_CHANGED",
      message: "The CAPA case changed while the advisory was being generated.",
      correlationId: CORRELATION,
    });
    expect(parseCapaRootCauseReviewAdvisoryFailure("internal stack trace")).toEqual({ code: null, message: "The governed S50 advisory could not be completed.", correlationId: null });
  });

  it("returns a safe failure for a network exception", async () => {
    const result = await fetchCapaRootCauseReviewAdvisory(CASE, buildCapaRootCauseReviewAdvisoryRequest({ expectedCaseVersionId: VERSION, expectedRecordVersion: 5 }), async () => { throw new Error("internal"); }, { requestId: RUN, correlationId: CORRELATION });
    expect(result).toEqual({ code: null, message: "The governed S50 advisory could not be completed.", correlationId: CORRELATION });
  });

  it("handles safe, malformed, and non-JSON non-2xx responses without exposing raw text", async () => {
    const request = buildCapaRootCauseReviewAdvisoryRequest({ expectedCaseVersionId: VERSION, expectedRecordVersion: 5 });
    const safe = await fetchCapaRootCauseReviewAdvisory(CASE, request, async () => new Response(JSON.stringify({ error: { code: "CAPA_ADVISORY_CASE_CHANGED", message: "The CAPA case changed while the advisory was being generated.", correlation_id: CORRELATION } }), { status: 409 }));
    expect(safe).toEqual({ code: "CAPA_ADVISORY_CASE_CHANGED", message: "The CAPA case changed while the advisory was being generated.", correlationId: CORRELATION });
    const malformed = await fetchCapaRootCauseReviewAdvisory(CASE, request, async () => new Response(JSON.stringify({ error: { code: 42 } }), { status: 500 }));
    expect(malformed).toEqual({ code: null, message: "The governed S50 advisory could not be completed.", correlationId: null });
    const nonJson = await fetchCapaRootCauseReviewAdvisory(CASE, request, async () => new Response("internal stack trace", { status: 500 }));
    expect(nonJson).toEqual({ code: null, message: "The governed S50 advisory could not be completed.", correlationId: null });
  });
});
