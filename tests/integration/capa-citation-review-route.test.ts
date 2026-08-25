import { describe, expect, it, vi } from "vitest";

import {
  handleCapaCitationReviewPost,
} from "../../lib/capa/api/capa-citation-review-route-handler";

import {
  CapaKnowledgeCitationReviewServiceError,
} from "../../lib/capa/knowledge/capa-knowledge-citation-review-service";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CITATION = "30000000-0000-5000-8000-000000000001";

function setup() {
  const submitHumanReview = vi.fn(async () => ({
    status: "recorded" as const,
    review: {
      citation_review_id: "40000000-0000-5000-8000-000000000001",
      organization_id: ORG,
      citation_id: CITATION,
      disposition: "valid",
      rationale: "The exact effective procedure passage supports the claim.",
      reviewed_by: { actor_type: "human", actor_id: USER },
    },
  }));
  const dependencies = {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER })),
    resolve_context: vi.fn(async () => ({
      authentication: {
        principal: { principal_type: "human", user_id: USER },
      },
      tenant: { organization_id: ORG },
      owner_user_id: USER,
    })),
    create_review_service: vi.fn(() => ({ submitHumanReview })),
    now: () => new Date("2026-08-25T15:00:00.000Z"),
    generate_uuid: vi.fn()
      .mockReturnValueOnce("50000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("60000000-0000-4000-8000-000000000001")
      .mockReturnValue("70000000-0000-4000-8000-000000000001"),
    logger: { error: vi.fn() },
  };
  return { dependencies, submitHumanReview };
}

function request(body: unknown = {
  disposition: "valid",
  rationale: "The exact effective procedure passage supports the claim.",
}) {
  return new Request(`https://lvtchat.com/api/capa/citations/${CITATION}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "review-1" },
    body: JSON.stringify(body),
  });
}

describe("CAPA citation-review route", () => {
  it("derives reviewer and organization from trusted context", async () => {
    const test = setup();
    const response = await handleCapaCitationReviewPost(
      request(), CITATION, test.dependencies as never,
    );
    expect(response.status).toBe(201);
    expect(test.submitHumanReview).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: ORG,
      citation_id: CITATION,
      reviewed_by: { actor_type: "human", actor_id: USER },
    }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unauthenticated requests", async () => {
    const test = setup();
    test.dependencies.get_session_facts = vi.fn(async () => null) as never;
    const response = await handleCapaCitationReviewPost(
      request(), CITATION, test.dependencies as never,
    );
    expect(response.status).toBe(401);
    expect(test.submitHumanReview).not.toHaveBeenCalled();
  });

  it("rejects an invalid citation identifier", async () => {
    const test = setup();
    const response = await handleCapaCitationReviewPost(
      request(), "not-a-uuid", test.dependencies as never,
    );
    expect(response.status).toBe(400);
  });

  it("rejects unknown or extra request fields", async () => {
    const test = setup();
    const response = await handleCapaCitationReviewPost(
      request({ disposition: "valid", rationale: "Enough", approved: true }),
      CITATION,
      test.dependencies as never,
    );
    expect(response.status).toBe(400);
  });

  it("maps authorization denial without leaking policy details", async () => {
    const test = setup();
    test.submitHumanReview.mockRejectedValueOnce(
      new CapaKnowledgeCitationReviewServiceError(
        "HUMAN_REVIEW_NOT_AUTHORIZED",
      ),
    );
    const response = await handleCapaCitationReviewPost(
      request(), CITATION, test.dependencies as never,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "CAPA_CITATION_REVIEW_ACCESS_DENIED" },
    });
  });

  it("returns a tenant-safe not-found response", async () => {
    const test = setup();
    test.submitHumanReview.mockRejectedValueOnce(
      new CapaKnowledgeCitationReviewServiceError(
        "CITATION_NOT_FOUND_OR_NOT_AUTHORIZED",
      ),
    );
    const response = await handleCapaCitationReviewPost(
      request(), CITATION, test.dependencies as never,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("organization");
  });

  it("maps immutable identity conflict to HTTP 409", async () => {
    const test = setup();
    test.submitHumanReview.mockRejectedValueOnce(
      new CapaKnowledgeCitationReviewServiceError(
        "CITATION_REVIEW_CONFLICT",
      ),
    );
    const response = await handleCapaCitationReviewPost(
      request(), CITATION, test.dependencies as never,
    );
    expect(response.status).toBe(409);
  });

  it("logs safe metadata and suppresses unexpected error details", async () => {
    const test = setup();
    test.submitHumanReview.mockRejectedValueOnce(new Error("secret database detail"));
    const response = await handleCapaCitationReviewPost(
      request(), CITATION, test.dependencies as never,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret database detail");
    expect(test.dependencies.logger.error).toHaveBeenCalledOnce();
  });
});
