import { z } from "zod";
import { CAPABILITY_REGISTRY, type CapabilityId, type CapabilityOutputKind } from "@/lib/ai/capability-registry";
import type { PlanInputRef, PlanStep } from "@/lib/ai/intelligence-plan";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type {
  CapabilityExecutionInput,
  CapabilityExecutor,
  ExecutionAuthorizationInput,
  ExecutionAuthorizer,
  ExecutionRuntimeInput,
  RequestMessageBindingValidator,
  ResolvedExecutionInput,
  RuntimeAttachmentReference,
} from "@/lib/agent-runtime/capability-executor";
import {
  conversationExecutionContextSchema,
  requestMessageBindingSchema,
} from "@/lib/agent-runtime/application-contracts";
import {
  isJsonValue,
  type ExecutionFailure,
  type ExecutionFailureCode,
  type ExecutionOperationalMetadata,
  type ExecutionOutcome,
  type ExecutionRun,
  type ExecutionStep,
  type ExecutionStepResult,
} from "@/lib/agent-runtime/runtime-contracts";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";

if (typeof window !== "undefined") {
  throw new Error("LVTChat execution runtime is server-only");
}

const MAX_RESULT_JSON_BYTES = 64 * 1024;

const handoffSchema = z.object({
  version: z.number().int(),
  objective: z.string().min(1),
  plan: z.unknown(),
  orderedStepIds: z.array(z.string().min(1)),
  plannerSource: z.enum(["deterministic", "model"]),
  attachmentContext: z.object({ imageCount: z.number().int().nonnegative(), fileCount: z.number().int().nonnegative() }).strict().optional(),
  governance: z.object({
    maxSteps: z.number().int().min(1).max(6),
    capabilityIds: z.array(z.string().min(1)),
    modelPlanningAllowed: z.boolean(),
    maxModelCalls: z.number().int().min(0).max(2),
    maxRepairAttempts: z.number().int().min(0).max(1),
    attachmentContextAllowed: z.boolean(),
    handoffVersion: z.number().int(),
  }).strict(),
}).strict();

const FAILURE_MESSAGES: Readonly<Record<ExecutionFailureCode, string>> = Object.freeze({
  invalid_handoff: "The execution request is invalid or incompatible.",
  unsupported_capability: "The requested capability is not supported by this runtime.",
  missing_input: "A required execution input is unavailable.",
  missing_predecessor_result: "A required prior step result is unavailable.",
  authorization_denied: "This action is not authorized.",
  authorization_failed: "Authorization could not be verified.",
  executor_failed: "The requested step could not be completed.",
  invalid_executor_result: "The requested step returned an invalid result.",
  ownership_denied: "This execution is unavailable.",
  idempotency_conflict: "This idempotency key is already bound to another execution request.",
  snapshot_conflict: "Execution state changed while this checkpoint was being saved.",
  indeterminate_step: "A step may have started before interruption and cannot be safely replayed.",
  invalid_persisted_state: "The stored execution state is invalid.",
  unsupported_handoff_version: "The stored execution handoff version is not supported.",
  unsupported_snapshot_version: "The stored execution snapshot version is not supported.",
  invalid_snapshot: "The stored execution snapshot is invalid.",
  persistence_failed: "Execution state could not be safely persisted.",
});

export function executionFailure(code: ExecutionFailureCode): ExecutionFailure {
  return Object.freeze({ code, message: FAILURE_MESSAGES[code] });
}

