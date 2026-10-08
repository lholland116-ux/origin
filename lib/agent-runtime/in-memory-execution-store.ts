import type {
  ClaimDurableStepResult,
  CreateDurableExecutionRunInput,
  CreateDurableExecutionRunResult,
  AssociateAcceptedExecutionRunInput,
  AssociateAcceptedExecutionRunResult,
  AcceptedRequestExecutionIdentity,
  DurableExecutionRun,
  DurableExecutionStep,
  DurableStepCheckpoint,
  ExecutionControlWriteResult,
  HumanApprovalWriteResult,
  ExecutionStore,
  ExecutionStoreWriteResult,
} from "@/lib/agent-runtime/execution-store";
import type { ExecutionControlEvent, ExecutionControlState, HumanApprovalCheckpoint } from "@/lib/agent-runtime/runtime-contracts";
import { randomUUID } from "node:crypto";
import {
  executionResultJsonBytes,
  executionResultsEqual,
  MAX_DURABLE_RESULT_PAYLOAD_BYTES,
} from "@/lib/agent-runtime/result-payload-contract";
import { MAX_EXECUTION_STEP_ATTEMPTS } from "@/lib/agent-runtime/runtime-contracts";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableStep = Mutable<DurableExecutionStep>;
type MutableRun = Mutable<Omit<DurableExecutionRun, "steps">> & { steps: MutableStep[] };
type PendingAssociation = Readonly<{
  identity: AcceptedRequestExecutionIdentity;
  result: Promise<AssociateAcceptedExecutionRunResult>;
}>;

/** Deterministic store fake for adapter tests; production claims use PostgreSQL conditional updates. */
export class InMemoryExecutionStore implements ExecutionStore {
  private readonly runs = new Map<string, MutableRun>();
  private readonly controlEvents = new Map<string, ExecutionControlEvent[]>();
  private readonly acceptedAssociations = new Map<string, PendingAssociation>();
  private readonly acceptedAssociationKeys = new Map<string, PendingAssociation>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createRun(input: CreateDurableExecutionRunInput): Promise<CreateDurableExecutionRunResult> {
    const prior = [...this.runs.values()].find((run) => run.userId === input.userId
      && run.idempotencyKey === input.idempotencyKey);
    if (prior) {
      if (prior.requestFingerprint !== input.requestFingerprint) return { status: "idempotency_conflict" };
      return { status: "existing", run: structuredClone(prior) };
    }
    const run: MutableRun = {
      id: input.id,
      userId: input.userId,
      runtimeVersion: 1,
      handoffVersion: input.handoffVersion,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      executionPlan: structuredClone(input.executionPlan),
      runtimeContext: structuredClone(input.runtimeContext),
      status: "pending",
      controlState: "active",
      controlRevision: 0,
      snapshotSchemaVersion: 1,
      snapshotRevision: 0,
      snapshot: structuredClone(input.snapshot),
      createdAt: input.createdAt,
      steps: input.steps.map((step) => ({
        runId: input.id,
        userId: input.userId,
        ...structuredClone(step),
        attempt: 1,
        status: "pending",
      })),
      approvalCheckpoints: [],
    };
    for (const checkpoint of input.approvalCheckpoints ?? []) {
      run.controlRevision += 1;
      run.approvalCheckpoints = [...run.approvalCheckpoints, {
        id: checkpoint.id,
        runId: input.id,
        userId: input.userId,
        stepId: checkpoint.stepId,
        planFingerprint: input.requestFingerprint,
        stepFingerprint: checkpoint.stepFingerprint,
        status: "pending",
        source: "runtime_policy",
        createdAt: input.createdAt,
      }];
      this.appendControlEvent(run, {
        action: "approval_required",
        checkpointId: checkpoint.id,
        priorState: "active",
        newState: "active",
        priorControlRevision: run.controlRevision - 1,
        controlRevision: run.controlRevision,
        createdAt: input.createdAt,
      });
    }
    this.runs.set(run.id, run);
    return { status: "created", run: structuredClone(run) };
  }

