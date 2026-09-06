import type {
  CapaAiOutputId,
  CapaAiRunId,
  ControlledVersion,
} from "./capa-prompt-contract";

/**
 * Provider-neutral raw output contract for the governed S50 Root Cause
 * Review Assistant (AG-REVIEW).
 *
 * This contract is advisory-only. It can organize submitted review material,
 * source-reported status, warnings and evidence relationships, but it cannot
 * create a root-cause determination, disposition, workflow transition or
 * controlled-record mutation.
 */

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT =
  "review_packet_draft" as const;

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION =
  "capa_review_packet_draft-1.0.0" as const;

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_PROPOSAL_FIELDS = [
  "neutral_review_summary",
  "version_changes",
  "blockers_warnings",
  "evidence_map",
] as const;

export type CapaRootCauseReviewAdvisoryReferenceKey =
  string & {
    readonly __brand: "CapaRootCauseReviewAdvisoryReferenceKey";
  };

export type CapaRootCauseReviewAdvisoryAuthoritativeIdentifier =
  string & {
    readonly __brand: "CapaRootCauseReviewAdvisoryAuthoritativeIdentifier";
  };

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES = [
  "added",
  "removed",
  "modified",
  "unchanged",
  "not_established",
] as const;

export type CapaRootCauseReviewAdvisoryChangeType =
  (typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES)[number];

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS = [
  "observed_issue",
  "review_warning",
  "authoritative_source_reported_blocker",
] as const;

export type CapaRootCauseReviewAdvisoryBlockerWarningKind =
  (typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS)[number];

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS = [
  "supports",
  "contradicts",
  "missing_support",
] as const;

export type CapaRootCauseReviewAdvisoryEvidenceRelationship =
  (typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS)[number];

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES = [
  "source_reported",
  "not_established",
  "not_provided",
] as const;

export type CapaRootCauseReviewAdvisorySourceStatus =
  (typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES)[number];

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES = [
  "insufficient_evidence",
  "conflicting_information",
  "missing_context",
  "unresolved_review_question",
  "source_status_uncertain",
  "version_comparison_unavailable",
  "other",
] as const;

export type CapaRootCauseReviewAdvisoryUncertaintyCategory =
  (typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES)[number];

export interface CapaRootCauseReviewAdvisoryVersionChange {
  readonly change_key: string;
  readonly subject: string;
  readonly change_type:
    CapaRootCauseReviewAdvisoryChangeType;
  readonly previous_value: string | null;
  readonly current_value: string | null;
  readonly authoritative_identifier:
    CapaRootCauseReviewAdvisoryAuthoritativeIdentifier | null;
  readonly reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly human_review_question: string;
}

export interface CapaRootCauseReviewAdvisoryBlockerWarning {
  readonly warning_key: string;
  readonly kind:
    CapaRootCauseReviewAdvisoryBlockerWarningKind;
  readonly subject: string;
  readonly description: string;
  readonly authoritative_identifier:
    CapaRootCauseReviewAdvisoryAuthoritativeIdentifier | null;
  readonly reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly human_review_question: string;
}

export interface CapaRootCauseReviewAdvisoryEvidenceMapEntry {
  readonly mapping_key: string;
  readonly subject: string;
  readonly relationship:
    CapaRootCauseReviewAdvisoryEvidenceRelationship;
  readonly description: string;
  readonly evidence_reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly source_status:
    CapaRootCauseReviewAdvisorySourceStatus;
  readonly authoritative_identifier:
    CapaRootCauseReviewAdvisoryAuthoritativeIdentifier | null;
  readonly human_review_question: string;
}

export interface CapaRootCauseReviewAdvisoryProposal {
  readonly neutral_review_summary: string;
  readonly version_changes:
    readonly CapaRootCauseReviewAdvisoryVersionChange[];
  readonly blockers_warnings:
    readonly CapaRootCauseReviewAdvisoryBlockerWarning[];
  readonly evidence_map:
    readonly CapaRootCauseReviewAdvisoryEvidenceMapEntry[];
}

export interface CapaRootCauseReviewAdvisoryUncertainty {
  readonly category:
    CapaRootCauseReviewAdvisoryUncertaintyCategory;
  readonly human_review_question: string;
}

/** Strictly validated, provider-neutral advisory output from the model. */
export interface RawCapaRootCauseReviewAdvisoryModelOutput {
  readonly schema_version:
    typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION;
  readonly status: "completed_draft";
  readonly proposal:
    CapaRootCauseReviewAdvisoryProposal;
  readonly uncertainty_and_limitations:
    readonly CapaRootCauseReviewAdvisoryUncertainty[];
  /** Raw-model citations are not authoritative; server construction owns them. */
  readonly citations: readonly [];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly review_disposition: null;
  readonly workflow_transition: null;
  readonly human_acceptance_required: true;
}

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_STATUSES = [
  "completed_draft",
  "validation_failed",
  "service_failed",
] as const;

export type CapaRootCauseReviewAdvisoryStatus =
  (typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_STATUSES)[number];

export interface CapaRootCauseReviewAdvisoryResponse {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version: ControlledVersion;
  readonly status: CapaRootCauseReviewAdvisoryStatus;
  readonly proposal:
    CapaRootCauseReviewAdvisoryProposal | null;
  readonly uncertainty_and_limitations:
    readonly CapaRootCauseReviewAdvisoryUncertainty[];
  readonly citations: readonly unknown[];
  readonly warnings: readonly string[];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly review_disposition: null;
  readonly workflow_transition: null;
  readonly human_acceptance_required: true;
}
