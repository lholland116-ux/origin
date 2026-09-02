import type { CapaAgentActivationService } from "./capa-agent-activation-service";
import type { CapaContainmentRiskAdvisoryAgentGate } from "./capa-containment-risk-advisory-service";
import type { ControlledVersion } from "./capa-prompt-contract";

export class ActivationBackedCapaContainmentRiskAdvisoryAgentGate implements CapaContainmentRiskAdvisoryAgentGate {
  constructor(private readonly activation_service: CapaAgentActivationService) {}

  evaluate(input: Parameters<CapaContainmentRiskAdvisoryAgentGate["evaluate"]>[0]): boolean {
    const decision = this.activation_service.evaluate({
      agent_id: input.agent.agent_id,
      agent_version: input.agent.agent_version as ControlledVersion,
      workflow_state: input.context.workflow_state,
      operation: input.operation,
      active_role_ids: input.context.active_roles.map((assignment) => assignment.role_id),
      requested_tool_ids: input.agent.requested_tool_ids,
      output_schema_version: input.agent.output_schema_version as ControlledVersion,
    });
    return decision.eligible === true;
  }
}

export function createActivationBackedCapaContainmentRiskAdvisoryAgentGate(activationService: CapaAgentActivationService): CapaContainmentRiskAdvisoryAgentGate {
  return new ActivationBackedCapaContainmentRiskAdvisoryAgentGate(activationService);
}