  associateAcceptedRequest(input: AssociateAcceptedExecutionRunInput): Promise<AssociateAcceptedExecutionRunResult> {
    const { acceptance, run } = input;
    const associationKey = `${acceptance.userId}:${acceptance.idempotencyKey}`;
    if (!validAcceptedAssociationInput(acceptance, run)) return Promise.resolve({ status: "conflict" });

    const prior = this.acceptedAssociations.get(acceptance.requestId)
      ?? this.acceptedAssociationKeys.get(associationKey);
    if (prior) {
      return sameAcceptance(prior.identity, acceptance)
        ? prior.result.then((result) => result.status === "created" ? { ...result, status: "existing" } : result)
        : Promise.resolve({ status: "conflict" });
    }

    const result = Promise.resolve().then(async (): Promise<AssociateAcceptedExecutionRunResult> => {
      const keyRun = [...this.runs.values()].find((candidate) => candidate.userId === run.userId
        && candidate.idempotencyKey === run.idempotencyKey);
      if (keyRun && (keyRun.acceptedRequestId !== acceptance.requestId
        || keyRun.acceptanceFingerprint !== acceptance.requestFingerprint)) return { status: "conflict" };
      if (this.runs.has(run.id) && this.runs.get(run.id)?.acceptedRequestId !== acceptance.requestId) {
        return { status: "conflict" };
      }

      const created = await this.createRun(run);
      if (created.status === "idempotency_conflict") return { status: "conflict" };
      if (created.status === "existing") {
        return created.run.acceptedRequestId === acceptance.requestId
          && created.run.acceptanceFingerprint === acceptance.requestFingerprint
          ? { status: "existing", runId: created.run.id, planFingerprint: created.run.requestFingerprint }
          : { status: "conflict" };
      }

      const stored = this.runs.get(created.run.id);
      if (!stored) return { status: "conflict" };
      stored.acceptedRequestId = acceptance.requestId;
      stored.acceptanceFingerprint = acceptance.requestFingerprint;
      return { status: "created", runId: stored.id, planFingerprint: stored.requestFingerprint };
    });
    const pending = { identity: acceptance, result };
    this.acceptedAssociations.set(acceptance.requestId, pending);
    this.acceptedAssociationKeys.set(associationKey, pending);
    void result.then((outcome) => {
      if (outcome.status === "conflict") {
        if (this.acceptedAssociations.get(acceptance.requestId) === pending) this.acceptedAssociations.delete(acceptance.requestId);
        if (this.acceptedAssociationKeys.get(associationKey) === pending) this.acceptedAssociationKeys.delete(associationKey);
      }
    }, () => {
      if (this.acceptedAssociations.get(acceptance.requestId) === pending) this.acceptedAssociations.delete(acceptance.requestId);
      if (this.acceptedAssociationKeys.get(associationKey) === pending) this.acceptedAssociationKeys.delete(associationKey);
    });
    return result;
  }

  async getRun(input: { readonly runId: string; readonly userId: string }): Promise<DurableExecutionRun | null> {
    const run = this.runs.get(input.runId);
    return run?.userId === input.userId ? structuredClone(run) : null;
  }

  async getControlEvents(input: { readonly runId: string; readonly userId: string }): Promise<readonly ExecutionControlEvent[]> {
    const run = this.ownedRun(input.runId, input.userId);
    return run ? structuredClone(this.controlEvents.get(run.id) ?? []) : [];
  }

