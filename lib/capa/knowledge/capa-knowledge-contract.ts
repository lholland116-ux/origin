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

/**
 * Provider-neutral governed CAPA knowledge vocabulary.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Supporting sources:
 * Document #8 — Data Model and Audit-Trail Specification
 * Document #9 — Security, Privacy, and Access-Control Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * KBG-001 through KBG-010
 * ING-001 through ING-006
 * SEG-001 through SEG-005
 * IDX-001 through IDX-010
 */

type KnowledgeId<Name extends string> =
  string & {
    readonly __brand: Name;
  };

export type CapaKnowledgeSourceId =
  KnowledgeId<"CapaKnowledgeSourceId">;
export type CapaKnowledgeSourceVersionId =
  KnowledgeId<"CapaKnowledgeSourceVersionId">;
export type CapaKnowledgeArtifactId =
  KnowledgeId<"CapaKnowledgeArtifactId">;
export type CapaKnowledgeDerivativeId =
  KnowledgeId<"CapaKnowledgeDerivativeId">;
export type CapaKnowledgePassageId =
  KnowledgeId<"CapaKnowledgePassageId">;
export type CapaKnowledgeCollectionId =
  KnowledgeId<"CapaKnowledgeCollectionId">;
export type CapaKnowledgeCollectionVersionId =
  KnowledgeId<"CapaKnowledgeCollectionVersionId">;
export type CapaKnowledgeIngestionId =
  KnowledgeId<"CapaKnowledgeIngestionId">;

export type CapaKnowledgeFingerprint =
  string & {
    readonly __brand:
      "CapaKnowledgeFingerprint";
  };

export const CAPA_KNOWLEDGE_VISIBILITIES = [
  "organization",
  "approved_global",
] as const;

export type CapaKnowledgeVisibility =
  (typeof CAPA_KNOWLEDGE_VISIBILITIES)[number];

export const CAPA_KNOWLEDGE_SOURCE_TYPES = [
  "SRC-01",
  "SRC-02",
  "SRC-03",
  "SRC-04",
  "SRC-05",
  "SRC-06",
  "SRC-07",
  "SRC-08",
  "SRC-09",
  "SRC-10",
] as const;

export type CapaKnowledgeSourceType =
  (typeof CAPA_KNOWLEDGE_SOURCE_TYPES)[number];

export const CAPA_KNOWLEDGE_SOURCE_STATUSES = [
  "draft",
  "current_effective",
  "future",
  "superseded",
  "withdrawn",
  "archived",
  "unverified",
  "blocked",
] as const;

export type CapaKnowledgeSourceStatus =
  (typeof CAPA_KNOWLEDGE_SOURCE_STATUSES)[number];

export const CAPA_KNOWLEDGE_RETRIEVAL_ELIGIBLE_STATUSES = [
  "current_effective",
] as const satisfies readonly CapaKnowledgeSourceStatus[];

export const CAPA_KNOWLEDGE_ONBOARDING_STAGES = [
  "registered",
  "quarantined",
  "identified",
  "verified",
  "assessed",
  "processed",
  "validated",
  "approved",
  "active",
] as const;

export type CapaKnowledgeOnboardingStage =
  (typeof CAPA_KNOWLEDGE_ONBOARDING_STAGES)[number];

export const CAPA_KNOWLEDGE_PROCESSING_STATUSES = [
  "pending",
  "running",
  "pass",
  "pass_with_limitations",
  "manual_review",
  "failed",
  "blocked",
] as const;

export type CapaKnowledgeProcessingStatus =
  (typeof CAPA_KNOWLEDGE_PROCESSING_STATUSES)[number];

export const CAPA_KNOWLEDGE_QUALITY_STATUSES = [
  "pass",
  "pass_with_limitations",
  "manual_review",
  "failed",
  "blocked",
] as const;

export type CapaKnowledgeQualityStatus =
  (typeof CAPA_KNOWLEDGE_QUALITY_STATUSES)[number];

