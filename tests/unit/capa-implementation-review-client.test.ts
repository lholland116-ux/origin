import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
} from "../../lib/capa/domain/capa-implementation-review-decision";
import {
  createCapaImplementationReviewAttempt,
  loadCapaImplementationReview,
  parseCapaImplementationReviewProjection,
  submitCapaImplementationReviewAttempt,
} from "../../app/capa/capa-implementation-review-client";

const CASE = "20000000-0000-4000-8000-000000000001";
const CURRENT = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const BASELINE = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const CORRELATION = "70000000-0000-4000-8000-000000000001";
const AUDIT = "80000000-0000-4000-8000-000000000001";

function projection() {
  return {
    trust: "authoritative_server_projection",
    organization_id: "90000000-0000-4000-8000-000000000001",
    capa_case_id: CASE,
    record_version: 9,
    current_case_version_id: CURRENT,
    workflow_state: "S90",
    case_version: { version_number: 9, parent_version_id: SOURCE, change_reason: "implementation submitted" },
    implementation_review_baseline_section_version_id: BASELINE,
    implementation_review_baseline: { section_version_id: BASELINE, section_type: "CAPA.IMPLEMENTATION_REVIEW_BASELINE", section_version_number: 1, schema_version: "capa-implementation-review-baseline-1.0.0", content: {} },
    approved_s70_baseline: {
      reference: {},
      source_case_version_id: SOURCE,
      source_case_version: { version_number: 7, status: "S70", parent_version_id: CURRENT, change_reason: "action plan approved" },
      action_plan_section: { section_version_id: "a0000000-0000-4000-8000-000000000001", section_type: "CAPA.ACTION_PLAN", section_version_number: 1, schema_version: "capa-action-plan-1.0.0", content: {} },
      action_plan: { items: [], effectiveness_checks: [] },
      approval_decision: { schema_version: "capa-action-plan-review-decision-1.0.0", decision: "approve", rationale: "Approved authority", reviewer_user_id: USER, decided_at: "2026-09-11T12:00:00.000Z", resulting_case_version_id: "b0000000-0000-4000-8000-000000000001", transition_audit_event_id: AUDIT },
    },
    submitted_implementation: { source_s80_case_version_id: SOURCE, source_s80_workspace_revision: 3, resulting_s90_case_version_id: CURRENT, submitted_by_user_id: USER, submitted_at: "2026-09-11T13:00:00.000Z", action_progress: [] },
    reviewer: { user_id: USER, active_roles: [], authorization: { read: { operation: "view_case", status: "allowed", reason_code: "ROLE", policy_version: "1", relied_on_role_assignment_ids: [] }, decision: { operation: "accept_implementation", status: "allowed", reason_code: "ROLE", policy_version: "1", human_only: true, step_up_required: true } } },
    prior_review_history: [],
  };
}

function attempt(decision: "accept" | "return" = "accept") {
  const value = createCapaImplementationReviewAttempt({ caseId: CASE, recordVersion: 9, currentCaseVersionId: CURRENT, sourceCaseVersionId: SOURCE, implementationReviewBaselineSectionVersionId: BASELINE, decision, rationale: "Reviewed the submitted implementation package.", idempotencyKey: "implementation-review-attempt-1" });
  if (value === null) throw new Error("fixture attempt was invalid");
  return value;
}

