import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handleCapaRootCauseGate, type CapaApiHandlerDependencies } from "../../lib/capa/api/capa-route-handler";
import { decideCapaRootCauseGate } from "../../lib/capa/application/decide-capa-root-cause-gate";

vi.mock("../../lib/capa/application/decide-capa-root-cause-gate", () => ({
  decideCapaRootCauseGate: vi.fn(),
}));

const CASE_ID = "30000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "80000000-0000-4000-8000-000000000001";

function dependencies(): CapaApiHandlerDependencies {
  return {
    get_session_facts: vi.fn().mockResolvedValue({ session_id: "session" } as never),
    resolve_context: vi.fn().mockResolvedValue({ authentication: { principal: { principal_type: "human" } }, tenant: { organization_id: "10000000-0000-4000-8000-000000000001" } } as never),
    get_runtime: vi.fn().mockReturnValue({ decide_root_cause_gate_dependencies: {} } as never),
    now: () => new Date("2026-09-06T12:00:00.000Z"),
    generate_uuid: () => CORRELATION_ID,
    logger: { error: vi.fn() },
  };
}

function request(body: unknown, key = "gate-key") {
  return new Request(`https://example.test/capa/${CASE_ID}/root-cause-gate`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key, "x-correlation-id": CORRELATION_ID },
    body: JSON.stringify(body),
  });
}

const validBody = {
  expected_record_version: 6,
  expected_current_version_id: "40000000-0000-4000-8000-000000000006",
  decision: "approve",
  rationale: "Approved after human review.",
  confirmation: "G04_ROOT_CAUSE_APPROVAL_CONFIRMED",
};

