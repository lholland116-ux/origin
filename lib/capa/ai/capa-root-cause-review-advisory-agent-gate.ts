import type { CapaAgentActivationService } from "./capa-agent-activation-service";
import { createInitialCapaAgentRegistry } from "./capa-agent-registry";
import type { ControlledVersion } from "./capa-prompt-contract";
import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "./capa-root-cause-review-advisory-contract";
import type { AuthoritativeS50RootCauseReviewContext } from "./capa-root-cause-review-advisory-context";

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION =
  "assemble_review_packet" as const;

const registry = createInitialCapaAgentRegistry();
const definition = registry.findExact("AG-REVIEW", "ag-review-1.0.0");
const capability = definition?.activation_capabilities.find(
  (candidate) =>
    candidate.eligible_states.length === 1 &&
    candidate.eligible_states[0] === "S50" &&
    candidate.operation === CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION &&
    candidate.output_schema_version ===
      CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION &&
    candidate.allowed_tools.length === 3 &&
    candidate.allowed_tools.includes("TOOL-CASE-READ") &&
    candidate.allowed_tools.includes("TOOL-EVIDENCE-READ") &&
    candidate.allowed_tools.includes("TOOL-STRUCTURED-DRAFT"),
);

if (definition === undefined || capability === undefined) {
  throw new Error("CONTROLLED_AG_REVIEW_S50_CAPABILITY_MISSING");
}

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT = Object.freeze({
  agent_id: "AG-REVIEW" as const,
  agent_version: "ag-review-1.0.0" as const,
  output_schema_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  requested_tool_ids: Object.freeze([...capability.allowed_tools]),
});

export interface CapaRootCauseReviewAdvisoryAgentGate {
  evaluate(input: {
    readonly context: AuthoritativeS50RootCauseReviewContext;
    readonly agent: typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT;
    readonly operation: typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION;
  }): boolean;
}

export class ActivationBackedCapaRootCauseReviewAdvisoryAgentGate
  implements CapaRootCauseReviewAdvisoryAgentGate {
  constructor(private readonly activation_service: CapaAgentActivationService) {}

  evaluate(input: Parameters<CapaRootCauseReviewAdvisoryAgentGate["evaluate"]>[0]): boolean {
    try {
      if (
        input.context.workflow_state !== "S50" ||
        input.agent.agent_id !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT.agent_id ||
        input.agent.agent_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT.agent_version ||
        input.agent.output_schema_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT.output_schema_version ||
        input.operation !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION
      ) return false;

      return this.activation_service.evaluate({
        agent_id: input.agent.agent_id,
        agent_version: input.agent.agent_version as ControlledVersion,
        workflow_state: input.context.workflow_state,
        operation: input.operation,
        active_role_ids: input.context.active_roles.map((assignment) => assignment.role_id),
        requested_tool_ids: input.agent.requested_tool_ids,
        output_schema_version: input.agent.output_schema_version as ControlledVersion,
      }).eligible === true;
    } catch {
      return false;
    }
  }
}

export function createActivationBackedCapaRootCauseReviewAdvisoryAgentGate(
  activationService: CapaAgentActivationService,
): CapaRootCauseReviewAdvisoryAgentGate {
  return new ActivationBackedCapaRootCauseReviewAdvisoryAgentGate(activationService);
}