  async saveRunState(input: Parameters<ExecutionStore["saveRunState"]>[0]): Promise<ExecutionStoreWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    if (run.snapshotRevision !== input.expectedRevision) return { status: "conflict" };
    if (run.status !== "pending" || input.status !== "running" || run.controlState !== "active") return { status: "conflict" };
    run.status = input.status;
    run.snapshot = structuredClone(input.snapshot);
    run.snapshotRevision += 1;
    if (input.startedAt) run.startedAt = input.startedAt;
    if (input.completedAt) run.completedAt = input.completedAt;
    if (input.failureCode) run.failureCode = input.failureCode;
    else delete run.failureCode;
    if (input.retainUserInput === false) {
      const { userInput, ...rest } = run.runtimeContext;
      void userInput;
      run.runtimeContext = rest;
    }
    return { status: "saved", snapshotRevision: run.snapshotRevision };
  }

  async claimStep(input: Parameters<ExecutionStore["claimStep"]>[0]): Promise<ClaimDurableStepResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    if (run.snapshotRevision !== input.expectedRevision) return { status: "conflict" };
    const step = run.steps.find((candidate) => candidate.stepId === input.stepId);
    if (!step) return { status: "not_found" };
    if (run.controlState !== "active") return { status: "control_blocked", controlState: run.controlState };
    const checkpoint = run.approvalCheckpoints.find((candidate) => candidate.stepId === input.stepId);
    if (checkpoint?.status === "pending") return { status: "approval_required", checkpoint: structuredClone(checkpoint) };
    if (step.status !== "pending") return { status: "already_claimed", stepStatus: step.status };
    if (run.status !== "running") return { status: "conflict" };
    step.status = "running";
    step.startedAt = input.startedAt;
    run.snapshot = structuredClone(input.snapshot);
    run.snapshotRevision += 1;
    return { status: "claimed", executionKey: step.executionKey, snapshotRevision: run.snapshotRevision };
  }

  async scheduleStepRetry(input: Parameters<ExecutionStore["scheduleStepRetry"]>[0]) {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" } as const;
    if (run.snapshotRevision !== input.expectedRevision || run.status !== "running") return { status: "conflict" } as const;
    const step = run.steps.find((candidate) => candidate.stepId === input.stepId);
    if (!step) return { status: "not_found" } as const;
    if (step.status !== "running") return { status: "conflict" } as const;
    if (["paused", "stopped", "returned"].includes(run.controlState)) return { status: "conflict" } as const;
    if (step.attempt >= MAX_EXECUTION_STEP_ATTEMPTS) return { status: "attempt_limit" } as const;
    const timestamp = new Date(input.nextRetryAt);
    if (!Number.isFinite(timestamp.getTime())) return { status: "conflict" } as const;
    step.status = "retry_pending";
    step.nextRetryAt = timestamp.toISOString();
    delete step.completedAt;
    delete step.result;
    delete step.failureCode;
    run.snapshot = structuredClone(input.snapshot);
    run.snapshotRevision += 1;
    const priorControlRevision = run.controlRevision;
    this.setBoundaryControlState(run, this.now().toISOString());
    return {
      status: "saved", snapshotRevision: run.snapshotRevision,
      ...(run.controlRevision !== priorControlRevision ? { controlState: run.controlState, controlRevision: run.controlRevision } : {}),
    } as const;
  }

  async claimRetryableStep(input: Parameters<ExecutionStore["claimRetryableStep"]>[0]) {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" } as const;
    if (run.snapshotRevision !== input.expectedRevision || run.status !== "running") return { status: "conflict" } as const;
    if (run.controlState !== "active") return { status: "control_blocked", controlState: run.controlState } as const;
    const step = run.steps.find((candidate) => candidate.stepId === input.stepId);
    if (!step) return { status: "not_found" } as const;
    if (step.status !== "retry_pending" || !step.nextRetryAt) {
      return { status: "already_claimed", stepStatus: step.status } as const;
    }
    if (step.attempt >= MAX_EXECUTION_STEP_ATTEMPTS) return { status: "attempt_limit" } as const;
    const checkpoint = run.approvalCheckpoints.find((candidate) => candidate.stepId === input.stepId);
    if (checkpoint?.status === "pending") return { status: "approval_required", checkpoint: structuredClone(checkpoint) } as const;
    const now = this.now();
    const nextRetryAt = new Date(step.nextRetryAt);
    if (!Number.isFinite(now.getTime()) || nextRetryAt.getTime() > now.getTime()) {
      return { status: "not_eligible", nextRetryAt: step.nextRetryAt } as const;
    }
    step.status = "running";
    step.attempt += 1;
    step.startedAt = now.toISOString();
    delete step.nextRetryAt;
    delete step.completedAt;
    delete step.result;
    delete step.failureCode;
    run.snapshot = structuredClone(input.snapshot);
    run.snapshotRevision += 1;
    return { status: "claimed", executionKey: step.executionKey, attempt: step.attempt, snapshotRevision: run.snapshotRevision } as const;
  }

  async checkpoint(input: Parameters<ExecutionStore["checkpoint"]>[0]): Promise<ExecutionStoreWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    if (run.snapshotRevision !== input.expectedRevision) {
      const replayMatches = input.updates.length > 0 && input.updates.every((update) => {
        const step = run.steps.find((candidate) => candidate.stepId === update.stepId);
        return step?.status === update.status
          && step.failureCode === update.failureCode
          && (update.result === undefined
            ? step.result === undefined
            : step.result !== undefined && executionResultsEqual(step.result, update.result));
      });
      return replayMatches
        ? { status: "saved", snapshotRevision: run.snapshotRevision }
        : { status: "conflict" };
    }
    if (input.updates.some((update) => update.result !== undefined
      && ((executionResultJsonBytes(update.result) ?? MAX_DURABLE_RESULT_PAYLOAD_BYTES + 1) > MAX_DURABLE_RESULT_PAYLOAD_BYTES))) {
      return { status: "result_too_large" };
    }
    const resolved: Array<{ step: MutableStep; update: DurableStepCheckpoint }> = [];
    for (const update of input.updates) {
      const step = run.steps.find((candidate) => candidate.stepId === update.stepId);
      const expectedStatus = update.status === "skipped" ? "pending" : "running";
      if (!step || step.status !== expectedStatus) return { status: "conflict" };
      if (update.status === "succeeded" && !update.result) return { status: "conflict" };
      if ((update.status === "failed" || update.status === "skipped") && !update.failureCode) return { status: "conflict" };
      resolved.push({ step, update });
    }
    for (const { step, update } of resolved) {
      step.status = update.status;
      step.completedAt = update.completedAt;
      if (update.result) step.result = structuredClone(update.result);
      if (update.failureCode) step.failureCode = update.failureCode;
    }
    run.status = input.runStatus;
    run.snapshot = structuredClone(input.snapshot);
    run.snapshotRevision += 1;
    if (input.completedAt) run.completedAt = input.completedAt;
    if (input.failureCode) run.failureCode = input.failureCode;
    else if (input.runStatus !== "failed") delete run.failureCode;
    if (input.retainUserInput === false) {
      const { userInput, ...rest } = run.runtimeContext;
      void userInput;
      run.runtimeContext = rest;
    }
    const priorControlRevision = run.controlRevision;
    this.setBoundaryControlState(run, input.completedAt ?? new Date().toISOString());
    return {
      status: "saved", snapshotRevision: run.snapshotRevision,
      ...(run.controlRevision !== priorControlRevision ? { controlState: run.controlState, controlRevision: run.controlRevision } : {}),
    };
  }

  async pauseRun(input: Parameters<ExecutionStore["pauseRun"]>[0]): Promise<ExecutionControlWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    if (run.controlState === "paused" || run.controlState === "pause_requested") {
      return { status: "already_applied", controlState: run.controlState, controlRevision: run.controlRevision };
    }
    if (run.status === "succeeded" || run.status === "failed" || run.controlState !== "active") return { status: "terminal" };
    if (run.controlRevision !== input.expectedControlRevision) return { status: "conflict" };
    const nextState: ExecutionControlState = run.steps.some((step) => step.status === "running") ? "pause_requested" : "paused";
    const priorState = run.controlState;
    const priorControlRevision = run.controlRevision;
    run.controlState = nextState;
    run.controlRevision += 1;
    this.appendControlEvent(run, {
      action: nextState === "paused" ? "paused" : "pause_requested", actorUserId: input.actorUserId,
      priorState, newState: nextState, priorControlRevision, controlRevision: run.controlRevision,
      createdAt: input.createdAt,
    });
    return { status: nextState, controlState: nextState, controlRevision: run.controlRevision };
  }

  async resumeRun(input: Parameters<ExecutionStore["resumeRun"]>[0]): Promise<ExecutionControlWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    if (run.controlState === "active") return { status: "already_applied", controlState: "active", controlRevision: run.controlRevision };
    if (run.status === "succeeded" || run.status === "failed" || ["stop_requested", "stopped", "returned"].includes(run.controlState)) return { status: "terminal" };
    if (run.controlRevision !== input.expectedControlRevision) return { status: "conflict" };
    if (run.steps.some((step) => step.status === "running")) return { status: "unsafe_boundary" };
    if (run.approvalCheckpoints.some((checkpoint) => checkpoint.status === "pending")) return { status: "approval_pending" };
    if (run.controlState !== "paused" && run.controlState !== "pause_requested") return { status: "terminal" };
    const priorState = run.controlState;
    const priorControlRevision = run.controlRevision;
    run.controlState = "active";
    run.controlRevision += 1;
    this.appendControlEvent(run, {
      action: "resumed", actorUserId: input.actorUserId, priorState, newState: "active",
      priorControlRevision, controlRevision: run.controlRevision, createdAt: input.createdAt,
    });
    return { status: "saved", controlState: "active", controlRevision: run.controlRevision };
  }

  async stopRun(input: Parameters<ExecutionStore["stopRun"]>[0]): Promise<ExecutionControlWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    if (run.controlState === "stopped" || run.controlState === "stop_requested") {
      return { status: "already_applied", controlState: run.controlState, controlRevision: run.controlRevision };
    }
    if (run.status === "succeeded" || run.status === "failed" || run.controlState === "returned") return { status: "terminal" };
    if (run.controlRevision !== input.expectedControlRevision) return { status: "conflict" };
    const nextState: ExecutionControlState = run.steps.some((step) => step.status === "running") ? "stop_requested" : "stopped";
    const priorState = run.controlState;
    const priorControlRevision = run.controlRevision;
    run.controlState = nextState;
    run.controlRevision += 1;
    this.appendControlEvent(run, {
      action: nextState === "stopped" ? "stopped" : "stop_requested", actorUserId: input.actorUserId,
      priorState, newState: nextState, priorControlRevision, controlRevision: run.controlRevision,
      createdAt: input.createdAt,
    });
    return { status: nextState, controlState: nextState, controlRevision: run.controlRevision };
  }

  async createApprovalCheckpoint(input: Parameters<ExecutionStore["createApprovalCheckpoint"]>[0]): Promise<HumanApprovalWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    const existing = run.approvalCheckpoints.find((candidate) => candidate.stepId === input.stepId);
    if (existing) {
      return existing.planFingerprint === input.planFingerprint && existing.stepFingerprint === input.stepFingerprint
        ? { status: "existing", checkpoint: structuredClone(existing), controlRevision: run.controlRevision }
        : { status: "conflict" };
    }
    if (run.status === "succeeded" || run.status === "failed" || ["stop_requested", "stopped", "returned"].includes(run.controlState)) return { status: "terminal" };
    if (run.controlRevision !== input.expectedControlRevision || run.requestFingerprint !== input.planFingerprint) return { status: "conflict" };
    if (input.source === "owner_request" && input.actorUserId !== input.userId) return { status: "terminal" };
    const step = run.steps.find((candidate) => candidate.stepId === input.stepId);
    if (!step) return { status: "not_found" };
    if (step.status !== "pending" && step.status !== "retry_pending") return { status: "unsafe_boundary" };
    const checkpoint: HumanApprovalCheckpoint = {
      id: input.checkpointId, runId: input.runId, userId: input.userId, stepId: input.stepId,
      planFingerprint: input.planFingerprint, stepFingerprint: input.stepFingerprint,
      status: "pending", source: input.source,
      ...(input.source === "owner_request" ? { requestedBy: input.userId } : {}),
      createdAt: input.createdAt,
    };
    run.approvalCheckpoints = [...run.approvalCheckpoints, checkpoint];
    const priorControlRevision = run.controlRevision;
    run.controlRevision += 1;
    this.appendControlEvent(run, {
      action: "approval_required", ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      checkpointId: input.checkpointId, priorState: run.controlState, newState: run.controlState,
      priorControlRevision, controlRevision: run.controlRevision, createdAt: input.createdAt,
    });
    return { status: "created", checkpoint: structuredClone(checkpoint), controlRevision: run.controlRevision };
  }

  async decideApprovalCheckpoint(input: Parameters<ExecutionStore["decideApprovalCheckpoint"]>[0]): Promise<HumanApprovalWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    const checkpoint = run.approvalCheckpoints.find((candidate) => candidate.id === input.checkpointId);
    if (!checkpoint) return { status: "not_found" };
    if (checkpoint.status !== "pending") return { status: "already_decided", checkpoint: structuredClone(checkpoint), controlState: run.controlState, controlRevision: run.controlRevision };
    if (input.actorUserId !== input.userId || run.status === "succeeded" || run.status === "failed"
      || ["stop_requested", "stopped", "returned"].includes(run.controlState)) return { status: "terminal" };
    if (run.controlRevision !== input.expectedControlRevision) return { status: "conflict" };
    if (input.decision === "return" && (!input.rationale || input.rationale.trim().length < 1 || input.rationale.trim().length > 1000)) return { status: "invalid_checkpoint" };
    const step = run.steps.find((candidate) => candidate.stepId === checkpoint.stepId);
    if (!step || (step.status !== "pending" && step.status !== "retry_pending")) return { status: "unsafe_boundary" };
    const priorState = run.controlState;
    const priorControlRevision = run.controlRevision;
    const decision = input.decision === "approve" ? "approved" : "returned";
    const nextState: ExecutionControlState = decision === "returned" ? "returned" : priorState;
    const updatedCheckpoint: HumanApprovalCheckpoint = {
      ...checkpoint,
      status: decision,
      decidedBy: input.actorUserId,
      decidedAt: input.decidedAt,
      ...(decision === "returned" ? { rationale: input.rationale!.trim() } : {}),
    };
    run.approvalCheckpoints = run.approvalCheckpoints.map((candidate) => candidate.id === checkpoint.id ? updatedCheckpoint : candidate);
    run.controlState = nextState;
    run.controlRevision += 1;
    this.appendControlEvent(run, {
      action: decision, actorUserId: input.actorUserId, checkpointId: checkpoint.id,
      priorState, newState: nextState, priorControlRevision, controlRevision: run.controlRevision,
      ...(decision === "returned" ? { rationale: input.rationale!.trim() } : {}), createdAt: input.decidedAt,
    });
    return { status: decision, checkpoint: structuredClone(updatedCheckpoint), controlState: nextState, controlRevision: run.controlRevision };
  }

  private appendControlEvent(run: MutableRun, input: Omit<ExecutionControlEvent, "id" | "runId" | "userId" | "snapshotRevision"> & { readonly snapshotRevision?: number }): void {
    const events = this.controlEvents.get(run.id) ?? [];
    events.push({
      id: randomUUID(), runId: run.id, userId: run.userId,
      ...input, snapshotRevision: input.snapshotRevision ?? run.snapshotRevision,
    });
    this.controlEvents.set(run.id, events);
  }

  private setBoundaryControlState(run: MutableRun, createdAt: string): void {
    if (run.controlState !== "pause_requested" && run.controlState !== "stop_requested") return;
    const priorState = run.controlState;
    const priorControlRevision = run.controlRevision;
    const nextState: ExecutionControlState = priorState === "pause_requested" ? "paused" : "stopped";
    run.controlState = nextState;
    run.controlRevision += 1;
    this.appendControlEvent(run, {
      action: nextState, priorState, newState: nextState, priorControlRevision,
      controlRevision: run.controlRevision, createdAt,
    });
  }

  private ownedRun(runId: string, userId: string): MutableRun | undefined {
    const run = this.runs.get(runId);
    return run?.userId === userId ? run : undefined;
  }
}

