import {
  CAPABILITY_REGISTRY,
  type CapabilityId,
} from "@/lib/ai/capability-registry";
import type { IntelligencePlan, PlanInputRef } from "@/lib/ai/intelligence-plan";
import {
  selectIntelligenceRoute,
  type IntelligenceRouteDecision,
  type IntelligenceRouteInput,
} from "@/lib/ai/intelligence-router";
import {
  planMultiStepObjective,
  type MultiStepPlannerInput,
  type PlanningFailureCode,
  type PlanningResult,
} from "@/lib/ai/multi-step-planner";
import type { PlannerAttachmentKind } from "@/lib/ai/multi-step-planner-model-client";
import { orderPlanSteps } from "@/lib/ai/plan-graph";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import {
  createPlannerGovernancePolicy,
  DEFAULT_PLANNER_GOVERNANCE_POLICY,
  type PlannerGovernancePolicy,
} from "@/lib/ai/planner-governance";
import { classifyTaskComplexity, type TaskComplexity } from "@/lib/ai/task-complexity";

if (typeof window !== "undefined") {
  throw new Error("Intelligence decision coordination is server-only");
}

export type PlannerAttachmentContext = {
  readonly imageCount?: number;
  readonly fileCount?: number;
};

/** Validated input for a future runtime; this handoff is not authorization to execute. */
export type PlannedExecutionHandoff = {
  readonly version: 1;
  readonly objective: string;
  readonly plan: IntelligencePlan;
  readonly orderedStepIds: readonly string[];
  readonly plannerSource: "deterministic" | "model";
  readonly attachmentContext?: {
    readonly imageCount: number;
    readonly fileCount: number;
  };
  readonly governance: {
    readonly maxSteps: number;
    readonly capabilityIds: readonly CapabilityId[];
    readonly modelPlanningAllowed: boolean;
    readonly maxModelCalls: number;
    readonly maxRepairAttempts: number;
    readonly attachmentContextAllowed: boolean;
    readonly handoffVersion: 1;
  };
};

export type PlanningUserFailure = {
  readonly code: PlanningFailureCode;
  readonly message: string;
};

export type IntelligencePlanningTelemetry = {
  readonly task_complexity: TaskComplexity;
  readonly planning_outcome: "single_step" | "planned" | "unable_to_plan";
  readonly planner_source: "deterministic" | "model" | null;
  readonly step_count: number;
  readonly planner_model_calls: number;
  readonly repair_attempted: boolean;
  readonly failure_code: PlanningFailureCode | null;
  readonly planning_latency_ms: number;
};

export type IntelligenceDecision =
  | {
      readonly kind: "single_step";
      readonly route: IntelligenceRouteDecision;
      readonly telemetry: IntelligencePlanningTelemetry;
    }
  | {
      readonly kind: "multi_step";
      readonly handoff: PlannedExecutionHandoff;
      readonly telemetry: IntelligencePlanningTelemetry;
    }
  | {
      readonly kind: "unable_to_plan";
      readonly failure: PlanningUserFailure;
      readonly telemetry: IntelligencePlanningTelemetry;
    };

export type IntelligenceDecisionInput = {
  readonly prompt: string;
  readonly router: Omit<IntelligenceRouteInput, "prompt">;
  /** Broad kinds/counts only. Names and file contents are intentionally not accepted. */
  readonly attachments?: readonly PlannerAttachmentKind[];
  /** Planning availability only; callers may narrow the registry allowlist, never expand it. This is not execution authorization. */
  readonly availableCapabilities?: readonly string[];
};

export type IntelligenceDecisionCoordinatorOptions = {
  readonly plan?: (input: MultiStepPlannerInput) => Promise<PlanningResult>;
  readonly modelPlanningAllowed?: boolean;
  readonly attachmentContextAllowed?: boolean;
  readonly now?: () => number;
};

const USER_FAILURE_MESSAGES: Readonly<Record<PlanningFailureCode, string>> = Object.freeze({
  unsupported_objective: "I couldn't prepare a safe plan for that request. Try simplifying it.",
  missing_required_attachment: "Attach the file or image you want me to use, then try again.",
  invalid_model_plan: "I couldn't safely prepare a plan for that request. Try rephrasing it.",
  planner_unavailable: "Multi-step planning is temporarily unavailable. Please try again later.",
  plan_too_complex: "This request has too many dependent steps. Try simplifying it.",
  model_planning_disabled: "Multi-step planning isn't currently available for that request.",
});

export function mapPlanningFailureToUserSafeFailure(
  code: PlanningFailureCode,
): PlanningUserFailure {
  return Object.freeze({ code, message: USER_FAILURE_MESSAGES[code] });
}