export function validateExecutionHandoff(input: unknown): { handoff: PlannedExecutionHandoff; failure?: never } | { handoff?: never; failure: ExecutionFailure } {
  const parsed = handoffSchema.safeParse(input);
  if (!parsed.success) return { failure: executionFailure("invalid_handoff") };
  const raw = parsed.data;
  if (raw.version !== 1 || raw.governance.handoffVersion !== 1) return { failure: executionFailure("invalid_handoff") };
  if ((raw.plannerSource === "model" && !raw.governance.modelPlanningAllowed)
    || (!raw.governance.attachmentContextAllowed && raw.attachmentContext !== undefined)) {
    return { failure: executionFailure("invalid_handoff") };
  }

  if (raw.plan !== null && typeof raw.plan === "object" && "steps" in raw.plan && Array.isArray(raw.plan.steps)) {
    if (raw.plan.steps.some((step) => step !== null && typeof step === "object"
      && "capability" in step && typeof step.capability === "string"
      && !CAPABILITY_REGISTRY.has(step.capability))) {
      return { failure: executionFailure("unsupported_capability") };
    }
  }

  const validation = validateIntelligencePlan(raw.plan);
  if (!validation.valid || raw.objective !== (raw.plan as { objective?: unknown }).objective
    || (raw.plan as { status?: unknown }).status !== "validated"
    || validation.orderedStepIds.length > raw.governance.maxSteps
    || raw.orderedStepIds.length !== validation.orderedStepIds.length
    || raw.orderedStepIds.some((id, index) => id !== validation.orderedStepIds[index])) {
    return { failure: executionFailure("invalid_handoff") };
  }

  const capabilities = new Set<string>(raw.governance.capabilityIds);
  if (capabilities.size !== raw.governance.capabilityIds.length
    || raw.governance.capabilityIds.some((id) => !CAPABILITY_REGISTRY.has(id))
    || (raw.plan as { steps: PlanStep[] }).steps.some((step) => !capabilities.has(step.capability))) {
    return { failure: executionFailure("invalid_handoff") };
  }

  return { handoff: raw as PlannedExecutionHandoff };
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function validateExecutionStepResult(value: unknown, capabilityId: CapabilityId): value is ExecutionStepResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(result).some((key) => !["kind", "value", "ref"].includes(key))) return false;
  const capability = CAPABILITY_REGISTRY.get(capabilityId);
  if (!capability || typeof result.kind !== "string"
    || !capability.producedOutputs.includes(result.kind as CapabilityOutputKind)) return false;
  const hasValue = Object.prototype.hasOwnProperty.call(result, "value");
  const hasRef = Object.prototype.hasOwnProperty.call(result, "ref");
  if (!hasValue && !hasRef) return false;
  if (hasValue && !isJsonValue(result.value)) return false;
  if (hasRef) {
    if (result.ref === null || typeof result.ref !== "object" || Array.isArray(result.ref)) return false;
    const ref = result.ref as Record<string, unknown>;
    if (Object.getPrototypeOf(result.ref) !== Object.prototype
      || Object.keys(ref).some((key) => !["id", "kind"].includes(key))
      || typeof ref.id !== "string" || !safeId(ref.id)
      || !["artifact", "document", "image", "file"].includes(String(ref.kind))) return false;
  }
  try {
    return jsonBytes(value) <= MAX_RESULT_JSON_BYTES;
  } catch {
    return false;
  }
}

function recordForResult(value: ExecutionStepResult): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function isStepResult(value: unknown): value is ExecutionStepResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.kind === "string" && ("value" in result || "ref" in result);
}

function attachmentKindFor(input: PlanInputRef): "file" | "image" | null {
  if (input.source !== "attachment") return null;
  if (input.output === "image") return "image";
  if (input.output === "file") return "file";
  return null;
}

export function resolveExecutionInputs(
  step: PlanStep,
  handoff: PlannedExecutionHandoff,
  runtimeInput: ExecutionRuntimeInput,
  results: Readonly<Record<string, unknown>>,
): { inputs: ResolvedExecutionInput[]; resourceReferences: string[]; failure?: never } | { failure: ExecutionFailure; inputs?: never; resourceReferences?: never } {
  const inputs: ResolvedExecutionInput[] = [];
  const refs = new Set(runtimeInput.resourceReferences ?? []);
  for (const input of step.inputs ?? []) {
    if (input.source === "user") {
      inputs.push({ source: "user", value: runtimeInput.userInput ?? handoff.objective });
      continue;
    }
    if (input.source === "attachment") {
      const kind = attachmentKindFor(input);
      const matches = (runtimeInput.attachments ?? [])
        .filter((attachment) => kind === null || attachment.kind === kind)
        .map(({ id, kind: attachmentKind }): RuntimeAttachmentReference => ({ id, kind: attachmentKind }));
      if (matches.length === 0) return { failure: executionFailure("missing_input") };
      for (const reference of matches) {
        inputs.push({ source: "attachment", reference });
        refs.add(reference.id);
      }
      continue;
    }
    const result = results[input.stepId];
    if (!isStepResult(result)) return { failure: executionFailure("missing_predecessor_result") };
    if (input.output && result.kind !== input.output) return { failure: executionFailure("missing_predecessor_result") };
    if (result.ref) refs.add(result.ref.id);
    inputs.push({ source: "step", stepId: input.stepId, result });
  }
  return { inputs, resourceReferences: [...refs].filter(safeId) };
}

function updateStep(run: ExecutionRun, stepId: string, patch: Partial<ExecutionStep>): ExecutionRun {
  return {
    ...run,
    steps: run.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
  };
}

