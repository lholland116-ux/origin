import { CAPABILITY_REGISTRY, type CapabilityId } from "@/lib/ai/capability-registry";
import { MAX_INTELLIGENCE_PLAN_STEPS } from "@/lib/ai/plan-validator";

export const PLANNED_EXECUTION_HANDOFF_VERSION = 1 as const;
export const MAX_PLANNER_MODEL_CALLS = 2 as const;
export const MAX_PLANNER_REPAIR_ATTEMPTS = 1 as const;

export const PLANNER_ALLOWED_CAPABILITIES: readonly CapabilityId[] = Object.freeze(
  CAPABILITY_REGISTRY.all()
    .filter(({ supportsPlanning }) => supportsPlanning)
    .map(({ id }) => id),
);

export type PlannerGovernancePolicy = {
  readonly handoffVersion: typeof PLANNED_EXECUTION_HANDOFF_VERSION;
  readonly maxSteps: typeof MAX_INTELLIGENCE_PLAN_STEPS;
  readonly allowedCapabilities: readonly CapabilityId[];
  readonly modelPlanningAllowed: boolean;
  readonly maxModelCalls: typeof MAX_PLANNER_MODEL_CALLS;
  readonly maxRepairAttempts: typeof MAX_PLANNER_REPAIR_ATTEMPTS;
  readonly attachmentContextAllowed: boolean;
};

export function createPlannerGovernancePolicy(options?: {
  readonly modelPlanningAllowed?: boolean;
  readonly attachmentContextAllowed?: boolean;
}): PlannerGovernancePolicy {
  return Object.freeze({
    handoffVersion: PLANNED_EXECUTION_HANDOFF_VERSION,
    maxSteps: MAX_INTELLIGENCE_PLAN_STEPS,
    allowedCapabilities: PLANNER_ALLOWED_CAPABILITIES,
    modelPlanningAllowed: options?.modelPlanningAllowed ?? true,
    maxModelCalls: MAX_PLANNER_MODEL_CALLS,
    maxRepairAttempts: MAX_PLANNER_REPAIR_ATTEMPTS,
    attachmentContextAllowed: options?.attachmentContextAllowed ?? true,
  });
}

export const DEFAULT_PLANNER_GOVERNANCE_POLICY = createPlannerGovernancePolicy();
