import { z } from "zod";
import {
  CAPABILITY_REGISTRY,
  type CapabilityId,
  type CapabilityOutputKind,
} from "@/lib/ai/capability-registry";
import type { IntelligencePlan, PlanInputRef, PlanStep } from "@/lib/ai/intelligence-plan";
import { hasCurrentInformationIntent, hasFileAnalysisIntent } from "@/lib/ai/intelligence-router";
import { MAX_INTELLIGENCE_PLAN_STEPS, validateIntelligencePlan } from "@/lib/ai/plan-validator";
import {
  createOpenAIMultiStepPlannerModelClient,
  MalformedStructuredPlanResponseError,
  type MultiStepPlannerModelClient,
  type PlannerAttachmentKind,
} from "@/lib/ai/multi-step-planner-model-client";
import { hasArtifactCreationIntent, classifyTaskComplexity, type TaskComplexity } from "@/lib/ai/task-complexity";

export type PlanningFailureCode =
  | "unsupported_objective"
  | "missing_required_attachment"
  | "invalid_model_plan"
  | "planner_unavailable"
  | "plan_too_complex";

export type PlanningResult =
  | { readonly kind: "single_step" }
  | {
      readonly kind: "planned";
      readonly plan: IntelligencePlan;
      readonly source: "deterministic" | "model";
    }
  | { readonly kind: "unable_to_plan"; readonly code: PlanningFailureCode };

export type MultiStepPlannerInput = {
  readonly objective: string;
  /** Only attachment kinds are used; names and file contents never enter a plan. */
  readonly attachments?: readonly PlannerAttachmentKind[];
  readonly taskComplexity?: TaskComplexity;
  /** External callers may narrow the registry allowlist, but cannot add IDs. */
  readonly availableCapabilities?: readonly string[];
};

const outputKinds = [
  "text",
  "search_results",
  "image",
  "structured_data",
  "artifact",
  "document",
] as const satisfies readonly CapabilityOutputKind[];

const plannerFailureCodes = [
  "unsupported_objective",
  "missing_required_attachment",
  "plan_too_complex",
] as const;

const modelInputSchema = z.object({
  source: z.enum(["user", "attachment", "step"]),
  stepId: z.string().nullable(),
  output: z.enum(outputKinds).nullable(),
}).strict();

const modelStepSchema = z.object({
  id: z.string(),
  capability: z.string(),
  dependsOn: z.array(z.string()),
  inputs: z.array(modelInputSchema),
  expectedOutput: z.enum(outputKinds).nullable(),
}).strict();

const modelResponseSchema = z.object({
  kind: z.enum(["planned", "unable_to_plan"]),
  failureCode: z.enum(plannerFailureCodes).nullable(),
  steps: z.array(modelStepSchema),
}).strict();

type ParsedModelResponse = z.infer<typeof modelResponseSchema>;

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function availableCapabilityIds(input: MultiStepPlannerInput): CapabilityId[] {
  const requested = input.availableCapabilities ?? CAPABILITY_REGISTRY.all().map(({ id }) => id);
  return unique(requested).filter((id): id is CapabilityId => {
    const definition = CAPABILITY_REGISTRY.get(id);
    return Boolean(definition?.supportsPlanning);
  });
}

function hasExplicitAttachmentReference(objective: string): boolean {
  return /\b(?:this|that)\b.{0,40}\b(?:file|spreadsheet|workbook|sheet|image|picture|photo|pdf|document|report|data)\b|\b(?:attached|uploaded)\b.{0,30}\b(?:file|spreadsheet|workbook|sheet|image|picture|photo|pdf|document|report|data)\b/i.test(objective);
}

function isResearchObjective(objective: string): boolean {
  return hasCurrentInformationIntent(objective) || /\b(?:search|research|look\s+up)\b/i.test(objective);
}