function toStepResultRecord(results: Readonly<Record<string, unknown>>): Record<string, ExecutionStepResult> {
  return Object.fromEntries(Object.entries(results).filter((entry): entry is [string, ExecutionStepResult] => isStepResult(entry[1])));
}

function makeTelemetry(run: ExecutionRun, failureCode: ExecutionFailureCode | null): ExecutionOperationalMetadata {
  return Object.freeze({
    execution_id: run.id,
    status: run.status as "succeeded" | "failed",
    step_count: run.steps.length,
    completed_step_count: run.steps.filter((step) => step.status === "succeeded" || step.status === "failed" || step.status === "skipped").length,
    current_step_id: null,
    capability_steps: Object.freeze(run.steps.map((step) => Object.freeze({
      step_id: step.id,
      capability: step.capability,
      status: step.status,
      attempt: step.attempt,
    }))),
    runtime_duration_ms: Math.max(0, Date.parse(run.completedAt ?? run.createdAt) - Date.parse(run.startedAt ?? run.createdAt)),
    failure_code: failureCode,
  });
}

export type XStateExecutionAdapterOptions = {
  readonly createExecutionId: () => string;
  readonly now: () => Date;
  readonly requestMessageBindingValidator: RequestMessageBindingValidator;
};

export class XStateExecutionAdapter {
  constructor(private readonly options: XStateExecutionAdapterOptions) {}

