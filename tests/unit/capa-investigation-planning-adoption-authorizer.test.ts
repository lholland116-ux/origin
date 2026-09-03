import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION,
  PolicyBackedCapaInvestigationPlanningAdoptionAuthorizer,
} from "../../lib/capa/authorization/capa-investigation-planning-adoption-authorizer";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE_ID = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000001";
const OUTPUT = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-03T12:00:00.000Z");

function setup(
  decision: "allow" | "deny" = "allow",
  principalType: "human" | "service" = "human",
) {
  const evaluate = vi.fn().mockResolvedValue({
    decision,
    reason_code: "AUTHORIZED",
    policy_version: "policy-1",
    evaluated_at: NOW.toISOString(),
  });
  const authentication = {
    principal: principalType === "human"
      ? { principal_type: "human", user_id: USER }
      : { principal_type: "service", service_identity_id: USER },
    session_id: "60000000-0000-4000-8000-000000000001",
    authentication_method: "OIDC",
    assurance_level: "MFA",
    authenticated_at: "2026-09-03T11:00:00.000Z",
    expires_at: "2026-09-03T13:00:00.000Z",
  } as never;
  const tenant = {
    organization_id: ORG,
    access_grant_id: "70000000-0000-4000-8000-000000000001",
    access_path: "HUMAN_MEMBERSHIP",
    authorization_policy_version: "policy-1",
    resolved_at: "2026-09-03T11:00:00.000Z",
    role_assignments: [{
      role_assignment_id: "80000000-0000-4000-8000-000000000001",
      role_id: "CAPA_OWNER",
      scope: "ORGANIZATION",
      effective_at: "2026-09-03T10:00:00.000Z",
    }],
  } as never;
  return {
    evaluate,
    authorizer: new PolicyBackedCapaInvestigationPlanningAdoptionAuthorizer({
      authentication,
      tenant,
      policy: { evaluate },
    }),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_version_id: VERSION,
    record_version: 3,
    output_id: OUTPUT,
    adopter: { actor_type: "human", actor_id: USER },
    trusted_now: NOW,
    ...overrides,
  } as never;
}

describe("S30 investigation-planning adoption authorizer", () => {
  it("uses the dedicated human operation and disposition permission", async () => {
    const test = setup();
    await expect(test.authorizer.authorize(input())).resolves.toBe(true);
    expect(test.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION,
      purpose: "CAPA_AI_INVESTIGATION_PLANNING_ADOPTION",
      resource: expect.objectContaining({ workflow_state: "S30" }),
    }));
  });

  it.each([
    ["non-human", { principal: { principal_type: "service" } }],
    ["adopter mismatch", { adopter: { actor_type: "human", actor_id: "90000000-0000-4000-8000-000000000001" } }],
    ["tenant mismatch", { organization_id: "90000000-0000-4000-8000-000000000001" }],
    ["malformed context", { output_id: "not-an-id" }],
    ["invalid trusted time", { trusted_now: new Date(Number.NaN) }],
  ] as const)("fails closed for %s", async (_name, overrides) => {
    const test = setup("allow", _name === "non-human" ? "service" : "human");
    await expect(test.authorizer.authorize(input(overrides as never))).resolves.toBe(false);
  });

  it("fails closed for policy denial and policy exceptions", async () => {
    await expect(setup("deny").authorizer.authorize(input())).resolves.toBe(false);
    const policy = setup();
    policy.evaluate.mockRejectedValue(new Error("policy failure"));
    await expect(policy.authorizer.authorize(input())).resolves.toBe(false);
  });
});
