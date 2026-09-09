import type { CapaAiOutputId, CapaAiRunId, ControlledVersion } from "./capa-prompt-contract";
import type { CapaCaseVersionId, CapaSectionVersionId } from "../domain/capa-types";

export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT = "action_plan_review_advisory_draft" as const;
export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION = "capa_action_plan_review_advisory-1.0.0" as const;

export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_ASSESSMENTS = ["complete", "needs_attention", "insufficient_evidence"] as const;
export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_CATEGORIES = [
  "root_cause_coverage", "symptom_vs_root_cause", "action_specificity", "owner_completeness",
  "due_date_plausibility", "sequencing_dependencies", "deliverable_adequacy", "implementation_evidence",
  "unintended_consequence", "effectiveness_check", "acceptance_criteria", "regulatory_quality_linkage",
  "conflicting_duplicate_actions", "missing_rationale", "package_completeness",
] as const;
export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_DISPOSITIONS = ["approve", "return", "unable_to_recommend"] as const;

export type CapaActionPlanReviewAdvisoryAssessment = typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_ASSESSMENTS[number];
export type CapaActionPlanReviewAdvisoryCategory = typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_CATEGORIES[number];
export type CapaActionPlanReviewAdvisorySeverity = typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_SEVERITIES[number];
export type CapaActionPlanReviewAdvisoryDisposition = typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_DISPOSITIONS[number];

export interface CapaActionPlanReviewAdvisoryFinding {
  readonly finding_id: string;
  readonly category: CapaActionPlanReviewAdvisoryCategory;
  readonly severity: CapaActionPlanReviewAdvisorySeverity;
  readonly summary: string;
  readonly rationale: string;
  readonly affected_action_ids: readonly string[];
  readonly affected_root_cause_ids: readonly string[];
  readonly reference_keys: readonly string[];
  readonly suggested_reviewer_attention: string;
}

export interface CapaActionPlanReviewAdvisoryProposal {
  readonly overall_assessment: CapaActionPlanReviewAdvisoryAssessment;
  readonly findings: readonly CapaActionPlanReviewAdvisoryFinding[];
  readonly recommended_disposition: CapaActionPlanReviewAdvisoryDisposition;
  readonly limitations: readonly string[];
}

export interface RawCapaActionPlanReviewAdvisoryModelOutput {
  readonly schema_version: typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION;
  readonly status: "completed_draft";
  readonly source_case_version_id: CapaCaseVersionId;
  readonly action_plan_section_version_id: CapaSectionVersionId;
  readonly proposal: CapaActionPlanReviewAdvisoryProposal;
  readonly citations: readonly [];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly approval_claimed: false;
  readonly workflow_transition: null;
  readonly human_acceptance_required: true;
}

export interface CapaActionPlanReviewAdvisoryResponse extends RawCapaActionPlanReviewAdvisoryModelOutput {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version: ControlledVersion;
}