export const CAPA_KNOWLEDGE_DERIVATIVE_KINDS = [
  "extracted_text",
  "ocr_text",
  "normalized_text",
] as const;

export type CapaKnowledgeDerivativeKind =
  (typeof CAPA_KNOWLEDGE_DERIVATIVE_KINDS)[number];

export const CAPA_KNOWLEDGE_LOCATOR_KINDS = [
  "page",
  "section",
  "paragraph",
  "table",
  "row",
  "sheet",
  "cell_range",
  "character_range",
] as const;

export type CapaKnowledgeLocatorKind =
  (typeof CAPA_KNOWLEDGE_LOCATOR_KINDS)[number];

export const CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHMS = [
  "sha256",
] as const;

export type CapaKnowledgeFingerprintAlgorithm =
  (typeof CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHMS)[number];

export interface CapaKnowledgeFingerprintRecord {
  readonly algorithm:
    CapaKnowledgeFingerprintAlgorithm;
  readonly value:
    CapaKnowledgeFingerprint;
}

export interface CapaKnowledgeAccessPolicy {
  readonly policy_version:
    ControlledVersion;
  readonly permitted_role_ids:
    readonly string[];
  readonly permitted_site_ids:
    readonly string[];
  readonly permitted_product_ids:
    readonly string[];
  readonly sensitivity:
    ControlledCode;
  readonly export_permitted: boolean;
  readonly excerpt_permitted: boolean;
  readonly redistribution_permitted:
    boolean;
}

/**
 * Stable source identity. Material content belongs to immutable versions,
 * not this mutable identity record.
 */
export interface CapaKnowledgeSource {
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly visibility:
    CapaKnowledgeVisibility;
  readonly organization_id?:
    OrganizationId;
  readonly current_source_version_id?:
    CapaKnowledgeSourceVersionId;
  readonly owner:
    ActorReference;
  readonly created_at:
    IsoDateTime;
  readonly created_by:
    ActorReference;
}

export interface CapaKnowledgeRights {
  readonly rights_classification:
    ControlledCode;
  readonly license_reference?: string;
  readonly retention_policy:
    ControlledCode;
  readonly legal_hold: boolean;
}

export interface CapaKnowledgeSourceVersion {
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly organization_id?:
    OrganizationId;
  readonly version_number: number;
  readonly source_type:
    CapaKnowledgeSourceType;
  readonly authority_class:
    ControlledCode;
  readonly title: string;
  readonly issuer: string;
  readonly publisher?: string;
  readonly jurisdiction: string;
  readonly region?: string;
  readonly document_number?: string;
  readonly edition?: string;
  readonly language: string;
  readonly translation_status:
    ControlledCode;
  readonly status:
    CapaKnowledgeSourceStatus;
  readonly publication_date?: string;
  readonly effective_at?:
    IsoDateTime;
  readonly retirement_at?:
    IsoDateTime;
  readonly supersedes_source_version_id?:
    CapaKnowledgeSourceVersionId;
  readonly superseded_by_source_version_id?:
    CapaKnowledgeSourceVersionId;
  readonly applicability_tags:
    readonly ControlledCode[];
  readonly origin:
    ControlledCode;
  readonly canonical_locator: string;
  readonly content_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly rights:
    CapaKnowledgeRights;
  readonly access_policy:
    CapaKnowledgeAccessPolicy;
  readonly onboarding_stage:
    CapaKnowledgeOnboardingStage;
  readonly processing_status:
    CapaKnowledgeProcessingStatus;
  readonly processing_version:
    ControlledVersion;
  readonly quality_status:
    CapaKnowledgeQualityStatus;
  readonly quality_notes:
    readonly string[];
  readonly next_review_at?:
    IsoDateTime;
  readonly approved_at?:
    IsoDateTime;
  readonly approved_by?:
    ActorReference;
  readonly activated_at?:
    IsoDateTime;
  readonly created_at:
    IsoDateTime;
  readonly created_by:
    ActorReference;
}

