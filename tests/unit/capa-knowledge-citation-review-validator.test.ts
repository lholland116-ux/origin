import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_KNOWLEDGE_CITATION_REVIEW_REASON_CODES,
  CapaKnowledgeCitationReviewValidationError,
  constructCapaKnowledgeCitationReview,
} from "../../lib/capa/knowledge/capa-knowledge-citation-review-validator";

const ORGANIZATION_ID =
  "f99d1064-986d-4b22-aad7-6a584c52c866";

function citation(
  overrides: Record<string, unknown> = {},
) {
  return {
    citation_id:
      "a7c6a125-9146-5bb1-b41e-44a6bd8508d3",
    claim_id:
      "064717e2-fdeb-4ccb-9503-9255c64abc32",
    evidence_id:
      "acaf0d5b-d698-5afe-9a74-2c130ed8265c",
    source_id:
      "a2f60635-067b-4880-b9b6-b16e1f32d936",
    source_version_id:
      "82adf16f-c25c-4cca-b3a6-25d5a320733a",
    passage_id:
      "62ed4a8e-c215-4534-be9a-4a607e3c6123",
    segmentation_version: "segmenter-1.0.0",
    locators: [{ kind: "section", label: "§ 7.4" }],
    quoted_text_fingerprint: {
      algorithm: "sha256",
      value: "a".repeat(64),
    },
    relationship: "supports",
    retrieval_run_id:
      "db4e0623-3e39-4bb5-a769-178900939a30",
    retrieval_rank: 1,
    source_status_at_use: "current_effective",
    validation_status: "valid",
    validator_version:
      "capa-knowledge-citation-validator-1.0.0",
    validated_at: "2026-08-25T13:00:00.000Z",
    validated_by: {
      actor_type: "human",
      actor_id: "citation-assessor",
    },
    rendered_label: "Procedure; § 7.4",
    ...overrides,
  };
}

function input(
  overrides: Record<string, unknown> = {},
) {
  return {
    organization_id: ORGANIZATION_ID,
    citation: citation(),
    source_status_at_review: "current_effective",
    disposition: "valid",
    rationale:
      "The cited passage directly supports the bounded claim.",
    reviewed_at: "2026-08-25T13:05:00.000Z",
    reviewed_by: {
      actor_type: "human",
      actor_id: "quality-reviewer",
    },
    ...overrides,
  };
}

function expectReason(
  operation: () => unknown,
  reasonCode: string,
): void {
  expect(operation).toThrowError(
    expect.objectContaining({
      name:
        "CapaKnowledgeCitationReviewValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe("CAPA knowledge citation human review validation", () => {
  it("constructs an immutable version-bound review record", () => {
    const result = constructCapaKnowledgeCitationReview(
      input() as never,
    );

    expect(result).toMatchObject({
      organization_id: ORGANIZATION_ID,
      disposition: "valid",
      machine_validation_status: "valid",
      source_status_at_review: "current_effective",
      requires_expert_review: false,
      reviewed_by: {
        actor_type: "human",
        actor_id: "quality-reviewer",
      },
      review_policy_version:
        "capa-knowledge-citation-review-1.0.0",
    });
    expect(result.citation_review_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reviewed_by)).toBe(true);
  });

  it("produces a stable identity for an exact retry", () => {
    const first = constructCapaKnowledgeCitationReview(
      input() as never,
    );
    const retry = constructCapaKnowledgeCitationReview(
      input() as never,
    );

    expect(retry.citation_review_id)
      .toBe(first.citation_review_id);
  });

  it.each(["service", "agent", "system"])(
    "rejects a %s actor from the human review boundary",
    (actorType) => {
      expectReason(
        () => constructCapaKnowledgeCitationReview(
          input({
            reviewed_by: {
              actor_type: actorType,
              actor_id: "non-human-reviewer",
              actor_version: "1.0.0",
            },
          }) as never,
        ),
        "HUMAN_REVIEW_REQUIRED",
      );
    },
  );

  it("requires attributable review rationale", () => {
    expectReason(
      () => constructCapaKnowledgeCitationReview(
        input({ rationale: "" }) as never,
      ),
      "RATIONALE_REQUIRED",
    );
  });

  it("rejects a review timestamp before machine validation", () => {
    expectReason(
      () => constructCapaKnowledgeCitationReview(
        input({
          reviewed_at: "2026-08-25T12:59:59.000Z",
        }) as never,
      ),
      "INVALID_REVIEW_TIMESTAMP",
    );
  });

  it.each([
    ["invalid", "current_effective"],
    ["unresolved", "current_effective"],
    ["superseded_impact", "superseded"],
    ["rights_restricted", "current_effective"],
  ])(
    "prevents valid disposition for %s machine status",
    (validationStatus, sourceStatus) => {
      expectReason(
        () => constructCapaKnowledgeCitationReview(
          input({
            citation: citation({
              validation_status: validationStatus,
            }),
            source_status_at_review: sourceStatus,
          }) as never,
        ),
        "VALID_DISPOSITION_NOT_PERMITTED",
      );
    },
  );

  it("records expert escalation without accepting the citation", () => {
    const result = constructCapaKnowledgeCitationReview(
      input({
        disposition: "needs_expert_review",
        rationale:
          "Applicability requires assessment by the designated subject-matter expert.",
      }) as never,
    );

    expect(result.requires_expert_review).toBe(true);
    expect(result.disposition)
      .toBe("needs_expert_review");
  });

  it("publishes stable controlled reason codes", () => {
    expect(
      CAPA_KNOWLEDGE_CITATION_REVIEW_REASON_CODES,
    ).toContain("HUMAN_REVIEW_REQUIRED");
    expect(
      CAPA_KNOWLEDGE_CITATION_REVIEW_REASON_CODES,
    ).toContain("VALID_DISPOSITION_NOT_PERMITTED");
    expect(
      new CapaKnowledgeCitationReviewValidationError(
        "INVALID_REVIEW_INPUT",
      ).message,
    ).not.toContain(ORGANIZATION_ID);
  });
});