  async execute(
    handoffInput: unknown,
    runtimeInput: ExecutionRuntimeInput,
    executor: CapabilityExecutor,
    authorizer: ExecutionAuthorizer,
  ): Promise<ExecutionOutcome> {
    const checked = validateExecutionHandoff(handoffInput);
    if (!checked.handoff) return { kind: "rejected", failure: checked.failure };
    const handoff = checked.handoff;
    const requestBinding = requestMessageBindingSchema.safeParse(runtimeInput.requestMessageBinding);
    const stableRequestBinding = requestBinding.success
      ? Object.freeze({ ...requestBinding.data })
      : null;
    if (!conversationExecutionContextSchema.safeParse({
      authenticatedUserId: runtimeInput.authenticatedUserId,
      conversationId: runtimeInput.conversationId,
    }).success
      || !requestBinding.success
      || !stableRequestBinding
      || stableRequestBinding.userId !== runtimeInput.authenticatedUserId
      || stableRequestBinding.conversationId !== runtimeInput.conversationId
      || (runtimeInput.requestId !== undefined && runtimeInput.requestId !== stableRequestBinding.requestId)
      || (runtimeInput.userInput !== undefined && typeof runtimeInput.userInput !== "string")
      || (runtimeInput.organizationId !== undefined && !safeId(runtimeInput.organizationId))
      || (runtimeInput.requestId !== undefined && !safeId(runtimeInput.requestId))
      || (runtimeInput.correlationId !== undefined && !safeId(runtimeInput.correlationId))
      || (runtimeInput.resourceReferences !== undefined
        && (!Array.isArray(runtimeInput.resourceReferences) || runtimeInput.resourceReferences.some((ref) => typeof ref !== "string" || !safeId(ref))))
      || (runtimeInput.attachments !== undefined
        && (!Array.isArray(runtimeInput.attachments) || runtimeInput.attachments.some((item) => !item || !safeId(item.id) || !["file", "image"].includes(item.kind))))) {
      return { kind: "rejected", failure: executionFailure("invalid_handoff") };
    }

    let bindingIsValid = false;
    try {
      bindingIsValid = await this.options.requestMessageBindingValidator.validate(stableRequestBinding);
    } catch {
      bindingIsValid = false;
    }
    if (!bindingIsValid) return { kind: "rejected", failure: executionFailure("ownership_denied") };

    const executionId = this.options.createExecutionId();
    const createdAt = this.options.now().toISOString();
    const initialRun: ExecutionRun = {
      id: executionId,
      handoffVersion: handoff.version,
      objective: handoff.objective,
      status: "pending",
      createdAt,
      orderedStepIds: [...handoff.orderedStepIds],
      steps: handoff.plan.steps.map((step) => ({
        id: step.id,
        capability: step.capability,
        status: "pending",
        dependsOn: [...step.dependsOn],
        attempt: 1,
      })),
    };

    const runLifecycle = createExecutionRunLifecycle();
    const stepsById = new Map(handoff.plan.steps.map((step) => [step.id, step]));
    const results: Record<string, unknown> = {};
    const failureState: { value: ExecutionFailure | null } = { value: null };
    let run = initialRun;

    runLifecycle.start();
    run = { ...run, status: runLifecycle.status, startedAt: createdAt };

    for (const stepId of handoff.orderedStepIds) {
      const step = stepsById.get(stepId)!;
      const stepLifecycle = createExecutionStepLifecycle();
      const failedDependency = step.dependsOn.some((dependencyId) => (
        run.steps.find((candidate) => candidate.id === dependencyId)?.status !== "succeeded"
      ));

      if (failedDependency) {
        stepLifecycle.skip();
        run = updateStep(run, step.id, {
          status: stepLifecycle.status,
          completedAt: this.options.now().toISOString(),
          errorCode: "dependency_failed",
        });
        stepLifecycle.stop();
        continue;
      }

      const startedAt = this.options.now().toISOString();
      stepLifecycle.start();
      run = updateStep(run, step.id, { status: stepLifecycle.status, startedAt });
      const markFailed = (error: ExecutionFailure) => {
        stepLifecycle.fail();
        run = updateStep(run, step.id, {
          status: stepLifecycle.status,
          completedAt: this.options.now().toISOString(),
          errorCode: error.code,
        });
        failureState.value ??= error;
      };

      const resolved = resolveExecutionInputs(step, handoff, runtimeInput, results);
      if (!resolved.inputs) {
        markFailed(resolved.failure);
        stepLifecycle.stop();
        continue;
      }

      const capabilityId = step.capability as CapabilityId;
      const authInput: ExecutionAuthorizationInput = {
        executionId,
        stepId: step.id,
        capabilityId,
        authenticatedUserId: runtimeInput.authenticatedUserId,
        conversationId: runtimeInput.conversationId,
        requestMessageBinding: stableRequestBinding,
        ...(runtimeInput.organizationId ? { organizationId: runtimeInput.organizationId } : {}),
        resourceReferences: resolved.resourceReferences,
        requestId: stableRequestBinding.requestId,
        ...(runtimeInput.correlationId ? { correlationId: runtimeInput.correlationId } : {}),
      };

      let authorization;
      try {
        authorization = await authorizer.authorize(authInput);
      } catch {
        markFailed(executionFailure("authorization_failed"));
        stepLifecycle.stop();
        continue;
      }
      if (authorization === null || typeof authorization !== "object" || typeof authorization.allowed !== "boolean") {
        markFailed(executionFailure("authorization_failed"));
        stepLifecycle.stop();
        continue;
      }
      if (!authorization.allowed) {
        markFailed(executionFailure("authorization_denied"));
        stepLifecycle.stop();
        continue;
      }

      const executionInput: CapabilityExecutionInput = {
        executionId,
        stepId: step.id,
        capabilityId,
        inputs: resolved.inputs,
        context: {
          authenticatedUserId: runtimeInput.authenticatedUserId,
          conversationId: runtimeInput.conversationId,
          requestMessageBinding: stableRequestBinding,
          ...(runtimeInput.organizationId ? { organizationId: runtimeInput.organizationId } : {}),
          resourceReferences: resolved.resourceReferences,
          requestId: stableRequestBinding.requestId,
          ...(runtimeInput.correlationId ? { correlationId: runtimeInput.correlationId } : {}),
        },
      };

      let result: unknown;
      try {
        result = await executor.execute(executionInput);
      } catch {
        markFailed(executionFailure("executor_failed"));
        stepLifecycle.stop();
        continue;
      }
      let resultIsValid = false;
      try {
        resultIsValid = validateExecutionStepResult(result, capabilityId);
      } catch {
        resultIsValid = false;
      }
      if (!resultIsValid) {
        markFailed(executionFailure("invalid_executor_result"));
        stepLifecycle.stop();
        continue;
      }

      stepLifecycle.succeed();
      run = updateStep(run, step.id, {
        status: stepLifecycle.status,
        completedAt: this.options.now().toISOString(),
        resultRef: `in_memory:${executionId}:${step.id}`,
      });
      results[step.id] = recordForResult(result as ExecutionStepResult);
      stepLifecycle.stop();
    }

    if (failureState.value) runLifecycle.fail();
    else runLifecycle.succeed();
    const completedAt = this.options.now().toISOString();
    run = { ...run, status: runLifecycle.status, completedAt };
    runLifecycle.stop();

    const stepResults = Object.freeze(toStepResultRecord(results));
    const safeFailure = failureState.value;
    if (safeFailure) {
      return { kind: "failed", run, failure: safeFailure, stepResults, telemetry: makeTelemetry(run, safeFailure.code) };
    }
    return { kind: "succeeded", run, stepResults, telemetry: makeTelemetry(run, null) };
  }
}