function safeAvailableCapabilities(
  requested: readonly string[] | undefined,
  governance: PlannerGovernancePolicy,
): CapabilityId[] {
  const allowed = new Set(governance.allowedCapabilities);
  const candidates = requested ?? governance.allowedCapabilities;
  return [...new Set(candidates)].filter((id): id is CapabilityId => {
    const capability = CAPABILITY_REGISTRY.get(id);
    return Boolean(capability?.supportsPlanning && allowed.has(id as CapabilityId));
  });
}

function safeAttachmentKinds(input: IntelligenceDecisionInput): PlannerAttachmentKind[] {
  if (input.attachments) {
    return input.attachments.filter((kind): kind is PlannerAttachmentKind => kind === "file" || kind === "image");
  }

  return [
    ...(input.router.hasImageAttachment ? ["image" as const] : []),
    ...(input.router.hasDocumentAttachment ? ["file" as const] : []),
  ];
}

function attachmentCounts(attachments: readonly PlannerAttachmentKind[]) {
  return {
    imageCount: attachments.filter((kind) => kind === "image").length,
    fileCount: attachments.filter((kind) => kind === "file").length,
  };
}

function validPlannerExecutionMetadata(
  modelCalls: number,
  repairAttempted: boolean,
  governance: PlannerGovernancePolicy,
): boolean {
  return Number.isInteger(modelCalls) &&
    modelCalls >= 0 &&
    modelCalls <= governance.maxModelCalls &&
    (repairAttempted
      ? governance.maxRepairAttempts >= 1 && modelCalls === 2
      : modelCalls <= 1);
}

function jsonSafeValidatedPlan(
  plan: IntelligencePlan,
  expectedObjective: string,
): { readonly plan: IntelligencePlan; readonly orderedStepIds: readonly string[] } | null {
  if (plan.status !== "validated" || plan.objective !== expectedObjective) return null;
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid || validation.orderedStepIds.length !== plan.steps.length) return null;

  const graph = orderPlanSteps(plan.steps);
  if (!graph.ok || graph.orderedStepIds.length !== plan.steps.length) return null;

  const orderedIds = new Set(graph.orderedStepIds);
  if (orderedIds.size !== plan.steps.length || plan.steps.some(({ id }) => !orderedIds.has(id))) return null;

  const safePlan: IntelligencePlan = {
    objective: plan.objective,
    status: "validated",
    steps: plan.steps.map((step) => ({
      id: step.id,
      capability: step.capability,
      dependsOn: [...step.dependsOn],
      ...(step.inputs === undefined
        ? {}
        : {
            inputs: step.inputs.map((input): PlanInputRef =>
              input.source === "step"
                ? { source: "step", stepId: input.stepId, ...(input.output ? { output: input.output } : {}) }
                : input.source === "attachment"
                  ? { source: "attachment", ...(input.output ? { output: input.output } : {}) }
                  : { source: "user" },
            ),
          }),
      ...(step.expectedOutput ? { expectedOutput: step.expectedOutput } : {}),
    })),
  };

  try {
    JSON.stringify(safePlan);
  } catch {
    return null;
  }

  return { plan: safePlan, orderedStepIds: graph.orderedStepIds };
}

function telemetry(input: {
  readonly complexity: TaskComplexity;
  readonly outcome: IntelligencePlanningTelemetry["planning_outcome"];
  readonly source?: "deterministic" | "model" | null;
  readonly stepCount?: number;
  readonly modelCalls?: number;
  readonly repairAttempted?: boolean;
  readonly failureCode?: PlanningFailureCode | null;
  readonly startedAt: number;
  readonly now: () => number;
}): IntelligencePlanningTelemetry {
  return Object.freeze({
    task_complexity: input.complexity,
    planning_outcome: input.outcome,
    planner_source: input.source ?? null,
    step_count: input.stepCount ?? 0,
    planner_model_calls: input.modelCalls ?? 0,
    repair_attempted: input.repairAttempted ?? false,
    failure_code: input.failureCode ?? null,
    planning_latency_ms: Math.max(0, Math.round(input.now() - input.startedAt)),
  });
}

function unableToPlan(
  code: PlanningFailureCode,
  complexity: TaskComplexity,
  startedAt: number,
  now: () => number,
  modelCalls = 0,
  repairAttempted = false,
): IntelligenceDecision {
  return {
    kind: "unable_to_plan",
    failure: mapPlanningFailureToUserSafeFailure(code),
    telemetry: telemetry({
      complexity,
      outcome: "unable_to_plan",
      failureCode: code,
      modelCalls,
      repairAttempted,
      startedAt,
      now,
    }),
  };
}

