import type { CapaAgentActivationService } from "./capa-agent-activation-service";
import { createInitialCapaAgentRegistry } from "./capa-agent-registry";
import type { ControlledVersion } from "./capa-prompt-contract";
import { CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION } from "./capa-action-plan-advisory-contract";
import { CAPA_ACTION_PLAN_ADVISORY_OPERATION } from "./capa-action-plan-advisory-model-generator";
import type { AuthoritativeS60ActionPlanContext } from "./capa-action-plan-advisory-context";

const registry = createInitialCapaAgentRegistry();
const definition = registry.findExact("AG-ACTION", "ag-action-1.0.0");
const capability = definition?.activation_capabilities.find((candidate) => candidate.eligible_states.length === 1 && candidate.eligible_states[0] === "S60" && candidate.operation === CAPA_ACTION_PLAN_ADVISORY_OPERATION && candidate.output_schema_version === CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION);
if (definition === undefined || capability === undefined) throw new Error("CONTROLLED_AG_ACTION_S60_CAPABILITY_MISSING");
export const CAPA_ACTION_PLAN_ADVISORY_AGENT = Object.freeze({ agent_id: "AG-ACTION" as const, agent_version: "ag-action-1.0.0" as const, output_schema_version: CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION, requested_tool_ids: Object.freeze([...capability.allowed_tools]) });
export interface CapaActionPlanAdvisoryAgentGate { evaluate(input: { readonly context: AuthoritativeS60ActionPlanContext; readonly agent: typeof CAPA_ACTION_PLAN_ADVISORY_AGENT; readonly operation: typeof CAPA_ACTION_PLAN_ADVISORY_OPERATION }): boolean; }
export class ActivationBackedCapaActionPlanAdvisoryAgentGate implements CapaActionPlanAdvisoryAgentGate { constructor(private readonly activation: CapaAgentActivationService) {} evaluate(input: Parameters<CapaActionPlanAdvisoryAgentGate["evaluate"]>[0]): boolean { try { if (input.context.workflow_state !== "S60" || input.operation !== CAPA_ACTION_PLAN_ADVISORY_OPERATION || input.agent.agent_id !== "AG-ACTION" || input.agent.output_schema_version !== CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION) return false; return this.activation.evaluate({ agent_id: "AG-ACTION", agent_version: "ag-action-1.0.0" as ControlledVersion, workflow_state: "S60", operation: CAPA_ACTION_PLAN_ADVISORY_OPERATION, active_role_ids: input.context.active_roles.map((role) => role.role_id), requested_tool_ids: input.agent.requested_tool_ids, output_schema_version: CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION as ControlledVersion }).eligible === true; } catch { return false; } } }
export function createActivationBackedCapaActionPlanAdvisoryAgentGate(service: CapaAgentActivationService): CapaActionPlanAdvisoryAgentGate { return new ActivationBackedCapaActionPlanAdvisoryAgentGate(service); }
