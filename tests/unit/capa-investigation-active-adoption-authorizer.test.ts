import { describe, expect, it, vi } from "vitest";
import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_OPERATION,
  PolicyBackedCapaInvestigationActiveAdoptionAuthorizer,
} from "../../lib/capa/authorization/capa-investigation-active-adoption-authorizer";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE_ID = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000001";
const OUTPUT = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-05T12:00:00.000Z");

function setup(decision: "allow" | "deny" = "allow", principalType: "human" | "service" = "human") {
  const evaluate = vi.fn().mockResolvedValue({ decision, reason_code: "AUTHORIZED", policy_version: "policy-1", evaluated_at: NOW.toISOString(), relied_on_role_assignment_ids: [] });
  return {
    evaluate,
    authorizer: new PolicyBackedCapaInvestigationActiveAdoptionAuthorizer({
      authentication: { principal: principalType === "human" ? { principal_type: "human", user_id: USER } : { principal_type: "service", service_identity_id: USER }, session_id: "60000000-0000-4000-8000-000000000001", authentication_method: "OIDC", assurance_level: "MFA", authenticated_at: "2026-09-05T11:00:00.000Z", expires_at: "2026-09-05T13:00:00.000Z" } as never,
      tenant: { organization_id: ORG, access_grant_id: "70000000-0000-4000-8000-000000000001", access_path: "HUMAN_MEMBERSHIP", authorization_policy_version: "policy-1", resolved_at: "2026-09-05T11:00:00.000Z", role_assignments: [] } as never,
      policy: { evaluate },
    }),
  };
}
function input(overrides: Record<string, unknown> = {}) {
  return { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, output_id: OUTPUT, adopter: { actor_type: "human", actor_id: USER }, trusted_now: NOW, ...overrides } as never;
}

describe("S40 investigation-active adoption authorizer", () => {
  it("allows only the exact human S40 adoption policy request", async () => {
    const test = setup();
    await expect(test.authorizer.authorize(input())).resolves.toBe(true);
    expect(test.evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: CAPA_INVESTIGATION_ACTIVE_ADOPTION_OPERATION, purpose: "CAPA_AI_INVESTIGATION_ACTIVE_ADOPTION", resource: expect.objectContaining({ workflow_state: "S40" }) }));
  });
  it.each([
    ["machine", { principal: { principal_type: "service" } }],
    ["actor mismatch", { adopter: { actor_type: "human", actor_id: "80000000-0000-4000-8000-000000000001" } }],
    ["tenant mismatch", { organization_id: "80000000-0000-4000-8000-000000000001" }],
    ["bad case", { capa_case_id: "not-a-uuid" }],
    ["bad output", { output_id: "not-a-uuid" }],
    ["bad clock", { trusted_now: new Date(Number.NaN) }],
  ] as const)("fails closed for %s", async (_name, overrides) => {
    const test = setup("allow", _name === "machine" ? "service" : "human");
    await expect(test.authorizer.authorize(input(overrides as never))).resolves.toBe(false);
    expect(test.evaluate).not.toHaveBeenCalled();
  });
  it("fails closed on policy denial and exception", async () => {
    await expect(setup("deny").authorizer.authorize(input())).resolves.toBe(false);
    const test = setup(); test.evaluate.mockRejectedValue(new Error("policy failure"));
    await expect(test.authorizer.authorize(input())).resolves.toBe(false);
  });
});
