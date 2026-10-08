import { createHash, randomUUID } from "node:crypto";
import { CAPABILITY_REGISTRY, type CapabilityId } from "@/lib/ai/capability-registry";
import type { PlanStep } from "@/lib/ai/intelligence-plan";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import type {
  CapabilityExecutionInput,
  CapabilityExecutor,
  ExecutionAuthorizer,
  ExecutionRuntimeInput,
  RequestMessageBindingValidator,
} from "@/lib/agent-runtime/capability-executor";
import { CapabilityAdapterError } from "@/lib/agent-runtime/capability-adapters/common";
import { decideRetry } from "@/lib/agent-runtime/retry-policy";
import { requestMessageBindingSchema } from "@/lib/agent-runtime/application-contracts";
import {
  type AcceptedRequestExecutionIdentity,
  type CreateDurableExecutionRunInput,
  EXECUTION_RUNTIME_VERSION,
  EXECUTION_SNAPSHOT_SCHEMA_VERSION,
  type CreateDurableExecutionRunResult,
  type DurableExecutionRun,
  type DurableExecutionStep,
  type DurableStepCheckpoint,
  type ExecutionSnapshotEnvelope,
  type ExecutionStore,
  type PersistedExecutionPlan,
} from "@/lib/agent-runtime/execution-store";
import { ExecutionSnapshotError, validateExecutionSnapshot } from "@/lib/agent-runtime/execution-snapshot";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import {
  executionFailure,
  resolveExecutionInputs,
  validateExecutionHandoff,
  validateExecutionStepResult,
} from "@/lib/agent-runtime/xstate-runtime-adapter";
import {
  executionResultJsonBytes,
  MAX_DURABLE_RESULT_PAYLOAD_BYTES,
} from "@/lib/agent-runtime/result-payload-contract";
import {
  type ExecutionFailure,
  type ExecutionOutcome,
  type ExecutionRun,
  type ExecutionStepResult,
  type ExecutionOperationalMetadata,
  type ExecutionControlCommandResult,
  type HumanApprovalCheckpoint,
  executionRunSchema,
  executionStepSchema,
  EXECUTION_CONTROL_STATES,
  EXECUTION_FAILURE_CODES,
  MAX_EXECUTION_STEP_ATTEMPTS,
} from "@/lib/agent-runtime/runtime-contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safeRuntimeInput(input: ExecutionRuntimeInput): boolean {
  const safeId = (value: string) => value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
  return UUID_PATTERN.test(input.authenticatedUserId)
    && UUID_PATTERN.test(input.conversationId)
    && requestMessageBindingSchema.safeParse(input.requestMessageBinding).success
    && input.requestMessageBinding.userId === input.authenticatedUserId
    && input.requestMessageBinding.conversationId === input.conversationId
    && (input.requestId === undefined || input.requestId === input.requestMessageBinding.requestId)
    && (input.userInput === undefined || typeof input.userInput === "string")
    && (input.organizationId === undefined || safeId(input.organizationId))
    && (input.requestId === undefined || safeId(input.requestId))
    && (input.correlationId === undefined || safeId(input.correlationId))
    && (input.resourceReferences === undefined || input.resourceReferences.every((ref) => typeof ref === "string" && safeId(ref)))
    && (input.attachments === undefined || input.attachments.every((item) => Boolean(item)
      && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 200
      && (item.kind === "file" || item.kind === "image")));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function safePlan(handoff: PlannedExecutionHandoff): PersistedExecutionPlan {
  return {
    version: 1,
    steps: handoff.plan.steps.map((step) => structuredClone(step)),
    orderedStepIds: [...handoff.orderedStepIds],
    plannerSource: handoff.plannerSource,
    governance: structuredClone(handoff.governance),
    ...(handoff.attachmentContext ? { attachmentContext: structuredClone(handoff.attachmentContext) } : {}),
  };
}

function initialEnvelope(runActor: ReturnType<typeof createExecutionRunLifecycle>, stepActors: ReadonlyMap<string, ReturnType<typeof createExecutionStepLifecycle>>): ExecutionSnapshotEnvelope {
  return {
    version: EXECUTION_SNAPSHOT_SCHEMA_VERSION,
    runtimeVersion: EXECUTION_RUNTIME_VERSION,
    snapshot: {
      run: runActor.getPersistedSnapshot(),
      steps: Object.fromEntries([...stepActors].map(([id, actor]) => [id, actor.getPersistedSnapshot()])),
    },
  };
}

function executionRun(record: DurableExecutionRun): ExecutionRun {
  return {
    id: record.id,
    handoffVersion: record.handoffVersion,
    objective: "",
    status: record.status,
    controlState: record.controlState,
    createdAt: record.createdAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    orderedStepIds: [...record.executionPlan.orderedStepIds],
    steps: record.steps.map((step) => ({
      id: step.stepId,
      capability: step.capabilityId,
      status: step.status,
      dependsOn: [...step.dependencyIds],
      attempt: step.attempt,
      ...(step.nextRetryAt ? { nextRetryAt: step.nextRetryAt } : {}),
      ...(step.startedAt ? { startedAt: step.startedAt } : {}),
      ...(step.completedAt ? { completedAt: step.completedAt } : {}),
      ...(step.result ? { resultRef: `durable:${record.id}:${step.stepId}` } : {}),
      ...(step.failureCode ? { errorCode: step.failureCode } : {}),
    })),
  };
}

function controlOutcome(record: DurableExecutionRun): ExecutionOutcome | null {
  switch (record.controlState) {
    case "paused": return { kind: "paused", run: executionRun(record) };
    case "pause_requested": return { kind: "pause_requested", run: executionRun(record) };
    case "stopped": return { kind: "stopped", run: executionRun(record) };
    case "stop_requested": return { kind: "stop_requested", run: executionRun(record) };
    case "returned": return { kind: "returned", run: executionRun(record) };
    default: return null;
  }
}

function approvalOutcome(record: DurableExecutionRun, checkpoint: HumanApprovalCheckpoint): ExecutionOutcome {
  return { kind: "awaiting_human_approval", run: executionRun(record), checkpoint };
}

function telemetry(run: ExecutionRun, failureCode: ExecutionFailure["code"] | null, snapshotRevision: number, resumed: boolean): ExecutionOperationalMetadata & { readonly snapshot_revision: number; readonly resumed: boolean } {
  return Object.freeze({
    execution_id: run.id,
    status: run.status as "succeeded" | "failed",
    step_count: run.steps.length,
    completed_step_count: run.steps.filter((step) => step.status === "succeeded" || step.status === "failed" || step.status === "skipped").length,
    current_step_id: null,
    capability_steps: Object.freeze(run.steps.map((step) => Object.freeze({ step_id: step.id, capability: step.capability, status: step.status, attempt: step.attempt }))),
    runtime_duration_ms: Math.max(0, Date.parse(run.completedAt ?? run.createdAt) - Date.parse(run.startedAt ?? run.createdAt)),
    failure_code: failureCode,
    snapshot_revision: snapshotRevision,
    resumed,
  });
}

function outputResults(steps: readonly DurableExecutionStep[]): Readonly<Record<string, ExecutionStepResult>> {
  return Object.freeze(Object.fromEntries(steps.flatMap((step) => step.status === "succeeded" && step.result ? [[step.stepId, step.result]] : [])));
}