/** Immutable original bytes retained separately from all derivatives. */
export interface CapaKnowledgeOriginalArtifact {
  readonly artifact_id:
    CapaKnowledgeArtifactId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly organization_id?:
    OrganizationId;
  readonly media_type: string;
  readonly byte_length: number;
  readonly storage_reference: string;
  readonly fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly quarantined: true;
  readonly malware_scan_status:
    ControlledCode;
  readonly created_at:
    IsoDateTime;
}

export interface CapaKnowledgeDerivative {
  readonly derivative_id:
    CapaKnowledgeDerivativeId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly source_artifact_id:
    CapaKnowledgeArtifactId;
  readonly organization_id?:
    OrganizationId;
  readonly kind:
    CapaKnowledgeDerivativeKind;
  readonly engine:
    ControlledCode;
  readonly engine_version:
    ControlledVersion;
  readonly content: string;
  readonly fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly status:
    CapaKnowledgeProcessingStatus;
  readonly limitations:
    readonly string[];
  readonly created_at:
    IsoDateTime;
}

export interface CapaKnowledgePassageLocator {
  readonly kind:
    CapaKnowledgeLocatorKind;
  readonly label: string;
  readonly start?: number;
  readonly end?: number;
}

export interface CapaKnowledgePassage {
  readonly passage_id:
    CapaKnowledgePassageId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly derivative_id:
    CapaKnowledgeDerivativeId;
  readonly organization_id?:
    OrganizationId;
  readonly sequence_number: number;
  readonly segmentation_version:
    ControlledVersion;
  readonly content: string;
  readonly contextual_heading?: string;
  readonly locators:
    readonly CapaKnowledgePassageLocator[];
  readonly overlap_passage_ids:
    readonly CapaKnowledgePassageId[];
  readonly fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly quality_status:
    CapaKnowledgeQualityStatus;
  readonly machine_interpretable:
    boolean;
  readonly created_at:
    IsoDateTime;
}

export interface CapaKnowledgeCollectionVersion {
  readonly collection_id:
    CapaKnowledgeCollectionId;
  readonly collection_version_id:
    CapaKnowledgeCollectionVersionId;
  readonly organization_id?:
    OrganizationId;
  readonly version_number: number;
  readonly purpose: string;
  readonly audience:
    readonly ControlledCode[];
  readonly access_policy:
    CapaKnowledgeAccessPolicy;
  readonly source_version_ids:
    readonly CapaKnowledgeSourceVersionId[];
  readonly effective_at:
    IsoDateTime;
  readonly retired_at?:
    IsoDateTime;
  readonly approved_by:
    readonly ActorReference[];
  readonly created_at:
    IsoDateTime;
}

export const CAPA_KNOWLEDGE_INGESTION_REASON_CODES = [
  "INGESTION_ACCEPTED",
  "IDENTICAL_INPUT_ALREADY_REGISTERED",
  "SOURCE_VERSION_CONFLICT",
  "TENANT_SCOPE_DENIED",
  "INVALID_SOURCE_METADATA",
  "INVALID_MEDIA_TYPE",
  "SOURCE_TOO_LARGE",
  "MALWARE_SCAN_FAILED",
  "FINGERPRINT_MISMATCH",
  "PROCESSING_FAILED",
  "MANUAL_REVIEW_REQUIRED",
  "SOURCE_BLOCKED",
] as const;

export type CapaKnowledgeIngestionReasonCode =
  (typeof CAPA_KNOWLEDGE_INGESTION_REASON_CODES)[number];

export interface CapaKnowledgeIngestionReceipt {
  readonly ingestion_id:
    CapaKnowledgeIngestionId;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly organization_id?:
    OrganizationId;
  readonly request_trace:
    RequestTrace;
  readonly original_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly processing_version:
    ControlledVersion;
  readonly status:
    CapaKnowledgeProcessingStatus;
}

export function isCapaKnowledgeSourceStatusRetrievalEligible(
  status: CapaKnowledgeSourceStatus,
): boolean {
  return status ===
    "current_effective";
}
