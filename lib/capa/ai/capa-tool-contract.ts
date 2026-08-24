import type {
  CapaCaseId,
  ControlledCode,
  OrganizationId,
  RequestTrace,
} from "../domain/capa-types";

import type {
  CapaStateId,
} from "../domain/capa-state";

import type {
  ControlledVersion,
} from "./capa-prompt-contract";

import type {
  CapaAgentOperation,
  CapaAgentToolId,
  RegisteredCapaAgentId,
} from "./capa-agent-contract";

/**
 * Provider-neutral governed CAPA tool vocabulary.
 *
 * Primary sources:
 * Document #7 — Agent Definition and Configuration Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * BL-066, BL-068, BL-069
 * TOOL-AC-001 through TOOL-AC-008
 * AG-AC-004 through AG-AC-007
 * P-01 through P-04
 */

export const CAPA_TOOL_STATUSES = [
  "draft",
  "evaluation",
  "approved",
  "retired",
  "blocked",
] as const;

export type CapaToolStatus =
  (typeof CAPA_TOOL_STATUSES)[number];

/**
 * A capability class describes computational behavior, not business
 * authority. None of these classes may mutate a CAPA aggregate or perform
 * a human-reserved workflow decision.
 */
export const CAPA_TOOL_CAPABILITY_CLASSES = [
  "read_only",
  "deterministic_compute",
  "controlled_draft",
] as const;

export type CapaToolCapabilityClass =
  (typeof CAPA_TOOL_CAPABILITY_CLASSES)[number];

export const CAPA_TOOL_DATA_CLASSES = [
  "authorized_case_data",
  "authorized_evidence",
  "governed_knowledge",
  "derived_non_authoritative",
] as const;

export type CapaToolDataClass =
  (typeof CAPA_TOOL_DATA_CLASSES)[number];

export interface CapaToolDefinition {
  readonly tool_id: CapaAgentToolId;
  readonly tool_version: ControlledVersion;
  readonly name: string;
  readonly status: CapaToolStatus;
  readonly purpose: string;
  readonly capability_class:
    CapaToolCapabilityClass;
  readonly allowed_agent_ids:
    readonly RegisteredCapaAgentId[];
  readonly allowed_operations:
    readonly CapaAgentOperation[];
  readonly allowed_workflow_states:
    readonly CapaStateId[];
  readonly input_schema_version:
    ControlledVersion;
  readonly output_schema_version:
    ControlledVersion;
  readonly permitted_input_data_classes:
    readonly CapaToolDataClass[];
  readonly output_data_class:
    CapaToolDataClass;
  readonly maximum_execution_ms: number;
  readonly audit_required: true;
  readonly tenant_scope_required: true;
  readonly direct_case_mutation: false;
  readonly external_side_effects: false;
}

/**
 * Trusted server code constructs this request after authentication, tenant
 * resolution and agent eligibility. Browser-supplied organization, agent,
 * state, operation, version and schema claims are not authoritative.
 */
export interface CapaToolExecutionRequest {
  readonly organization_id:
    OrganizationId;
  readonly resource_organization_id:
    OrganizationId;
  readonly capa_case_id?: CapaCaseId;
  readonly tool_id: CapaAgentToolId;
  readonly tool_version:
    ControlledVersion;
  readonly agent_id:
    RegisteredCapaAgentId;
  readonly agent_version:
    ControlledVersion;
  readonly workflow_state:
    CapaStateId;
  readonly operation:
    CapaAgentOperation;
  readonly input_schema_version:
    ControlledVersion;
  readonly expected_output_schema_version:
    ControlledVersion;
  readonly input_data_class:
    CapaToolDataClass;
  readonly input: Readonly<
    Record<string, unknown>
  >;
  readonly request_trace: RequestTrace;
}

export const CAPA_TOOL_EXECUTION_REASON_CODES = [
  "TOOL_EXECUTION_SUCCEEDED",
  "TOOL_NOT_FOUND",
  "TOOL_VERSION_NOT_APPROVED",
  "TOOL_BLOCKED_OR_RETIRED",
  "AGENT_NOT_ELIGIBLE",
  "AGENT_TOOL_NOT_ALLOWED",
  "TOOL_STATE_NOT_ALLOWED",
  "TOOL_OPERATION_NOT_ALLOWED",
  "TENANT_SCOPE_DENIED",
  "INPUT_SCHEMA_MISMATCH",
  "OUTPUT_SCHEMA_MISMATCH",
  "INPUT_DATA_CLASS_NOT_ALLOWED",
  "INPUT_VALIDATION_FAILED",
  "EXECUTION_TIMEOUT",
  "EXECUTION_FAILED",
  "OUTPUT_VALIDATION_FAILED",
] as const;

export type CapaToolExecutionReasonCode =
  (typeof CAPA_TOOL_EXECUTION_REASON_CODES)[number];

export type CapaToolExecutionFailureReason =
  Exclude<
    CapaToolExecutionReasonCode,
    "TOOL_EXECUTION_SUCCEEDED"
  >;

export interface CapaToolExecutionReceipt {
  readonly tool_id: CapaAgentToolId;
  readonly tool_version:
    ControlledVersion;
  readonly agent_id:
    RegisteredCapaAgentId;
  readonly agent_version:
    ControlledVersion;
  readonly organization_id:
    OrganizationId;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly input_schema_version:
    ControlledVersion;
  readonly output_schema_version:
    ControlledVersion;
  readonly output_data_class:
    CapaToolDataClass;
  readonly audit_required: true;
}

export type CapaToolExecutionResult =
  | {
      readonly status: "succeeded";
      readonly reason_code:
        "TOOL_EXECUTION_SUCCEEDED";
      readonly output: Readonly<
        Record<string, unknown>
      >;
      readonly receipt:
        CapaToolExecutionReceipt;
    }
  | {
      readonly status:
        | "denied"
        | "blocked"
        | "failed";
      readonly reason_code:
        CapaToolExecutionFailureReason;
    };

/**
 * Runtime adapter implemented by one exact controlled tool version.
 * Authorization remains the gateway's responsibility.
 */
export interface CapaToolAdapter {
  readonly tool_id: CapaAgentToolId;
  readonly tool_version:
    ControlledVersion;

  execute(
    request: CapaToolExecutionRequest,
  ): Promise<
    Readonly<Record<string, unknown>>
  >;
}

/** Stable controlled identifier for tool-output audit events. */
export type CapaToolAuditEventType =
  ControlledCode;
