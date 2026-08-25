import type {
  ActorReference,
  IsoDateTime,
  OrganizationId,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import {
  CAPA_KNOWLEDGE_SOURCE_STATUSES,
  type CapaKnowledgeSourceStatus,
} from "./capa-knowledge-contract";

import type {
  CapaKnowledgeCitationId,
  CapaKnowledgeCitationRecord,
  CapaKnowledgeClaimId,
} from "./capa-knowledge-retrieval-contract";

/**
 * Human citation-review contract.
 *
 * Machine citation validation is evidence for review; it is never a human
 * disposition. No value in this module preselects acceptance.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * KUI-001 through KUI-010
 * CIT-001 through CIT-012
 * HRUI-E-005, HRUI-A-003 and HRUI-AT-007
 */

type CitationReviewId<Name extends string> =
  string & {
    readonly __brand: Name;
  };

export type CapaKnowledgeCitationReviewId =
  CitationReviewId<"CapaKnowledgeCitationReviewId">;

export const CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS = [
  "valid",
  "invalid",
  "insufficient",
  "wrong_source",
  "wrong_version",
  "wrong_locator",
  "not_applicable",
  "needs_expert_review",
] as const;

export type CapaKnowledgeCitationReviewDisposition =
  (typeof CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS)[number];

export const CAPA_KNOWLEDGE_CITATION_REVIEW_POLICY_VERSION =
  "capa-knowledge-citation-review-1.0.0" as
    ControlledVersion;

/**
 * One immutable, attributable human review event. Later reconsideration
 * creates another event; it never overwrites this record.
 */
export interface CapaKnowledgeCitationReviewRecord {
  readonly citation_review_id:
    CapaKnowledgeCitationReviewId;
  readonly organization_id:
    OrganizationId;
  readonly citation_id:
    CapaKnowledgeCitationId;
  readonly claim_id:
    CapaKnowledgeClaimId;
  readonly source_id:
    CapaKnowledgeCitationRecord["source_id"];
  readonly source_version_id:
    CapaKnowledgeCitationRecord["source_version_id"];
  readonly passage_id:
    CapaKnowledgeCitationRecord["passage_id"];
  readonly retrieval_run_id:
    CapaKnowledgeCitationRecord["retrieval_run_id"];
  readonly citation_validator_version:
    ControlledVersion;
  readonly machine_validation_status:
    CapaKnowledgeCitationRecord["validation_status"];
  readonly source_status_at_review:
    CapaKnowledgeSourceStatus;
  readonly disposition:
    CapaKnowledgeCitationReviewDisposition;
  readonly rationale: string;
  readonly requires_expert_review: boolean;
  readonly reviewed_at:
    IsoDateTime;
  readonly reviewed_by:
    ActorReference & {
      readonly actor_type: "human";
    };
  readonly review_policy_version:
    ControlledVersion;
}

export function isAcceptedCapaKnowledgeCitationReview(
  review: CapaKnowledgeCitationReviewRecord,
): boolean {
  return review.disposition === "valid";
}
