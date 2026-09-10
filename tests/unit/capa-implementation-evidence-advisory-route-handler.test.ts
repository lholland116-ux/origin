import { describe, expect, it, vi } from "vitest";
import { handleCapaImplementationEvidenceAdvisoryPost } from "../../lib/capa/api/capa-implementation-evidence-advisory-route-handler";
import { handleCapaImplementationEvidenceAdvisoryAdoptionPost } from "../../lib/capa/api/capa-implementation-evidence-advisory-adoption-route-handler";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import { CapaImplementationEvidenceAdvisoryServiceError } from "../../lib/capa/ai/capa-implementation-evidence-advisory-service";

const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const OUTPUT = "50000000-0000-4000-8000-000000000001";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

const context = {
  authentication: {
    principal: { principal_type: "human", user_id: USER },
    session_id: "70000000-0000-4000-8000-000000000001",
    authentication_method: "password",
    assurance_level: "aal1",
    authenticated_at: AT,
    expires_at: "2026-09-10T13:00:00.000Z",
  },
  tenant: {
    organization_id: "10000000-0000-4000-8000-000000000001",
    access_grant_id: "80000000-0000-4000-8000-000000000001",
    access_path: "HUMAN_MEMBERSHIP",
    authorization_policy_version: "policy-1.0.0",
    resolved_at: AT,
    role_assignments: [],
  },
  owner_user_id: USER,
} as unknown as CapaRequestContext;

function common(overrides: Record<string, unknown> = {}) {
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER, authenticated_at: AT, expires_at_epoch_seconds: 1_800_000_000 })),
    resolve_context: vi.fn(async () => context),
    now: () => new Date(AT),
    generate_uuid: () => REQUEST,
    logger: { error: vi.fn() },
    ...overrides,
  } as never;
}

describe("S80 implementation-evidence advisory route", () => {
  it("returns a created advisory and rejects malformed requests", async () => {
    const execute = vi.fn(async () => ({ advisory: { advisory_only: true }, snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 8 } }));
    const dependencies = common({ create_advisory_service: vi.fn(() => ({ execute })) });
    const valid = await handleCapaImplementationEvidenceAdvisoryPost(new Request("https://example.test", { method: "POST", body: JSON.stringify({ expected_case_version_id: VERSION, expected_record_version: 8 }) }), CASE, dependencies);
    expect(valid.status).toBe(201);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ capa_case_id: CASE, request: { expected_case_version_id: VERSION, expected_record_version: 8 } }));

    const malformed = await handleCapaImplementationEvidenceAdvisoryPost(new Request("https://example.test", { method: "POST", body: JSON.stringify({ expected_case_version_id: VERSION }) }), CASE, dependencies);
    expect(malformed.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("maps authorization and authoritative-reference failures without leaking internals", async () => {
    const dependencies = common({ create_advisory_service: vi.fn(() => ({ execute: vi.fn(async () => { throw new CapaImplementationEvidenceAdvisoryServiceError("INVALID_CITATION"); }) })) });
    const response = await handleCapaImplementationEvidenceAdvisoryPost(new Request("https://example.test", { method: "POST", body: JSON.stringify({ expected_case_version_id: VERSION, expected_record_version: 8 }) }), CASE, dependencies);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "CAPA_ADVISORY_INVALID_CITATION" } });
  });
});

describe("S80 implementation-evidence advisory adoption route", () => {
  it("requires idempotency and prepares a deliberate adoption result", async () => {
    const prepare = vi.fn(async () => ({ status: "prepared", patch: { requires_human_review: true, auto_saved: false, auto_submitted: false, evidence_created: false }, request_trace: { request_id: REQUEST, correlation_id: REQUEST } }));
    const dependencies = common({ create_adoption_service: vi.fn(() => ({ prepare })) });
    const body = { output_id: OUTPUT, finding_id: "finding-1", expected_case_version_id: VERSION, expected_record_version: 8 };
    const missingKey = await handleCapaImplementationEvidenceAdvisoryAdoptionPost(new Request("https://example.test", { method: "POST", body: JSON.stringify(body) }), CASE, OUTPUT, dependencies);
    expect(missingKey.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();

    const valid = await handleCapaImplementationEvidenceAdvisoryAdoptionPost(new Request("https://example.test", { method: "POST", headers: { "Idempotency-Key": "adoption-1" }, body: JSON.stringify(body) }), CASE, OUTPUT, dependencies);
    expect(valid.status).toBe(201);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ capa_case_id: CASE, request: body }));
  });

  it("rejects a route/body output mismatch before service invocation", async () => {
    const prepare = vi.fn();
    const dependencies = common({ create_adoption_service: vi.fn(() => ({ prepare })) });
    const response = await handleCapaImplementationEvidenceAdvisoryAdoptionPost(new Request("https://example.test", { method: "POST", headers: { "Idempotency-Key": "adoption-1" }, body: JSON.stringify({ output_id: "50000000-0000-4000-8000-000000000002", finding_id: "finding-1", expected_case_version_id: VERSION, expected_record_version: 8 }) }), CASE, OUTPUT, dependencies);
    expect(response.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });
});
