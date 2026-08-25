import type {
  ActorReference,
  IsoDateTime,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaKnowledgeCitationId,
  CapaKnowledgeCitationRecord,
} from "../../capa/knowledge/capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeCitationReviewId,
  CapaKnowledgeCitationReviewRecord,
} from "../../capa/knowledge/capa-knowledge-citation-review-contract";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Provider-neutral append-only citation and human-review persistence.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * CIT-001 through CIT-012
 * KUI-001 through KUI-010
 * INV-05, DATA-AC-003 and AISEC-006
 */

export interface CapaKnowledgeStoredCitation {
  readonly organization_id:
    OrganizationId;
  readonly citation:
    CapaKnowledgeCitationRecord;
  readonly claim_text: string;
  readonly recorded_at:
    IsoDateTime;
  readonly recorded_by:
    ActorReference;
}

export type AppendCapaKnowledgeCitationResult =
  | { readonly status: "appended" }
  | { readonly status: "already_recorded" }
  | {
      readonly status: "conflict";
      readonly reason_code:
        "CITATION_ID_REUSED_WITH_DIFFERENT_CONTENT";
    };

export type AppendCapaKnowledgeCitationReviewResult =
  | { readonly status: "appended" }
  | { readonly status: "already_recorded" }
  | {
      readonly status: "conflict";
      readonly reason_code:
        "CITATION_REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT";
    }
  | {
      readonly status: "citation_not_found_or_not_authorized";
    };

export interface CapaKnowledgeCitationReviewListQuery {
  readonly organization_id:
    OrganizationId;
  readonly citation_id:
    CapaKnowledgeCitationId;
  readonly limit: number;
  readonly after_review_id?:
    CapaKnowledgeCitationReviewId;
}

export interface CapaKnowledgeCitationReviewListPage {
  readonly reviews:
    readonly CapaKnowledgeCitationReviewRecord[];
  readonly next_review_id?:
    CapaKnowledgeCitationReviewId;
}

export interface CapaKnowledgeCitationReviewRepository {
  appendCitation(
    transaction: TransactionContext,
    citation: CapaKnowledgeStoredCitation,
  ): Promise<AppendCapaKnowledgeCitationResult>;

  findCitationById(
    organizationId: OrganizationId,
    citationId: CapaKnowledgeCitationId,
  ): Promise<CapaKnowledgeStoredCitation | null>;

  appendReview(
    transaction: TransactionContext,
    review: CapaKnowledgeCitationReviewRecord,
  ): Promise<AppendCapaKnowledgeCitationReviewResult>;

  findReviewById(
    organizationId: OrganizationId,
    reviewId: CapaKnowledgeCitationReviewId,
  ): Promise<CapaKnowledgeCitationReviewRecord | null>;

  listReviewsForCitation(
    query: CapaKnowledgeCitationReviewListQuery,
  ): Promise<CapaKnowledgeCitationReviewListPage>;
}

export class CapaKnowledgeCitationReviewRepositoryError
  extends Error {
  constructor(
    message =
      "The governed CAPA citation-review repository operation failed.",
  ) {
    super(message);
    this.name =
      "CapaKnowledgeCitationReviewRepositoryError";
  }
}
