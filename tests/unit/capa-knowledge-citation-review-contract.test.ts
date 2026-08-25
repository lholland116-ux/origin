import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS,
  CAPA_KNOWLEDGE_CITATION_REVIEW_POLICY_VERSION,
  isAcceptedCapaKnowledgeCitationReview,
} from "../../lib/capa/knowledge/capa-knowledge-citation-review-contract";

describe("CAPA knowledge citation review contract", () => {
  it("defines every approved neutral human disposition", () => {
    expect(
      CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS,
    ).toEqual([
      "valid",
      "invalid",
      "insufficient",
      "wrong_source",
      "wrong_version",
      "wrong_locator",
      "not_applicable",
      "needs_expert_review",
    ]);
    expect(
      CAPA_KNOWLEDGE_CITATION_REVIEW_POLICY_VERSION,
    ).toBe("capa-knowledge-citation-review-1.0.0");
  });

  it("treats only an explicit valid human disposition as accepted", () => {
    expect(
      isAcceptedCapaKnowledgeCitationReview({
        disposition: "valid",
      } as never),
    ).toBe(true);
    expect(
      isAcceptedCapaKnowledgeCitationReview({
        disposition: "needs_expert_review",
      } as never),
    ).toBe(false);
  });
});
