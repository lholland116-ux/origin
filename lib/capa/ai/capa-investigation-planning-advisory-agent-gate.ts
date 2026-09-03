import type { CapaAgentActivationService } from "./capa-agent-activation-service";
import {
  createInitialCapaAgentRegistry,
} from "./capa-agent-registry";
import type { ControlledVersion } from "./capa-prompt-contract";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "./capa-investigation-planning-advisory-contract";
import type {
  AuthoritativeS30InvestigationPlanningContext,
} from "./capa-investigation-planning-advisory-context";

export const CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION =
  "draft_investigation_plan" as const;

const registry = createInitialCapaAgentRegistry();
const definition = registry.findExact("AG-PLAN", "ag-plan-1.0.0");
const capability = definition?.activation_capabilities.find(
  (candidate) =>
    candidate.eligible_states.includes("S30") &&
    candidate.operation === CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
);

if (
  definition === null ||
  capability === undefined ||
  capability.output_schema_version !==
    CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION
) {
  throw new Error("CONTROLLED_AG_PLAN_S30_CAPABILITY_MISSING");
}

export const CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT = Object.freeze({
  agent_id: "AG-PLAN" as const,
  agent_version: "ag-plan-1.0.0" as const,
  output_schema_version:
    CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  requested_tool_ids: Object.freeze([...capability.allowed_tools]),
});

export interface CapaInvestigationPlanningAdvisoryAgentGate {
  evaluate(input: {
    readonly context: AuthoritativeS30InvestigationPlanningContext;
    readonly agent: typeof CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT;
    readonly operation: typeof CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION;
  }): boolean;
}

export class ActivationBackedCapaInvestigationPlanningAdvisoryAgentGate
  implements CapaInvestigationPlanningAdvisoryAgentGate {
  constructor(
    private readonly activation_service: CapaAgentActivationService,
  ) {}

  evaluate(
    input: Parameters<
      CapaInvestigationPlanningAdvisoryAgentGate["evaluate"]
    >[0],
  ): boolean {
    try {
      const decision = this.activation_service.evaluate({
        agent_id: input.agent.agent_id,
        agent_version: input.agent.agent_version as ControlledVersion,
        workflow_state: input.context.workflow_state,
        operation: input.operation,
        active_role_ids: input.context.active_roles.map(
          (assignment) => assignment.role_id,
        ),
        requested_tool_ids: input.agent.requested_tool_ids,
        output_schema_version:
          input.agent.output_schema_version as ControlledVersion,
      });

      return decision.eligible === true;
    } catch {
      return false;
    }
  }
}

export function createActivationBackedCapaInvestigationPlanningAdvisoryAgentGate(
  activationService: CapaAgentActivationService,
): CapaInvestigationPlanningAdvisoryAgentGate {
  return new ActivationBackedCapaInvestigationPlanningAdvisoryAgentGate(
    activationService,
  );
}
