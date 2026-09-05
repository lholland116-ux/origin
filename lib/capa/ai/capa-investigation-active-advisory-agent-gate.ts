import type {
  CapaAgentActivationService,
} from "./capa-agent-activation-service";
import {
  createInitialCapaAgentRegistry,
} from "./capa-agent-registry";
import type { ControlledVersion } from "./capa-prompt-contract";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "./capa-investigation-active-advisory-contract";
import type {
  AuthoritativeS40InvestigationActiveContext,
} from "./capa-investigation-active-advisory-context";

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION =
  "facilitate_root_cause" as const;

const registry = createInitialCapaAgentRegistry();
const definition = registry.findExact("AG-RCA", "ag-rca-1.0.0");
const capability = definition?.activation_capabilities.find(
  (candidate) =>
    candidate.eligible_states.length === 1 &&
    candidate.eligible_states[0] === "S40" &&
    candidate.operation === CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION &&
    candidate.output_schema_version ===
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION &&
    candidate.allowed_tools.length === 2 &&
    candidate.allowed_tools.includes("TOOL-CASE-READ") &&
    candidate.allowed_tools.includes("TOOL-STRUCTURED-DRAFT"),
);

if (definition === null || capability === undefined) {
  throw new Error("CONTROLLED_AG_RCA_S40_CAPABILITY_MISSING");
}

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT = Object.freeze({
  agent_id: "AG-RCA" as const,
  agent_version: "ag-rca-1.0.0" as const,
  output_schema_version:
    CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  requested_tool_ids: Object.freeze([...capability.allowed_tools]),
});

export interface CapaInvestigationActiveAdvisoryAgentGate {
  evaluate(input: {
    readonly context: AuthoritativeS40InvestigationActiveContext;
    readonly agent: typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT;
    readonly operation: typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION;
  }): boolean;
}

export class ActivationBackedCapaInvestigationActiveAdvisoryAgentGate
  implements CapaInvestigationActiveAdvisoryAgentGate {
  constructor(
    private readonly activation_service: CapaAgentActivationService,
  ) {}

  evaluate(
    input: Parameters<
      CapaInvestigationActiveAdvisoryAgentGate["evaluate"]
    >[0],
  ): boolean {
    try {
      if (
        input.context.workflow_state !== "S40" ||
        input.agent.agent_id !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_id ||
        input.agent.agent_version !==
          CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_version ||
        input.agent.output_schema_version !==
          CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.output_schema_version ||
        input.operation !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION
      ) {
        return false;
      }

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

export function createActivationBackedCapaInvestigationActiveAdvisoryAgentGate(
  activationService: CapaAgentActivationService,
): CapaInvestigationActiveAdvisoryAgentGate {
  return new ActivationBackedCapaInvestigationActiveAdvisoryAgentGate(
    activationService,
  );
}
