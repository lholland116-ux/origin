import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("../../lib/capa/application/submit-capa-root-cause-package", () => ({
  submitCapaRootCausePackage: mocks.submit,
}));

import { handleCapaSubmitRootCause } from "../../lib/capa/api/capa-route-handler";

const CASE = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const USER = "10000000-0000-4000-8000-000000000001";
function dependencies(authenticated = true) {
  return {
    get_session_facts: vi.fn().mockResolvedValue(
      authenticated
        ? {
            verified_user_id: USER,
            authenticated_at: "2026-09-01T11:00:00.000Z",
            expires_at_epoch_seconds: 1788267600,
          }
        : null
    ),
    resolve_context: vi
      .fn()
      .mockReturnValue({ authentication: {}, tenant: {} }),
    get_runtime: vi
      .fn()
      .mockReturnValue({ submit_root_cause_dependencies: {} }),
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    generate_uuid: vi
      .fn()
      .mockReturnValue("50000000-0000-4000-8000-000000000001"),
    logger: { error: vi.fn() },
  } as never;
}
function request(body: unknown = validBody(), key: string | null = "submit-1") {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (key !== null) headers["idempotency-key"] = key;
  return new Request(`http://localhost/api/capa/${CASE}/submit-root-cause`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    expected_record_version: 4,
    expected_current_version_id: VERSION,
    evidence_assumption_ledger: { items: [] },
    root_cause_package: { hypotheses: [] },
    ...overrides,
  };
}

