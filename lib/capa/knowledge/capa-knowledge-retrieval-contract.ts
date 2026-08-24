import type {
  ActorReference,
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RequestTrace,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import type {
  CapaKnowledgeCollectionId,
  CapaKnowledgeCollectionVersionId,
  CapaKnowledgeFingerprintRecord,
  CapaKnowledgePassageId,
  CapaKnowledgePassageLocator,
  CapaKnowledgeQualityStatus,
  CapaKnowledgeSourceId,
  CapaKnowledgeSourceStatus,
  CapaKnowledgeSourceType,
  CapaKnowledgeSourceVersionId,
} from "./capa-knowledge-contract";

/**
 * Provider-neutral governed CAPA retrieval, evidence and citation contracts.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Supporting sources:
 * Document #7 — Agent Definition and Configuration Specification
 * Document #8 — Data Model and Audit-Trail Specification
 * Document #9 — Security, Privacy, and Access-Control Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * IDX-001 through IDX-010
 * RET-001 through RET-012
 * CIT-001 through CIT-012
 * KRC-AC-002 through KRC-AC-007
 */

type RetrievalId<Name extends string> =
  string & {
    readonly __brand: Name;
  };

export type CapaKnowledgeRetrievalRunId =
  RetrievalId<"CapaKnowledgeRetrievalRunId">;
export type CapaKnowledgeRetrievalQueryId =
  RetrievalId<"CapaKnowledgeRetrievalQueryId">;
export type CapaKnowledgeRetrievalCandidateId =
  RetrievalId<"CapaKnowledgeRetrievalCandidateId">;
export type CapaKnowledgeEvidenceId =
  RetrievalId<"CapaKnowledgeEvidenceId">;
export type CapaKnowledgeCitationId =
  RetrievalId<"CapaKnowledgeCitationId">;
export type CapaKnowledgeClaimId =
  RetrievalId<"CapaKnowledgeClaimId">;

export const CAPA_KNOWLEDGE_RETRIEVAL_OUTCOMES = [
  "complete",
  "no_result",
  "partial",
  "failure",
] as const;

export type CapaKnowledgeRetrievalOutcome =
  (typeof CAPA_KNOWLEDGE_RETRIEVAL_OUTCOMES)[number];

export const CAPA_KNOWLEDGE_RETRIEVAL_REASON_CODES = [
  "RETRIEVAL_COMPLETE",
  "NO_ELIGIBLE_RESULT",
  "FILTER_EXHAUSTED",
  "MINIMUM_EVIDENCE_NOT_MET",
  "TENANT_SCOPE_DENIED",
  "COLLECTION_NOT_FOUND_OR_NOT_AUTHORIZED",
  "COLLECTION_VERSION_NOT_ACTIVE",
  "SOURCE_NOT_ELIGIBLE",
  "PASSAGE_NOT_AUTHORIZED",
  "PASSAGE_NOT_AVAILABLE",
  "PARTIAL_INDEX",
  "RETRIEVAL_TIMEOUT",
  "RETRIEVAL_PROVIDER_FAILURE",
  "CANDIDATE_VALIDATION_FAILED",
  "RIGHTS_RESTRICTED",
] as const;

export type CapaKnowledgeRetrievalReasonCode =
  (typeof CAPA_KNOWLEDGE_RETRIEVAL_REASON_CODES)[number];

export const CAPA_KNOWLEDGE_RETRIEVAL_METHODS = [
  "lexical",
  "vector",
  "structured",
  "hybrid",
] as const;

export type CapaKnowledgeRetrievalMethod =
  (typeof CAPA_KNOWLEDGE_RETRIEVAL_METHODS)[number];

export const CAPA_KNOWLEDGE_CITATION_RELATIONSHIPS = [
  "supports",
  "contradicts",
  "defines",
  "contextualizes",
  "limits",
  "alternative",
] as const;

export type CapaKnowledgeCitationRelationship =
  (typeof CAPA_KNOWLEDGE_CITATION_RELATIONSHIPS)[number];

export const CAPA_KNOWLEDGE_CITATION_VALIDATION_STATUSES = [
  "valid",
  "invalid",
  "unresolved",
  "inaccessible",
  "superseded_impact",
  "rights_restricted",
] as const;

export type CapaKnowledgeCitationValidationStatus =
  (typeof CAPA_KNOWLEDGE_CITATION_VALIDATION_STATUSES)[number];

export const CAPA_KNOWLEDGE_CANDIDATE_EXCLUSION_REASONS = [
  "TENANT_SCOPE_MISMATCH",
  "ROLE_ACCESS_DENIED",
  "LICENSE_ACCESS_DENIED",
  "SENSITIVITY_ACCESS_DENIED",
  "SOURCE_STATUS_INELIGIBLE",
  "EFFECTIVITY_MISMATCH",
  "JURISDICTION_MISMATCH",
  "APPLICABILITY_MISMATCH",
  "COLLECTION_VERSION_MISMATCH",
  "PASSAGE_QUALITY_INELIGIBLE",
  "PASSAGE_NOT_MACHINE_INTERPRETABLE",
  "DUPLICATE_SOURCE_PASSAGE",
  "BELOW_MINIMUM_SCORE",
  "LOCATOR_VALIDATION_FAILED",
  "PASSAGE_UNAVAILABLE",
] as const;

export type CapaKnowledgeCandidateExclusionReason =
  (typeof CAPA_KNOWLEDGE_CANDIDATE_EXCLUSION_REASONS)[number];

/**
 * Exact authorization and collection scope resolved before retrieval.
 * Browser-controlled input must never supply this object directly.
 */
export interface CapaKnowledgeRetrievalScope {
  readonly organization_id:
    OrganizationId;
  readonly actor:
    ActorReference;
  readonly active_role_ids:
    readonly string[];
  readonly permitted_site_ids:
    readonly string[];
  readonly permitted_product_ids:
    readonly string[];
  readonly collection_id:
    CapaKnowledgeCollectionId;
  readonly collection_version_id:
    CapaKnowledgeCollectionVersionId;
  readonly approved_global_sources_permitted:
    boolean;
}

export interface CapaKnowledgeRetrievalFilters {
  readonly source_types?:
    readonly CapaKnowledgeSourceType[];
  readonly jurisdictions?:
    readonly string[];
  readonly applicability_tags?:
    readonly ControlledCode[];
  readonly effective_at:
    IsoDateTime;
  readonly historical_source_versions_permitted:
    boolean;
}

export interface CapaKnowledgeRetrievalPolicy {
  readonly retrieval_policy_version:
    ControlledVersion;
  readonly source_precedence_policy_version:
    ControlledVersion;
  readonly query_construction_version:
    ControlledVersion;
  readonly ranking_policy_version:
    ControlledVersion;
  readonly citation_policy_version:
    ControlledVersion;
  readonly retrieval_method:
    CapaKnowledgeRetrievalMethod;
  readonly maximum_candidates: number;
  readonly maximum_results: number;
  readonly maximum_total_characters: number;
  readonly minimum_relevance_score: number;
}

export interface CapaKnowledgeRetrievalRequest {
  readonly retrieval_run_id:
    CapaKnowledgeRetrievalRunId;
  readonly query_id:
    CapaKnowledgeRetrievalQueryId;
  readonly request_trace:
    RequestTrace;
  readonly scope:
    CapaKnowledgeRetrievalScope;
  readonly task_type:
    ControlledCode;
  readonly query_text: string;
  readonly query_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly filters:
    CapaKnowledgeRetrievalFilters;
  readonly policy:
    CapaKnowledgeRetrievalPolicy;
  readonly requested_at:
    IsoDateTime;
}

/**
 * Internal candidate metadata. Passage content may be attached only after
 * tenant, access, status, effectivity, collection and locator validation.
 */
export interface CapaKnowledgeRetrievalCandidate {
  readonly candidate_id:
    CapaKnowledgeRetrievalCandidateId;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly passage_id:
    CapaKnowledgePassageId;
  readonly source_type:
    CapaKnowledgeSourceType;
  readonly source_status:
    CapaKnowledgeSourceStatus;
  readonly quality_status:
    CapaKnowledgeQualityStatus;
  readonly raw_rank: number;
  readonly lexical_score?: number;
  readonly semantic_score?: number;
  readonly metadata_score?: number;
  readonly final_score?: number;
}

export type CapaKnowledgeCandidateDisposition =
  | {
      readonly disposition: "included";
      readonly final_rank: number;
    }
  | {
      readonly disposition: "excluded";
      readonly reason_code:
        CapaKnowledgeCandidateExclusionReason;
    };

export interface CapaKnowledgeCandidateTrace {
  readonly candidate:
    CapaKnowledgeRetrievalCandidate;
  readonly disposition:
    CapaKnowledgeCandidateDisposition;
}

/** Authorized, validated and bounded evidence safe for prompt assembly. */
export interface CapaKnowledgeEvidencePassage {
  readonly evidence_id:
    CapaKnowledgeEvidenceId;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly passage_id:
    CapaKnowledgePassageId;
  readonly source_type:
    CapaKnowledgeSourceType;
  readonly source_status_at_use:
    CapaKnowledgeSourceStatus;
  readonly title: string;
  readonly issuer: string;
  readonly jurisdiction: string;
  readonly edition?: string;
  readonly document_number?: string;
  readonly applicability_tags:
    readonly ControlledCode[];
  readonly segmentation_version:
    ControlledVersion;
  readonly passage_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly locators:
    readonly CapaKnowledgePassageLocator[];
  readonly content: string;
  readonly limitations:
    readonly string[];
  readonly rank: number;
  readonly relevance_score: number;
}

export interface CapaKnowledgeCitationRecord {
  readonly citation_id:
    CapaKnowledgeCitationId;
  readonly claim_id:
    CapaKnowledgeClaimId;
  readonly evidence_id:
    CapaKnowledgeEvidenceId;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly passage_id:
    CapaKnowledgePassageId;
  readonly segmentation_version:
    ControlledVersion;
  readonly locators:
    readonly CapaKnowledgePassageLocator[];
  readonly quoted_text_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly relationship:
    CapaKnowledgeCitationRelationship;
  readonly retrieval_run_id:
    CapaKnowledgeRetrievalRunId;
  readonly retrieval_rank: number;
  readonly source_status_at_use:
    CapaKnowledgeSourceStatus;
  readonly validation_status:
    CapaKnowledgeCitationValidationStatus;
  readonly validator_version:
    ControlledVersion;
  readonly validated_at:
    IsoDateTime;
  readonly validated_by:
    ActorReference;
  readonly rendered_label: string;
}

export interface CapaKnowledgeEvidencePackage {
  readonly retrieval_run_id:
    CapaKnowledgeRetrievalRunId;
  readonly collection_version_id:
    CapaKnowledgeCollectionVersionId;
  readonly outcome:
    CapaKnowledgeRetrievalOutcome;
  readonly reason_code:
    CapaKnowledgeRetrievalReasonCode;
  readonly passages:
    readonly CapaKnowledgeEvidencePassage[];
  readonly candidate_trace:
    readonly CapaKnowledgeCandidateTrace[];
  readonly warnings:
    readonly string[];
  readonly completed_at:
    IsoDateTime;
}

export function isCapaKnowledgeRetrievalUsable(
  outcome: CapaKnowledgeRetrievalOutcome,
): boolean {
  return outcome === "complete" ||
    outcome === "partial";
}
