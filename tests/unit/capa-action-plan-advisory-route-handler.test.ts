import { describe, expect, it, vi } from "vitest";
import { handleCapaActionPlanAdvisoryPost } from "../../lib/capa/api/capa-action-plan-advisory-route-handler";
import { CapaActionPlanAdvisoryServiceError } from "../../lib/capa/ai/capa-action-plan-advisory-service";

const CASE = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const REQUEST = "30000000-0000-4000-8000-000000000001";
const CORRELATION = "40000000-0000-4000-8000-000000000001";
const body = { expected_case_version_id: VERSION, expected_record_version: 4 };
function request(value: unknown = body) { return new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json", "x-request-id": REQUEST, "x-correlation-id": CORRELATION }, body: JSON.stringify(value) }); }
function dependencies(overrides: Record<string, unknown> = {}) { return { get_session_facts: vi.fn(async () => ({ verified_user_id: "50000000-0000-4000-8000-000000000001", authenticated_at: "2026-01-01T00:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000, verified_aal: "aal1" })), resolve_context: vi.fn(async () => ({ tenant: { organization_id: "60000000-0000-4000-8000-000000000001" }, owner_user_id: "50000000-0000-4000-8000-000000000001" })), create_advisory_service: vi.fn(() => ({ execute: vi.fn(async () => ({ advisory: { advisory_only: true }, snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 4 } })) })), now: () => new Date("2026-01-01T00:00:00.000Z"), generate_uuid: () => REQUEST, logger: { error: vi.fn() }, ...overrides } as never; }

describe("S60 action-plan advisory route", () => {
  it("returns the advisory and correlation without exposing server context", async () => { const response = await handleCapaActionPlanAdvisoryPost(request(), CASE, dependencies()); expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ advisory: { advisory_only: true }, correlation_id: CORRELATION }); });
  it("maps invalid input, denied access, state conflict and internal failure", async () => {
    expect((await handleCapaActionPlanAdvisoryPost(request({ ...body, extra: true }), CASE, dependencies())).status).toBe(400);
    for (const [reason, status] of [["ADVISORY_ACCESS_DENIED", 403], ["CASE_NOT_IN_ACTION_PLANNING", 409], ["WORKFLOW_MUTATION_DETECTED", 409], ["ADVISORY_GENERATION_FAILED", 500]] as const) { const service = { execute: vi.fn(async () => { throw new CapaActionPlanAdvisoryServiceError(reason); }) }; expect((await handleCapaActionPlanAdvisoryPost(request(), CASE, dependencies({ create_advisory_service: vi.fn(() => service) }))).status).toBe(status); }
  });
});
