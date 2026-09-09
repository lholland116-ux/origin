import { describe, expect, it, vi } from "vitest";
import { handleCapaActionPlanReviewAdvisoryPost } from "../../lib/capa/api/capa-action-plan-review-advisory-route-handler";
import { CapaActionPlanReviewAdvisoryServiceError } from "../../lib/capa/ai/capa-action-plan-review-advisory-service";
const CASE = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const REQUEST = "30000000-0000-4000-8000-000000000001";
const CORRELATION = "40000000-0000-4000-8000-000000000001";
const body = { expected_case_version_id: VERSION, expected_record_version: 7 };
function request(value: unknown = body) { return new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json", "x-request-id": REQUEST, "x-correlation-id": CORRELATION }, body: JSON.stringify(value) }); }
function deps(overrides: Record<string, unknown> = {}) { return { get_session_facts: vi.fn(async () => ({ verified_user_id: "50000000-0000-4000-8000-000000000001", authenticated_at: "2026-01-01T00:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000, verified_aal: "aal1" })), resolve_context: vi.fn(async () => ({ tenant: { organization_id: "60000000-0000-4000-8000-000000000001" }, owner_user_id: "50000000-0000-4000-8000-000000000001" })), create_advisory_service: vi.fn(() => ({ execute: vi.fn(async () => ({ advisory: { advisory_only: true, recommended_disposition: "approve" }, snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 7 } })) })), now: () => new Date("2026-01-01T00:00:00.000Z"), generate_uuid: () => REQUEST, logger: { error: vi.fn() }, ...overrides } as never; }
describe("S70 action-plan review advisory route", () => {
  it("returns the advisory without making a human decision", async () => { const response = await handleCapaActionPlanReviewAdvisoryPost(request(), CASE, deps()); expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ advisory: { advisory_only: true, recommended_disposition: "approve" }, snapshot: { record_version: 7 }, correlation_id: CORRELATION }); });
  it("rejects extra request fields and maps controlled failures", async () => { expect((await handleCapaActionPlanReviewAdvisoryPost(request({ ...body, source_case_version_id: VERSION }), CASE, deps())).status).toBe(400); for (const [reason, status] of [["ADVISORY_ACCESS_DENIED", 403], ["CASE_NOT_IN_ACTION_PLAN_REVIEW", 409], ["WORKFLOW_MUTATION_DETECTED", 409], ["ADVISORY_GENERATION_FAILED", 500]] as const) { const service = { execute: vi.fn(async () => { throw new CapaActionPlanReviewAdvisoryServiceError(reason); }) }; expect((await handleCapaActionPlanReviewAdvisoryPost(request(), CASE, deps({ create_advisory_service: vi.fn(() => service) }))).status).toBe(status); } });
  it("logs only safe structural diagnostics for an invalid authoritative result", async () => {
    const logger = { error: vi.fn() };
    const service = { execute: vi.fn(async () => { throw new CapaActionPlanReviewAdvisoryServiceError("INVALID_ADVISORY_RESULT", undefined, { reason_code: "AFFECTED_ACTION_ID_NOT_AUTHORITATIVE", path: "response.proposal.findings[0].affected_action_ids[0]", finding_count: 1, affected_action_id_count: 1, affected_root_cause_id_count: 1, reference_key_count: 1, expected_workflow_state: "S70" }); }) };
    const response = await handleCapaActionPlanReviewAdvisoryPost(request(), CASE, deps({ create_advisory_service: vi.fn(() => service), logger }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "CAPA_INTERNAL_ERROR", message: "The CAPA request could not be completed.", correlation_id: CORRELATION } });
    expect(logger.error).toHaveBeenCalledWith("CAPA API action-plan review advisory failed.", expect.objectContaining({ reason_code: "INVALID_ADVISORY_RESULT", diagnostic_reason_code: "AFFECTED_ACTION_ID_NOT_AUTHORITATIVE", diagnostic_path: "response.proposal.findings[0].affected_action_ids[0]", finding_count: 1, affected_action_id_count: 1, affected_root_cause_id_count: 1, reference_key_count: 1, expected_workflow_state: "S70" }));
    const metadata = logger.error.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(metadata).not.toHaveProperty("affected_action_id");
    expect(metadata).not.toHaveProperty("affected_root_cause_id");
    expect(metadata).not.toHaveProperty("reference_key");
    expect(metadata).not.toHaveProperty("response");
  });
});
