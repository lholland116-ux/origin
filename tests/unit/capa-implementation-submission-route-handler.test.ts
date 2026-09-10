import { describe, expect, it, vi } from "vitest";
import { handleCapaImplementationSubmissionPost } from "../../lib/capa/api/capa-implementation-submission-route-handler";

const CASE = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000002";
const RESULT = "30000000-0000-4000-8000-000000000003";
const SECTION = "40000000-0000-4000-8000-000000000002";
const AUDIT = "50000000-0000-4000-8000-000000000002";
const USER = "60000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000001";
const CORRELATION = "70000000-0000-4000-8000-000000000001";

function request(body: unknown, key = "submission-1") {
  return new Request("http://localhost", { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify(body) });
}

function dependencies() {
  const runtimeDependencies = { marker: "implementation-submission-dependencies" };
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER, authenticated_at: "2026-09-10T11:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000 })),
    resolve_context: vi.fn(async () => ({ authentication: { principal: { principal_type: "human", user_id: USER } }, tenant: { organization_id: ORG } })),
    get_runtime: vi.fn(() => ({ submit_implementation_dependencies: runtimeDependencies })),
    now: () => new Date("2026-09-10T12:00:00.000Z"),
    generate_uuid: () => CORRELATION,
    logger: { error: vi.fn() },
    runtimeDependencies,
  } as any;
}

function result(status: "submitted" | "already_submitted" = "submitted"): any {
  return {
    status,
    capa_case: { capa_case_id: CASE, case_number: "CAPA-1", status: "S90", record_version: 9 },
    source_case_version_id: SOURCE,
    resulting_case_version_id: RESULT,
    record_version: 9,
    implementation_review_baseline_section_version: { section_version_id: SECTION, created_at: "2026-09-10T12:00:00.000Z" },
    transition_audit_event_id: AUDIT,
  };
}

describe("S80 implementation submission API handler", () => {
  it("passes only the expected workspace revision to the application boundary", async () => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/submit-capa-implementation");
    const submit = vi.spyOn(application, "submitCapaImplementation").mockResolvedValue(result());
    const response = await handleCapaImplementationSubmissionPost(request({ expected_draft_revision: 3 }), CASE, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "submitted", capa: { status: "S90", source_case_version_id: SOURCE, resulting_case_version_id: RESULT }, replayed: false, correlation_id: CORRELATION });
    expect(submit).toHaveBeenCalledWith(deps.runtimeDependencies, expect.objectContaining({ body: { expected_draft_revision: 3 }, capa_case_id: CASE, request_trace: expect.objectContaining({ idempotency_key: "submission-1" }) }));
    submit.mockRestore();
  });

  it("maps readiness, stale revision, authorization, and workflow failures safely", async () => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/submit-capa-implementation");
    const submit = vi.spyOn(application, "submitCapaImplementation");
    for (const [outcome, status, code] of [
      [{ status: "submission_blocked", blocker_codes: ["MISSING_IMPLEMENTATION_EVIDENCE"] }, 422, "CAPA_IMPLEMENTATION_SUBMISSION_NOT_READY"],
      [{ status: "concurrency_conflict", reason_code: "WORKSPACE_DRAFT_REVISION_CONFLICT" }, 409, "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT"],
      [{ status: "authorization_denied", reason_code: "DENIED", policy_version: "p" }, 403, "CAPA_IMPLEMENTATION_SUBMISSION_ACCESS_DENIED"],
      [{ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" }, 409, "CAPA_WORKFLOW_CONFLICT"],
    ] as const) {
      submit.mockResolvedValueOnce(outcome as any);
      const response = await handleCapaImplementationSubmissionPost(request({ expected_draft_revision: 3 }, `key-${String(code)}`), CASE, deps);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    submit.mockRestore();
  });

  it("rejects transport metadata injection before application execution", async () => {
    const deps = dependencies();
    const application = await import("../../lib/capa/application/submit-capa-implementation");
    const submit = vi.spyOn(application, "submitCapaImplementation").mockResolvedValue(result());
    const response = await handleCapaImplementationSubmissionPost(request({ expected_draft_revision: 3, resulting_case_version_id: RESULT }), CASE, deps);
    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    submit.mockRestore();
  });
});