describe("S50 root-cause gate route boundary", () => {
  const route = readFileSync("app/api/capa/[caseId]/root-cause-gate/route.ts", "utf8");
  const handler = readFileSync("lib/capa/api/capa-route-handler.ts", "utf8");

  it("wires the locked POST route through the framework-neutral handler", () => {
    expect(route).toContain("export async function POST");
    expect(route).toContain("handleCapaRootCauseGate");
    expect(handler).toContain("export async function handleCapaRootCauseGate");
    expect(handler).toContain("decideCapaRootCauseGate");
  });

  it("keeps request context server-side and maps safe errors", () => {
    expect(handler).toContain('request.headers.get("idempotency-key")');
    expect(handler).toContain('CAPA_STEP_UP_REQUIRED');
    expect(handler).toContain('CAPA_IDEMPOTENCY_CONFLICT');
    expect(handler).toContain('CAPA_CONCURRENCY_CONFLICT');
    expect(handler).toContain('CAPA_WORKFLOW_CONFLICT');
    expect(handler).not.toContain("organization_id: body");
    expect(handler).not.toContain("user_id: body");
    expect(handler).not.toContain("role: body");
  });

  describe("executable handler boundary", () => {
    beforeEach(() => vi.mocked(decideCapaRootCauseGate).mockReset());

    it.each([
      ["unauthenticated", null, 401, "UNAUTHORIZED"],
      ["stale step-up", { status: "step_up_required", reason_code: "STEP_UP_REQUIRED", policy_version: "capa-gate-policy-1.0.0" }, 403, "CAPA_STEP_UP_REQUIRED"],
      ["policy deny", { status: "authorization_denied", reason_code: "REQUIRED_PERMISSION_NOT_GRANTED", policy_version: "capa-gate-policy-1.0.0" }, 403, "CAPA_ACCESS_DENIED"],
      ["non-human", { status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED", policy_version: "capa-gate-policy-1.0.0" }, 403, "CAPA_ACCESS_DENIED"],
      ["not found", { status: "not_found_or_not_authorized" }, 404, "CAPA_NOT_FOUND"],
      ["non-S50", { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_AUTHORIZED" }, 409, "CAPA_WORKFLOW_CONFLICT"],
      ["wrong versions", { status: "concurrency_conflict", reason_code: "RECORD_VERSION_CONFLICT" }, 409, "CAPA_CONCURRENCY_CONFLICT"],
    ])("maps %s through the handler", async (_label, result, status, code) => {
      const deps = dependencies();
      if (result === null) vi.spyOn(deps, "get_session_facts").mockResolvedValue(null);
      else vi.mocked(decideCapaRootCauseGate).mockResolvedValue(result as never);
      const response = await handleCapaRootCauseGate(request(validBody), CASE_ID, deps);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    });

    it.each([
      [
        "segregation-of-duties denial",
        {
          status: "authorization_denied",
          reason_code: "SEGREGATION_OF_DUTIES_DENIED",
          policy_version: "capa-gate-policy-1.0.0",
        },
        "CAPA_ACCESS_DENIED",
        "The CAPA operation is not authorized.",
        "authorization_denied",
      ],
      [
        "permission denial",
        {
          status: "authorization_denied",
          reason_code: "REQUIRED_PERMISSION_NOT_GRANTED",
          policy_version: "capa-gate-policy-1.0.0",
        },
        "CAPA_ACCESS_DENIED",
        "The CAPA operation is not authorized.",
        "authorization_denied",
      ],
      [
        "step-up requirement",
        {
          status: "step_up_required",
          reason_code: "STEP_UP_REQUIRED",
          policy_version: "capa-gate-policy-1.0.0",
        },
        "CAPA_STEP_UP_REQUIRED",
        "Fresh step-up authentication is required.",
        "step_up_required",
      ],
    ])("logs only the safe %s outcome and preserves the browser response", async (_label, result, code, message, outcome) => {
      const deps = dependencies();
      vi.mocked(decideCapaRootCauseGate).mockResolvedValue(result as never);

      const response = await handleCapaRootCauseGate(request(validBody), CASE_ID, deps);

      expect(response.status).toBe(403);
      const responseBody = await response.json();
      expect(responseBody).toMatchObject({
        error: {
          code,
          message,
          correlation_id: CORRELATION_ID,
        },
      });
      expect(responseBody.error).not.toHaveProperty("reason_code");
      expect(responseBody.error).not.toHaveProperty("policy_version");

      expect(deps.logger.error).toHaveBeenCalledTimes(1);
      expect(deps.logger.error).toHaveBeenCalledWith(
        "CAPA root-cause gate outcome.",
        {
          correlation_id: CORRELATION_ID,
          operation: "root-cause gate",
          outcome,
          reason_code: result.reason_code,
          policy_version: result.policy_version,
        },
      );
    });

    it("does not put request, identity, rationale, authentication, or idempotency data in the diagnostic log", async () => {
      const deps = dependencies();
      vi.mocked(decideCapaRootCauseGate).mockResolvedValue({
        status: "authorization_denied",
        reason_code: "SEGREGATION_OF_DUTIES_DENIED",
        policy_version: "capa-gate-policy-1.0.0",
      } as never);

      const response = await handleCapaRootCauseGate(
        request(
          {
            ...validBody,
            rationale: "request-body-rationale-secret",
          },
          "idempotency-key-secret",
        ),
        CASE_ID,
        deps,
      );

      expect(response.status).toBe(403);
      const diagnosticText = JSON.stringify(vi.mocked(deps.logger.error).mock.calls);
      for (const sensitiveValue of [
        "request-body-rationale-secret",
        "idempotency-key-secret",
        "session",
        "10000000-0000-4000-8000-000000000001",
        "user-id-secret",
        "owner-id-secret",
        "role-assignment-id-secret",
        "totp-secret",
        "authenticator-secret",
        "session-token-secret",
        "capa-content-secret",
        "stack-secret",
      ]) {
        expect(diagnosticText).not.toContain(sensitiveValue);
      }
    });

    it("accepts a fresh-step-up decision and preserves replay response linkage", async () => {
      vi.mocked(decideCapaRootCauseGate).mockResolvedValue({
        status: "already_decided", decision: "approve", workflow_state: "S60",
        capa_case: { capa_case_id: CASE_ID }, source_case_version_id: validBody.expected_current_version_id,
        resulting_case_version_id: "40000000-0000-4000-8000-000000000007", record_version: 7,
      } as never);
      const deps = dependencies();
      const response = await handleCapaRootCauseGate(request(validBody, "replay-key"), CASE_ID, deps);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "decided", decision: "approve", workflow_state: "S60", replayed: true,
        capa_case_id: CASE_ID, previous_case_version_id: validBody.expected_current_version_id,
        current_case_version_id: "40000000-0000-4000-8000-000000000007", record_version: 7,
        correlation_id: CORRELATION_ID,
      });
      expect(decideCapaRootCauseGate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ capa_case_id: CASE_ID, request_trace: expect.objectContaining({ idempotency_key: "replay-key" }), body: validBody }),
      );
    });

    it("maps invalid identifiers, idempotency keys, and bodies without invoking the application", async () => {
      const deps = dependencies();
      expect((await handleCapaRootCauseGate(request(validBody), "not-a-uuid", deps)).status).toBe(400);
      expect((await handleCapaRootCauseGate(new Request("https://example.test", { method: "POST", body: JSON.stringify(validBody) }), CASE_ID, deps)).status).toBe(400);
      expect((await handleCapaRootCauseGate(request({ ...validBody, rationale: "" }), CASE_ID, deps)).status).toBe(400);
      expect(decideCapaRootCauseGate).not.toHaveBeenCalled();
    });
  });
});
