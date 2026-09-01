import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../../lib/capa/application/update-capa-investigation-progress", () => ({
  updateCapaInvestigationProgress: mocks.update,
}));

import { handleCapaInvestigationProgress } from "../../lib/capa/api/capa-route-handler";

const CASE = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000004";
const NEXT = "40000000-0000-4000-8000-000000000005";
const PLAN = "70000000-0000-4000-8000-000000000002";
const USER = "10000000-0000-4000-8000-000000000001";
const AUDIT = "80000000-0000-4000-8000-000000000001";

function dependencies(authenticated = true) {
  return {
    get_session_facts: vi.fn().mockResolvedValue(authenticated ? {
      verified_user_id: USER,
      authenticated_at: "2026-09-01T11:00:00.000Z",
      expires_at_epoch_seconds: 1788267600,
    } : null),
    resolve_context: vi.fn().mockReturnValue({ authentication: {}, tenant: {} }),
    get_runtime: vi.fn().mockReturnValue({ update_investigation_progress_dependencies: {} }),
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    generate_uuid: vi.fn().mockReturnValue("50000000-0000-4000-8000-000000000001"),
    logger: { error: vi.fn() },
  } as never;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    expected_record_version: 4,
    expected_current_version_id: VERSION,
    item_id: "INV-1",
    new_status: "completed",
    disposition: null,
    disposition_rationale: null,
    ...overrides,
  };
}

function request(body: unknown = validBody(), key: string | null = "progress-1") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["idempotency-key"] = key;
  return new Request(`http://localhost/api/capa/${CASE}/investigation-progress`, {
    method: "POST", headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("investigation-progress route", () => {
  beforeEach(() => {
    mocks.update.mockReset().mockResolvedValue({
      status: "updated",
      capa_case: { capa_case_id: CASE, case_number: "CAPA-000001", status: "S40", record_version: 5, current_version_id: NEXT },
      case_version: { case_version_id: NEXT, effective_at: "2026-09-01T12:00:00.000Z" },
      investigation_plan_section_version: { section_version_id: PLAN },
      updated_item_id: "INV-1", previous_item_status: "planned", new_item_status: "completed",
      audit_event_id: AUDIT,
    });
  });

  it("requires authentication without invoking the service", async () => {
    const response = await handleCapaInvestigationProgress(request(), CASE, dependencies(false));
    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["bad", request(), "INVALID_CAPA_CASE_ID"],
    [CASE, request(validBody(), null), "INVALID_IDEMPOTENCY_KEY"],
    [CASE, request("{"), "INVALID_JSON"],
    [CASE, request({ ...validBody(), extra: true }), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
    [CASE, request({ expected_record_version: 4 }), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
    [CASE, request(validBody({ expected_record_version: 0 })), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
    [CASE, request(validBody({ expected_current_version_id: "version" })), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
    [CASE, request(validBody({ item_id: " " })), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
    [CASE, request(validBody({ new_status: "unknown" })), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
    [CASE, request(validBody({ disposition: 1 })), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
    [CASE, request(validBody({ disposition_rationale: false })), "INVALID_CAPA_INVESTIGATION_PROGRESS"],
  ])("rejects malformed transport input", async (caseId, req, code) => {
    const response = await handleCapaInvestigationProgress(req as Request, caseId as string, dependencies());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "validation_failed", reason_code: "INVALID_INVESTIGATION_PROGRESS" }, 400, "CAPA_INVESTIGATION_PROGRESS_VALIDATION_FAILED"],
    [{ status: "transition_conflict", reason_code: "INVALID_ITEM_STATUS_TRANSITION" }, 409, "CAPA_INVESTIGATION_PROGRESS_TRANSITION_CONFLICT"],
    [{ status: "transition_conflict", reason_code: "OPEN_INVESTIGATION_DEPENDENCY" }, 409, "CAPA_INVESTIGATION_PROGRESS_TRANSITION_CONFLICT"],
    [{ status: "authorization_denied" }, 403, "CAPA_ACCESS_DENIED"],
    [{ status: "not_found_or_not_authorized" }, 404, "CAPA_NOT_FOUND"],
    [{ status: "idempotency_conflict" }, 409, "CAPA_IDEMPOTENCY_CONFLICT"],
    [{ status: "concurrency_conflict" }, 409, "CAPA_CONCURRENCY_CONFLICT"],
    [{ status: "workflow_conflict" }, 409, "CAPA_WORKFLOW_CONFLICT"],
  ])("maps controlled application results", async (result, status, code) => {
    mocks.update.mockResolvedValueOnce(result);
    const response = await handleCapaInvestigationProgress(request(), CASE, dependencies());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it.each(["updated", "already_updated"])("returns authoritative S40 for %s", async (status) => {
    mocks.update.mockResolvedValueOnce({
      status,
      capa_case: { capa_case_id: CASE, case_number: "CAPA-000001", status: "S40", record_version: 5, current_version_id: NEXT },
      case_version: { case_version_id: NEXT, effective_at: "2026-09-01T12:00:00.000Z" },
      investigation_plan_section_version: { section_version_id: PLAN },
      updated_item_id: "INV-1", previous_item_status: "planned", new_item_status: "completed", audit_event_id: AUDIT,
    });
    const response = await handleCapaInvestigationProgress(request(), CASE, dependencies());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capa: {
        capa_case_id: CASE, status: "S40", record_version: 5,
        investigation_plan_section_version_id: PLAN, updated_item_id: "INV-1",
        previous_item_status: "planned", new_item_status: "completed", audit_event_id: AUDIT,
      },
      replayed: status === "already_updated",
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("minimizes unexpected failures", async () => {
    mocks.update.mockRejectedValueOnce(new Error("database detail"));
    const deps = dependencies();
    const response = await handleCapaInvestigationProgress(request(), CASE, deps);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CAPA_INTERNAL_ERROR" } });
  });
});