function deterministicPlan(
  objective: string,
  attachments: readonly PlannerAttachmentKind[],
  allowed: ReadonlySet<CapabilityId>,
): { readonly kind: "plan"; readonly plan: IntelligencePlan } | { readonly kind: "failure"; readonly code: PlanningFailureCode } | null {
  if (!hasArtifactCreationIntent(objective)) return null;

  const analyzeIntent = hasFileAnalysisIntent(objective);
  const research = isResearchObjective(objective);
  const fileAnalysis = attachments.length > 0 && (analyzeIntent || hasExplicitAttachmentReference(objective));

  if (attachments.length === 0 && hasExplicitAttachmentReference(objective)) {
    return { kind: "failure", code: "missing_required_attachment" };
  }
  if (!research && !fileAnalysis) return null;

  const required: CapabilityId[] = [
    ...(research ? ["web_search" as const] : []),
    ...(fileAnalysis ? ["file_analysis" as const] : []),
    "standard",
    "document_generation",
  ];
  if (required.some((capability) => !allowed.has(capability))) {
    return { kind: "failure", code: "unsupported_objective" };
  }

  const steps: PlanStep[] = [];
  const sourceStepIds: string[] = [];

  if (research) {
    const id = `step-${steps.length + 1}`;
    steps.push({
      id,
      capability: "web_search",
      dependsOn: [],
      inputs: [{ source: "user" }],
      expectedOutput: "search_results",
    });
    sourceStepIds.push(id);
  }

  if (fileAnalysis) {
    const id = `step-${steps.length + 1}`;
    steps.push({
      id,
      capability: "file_analysis",
      dependsOn: [],
      inputs: unique(attachments).map((kind) => ({ source: "attachment", output: kind })),
      expectedOutput: "text",
    });
    sourceStepIds.push(id);
  }

  const synthesisId = `step-${steps.length + 1}`;
  steps.push({
    id: synthesisId,
    capability: "standard",
    dependsOn: [...sourceStepIds],
    inputs: sourceStepIds.map((stepId) => ({ source: "step", stepId })),
    expectedOutput: "text",
  });
  steps.push({
    id: `step-${steps.length + 1}`,
    capability: "document_generation",
    dependsOn: [synthesisId],
    inputs: [{ source: "step", stepId: synthesisId, output: "text" }],
    expectedOutput: "document",
  });

  return {
    kind: "plan",
    plan: { objective, steps, status: "draft" },
  };
}

function normalizeInput(input: z.infer<typeof modelInputSchema>): PlanInputRef | null {
  if (input.source === "user") {
    return input.stepId === null && input.output === null ? { source: "user" } : null;
  }
  if (input.source === "attachment") {
    if (input.stepId !== null) return null;
    if (input.output !== null && !["text", "image", "file", "structured_data"].includes(input.output)) return null;
    return {
      source: "attachment",
      ...(input.output ? { output: input.output as "text" | "image" | "file" | "structured_data" } : {}),
    };
  }
  if (!input.stepId) return null;
  return {
    source: "step",
    stepId: input.stepId,
    ...(input.output ? { output: input.output } : {}),
  };
}

function normalizeModelResponse(value: unknown, objective: string):
  | { readonly kind: "plan"; readonly plan: IntelligencePlan }
  | { readonly kind: "unable"; readonly code: PlanningFailureCode }
  | { readonly kind: "invalid" } {
  const parsed = modelResponseSchema.safeParse(value);
  if (!parsed.success) return { kind: "invalid" };

  const response: ParsedModelResponse = parsed.data;
  if (response.kind === "unable_to_plan") {
    if (response.failureCode === null || response.steps.length > 0) return { kind: "invalid" };
    return { kind: "unable", code: response.failureCode };
  }
  if (response.failureCode !== null || response.steps.length === 0) return { kind: "invalid" };

  const steps: PlanStep[] = [];
  for (const step of response.steps) {
    const inputs = step.inputs.map(normalizeInput);
    if (inputs.some((input) => input === null)) return { kind: "invalid" };
    steps.push({
      id: step.id,
      capability: step.capability as CapabilityId,
      dependsOn: step.dependsOn,
      inputs: inputs as PlanInputRef[],
      ...(step.expectedOutput ? { expectedOutput: step.expectedOutput } : {}),
    });
  }

  return { kind: "plan", plan: { objective, steps, status: "draft" } };
}

