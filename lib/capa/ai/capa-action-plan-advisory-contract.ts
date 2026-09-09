import type { CapaAiOutputId, CapaAiRunId, ControlledVersion } from "./capa-prompt-contract";
import type { CapaActionPlanContent } from "../domain/capa-action-plan";

export const CAPA_ACTION_PLAN_ADVISORY_OUTPUT = "action_plan_advisory_draft" as const;
export const CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION = "capa_action_plan_advisory-1.0.0" as const;

export interface CapaActionPlanAdvisorySuggestion {
  readonly suggestion_key: string;
  readonly action_item_id: string | null;
  readonly issue: string;
  readonly recommendation: string;
  readonly rationale: string;
  readonly reference_keys: readonly string[];
  readonly human_review_question: string;
}

export interface CapaActionPlanAdvisoryCompletenessConcern {
  readonly concern_key: string;
  readonly subject: string;
  readonly description: string;
  readonly reference_keys: readonly string[];
  readonly human_review_question: string;
}

export interface CapaActionPlanAdvisoryEffectivenessSuggestion {
  readonly suggestion_key: string;
  readonly action_item_id: string | null;
  readonly recommendation: string;
  readonly rationale: string;
  readonly reference_keys: readonly string[];
  readonly human_review_question: string;
}

export interface CapaActionPlanAdvisoryProposal {
  readonly advisory_summary: string;
  readonly completeness_linkage_concerns: readonly CapaActionPlanAdvisoryCompletenessConcern[];
  readonly action_improvements: readonly CapaActionPlanAdvisorySuggestion[];
  readonly effectiveness_planning_improvements: readonly CapaActionPlanAdvisoryEffectivenessSuggestion[];
  readonly proposed_action_plan: CapaActionPlanContent | null;
}

export interface RawCapaActionPlanAdvisoryModelOutput {
  readonly schema_version: typeof CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION;
  readonly status: "completed_draft";
  readonly proposal: CapaActionPlanAdvisoryProposal;
  readonly warnings: readonly string[];
  readonly uncertainty_and_limitations: readonly string[];
  readonly citations: readonly [];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly approval_claimed: false;
  readonly workflow_transition: null;
  readonly human_acceptance_required: true;
}

export interface CapaActionPlanAdvisoryResponse {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version: ControlledVersion;
  readonly status: "completed_draft";
  readonly proposal: CapaActionPlanAdvisoryProposal;
  readonly warnings: readonly string[];
  readonly uncertainty_and_limitations: readonly string[];
  readonly citations: readonly unknown[];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly approval_claimed: false;
  readonly workflow_transition: null;
  readonly human_acceptance_required: true;
}
