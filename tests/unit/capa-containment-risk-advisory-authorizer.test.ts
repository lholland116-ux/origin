import { describe, expect, it, vi } from "vitest";
import { PolicyBackedCapaContainmentRiskAdvisoryAuthorizer } from "../../lib/capa/authorization/capa-containment-risk-advisory-authorizer";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE_ID = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-01T12:00:00.000Z");

function setup(decision: "allow" | "deny" = "allow", now: () => Date = () => NOW) {
  const evaluate = vi.fn(async () => ({ decision, reason_code: "AUTH", policy_version: "policy-1", evaluated_at: "2026-09-01T12:00:00.000Z" } as any));
  const authentication: any = { principal: { principal_type: "human", user_id: USER }, session_id: "session", authentication_method: "PASSWORD", assurance_level: "AAL1", authenticated_at: "2026-09-01T10:00:00.000Z", expires_at: "2026-09-01T14:00:00.000Z" };
  const tenant: any = { organization_id: ORG, access_grant_id: "grant", access_path: "SUPABASE_MEMBERSHIP", authorization_policy_version: "policy-1", resolved_at: "2026-09-01T10:00:00.000Z", role_assignments: [] };
  const policy = { evaluate };
  const authorizer = new PolicyBackedCapaContainmentRiskAdvisoryAuthorizer({ authentication, tenant, policy, now });
  return { authorizer, evaluate, authentication, tenant };
}

function request(overrides: Record<string, unknown> = {}) {
  return { context: { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 2, workflow_state: "S20", actor: USER, active_roles: [], intake_scope: {}, persisted_containment_risk: null, ...overrides }, operation: "analyze_containment_impact_risk" } as any;
}

describe("S20 containment/risk advisory authorizer", () => {
  it("allows a matching human through the dedicated policy purpose", async () => {
    const test = setup();
    await expect(test.authorizer.authorize(request())).resolves.toBe(true);
    expect(test.evaluate).toHaveBeenCalledTimes(1);
    expect(test.evaluate).toHaveBeenCalledWith({ authentication: test.authentication, tenant: test.tenant, operation: "request_ai_containment_risk_advisory", resource: { organization_id: ORG, resource_type: "CAPA_CASE", resource_id: CASE_ID, resource_version_id: VERSION, capa_case_id: CASE_ID, case_version_id: VERSION, workflow_state: "S20" }, purpose: "CAPA_AI_CONTAINMENT_RISK_ADVISORY", trusted_now: NOW });
  });

  it.each([
    ["non-human", { principal: { principal_type: "service", service_identity_id: "service" } }, {}, undefined],
    ["principal mismatch", { principal: { principal_type: "human", user_id: "other" } }, {}, undefined],
    ["tenant mismatch", undefined, { organization_id: "other" }, undefined],
    ["non-S20", undefined, { workflow_state: "S10" }, undefined],
    ["wrong operation", undefined, {}, "wrong_operation"],
  ] as const)("fails closed for %s before policy evaluation", async (_name, principal, context, operation) => {
    const test = setup();
    if (principal) test.authentication.principal = principal;
    const input = request(context);
    if (operation) input.operation = operation;
    await expect(test.authorizer.authorize(input)).resolves.toBe(false);
    expect(test.evaluate).not.toHaveBeenCalled();
  });

  it("fails closed when trusted time or policy evaluation fails", async () => {
    const clock = setup("allow", () => { throw new Error("clock"); });
    await expect(clock.authorizer.authorize(request())).resolves.toBe(false);
    expect(clock.evaluate).not.toHaveBeenCalled();
    const invalid = setup("allow", () => new Date("invalid"));
    await expect(invalid.authorizer.authorize(request())).resolves.toBe(false);
    expect(invalid.evaluate).not.toHaveBeenCalled();
    const denied = setup("deny");
    await expect(denied.authorizer.authorize(request())).resolves.toBe(false);
    const thrown = setup();
    thrown.evaluate.mockRejectedValue(new Error("policy"));
    await expect(thrown.authorizer.authorize(request())).resolves.toBe(false);
  });
});
