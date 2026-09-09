import type { CapaAgentActivationService } from "./capa-agent-activation-service";
import { createInitialCapaAgentRegistry } from "./capa-agent-registry";
import type { ControlledVersion } from "./capa-prompt-contract";
import { CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION } from "./capa-action-plan-review-advisory-contract";
import type { AuthoritativeS70ActionPlanReviewContext } from "./capa-action-plan-review-advisory-context";

export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION = "assemble_review_packet" as const;
const registry = createInitialCapaAgentRegistry();
const definition = registry.findExact("AG-REVIEW", "ag-review-1.0.0");
const capability = definition?.activation_capabilities.find((candidate) => candidate.eligible_states.length === 1 && candidate.eligible_states[0] === "S70" && candidate.operation === CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION && candidate.output_schema_version === CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION);
if (definition === undefined || capability === undefined) throw new Error("CONTROLLED_AG_REVIEW_S70_CAPABILITY_MISSING");
export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_AGENT = Object.freeze({ agent_id: "AG-REVIEW" as const, agent_version: "ag-review-1.0.0" as const, output_schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION, requested_tool_ids: Object.freeze([...capability.allowed_tools]) });
export interface CapaActionPlanReviewAdvisoryAgentGate { evaluate(input: { readonly context: AuthoritativeS70ActionPlanReviewContext; readonly agent: typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_AGENT; readonly operation: typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION }): boolean; }
export class ActivationBackedCapaActionPlanReviewAdvisoryAgentGate implements CapaActionPlanReviewAdvisoryAgentGate {
  constructor(private readonly activation: CapaAgentActivationService) {}
  evaluate(input: Parameters<CapaActionPlanReviewAdvisoryAgentGate["evaluate"]>[0]): boolean { try { if (input.context.workflow_state !== "S70" || input.operation !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION || input.agent.agent_id !== "AG-REVIEW" || input.agent.output_schema_version !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION) return false; return this.activation.evaluate({ agent_id: "AG-REVIEW", agent_version: "ag-review-1.0.0" as ControlledVersion, workflow_state: "S70", operation: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION, active_role_ids: input.context.active_roles.map((role) => role.role_id), requested_tool_ids: input.agent.requested_tool_ids, output_schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION as ControlledVersion }).eligible === true; } catch { return false; } }
}
export function createActivationBackedCapaActionPlanReviewAdvisoryAgentGate(service: CapaAgentActivationService): CapaActionPlanReviewAdvisoryAgentGate { return new ActivationBackedCapaActionPlanReviewAdvisoryAgentGate(service); }
