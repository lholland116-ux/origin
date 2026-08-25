import { isDeepStrictEqual } from "node:util";

import type {
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaKnowledgeCitationId,
} from "../../capa/knowledge/capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeCitationReviewId,
  CapaKnowledgeCitationReviewRecord,
} from "../../capa/knowledge/capa-knowledge-citation-review-contract";

import {
  CapaKnowledgeCitationReviewRepositoryError,
  type AppendCapaKnowledgeCitationResult,
  type AppendCapaKnowledgeCitationReviewResult,
  type CapaKnowledgeCitationReviewListPage,
  type CapaKnowledgeCitationReviewListQuery,
  type CapaKnowledgeCitationReviewRepository,
  type CapaKnowledgeStoredCitation,
} from "../repositories/capa-knowledge-citation-review-repository";

import type {
  TransactionContext,
} from "../transactions";

/** Deterministic development and isolated-verification adapter. */
export class InMemoryCapaKnowledgeCitationReviewRepository
  implements CapaKnowledgeCitationReviewRepository {
  private readonly citations =
    new Map<string, CapaKnowledgeStoredCitation>();

  private readonly reviews =
    new Map<string, CapaKnowledgeCitationReviewRecord>();

  constructor(
    citations: readonly CapaKnowledgeStoredCitation[] = [],
    reviews: readonly CapaKnowledgeCitationReviewRecord[] = [],
  ) {
    for (const citation of citations) {
      this.citations.set(
        this.citationKey(
          citation.organization_id,
          citation.citation.citation_id,
        ),
        this.clone(citation),
      );
    }

    for (const review of reviews) {
      this.reviews.set(
        this.reviewKey(
          review.organization_id,
          review.citation_review_id,
        ),
        this.clone(review),
      );
    }
  }

  async appendCitation(
    _transaction: TransactionContext,
    citation: CapaKnowledgeStoredCitation,
  ): Promise<AppendCapaKnowledgeCitationResult> {
    const key = this.citationKey(
      citation.organization_id,
      citation.citation.citation_id,
    );
    const current = this.citations.get(key);

    if (current !== undefined) {
      return isDeepStrictEqual(current, citation)
        ? { status: "already_recorded" }
        : {
            status: "conflict",
            reason_code:
              "CITATION_ID_REUSED_WITH_DIFFERENT_CONTENT",
          };
    }

    this.citations.set(key, this.clone(citation));
    return { status: "appended" };
  }

  async findCitationById(
    organizationId: OrganizationId,
    citationId: CapaKnowledgeCitationId,
  ): Promise<CapaKnowledgeStoredCitation | null> {
    const citation = this.citations.get(
      this.citationKey(organizationId, citationId),
    );
    return citation === undefined
      ? null
      : this.clone(citation);
  }

  async appendReview(
    _transaction: TransactionContext,
    review: CapaKnowledgeCitationReviewRecord,
  ): Promise<AppendCapaKnowledgeCitationReviewResult> {
    const citation = this.citations.get(
      this.citationKey(
        review.organization_id,
        review.citation_id,
      ),
    );

    if (citation === undefined) {
      return {
        status: "citation_not_found_or_not_authorized",
      };
    }

    if (
      citation.citation.claim_id !== review.claim_id ||
      citation.citation.source_id !== review.source_id ||
      citation.citation.source_version_id !==
        review.source_version_id ||
      citation.citation.passage_id !== review.passage_id ||
      citation.citation.retrieval_run_id !==
        review.retrieval_run_id
    ) {
      throw new CapaKnowledgeCitationReviewRepositoryError();
    }

    const key = this.reviewKey(
      review.organization_id,
      review.citation_review_id,
    );
    const current = this.reviews.get(key);

    if (current !== undefined) {
      return isDeepStrictEqual(current, review)
        ? { status: "already_recorded" }
        : {
            status: "conflict",
            reason_code:
              "CITATION_REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
          };
    }

    this.reviews.set(key, this.clone(review));
    return { status: "appended" };
  }

  async findReviewById(
    organizationId: OrganizationId,
    reviewId: CapaKnowledgeCitationReviewId,
  ): Promise<CapaKnowledgeCitationReviewRecord | null> {
    const review = this.reviews.get(
      this.reviewKey(organizationId, reviewId),
    );
    return review === undefined
      ? null
      : this.clone(review);
  }

  async listReviewsForCitation(
    query: CapaKnowledgeCitationReviewListQuery,
  ): Promise<CapaKnowledgeCitationReviewListPage> {
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new CapaKnowledgeCitationReviewRepositoryError();
    }

    const ordered = [...this.reviews.values()]
      .filter(
        (review) =>
          review.organization_id === query.organization_id &&
          review.citation_id === query.citation_id,
      )
      .sort((left, right) =>
        left.reviewed_at.localeCompare(right.reviewed_at) ||
        left.citation_review_id.localeCompare(
          right.citation_review_id,
        ),
      );
    const start = query.after_review_id === undefined
      ? 0
      : ordered.findIndex(
          (review) =>
            review.citation_review_id ===
              query.after_review_id,
        ) + 1;
    const page = ordered.slice(start, start + query.limit);
    const hasMore = start + page.length < ordered.length;

    return Object.freeze({
      reviews: Object.freeze(
        page.map((review) => this.clone(review)),
      ),
      ...(hasMore && page.length > 0
        ? {
            next_review_id:
              page[page.length - 1]!.citation_review_id,
          }
        : {}),
    });
  }

  private citationKey(
    organizationId: OrganizationId,
    citationId: CapaKnowledgeCitationId,
  ): string {
    return `${organizationId}:${citationId}`;
  }

  private reviewKey(
    organizationId: OrganizationId,
    reviewId: CapaKnowledgeCitationReviewId,
  ): string {
    return `${organizationId}:${reviewId}`;
  }

  private clone<Value>(value: Value): Value {
    return structuredClone(value);
  }
}
