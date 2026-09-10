import { describe, expect, it, vi } from "vitest";
import { PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer } from "../../lib/capa/ai/capa-implementation-evidence-advisory-authorizer";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION } from "../../lib/capa/ai/capa-implementation-evidence-advisory-agent-gate";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

function context(overrides: Record<string, unknown> = {}) {
  return {
    authentication: {
      principal: { principal_type: "human", user_id: USER },
      session_id: "50000000-0000-4000-8000-000000000001",
      authentication_method: "password",
      assurance_level: "aal1",
      authenticated_at: AT,
      expires_at: "2026-09-10T13:00:00.000Z",
    },
    tenant: {
      organization_id: ORG,
      access_grant_id: "60000000-0000-4000-8000-000000000001",
      access_path: "HUMAN_MEMBERSHIP",
      authorization_policy_version: "policy-1.0.0",
      resolved_at: AT,
      role_assignments: [{ role_assignment_id: "70000000-0000-4000-8000-000000000001", role_id: "CAPA_OWNER", scope: "ORGANIZATION", effective_at: "2026-01-01T00:00:00.000Z" }],
    },
    owner_user_id: USER,
    ...overrides,
  } as unknown as CapaRequestContext;
}

const authoritative = {
  trust: "authoritative_server_context",
  organization_id: ORG,
  capa_case_id: CASE,
  case_version_id: VERSION,
  record_version: 8,
  workflow_state: "S80",
  actor: USER,
  active_roles: [{ role_id: "CAPA_OWNER" }],
} as any;

describe("S80 advisory authorization", () => {
  it("authorizes only the explicit human S80 advisory operation", async () => {
    const evaluate = vi.fn(async () => ({ decision: "allow" }));
    const authorizer = new PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer(context(), { evaluate } as never, () => new Date(AT));
    await expect(authorizer.authorize({ context: authoritative, operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION })).resolves.toBe(true);
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: "request_ai_implementation_evidence_advisory", purpose: "CAPA_AI_IMPLEMENTATION_EVIDENCE_ADVISORY", resource: expect.objectContaining({ workflow_state: "S80", capa_case_id: CASE }) }));
  });

  it("fails closed for non-human, wrong-state, missing-role, mismatched-actor, and policy-error requests", async () => {
    const evaluate = vi.fn(async () => ({ decision: "allow" }));
    const authorizer = new PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer(context(), { evaluate } as never, () => new Date(AT));
    await expect(authorizer.authorize({ context: { ...authoritative, workflow_state: "S90" } as never, operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION })).resolves.toBe(false);
    await expect(authorizer.authorize({ context: { ...authoritative, active_roles: [] } as never, operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION })).resolves.toBe(false);
    await expect(new PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer(context({ authentication: { ...context().authentication, principal: { principal_type: "service", service_identity_id: "service-1" } } }), { evaluate } as never, () => new Date(AT)).authorize({ context: authoritative, operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION })).resolves.toBe(false);

    const broken = new PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer(context(), { evaluate: vi.fn(async () => { throw new Error("policy"); }) } as never, () => new Date(AT));
    await expect(broken.authorize({ context: authoritative, operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION })).resolves.toBe(false);
  });
});
