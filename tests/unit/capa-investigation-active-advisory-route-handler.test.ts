import { describe, expect, it, vi } from "vitest";
import { handleCapaInvestigationActiveAdvisoryPost } from "../../lib/capa/api/capa-investigation-active-advisory-route-handler";
import { handleCapaInvestigationActiveAdoptionPost } from "../../lib/capa/api/capa-investigation-active-adoption-route-handler";
import { CapaInvestigationActiveAdvisoryServiceError } from "../../lib/capa/ai/capa-investigation-active-advisory-service";
import { CapaInvestigationActiveAdoptionValidationError } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";

const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "40000000-0000-4000-8000-000000000001";
const ADOPTION_ID = "50000000-0000-4000-8000-000000000001";

function dependencies(overrides: Record<string, unknown> = {}): any {
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: "60000000-0000-4000-8000-000000000001", authenticated_at: "2026-09-05T00:00:00.000Z", expires_at_epoch_seconds: 2_000_000_000 })),
    resolve_context: vi.fn(async () => ({ tenant: { organization_id: "10000000-0000-4000-8000-000000000001" }, owner_user_id: "60000000-0000-4000-8000-000000000001" })),
    create_advisory_service: vi.fn(() => ({ execute: vi.fn(async () => ({ advisory: { output_id: OUTPUT_ID, proposal: null }, snapshot: { capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4 } })) })),
    create_adoption_service: vi.fn(() => ({ adopt: vi.fn(async () => ({ status: "adopted", records: [{ adoption: { adoption_id: ADOPTION_ID, proposal_key: "P1", proposal_category: "evidence_gap", adopted_item: { proposal_key: "P1", adopted_content: { gap: "gap" } }, adopted_at: "2026-09-05T00:00:00.000Z", adopted_by: { actor_type: "human", actor_id: "60000000-0000-4000-8000-000000000001" }, resolved_reference_bindings: [{ source_id: "secret" }], reference_manifest_sha256: "secret", request_fingerprint: "secret", record_fingerprint: "secret", audit_event_id: "secret" } }], workspace: { draft_revision: 1, case_version_id: VERSION_ID, record_version: 4, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_at: "2026-09-05T00:00:00.000Z" } })) })),
    now: () => new Date("2026-09-05T00:00:00.000Z"),
    generate_uuid: () => "70000000-0000-4000-8000-000000000001",
    logger: { error: vi.fn() },
    ...overrides,
  };
}

