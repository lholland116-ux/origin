import type {
  CapaAgentActivationService,
} from "./capa-agent-activation-service";

import type {
  CapaIntakeAdvisoryAgentGate,
} from "./capa-intake-advisory-service";

import type {
  ControlledVersion,
} from "./capa-prompt-contract";

/**
 * Adapts the governed CAPA agent-activation boundary to the narrower
 * intake-advisory gate contract.
 *
 * All eligibility facts originate from trusted server-resolved advisory
 * context and the immutable AG-INTAKE definition. Browser input cannot
 * select workflow state, roles, tools, operation, agent version or output
 * schema.
 */
export class ActivationBackedCapaIntakeAdvisoryAgentGate
  implements CapaIntakeAdvisoryAgentGate {
  constructor(
    private readonly activation_service:
      CapaAgentActivationService,
  ) {}

  evaluate(
    input: Parameters<
      CapaIntakeAdvisoryAgentGate["evaluate"]
    >[0],
  ): boolean {
    const decision =
      this.activation_service.evaluate({
        agent_id:
          input.agent.agent_id,

        agent_version:
          input.agent.agent_version as
            ControlledVersion,

        workflow_state:
          input.context.workflow_state,

        operation:
          input.operation,

        active_role_ids:
          input.context.active_role_ids,

        requested_tool_ids:
          input.agent.requested_tool_ids,

        output_schema_version:
          input.agent.output_schema_version as
            ControlledVersion,
      });

    return decision.eligible === true;
  }
}

export function createActivationBackedCapaIntakeAdvisoryAgentGate(
  activationService:
    CapaAgentActivationService,
): CapaIntakeAdvisoryAgentGate {
  return new ActivationBackedCapaIntakeAdvisoryAgentGate(
    activationService,
  );
}
