import type { CapaAgentActivationService } from "./capa-agent-activation-service";
import { createInitialCapaAgentRegistry } from "./capa-agent-registry";
import type { ControlledVersion } from "./capa-prompt-contract";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION } from "./capa-implementation-evidence-advisory-contract";
import type { AuthoritativeS80ImplementationEvidenceContext } from "./capa-implementation-evidence-advisory-context";

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION = "review_implementation_evidence" as const;
const registry = createInitialCapaAgentRegistry();
const definition = registry.findExact("AG-IMPLEMENT", "ag-implement-1.0.0");
const capability = definition?.activation_capabilities.find((candidate) => candidate.eligible_states.length === 1 && candidate.eligible_states[0] === "S80" && candidate.operation === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION && candidate.output_schema_version === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION);
if (definition === undefined || capability === undefined) throw new Error("CONTROLLED_AG_EVID_S80_CAPABILITY_MISSING");

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT = Object.freeze({ agent_id: "AG-IMPLEMENT" as const, agent_version: "ag-implement-1.0.0" as const, output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, requested_tool_ids: Object.freeze([...capability.allowed_tools]) });

export interface CapaImplementationEvidenceAdvisoryAgentGate {
  evaluate(input: { readonly context: AuthoritativeS80ImplementationEvidenceContext; readonly agent: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT; readonly operation: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION }): boolean;
}

export class ActivationBackedCapaImplementationEvidenceAdvisoryAgentGate implements CapaImplementationEvidenceAdvisoryAgentGate {
  constructor(private readonly activation: CapaAgentActivationService) {}
  evaluate(input: Parameters<CapaImplementationEvidenceAdvisoryAgentGate["evaluate"]>[0]): boolean {
    try {
      if (input.context.workflow_state !== "S80" || input.operation !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION || input.agent.agent_id !== "AG-IMPLEMENT" || input.agent.agent_version !== "ag-implement-1.0.0" || input.agent.output_schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION) return false;
      return this.activation.evaluate({ agent_id: input.agent.agent_id, agent_version: input.agent.agent_version as ControlledVersion, workflow_state: "S80", operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION, active_role_ids: input.context.active_roles.map((assignment) => assignment.role_id), requested_tool_ids: input.agent.requested_tool_ids, output_schema_version: input.agent.output_schema_version as ControlledVersion }).eligible === true;
    } catch { return false; }
  }
}

export function createActivationBackedCapaImplementationEvidenceAdvisoryAgentGate(service: CapaAgentActivationService): CapaImplementationEvidenceAdvisoryAgentGate { return new ActivationBackedCapaImplementationEvidenceAdvisoryAgentGate(service); }
