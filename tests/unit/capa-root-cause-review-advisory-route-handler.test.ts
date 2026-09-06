import { describe, expect, it, vi } from "vitest";
import {
  handleCapaRootCauseReviewAdvisoryPost,
} from "../../lib/capa/api/capa-root-cause-review-advisory-route-handler";
import {
  CapaRootCauseReviewAdvisoryServiceError,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-service";
import { SupabaseCapaContextError } from "../../lib/security/supabase-capa-context";
import { SupabaseCapaTenantAccessError } from "../../lib/security/supabase-capa-durable-context";

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "50000000-0000-4000-8000-000000000001";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const RUN_ID = "70000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "80000000-0000-4000-8000-000000000001";

function advisory() {
  return {
    run_id: RUN_ID,
    output_id: OUTPUT_ID,
    output_schema_version: "capa_review_packet_draft-1.0.0",
    status: "completed_draft",
    proposal: null,
    uncertainty_and_limitations: [],
    citations: [],
    warnings: [],
    advisory_only: true,
    workflow_mutated: false,
    controlled_record_mutated: false,
    review_disposition: null,
    workflow_transition: null,
    human_acceptance_required: true,
  };
}

function dependencies(overrides: Record<string, unknown> = {}): any {
  const execute = vi.fn(async () => ({
    advisory: advisory(),
    snapshot: { capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 5 },
  }));
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER_ID, authenticated_at: "2026-09-06T00:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000 })),
    resolve_context: vi.fn(async () => ({ tenant: { organization_id: ORG_ID }, owner_user_id: USER_ID })),
    create_advisory_service: vi.fn(() => ({ execute })),
    now: () => new Date("2026-09-06T00:00:00.000Z"),
    generate_uuid: () => REQUEST_ID,
    logger: { error: vi.fn() },
    execute,
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = { expected_case_version_id: VERSION_ID, expected_record_version: 5 };

describe("S50 root-cause review advisory route handler", () => {
  it("returns only the safe advisory snapshot with no-store and propagates identity", async () => {
    const deps = dependencies();
    const response = await handleCapaRootCauseReviewAdvisoryPost(request(validBody, { "x-request-id": REQUEST_ID, "x-correlation-id": CORRELATION_ID }), CASE_ID, deps);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ advisory: advisory(), snapshot: { capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 5 }, correlation_id: CORRELATION_ID });
    expect(deps.execute).toHaveBeenCalledWith(expect.objectContaining({ organization_id: ORG_ID, capa_case_id: CASE_ID, user_id: USER_ID, request_id: REQUEST_ID, correlation_id: CORRELATION_ID, request: validBody }));
    expect(JSON.stringify(await (await handleCapaRootCauseReviewAdvisoryPost(request(validBody), CASE_ID, deps)).json())).not.toContain(ORG_ID);
  });

  it("rejects malformed, incomplete, nonpositive, and extra-field requests", async () => {
    const bodies = [
      null,
      {},
      { expected_record_version: 5 },
      { expected_case_version_id: "not-a-uuid", expected_record_version: 5 },
      { expected_case_version_id: VERSION_ID, expected_record_version: 0 },
      { expected_case_version_id: VERSION_ID, expected_record_version: -1 },
      { expected_case_version_id: VERSION_ID, expected_record_version: 1.5 },
      { expected_case_version_id: VERSION_ID, expected_record_version: Number.MAX_SAFE_INTEGER + 1 },
      { ...validBody, operation: "approve_root_cause" },
    ];
    for (const body of bodies) {
      const deps = dependencies();
      const response = await handleCapaRootCauseReviewAdvisoryPost(request(body), CASE_ID, deps);
      expect(response.status).toBe(400);
      expect(deps.execute).not.toHaveBeenCalled();
    }
    const invalidJson = await handleCapaRootCauseReviewAdvisoryPost(new Request("http://localhost", { method: "POST", body: "{" }), CASE_ID, dependencies());
    expect(invalidJson.status).toBe(400);
  });

  it("rejects invalid route identity and unauthenticated or tenant-invalid requests", async () => {
    expect((await handleCapaRootCauseReviewAdvisoryPost(request(validBody), "not-a-uuid", dependencies())).status).toBe(400);
    expect((await handleCapaRootCauseReviewAdvisoryPost(request(validBody), CASE_ID, dependencies({ get_session_facts: vi.fn(async () => null) }))).status).toBe(401);
    const tenantFailure = dependencies({ resolve_context: vi.fn(async () => { throw new SupabaseCapaTenantAccessError("NO_ACTIVE_MEMBERSHIP"); }) });
    expect((await handleCapaRootCauseReviewAdvisoryPost(request(validBody), CASE_ID, tenantFailure)).status).toBe(403);
  });

  it.each([
    ["access", "ADVISORY_ACCESS_DENIED", 403],
    ["state", "CASE_NOT_IN_ROOT_CAUSE_REVIEW", 409],
    ["agent", "AGENT_NOT_ELIGIBLE", 409],
    ["stale/race", "WORKFLOW_MUTATION_DETECTED", 409],
    ["generation", "ADVISORY_GENERATION_FAILED", 500],
    ["validation", "INVALID_ADVISORY_RESULT", 500],
    ["persistence", "ADVISORY_PERSISTENCE_FAILED", 500],
  ] as const)("maps governed service failure: %s", async (_name, reason, status) => {
    const deps = dependencies({ create_advisory_service: vi.fn(() => ({ execute: vi.fn(async () => { throw new CapaRootCauseReviewAdvisoryServiceError(reason); }) })) });
    expect((await handleCapaRootCauseReviewAdvisoryPost(request(validBody), CASE_ID, deps)).status).toBe(status);
  });

  it("maps an undisclosed case failure to a safe 404 response", async () => {
    const deps = dependencies({
      create_advisory_service: vi.fn(() => ({
        execute: vi.fn(async () => {
          throw new CapaRootCauseReviewAdvisoryServiceError(
            "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
          );
        }),
      })),
    });

    const response = await handleCapaRootCauseReviewAdvisoryPost(
      request(validBody, { "x-correlation-id": CORRELATION_ID }),
      CASE_ID,
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: {
        code: "CAPA_ADVISORY_CASE_NOT_FOUND",
        message: "The CAPA case was not found.",
        correlation_id: CORRELATION_ID,
      },
    });
    expect(JSON.stringify(body)).not.toContain(ORG_ID);
    expect(JSON.stringify(body)).not.toContain("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    expect(JSON.stringify(body)).not.toContain("Error");
  });

  it("maps a real Supabase context failure to safe 401 without invoking the service", async () => {
    const createService = vi.fn();
    const deps = dependencies({
      resolve_context: vi.fn(async () => {
        throw new SupabaseCapaContextError("INVALID_USER_ID");
      }),
      create_advisory_service: createService,
    });

    const response = await handleCapaRootCauseReviewAdvisoryPost(
      request(validBody),
      CASE_ID,
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "INVALID_SESSION_CONTEXT",
        message: "The authenticated session is not valid for this request.",
        correlation_id: expect.any(String),
      },
    });
    expect(JSON.stringify(body)).not.toContain("INVALID_USER_ID");
    expect(JSON.stringify(body)).not.toContain("SupabaseCapaContextError");
    expect(createService).not.toHaveBeenCalled();
  });

  it("maps unexpected failures safely, logs only the controlled error name, and preserves no-store", async () => {
    const logger = { error: vi.fn() };
    const deps = dependencies({
      logger,
      create_advisory_service: vi.fn(() => ({
        execute: vi.fn(async () => {
          throw new Error("provider/internal secret");
        }),
      })),
    });

    const response = await handleCapaRootCauseReviewAdvisoryPost(
      request(validBody),
      CASE_ID,
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: {
        code: "CAPA_INTERNAL_ERROR",
        message: "The CAPA request could not be completed.",
        correlation_id: expect.any(String),
      },
    });
    expect(JSON.stringify(body)).not.toContain("provider/internal secret");
    expect(logger.error).toHaveBeenCalledWith(
      "CAPA API root-cause review advisory failed.",
      expect.objectContaining({
        error_name: "Error",
        correlation_id: expect.any(String),
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("provider/internal secret");
  });

  it("generates distinct request and correlation identifiers when headers are absent or invalid", async () => {
    const generated = [
      "90000000-0000-4000-8000-000000000001",
      "90000000-0000-4000-8000-000000000002",
    ];
    const deps = dependencies({
      generate_uuid: vi.fn(() => generated.shift()!),
    });

    await handleCapaRootCauseReviewAdvisoryPost(request(validBody), CASE_ID, deps);
    expect(deps.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      request_id: "90000000-0000-4000-8000-000000000001",
      correlation_id: "90000000-0000-4000-8000-000000000002",
    }));

    const invalidHeaderGenerated = [
      "90000000-0000-4000-8000-000000000003",
      "90000000-0000-4000-8000-000000000004",
    ];
    const invalidHeaderDeps = dependencies({
      generate_uuid: vi.fn(() => invalidHeaderGenerated.shift()!),
    });
    await handleCapaRootCauseReviewAdvisoryPost(
      request(validBody, {
        "x-request-id": "request-not-a-uuid",
        "x-correlation-id": "correlation-not-a-uuid",
      }),
      CASE_ID,
      invalidHeaderDeps,
    );
    expect(invalidHeaderDeps.execute).toHaveBeenCalledWith(expect.objectContaining({
      request_id: "90000000-0000-4000-8000-000000000003",
      correlation_id: "90000000-0000-4000-8000-000000000004",
    }));
  });

  it("maps a service authorization denial to a safe 403 response", async () => {
    const deps = dependencies({
      create_advisory_service: vi.fn(() => ({
        execute: vi.fn(async () => {
          throw new CapaRootCauseReviewAdvisoryServiceError("ADVISORY_ACCESS_DENIED");
        }),
      })),
    });

    const response = await handleCapaRootCauseReviewAdvisoryPost(
      request(validBody),
      CASE_ID,
      deps,
    );

    expect(response.status).toBe(403);
  });

  it("preserves 409 handling for stale expected case and record snapshots", async () => {
    const stale = dependencies({ create_advisory_service: vi.fn(() => ({ execute: vi.fn(async () => { throw new CapaRootCauseReviewAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED"); }) })) });
    expect((await handleCapaRootCauseReviewAdvisoryPost(request({ expected_case_version_id: "30000000-0000-4000-8000-000000000099", expected_record_version: 5 }), CASE_ID, stale)).status).toBe(409);
    expect((await handleCapaRootCauseReviewAdvisoryPost(request({ expected_case_version_id: VERSION_ID, expected_record_version: 6 }), CASE_ID, stale)).status).toBe(409);
  });
});