describe("S90 implementation-review browser client", () => {
  it("loads the authoritative projection through the CS5 GET route", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`/api/capa/${CASE}/implementation-review`);
      expect(init?.method).toBe("GET");
      expect(init?.cache).toBe("no-store");
      return new Response(JSON.stringify({ projection: projection(), correlation_id: CORRELATION }), { status: 200 });
    });
    const result = await loadCapaImplementationReview(CASE, fetcher as typeof fetch);
    expect(result).toMatchObject({ status: "loaded", projection: { workflow_state: "S90", prior_review_history: [] } });
    expect(parseCapaImplementationReviewProjection(projection())).not.toBeNull();
  });

  it("requires rationale for both decisions and builds only the controlled request fields", () => {
    expect(createCapaImplementationReviewAttempt({ caseId: CASE, recordVersion: 9, currentCaseVersionId: CURRENT, sourceCaseVersionId: SOURCE, implementationReviewBaselineSectionVersionId: BASELINE, decision: "accept", rationale: "", idempotencyKey: "k" })).toBeNull();
    const accept = attempt("accept");
    const returned = attempt("return");
    expect(JSON.parse(accept.requestBody)).toEqual({ expected_record_version: 9, expected_current_version_id: CURRENT, source_case_version_id: SOURCE, implementation_review_baseline_section_version_id: BASELINE, schema_version: CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION, decision: "accept", rationale: accept.rationale });
    expect(JSON.parse(returned.requestBody).decision).toBe("return");
    expect(accept.requestBody).not.toContain("organization");
    expect(accept.requestBody).not.toContain("reviewer");
    expect(accept.requestBody).not.toContain("workflow_state");
    expect(accept.requestBody).not.toContain("audit");
  });

  it("uses the current S90 version as both decision source and expected current version", () => {
    const target = createCapaImplementationReviewAttempt({
      caseId: CASE,
      recordVersion: 9,
      currentCaseVersionId: CURRENT,
      sourceCaseVersionId: CURRENT,
      implementationReviewBaselineSectionVersionId: BASELINE,
      decision: "accept",
      rationale: "The submitted package was reviewed against S70 authority.",
      idempotencyKey: "s90-current-version-source",
    });
    expect(target).not.toBeNull();
    const body = JSON.parse(target!.requestBody) as Record<string, unknown>;
    expect(body.expected_current_version_id).toBe(CURRENT);
    expect(body.source_case_version_id).toBe(CURRENT);
    expect(body.implementation_review_baseline_section_version_id).toBe(BASELINE);
    expect(body.source_case_version_id).not.toBe(SOURCE);
  });

  it.each(["accept", "return"] as const)("posts the exact controlled S90 fields for %s", async (decision) => {
    const target = attempt(decision);
    let sent: RequestInit | undefined;
    const result = await submitCapaImplementationReviewAttempt(target, async (_url, init) => {
      sent = init;
      return new Response(JSON.stringify({ status: "decided", decision, capa: { resulting_case_version_id: "a1000000-0000-4000-8000-000000000001" }, replayed: false, correlation_id: CORRELATION }), { status: 200 });
    });
    expect(result).toMatchObject({ status: "decided", decision });
    expect(JSON.parse(String(sent?.body))).toEqual(JSON.parse(target.requestBody));
    expect(sent?.headers).toMatchObject({ "idempotency-key": target.idempotencyKey });
  });

  it("preserves one idempotency key and exact body while submitting", async () => {
    const target = attempt();
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init !== undefined) requests.push(init);
      return new Response(JSON.stringify({ status: "decided", decision: "accept", capa: { resulting_case_version_id: "a1000000-0000-4000-8000-000000000001" }, replayed: false, correlation_id: CORRELATION }), { status: 200 });
    });
    await submitCapaImplementationReviewAttempt(target, fetcher as typeof fetch);
    await submitCapaImplementationReviewAttempt(target, fetcher as typeof fetch);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers).toMatchObject({ "idempotency-key": target.idempotencyKey });
    expect(requests[1]?.headers).toMatchObject({ "idempotency-key": target.idempotencyKey });
    expect(requests[0]?.body).toBe(target.requestBody);
    expect(requests[1]?.body).toBe(target.requestBody);
  });

  it("surfaces controlled step-up, authorization, conflict, validation, context, and idempotency failures", async () => {
    for (const code of ["CAPA_STEP_UP_REQUIRED", "CAPA_ACCESS_DENIED", "CAPA_CONCURRENCY_CONFLICT", "CAPA_WORKFLOW_CONFLICT", "CAPA_IMPLEMENTATION_REVIEW_VALIDATION_FAILED", "CAPA_IMPLEMENTATION_REVIEW_INVALID_AUTHORITATIVE_CONTEXT", "CAPA_IDEMPOTENCY_CONFLICT"]) {
      const result = await submitCapaImplementationReviewAttempt(attempt(), async () => new Response(JSON.stringify({ error: { code, message: code, correlation_id: CORRELATION } }), { status: 409 }));
      expect(result).toMatchObject({ status: "failed", code });
    }
    await expect(loadCapaImplementationReview(CASE, async () => new Response(JSON.stringify({ error: { code: "CAPA_IMPLEMENTATION_REVIEW_CASE_NOT_FOUND", message: "not found" } }), { status: 404 }))).resolves.toMatchObject({ status: "failed", code: "CAPA_IMPLEMENTATION_REVIEW_CASE_NOT_FOUND" });
  });

  it("mounts the S90 reviewer UI without an owner-response or AI decision path", () => {
    const panel = readFileSync(resolve("app/capa/CapaImplementationReviewPanel.tsx"), "utf8");
    const intake = readFileSync(resolve("app/capa/CapaIntakeClient.tsx"), "utf8");
    for (const text of ["S90 · Implementation Review", "Accept implementation", "Return for implementation", "Approved S70 authority", "Submitted S80 package", "Submitted evidence and provenance", "Prior immutable S90 review history", "Reviewer authorization state", "Owner-reported", "not accepted, approved, or verified", "rationale", "CAPA_STEP_UP_REQUIRED", "CAPA_ACCESS_DENIED", "CAPA_CONCURRENCY_CONFLICT", "CAPA_WORKFLOW_CONFLICT", "CAPA_IDEMPOTENCY_CONFLICT", "await onAuthoritativeRefresh();"]) expect(panel).toContain(text);
    expect(panel).toContain("sourceCaseVersionId: projection.current_case_version_id");
    expect(panel).not.toContain("sourceCaseVersionId: projection.submitted_implementation.source_s80_case_version_id");
    expect(intake).toContain('createdCapa.status === "S90"');
    expect(panel).not.toContain("owner response");
    expect(panel).not.toContain("automatic decision");
  });
});
