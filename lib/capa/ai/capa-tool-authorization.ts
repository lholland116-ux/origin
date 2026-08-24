import type {
  CapaAgentDefinition,
  CapaAgentEligibilityRequest,
} from "./capa-agent-contract";

import type {
  CapaAgentActivationService,
} from "./capa-agent-activation-service";

import type {
  CapaToolDefinition,
  CapaToolExecutionFailureReason,
  CapaToolExecutionRequest,
} from "./capa-tool-contract";

import type {
  CapaToolRegistry,
} from "./capa-tool-registry";

/**
 * Fail-closed authorization for one exact governed CAPA tool invocation.
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
 *
 * This module returns permission to proceed to a later execution gateway.
 * It does not execute an adapter, invoke a model or mutate CAPA state.
 */

export interface CapaToolAuthorizationRequest {
  readonly execution_request:
    CapaToolExecutionRequest;
  readonly agent_eligibility_request:
    CapaAgentEligibilityRequest;
}

export type CapaToolAuthorizationDecision =
  | {
      readonly authorized: true;
      readonly reason_code:
        "TOOL_AUTHORIZED";
      readonly tool_definition:
        CapaToolDefinition;
      readonly agent_definition:
        CapaAgentDefinition;
    }
  | {
      readonly authorized: false;
      readonly reason_code:
        CapaToolExecutionFailureReason;
    };

function denied(
  reasonCode:
    CapaToolExecutionFailureReason,
): CapaToolAuthorizationDecision {
  return Object.freeze({
    authorized: false,
    reason_code: reasonCode,
  });
}

/** Evaluates trusted request facts in deterministic fail-closed order. */
export function authorizeCapaToolExecution(
  registry: CapaToolRegistry,
  activationService:
    CapaAgentActivationService,
  request: CapaToolAuthorizationRequest,
): CapaToolAuthorizationDecision {
  const execution =
    request.execution_request;
  const eligibility =
    request.agent_eligibility_request;

  if (
    !registry.listToolIds()
      .includes(execution.tool_id)
  ) {
    return denied("TOOL_NOT_FOUND");
  }

  const tool = registry.findExact(
    execution.tool_id,
    execution.tool_version,
  );

  if (tool === null) {
    return denied(
      "TOOL_VERSION_NOT_APPROVED",
    );
  }

  if (
    tool.status === "blocked" ||
    tool.status === "retired"
  ) {
    return denied(
      "TOOL_BLOCKED_OR_RETIRED",
    );
  }

  if (tool.status !== "approved") {
    return denied(
      "TOOL_VERSION_NOT_APPROVED",
    );
  }

  if (
    execution.organization_id !==
      execution.resource_organization_id
  ) {
    return denied("TENANT_SCOPE_DENIED");
  }

  if (
    execution.agent_id !==
      eligibility.agent_id ||
    execution.agent_version !==
      eligibility.agent_version ||
    execution.workflow_state !==
      eligibility.workflow_state ||
    execution.operation !==
      eligibility.operation
  ) {
    return denied("AGENT_NOT_ELIGIBLE");
  }

  if (
    !Array.isArray(
      eligibility.requested_tool_ids,
    ) ||
    !eligibility.requested_tool_ids
      .includes(execution.tool_id)
  ) {
    return denied(
      "AGENT_TOOL_NOT_ALLOWED",
    );
  }

  const agentDecision =
    activationService.evaluate(
      eligibility,
    );

  if (!agentDecision.eligible) {
    return denied(
      agentDecision.reason_code ===
        "TOOL_NOT_ALLOWED"
        ? "AGENT_TOOL_NOT_ALLOWED"
        : "AGENT_NOT_ELIGIBLE",
    );
  }

  if (
    !tool.allowed_agent_ids.includes(
      execution.agent_id,
    ) ||
    !agentDecision.definition.allowed_tools
      .includes(execution.tool_id)
  ) {
    return denied(
      "AGENT_TOOL_NOT_ALLOWED",
    );
  }

  if (
    !tool.allowed_workflow_states
      .includes(execution.workflow_state)
  ) {
    return denied("TOOL_STATE_NOT_ALLOWED");
  }

  if (
    !tool.allowed_operations.includes(
      execution.operation,
    )
  ) {
    return denied(
      "TOOL_OPERATION_NOT_ALLOWED",
    );
  }

  if (
    execution.input_schema_version !==
      tool.input_schema_version
  ) {
    return denied("INPUT_SCHEMA_MISMATCH");
  }

  if (
    execution.expected_output_schema_version !==
      tool.output_schema_version
  ) {
    return denied("OUTPUT_SCHEMA_MISMATCH");
  }

  if (
    !tool.permitted_input_data_classes
      .includes(execution.input_data_class)
  ) {
    return denied(
      "INPUT_DATA_CLASS_NOT_ALLOWED",
    );
  }

  return Object.freeze({
    authorized: true,
    reason_code: "TOOL_AUTHORIZED",
    tool_definition: tool,
    agent_definition:
      agentDecision.definition,
  });
}
