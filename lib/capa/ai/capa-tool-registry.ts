import type {
  CapaStateId,
} from "../domain/capa-state";

import {
  CAPA_AGENT_IDS,
  CAPA_AGENT_OPERATIONS,
  CAPA_AGENT_TOOL_IDS,
  type CapaAgentOperation,
  type RegisteredCapaAgentId,
} from "./capa-agent-contract";

import type {
  CapaToolCapabilityClass,
  CapaToolDataClass,
  CapaToolDefinition,
  CapaToolStatus,
} from "./capa-tool-contract";

/**
 * Immutable initial governed CAPA tool registry.
 *
 * Primary sources:
 * Document #7 — Agent Definition and Configuration Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * BL-066, BL-068, BL-069
 * TOOL-AC-001 through TOOL-AC-008
 * AG-AC-004 through AG-AC-007
 */

const ACTIVE_AND_TERMINAL_STATES = [
  "S00", "S10", "S20", "S30",
  "S40", "S50", "S60", "S70",
  "S80", "S90", "S100", "S110",
  "S120", "S130", "S140", "S150",
] as const satisfies readonly CapaStateId[];

const SPECIALIST_AGENT_IDS =
  CAPA_AGENT_IDS.filter(
    (agentId) =>
      agentId !== "AG-CAPA-ORCH",
  );

const EVIDENCE_AGENT_IDS = [
  "AG-EVID",
  "AG-RCA",
  "AG-ACTION",
  "AG-IMPLEMENT",
  "AG-EFFECT",
  "AG-REVIEW",
  "AG-REPORT",
  "AG-REOPEN",
] as const satisfies
  readonly RegisteredCapaAgentId[];

const RETRIEVAL_AGENT_IDS = [
  "AG-INTAKE",
  "AG-EVID",
  "AG-RCA",
  "AG-ACTION",
  "AG-EFFECT",
  "AG-REVIEW",
  "AG-REPORT",
] as const satisfies
  readonly RegisteredCapaAgentId[];

interface DefinitionInput {
  readonly tool_id:
    CapaToolDefinition["tool_id"];
  readonly version: string;
  readonly name: string;
  readonly status: CapaToolStatus;
  readonly purpose: string;
  readonly capability_class:
    CapaToolCapabilityClass;
  readonly agents:
    readonly RegisteredCapaAgentId[];
  readonly operations:
    readonly CapaAgentOperation[];
  readonly states:
    readonly CapaStateId[];
  readonly input_schema_version: string;
  readonly output_schema_version: string;
  readonly input_data_classes:
    readonly CapaToolDataClass[];
  readonly output_data_class:
    CapaToolDataClass;
  readonly maximum_execution_ms: number;
}

function definition(
  input: DefinitionInput,
): CapaToolDefinition {
  return Object.freeze({
    tool_id: input.tool_id,
    tool_version:
      input.version as never,
    name: input.name,
    status: input.status,
    purpose: input.purpose,
    capability_class:
      input.capability_class,
    allowed_agent_ids:
      Object.freeze([...input.agents]),
    allowed_operations:
      Object.freeze([
        ...input.operations,
      ]),
    allowed_workflow_states:
      Object.freeze([...input.states]),
    input_schema_version:
      input.input_schema_version as never,
    output_schema_version:
      input.output_schema_version as never,
    permitted_input_data_classes:
      Object.freeze([
        ...input.input_data_classes,
      ]),
    output_data_class:
      input.output_data_class,
    maximum_execution_ms:
      input.maximum_execution_ms,
    audit_required: true,
    tenant_scope_required: true,
    direct_case_mutation: false,
    external_side_effects: false,
  });
}