describe("root-cause submission route", () => {
  beforeEach(() => {
    mocks.submit.mockReset().mockResolvedValue({
      status: "submitted",
      capa_case: {
        capa_case_id: CASE,
        case_number: "CAPA-000001",
        status: "S50",
        record_version: 5,
        current_version_id: NEXT,
      },
      case_version: {
        case_version_id: NEXT,
        effective_at: "2026-09-01T12:00:00.000Z",
      },
      evidence_assumption_ledger_section_version: {
        section_version_id: "70000000-0000-4000-8000-000000000001",
      },
      root_cause_package_section_version: {
        section_version_id: "70000000-0000-4000-8000-000000000002",
      },
      transition_audit_event_id: "80000000-0000-4000-8000-000000000001",
    });
  });

  it("requires authentication", async () => {
    expect(
      (await handleCapaSubmitRootCause(request(), CASE, dependencies(false)))
        .status
    ).toBe(401);
  });
  it.each([
    ["bad", request(), "INVALID_CAPA_CASE_ID"],
    [CASE, request(validBody(), null), "INVALID_IDEMPOTENCY_KEY"],
    [CASE, request(validBody(), "k".repeat(129)), "INVALID_IDEMPOTENCY_KEY"],
    [CASE, request("{"), "INVALID_JSON"],
    [
      CASE,
      request(validBody({ approval: true })),
      "INVALID_CAPA_ROOT_CAUSE_SUBMISSION",
    ],
    [
      CASE,
      request({ expected_record_version: 4 }),
      "INVALID_CAPA_ROOT_CAUSE_SUBMISSION",
    ],
    [
      CASE,
      request(validBody({ expected_record_version: 0 })),
      "INVALID_CAPA_ROOT_CAUSE_SUBMISSION",
    ],
    [
      CASE,
      request(validBody({ expected_current_version_id: "version" })),
      "INVALID_CAPA_ROOT_CAUSE_SUBMISSION",
    ],
  ])("maps malformed request to %s", async (caseId, req, code) => {
    const response = await handleCapaSubmitRootCause(
      req as Request,
      caseId as string,
      dependencies()
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("maps ledger/package validation and readiness details", async () => {
    mocks.submit.mockResolvedValueOnce({
      status: "validation_failed",
      reason_code: "INVALID_EVIDENCE_ASSUMPTION_LEDGER",
      evidence_assumption_ledger_reason_code: "INVALID_LEDGER_OBJECT",
    });
    let response = await handleCapaSubmitRootCause(
      request(),
      CASE,
      dependencies()
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CAPA_ROOT_CAUSE_SUBMISSION_VALIDATION_FAILED",
        issues: expect.arrayContaining([
          {
            path: "evidence_assumption_ledger",
            message: "INVALID_LEDGER_OBJECT",
          },
        ]),
      },
    });
    mocks.submit.mockResolvedValueOnce({
      status: "validation_failed",
      reason_code: "INVALID_ROOT_CAUSE_PACKAGE",
      root_cause_package_reason_code: "UNKNOWN_LEDGER_REFERENCE",
    });
    response = await handleCapaSubmitRootCause(request(), CASE, dependencies());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CAPA_ROOT_CAUSE_SUBMISSION_VALIDATION_FAILED",
        issues: expect.arrayContaining([
          {
            path: "root_cause_package",
            message: "UNKNOWN_LEDGER_REFERENCE",
          },
        ]),
      },
    });
    mocks.submit.mockResolvedValueOnce({
      status: "submission_blocked",
      reason_codes: ["UNRESOLVED_CRITICAL_EVIDENCE_GAP"],
      canonical_blocker_codes: ["B-02"],
    });
    response = await handleCapaSubmitRootCause(request(), CASE, dependencies());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CAPA_ROOT_CAUSE_SUBMISSION_BLOCKED",
        issues: expect.arrayContaining([
          {
            path: "readiness.reason_codes",
            message: "UNRESOLVED_CRITICAL_EVIDENCE_GAP",
          },
          { path: "readiness.canonical_blocker_codes", message: "B-02" },
        ]),
      },
    });
  });

  it.each([
    [{ status: "authorization_denied" }, 403, "CAPA_ACCESS_DENIED"],
    [{ status: "not_found_or_not_authorized" }, 404, "CAPA_NOT_FOUND"],
    [{ status: "idempotency_conflict" }, 409, "CAPA_IDEMPOTENCY_CONFLICT"],
    [{ status: "concurrency_conflict" }, 409, "CAPA_CONCURRENCY_CONFLICT"],
    [{ status: "workflow_conflict" }, 409, "CAPA_WORKFLOW_CONFLICT"],
  ])("maps controlled application result", async (result, status, code) => {
    mocks.submit.mockResolvedValueOnce(result);
    const response = await handleCapaSubmitRootCause(
      request(),
      CASE,
      dependencies()
    );
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it.each(["submitted", "already_submitted"])(
    "returns authoritative S50 for %s",
    async (status) => {
      if (status === "already_submitted") {
        mocks.submit.mockResolvedValueOnce({
          status,
          capa_case: {
            capa_case_id: CASE,
            case_number: "CAPA-000001",
            status: "S50",
            record_version: 5,
            current_version_id: NEXT,
          },
          case_version: {
            case_version_id: NEXT,
            effective_at: "2026-09-01T12:00:00.000Z",
          },
          evidence_assumption_ledger_section_version: {
            section_version_id: "70000000-0000-4000-8000-000000000001",
          },
          root_cause_package_section_version: {
            section_version_id: "70000000-0000-4000-8000-000000000002",
          },
          transition_audit_event_id: "80000000-0000-4000-8000-000000000001",
        });
      }
      const response = await handleCapaSubmitRootCause(
        request(),
        CASE,
        dependencies()
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        capa: { status: "S50", record_version: 5, submitted_version_id: NEXT },
        replayed: status === "already_submitted",
      });
    }
  );

  it("accepts no confirmation, comment, plan, approval, MFA, or target-state fields", async () => {
    for (const field of [
      "confirmation",
      "comment",
      "investigation_plan",
      "approval",
      "totp",
      "target_state",
    ]) {
      const response = await handleCapaSubmitRootCause(
        request(validBody({ [field]: true })),
        CASE,
        dependencies()
      );
      expect(response.status).toBe(400);
    }
  });
});