function sameAcceptance(
  left: AcceptedRequestExecutionIdentity,
  right: AcceptedRequestExecutionIdentity,
): boolean {
  return left.requestId === right.requestId
    && left.userId === right.userId
    && left.conversationId === right.conversationId
    && left.userMessageId === right.userMessageId
    && left.assistantMessageId === right.assistantMessageId
    && left.idempotencyKey === right.idempotencyKey
    && left.requestFingerprint === right.requestFingerprint;
}

function validAcceptedAssociationInput(
  acceptance: AcceptedRequestExecutionIdentity,
  run: CreateDurableExecutionRunInput,
): boolean {
  const binding = run.runtimeContext.requestMessageBinding;
  return /^[0-9a-f-]{36}$/i.test(acceptance.requestId)
    && /^[0-9a-f-]{36}$/i.test(acceptance.userId)
    && /^[0-9a-f-]{36}$/i.test(acceptance.conversationId)
    && /^[0-9a-f-]{36}$/i.test(acceptance.userMessageId)
    && /^[0-9a-f-]{36}$/i.test(acceptance.assistantMessageId)
    && /^[0-9a-f-]{36}$/i.test(run.id)
    && /^[0-9a-f]{64}$/.test(acceptance.requestFingerprint)
    && acceptance.idempotencyKey.length > 0
    && acceptance.idempotencyKey.length <= 128
    && acceptance.idempotencyKey === acceptance.idempotencyKey.trim()
    && run.userId === acceptance.userId
    && run.idempotencyKey === acceptance.idempotencyKey
    && /^[0-9a-f]{64}$/.test(run.requestFingerprint)
    && binding?.requestId === acceptance.requestId
    && binding.userId === acceptance.userId
    && binding.conversationId === acceptance.conversationId
    && binding.userMessageId === acceptance.userMessageId
    && binding.assistantMessageId === acceptance.assistantMessageId
    && run.runtimeContext.conversationId === acceptance.conversationId;
}