const DEFINITIONS = [
  definition({
    tool_id: "TOOL-CASE-READ",
    version: "tool-case-read-1.0.0",
    name: "Tenant-scoped CAPA case reader",
    status: "approved",
    purpose:
      "Read the authorized minimum immutable and aggregate CAPA case context without mutation.",
    capability_class: "read_only",
    agents: CAPA_AGENT_IDS,
    operations: CAPA_AGENT_OPERATIONS,
    states: ACTIVE_AND_TERMINAL_STATES,
    input_schema_version:
      "tool-case-read-input-1.0.0",
    output_schema_version:
      "tool-case-read-output-1.0.0",
    input_data_classes: [
      "authorized_case_data",
    ],
    output_data_class:
      "authorized_case_data",
    maximum_execution_ms: 5_000,
  }),
  definition({
    tool_id: "TOOL-EVIDENCE-READ",
    version:
      "tool-evidence-read-1.0.0",
    name:
      "Tenant-scoped CAPA evidence reader",
    status: "evaluation",
    purpose:
      "Read authorized evidence metadata and content references without mutation.",
    capability_class: "read_only",
    agents: EVIDENCE_AGENT_IDS,
    operations: CAPA_AGENT_OPERATIONS,
    states: ACTIVE_AND_TERMINAL_STATES,
    input_schema_version:
      "tool-evidence-read-input-1.0.0",
    output_schema_version:
      "tool-evidence-read-output-1.0.0",
    input_data_classes: [
      "authorized_case_data",
      "authorized_evidence",
    ],
    output_data_class:
      "authorized_evidence",
    maximum_execution_ms: 5_000,
  }),
  definition({
    tool_id: "TOOL-RETRIEVE",
    version: "tool-retrieve-1.0.0",
    name: "Governed knowledge retriever",
    status: "evaluation",
    purpose:
      "Retrieve authorized governed knowledge passages with source and version metadata.",
    capability_class: "read_only",
    agents: RETRIEVAL_AGENT_IDS,
    operations: CAPA_AGENT_OPERATIONS,
    states: ACTIVE_AND_TERMINAL_STATES,
    input_schema_version:
      "tool-retrieve-input-1.0.0",
    output_schema_version:
      "tool-retrieve-output-1.0.0",
    input_data_classes: [
      "authorized_case_data",
      "governed_knowledge",
    ],
    output_data_class:
      "governed_knowledge",
    maximum_execution_ms: 8_000,
  }),
  definition({
    tool_id: "TOOL-STRUCTURED-DRAFT",
    version:
      "tool-structured-draft-1.0.0",
    name: "Structured non-authoritative drafter",
    status: "evaluation",
    purpose:
      "Shape validated non-authoritative agent output into an approved draft schema.",
    capability_class: "controlled_draft",
    agents: SPECIALIST_AGENT_IDS,
    operations: CAPA_AGENT_OPERATIONS,
    states: ACTIVE_AND_TERMINAL_STATES,
    input_schema_version:
      "tool-structured-draft-input-1.0.0",
    output_schema_version:
      "tool-structured-draft-output-1.0.0",
    input_data_classes: [
      "authorized_case_data",
      "authorized_evidence",
      "governed_knowledge",
      "derived_non_authoritative",
    ],
    output_data_class:
      "derived_non_authoritative",
    maximum_execution_ms: 5_000,
  }),
  definition({
    tool_id: "TOOL-FILE-EXTRACT-READ",
    version:
      "tool-file-extract-read-1.0.0",
    name: "Read-only evidence file extractor",
    status: "evaluation",
    purpose:
      "Extract bounded text or metadata from an authorized evidence file without modifying it.",
    capability_class: "read_only",
    agents: EVIDENCE_AGENT_IDS,
    operations: CAPA_AGENT_OPERATIONS,
    states: ACTIVE_AND_TERMINAL_STATES,
    input_schema_version:
      "tool-file-extract-read-input-1.0.0",
    output_schema_version:
      "tool-file-extract-read-output-1.0.0",
    input_data_classes: [
      "authorized_evidence",
    ],
    output_data_class:
      "authorized_evidence",
    maximum_execution_ms: 10_000,
  }),
  definition({
    tool_id: "TOOL-CALCULATE",
    version: "tool-calculate-1.0.0",
    name: "Bounded deterministic calculator",
    status: "evaluation",
    purpose:
      "Perform an approved deterministic calculation and return labeled derived output.",
    capability_class:
      "deterministic_compute",
    agents: ["AG-EFFECT"],
    operations: [
      "analyze_effectiveness",
    ],
    states: ["S100", "S110"],
    input_schema_version:
      "tool-calculate-input-1.0.0",
    output_schema_version:
      "tool-calculate-output-1.0.0",
    input_data_classes: [
      "authorized_case_data",
      "authorized_evidence",
      "derived_non_authoritative",
    ],
    output_data_class:
      "derived_non_authoritative",
    maximum_execution_ms: 2_000,
  }),
  definition({
    tool_id: "TOOL-REPORT-DRAFT",
    version:
      "tool-report-draft-1.0.0",
    name: "Controlled CAPA report drafter",
    status: "evaluation",
    purpose:
      "Assemble a labeled non-authoritative report draft from an authorized exact-version snapshot.",
    capability_class: "controlled_draft",
    agents: ["AG-REPORT"],
    operations: [
      "assemble_report_draft",
    ],
    states: ["S120", "S130", "S140"],
    input_schema_version:
      "tool-report-draft-input-1.0.0",
    output_schema_version:
      "tool-report-draft-output-1.0.0",
    input_data_classes: [
      "authorized_case_data",
      "authorized_evidence",
      "governed_knowledge",
      "derived_non_authoritative",
    ],
    output_data_class:
      "derived_non_authoritative",
    maximum_execution_ms: 8_000,
  }),
  definition({
    tool_id: "TOOL-FEEDBACK",
    version: "tool-feedback-1.0.0",
    name: "Controlled AI feedback recorder",
    status: "evaluation",
    purpose:
      "Record bounded human feedback about an AI draft without changing controlled CAPA content.",
    capability_class: "controlled_draft",
    agents: CAPA_AGENT_IDS,
    operations: CAPA_AGENT_OPERATIONS,
    states: ACTIVE_AND_TERMINAL_STATES,
    input_schema_version:
      "tool-feedback-input-1.0.0",
    output_schema_version:
      "tool-feedback-output-1.0.0",
    input_data_classes: [
      "derived_non_authoritative",
    ],
    output_data_class:
      "derived_non_authoritative",
    maximum_execution_ms: 5_000,
  }),
] as const;

export interface CapaToolRegistry {
  readonly registry_version: string;

  listToolIds():
    readonly CapaToolDefinition["tool_id"][];

  findExact(
    toolId: CapaToolDefinition["tool_id"],
    toolVersion: string,
  ): CapaToolDefinition | null;
}

class InitialCapaToolRegistry
  implements CapaToolRegistry {
  readonly registry_version =
    "capa-tool-registry-1.0.0";

  private readonly byToolId =
    new Map(
      DEFINITIONS.map((item) => [
        item.tool_id,
        item,
      ]),
    );

  listToolIds():
    readonly CapaToolDefinition["tool_id"][] {
    return CAPA_AGENT_TOOL_IDS;
  }

  findExact(
    toolId: CapaToolDefinition["tool_id"],
    toolVersion: string,
  ): CapaToolDefinition | null {
    const item = this.byToolId.get(toolId);

    if (
      item === undefined ||
      item.tool_version !== toolVersion
    ) {
      return null;
    }

    return item;
  }
}

/** Creates the immutable initial exact-version tool registry. */
export function createInitialCapaToolRegistry():
  CapaToolRegistry {
  return Object.freeze(
    new InitialCapaToolRegistry(),
  );
}
