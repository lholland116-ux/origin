import type {
  RoleId,
} from "../domain/capa-types";

import type {
  CapaStateId,
} from "../domain/capa-state";

import {
  CAPA_AGENT_IDS,
  CAPA_AGENT_PROHIBITIONS,
  type CapaAgentDefinition,
  type CapaAgentActivationCapability,
  type CapaAgentOperation,
  type CapaAgentOutputField,
  type CapaAgentStatus,
  type CapaAgentToolId,
  type RegisteredCapaAgentId,
} from "./capa-agent-contract";

/**
 * Immutable initial CAPA logical-agent registry.
 *
 * Primary source:
 * Document #7 — Agent Definition and Configuration Specification
 *
 * Traceability:
 * BL-065, BL-067, BL-068, BL-069
 * AG-AC-001, AG-AC-003, AG-AC-006
 */

const OWNER = "CAPA_OWNER" as RoleId;
const CONTRIBUTOR =
  "CAPA_CONTRIBUTOR" as RoleId;
const REVIEWER =
  "CAPA_REVIEWER" as RoleId;
const APPROVER =
  "CAPA_APPROVER" as RoleId;
const AUDITOR =
  "CAPA_AUDITOR" as RoleId;

const ALL_ACTIVE_STATES = [
  "S00", "S10", "S20", "S30",
  "S40", "S50", "S60", "S70",
  "S80", "S90", "S100", "S110",
  "S120", "S150",
] as const satisfies readonly CapaStateId[];

const CASE_WORK_ROLES = [
  OWNER,
  CONTRIBUTOR,
] as const;

const CASE_REVIEW_ROLES = [
  REVIEWER,
  APPROVER,
] as const;

const CASE_READ_ROLES = [
  OWNER,
  CONTRIBUTOR,
  REVIEWER,
  APPROVER,
  AUDITOR,
] as const;

interface DefinitionInput {
  readonly agent_id:
    RegisteredCapaAgentId;
  readonly name: string;
  readonly version: string;
  readonly status: CapaAgentStatus;
  readonly purpose: string;
  readonly states: readonly CapaStateId[];
  readonly terminal_read_only?: boolean;
  readonly operation: CapaAgentOperation;
  readonly roles: readonly RoleId[];
  readonly tools: readonly CapaAgentToolId[];
  readonly output_type: string;
  readonly output_schema_version?: string;
  readonly output_fields:
    readonly CapaAgentOutputField[];
  readonly activation_capabilities?: readonly CapaAgentActivationCapability[];
}

function definition(
  input: DefinitionInput,
): CapaAgentDefinition {
  const activationCapabilities = input.activation_capabilities ?? [{ eligible_states: input.states, operation: input.operation, allowed_tools: input.tools, output_schema_version: (input.output_schema_version ?? `${input.output_type.toLowerCase()}-1.0.0`) as never }];
  const frozenCapabilities = Object.freeze(activationCapabilities.map((capability) => Object.freeze({ eligible_states: Object.freeze([...capability.eligible_states]), operation: capability.operation, allowed_tools: Object.freeze([...capability.allowed_tools]), output_schema_version: capability.output_schema_version })));
  return Object.freeze({
    agent_id: input.agent_id as never,
    logical_agent_id: input.agent_id,
    name: input.name,
    agent_version:
      input.version as never,
    status: input.status,
    purpose: input.purpose,
    eligible_states:
      Object.freeze([...input.states]),
    terminal_read_only:
      input.terminal_read_only ?? false,
    allowed_operations:
      Object.freeze([
        input.operation,
      ]),
    allowed_requester_roles:
      Object.freeze([...input.roles]),
    allowed_tools:
      Object.freeze([...input.tools]),
    output_type:
      input.output_type as never,
    output_schema_version:
      (
        input.output_schema_version ??
        `${input.output_type.toLowerCase()}-1.0.0`
      ) as never,
    required_output_fields:
      Object.freeze([
        ...input.output_fields,
      ]),
    prohibitions:
      CAPA_AGENT_PROHIBITIONS,
    system_policy_version:
      "capa-platform-policy-1.0.0" as never,
    instruction_template_version:
      input.version as never,
    model_profile_version:
      "capa-model-profile-1.0.0" as never,
    evaluation_suite_version:
      "capa-ai-evaluation-1.0.0" as never,
    activation_capabilities: frozenCapabilities,
  });
}

