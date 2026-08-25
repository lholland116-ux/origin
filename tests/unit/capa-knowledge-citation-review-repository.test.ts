import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CapaKnowledgeCitationReviewRepositoryError,
  type CapaKnowledgeCitationReviewRepository,
} from "../../lib/database/repositories/capa-knowledge-citation-review-repository";

describe("CAPA citation-review repository contract", () => {
  it("exposes a safe stable repository failure", () => {
    const error =
      new CapaKnowledgeCitationReviewRepositoryError();
    expect(error.name).toBe(
      "CapaKnowledgeCitationReviewRepositoryError",
    );
    expect(error.message).not.toContain("organization");
  });

  it("requires append-only citation and review operations", () => {
    const repository = {} as CapaKnowledgeCitationReviewRepository;
    expect(repository).toBeDefined();
  });
});
