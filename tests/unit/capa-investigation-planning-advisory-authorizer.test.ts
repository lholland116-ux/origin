import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-agent-gate";
import {
  PolicyBackedCapaInvestigationPlanningAdvisoryAuthorizer,
} from "../../lib/capa/authorization/capa-investigation-planning-advisory-authorizer";

const ORG = "organization-1";
const USER = "user-1";
const CASE_ID = "case-1";
const VERSION = "version-1";
const NOW = new Date("2026-09-01T12:00:00.000Z");

function setup(
  decision: "allow" | "deny" = "allow",
  now: () => Date = () => NOW,
) {
  const evaluate = vi.fn(async () => ({
    decision,
    reason_code: "POLICY",
    policy_version: "policy-1",
    evaluated_at: "2026-09-01T12:00:00.000Z",
  } as any));
  const authentication: any = {
    principal: { principal_type: "human", user_id: USER },
  };
  const tenant: any = { organization_id: ORG };
  const authorizer =
    new PolicyBackedCapaInvestigationPlanningAdvisoryAuthorizer({
      authentication,
      tenant,
      policy: { evaluate },
      now,
    });
  return { authorizer, evaluate, authentication, tenant };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    operation: CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
    context: {
      organization_id: ORG,
      capa_case_id: CASE_ID,
      case_version_id: VERSION,
      record_version: 2,
      workflow_state: "S30",
      actor: USER,
      active_roles: [{ role_id: "CAPA_OWNER" }],
      ...overrides,
    },
  } as any;
}

describe("S30 investigation-planning advisory authorizer", () => {
  it("allows a matching human through the existing advisory permission", async () => {
    const test = setup();

    await expect(test.authorizer.authorize(request())).resolves.toBe(true);
    expect(test.evaluate).toHaveBeenCalledWith({
      authentication: test.authentication,
      tenant: test.tenant,
      operation: "request_ai_investigation_planning_advisory",
      resource: {
        organization_id: ORG,
        resource_type: "CAPA_CASE",
        resource_id: CASE_ID,
        resource_version_id: VERSION,
        capa_case_id: CASE_ID,
        case_version_id: VERSION,
        workflow_state: "S30",
      },
      purpose: "CAPA_AI_INVESTIGATION_PLANNING_ADVISORY",
      trusted_now: NOW,
    });
  });

  it.each([
    ["non-human", { principal: { principal_type: "service" } }, {}],
    ["wrong user", { principal: { principal_type: "human", user_id: "other" } }, {}],
    ["wrong tenant", undefined, { organization_id: "other" }],
    ["non-S30", undefined, { workflow_state: "S20" }],
    ["missing active roles", undefined, { active_roles: undefined }],
  ] as const)("fails closed for %s before policy evaluation", async (_name, principal, context) => {
    const test = setup();
    if (principal) test.authentication.principal = principal;

    await expect(test.authorizer.authorize(request(context))).resolves.toBe(false);
    expect(test.evaluate).not.toHaveBeenCalled();
  });

  it("fails closed for wrong operation, trusted-time failures, and policy denial", async () => {
    const wrongOperation = setup();
    await expect(
      wrongOperation.authorizer.authorize({
        ...request(),
        operation: "release_investigation",
      } as any),
    ).resolves.toBe(false);
    expect(wrongOperation.evaluate).not.toHaveBeenCalled();

    const clockFailure = setup("allow", () => {
      throw new Error("clock");
    });
    await expect(clockFailure.authorizer.authorize(request())).resolves.toBe(false);
    expect(clockFailure.evaluate).not.toHaveBeenCalled();

    const denied = setup("deny");
    await expect(denied.authorizer.authorize(request())).resolves.toBe(false);
  });
});
