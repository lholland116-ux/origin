import type {
  CapaAiOutputId,
  CapaAiRunId,
  ControlledVersion,
} from "./capa-prompt-contract";

/**
 * Provider-neutral raw output contract for governed S40 investigation analysis.
 *
 * This contract contains advisory content only. It deliberately excludes
 * authoritative ledger IDs, hypothesis IDs, user IDs, evidence-verification
 * status, causal disposition, workflow state, provenance, adoption metadata,
 * root-cause conclusions, and release/submission authority.
 *
 * Advisory-local proposal/reference keys are resolved through later
 * human-controlled adoption and authoritative S40 domain boundaries.
 */

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT =
  "investigation_analysis_draft" as const;

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION =
  "capa_investigation_analysis_draft-1.0.0" as const;

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS = [
  "evidence_gaps",
  "conflicting_information",
  "assumptions",
  "causal_hypotheses",
  "alternative_hypotheses",
  "investigation_recommendations",
] as const;

/** Advisory-local only; never an authoritative S40 object ID. */
export type CapaInvestigationActiveAdvisoryProposalKey =
  string & {
    readonly __brand: "CapaInvestigationActiveAdvisoryProposalKey";
  };

/**
 * Advisory-local reference into the controlled S40 context manifest.
 * It is never an authoritative ledger, section, hypothesis, or case ID.
 */
export type CapaInvestigationActiveAdvisoryReferenceKey =
  string & {
    readonly __brand: "CapaInvestigationActiveAdvisoryReferenceKey";
  };

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_SUGGESTED_CAUSAL_ROLES = [
  "possible_root_cause",
  "possible_contributing_factor",
] as const;

export type CapaInvestigationActiveAdvisorySuggestedCausalRole =
  (typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_SUGGESTED_CAUSAL_ROLES)[number];

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_UNCERTAINTY_CATEGORIES = [
  "insufficient_evidence",
  "conflicting_evidence",
  "unresolved_assumption",
  "missing_context",
  "causal_ambiguity",
  "alternative_not_excluded",
  "unknown_status",
] as const;

export type CapaInvestigationActiveAdvisoryUncertaintyCategory =
  (typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_UNCERTAINTY_CATEGORIES)[number];

export interface CapaInvestigationActiveAdvisoryEvidenceGap {
  readonly proposal_key: CapaInvestigationActiveAdvisoryProposalKey;
  readonly gap: string;
  readonly why_it_matters: string;
  readonly related_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly recommended_next_step: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationActiveAdvisoryConflict {
  readonly proposal_key: CapaInvestigationActiveAdvisoryProposalKey;
  readonly conflict: string;
  readonly conflicting_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly why_it_matters: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationActiveAdvisoryAssumption {
  readonly proposal_key: CapaInvestigationActiveAdvisoryProposalKey;
  readonly assumption: string;
  readonly related_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly verification_question: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationActiveAdvisoryCausalHypothesis {
  readonly proposal_key: CapaInvestigationActiveAdvisoryProposalKey;
  readonly hypothesis: string;
  readonly suggested_role:
    CapaInvestigationActiveAdvisorySuggestedCausalRole;
  readonly rationale: string;
  readonly supporting_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly contradictory_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly human_review_question: string;
}

export interface CapaInvestigationActiveAdvisoryAlternativeHypothesis {
  readonly proposal_key: CapaInvestigationActiveAdvisoryProposalKey;
  readonly hypothesis: string;
  readonly rationale: string;
  readonly supporting_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly contradictory_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly human_review_question: string;
}

export interface CapaInvestigationActiveAdvisoryRecommendation {
  readonly proposal_key: CapaInvestigationActiveAdvisoryProposalKey;
  readonly recommendation: string;
  readonly rationale: string;
  readonly related_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly human_review_question: string;
}

export interface CapaInvestigationActiveAdvisoryProposal {
  readonly evidence_gaps:
    readonly CapaInvestigationActiveAdvisoryEvidenceGap[];
  readonly conflicting_information:
    readonly CapaInvestigationActiveAdvisoryConflict[];
  readonly assumptions:
    readonly CapaInvestigationActiveAdvisoryAssumption[];
  readonly causal_hypotheses:
    readonly CapaInvestigationActiveAdvisoryCausalHypothesis[];
  readonly alternative_hypotheses:
    readonly CapaInvestigationActiveAdvisoryAlternativeHypothesis[];
  readonly investigation_recommendations:
    readonly CapaInvestigationActiveAdvisoryRecommendation[];
}

export interface CapaInvestigationActiveAdvisoryUncertainty {
  readonly category:
    CapaInvestigationActiveAdvisoryUncertaintyCategory;
  readonly human_review_question: string;
}

/** Strictly validated, advisory-only raw model output. */
export interface RawCapaInvestigationActiveAdvisoryModelOutput {
  readonly proposal: CapaInvestigationActiveAdvisoryProposal;
  readonly uncertainty_and_limitations:
    readonly CapaInvestigationActiveAdvisoryUncertainty[];
  readonly citations: readonly [];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly human_acceptance_required: true;
}

export interface CapaInvestigationActiveAdvisoryResponse {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version: ControlledVersion;
  readonly status:
    | "completed_draft"
    | "validation_failed"
    | "service_failed";
  readonly proposal:
    CapaInvestigationActiveAdvisoryProposal | null;
  readonly uncertainty_and_limitations:
    readonly CapaInvestigationActiveAdvisoryUncertainty[];
  readonly citations: readonly unknown[];
  readonly warnings: readonly string[];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly human_acceptance_required: true;
}