function persistedHandoff(record: DurableExecutionRun): PlannedExecutionHandoff | null {
  const data = record.executionPlan;
  if (record.runtimeVersion !== EXECUTION_RUNTIME_VERSION || record.handoffVersion !== 1
    || record.snapshotSchemaVersion !== EXECUTION_SNAPSHOT_SCHEMA_VERSION || data.version !== 1
    || !Array.isArray(data.steps) || !Array.isArray(data.orderedStepIds)
    || data.orderedStepIds.some((id) => typeof id !== "string" || !STEP_ID_PATTERN.test(id))) return null;
  const objective = "Persisted execution";
  const plan = { objective, steps: data.steps as PlanStep[], status: "validated" as const };
  const handoff: PlannedExecutionHandoff = {
    version: record.handoffVersion,
    objective,
    plan,
    orderedStepIds: [...data.orderedStepIds],
    plannerSource: data.plannerSource,
    ...(data.attachmentContext ? { attachmentContext: data.attachmentContext } : {}),
    governance: {
      ...data.governance,
      capabilityIds: data.governance.capabilityIds as PlannedExecutionHandoff["governance"]["capabilityIds"],
      handoffVersion: data.governance.handoffVersion as 1,
    },
  };
  const checked = validateExecutionHandoff(handoff);
  if (!checked.handoff) return null;
  if (checked.handoff.orderedStepIds.length !== record.steps.length
    || checked.handoff.orderedStepIds.some((id) => {
      const persisted = record.steps.find((step) => step.stepId === id);
      const source = checked.handoff.plan.steps.find((step) => step.id === id);
      return !persisted || !source || persisted.capabilityId !== source.capability
        || canonical(persisted.dependencyIds) !== canonical(source.dependsOn);
    })) return null;
  return checked.handoff;
}

function isValidDurableRecord(record: DurableExecutionRun, handoff: PlannedExecutionHandoff): boolean {
  const binding = record.runtimeContext.requestMessageBinding;
  if (!UUID_PATTERN.test(record.id) || !UUID_PATTERN.test(record.userId)
    || !UUID_PATTERN.test(record.runtimeContext.conversationId)
    || (binding !== undefined && (!requestMessageBindingSchema.safeParse(binding).success
      || binding.userId !== record.userId
      || binding.conversationId !== record.runtimeContext.conversationId))
    || record.steps.some((step) => !UUID_PATTERN.test(step.executionKey))
    || !/^[0-9a-f]{64}$/.test(record.requestFingerprint)
    || record.idempotencyKey.length < 1 || record.idempotencyKey.length > 128
    || !Array.isArray(record.runtimeContext.attachments)
    || record.runtimeContext.attachments.some((item) => !item || typeof item.id !== "string" || !["file", "image"].includes(item.kind))
    || !Array.isArray(record.runtimeContext.resourceReferences)
    || record.runtimeContext.resourceReferences.some((ref) => typeof ref !== "string")) return false;
  if (!EXECUTION_CONTROL_STATES.includes(record.controlState)
    || !Number.isSafeInteger(record.controlRevision) || record.controlRevision < 0
    || !Array.isArray(record.approvalCheckpoints)
    || new Set(record.approvalCheckpoints.map((checkpoint) => checkpoint.stepId)).size !== record.approvalCheckpoints.length
    || record.approvalCheckpoints.some((checkpoint) => {
      const step = handoff.plan.steps.find((candidate) => candidate.id === checkpoint.stepId);
      return checkpoint.runId !== record.id || checkpoint.userId !== record.userId
        || !["pending", "approved", "returned"].includes(checkpoint.status)
        || !["runtime_policy", "owner_request"].includes(checkpoint.source)
        || checkpoint.planFingerprint !== record.requestFingerprint || !step
        || checkpoint.stepFingerprint !== fingerprint(step)
        || !/^[0-9a-f]{64}$/.test(checkpoint.planFingerprint)
        || !/^[0-9a-f]{64}$/.test(checkpoint.stepFingerprint)
        || (checkpoint.status === "pending" && (checkpoint.decidedBy !== undefined || checkpoint.decidedAt !== undefined || checkpoint.rationale !== undefined))
        || (checkpoint.status !== "pending" && (checkpoint.decidedBy !== record.userId || !checkpoint.decidedAt))
        || (checkpoint.status === "returned" && (!checkpoint.rationale || checkpoint.rationale.trim().length < 1 || checkpoint.rationale.length > 1000))
        || (checkpoint.status === "approved" && checkpoint.rationale !== undefined)
        || (checkpoint.source === "runtime_policy" && checkpoint.requestedBy !== undefined)
        || (checkpoint.source === "owner_request" && checkpoint.requestedBy !== record.userId);
    })) return false;
  if (record.approvalCheckpoints.some((checkpoint) => checkpoint.status === "returned") && record.controlState !== "returned") return false;
  if ((record.controlState === "returned") !== record.approvalCheckpoints.some((checkpoint) => checkpoint.status === "returned")) return false;
  if (!executionRunSchema.safeParse(executionRun(record)).success) return false;
  if (record.steps.length !== handoff.plan.steps.length) return false;
  for (const step of record.steps) {
    const definition = handoff.plan.steps.find((candidate) => candidate.id === step.stepId);
    if (!definition || !STEP_ID_PATTERN.test(step.stepId) || !CAPABILITY_REGISTRY.has(step.capabilityId)
      || definition.capability !== step.capabilityId || canonical(definition.dependsOn) !== canonical(step.dependencyIds)
      || !executionStepSchema.safeParse({
        id: step.stepId,
        capability: step.capabilityId,
        status: step.status,
        dependsOn: step.dependencyIds,
        attempt: step.attempt,
        ...(step.nextRetryAt ? { nextRetryAt: step.nextRetryAt } : {}),
        ...(step.startedAt ? { startedAt: step.startedAt } : {}),
        ...(step.completedAt ? { completedAt: step.completedAt } : {}),
        ...(step.result ? { resultRef: `durable:${record.id}:${step.stepId}` } : {}),
        ...(step.failureCode ? { errorCode: step.failureCode } : {}),
      }).success) return false;
    if (step.status === "succeeded" && (!step.result || !validateExecutionStepResult(step.result, step.capabilityId as CapabilityId))) return false;
    if (step.status !== "succeeded" && step.result !== undefined) return false;
  }
  if (record.status === "pending" && record.steps.some((step) => step.status !== "pending")) return false;
  if (record.status === "running" && (record.steps.some((step) => step.status === "failed" || step.status === "skipped")
    || record.steps.filter((step) => step.status === "running").length > 1
    || record.steps.filter((step) => step.status === "retry_pending").length > 1
    || (record.steps.some((step) => step.status === "running") && record.steps.some((step) => step.status === "retry_pending")))) return false;
  if (record.status === "succeeded" && record.steps.some((step) => step.status !== "succeeded")) return false;
  if (record.status === "failed" && !record.steps.some((step) => step.status === "failed")) return false;
  return true;
}

function snapshotForActors(
  runActor: ReturnType<typeof createExecutionRunLifecycle>,
  stepActors: ReadonlyMap<string, ReturnType<typeof createExecutionStepLifecycle>>,
  statuses: Readonly<Record<string, DurableExecutionStep["status"]>>,
): ExecutionSnapshotEnvelope {
  const envelope: ExecutionSnapshotEnvelope = {
    version: EXECUTION_SNAPSHOT_SCHEMA_VERSION,
    runtimeVersion: EXECUTION_RUNTIME_VERSION,
    snapshot: {
      run: runActor.getPersistedSnapshot(),
      steps: Object.fromEntries([...stepActors].map(([id, actor]) => [id, actor.getPersistedSnapshot()])),
    },
  };
  return validateExecutionSnapshot(envelope, { runStatus: runActor.status, stepStatuses: statuses });
}

