import type {
  CapaAgentDefinition,
  CapaAgentEligibilityDecision,
  CapaAgentEligibilityRequest,
} from "./capa-agent-contract";

import type {
  CapaAgentRegistry,
} from "./capa-agent-registry";

/**
 * Fail-closed eligibility evaluation for controlled CAPA agents.
 *
 * Primary source:
 * Document #7 — Agent Definition and Configuration Specification
 *
 * Traceability:
 * BL-065, BL-067, BL-068, BL-069
 * AG-AC-001 through AG-AC-007
 * P-01 through P-04
 *
 * This evaluator grants only permission to proceed to the next controlled
 * boundary. It does not invoke a model, execute a tool, authorize a human
 * workflow action or change a CAPA record.
 */

function denied(
  reasonCode: Exclude<
    CapaAgentEligibilityDecision["reason_code"],
    "AGENT_ELIGIBLE"
  >,
): CapaAgentEligibilityDecision {
  return Object.freeze({
    eligible: false,
    reason_code: reasonCode,
  });
}

function allowed(
  definition: CapaAgentDefinition,
): CapaAgentEligibilityDecision {
  return Object.freeze({
    eligible: true,
    reason_code: "AGENT_ELIGIBLE",
    definition,
  });
}

/**
 * Evaluates authoritative server-derived request facts against one exact
 * immutable registry definition. Checks are intentionally ordered so a
 * request cannot bypass agent lifecycle, state, role, tool or schema gates.
 */
export function evaluateCapaAgentEligibility(
  registry: CapaAgentRegistry,
  request: CapaAgentEligibilityRequest,
): CapaAgentEligibilityDecision {
  if (
    !registry.listAgentIds()
      .includes(request.agent_id)
  ) {
    return denied("AGENT_NOT_FOUND");
  }

  const definition = registry.findExact(
    request.agent_id,
    request.agent_version,
  );

  if (definition === null) {
    return denied(
      "AGENT_VERSION_NOT_APPROVED",
    );
  }

  if (
    definition.status === "blocked" ||
    definition.status === "retired"
  ) {
    return denied(
      "AGENT_BLOCKED_OR_RETIRED",
    );
  }

  if (definition.status !== "approved") {
    return denied(
      "AGENT_VERSION_NOT_APPROVED",
    );
  }

  const stateCapability = definition.activation_capabilities.find((capability) => capability.eligible_states.includes(request.workflow_state));
  if (stateCapability === undefined) {
    return denied(
      "WORKFLOW_STATE_NOT_ELIGIBLE",
    );
  }

  const capability = definition.activation_capabilities.find((candidate) => candidate.eligible_states.includes(request.workflow_state) && candidate.operation === request.operation);
  if (capability === undefined) {
    return denied("OPERATION_NOT_ELIGIBLE");
  }

  if (
    !Array.isArray(
      request.active_role_ids,
    ) ||
    !request.active_role_ids.some(
      (roleId) =>
        definition.allowed_requester_roles
          .includes(roleId),
    )
  ) {
    return denied(
      "REQUESTER_ROLE_NOT_ELIGIBLE",
    );
  }

  if (
    request.requested_tool_ids.some(
      (toolId) =>
        !capability.allowed_tools.includes(
          toolId,
        ),
    )
  ) {
    return denied("TOOL_NOT_ALLOWED");
  }

  if (
    request.output_schema_version !==
      capability.output_schema_version
  ) {
    return denied("OUTPUT_SCHEMA_MISMATCH");
  }

  return allowed(definition);
}
