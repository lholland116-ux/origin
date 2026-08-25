import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryCapaKnowledgeCitationReviewRepository,
} from "../../lib/database/in-memory/in-memory-capa-knowledge-citation-review-repository";

import type {
  CapaKnowledgeStoredCitation,
} from "../../lib/database/repositories/capa-knowledge-citation-review-repository";

import type {
  CapaKnowledgeCitationReviewRecord,
} from "../../lib/capa/knowledge/capa-knowledge-citation-review-contract";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "10000000-0000-4000-8000-000000000002";
const CITATION_ID = "20000000-0000-5000-8000-000000000001";
const REVIEW_ID = "30000000-0000-5000-8000-000000000001";
const TRANSACTION = {} as never;

function storedCitation(
  overrides: Record<string, unknown> = {},
): CapaKnowledgeStoredCitation {
  return {
    organization_id: ORG,
    citation: {
      citation_id: CITATION_ID,
      claim_id: "40000000-0000-4000-8000-000000000001",
      evidence_id: "50000000-0000-4000-8000-000000000001",
      source_id: "60000000-0000-4000-8000-000000000001",
      source_version_id: "70000000-0000-4000-8000-000000000001",
      passage_id: "80000000-0000-4000-8000-000000000001",
      segmentation_version: "segmenter-1.0.0",
      locators: [{ kind: "section", label: "§ 7.4" }],
      quoted_text_fingerprint: {
        algorithm: "sha256",
        value: "a".repeat(64),
      },
      relationship: "supports",
      retrieval_run_id: "90000000-0000-4000-8000-000000000001",
      retrieval_rank: 1,
      source_status_at_use: "current_effective",
      validation_status: "valid",
      validator_version: "citation-validator-1.0.0",
      validated_at: "2026-08-25T14:00:00.000Z",
      validated_by: {
        actor_type: "human",
        actor_id: "citation-assessor",
      },
      rendered_label: "Procedure; § 7.4",
    },
    claim_text: "Corrective action effectiveness shall be verified.",
    recorded_at: "2026-08-25T14:00:01.000Z",
    recorded_by: {
      actor_type: "human",
      actor_id: "citation-assessor",
    },
    ...overrides,
  } as unknown as CapaKnowledgeStoredCitation;
}

function review(
  overrides: Record<string, unknown> = {},
): CapaKnowledgeCitationReviewRecord {
  const citation = storedCitation().citation;
  return {
    citation_review_id: REVIEW_ID,
    organization_id: ORG,
    citation_id: citation.citation_id,
    claim_id: citation.claim_id,
    source_id: citation.source_id,
    source_version_id: citation.source_version_id,
    passage_id: citation.passage_id,
    retrieval_run_id: citation.retrieval_run_id,
    citation_validator_version: citation.validator_version,
    machine_validation_status: citation.validation_status,
    source_status_at_review: "current_effective",
    disposition: "valid",
    rationale: "The passage directly supports the bounded claim.",
    requires_expert_review: false,
    reviewed_at: "2026-08-25T14:05:00.000Z",
    reviewed_by: {
      actor_type: "human",
      actor_id: "quality-reviewer",
    },
    review_policy_version: "citation-review-1.0.0",
    ...overrides,
  } as unknown as CapaKnowledgeCitationReviewRecord;
}

describe("in-memory CAPA citation-review repository", () => {
  it("appends and resolves an exact tenant citation", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    expect(await repository.appendCitation(
      TRANSACTION,
      storedCitation(),
    )).toEqual({ status: "appended" });
    expect(await repository.findCitationById(
      ORG as never,
      CITATION_ID as never,
    )).toMatchObject({ organization_id: ORG });
    expect(await repository.findCitationById(
      OTHER_ORG as never,
      CITATION_ID as never,
    )).toBeNull();
  });

  it("treats an exact citation retry as already recorded", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    await repository.appendCitation(TRANSACTION, storedCitation());
    expect(await repository.appendCitation(
      TRANSACTION,
      storedCitation(),
    )).toEqual({ status: "already_recorded" });
  });

  it("fails closed when citation identity is reused", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    await repository.appendCitation(TRANSACTION, storedCitation());
    expect(await repository.appendCitation(
      TRANSACTION,
      storedCitation({ claim_text: "Different claim" }),
    )).toMatchObject({ status: "conflict" });
  });

  it("does not append a review without its tenant citation", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    expect(await repository.appendReview(
      TRANSACTION,
      review(),
    )).toEqual({
      status: "citation_not_found_or_not_authorized",
    });
  });

  it("appends and resolves an immutable review", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    await repository.appendCitation(TRANSACTION, storedCitation());
    expect(await repository.appendReview(
      TRANSACTION,
      review(),
    )).toEqual({ status: "appended" });
    expect(await repository.findReviewById(
      ORG as never,
      REVIEW_ID as never,
    )).toMatchObject({ disposition: "valid" });
    expect(await repository.findReviewById(
      OTHER_ORG as never,
      REVIEW_ID as never,
    )).toBeNull();
  });

  it("rejects review citation-binding mismatch", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    await repository.appendCitation(TRANSACTION, storedCitation());
    await expect(repository.appendReview(
      TRANSACTION,
      review({
        passage_id: "80000000-0000-4000-8000-000000000099",
      }),
    )).rejects.toMatchObject({
      name: "CapaKnowledgeCitationReviewRepositoryError",
    });
  });

  it("lists only tenant-bound reviews with bounded pagination", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    await repository.appendCitation(TRANSACTION, storedCitation());
    await repository.appendReview(TRANSACTION, review());
    const page = await repository.listReviewsForCitation({
      organization_id: ORG as never,
      citation_id: CITATION_ID as never,
      limit: 10,
    });
    expect(page.reviews).toHaveLength(1);
    expect(await repository.listReviewsForCitation({
      organization_id: OTHER_ORG as never,
      citation_id: CITATION_ID as never,
      limit: 10,
    })).toEqual({ reviews: [] });
  });

  it("rejects unbounded list requests", async () => {
    const repository =
      new InMemoryCapaKnowledgeCitationReviewRepository();
    await expect(repository.listReviewsForCitation({
      organization_id: ORG as never,
      citation_id: CITATION_ID as never,
      limit: 101,
    })).rejects.toMatchObject({
      name: "CapaKnowledgeCitationReviewRepositoryError",
    });
  });
});