describe("S40 API route handlers", () => {
  it("returns a no-store advisory response and rejects unknown request fields", async () => {
    const deps = dependencies();
    const request = new Request("http://localhost", { method: "POST", body: JSON.stringify({ expected_case_version_id: VERSION_ID, expected_record_version: 4 }) });
    const result = await handleCapaInvestigationActiveAdvisoryPost(request, CASE_ID, deps);
    expect(result.status).toBe(201);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual(expect.objectContaining({ advisory: expect.anything(), snapshot: expect.anything(), correlation_id: expect.any(String) }));

    const invalid = await handleCapaInvestigationActiveAdvisoryPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ expected_case_version_id: VERSION_ID, expected_record_version: 4, organization_id: "not-browser-owned" }) }), CASE_ID, deps);
    expect(invalid.status).toBe(400);
  });

  it("requires the idempotency key and returns only the safe adoption projection", async () => {
    const deps = dependencies();
    const body = JSON.stringify({ expected_case_version_id: VERSION_ID, expected_record_version: 4, output_id: OUTPUT_ID, selected_items: [{ proposal_key: "P1", adopted_content: { gap: "gap" } }] });
    const missing = await handleCapaInvestigationActiveAdoptionPost(new Request("http://localhost", { method: "POST", body }), CASE_ID, OUTPUT_ID, deps);
    expect(missing.status).toBe(400);
    const result = await handleCapaInvestigationActiveAdoptionPost(new Request("http://localhost", { method: "POST", headers: { "Idempotency-Key": "batch-1" }, body }), CASE_ID, OUTPUT_ID, deps);
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ status: "adopted", records: [{ adoption_id: ADOPTION_ID, proposal_key: "P1", proposal_category: "evidence_gap", adopted_item: { proposal_key: "P1", adopted_content: { gap: "gap" } }, adopted_at: "2026-09-05T00:00:00.000Z", adopted_by_user_id: "60000000-0000-4000-8000-000000000001" }], workspace: { draft_revision: 1, case_version_id: VERSION_ID, record_version: 4, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_at: "2026-09-05T00:00:00.000Z" }, correlation_id: expect.any(String) });
    expect(JSON.stringify(await (await handleCapaInvestigationActiveAdoptionPost(new Request("http://localhost", { method: "POST", headers: { "Idempotency-Key": "batch-2" }, body }), CASE_ID, OUTPUT_ID, deps)).json())).not.toContain("source_id");
  });

  it("maps adoption outcomes and preserves only the safe durable workspace projection", async () => {
    const body = JSON.stringify({ expected_case_version_id: VERSION_ID, expected_record_version: 4, output_id: OUTPUT_ID, selected_items: [{ proposal_key: "P1", adopted_content: { gap: "gap" } }] });
    const workspace = { draft_revision: 3, case_version_id: VERSION_ID, record_version: 4, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_at: "2026-09-05T00:00:00.000Z", organization_id: "server-only-organization", updated_by_user_id: "server-only-user" };
    const record = { adoption_id: ADOPTION_ID, proposal_key: "P1", proposal_category: "evidence_gap", adopted_item: { proposal_key: "P1", adopted_content: { gap: "gap" } }, adopted_at: "2026-09-05T00:00:00.000Z", adopted_by: { actor_type: "human", actor_id: "60000000-0000-4000-8000-000000000001" }, organization_id: "server-only-organization", request_fingerprint: "server-only-fingerprint" };
    const outcomes = [
      [{ status: "case_changed" }, 409, "CAPA_ADOPTION_CASE_CHANGED"],
      [{ status: "workspace_conflict" }, 409, "CAPA_ADOPTION_WORKSPACE_CONFLICT"],
      [{ status: "idempotency_conflict" }, 409, "CAPA_ADOPTION_IDEMPOTENCY_CONFLICT"],
      [{ status: "adopted", records: [{ adoption: record }], workspace }, 201, null],
      [{ status: "already_adopted", records: [{ adoption: record }], workspace }, 200, null],
    ] as const;
    for (const [serviceResult, expectedStatus, expectedCode] of outcomes) {
      const deps = dependencies({ create_adoption_service: vi.fn(() => ({ adopt: vi.fn(async () => serviceResult) })) });
      const response = await handleCapaInvestigationActiveAdoptionPost(new Request("http://localhost", { method: "POST", headers: { "Idempotency-Key": "batch-1" }, body }), CASE_ID, OUTPUT_ID, deps);
      expect(response.status).toBe(expectedStatus);
      const responseBody = await response.json() as Record<string, unknown>;
      if (expectedCode !== null) expect((responseBody.error as Record<string, unknown>).code).toBe(expectedCode);
      else {
        expect(responseBody).toMatchObject({ status: serviceResult.status, records: [{ adoption_id: ADOPTION_ID, proposal_key: "P1", proposal_category: "evidence_gap" }], workspace: { draft_revision: 3, case_version_id: VERSION_ID, record_version: 4 } });
        expect(JSON.stringify(responseBody)).not.toContain("server-only");
        expect(responseBody).not.toHaveProperty("workspace.organization_id");
      }
    }
  });

  it("maps category and human-role validation failures to controlled HTTP 400 responses", async () => {
    const invalidBodies = [
      { expected_case_version_id: VERSION_ID, expected_record_version: 4, output_id: OUTPUT_ID, selected_items: [{ proposal_key: "P1", adopted_content: { gap: "gap" }, human_causal_role: "proposed_root_cause" }] },
      { expected_case_version_id: VERSION_ID, expected_record_version: 4, output_id: OUTPUT_ID, selected_items: [{ proposal_key: "P1", adopted_content: { hypothesis: "hypothesis", rationale: "rationale" } }] },
    ];
    for (const invalidBody of invalidBodies) {
      const deps = dependencies({ create_adoption_service: vi.fn(() => ({ adopt: vi.fn(async () => { throw new CapaInvestigationActiveAdoptionValidationError("INVALID_ADOPTED_CONTENT"); }) })) });
      const response = await handleCapaInvestigationActiveAdoptionPost(new Request("http://localhost", { method: "POST", headers: { "Idempotency-Key": "batch-1" }, body: JSON.stringify(invalidBody) }), CASE_ID, OUTPUT_ID, deps);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_CAPA_ADOPTION_REQUEST" } });
    }
  });

  it("maps a transaction-time case race to 409 and persistence failure to 500", async () => {
    const race = dependencies({ create_advisory_service: () => ({ execute: async () => { throw new CapaInvestigationActiveAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED"); } }) });
    const request = new Request("http://localhost", { method: "POST", body: JSON.stringify({ expected_case_version_id: VERSION_ID, expected_record_version: 4 }) });
    expect((await handleCapaInvestigationActiveAdvisoryPost(request, CASE_ID, race)).status).toBe(409);
    const failure = dependencies({ create_advisory_service: () => ({ execute: async () => { throw new CapaInvestigationActiveAdvisoryServiceError("ADVISORY_PERSISTENCE_FAILED"); } }) });
    expect((await handleCapaInvestigationActiveAdvisoryPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ expected_case_version_id: VERSION_ID, expected_record_version: 4 }) }), CASE_ID, failure)).status).toBe(500);
  });
});
