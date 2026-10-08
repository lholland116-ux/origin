import type {
  ClaimDurableStepResult,
  CreateDurableExecutionRunInput,
  CreateDurableExecutionRunResult,
  DurableExecutionRun,
  DurableExecutionStep,
  DurableStepCheckpoint,
  ExecutionStore,
  ExecutionStoreWriteResult,
} from "@/lib/agent-runtime/execution-store";
import {
  executionResultJsonBytes,
  executionResultsEqual,
  MAX_DURABLE_RESULT_PAYLOAD_BYTES,
} from "@/lib/agent-runtime/result-payload-contract";
import { MAX_EXECUTION_STEP_ATTEMPTS } from "@/lib/agent-runtime/runtime-contracts";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableStep = Mutable<DurableExecutionStep>;
type MutableRun = Mutable<Omit<DurableExecutionRun, "steps">> & { steps: MutableStep[] };

/** Deterministic store fake for adapter tests; production claims use PostgreSQL conditional updates. */
export class InMemoryExecutionStore implements ExecutionStore {
  private readonly runs = new Map<string, MutableRun>();

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
    };
    this.runs.set(run.id, run);
    return { status: "created", run: structuredClone(run) };
  }

  async getRun(input: { readonly runId: string; readonly userId: string }): Promise<DurableExecutionRun | null> {
    const run = this.runs.get(input.runId);
    return run?.userId === input.userId ? structuredClone(run) : null;
  }

  async saveRunState(input: Parameters<ExecutionStore["saveRunState"]>[0]): Promise<ExecutionStoreWriteResult> {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" };
    if (run.snapshotRevision !== input.expectedRevision) return { status: "conflict" };
    if (run.status !== "pending" || input.status !== "running") return { status: "conflict" };
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
    return { status: "saved", snapshotRevision: run.snapshotRevision } as const;
  }

  async claimRetryableStep(input: Parameters<ExecutionStore["claimRetryableStep"]>[0]) {
    const run = this.ownedRun(input.runId, input.userId);
    if (!run) return { status: "not_found" } as const;
    if (run.snapshotRevision !== input.expectedRevision || run.status !== "running") return { status: "conflict" } as const;
    const step = run.steps.find((candidate) => candidate.stepId === input.stepId);
    if (!step) return { status: "not_found" } as const;
    if (step.status !== "retry_pending" || !step.nextRetryAt) {
      return { status: "already_claimed", stepStatus: step.status } as const;
    }
    if (step.attempt >= MAX_EXECUTION_STEP_ATTEMPTS) return { status: "attempt_limit" } as const;
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
    return { status: "saved", snapshotRevision: run.snapshotRevision };
  }

  private ownedRun(runId: string, userId: string): MutableRun | undefined {
    const run = this.runs.get(runId);
    return run?.userId === userId ? run : undefined;
  }
}
