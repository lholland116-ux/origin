import { describe, expect, it, vi } from "vitest";

import {
  CapaKnowledgeCitationReviewService,
} from "../../lib/capa/knowledge/capa-knowledge-citation-review-service";

const ORG = "10000000-0000-4000-8000-000000000001";
const CITATION_ID = "20000000-0000-5000-8000-000000000001";

function storedCitation() {
  return {
    organization_id: ORG,
    citation: {
      citation_id: CITATION_ID,
      claim_id: "30000000-0000-4000-8000-000000000001",
      evidence_id: "40000000-0000-4000-8000-000000000001",
      source_id: "50000000-0000-4000-8000-000000000001",
      source_version_id: "60000000-0000-4000-8000-000000000001",
      passage_id: "70000000-0000-4000-8000-000000000001",
      segmentation_version: "segmenter-1.0.0",
      locators: [{ kind: "section", label: "7.4" }],
      quoted_text_fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
      relationship: "supports",
      retrieval_run_id: "80000000-0000-4000-8000-000000000001",
      retrieval_rank: 1,
      source_status_at_use: "current_effective",
      validation_status: "valid",
      validator_version: "validator-1.0.0",
      validated_at: "2026-08-25T15:00:00.000Z",
      validated_by: { actor_type: "human", actor_id: "validator" },
      rendered_label: "Procedure; 7.4",
    },
    claim_text: "Effectiveness shall be verified.",
    recorded_at: "2026-08-25T15:00:01.000Z",
    recorded_by: { actor_type: "human", actor_id: "validator" },
  } as never;
}

function setup(overrides: Record<string, unknown> = {}) {
  const appendReview = vi.fn(async () => ({ status: "appended" as const }));
  const repository = {
    appendCitation: vi.fn(),
    findCitationById: vi.fn(async () => storedCitation()),
    appendReview,
    findReviewById: vi.fn(),
    listReviewsForCitation: vi.fn(),
  };
  const transactionManager = {
    runInTransaction: vi.fn(async (_trace: unknown, work: (tx: unknown) => Promise<unknown>) =>
      work({ transaction_id: "tx", started_at: "2026-08-25T15:00:02.000Z" })),
  };
  const authorizer = {
    authorizeCitationReview: vi.fn(async () => true),
  };
  const sourceStatusResolver = {
    resolveSourceStatus: vi.fn(async () => "current_effective" as const),
  };
  const dependencies = {
    repository,
    transaction_manager: transactionManager,
    authorizer,
    source_status_resolver: sourceStatusResolver,
    now: () => new Date("2026-08-25T15:00:03.000Z"),
    ...overrides,
  };
  return {
    service: new CapaKnowledgeCitationReviewService(dependencies as never),
    repository,
    transactionManager,
    authorizer,
    sourceStatusResolver,
    appendReview,
  };
}

function input(actorType = "human") {
  return {
    organization_id: ORG,
    citation_id: CITATION_ID,
    disposition: "valid",
    rationale: "The exact effective procedure passage supports the claim.",
    reviewed_by: { actor_type: actorType, actor_id: "reviewer-1" },
    request_trace: { request_id: "request-1", correlation_id: "correlation-1" },
  } as never;
}

describe("CAPA knowledge citation-review service", () => {
  it("records an authorized human review transactionally", async () => {
    const test = setup();
    const result = await test.service.submitHumanReview(input());
    expect(result.status).toBe("recorded");
    expect(result.review).toMatchObject({
      organization_id: ORG,
      citation_id: CITATION_ID,
      disposition: "valid",
      reviewed_at: "2026-08-25T15:00:03.000Z",
      reviewed_by: { actor_type: "human", actor_id: "reviewer-1" },
    });
    expect(test.transactionManager.runInTransaction).toHaveBeenCalledOnce();
    expect(test.appendReview).toHaveBeenCalledOnce();
  });

  it.each(["service", "agent", "system"])(
    "rejects a %s actor before authorization or lookup",
    async (actorType) => {
      const test = setup();
      await expect(test.service.submitHumanReview(input(actorType))).rejects
        .toMatchObject({ reason_code: "HUMAN_REVIEW_NOT_AUTHORIZED" });
      expect(test.authorizer.authorizeCitationReview).not.toHaveBeenCalled();
      expect(test.repository.findCitationById).not.toHaveBeenCalled();
    },
  );

  it("fails closed when authorization is denied", async () => {
    const authorizer = { authorizeCitationReview: vi.fn(async () => false) };
    const test = setup({ authorizer });
    await expect(test.service.submitHumanReview(input())).rejects.toMatchObject({
      reason_code: "HUMAN_REVIEW_NOT_AUTHORIZED",
    });
    expect(test.repository.findCitationById).not.toHaveBeenCalled();
  });

  it("does not disclose a missing or cross-tenant citation", async () => {
    const test = setup();
    test.repository.findCitationById.mockResolvedValueOnce(null as never);
    await expect(test.service.submitHumanReview(input())).rejects.toMatchObject({
      reason_code: "CITATION_NOT_FOUND_OR_NOT_AUTHORIZED",
    });
  });

  it("uses the authoritative stored citation and resolved source status", async () => {
    const test = setup();
    await test.service.submitHumanReview(input());
    expect(test.sourceStatusResolver.resolveSourceStatus).toHaveBeenCalledWith({
      organization_id: ORG,
      source_id: "50000000-0000-4000-8000-000000000001",
      source_version_id: "60000000-0000-4000-8000-000000000001",
    });
  });

  it("rejects an unavailable authoritative source status", async () => {
    const resolver = { resolveSourceStatus: vi.fn(async () => null) };
    const test = setup({ source_status_resolver: resolver });
    await expect(test.service.submitHumanReview(input())).rejects.toMatchObject({
      reason_code: "SOURCE_STATUS_NOT_FOUND_OR_NOT_AUTHORIZED",
    });
    expect(test.transactionManager.runInTransaction).not.toHaveBeenCalled();
  });

  it("returns stable idempotent retry status", async () => {
    const test = setup();
    test.appendReview.mockResolvedValueOnce({
      status: "already_recorded",
    } as never);
    const result = await test.service.submitHumanReview(input());
    expect(result.status).toBe("already_recorded");
  });

  it("maps identifier reuse to a controlled conflict", async () => {
    const test = setup();
    test.appendReview.mockResolvedValueOnce({
      status: "conflict",
      reason_code: "CITATION_REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
    } as never);
    await expect(test.service.submitHumanReview(input())).rejects.toMatchObject({
      reason_code: "CITATION_REVIEW_CONFLICT",
    });
  });

  it("does not convert a valid review into CAPA approval", async () => {
    const test = setup();
    const result = await test.service.submitHumanReview(input());
    expect(result.review).not.toHaveProperty("approved");
    expect(result.review).not.toHaveProperty("workflow_state");
  });
});