function errorsForPlan(plan: IntelligencePlan, available: ReadonlySet<CapabilityId>): string[] {
  const result = validateIntelligencePlan(plan);
  const unavailable = plan.steps
    .filter(({ capability }) => !available.has(capability))
    .map(({ id, capability }) => `Step "${id}" uses unavailable capability "${capability}".`);
  if (plan.steps.length < 2) unavailable.push("A multi-step plan must contain at least two steps.");
  return [...result.errors, ...unavailable];
}

function validatedResult(plan: IntelligencePlan, source: "deterministic" | "model"): PlanningResult {
  return {
    kind: "planned",
    plan: { ...plan, status: "validated" },
    source,
  };
}

function isTooComplex(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("steps" in value) || !Array.isArray(value.steps)) return false;
  return value.steps.length > MAX_INTELLIGENCE_PLAN_STEPS;
}

export function createMultiStepPlanner(
  modelClient: MultiStepPlannerModelClient = createOpenAIMultiStepPlannerModelClient(),
) {
  return {
    async plan(input: MultiStepPlannerInput): Promise<PlanningResult> {
      const objective = input.objective.trim();
      if (!objective) return { kind: "unable_to_plan", code: "unsupported_objective" };

      const complexity = input.taskComplexity ?? classifyTaskComplexity(objective);
      if (complexity === "single_step") return { kind: "single_step" };

      const available = availableCapabilityIds(input);
      if (available.length === 0) return { kind: "unable_to_plan", code: "unsupported_objective" };
      const availableSet = new Set(available);
      const attachments = unique(input.attachments ?? []);
      const deterministic = deterministicPlan(objective, attachments, availableSet);

      if (deterministic?.kind === "failure") {
        return { kind: "unable_to_plan", code: deterministic.code };
      }
      if (deterministic?.kind === "plan") {
        const validationErrors = errorsForPlan(deterministic.plan, availableSet);
        if (validationErrors.length > 0) {
          throw new Error(`Deterministic planner produced an invalid plan: ${validationErrors.join(" ")}`);
        }
        return validatedResult(deterministic.plan, "deterministic");
      }

      const capabilities = available.map((id) => CAPABILITY_REGISTRY.get(id)!).filter(Boolean);
      const request = { objective, attachments, capabilities };
      let firstResponse: unknown;
      try {
        firstResponse = await modelClient.generateStructuredPlan(request);
      } catch (error) {
        return {
          kind: "unable_to_plan",
          code: error instanceof MalformedStructuredPlanResponseError ? "invalid_model_plan" : "planner_unavailable",
        };
      }

      if (isTooComplex(firstResponse)) {
        return { kind: "unable_to_plan", code: "plan_too_complex" };
      }
      const first = normalizeModelResponse(firstResponse, objective);
      if (first.kind === "unable") return { kind: "unable_to_plan", code: first.code };
      if (first.kind === "invalid") return { kind: "unable_to_plan", code: "invalid_model_plan" };

      const firstErrors = errorsForPlan(first.plan, availableSet);
      if (firstErrors.length === 0) return validatedResult(first.plan, "model");

      let repairResponse: unknown;
      try {
        repairResponse = await modelClient.generateStructuredPlan({
          ...request,
          repair: { candidate: firstResponse, validationErrors: firstErrors },
        });
      } catch (error) {
        return {
          kind: "unable_to_plan",
          code: error instanceof MalformedStructuredPlanResponseError ? "invalid_model_plan" : "planner_unavailable",
        };
      }

      if (isTooComplex(repairResponse)) {
        return { kind: "unable_to_plan", code: "plan_too_complex" };
      }
      const repaired = normalizeModelResponse(repairResponse, objective);
      if (repaired.kind === "unable") return { kind: "unable_to_plan", code: repaired.code };
      if (repaired.kind === "invalid" || errorsForPlan(repaired.plan, availableSet).length > 0) {
        return { kind: "unable_to_plan", code: "invalid_model_plan" };
      }
      return validatedResult(repaired.plan, "model");
    },
  };
}

const defaultPlanner = createMultiStepPlanner();

export function planMultiStepObjective(input: MultiStepPlannerInput): Promise<PlanningResult> {
  return defaultPlanner.plan(input);
}