const DEFINITIONS = [
  definition({
    agent_id: "AG-CAPA-ORCH",
    name: "CAPA Workflow Orchestrator",
    version: "ag-capa-orch-1.0.0",
    status: "evaluation",
    purpose:
      "Route an authorized request to one eligible specialist and validate or label its output.",
    states: ALL_ACTIVE_STATES,
    terminal_read_only: true,
    operation: "orchestrate_assistance",
    roles: CASE_READ_ROLES,
    tools: [
      "TOOL-CASE-READ",
      "TOOL-FEEDBACK",
    ],
    output_type: "CAPA_ORCHESTRATION_DRAFT",
    output_fields: [
      "gaps",
      "assumptions",
      "uncertainty",
    ],
  }),
  definition({
    agent_id: "AG-INTAKE",
    name:
      "Intake and Problem Definition Guide",
    version: "ag-intake-1.0.0",
    status: "approved",
    purpose:
      "Clarify the initiating event, scope, extent, problem statement and containment or risk questions.",
    states: ["S00", "S10", "S20"],
    operation: "draft_intake_analysis",
    roles: CASE_WORK_ROLES,
    tools: [
      "TOOL-CASE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FEEDBACK",
    ],
    output_type: "CAPA_INTAKE_DRAFT",
    output_schema_version:
      "capa-intake-draft-output-1.0.0",
    output_fields: [
      "problem_statement_draft",
      "scope_dimensions",
      "missing_dimensions",
      "containment_risk_questions",
      "assumptions",
    ],
    activation_capabilities: [
      { eligible_states: ["S00", "S10"], operation: "draft_intake_analysis", allowed_tools: ["TOOL-CASE-READ", "TOOL-RETRIEVE", "TOOL-STRUCTURED-DRAFT", "TOOL-FEEDBACK"], output_schema_version: "capa-intake-draft-output-1.0.0" as never },
      { eligible_states: ["S20"], operation: "analyze_containment_impact_risk", allowed_tools: ["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"], output_schema_version: "capa-containment-risk-advisory-1.0.0" as never },
    ],
  }),
  definition({
    agent_id: "AG-PLAN",
    name: "Investigation Planner",
    version: "ag-plan-1.0.0",
    status: "approved",
    purpose:
      "Propose investigation questions, evidence needs, methods, owners, dependencies and due-date prompts.",
    states: ["S30"],
    operation: "draft_investigation_plan",
    roles: CASE_WORK_ROLES,
    tools: [
      "TOOL-CASE-READ",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_INVESTIGATION_PLAN_DRAFT",
    output_fields: [
      "investigation_questions",
      "evidence_requests",
      "method_suggestions",
      "dependencies",
      "proposed_owner_role",
      "gaps",
    ],
  }),
  definition({
    agent_id: "AG-EVID",
    name: "Evidence Analyst",
    version: "ag-evid-1.0.0",
    status: "evaluation",
    purpose:
      "Classify proposed evidence items and expose provenance, support, contradiction, gaps and assumptions.",
    states: [
      "S10", "S20", "S30", "S40",
      "S50", "S60", "S70", "S80",
      "S90", "S100", "S110", "S120",
      "S130", "S140", "S150",
    ],
    terminal_read_only: true,
    operation: "analyze_evidence",
    roles: CASE_READ_ROLES,
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FILE-EXTRACT-READ",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_EVIDENCE_ANALYSIS_DRAFT",
    output_fields: [
      "item_summaries",
      "proposed_classes",
      "provenance_gaps",
      "support_links",
      "contradiction_links",
      "source_status_warnings",
    ],
  }),
  definition({
    agent_id: "AG-RCA",
    name: "Root Cause Facilitator",
    version: "ag-rca-1.0.0",
    status: "evaluation",
    purpose:
      "Facilitate causal analysis and propose testable hypotheses, contributing factors and alternatives.",
    states: ["S40", "S50"],
    operation: "facilitate_root_cause",
    roles: [
      ...CASE_WORK_ROLES,
      ...CASE_REVIEW_ROLES,
    ],
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_ROOT_CAUSE_DRAFT",
    output_fields: [
      "hypotheses",
      "why_chain",
      "contributing_factors",
      "support_links",
      "contradiction_links",
      "alternatives",
      "falsification_questions",
      "unresolved_gaps",
    ],
  }),
  definition({
    agent_id: "AG-ACTION",
    name: "CAPA Action Planner",
    version: "ag-action-1.0.0",
    status: "evaluation",
    purpose:
      "Draft cause-linked actions, deliverables, risks, evidence needs and measurable effectiveness criteria.",
    states: ["S60", "S70"],
    operation: "draft_action_plan",
    roles: CASE_WORK_ROLES,
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_ACTION_PLAN_DRAFT",
    output_fields: [
      "cause_action_links",
      "action_drafts",
      "deliverables",
      "unintended_consequence_questions",
      "implementation_evidence",
      "effectiveness_criteria",
    ],
  }),
  definition({
    agent_id: "AG-IMPLEMENT",
    name:
      "Implementation Evidence Reviewer",
    version: "ag-implement-1.0.0",
    status: "evaluation",
    purpose:
      "Compare implementation claims and evidence with the approved action baseline and identify gaps or deviations.",
    states: ["S80", "S90"],
    operation:
      "review_implementation_evidence",
    roles: [
      ...CASE_WORK_ROLES,
      ...CASE_REVIEW_ROLES,
    ],
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FILE-EXTRACT-READ",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_IMPLEMENTATION_REVIEW_DRAFT",
    output_fields: [
      "baseline_comparison",
      "evidence_coverage",
      "deviations",
      "missing_deliverables",
      "review_questions",
    ],
  }),
  definition({
    agent_id: "AG-EFFECT",
    name: "Effectiveness Analyst",
    version: "ag-effect-1.0.0",
    status: "evaluation",
    purpose:
      "Compare results with preapproved criteria and timing and identify insufficiency, uncertainty and follow-up questions.",
    states: ["S100", "S110"],
    operation: "analyze_effectiveness",
    roles: [
      ...CASE_WORK_ROLES,
      ...CASE_REVIEW_ROLES,
    ],
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-CALCULATE",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_EFFECTIVENESS_ANALYSIS_DRAFT",
    output_fields: [
      "criterion_result_comparison",
      "timing_check",
      "evidence_coverage",
      "unmet_criteria",
      "uncertainty",
      "follow_up_questions",
    ],
  }),
  definition({
    agent_id: "AG-REVIEW",
    name: "Human Review Assistant",
    version: "ag-review-1.0.0",
    status: "evaluation",
    purpose:
      "Build neutral review packets, version comparisons, blockers and evidence maps without recommending disposition.",
    states: [
      "S50", "S70", "S90",
      "S110", "S120", "S150",
    ],
    operation: "assemble_review_packet",
    roles: CASE_REVIEW_ROLES,
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_REVIEW_PACKET_DRAFT",
    output_fields: [
      "neutral_review_summary",
      "version_changes",
      "blockers_warnings",
      "evidence_map",
    ],
  }),
  definition({
    agent_id: "AG-REPORT",
    name: "CAPA Report Assembler",
    version: "ag-report-1.0.0",
    status: "evaluation",
    purpose:
      "Create a structured draft report from an authoritative snapshot with citations, versions and missing-content labels.",
    states: ["S120", "S130", "S140"],
    terminal_read_only: true,
    operation: "assemble_report_draft",
    roles: [
      OWNER,
      REVIEWER,
      APPROVER,
      AUDITOR,
    ],
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-REPORT-DRAFT",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_REPORT_DRAFT",
    output_fields: [
      "section_drafts",
      "status_labels",
      "citations",
      "missing_not_applicable_markers",
      "snapshot_template_identity",
    ],
  }),
  definition({
    agent_id: "AG-REOPEN",
    name: "Reopening Impact Assistant",
    version: "ag-reopen-1.0.0",
    status: "evaluation",
    purpose:
      "Summarize a reopening trigger, map affected conclusions or approvals and propose human decision options.",
    states: ["S130", "S150"],
    terminal_read_only: true,
    operation: "assess_reopening_impact",
    roles: [
      OWNER,
      REVIEWER,
      APPROVER,
    ],
    tools: [
      "TOOL-CASE-READ",
      "TOOL-EVIDENCE-READ",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FILE-EXTRACT-READ",
      "TOOL-FEEDBACK",
    ],
    output_type:
      "CAPA_REOPENING_IMPACT_DRAFT",
    output_fields: [
      "trigger_summary",
      "affected_objects_gates",
      "immediate_assessment_questions",
      "possible_reentry_options",
    ],
  }),
] as const;

export interface CapaAgentRegistry {
  readonly registry_version: string;

  listAgentIds():
    readonly RegisteredCapaAgentId[];

  findExact(
    agentId: RegisteredCapaAgentId,
    agentVersion: string,
  ): CapaAgentDefinition | null;
}

class InitialCapaAgentRegistry
  implements CapaAgentRegistry {
  readonly registry_version =
    "capa-agent-registry-1.0.0";

  private readonly byAgentId =
    new Map(
      DEFINITIONS.map((item) => [
        item.logical_agent_id,
        item,
      ]),
    );

  listAgentIds():
    readonly RegisteredCapaAgentId[] {
    return CAPA_AGENT_IDS;
  }

  findExact(
    agentId: RegisteredCapaAgentId,
    agentVersion: string,
  ): CapaAgentDefinition | null {
    const item =
      this.byAgentId.get(agentId);

    if (
      item === undefined ||
      item.agent_version !==
        agentVersion
    ) {
      return null;
    }

    return item;
  }
}

/** Creates the immutable initial logical-agent registry boundary. */
export function createInitialCapaAgentRegistry():
  CapaAgentRegistry {
  return Object.freeze(
    new InitialCapaAgentRegistry(),
  );
}
