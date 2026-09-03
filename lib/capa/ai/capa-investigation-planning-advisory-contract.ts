import type {
  CapaAiOutputId,
  CapaAiRunId,
  ControlledVersion,
} from "./capa-prompt-contract";

/**
 * Provider-neutral raw output contract for the advisory AG-PLAN operation.
 *
 * This is recommendation content only. It deliberately has no authoritative
 * plan item IDs, user IDs, dates, workflow fields, provenance, adoption or
 * release metadata. A later human-controlled draft adapter must create those
 * values through the existing S30 draft and G-03 boundaries.
 */

export const CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT =
  "investigation_plan_draft" as const;

/** Matches the registry's derived AG-PLAN capability schema version. */
export const CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION =
  "capa_investigation_plan_draft-1.0.0" as const;

export const CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS = [
  "investigation_questions",
  "evidence_requests",
  "method_suggestions",
  "dependencies",
  "proposed_owner_role",
  "gaps",
] as const;

/** Advisory-local only; never an authoritative investigation-plan ID. */
export type CapaInvestigationPlanAdvisoryProposalKey =
  string & {
    readonly __brand: "CapaInvestigationPlanAdvisoryProposalKey";
  };

export const CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS = [
  "scope",
  "evidence",
  "method",
  "dependency",
  "ownership",
  "schedule",
  "other",
] as const;

export type CapaInvestigationPlanAdvisoryAssumptionArea =
  (typeof CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS)[number];

export const CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES = [
  "insufficient_evidence",
  "missing_information",
  "unresolved_conflict",
  "scope_limitation",
  "sequencing_uncertainty",
  "ownership_uncertainty",
  "schedule_uncertainty",
  "unknown_status",
] as const;

export type CapaInvestigationPlanAdvisoryUncertaintyCategory =
  (typeof CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES)[number];

export interface CapaInvestigationPlanAdvisoryInvestigationQuestion {
  readonly proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly investigation_question: string;
  readonly scope_relationship: string;
  readonly due_date_consideration: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationPlanAdvisoryEvidenceRequest {
  readonly proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly evidence_target: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationPlanAdvisoryMethodSuggestion {
  readonly proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly investigation_method: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationPlanAdvisoryDependency {
  readonly dependent_proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly prerequisite_proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly sequencing_recommendation: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationPlanAdvisoryOwnerRole {
  readonly proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly proposed_owner_role: string;
  readonly suggested_sme_function: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationPlanAdvisoryGap {
  readonly gap: string;
  readonly human_review_question: string;
}

export interface CapaInvestigationPlanAdvisoryProposal {
  readonly investigation_questions:
    readonly CapaInvestigationPlanAdvisoryInvestigationQuestion[];
  readonly evidence_requests:
    readonly CapaInvestigationPlanAdvisoryEvidenceRequest[];
  readonly method_suggestions:
    readonly CapaInvestigationPlanAdvisoryMethodSuggestion[];
  readonly dependencies:
    readonly CapaInvestigationPlanAdvisoryDependency[];
  readonly proposed_owner_role:
    readonly CapaInvestigationPlanAdvisoryOwnerRole[];
  readonly gaps:
    readonly CapaInvestigationPlanAdvisoryGap[];
}

export interface CapaInvestigationPlanAdvisoryAssumption {
  readonly unverified: true;
  readonly related_area:
    CapaInvestigationPlanAdvisoryAssumptionArea;
  readonly verification_question: string;
}

export interface CapaInvestigationPlanAdvisoryUncertainty {
  readonly category:
    CapaInvestigationPlanAdvisoryUncertaintyCategory;
  readonly human_review_question: string;
}

/** Strictly validated, advisory-only raw model output. */
export interface RawCapaInvestigationPlanAdvisoryModelOutput {
  readonly proposal:
    CapaInvestigationPlanAdvisoryProposal;
  readonly assumptions:
    readonly CapaInvestigationPlanAdvisoryAssumption[];
  readonly uncertainty_and_limitations:
    readonly CapaInvestigationPlanAdvisoryUncertainty[];
  readonly citations: readonly [];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly human_acceptance_required: true;
}

export interface CapaInvestigationPlanAdvisoryResponse {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version: ControlledVersion;
  readonly status:
    | "completed_draft"
    | "validation_failed"
    | "service_failed";
  readonly proposal:
    CapaInvestigationPlanAdvisoryProposal | null;
  readonly assumptions:
    readonly CapaInvestigationPlanAdvisoryAssumption[];
  readonly uncertainty_and_limitations:
    readonly CapaInvestigationPlanAdvisoryUncertainty[];
  readonly citations: readonly unknown[];
  readonly warnings: readonly string[];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly human_acceptance_required: true;
}
