import { describe, expect, it, vi } from "vitest";

import {
  PolicyBackedCapaKnowledgeCitationReviewAuthorizer,
} from "../../lib/capa/authorization/capa-knowledge-citation-review-authorizer";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CITATION = "30000000-0000-5000-8000-000000000001";

function setup(decision: "allow" | "deny" = "allow") {
  const evaluate = vi.fn(async () => ({
    decision,
    reason_code: decision === "allow" ? "AUTHORIZED" : "DENIED",
    policy_version: "policy-1",
    evaluated_at: "2026-08-25T15:00:00.000Z",
    ...(decision === "allow" ? { relied_on_role_assignment_ids: [] } : {}),
  }));
  const authorizer = new PolicyBackedCapaKnowledgeCitationReviewAuthorizer({
    authentication: {
      principal: { principal_type: "human", user_id: USER },
      session_id: "session-1",
      authentication_method: "PASSWORD",
      assurance_level: "AAL1",
      authenticated_at: "2026-08-25T14:00:00.000Z",
      expires_at: "2026-08-25T16:00:00.000Z",
    },
    tenant: {
      organization_id: ORG,
      access_grant_id: "grant-1",
      access_path: "SUPABASE_MEMBERSHIP",
      authorization_policy_version: "policy-1",
      resolved_at: "2026-08-25T14:00:00.000Z",
      role_assignments: [],
    },
    policy: { evaluate } as never,
    now: () => new Date("2026-08-25T15:00:00.000Z"),
  } as never);
  return { authorizer, evaluate };
}

function request(actorId = USER, organizationId = ORG) {
  return {
    organization_id: organizationId,
    citation_id: CITATION,
    reviewer: { actor_type: "human", actor_id: actorId },
  } as never;
}

describe("CAPA knowledge citation-review authorizer", () => {
  it("uses the dedicated citation-review operation and purpose", async () => {
    const test = setup();
    await expect(test.authorizer.authorizeCitationReview(request()))
      .resolves.toBe(true);
    expect(test.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: "review_knowledge_citation",
      purpose: "CAPA_KNOWLEDGE_CITATION_REVIEW",
      resource: expect.objectContaining({
        organization_id: ORG,
        resource_id: CITATION,
      }),
    }));
  });

  it("fails closed when the reviewer is not the authenticated human", async () => {
    const test = setup();
    await expect(test.authorizer.authorizeCitationReview(request("other-user")))
      .resolves.toBe(false);
    expect(test.evaluate).not.toHaveBeenCalled();
  });

  it("fails closed across tenant boundaries", async () => {
    const test = setup();
    await expect(test.authorizer.authorizeCitationReview(
      request(USER, "90000000-0000-4000-8000-000000000009"),
    )).resolves.toBe(false);
    expect(test.evaluate).not.toHaveBeenCalled();
  });

  it("does not convert a policy denial into authorization", async () => {
    const test = setup("deny");
    await expect(test.authorizer.authorizeCitationReview(request()))
      .resolves.toBe(false);
  });
});