function errorForStoredCode(value?: string): ExecutionFailure {
  return executionFailure(EXECUTION_FAILURE_CODES.includes(value as typeof EXECUTION_FAILURE_CODES[number])
    ? value as typeof EXECUTION_FAILURE_CODES[number]
    : "invalid_persisted_state");
}

export type DurableExecutionRuntimeOptions = {
  readonly store: ExecutionStore;
  readonly executor: CapabilityExecutor;
  readonly authorizer: ExecutionAuthorizer;
  readonly requestMessageBindingValidator: RequestMessageBindingValidator;
  readonly createExecutionId?: () => string;
  readonly createExecutionKey?: () => string;
  readonly createControlId?: () => string;
  /** Trusted server-owned governance hook; this is not read from the plan or request payload. */
  readonly approvalPolicy?: (input: {
    readonly steps: readonly PlanStep[];
    readonly authenticatedUserId: string;
    readonly conversationId: string;
  }) => readonly string[];
  readonly now?: () => Date;
};

export type AcceptedRunAssociationOutcome =
  | {
      readonly kind: "associated";
      readonly status: "created" | "existing";
      readonly runId: string;
      readonly planFingerprint: string;
    }
  | { readonly kind: "rejected"; readonly failure: ExecutionFailure };

/** Durable, request-driven mock execution. It never retries a persisted running step. */
export class DurableXStateExecutionRuntime {
  private readonly createExecutionId: () => string;
  private readonly createExecutionKey: () => string;
  private readonly createControlId: () => string;
  private readonly now: () => Date;

