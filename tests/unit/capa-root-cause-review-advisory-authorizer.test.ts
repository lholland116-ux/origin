import { describe, expect, it, vi } from "vitest";
import { PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer } from "../../lib/capa/authorization/capa-root-cause-review-advisory-authorizer";

const context: any = { organization_id: "10000000-0000-4000-8000-000000000001", actor: "60000000-0000-4000-8000-000000000001", workflow_state: "S50", capa_case_id: "20000000-0000-4000-8000-000000000001", case_version_id: "30000000-0000-4000-8000-000000000001", active_roles: [{ role_id: "CAPA_REVIEWER" }] };
const authentication: any = { principal: { principal_type: "human", user_id: context.actor } };
const tenant: any = { organization_id: context.organization_id };

describe("S50 root-cause review authorizer", () => {
  it("delegates only the exact S50 advisory operation and purpose", async () => {
    const evaluate = vi.fn(async () => ({ decision: "allow" }));
    const authorizer = new PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer({ authentication, tenant, policy: { evaluate } as any, now: () => new Date("2026-09-06T00:00:00.000Z") });
    expect(await authorizer.authorize({ context, operation: "assemble_review_packet" })).toBe(true);
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: "request_ai_root_cause_review_advisory", purpose: "CAPA_AI_ROOT_CAUSE_REVIEW_ADVISORY", resource: expect.objectContaining({ workflow_state: "S50" }) }));
  });

  it("fails closed for nonhuman, wrong tenant, wrong state, and policy denial", async () => {
    const evaluate = vi.fn(async () => ({ decision: "deny" }));
    const make = (overrides: any = {}) => new PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer({ authentication: overrides.authentication ?? authentication, tenant: overrides.tenant ?? tenant, policy: { evaluate } as any, now: () => new Date() });
    expect(await make().authorize({ context, operation: "assemble_review_packet" })).toBe(false);
    expect(await make({ authentication: { principal: { principal_type: "service", user_id: context.actor } } }).authorize({ context, operation: "assemble_review_packet" })).toBe(false);
    expect(await make({ tenant: { organization_id: "different" } }).authorize({ context, operation: "assemble_review_packet" })).toBe(false);
    expect(await make().authorize({ context: { ...context, workflow_state: "S60" }, operation: "assemble_review_packet" } as never)).toBe(false);
  });

  it("fails closed for no roles, actor mismatch, invalid time, and policy exceptions", async () => {
    const evaluate = vi.fn(async () => ({ decision: "allow" }));
    const make = (overrides: any = {}) => new PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer({ authentication: overrides.authentication ?? authentication, tenant: overrides.tenant ?? tenant, policy: { evaluate: overrides.evaluate ?? evaluate } as any, now: overrides.now ?? (() => new Date()) });
    expect(await make().authorize({ context: { ...context, active_roles: [] }, operation: "assemble_review_packet" })).toBe(false);
    expect(await make().authorize({ context: { ...context, actor: "90000000-0000-4000-8000-000000000001" }, operation: "assemble_review_packet" })).toBe(false);
    expect(await make({ now: () => new Date("invalid") }).authorize({ context, operation: "assemble_review_packet" })).toBe(false);
    expect(await make({ evaluate: vi.fn(async () => { throw new Error("policy failure"); }) }).authorize({ context, operation: "assemble_review_packet" })).toBe(false);
  });
});