export function createIntelligenceDecisionCoordinator(
  options: IntelligenceDecisionCoordinatorOptions = {},
) {
  const now = options.now ?? Date.now;
  const governance = createPlannerGovernancePolicy({
    modelPlanningAllowed: options.modelPlanningAllowed,
    attachmentContextAllowed: options.attachmentContextAllowed,
  });
  const plan = options.plan ?? planMultiStepObjective;

  return {
    async decideIntelligenceAction(input: IntelligenceDecisionInput): Promise<IntelligenceDecision> {
      const startedAt = now();
      const complexity = classifyTaskComplexity(input.prompt);

      // Explicit user-selected routes remain authoritative; planning is for Auto objectives.
      if (complexity === "single_step" || input.router.mode !== "auto") {
        return {
          kind: "single_step",
          route: selectIntelligenceRoute({ ...input.router, prompt: input.prompt }),
          telemetry: telemetry({
            complexity,
            outcome: "single_step",
            startedAt,
            now,
          }),
        };
      }

      const providedAttachments = safeAttachmentKinds(input);
      const attachments = governance.attachmentContextAllowed ? providedAttachments : [];
      const availableCapabilities = safeAvailableCapabilities(input.availableCapabilities, governance);
      let result: PlanningResult;
      try {
        result = await plan({
          objective: input.prompt,
          attachments,
          taskComplexity: complexity,
          availableCapabilities,
          modelPlanningAllowed: governance.modelPlanningAllowed,
        });
      } catch {
        return unableToPlan("planner_unavailable", complexity, startedAt, now);
      }

      if (result.kind === "single_step") {
        return unableToPlan("unsupported_objective", complexity, startedAt, now);
      }
      if (result.kind === "unable_to_plan") {
        if (!validPlannerExecutionMetadata(result.plannerModelCalls, result.repairAttempted, governance)) {
          return unableToPlan("invalid_model_plan", complexity, startedAt, now);
        }
        return unableToPlan(
          result.code,
          complexity,
          startedAt,
          now,
          result.plannerModelCalls,
          result.repairAttempted,
        );
      }

      const validExecutionMetadata = validPlannerExecutionMetadata(
        result.plannerModelCalls,
        result.repairAttempted,
        governance,
      ) &&
        (result.source !== "deterministic" || result.plannerModelCalls === 0) &&
        (result.source === "deterministic" || (result.source === "model" && result.plannerModelCalls >= 1)) &&
        (governance.modelPlanningAllowed || result.source === "deterministic");
      if (!validExecutionMetadata) {
        return unableToPlan("invalid_model_plan", complexity, startedAt, now);
      }

      const validated = jsonSafeValidatedPlan(result.plan, input.prompt.trim());
      if (!validated) {
        return unableToPlan(
          "invalid_model_plan",
          complexity,
          startedAt,
          now,
          result.plannerModelCalls,
          result.repairAttempted,
        );
      }

      const availableSet = new Set(availableCapabilities);
      const capabilityIds = [...new Set(validated.plan.steps.map(({ capability }) => capability))].sort();
      if (capabilityIds.some((id) => !availableSet.has(id))) {
        return unableToPlan(
          "invalid_model_plan",
          complexity,
          startedAt,
          now,
          result.plannerModelCalls,
          result.repairAttempted,
        );
      }

      if (!governance.attachmentContextAllowed && validated.plan.steps.some(
        ({ inputs }) => inputs?.some((reference) => reference.source === "attachment"),
      )) {
        return unableToPlan(
          "invalid_model_plan",
          complexity,
          startedAt,
          now,
          result.plannerModelCalls,
          result.repairAttempted,
        );
      }

      const counts = attachmentCounts(attachments);
      const handoff: PlannedExecutionHandoff = {
        version: governance.handoffVersion,
        objective: validated.plan.objective,
        plan: validated.plan,
        orderedStepIds: validated.orderedStepIds,
        plannerSource: result.source,
        ...(governance.attachmentContextAllowed && attachments.length > 0
          ? { attachmentContext: counts }
          : {}),
        governance: {
          maxSteps: governance.maxSteps,
          capabilityIds,
          modelPlanningAllowed: governance.modelPlanningAllowed,
          maxModelCalls: governance.maxModelCalls,
          maxRepairAttempts: governance.maxRepairAttempts,
          attachmentContextAllowed: governance.attachmentContextAllowed,
          handoffVersion: governance.handoffVersion,
        },
      };

      try {
        JSON.stringify(handoff);
      } catch {
        return unableToPlan(
          "invalid_model_plan",
          complexity,
          startedAt,
          now,
          result.plannerModelCalls,
          result.repairAttempted,
        );
      }

      return {
        kind: "multi_step",
        handoff,
        telemetry: telemetry({
          complexity,
          outcome: "planned",
          source: result.source,
          stepCount: validated.plan.steps.length,
          modelCalls: result.plannerModelCalls,
          repairAttempted: result.repairAttempted,
          startedAt,
          now,
        }),
      };
    },
  };
}

export const decideIntelligenceAction = createIntelligenceDecisionCoordinator().decideIntelligenceAction;

export { DEFAULT_PLANNER_GOVERNANCE_POLICY };