  constructor(private readonly options: DurableExecutionRuntimeOptions) {
    this.createExecutionId = options.createExecutionId ?? randomUUID;
    this.createExecutionKey = options.createExecutionKey ?? randomUUID;
    this.createControlId = options.createControlId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    handoffInput: unknown,
    runtimeInput: ExecutionRuntimeInput,
    idempotencyKey: string,
  ): Promise<ExecutionOutcome> {
    const checked = validateExecutionHandoff(handoffInput);
    if (!checked.handoff) return { kind: "rejected", failure: checked.failure };
    const parsedBinding = requestMessageBindingSchema.safeParse(runtimeInput.requestMessageBinding);
    if (!parsedBinding.success) return { kind: "rejected", failure: executionFailure("invalid_handoff") };
    const stableInput: ExecutionRuntimeInput = {
      ...runtimeInput,
      requestMessageBinding: Object.freeze({ ...parsedBinding.data }),
      ...(runtimeInput.attachments ? { attachments: runtimeInput.attachments.map((item) => Object.freeze({ ...item })) } : {}),
      ...(runtimeInput.resourceReferences ? { resourceReferences: [...runtimeInput.resourceReferences] } : {}),
    };
    if (!safeRuntimeInput(stableInput) || idempotencyKey.length < 1 || idempotencyKey.length > 128 || idempotencyKey !== idempotencyKey.trim()) {
      return { kind: "rejected", failure: executionFailure("invalid_handoff") };
    }
    let bindingIsValid = false;
    try {
      bindingIsValid = await this.options.requestMessageBindingValidator.validate(stableInput.requestMessageBinding);
    } catch {
      bindingIsValid = false;
    }
    if (!bindingIsValid) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    const handoff = checked.handoff;
    const plan = safePlan(handoff);
    let approvalStepIds: string[];
    try {
      const configured = this.options.approvalPolicy?.({
        steps: handoff.plan.steps,
        authenticatedUserId: stableInput.authenticatedUserId,
        conversationId: stableInput.conversationId,
      }) ?? [];
      if (!Array.isArray(configured) || configured.some((id) => typeof id !== "string")
        || new Set(configured).size !== configured.length
        || configured.some((id) => !handoff.orderedStepIds.includes(id))) {
        return { kind: "rejected", failure: executionFailure("invalid_handoff") };
      }
      approvalStepIds = [...configured].sort();
    } catch {
      return { kind: "rejected", failure: executionFailure("authorization_failed") };
    }
    const needsUserInput = handoff.plan.steps.some((step) => step.inputs?.some((input) => input.source === "user"));
    const runtimeContext = {
      conversationId: stableInput.conversationId,
      requestMessageBinding: stableInput.requestMessageBinding,
      ...(needsUserInput ? { userInput: stableInput.userInput ?? handoff.objective } : {}),
      attachments: (stableInput.attachments ?? []).map(({ id, kind }) => ({ id, kind })),
      resourceReferences: [...(stableInput.resourceReferences ?? [])],
      ...(stableInput.organizationId ? { organizationId: stableInput.organizationId } : {}),
    };
    const requestFingerprint = approvalStepIds.length === 0
      ? fingerprint({ plan, runtimeContext })
      : fingerprint({ plan, runtimeContext, approvalStepIds });
    const runActor = createExecutionRunLifecycle();
    const stepActors = new Map(handoff.orderedStepIds.map((id) => [id, createExecutionStepLifecycle()]));
    const snapshot = initialEnvelope(runActor, stepActors);
    const createdAt = this.now().toISOString();
    let created: CreateDurableExecutionRunResult;
    try {
      created = await this.options.store.createRun({
      id: this.createExecutionId(),
      userId: stableInput.authenticatedUserId,
      handoffVersion: handoff.version,
      idempotencyKey,
      requestFingerprint,
      executionPlan: plan,
      runtimeContext,
      snapshot,
      steps: handoff.plan.steps.map((step) => ({
        stepId: step.id,
        capabilityId: step.capability,
        dependencyIds: step.dependsOn,
        executionKey: this.createExecutionKey(),
      })),
        approvalCheckpoints: approvalStepIds.map((stepId) => ({
          id: this.createControlId(),
          stepId,
          stepFingerprint: fingerprint(handoff.plan.steps.find((step) => step.id === stepId)),
        })),
        createdAt,
      });
    } catch {
      for (const actor of stepActors.values()) actor.stop();
      runActor.stop();
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    if (created.status === "idempotency_conflict") {
      for (const actor of stepActors.values()) actor.stop();
      runActor.stop();
      return { kind: "rejected", failure: executionFailure("idempotency_conflict") };
    }
    for (const actor of stepActors.values()) actor.stop();
    runActor.stop();
    return this.resume({ runId: created.run.id, authenticatedUserId: stableInput.authenticatedUserId });
  }

  /**
   * Persists or retrieves the run for one immutable accepted request without
   * dispatching a capability. The database association operation is the
   * authority for replay identity and is atomic with initial run persistence.
   */
  async associateAcceptedRequest(
    handoffInput: unknown,
    runtimeInput: ExecutionRuntimeInput,
    acceptance: AcceptedRequestExecutionIdentity,
  ): Promise<AcceptedRunAssociationOutcome> {
    const checked = validateExecutionHandoff(handoffInput);
    if (!checked.handoff) return { kind: "rejected", failure: checked.failure };
    const parsedBinding = requestMessageBindingSchema.safeParse(runtimeInput.requestMessageBinding);
    if (!parsedBinding.success) return { kind: "rejected", failure: executionFailure("invalid_handoff") };

    const acceptedBinding = {
      requestId: acceptance.requestId,
      userId: acceptance.userId,
      conversationId: acceptance.conversationId,
      userMessageId: acceptance.userMessageId,
      assistantMessageId: acceptance.assistantMessageId,
    };
    const parsedAcceptedBinding = requestMessageBindingSchema.safeParse(acceptedBinding);
    if (!parsedAcceptedBinding.success
      || acceptance.userId !== runtimeInput.authenticatedUserId
      || acceptance.conversationId !== runtimeInput.conversationId
      || acceptance.requestId !== parsedBinding.data.requestId
      || acceptance.userId !== parsedBinding.data.userId
      || acceptance.conversationId !== parsedBinding.data.conversationId
      || acceptance.userMessageId !== parsedBinding.data.userMessageId
      || acceptance.assistantMessageId !== parsedBinding.data.assistantMessageId
      || typeof acceptance.idempotencyKey !== "string"
      || acceptance.idempotencyKey.length < 1
      || acceptance.idempotencyKey.length > 128
      || acceptance.idempotencyKey !== acceptance.idempotencyKey.trim()
      || !/^[0-9a-f]{64}$/.test(acceptance.requestFingerprint)) {
      return { kind: "rejected", failure: executionFailure("invalid_handoff") };
    }

    const stableInput: ExecutionRuntimeInput = {
      ...runtimeInput,
      requestMessageBinding: Object.freeze({ ...parsedBinding.data }),
      ...(runtimeInput.attachments ? { attachments: runtimeInput.attachments.map((item) => Object.freeze({ ...item })) } : {}),
      ...(runtimeInput.resourceReferences ? { resourceReferences: [...runtimeInput.resourceReferences] } : {}),
    };
    if (!safeRuntimeInput(stableInput)) return { kind: "rejected", failure: executionFailure("invalid_handoff") };

    let bindingIsValid = false;
    try {
      bindingIsValid = await this.options.requestMessageBindingValidator.validate(stableInput.requestMessageBinding);
    } catch {
      bindingIsValid = false;
    }
    if (!bindingIsValid) return { kind: "rejected", failure: executionFailure("ownership_denied") };

    const handoff = checked.handoff;
    let approvalStepIds: string[];
    try {
      const configured = this.options.approvalPolicy?.({
        steps: handoff.plan.steps,
        authenticatedUserId: stableInput.authenticatedUserId,
        conversationId: stableInput.conversationId,
      }) ?? [];
      if (!Array.isArray(configured) || configured.some((id) => typeof id !== "string")
        || new Set(configured).size !== configured.length
        || configured.some((id) => !handoff.orderedStepIds.includes(id))) {
        return { kind: "rejected", failure: executionFailure("invalid_handoff") };
      }
      approvalStepIds = [...configured].sort();
    } catch {
      return { kind: "rejected", failure: executionFailure("authorization_failed") };
    }

    const plan = safePlan(handoff);
    const needsUserInput = handoff.plan.steps.some((step) => step.inputs?.some((input) => input.source === "user"));
    const runtimeContext = {
      conversationId: stableInput.conversationId,
      requestMessageBinding: stableInput.requestMessageBinding,
      ...(needsUserInput ? { userInput: stableInput.userInput ?? handoff.objective } : {}),
      attachments: (stableInput.attachments ?? []).map(({ id, kind }) => ({ id, kind })),
      resourceReferences: [...(stableInput.resourceReferences ?? [])],
      ...(stableInput.organizationId ? { organizationId: stableInput.organizationId } : {}),
    };
    const planFingerprint = approvalStepIds.length === 0
      ? fingerprint({ plan, runtimeContext })
      : fingerprint({ plan, runtimeContext, approvalStepIds });
    const runActor = createExecutionRunLifecycle();
    const stepActors = new Map(handoff.orderedStepIds.map((id) => [id, createExecutionStepLifecycle()]));
    const snapshot = initialEnvelope(runActor, stepActors);
    const createdAt = this.now().toISOString();
    const runInput: CreateDurableExecutionRunInput = {
      id: this.createExecutionId(),
      userId: stableInput.authenticatedUserId,
      handoffVersion: handoff.version,
      idempotencyKey: acceptance.idempotencyKey,
      requestFingerprint: planFingerprint,
      executionPlan: plan,
      runtimeContext,
      snapshot,
      steps: handoff.plan.steps.map((step) => ({
        stepId: step.id,
        capabilityId: step.capability,
        dependencyIds: step.dependsOn,
        executionKey: this.createExecutionKey(),
      })),
      approvalCheckpoints: approvalStepIds.map((stepId) => ({
        id: this.createControlId(),
        stepId,
        stepFingerprint: fingerprint(handoff.plan.steps.find((step) => step.id === stepId)),
      })),
      createdAt,
    };

    let association;
    try {
      association = await this.options.store.associateAcceptedRequest({ acceptance, run: runInput });
    } catch {
      for (const actor of stepActors.values()) actor.stop();
      runActor.stop();
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    for (const actor of stepActors.values()) actor.stop();
    runActor.stop();
    if (association.status === "conflict") {
      return { kind: "rejected", failure: executionFailure("idempotency_conflict") };
    }
    return {
      kind: "associated",
      status: association.status,
      runId: association.runId,
      planFingerprint: association.planFingerprint,
    };
  }

  async pause(input: { readonly runId: string; readonly authenticatedUserId: string }): Promise<ExecutionControlCommandResult> {
    const target = await this.loadAuthorizedControlTarget(input.runId, input.authenticatedUserId);
    if (!target) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    let result;
    try {
      result = await this.options.store.pauseRun({
        runId: target.record.id, userId: target.record.userId, actorUserId: target.record.userId,
        expectedControlRevision: target.record.controlRevision, createdAt: this.now().toISOString(),
      });
    } catch {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    if (result.status === "not_found" || result.status === "terminal" || result.status === "conflict") {
      return { kind: "rejected", failure: executionFailure(result.status === "conflict" ? "snapshot_conflict" : "authorization_denied") };
    }
    if (result.status === "saved" || result.status === "approval_pending" || result.status === "unsafe_boundary") {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    const updated = await this.options.store.getRun({ runId: target.record.id, userId: target.record.userId });
    if (!updated) return { kind: "rejected", failure: executionFailure("persistence_failed") };
    return {
      kind: result.status === "already_applied" ? "already_applied" : result.status,
      run: executionRun(updated),
    };
  }

  async stop(input: { readonly runId: string; readonly authenticatedUserId: string }): Promise<ExecutionControlCommandResult> {
    const target = await this.loadAuthorizedControlTarget(input.runId, input.authenticatedUserId);
    if (!target) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    let result;
    try {
      result = await this.options.store.stopRun({
        runId: target.record.id, userId: target.record.userId, actorUserId: target.record.userId,
        expectedControlRevision: target.record.controlRevision, createdAt: this.now().toISOString(),
      });
    } catch {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    if (result.status === "not_found" || result.status === "terminal" || result.status === "conflict") {
      return { kind: "rejected", failure: executionFailure(result.status === "conflict" ? "snapshot_conflict" : "authorization_denied") };
    }
    if (result.status === "saved" || result.status === "approval_pending" || result.status === "unsafe_boundary") {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    const updated = await this.options.store.getRun({ runId: target.record.id, userId: target.record.userId });
    if (!updated) return { kind: "rejected", failure: executionFailure("persistence_failed") };
    return {
      kind: result.status === "already_applied" ? "already_applied" : result.status,
      run: executionRun(updated),
    };
  }

  async requireApproval(input: {
    readonly runId: string;
    readonly authenticatedUserId: string;
    readonly stepId: string;
  }): Promise<ExecutionControlCommandResult> {
    const target = await this.loadAuthorizedControlTarget(input.runId, input.authenticatedUserId);
    if (!target) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    const step = target.handoff.plan.steps.find((candidate) => candidate.id === input.stepId);
    if (!step) return { kind: "rejected", failure: executionFailure("invalid_handoff") };
    let result;
    try {
      result = await this.options.store.createApprovalCheckpoint({
        runId: target.record.id,
        userId: target.record.userId,
        expectedControlRevision: target.record.controlRevision,
        checkpointId: this.createControlId(),
        stepId: input.stepId,
        planFingerprint: target.record.requestFingerprint,
        stepFingerprint: fingerprint(step),
        source: "owner_request",
        actorUserId: target.record.userId,
        createdAt: this.now().toISOString(),
      });
    } catch {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    if (result.status !== "created" && result.status !== "existing"
      && result.status !== "approved" && result.status !== "returned" && result.status !== "already_decided") {
      return { kind: "rejected", failure: executionFailure(result.status === "conflict" ? "snapshot_conflict" : "invalid_handoff") };
    }
    const updated = await this.options.store.getRun({ runId: target.record.id, userId: target.record.userId });
    if (!updated) return { kind: "rejected", failure: executionFailure("persistence_failed") };
    const checkpoint = result.checkpoint;
    if (checkpoint.status === "returned") return { kind: "returned", run: executionRun(updated), checkpoint };
    if (checkpoint.status === "approved") return { kind: "approved", run: executionRun(updated), checkpoint };
    return { kind: "awaiting_human_approval", run: executionRun(updated), checkpoint };
  }

  async approveCheckpoint(input: {
    readonly runId: string;
    readonly authenticatedUserId: string;
    readonly checkpointId: string;
  }): Promise<ExecutionControlCommandResult> {
    return this.decideCheckpoint({ ...input, decision: "approve" });
  }

  async returnCheckpoint(input: {
    readonly runId: string;
    readonly authenticatedUserId: string;
    readonly checkpointId: string;
    readonly rationale: string;
  }): Promise<ExecutionControlCommandResult> {
    return this.decideCheckpoint({ ...input, decision: "return", rationale: input.rationale });
  }

  private async decideCheckpoint(input: {
    readonly runId: string;
    readonly authenticatedUserId: string;
    readonly checkpointId: string;
    readonly decision: "approve" | "return";
    readonly rationale?: string;
  }): Promise<ExecutionControlCommandResult> {
    const target = await this.loadAuthorizedControlTarget(input.runId, input.authenticatedUserId);
    if (!target) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    const knownCheckpoint = target.record.approvalCheckpoints.find((checkpoint) => checkpoint.id === input.checkpointId);
    if (!knownCheckpoint) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    if (knownCheckpoint.planFingerprint !== target.record.requestFingerprint) {
      return { kind: "rejected", failure: executionFailure("invalid_persisted_state") };
    }
    let result;
    try {
      result = await this.options.store.decideApprovalCheckpoint({
        runId: target.record.id, userId: target.record.userId,
        expectedControlRevision: target.record.controlRevision,
        checkpointId: input.checkpointId, decision: input.decision,
        ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
        actorUserId: target.record.userId, decidedAt: this.now().toISOString(),
      });
    } catch {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    if (result.status !== "approved" && result.status !== "returned" && result.status !== "already_decided") {
      return { kind: "rejected", failure: executionFailure(result.status === "conflict" ? "snapshot_conflict" : "authorization_denied") };
    }
    const updated = await this.options.store.getRun({ runId: target.record.id, userId: target.record.userId });
    if (!updated) return { kind: "rejected", failure: executionFailure("persistence_failed") };
    if (result.status === "already_decided") {
      const requestedStatus = input.decision === "approve" ? "approved" : "returned";
      if (result.checkpoint.status !== requestedStatus) {
        return { kind: "rejected", failure: executionFailure("snapshot_conflict") };
      }
      return requestedStatus === "returned"
        ? { kind: "returned", run: executionRun(updated), checkpoint: result.checkpoint }
        : { kind: "already_applied", run: executionRun(updated) };
    }
    return result.status === "returned"
      ? { kind: "returned", run: executionRun(updated), checkpoint: result.checkpoint }
      : { kind: "approved", run: executionRun(updated), checkpoint: result.checkpoint };
  }

  private async loadAuthorizedControlTarget(runId: string, authenticatedUserId: string): Promise<{
    readonly record: DurableExecutionRun;
    readonly handoff: PlannedExecutionHandoff;
  } | null> {
    if (!UUID_PATTERN.test(runId) || !UUID_PATTERN.test(authenticatedUserId)) return null;
    let record: DurableExecutionRun | null;
    try {
      record = await this.options.store.getRun({ runId, userId: authenticatedUserId });
    } catch {
      return null;
    }
    if (!record || record.userId !== authenticatedUserId) return null;
    const handoff = persistedHandoff(record);
    if (!handoff || !isValidDurableRecord(record, handoff)) return null;
    const binding = record.runtimeContext.requestMessageBinding;
    const parsed = requestMessageBindingSchema.safeParse(binding);
    if (!parsed.success || parsed.data.userId !== authenticatedUserId
      || parsed.data.conversationId !== record.runtimeContext.conversationId) return null;
    try {
      if (!await this.options.requestMessageBindingValidator.validate(parsed.data)) return null;
    } catch {
      return null;
    }
    return { record, handoff };
  }

  async resume(input: {
    readonly runId: string;
    readonly authenticatedUserId: string;
    readonly requestId?: string;
    readonly correlationId?: string;
  }): Promise<ExecutionOutcome> {
    try {
      return await this.resumeExisting(input);
    } catch {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
  }

  /** Explicit owner-authorized control transition; ordinary runtime continuation never clears a pause. */
  async resumeControl(input: {
    readonly runId: string;
    readonly authenticatedUserId: string;
    readonly requestId?: string;
    readonly correlationId?: string;
  }): Promise<ExecutionOutcome> {
    const target = await this.loadAuthorizedControlTarget(input.runId, input.authenticatedUserId);
    if (!target) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    const runningStep = target.record.steps.find((step) => step.status === "running");
    if (runningStep) {
      return { kind: "recovery_required", run: executionRun(target.record), failure: executionFailure("indeterminate_step"), stepId: runningStep.stepId };
    }
    let result;
    try {
      result = await this.options.store.resumeRun({
        runId: target.record.id,
        userId: target.record.userId,
        expectedControlRevision: target.record.controlRevision,
        actorUserId: target.record.userId,
        createdAt: this.now().toISOString(),
      });
    } catch {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    if (result.status === "approval_pending") {
      const checkpoint = target.record.approvalCheckpoints.find((candidate) => candidate.status === "pending");
      return checkpoint ? approvalOutcome(target.record, checkpoint)
        : { kind: "rejected", failure: executionFailure("invalid_persisted_state") };
    }
    if (result.status === "unsafe_boundary") {
      const latest = await this.options.store.getRun({ runId: target.record.id, userId: target.record.userId });
      const activeStep = latest?.steps.find((step) => step.status === "running");
      return { kind: "recovery_required", run: executionRun(latest ?? target.record), failure: executionFailure("indeterminate_step"), stepId: activeStep?.stepId ?? "" };
    }
    if (result.status === "terminal") {
      const latest = await this.options.store.getRun({ runId: target.record.id, userId: target.record.userId });
      return { kind: "rejected", failure: latest ? executionFailure("snapshot_conflict") : executionFailure("ownership_denied") };
    }
    if (result.status === "conflict" || result.status === "not_found") {
      const latest = await this.options.store.getRun({ runId: target.record.id, userId: target.record.userId });
      if (!latest) return { kind: "rejected", failure: executionFailure("ownership_denied") };
      if (latest.controlState !== "active") return controlOutcome(latest) ?? { kind: "rejected", failure: executionFailure("snapshot_conflict") };
    }
    return this.resume({
      runId: target.record.id,
      authenticatedUserId: target.record.userId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
  }

  private async resumeExisting(input: {
    readonly runId: string;
    readonly authenticatedUserId: string;
    readonly requestId?: string;
    readonly correlationId?: string;
  }): Promise<ExecutionOutcome> {
    if (!UUID_PATTERN.test(input.runId) || !UUID_PATTERN.test(input.authenticatedUserId)) {
      return { kind: "rejected", failure: executionFailure("ownership_denied") };
    }
    let record: DurableExecutionRun | null;
    try {
      record = await this.options.store.getRun({ runId: input.runId, userId: input.authenticatedUserId });
    } catch {
      return { kind: "rejected", failure: executionFailure("persistence_failed") };
    }
    if (!record) return { kind: "rejected", failure: executionFailure("ownership_denied") };
    if (record.runtimeVersion !== EXECUTION_RUNTIME_VERSION) return { kind: "rejected", failure: executionFailure("invalid_persisted_state") };
    if (record.handoffVersion !== 1) return { kind: "rejected", failure: executionFailure("unsupported_handoff_version") };
    if (record.snapshotSchemaVersion !== EXECUTION_SNAPSHOT_SCHEMA_VERSION || record.snapshot?.version !== EXECUTION_SNAPSHOT_SCHEMA_VERSION) {
      return { kind: "rejected", failure: executionFailure("unsupported_snapshot_version") };
    }
    let handoff: PlannedExecutionHandoff | null;
    try {
      handoff = persistedHandoff(record);
    } catch {
      handoff = null;
    }
    if (!handoff || !isValidDurableRecord(record, handoff)) return { kind: "rejected", failure: executionFailure("invalid_persisted_state") };
    const parsedPersistedBinding = record.runtimeContext.requestMessageBinding
      ? requestMessageBindingSchema.safeParse(record.runtimeContext.requestMessageBinding)
      : null;
    const persistedBinding = parsedPersistedBinding?.success
      ? Object.freeze({ ...parsedPersistedBinding.data })
      : undefined;
    if (persistedBinding) {
      if (input.requestId !== undefined && input.requestId !== persistedBinding.requestId) {
        return { kind: "rejected", failure: executionFailure("invalid_persisted_state") };
      }
      let bindingIsValid = false;
      try {
        bindingIsValid = await this.options.requestMessageBindingValidator.validate(persistedBinding);
      } catch {
        bindingIsValid = false;
      }
      if (!bindingIsValid) return { kind: "rejected", failure: executionFailure("ownership_denied") };
      record = {
        ...record,
        runtimeContext: { ...record.runtimeContext, requestMessageBinding: persistedBinding },
      };
    }

    const stepStatuses = Object.fromEntries(record.steps.map((step) => [step.stepId, step.status]));
    let envelope: ExecutionSnapshotEnvelope;
    try {
      envelope = validateExecutionSnapshot(record.snapshot, { runStatus: record.status, stepStatuses });
    } catch (error) {
      const code = error instanceof ExecutionSnapshotError ? error.code : "invalid_snapshot";
      const safeCode = code;
      if (safeCode === "unsupported_snapshot_version") return { kind: "rejected", failure: executionFailure(safeCode) };
      const run = executionRun(record);
      return { kind: "failed", run, failure: executionFailure(safeCode), stepResults: outputResults(record.steps), telemetry: telemetry(run, safeCode, record.snapshotRevision, true) };
    }

    const runActor = createExecutionRunLifecycle(envelope.snapshot.run);
    const stepActors = new Map(record.steps.map((step) => [step.stepId, createExecutionStepLifecycle(envelope.snapshot.steps[step.stepId])]));
    if (runActor.status !== record.status || record.steps.some((step) => stepActors.get(step.stepId)?.status !== step.status)) {
      const run = executionRun(record);
      return { kind: "failed", run, failure: executionFailure("invalid_persisted_state"), stepResults: outputResults(record.steps), telemetry: telemetry(run, "invalid_persisted_state", record.snapshotRevision, true) };
    }

    if (record.status === "succeeded") {
      const run = executionRun(record);
      return { kind: "succeeded", run, stepResults: outputResults(record.steps), telemetry: telemetry(run, null, record.snapshotRevision, true) };
    }
    if (record.status === "failed") {
      const run = executionRun(record);
      const storedFailure = errorForStoredCode(record.failureCode);
      return { kind: "failed", run, failure: storedFailure, stepResults: outputResults(record.steps), telemetry: telemetry(run, storedFailure.code, record.snapshotRevision, true) };
    }

    const inFlight = record.steps.find((step) => step.status === "running");
    if (inFlight) {
      const run = executionRun(record);
      return { kind: "recovery_required", run, failure: executionFailure("indeterminate_step"), stepId: inFlight.stepId };
    }
    if (!persistedBinding) {
      return { kind: "rejected", failure: executionFailure("invalid_persisted_state") };
    }
    if (record.controlState !== "active") {
      return controlOutcome(record)!;
    }
    let revision = record.snapshotRevision;
    let current = record;
    let claimedRetryStepId: string | undefined;
    let claimedRetryExecutionKey: string | undefined;

    const retryPending = current.steps.find((step) => step.status === "retry_pending");
    if (retryPending) {
      const retryActor = stepActors.get(retryPending.stepId)!;
      const stopActors = () => {
        for (const actor of stepActors.values()) actor.stop();
        runActor.stop();
      };
      if (retryPending.attempt >= MAX_EXECUTION_STEP_ATTEMPTS) {
        stopActors();
        return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("retry_exhausted"), stepId: retryPending.stepId };
      }
      retryActor.claimRetry();
      const retryClaimSnapshot = snapshotForActors(runActor, stepActors, Object.fromEntries(current.steps.map((item) => [
        item.stepId,
        item.stepId === retryPending.stepId ? "running" : item.status,
      ])));
      let claimed: Awaited<ReturnType<ExecutionStore["claimRetryableStep"]>>;
      try {
        claimed = await this.options.store.claimRetryableStep({
          runId: current.id,
          userId: current.userId,
          stepId: retryPending.stepId,
          expectedRevision: revision,
          snapshot: retryClaimSnapshot,
        });
      } catch {
        stopActors();
        return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("persistence_failed"), stepId: retryPending.stepId };
      }
      if (claimed.status === "not_eligible") {
        stopActors();
        return { kind: "retry_pending", run: executionRun(current), stepId: retryPending.stepId, nextRetryAt: claimed.nextRetryAt };
      }
      if (claimed.status === "approval_required") {
        stopActors();
        return approvalOutcome(current, claimed.checkpoint);
      }
      if (claimed.status === "control_blocked") {
        stopActors();
        return controlOutcome({ ...current, controlState: claimed.controlState })!;
      }
      if (claimed.status !== "claimed") {
        stopActors();
        return { kind: "recovery_required", run: executionRun(current), failure: executionFailure(
          claimed.status === "attempt_limit" ? "retry_exhausted" : "snapshot_conflict",
        ), stepId: retryPending.stepId };
      }
      claimedRetryStepId = retryPending.stepId;
      claimedRetryExecutionKey = claimed.executionKey;
      revision = claimed.snapshotRevision;
      let reloaded: DurableExecutionRun | null;
      try {
        reloaded = await this.options.store.getRun({ runId: current.id, userId: current.userId });
      } catch {
        reloaded = null;
      }
      const reloadedStep = reloaded?.steps.find((step) => step.stepId === claimedRetryStepId);
      if (!reloaded || !reloadedStep || reloadedStep.status !== "running"
        || reloadedStep.attempt !== claimed.attempt || reloadedStep.executionKey !== claimed.executionKey
        || reloaded.snapshotRevision !== revision) {
        stopActors();
        return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("indeterminate_step"), stepId: retryPending.stepId };
      }
      current = {
        ...reloaded,
        runtimeContext: { ...reloaded.runtimeContext, requestMessageBinding: persistedBinding },
      };
    }

    if (current.status === "pending") {
      runActor.start();
      const startedAt = this.now().toISOString();
      const pendingEnvelope = snapshotForActors(runActor, stepActors, stepStatuses);
      const started = await this.options.store.saveRunState({
        runId: current.id,
        userId: current.userId,
        expectedRevision: revision,
        status: "running",
        snapshot: pendingEnvelope,
        startedAt,
      });
      if (started.status !== "saved") {
        const latest = await this.options.store.getRun({ runId: current.id, userId: current.userId });
        if (latest && latest.controlState !== "active") return controlOutcome(latest)!;
        return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("snapshot_conflict"), stepId: "" };
      }
      revision = started.snapshotRevision;
      const reloaded = (await this.options.store.getRun({ runId: current.id, userId: current.userId }))!;
      current = {
        ...reloaded,
        runtimeContext: { ...reloaded.runtimeContext, requestMessageBinding: persistedBinding },
      };
    }

    const stepById = new Map(handoff.plan.steps.map((step) => [step.id, step]));
    const results: Record<string, ExecutionStepResult> = { ...outputResults(current.steps) };
    for (const stepId of handoff.orderedStepIds) {
      const persistedStep = current.steps.find((step) => step.stepId === stepId)!;
      if (persistedStep.status === "succeeded" || persistedStep.status === "skipped") continue;
      const isClaimedRetry = persistedStep.status === "running" && claimedRetryStepId === stepId;
      if (persistedStep.status !== "pending" && !isClaimedRetry) {
        return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("indeterminate_step"), stepId };
      }
      const step = stepById.get(stepId)!;
      const lifecycle = stepActors.get(stepId)!;
      const failedDependency = step.dependsOn.some((dependencyId) => current.steps.find((candidate) => candidate.stepId === dependencyId)?.status !== "succeeded");
      if (failedDependency) {
        // Persisted terminal predecessors should already have marked this run failed; reject inconsistent state.
        return { kind: "failed", run: executionRun(current), failure: executionFailure("invalid_persisted_state"), stepResults: results, telemetry: telemetry(executionRun(current), "invalid_persisted_state", revision, true) };
      }

      let executionKey: string;
      if (isClaimedRetry) {
        executionKey = claimedRetryExecutionKey!;
      } else {
        lifecycle.start();
        const startedAt = this.now().toISOString();
        const claimSnapshot = snapshotForActors(runActor, stepActors, Object.fromEntries(current.steps.map((item) => [item.stepId, item.stepId === stepId ? lifecycle.status : item.status])));
        let claimed: Awaited<ReturnType<ExecutionStore["claimStep"]>>;
        try {
          claimed = await this.options.store.claimStep({
            runId: current.id,
            userId: current.userId,
            stepId,
            expectedRevision: revision,
            snapshot: claimSnapshot,
            startedAt,
          });
        } catch {
          lifecycle.stop();
          for (const actor of stepActors.values()) actor.stop();
          runActor.stop();
          return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("persistence_failed"), stepId };
        }
        if (claimed.status !== "claimed") {
          lifecycle.stop();
          for (const actor of stepActors.values()) actor.stop();
          runActor.stop();
          if (claimed.status === "approval_required") return approvalOutcome(current, claimed.checkpoint);
          if (claimed.status === "control_blocked") return controlOutcome({ ...current, controlState: claimed.controlState })!;
          return claimed.status === "already_claimed"
            ? { kind: "recovery_required", run: executionRun(current), failure: executionFailure("indeterminate_step"), stepId }
            : { kind: "recovery_required", run: executionRun(current), failure: executionFailure("snapshot_conflict"), stepId };
        }
        executionKey = claimed.executionKey;
        revision = claimed.snapshotRevision;
        current = { ...current, snapshotRevision: revision, snapshot: claimSnapshot, steps: current.steps.map((item) => item.stepId === stepId ? { ...item, status: "running", startedAt } : item) };
      }

      const resolved = resolveExecutionInputs(step, handoff, {
        authenticatedUserId: current.userId,
        conversationId: current.runtimeContext.conversationId,
        requestMessageBinding: current.runtimeContext.requestMessageBinding!,
        userInput: current.runtimeContext.userInput,
        attachments: current.runtimeContext.attachments,
        resourceReferences: current.runtimeContext.resourceReferences,
        organizationId: current.runtimeContext.organizationId,
        requestId: current.runtimeContext.requestMessageBinding!.requestId,
        correlationId: input.correlationId,
      }, results);
      let stepFailure: ExecutionFailure | null = resolved.inputs ? null : resolved.failure;

      if (resolved.inputs?.some((resolvedInput) => resolvedInput.source === "user") && current.runtimeContext.userInput === undefined) {
        stepFailure = executionFailure("missing_input");
      }

      const capabilityId = step.capability;
      if (!stepFailure) {
        const authorization = await this.authorize(current, stepId, capabilityId, resolved.resourceReferences ?? [], resolved.inputs ?? [], {
          correlationId: input.correlationId,
        });
        if (!authorization.allowed) stepFailure = authorization.failure;
      }

      let result: ExecutionStepResult | undefined;
      if (!stepFailure && resolved.inputs) {
        const executionInput: CapabilityExecutionInput = {
          executionId: current.id,
          stepId,
          executionKey,
          capabilityId,
          inputs: resolved.inputs,
          context: {
            authenticatedUserId: current.userId,
            conversationId: current.runtimeContext.conversationId,
            requestMessageBinding: current.runtimeContext.requestMessageBinding!,
            ...(current.runtimeContext.organizationId ? { organizationId: current.runtimeContext.organizationId } : {}),
            resourceReferences: resolved.resourceReferences,
            requestId: current.runtimeContext.requestMessageBinding!.requestId,
            ...(input.correlationId ? { correlationId: input.correlationId } : {}),
          },
        };
        try {
          const executorResult: unknown = await this.options.executor.execute(executionInput);
          if (!validateExecutionStepResult(executorResult, capabilityId)) {
            const byteLength = executionResultJsonBytes(executorResult);
            const failure = byteLength !== null && byteLength > MAX_DURABLE_RESULT_PAYLOAD_BYTES
              ? executionFailure("result_too_large")
              : executionFailure("invalid_executor_result");
            for (const actor of stepActors.values()) actor.stop();
            runActor.stop();
            return { kind: "recovery_required", run: executionRun(current), failure, stepId };
          }
          else result = executorResult;
        } catch (error) {
          const failure = error instanceof CapabilityAdapterError
            ? error.descriptor
            : { code: "executor_failed" as const, phase: "unknown" as const, retrySafety: "RECOVERY_REQUIRED" as const };
          const decision = decideRetry({ capabilityId, failure, attempt: current.steps.find((item) => item.stepId === stepId)!.attempt });
          if (decision.action === "recovery_required") {
            for (const actor of stepActors.values()) actor.stop();
            runActor.stop();
            return { kind: "recovery_required", run: executionRun(current), failure: executionFailure(failure.code), stepId };
          }
          if (decision.action === "retry") {
            lifecycle.scheduleRetry();
            const nextRetryAt = new Date(this.now().getTime() + decision.backoffMs).toISOString();
            const retryStatuses = Object.fromEntries(current.steps.map((item) => [item.stepId,
              item.stepId === stepId ? "retry_pending" : item.status,
            ]));
            const retrySnapshot = snapshotForActors(runActor, stepActors, retryStatuses);
            let scheduled: Awaited<ReturnType<ExecutionStore["scheduleStepRetry"]>>;
            try {
              scheduled = await this.options.store.scheduleStepRetry({
                runId: current.id,
                userId: current.userId,
                stepId,
                expectedRevision: revision,
                snapshot: retrySnapshot,
                nextRetryAt,
              });
            } catch {
              scheduled = { status: "conflict" };
            }
            for (const actor of stepActors.values()) actor.stop();
            runActor.stop();
            if (scheduled.status !== "saved") {
              return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("snapshot_conflict"), stepId };
            }
            const retryRun: DurableExecutionRun = {
              ...current,
              snapshot: retrySnapshot,
              snapshotRevision: scheduled.snapshotRevision,
              controlState: scheduled.controlState ?? current.controlState,
              controlRevision: scheduled.controlRevision ?? current.controlRevision,
              steps: current.steps.map((item) => item.stepId === stepId
                ? { ...item, status: "retry_pending", nextRetryAt }
                : item),
            };
            if (retryRun.controlState !== "active") return controlOutcome(retryRun)!;
            return { kind: "retry_pending", run: executionRun(retryRun), stepId, nextRetryAt };
          }
          stepFailure = executionFailure(failure.retrySafety === "SAFE_RETRY" ? "retry_exhausted" : failure.code);
        }
      }

      if (stepFailure) {
        lifecycle.fail();
        runActor.fail();
        const completedAt = this.now().toISOString();
        const updates: DurableStepCheckpoint[] = [{ stepId, status: "failed", failureCode: stepFailure.code, completedAt }];
        for (const other of current.steps) {
          if (other.status !== "pending") continue;
          stepActors.get(other.stepId)!.skip();
          updates.push({ stepId: other.stepId, status: "skipped", failureCode: "dependency_failed", completedAt });
        }
        const snapshotStatuses = Object.fromEntries(current.steps.map((item) => [item.stepId,
          item.stepId === stepId ? "failed" : item.status === "pending" ? "skipped" : item.status,
        ]));
        const failedEnvelope = snapshotForActors(runActor, stepActors, snapshotStatuses);
        const saved = await this.options.store.checkpoint({
          runId: current.id, userId: current.userId, expectedRevision: revision,
          runStatus: "failed", snapshot: failedEnvelope, updates, completedAt,
          failureCode: stepFailure.code, retainUserInput: false,
        });
        lifecycle.stop();
        for (const actor of stepActors.values()) actor.stop();
        runActor.stop();
        if (saved.status !== "saved") return { kind: "recovery_required", run: executionRun(current), failure: executionFailure("snapshot_conflict"), stepId };
        const reloaded = await this.options.store.getRun({ runId: current.id, userId: current.userId });
        if (!reloaded) return { kind: "rejected", failure: executionFailure("ownership_denied") };
        const run = executionRun(reloaded);
        return { kind: "failed", run, failure: stepFailure, stepResults: outputResults(reloaded.steps), telemetry: telemetry(run, stepFailure.code, saved.snapshotRevision, true) };
      }

      lifecycle.succeed();
      results[stepId] = result!;
      const nextStatuses = Object.fromEntries(current.steps.map((item) => [item.stepId, item.stepId === stepId ? "succeeded" : item.status]));
      const allDone = current.steps.every((item) => item.stepId === stepId || item.status === "succeeded" || item.status === "skipped");
      if (allDone) runActor.succeed();
      const checkpointSnapshot = snapshotForActors(runActor, stepActors, nextStatuses);
      const completedAt = this.now().toISOString();
      const retainUserInput = handoff.plan.steps.some((candidate) => candidate.id !== stepId
        && candidate.inputs?.some((candidateInput) => candidateInput.source === "user")
        && current.steps.find((item) => item.stepId === candidate.id)?.status === "pending");
      const saved = await this.options.store.checkpoint({
        runId: current.id, userId: current.userId, expectedRevision: revision,
        runStatus: allDone ? "succeeded" : "running", snapshot: checkpointSnapshot,
        updates: [{ stepId, status: "succeeded", result, completedAt }],
        ...(allDone ? { completedAt } : {}), retainUserInput,
      });
      lifecycle.stop();
      if (saved.status !== "saved") {
        runActor.stop();
        for (const actor of stepActors.values()) actor.stop();
        return { kind: "recovery_required", run: executionRun(current), failure: executionFailure(saved.status === "result_too_large" ? "result_too_large" : "snapshot_conflict"), stepId };
      }
      revision = saved.snapshotRevision;
      current = {
        ...current,
        status: allDone ? "succeeded" : "running",
        controlState: saved.controlState ?? current.controlState,
        controlRevision: saved.controlRevision ?? current.controlRevision,
        snapshot: checkpointSnapshot,
        snapshotRevision: revision,
        ...(allDone ? { completedAt } : {}),
        runtimeContext: retainUserInput ? current.runtimeContext : (() => {
          const { userInput, ...rest } = current.runtimeContext;
          void userInput;
          return rest;
        })(),
        steps: current.steps.map((item) => item.stepId === stepId ? { ...item, status: "succeeded", result, completedAt } : item),
      };
      if (allDone) {
        for (const actor of stepActors.values()) actor.stop();
        runActor.stop();
        const run = executionRun(current);
        return { kind: "succeeded", run, stepResults: outputResults(current.steps), telemetry: telemetry(run, null, revision, true) };
      }
      if (current.controlState !== "active") {
        for (const actor of stepActors.values()) actor.stop();
        runActor.stop();
        return controlOutcome(current)!;
      }
    }

    const run = executionRun(current);
    return { kind: "recovery_required", run, failure: executionFailure("invalid_persisted_state"), stepId: "" };
  }

  private async authorize(
    record: DurableExecutionRun,
    stepId: string,
    capabilityId: CapabilityExecutionInput["capabilityId"],
    resourceReferences: readonly string[],
    resolvedInputs: CapabilityExecutionInput["inputs"],
    context: { readonly requestId?: string; readonly correlationId?: string },
  ): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly failure: ExecutionFailure }> {
    try {
      const decision = await this.options.authorizer.authorize({
        executionId: record.id,
        stepId,
        capabilityId,
        authenticatedUserId: record.userId,
        ...(record.acceptedRequestId ? { acceptedRequestId: record.acceptedRequestId } : {}),
        ...(record.acceptanceFingerprint ? { acceptanceFingerprint: record.acceptanceFingerprint } : {}),
        idempotencyKey: record.idempotencyKey,
        requestFingerprint: record.requestFingerprint,
        conversationId: record.runtimeContext.conversationId,
        requestMessageBinding: record.runtimeContext.requestMessageBinding!,
        resolvedInputs,
        ...(record.runtimeContext.organizationId ? { organizationId: record.runtimeContext.organizationId } : {}),
        resourceReferences,
        requestId: record.runtimeContext.requestMessageBinding!.requestId,
        ...(context.correlationId ? { correlationId: context.correlationId } : {}),
      });
      if (!decision || typeof decision.allowed !== "boolean") return { allowed: false, failure: executionFailure("authorization_failed") };
      return decision.allowed
        ? { allowed: true }
        : { allowed: false, failure: executionFailure(decision.reasonCode === "authorization_unavailable" ? "authorization_failed" : "authorization_denied") };
    } catch {
      return { allowed: false, failure: executionFailure("authorization_failed") };
    }
  }
}
