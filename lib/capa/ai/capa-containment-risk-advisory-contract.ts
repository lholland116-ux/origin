import type {
  CapaContainmentRiskContent,
} from "../domain/capa-containment-risk";

import type {
  CapaIntakeAdvisoryCitation,
  CapaIntakeAdvisoryStatus,
} from "./capa-intake-advisory-contract";

import type {
  CapaAiOutputId,
  CapaAiRunId,
  ControlledVersion,
} from "./capa-prompt-contract";

/** Browser-safe contract for advisory-only assistance on an S20 CAPA. */
export const CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT =
  "containment_risk_analysis" as const;

export const CAPA_CONTAINMENT_RISK_ADVISORY_PROPOSAL_FIELDS = [
  "missing_risk_inputs",
  "missing_impact_dimensions",
  "human_review_questions",
  "evidence_provenance_gaps",
] as const;

export const CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS = [
  "risk_method",
  "terminology_version",
  "risk_result_input",
  "rationale",
  "product_impact",
  "process_impact",
  "data_impact",
  "customer_impact",
  "patient_impact",
  "containment_evidence",
  "escalation_information",
  "other_missing_information",
] as const;

export type CapaContainmentRiskAdvisoryRiskInputTopic =
  (typeof CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS)[number];

export const CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS = [
  "product", "process", "data", "customer", "patient",
] as const;

export type CapaContainmentRiskAdvisoryImpactDimension =
  (typeof CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS)[number];

export const CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES = [
  "missing_evidence",
  "missing_provenance",
  "unverified_source",
  "contradictory_evidence",
  "insufficient_linkage",
] as const;

export type CapaContainmentRiskAdvisoryEvidenceGapCategory =
  (typeof CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES)[number];

export const CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS = [
  "containment", "impact", "risk", "evidence", "escalation", "other",
] as const;

export type CapaContainmentRiskAdvisoryAssumptionArea =
  (typeof CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS)[number];

export const CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES = [
  "insufficient_evidence",
  "missing_information",
  "unresolved_conflict",
  "scope_limitation",
  "unknown_status",
] as const;

export type CapaContainmentRiskAdvisoryUncertaintyCategory =
  (typeof CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES)[number];

export interface CapaContainmentRiskAdvisoryMissingRiskInput {
  readonly topic: CapaContainmentRiskAdvisoryRiskInputTopic;
  readonly human_review_question: string;
}

export interface CapaContainmentRiskAdvisoryMissingImpactDimension {
  readonly dimension: CapaContainmentRiskAdvisoryImpactDimension;
  readonly human_review_question: string;
}

export interface CapaContainmentRiskAdvisoryEvidenceGap {
  readonly category: CapaContainmentRiskAdvisoryEvidenceGapCategory;
  readonly human_review_question: string;
}

export interface CapaContainmentRiskAdvisoryUnverifiedAssumption {
  readonly unverified: true;
  readonly related_area: CapaContainmentRiskAdvisoryAssumptionArea;
  readonly verification_question: string;
}

export interface CapaContainmentRiskAdvisoryUncertainty {
  readonly category: CapaContainmentRiskAdvisoryUncertaintyCategory;
  readonly human_review_question: string;
}

export interface CapaContainmentRiskAdvisoryProposal {
  readonly missing_risk_inputs:
    readonly CapaContainmentRiskAdvisoryMissingRiskInput[];
  readonly missing_impact_dimensions:
    readonly CapaContainmentRiskAdvisoryMissingImpactDimension[];
  readonly human_review_questions: readonly string[];
  readonly evidence_provenance_gaps:
    readonly CapaContainmentRiskAdvisoryEvidenceGap[];
}

/** Strictly validated, advisory-only content returned by the model. */
export interface RawCapaContainmentRiskAdvisoryModelOutput {
  readonly proposal: CapaContainmentRiskAdvisoryProposal;
  readonly assumptions:
    readonly CapaContainmentRiskAdvisoryUnverifiedAssumption[];
  readonly uncertainty_and_limitations:
    readonly CapaContainmentRiskAdvisoryUncertainty[];
  readonly citations: readonly [];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly human_acceptance_required: true;
}

/**
 * Human-entered browser draft. Its name and type deliberately prevent it
 * from being confused with authoritative, repository-resolved case content.
 */
export interface CapaContainmentRiskAdvisoryUntrustedHumanDraft {
  readonly trust: "untrusted_human_draft";
  readonly content: CapaContainmentRiskContent;
}

export interface CapaContainmentRiskAdvisoryBrowserRequest {
  readonly focus?: string;
  readonly untrusted_human_draft?: unknown;
}

export interface CapaContainmentRiskAdvisoryRequest {
  readonly requested_output:
    typeof CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT;
  readonly focus: string | null;
  readonly untrusted_human_draft:
    CapaContainmentRiskAdvisoryUntrustedHumanDraft | null;
}

export interface CapaContainmentRiskAdvisoryResponse {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version: ControlledVersion;
  readonly status: CapaIntakeAdvisoryStatus;
  readonly proposal: CapaContainmentRiskAdvisoryProposal | null;
  /** Reserved for deterministic server construction; never raw model prose. */
  readonly containment_summary: readonly string[];
  readonly citations: readonly CapaIntakeAdvisoryCitation[];
  readonly assumptions:
    readonly CapaContainmentRiskAdvisoryUnverifiedAssumption[];
  readonly uncertainty_and_limitations:
    readonly CapaContainmentRiskAdvisoryUncertainty[];
  /** Server-owned operational warnings, not accepted from raw model output. */
  readonly warnings: readonly string[];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly human_acceptance_required: true;
}
