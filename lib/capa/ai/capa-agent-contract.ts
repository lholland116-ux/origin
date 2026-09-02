import type {
  ControlledCode,
  RoleId,
} from "../domain/capa-types";

import type {
  CapaStateId,
} from "../domain/capa-state";

import type {
  CapaAgentId,
  ControlledVersion,
} from "./capa-prompt-contract";

/**
 * Provider-neutral controlled CAPA agent and tool vocabulary.
 *
 * Primary source:
 * Document #7 — Agent Definition and Configuration Specification
 *
 * Traceability:
 * BL-065, BL-067, BL-068, BL-069
 * AG-AC-001 through AG-AC-007
 * P-01 through P-04
 */

export const CAPA_AGENT_IDS = [
  "AG-CAPA-ORCH",
  "AG-INTAKE",
  "AG-PLAN",
  "AG-EVID",
  "AG-RCA",
  "AG-ACTION",
  "AG-IMPLEMENT",
  "AG-EFFECT",
  "AG-REVIEW",
  "AG-REPORT",
  "AG-REOPEN",
] as const;

export type RegisteredCapaAgentId =
  (typeof CAPA_AGENT_IDS)[number];

export const CAPA_AGENT_STATUSES = [
  "draft",
  "evaluation",
  "approved",
  "retired",
  "blocked",
] as const;

export type CapaAgentStatus =
  (typeof CAPA_AGENT_STATUSES)[number];

export const CAPA_AGENT_OPERATIONS = [
  "orchestrate_assistance",
  "draft_intake_analysis",
  "analyze_containment_impact_risk",
  "draft_investigation_plan",
  "analyze_evidence",
  "facilitate_root_cause",
  "draft_action_plan",
  "review_implementation_evidence",
  "analyze_effectiveness",
  "assemble_review_packet",
  "assemble_report_draft",
  "assess_reopening_impact",
] as const;

export type CapaAgentOperation =
  (typeof CAPA_AGENT_OPERATIONS)[number];

export const CAPA_AGENT_TOOL_IDS = [
  "TOOL-CASE-READ",
  "TOOL-EVIDENCE-READ",
  "TOOL-RETRIEVE",
  "TOOL-STRUCTURED-DRAFT",
  "TOOL-FILE-EXTRACT-READ",
  "TOOL-CALCULATE",
  "TOOL-REPORT-DRAFT",
  "TOOL-FEEDBACK",
] as const;

export type CapaAgentToolId =
  (typeof CAPA_AGENT_TOOL_IDS)[number];

export const CAPA_AGENT_PROHIBITIONS = [
  "SET_REVIEW_DISPOSITION",
  "APPROVE_GATE",
  "TRANSITION_WORKFLOW",
  "CLOSE_CASE",
  "CANCEL_CASE",
  "REOPEN_CASE",
  "CHOOSE_REENTRY",
  "DETERMINE_PRODUCT_RELEASE",
  "DETERMINE_PATIENT_TREATMENT",
  "DETERMINE_RECALL_OR_FIELD_ACTION",
  "DETERMINE_REGULATORY_REPORTABILITY",
  "SUBMIT_EXTERNALLY",
  "SEND_AUTHORITY_COMMUNICATION",
  "SEND_CUSTOMER_COMMUNICATION",
  "SIGN_CONTROLLED_RECORD",
] as const;

export type CapaAgentProhibition =
  (typeof CAPA_AGENT_PROHIBITIONS)[number];

