import { z } from "zod";
import {
  CAPABILITY_REGISTRY,
  type CapabilityDefinition,
} from "@/lib/ai/capability-registry";
import type { IntelligencePlan, PlanInputRef, PlanStep } from "@/lib/ai/intelligence-plan";
import { orderPlanSteps } from "@/lib/ai/plan-graph";

export const MAX_INTELLIGENCE_PLAN_STEPS = 6;

const outputKinds = [
  "text",
  "search_results",
  "image",
  "structured_data",
  "artifact",
  "document",
] as const;

const inputRefSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("user") }).strict(),
  z.object({
    source: z.literal("attachment"),
    output: z.enum(["text", "image", "file", "structured_data"]).optional(),
  }).strict(),
  z.object({
    source: z.literal("step"),
    stepId: z.string().trim().min(1),
    output: z.enum(outputKinds).optional(),
  }).strict(),
]);

const planStepSchema = z.object({
  id: z.string().trim().min(1),
  capability: z.string().trim().min(1),
  dependsOn: z.array(z.string()),
  inputs: z.array(inputRefSchema).optional(),
  expectedOutput: z.enum(outputKinds).optional(),
}).strict();

const intelligencePlanSchema = z.object({
  objective: z.string().trim().min(1),
  steps: z.array(planStepSchema).min(1),
  status: z.enum(["draft", "validated", "invalid"]),
}).strict();

export type PlanValidationResult = {
  valid: boolean;
  errors: string[];
  orderedStepIds: string[];
};

function capabilityFor(id: string): CapabilityDefinition | undefined {
  return CAPABILITY_REGISTRY.get(id);
}

function compatibleInput(
  step: PlanStep,
  input: PlanInputRef,
  stepsById: ReadonlyMap<string, PlanStep>,
  errors: string[],
): void {
  if (input.source === "user") {
    if (!capabilityFor(step.capability)?.acceptedInputs.includes("text")) {
      errors.push(`Step "${step.id}" does not accept user text.`);
    }
    return;
  }

  if (input.source === "attachment") {
    const capability = capabilityFor(step.capability);
    if (!capability?.supportsAttachments) {
      errors.push(`Step "${step.id}" does not support attachments.`);
      return;
    }
    if (input.output && !capability.acceptedInputs.includes(input.output)) {
      errors.push(`Step "${step.id}" does not accept attachment output "${input.output}".`);
    }
    return;
  }

  if (!step.dependsOn.includes(input.stepId)) {
    errors.push(`Step "${step.id}" references "${input.stepId}" without declaring it as a dependency.`);
    return;
  }

  const sourceStep = stepsById.get(input.stepId);
  const sourceCapability = sourceStep && capabilityFor(sourceStep.capability);
  const targetCapability = capabilityFor(step.capability);
  if (!sourceCapability || !targetCapability) return;

  const declaredOutput = input.output ?? sourceStep?.expectedOutput;
  if (input.output && sourceStep?.expectedOutput && input.output !== sourceStep.expectedOutput) {
    errors.push(`Step "${step.id}" input output does not match the expected output from "${input.stepId}".`);
    return;
  }
  if (declaredOutput) {
    if (!sourceCapability.producedOutputs.includes(declaredOutput)) {
      errors.push(`Step "${input.stepId}" cannot produce "${declaredOutput}".`);
    } else if (!targetCapability.acceptedInputs.some((accepted) => accepted === declaredOutput)) {
      errors.push(`Step "${step.id}" cannot accept "${declaredOutput}" from "${input.stepId}".`);
    }
    return;
  }

  if (!sourceCapability.producedOutputs.some((output) => targetCapability.acceptedInputs.some((accepted) => accepted === output))) {
    errors.push(`Step "${step.id}" has no compatible input from "${input.stepId}".`);
  }
}

export function validateIntelligencePlan(input: unknown): PlanValidationResult {
  const parsed = intelligencePlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => issue.message),
      orderedStepIds: [],
    };
  }

  const plan = parsed.data as IntelligencePlan;
  const errors: string[] = [];
  if (plan.steps.length > MAX_INTELLIGENCE_PLAN_STEPS) {
    errors.push(`A plan may contain at most ${MAX_INTELLIGENCE_PLAN_STEPS} steps.`);
  }

  const stepsById = new Map<string, PlanStep>();
  for (const step of plan.steps) {
    if (stepsById.has(step.id)) errors.push(`Duplicate step id: "${step.id}".`);
    else stepsById.set(step.id, step);
    if (!CAPABILITY_REGISTRY.has(step.capability)) {
      errors.push(`Unknown capability "${step.capability}" in step "${step.id}".`);
      continue;
    }
  }

  const graphResult = orderPlanSteps(plan.steps);
  if (!graphResult.ok) {
    const message = {
      missing_dependency: "A step references a missing dependency.",
      self_dependency: "A step cannot depend on itself.",
      cycle: "Plan dependencies must not contain a cycle.",
    }[graphResult.reason];
    errors.push(message);
  }

  for (const step of plan.steps) {
    const capability = capabilityFor(step.capability);
    if (!capability) continue;
    const inputs = step.inputs ?? [];
    if (capability.requiresAttachment && !inputs.some((item) => item.source === "attachment")) {
      errors.push(`Step "${step.id}" requires an attachment input.`);
    }
    for (const inputRef of inputs) compatibleInput(step, inputRef, stepsById, errors);
    if (step.expectedOutput && !capability.producedOutputs.includes(step.expectedOutput)) {
      errors.push(`Step "${step.id}" cannot produce expected output "${step.expectedOutput}".`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    orderedStepIds: graphResult.ok ? graphResult.orderedStepIds : [],
  };
}