export const CAPA_AGENT_OUTPUT_FIELDS = [
  "problem_statement_draft",
  "scope_dimensions",
  "missing_dimensions",
  "containment_risk_questions",
  "assumptions",
  "investigation_questions",
  "evidence_requests",
  "method_suggestions",
  "dependencies",
  "proposed_owner_role",
  "gaps",
  "item_summaries",
  "proposed_classes",
  "provenance_gaps",
  "support_links",
  "contradiction_links",
  "source_status_warnings",
  "hypotheses",
  "why_chain",
  "contributing_factors",
  "alternatives",
  "falsification_questions",
  "unresolved_gaps",
  "cause_action_links",
  "action_drafts",
  "deliverables",
  "unintended_consequence_questions",
  "implementation_evidence",
  "effectiveness_criteria",
  "baseline_comparison",
  "evidence_coverage",
  "deviations",
  "missing_deliverables",
  "review_questions",
  "criterion_result_comparison",
  "timing_check",
  "unmet_criteria",
  "uncertainty",
  "follow_up_questions",
  "neutral_review_summary",
  "version_changes",
  "blockers_warnings",
  "evidence_map",
  "section_drafts",
  "status_labels",
  "citations",
  "missing_not_applicable_markers",
  "snapshot_template_identity",
  "trigger_summary",
  "affected_objects_gates",
  "immediate_assessment_questions",
  "possible_reentry_options",
] as const;

export type CapaAgentOutputField =
  (typeof CAPA_AGENT_OUTPUT_FIELDS)[number];

export interface CapaAgentActivationCapability {
  readonly eligible_states: readonly CapaStateId[];
  readonly operation: CapaAgentOperation;
  readonly allowed_tools: readonly CapaAgentToolId[];
  readonly output_schema_version: ControlledVersion;
}

export interface CapaAgentDefinition {
  readonly agent_id: CapaAgentId;
  readonly logical_agent_id:
    RegisteredCapaAgentId;
  readonly name: string;
  readonly agent_version: ControlledVersion;
  readonly status: CapaAgentStatus;
  readonly purpose: string;
  readonly eligible_states:
    readonly CapaStateId[];
  readonly terminal_read_only: boolean;
  readonly allowed_operations:
    readonly CapaAgentOperation[];
  readonly allowed_requester_roles:
    readonly RoleId[];
  readonly allowed_tools:
    readonly CapaAgentToolId[];
  readonly output_type: ControlledCode;
  readonly output_schema_version:
    ControlledVersion;
  readonly required_output_fields:
    readonly CapaAgentOutputField[];
  readonly prohibitions:
    readonly CapaAgentProhibition[];
  readonly system_policy_version:
    ControlledVersion;
  readonly instruction_template_version:
    ControlledVersion;
  readonly model_profile_version:
    ControlledVersion;
  readonly evaluation_suite_version:
    ControlledVersion;
  readonly activation_capabilities:
    readonly CapaAgentActivationCapability[];
}

export interface CapaAgentRegistrySnapshot {
  readonly registry_version:
    ControlledVersion;
  readonly agents:
    ReadonlyMap<
      RegisteredCapaAgentId,
      CapaAgentDefinition
    >;
}

/**
 * Request facts are derived by trusted server code. Browser-provided role,
 * organization, state, operation, tool or version claims are not
 * authoritative inputs to eligibility.
 */
export interface CapaAgentEligibilityRequest {
  readonly agent_id:
    RegisteredCapaAgentId;
  readonly agent_version:
    ControlledVersion;
  readonly workflow_state:
    CapaStateId;
  readonly operation:
    CapaAgentOperation;
  readonly active_role_ids:
    readonly RoleId[];
  readonly requested_tool_ids:
    readonly CapaAgentToolId[];
  readonly output_schema_version:
    ControlledVersion;
}

export type CapaAgentEligibilityReasonCode =
  | "AGENT_ELIGIBLE"
  | "AGENT_NOT_FOUND"
  | "AGENT_VERSION_NOT_APPROVED"
  | "AGENT_BLOCKED_OR_RETIRED"
  | "WORKFLOW_STATE_NOT_ELIGIBLE"
  | "OPERATION_NOT_ELIGIBLE"
  | "REQUESTER_ROLE_NOT_ELIGIBLE"
  | "TOOL_NOT_ALLOWED"
  | "OUTPUT_SCHEMA_MISMATCH";

export type CapaAgentEligibilityDecision =
  | {
      readonly eligible: true;
      readonly reason_code:
        "AGENT_ELIGIBLE";
      readonly definition:
        CapaAgentDefinition;
    }
  | {
      readonly eligible: false;
      readonly reason_code:
        Exclude<
          CapaAgentEligibilityReasonCode,
          "AGENT_ELIGIBLE"
        >;
    };
