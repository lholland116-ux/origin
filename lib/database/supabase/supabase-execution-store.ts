import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import { type CapabilityId } from "@/lib/ai/capability-registry";
import { validateExecutionStepResult } from "@/lib/agent-runtime/xstate-runtime-adapter";
import {
  durablePayloadReferenceSchema,
  executionResultJsonBytes,
  executionResultSha256,
  executionResultsEqual,
  MAX_DURABLE_RESULT_PAYLOAD_BYTES,
  resultStorageMode,
  MAX_DURABLE_RESULT_JSONB_BYTES,
} from "@/lib/agent-runtime/result-payload-contract";
import type {
  ClaimDurableStepResult,
  CreateDurableExecutionRunInput,
  CreateDurableExecutionRunResult,
  DurableExecutionRun,
  DurableExecutionStep,
  ExecutionControlWriteResult,
  ExecutionStore,
  ExecutionStoreWriteResult,
  HumanApprovalWriteResult,
} from "@/lib/agent-runtime/execution-store";
import type { ExecutionControlEvent, ExecutionControlState, HumanApprovalCheckpoint } from "@/lib/agent-runtime/runtime-contracts";
import { EXECUTION_CONTROL_STATES, HUMAN_APPROVAL_STATUSES, MAX_EXECUTION_STEP_ATTEMPTS } from "@/lib/agent-runtime/runtime-contracts";

type ExecutionSql = postgres.Sql | postgres.TransactionSql;
type Row = postgres.Row & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function json(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function iso(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Execution store returned an invalid timestamp.");
  return date.toISOString();
}

function mapStep(value: unknown): DurableExecutionStep {
  const attempt = isRecord(value) ? Number(value.attempt) : Number.NaN;
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.user_id !== "string"
    || typeof value.step_id !== "string" || typeof value.capability_id !== "string"
    || !Array.isArray(value.dependency_ids) || typeof value.execution_key !== "string"
    || typeof value.status !== "string" || !Number.isInteger(attempt)
    || attempt < 1 || attempt > MAX_EXECUTION_STEP_ATTEMPTS) {
    throw new Error("Execution store returned an invalid step record.");
  }
  let result: DurableExecutionStep["result"];
  if (value.result_payload_id !== null && value.result_payload_id !== undefined) {
    const reference = isRecord(value.result_envelope) && isRecord(value.result_envelope.value)
      ? durablePayloadReferenceSchema.safeParse(value.result_envelope.value)
      : null;
    const payload = value.linked_result_payload;
    const resultKind = isRecord(value.result_envelope) ? value.result_envelope.kind : null;
    const actualBytes = executionResultJsonBytes(payload);
    if (!reference?.success || !isRecord(payload)
      || value.result_envelope && Object.keys(value.result_envelope).some((key) => !["kind", "value"].includes(key))
      || value.linked_payload_id !== value.result_payload_id
      || value.linked_payload_run_id !== value.run_id
      || value.linked_payload_user_id !== value.user_id
      || value.linked_payload_step_id !== value.step_id
      || typeof resultKind !== "string" || resultKind !== reference.data.resultKind
      || value.linked_payload_result_kind !== reference.data.resultKind
      || Number(value.linked_payload_size_bytes) !== reference.data.byteLength
      || value.linked_payload_sha256 !== reference.data.sha256
      || actualBytes !== reference.data.byteLength
      || executionResultSha256(payload) !== reference.data.sha256
      || !validateExecutionStepResult(payload, value.capability_id as CapabilityId)
      || payload.kind !== resultKind) {
      throw new Error("Execution store returned an invalid result-payload reference.");
    }
    result = payload as DurableExecutionStep["result"];
  } else if (isRecord(value.result_envelope)) {
    result = value.result_envelope as DurableExecutionStep["result"];
  }
  return {
    runId: value.run_id,
    userId: value.user_id,
    stepId: value.step_id,
    capabilityId: value.capability_id,
    dependencyIds: value.dependency_ids.filter((item): item is string => typeof item === "string"),
    attempt,
    executionKey: value.execution_key,
    status: value.status as DurableExecutionStep["status"],
    ...(iso(value.next_retry_at) ? { nextRetryAt: iso(value.next_retry_at) } : {}),
    ...(result ? { result } : {}),
    ...(typeof value.failure_code === "string" ? { failureCode: value.failure_code } : {}),
    ...(iso(value.started_at) ? { startedAt: iso(value.started_at) } : {}),
    ...(iso(value.completed_at) ? { completedAt: iso(value.completed_at) } : {}),
  };
}

function mapRun(value: unknown, steps: readonly unknown[]): DurableExecutionRun {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.user_id !== "string"
    || typeof value.runtime_version !== "number" || typeof value.handoff_version !== "number"
    || typeof value.idempotency_key !== "string" || typeof value.request_fingerprint !== "string"
    || !isRecord(value.execution_plan) || !isRecord(value.runtime_context)
    || typeof value.status !== "string" || typeof value.snapshot_schema_version !== "number"
    || typeof value.snapshot_revision !== "string" && typeof value.snapshot_revision !== "number"
    || !isRecord(value.snapshot) || typeof value.control_state !== "string"
    || typeof value.control_revision !== "string" && typeof value.control_revision !== "number") {
    throw new Error("Execution store returned an invalid run record.");
  }
  const snapshotRevision = Number(value.snapshot_revision);
  const controlRevision = Number(value.control_revision);
  if (!Number.isSafeInteger(snapshotRevision) || snapshotRevision < 0
    || !Number.isSafeInteger(controlRevision) || controlRevision < 0) throw new Error("Execution store returned an invalid execution revision.");
  if (!EXECUTION_CONTROL_STATES.includes(value.control_state as ExecutionControlState)) throw new Error("Execution store returned an invalid control state.");
  return {
    id: value.id,
    userId: value.user_id,
    runtimeVersion: value.runtime_version,
    handoffVersion: value.handoff_version,
    idempotencyKey: value.idempotency_key,
    requestFingerprint: value.request_fingerprint,
    executionPlan: value.execution_plan as DurableExecutionRun["executionPlan"],
    runtimeContext: value.runtime_context as DurableExecutionRun["runtimeContext"],
    status: value.status as DurableExecutionRun["status"],
    controlState: value.control_state as DurableExecutionRun["controlState"],
    controlRevision,
    ...(typeof value.failure_code === "string" ? { failureCode: value.failure_code } : {}),
    snapshotSchemaVersion: value.snapshot_schema_version,
    snapshotRevision,
    snapshot: value.snapshot as DurableExecutionRun["snapshot"],
    createdAt: iso(value.created_at) ?? "",
    ...(iso(value.started_at) ? { startedAt: iso(value.started_at) } : {}),
    ...(iso(value.completed_at) ? { completedAt: iso(value.completed_at) } : {}),
    steps: steps.map(mapStep),
    approvalCheckpoints: [],
  };
}

function mapApprovalCheckpoint(value: unknown): HumanApprovalCheckpoint {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.run_id !== "string"
    || typeof value.user_id !== "string" || typeof value.step_id !== "string"
    || typeof value.plan_fingerprint !== "string" || typeof value.step_fingerprint !== "string"
    || typeof value.status !== "string" || typeof value.source !== "string"
    || !HUMAN_APPROVAL_STATUSES.includes(value.status as HumanApprovalCheckpoint["status"])
    || !["runtime_policy", "owner_request"].includes(value.source)) {
    throw new Error("Execution store returned an invalid approval checkpoint.");
  }
  return {
    id: value.id,
    runId: value.run_id,
    userId: value.user_id,
    stepId: value.step_id,
    planFingerprint: value.plan_fingerprint,
    stepFingerprint: value.step_fingerprint,
    status: value.status as HumanApprovalCheckpoint["status"],
    source: value.source as HumanApprovalCheckpoint["source"],
    ...(typeof value.requested_by === "string" ? { requestedBy: value.requested_by } : {}),
    createdAt: iso(value.created_at) ?? "",
    ...(typeof value.decided_by === "string" ? { decidedBy: value.decided_by } : {}),
    ...(iso(value.decided_at) ? { decidedAt: iso(value.decided_at) } : {}),
    ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
  };
}

function mapControlEvent(value: unknown): ExecutionControlEvent {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.run_id !== "string"
    || typeof value.user_id !== "string" || typeof value.action !== "string"
    || typeof value.prior_state !== "string" || typeof value.new_state !== "string") {
    throw new Error("Execution store returned an invalid control event.");
  }
  const priorControlRevision = Number(value.prior_control_revision);
  const controlRevision = Number(value.control_revision);
  const snapshotRevision = Number(value.snapshot_revision);
  if (![priorControlRevision, controlRevision, snapshotRevision].every(Number.isSafeInteger)
    || priorControlRevision < 0 || controlRevision !== priorControlRevision + 1 || snapshotRevision < 0
    || !EXECUTION_CONTROL_STATES.includes(value.prior_state as ExecutionControlState)
    || !EXECUTION_CONTROL_STATES.includes(value.new_state as ExecutionControlState)
    || !["approval_required", "approved", "returned", "pause_requested", "paused", "resumed", "stop_requested", "stopped"].includes(String(value.action))) {
    throw new Error("Execution store returned an invalid control event revision.");
  }
  return {
    id: value.id,
    runId: value.run_id,
    userId: value.user_id,
    action: value.action as ExecutionControlEvent["action"],
    ...(typeof value.actor_user_id === "string" ? { actorUserId: value.actor_user_id } : {}),
    ...(typeof value.checkpoint_id === "string" ? { checkpointId: value.checkpoint_id } : {}),
    priorState: value.prior_state as ExecutionControlState,
    newState: value.new_state as ExecutionControlState,
    priorControlRevision,
    controlRevision,
    snapshotRevision,
    ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
    createdAt: iso(value.created_at) ?? "",
  };
}

async function loadRun(sql: ExecutionSql, runId: string, userId: string): Promise<DurableExecutionRun | null> {
  const runs = await sql`SELECT * FROM public.execution_runs WHERE id = ${runId}::uuid AND user_id = ${userId}::uuid` as readonly Row[];
  const row = runs[0];
  if (!row) return null;
  const steps = await sql`SELECT steps.*,
      payload.id AS linked_payload_id,
      payload.run_id AS linked_payload_run_id,
      payload.user_id AS linked_payload_user_id,
      payload.step_id AS linked_payload_step_id,
      payload.result_kind AS linked_payload_result_kind,
      payload.payload AS linked_result_payload,
      payload.serialized_size_bytes AS linked_payload_size_bytes,
      payload.payload_sha256 AS linked_payload_sha256
    FROM public.execution_steps AS steps
    LEFT JOIN public.execution_step_result_payloads AS payload
      ON payload.id = steps.result_payload_id
      AND payload.run_id = steps.run_id
      AND payload.user_id = steps.user_id
      AND payload.step_id = steps.step_id
    WHERE steps.run_id = ${runId}::uuid AND steps.user_id = ${userId}::uuid
    ORDER BY steps.created_at, steps.step_id`;
  const checkpoints = await sql`SELECT * FROM public.execution_human_approval_checkpoints
    WHERE run_id = ${runId}::uuid AND user_id = ${userId}::uuid ORDER BY created_at, id`;
  return { ...mapRun(row, steps), approvalCheckpoints: checkpoints.map(mapApprovalCheckpoint) };
}

async function appendControlEvent(sql: ExecutionSql, input: {
  readonly runId: string;
  readonly userId: string;
  readonly action: ExecutionControlEvent["action"];
  readonly actorUserId?: string;
  readonly checkpointId?: string;
  readonly priorState: ExecutionControlState;
  readonly newState: ExecutionControlState;
  readonly priorControlRevision: number;
  readonly controlRevision: number;
  readonly snapshotRevision: number;
  readonly rationale?: string;
  readonly createdAt: string;
}): Promise<void> {
  await sql`INSERT INTO public.execution_control_events (
    run_id, user_id, checkpoint_id, action, actor_user_id, prior_state, new_state,
    prior_control_revision, control_revision, snapshot_revision, rationale, created_at
  ) VALUES (
    ${input.runId}::uuid, ${input.userId}::uuid, ${input.checkpointId ?? null}::uuid,
    ${input.action}, ${input.actorUserId ?? null}::uuid, ${input.priorState}, ${input.newState},
    ${input.priorControlRevision}, ${input.controlRevision}, ${input.snapshotRevision},
    ${input.rationale ?? null}, ${input.createdAt}::timestamptz
  )`;
}

function checkpointReplayMatches(
  run: DurableExecutionRun,
  input: Parameters<ExecutionStore["checkpoint"]>[0],
): boolean {
  return input.updates.length > 0 && input.updates.every((update) => {
    const step = run.steps.find((candidate) => candidate.stepId === update.stepId);
    return step?.status === update.status
      && step.failureCode === update.failureCode
      && (update.result === undefined
        ? step.result === undefined
        : step.result !== undefined && executionResultsEqual(step.result, update.result));
  });
}

/** Direct PostgreSQL adapter. Every lookup/update carries user_id and run_id; claims/checkpoints serialize on the owned run row. */
export class SupabaseExecutionStore implements ExecutionStore {
  constructor(private readonly sql: postgres.Sql) {}

  async createRun(input: CreateDurableExecutionRunInput): Promise<CreateDurableExecutionRunResult> {
    return this.sql.begin(async (tx) => {
      const inserted = await tx`
        INSERT INTO public.execution_runs (
          id, user_id, handoff_version, idempotency_key, request_fingerprint,
          execution_plan, runtime_context, snapshot_schema_version, snapshot, created_at
        ) VALUES (
          ${input.id}::uuid, ${input.userId}::uuid, ${input.handoffVersion}, ${input.idempotencyKey},
          ${input.requestFingerprint}, ${tx.json(json(input.executionPlan))},
          ${tx.json(json(input.runtimeContext))}, 1, ${tx.json(json(input.snapshot))}, ${input.createdAt}::timestamptz
        ) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id
      ` as readonly Row[];

      if (inserted.length === 0) {
        const prior = await tx`SELECT id, request_fingerprint FROM public.execution_runs
          WHERE user_id = ${input.userId}::uuid AND idempotency_key = ${input.idempotencyKey}` as readonly Row[];
        if (prior.length !== 1 || typeof prior[0]?.id !== "string") return { status: "idempotency_conflict" };
        if (prior[0]?.request_fingerprint !== input.requestFingerprint) return { status: "idempotency_conflict" };
        const existing = await loadRun(tx, prior[0].id, input.userId);
        return existing ? { status: "existing", run: existing } : { status: "idempotency_conflict" };
      }

      for (const step of input.steps) {
        await tx`INSERT INTO public.execution_steps (
          run_id, user_id, step_id, capability_id, dependency_ids, attempt, execution_key
        ) VALUES (
          ${input.id}::uuid, ${input.userId}::uuid, ${step.stepId}, ${step.capabilityId},
          ${[...step.dependencyIds]}::text[], 1, ${step.executionKey}::uuid
        )`;
      }
      for (const checkpoint of input.approvalCheckpoints ?? []) {
        await tx`INSERT INTO public.execution_human_approval_checkpoints (
          id, run_id, user_id, step_id, plan_fingerprint, step_fingerprint, source, created_at
        ) VALUES (
          ${checkpoint.id}::uuid, ${input.id}::uuid, ${input.userId}::uuid, ${checkpoint.stepId},
          ${input.requestFingerprint}, ${checkpoint.stepFingerprint}, 'runtime_policy', ${input.createdAt}::timestamptz
        )`;
        const revisions = await tx`UPDATE public.execution_runs SET control_revision = control_revision + 1
          WHERE id = ${input.id}::uuid AND user_id = ${input.userId}::uuid
          RETURNING control_revision, snapshot_revision` as readonly Row[];
        if (revisions.length !== 1) throw new Error("Execution store could not revise approval control state.");
        const revision = Number(revisions[0]!.control_revision);
        await tx`INSERT INTO public.execution_control_events (
          run_id, user_id, checkpoint_id, action, prior_state, new_state,
          prior_control_revision, control_revision, snapshot_revision, created_at
        ) VALUES (
          ${input.id}::uuid, ${input.userId}::uuid, ${checkpoint.id}::uuid, 'approval_required',
          'active', 'active', ${revision - 1}, ${revision}, ${Number(revisions[0]!.snapshot_revision)}, ${input.createdAt}::timestamptz
        )`;
      }
      const run = await loadRun(tx, input.id, input.userId);
      if (!run) throw new Error("Execution store could not read a newly created run.");
      return { status: "created", run };
    });
  }

  async getRun(input: { readonly runId: string; readonly userId: string }): Promise<DurableExecutionRun | null> {
    return this.sql.begin("isolation level repeatable read", (tx) => loadRun(tx, input.runId, input.userId));
  }

  async getControlEvents(input: { readonly runId: string; readonly userId: string }): Promise<readonly ExecutionControlEvent[]> {
    const rows = await this.sql`SELECT * FROM public.execution_control_events
      WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
      ORDER BY control_revision, created_at, id`;
    return rows.map(mapControlEvent);
  }

  async pauseRun(input: Parameters<ExecutionStore["pauseRun"]>[0]): Promise<ExecutionControlWriteResult> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`SELECT status, snapshot_revision, control_state, control_revision
        FROM public.execution_runs WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (rows.length !== 1) return { status: "not_found" };
      const row = rows[0]!;
      const controlState = row.control_state as ExecutionControlState;
      const controlRevision = Number(row.control_revision);
      if (controlState === "paused" || controlState === "pause_requested") {
        return { status: "already_applied", controlState, controlRevision };
      }
      if (row.status === "succeeded" || row.status === "failed" || controlState !== "active") return { status: "terminal" };
      if (controlRevision !== input.expectedControlRevision) return { status: "conflict" };
      const inFlight = await tx`SELECT step_id FROM public.execution_steps
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND status = 'running' FOR UPDATE` as readonly Row[];
      const nextControlState: ExecutionControlState = inFlight.length > 0 ? "pause_requested" : "paused";
      const updated = await tx`UPDATE public.execution_runs SET control_state = ${nextControlState}, control_revision = control_revision + 1
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND control_revision = ${input.expectedControlRevision}
        RETURNING control_revision, snapshot_revision` as readonly Row[];
      if (updated.length !== 1) return { status: "conflict" };
      const nextRevision = Number(updated[0]!.control_revision);
      await appendControlEvent(tx, {
        runId: input.runId, userId: input.userId,
        action: nextControlState === "paused" ? "paused" : "pause_requested",
        actorUserId: input.actorUserId, priorState: controlState, newState: nextControlState,
        priorControlRevision: controlRevision, controlRevision: nextRevision,
        snapshotRevision: Number(updated[0]!.snapshot_revision), createdAt: input.createdAt,
      });
      return { status: nextControlState, controlState: nextControlState, controlRevision: nextRevision };
    });
  }

  async resumeRun(input: Parameters<ExecutionStore["resumeRun"]>[0]): Promise<ExecutionControlWriteResult> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`SELECT status, snapshot_revision, control_state, control_revision
        FROM public.execution_runs WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (rows.length !== 1) return { status: "not_found" };
      const row = rows[0]!;
      const controlState = row.control_state as ExecutionControlState;
      const controlRevision = Number(row.control_revision);
      if (controlState === "active") return { status: "already_applied", controlState, controlRevision };
      if (row.status === "succeeded" || row.status === "failed" || controlState === "stopped" || controlState === "returned" || controlState === "stop_requested") {
        return { status: "terminal" };
      }
      if (controlRevision !== input.expectedControlRevision) return { status: "conflict" };
      const inFlight = await tx`SELECT step_id FROM public.execution_steps
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND status = 'running' FOR UPDATE` as readonly Row[];
      if (inFlight.length > 0) return { status: "unsafe_boundary" };
      const pending = await tx`SELECT id FROM public.execution_human_approval_checkpoints
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND status = 'pending' LIMIT 1` as readonly Row[];
      if (pending.length > 0) return { status: "approval_pending" };
      if (controlState !== "paused" && controlState !== "pause_requested") return { status: "terminal" };
      const updated = await tx`UPDATE public.execution_runs SET control_state = 'active', control_revision = control_revision + 1
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND control_revision = ${input.expectedControlRevision}
        RETURNING control_revision, snapshot_revision` as readonly Row[];
      if (updated.length !== 1) return { status: "conflict" };
      const nextRevision = Number(updated[0]!.control_revision);
      await appendControlEvent(tx, {
        runId: input.runId, userId: input.userId, action: "resumed", actorUserId: input.actorUserId,
        priorState: controlState, newState: "active", priorControlRevision: controlRevision,
        controlRevision: nextRevision, snapshotRevision: Number(updated[0]!.snapshot_revision), createdAt: input.createdAt,
      });
      return { status: "saved", controlState: "active", controlRevision: nextRevision };
    });
  }

  async stopRun(input: Parameters<ExecutionStore["stopRun"]>[0]): Promise<ExecutionControlWriteResult> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`SELECT status, snapshot_revision, control_state, control_revision
        FROM public.execution_runs WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (rows.length !== 1) return { status: "not_found" };
      const row = rows[0]!;
      const controlState = row.control_state as ExecutionControlState;
      const controlRevision = Number(row.control_revision);
      if (controlState === "stopped" || controlState === "stop_requested") {
        return { status: "already_applied", controlState, controlRevision };
      }
      if (row.status === "succeeded" || row.status === "failed" || controlState === "returned") return { status: "terminal" };
      if (controlRevision !== input.expectedControlRevision) return { status: "conflict" };
      const inFlight = await tx`SELECT step_id FROM public.execution_steps
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND status = 'running' FOR UPDATE` as readonly Row[];
      const nextControlState: ExecutionControlState = inFlight.length > 0 ? "stop_requested" : "stopped";
      const updated = await tx`UPDATE public.execution_runs SET control_state = ${nextControlState}, control_revision = control_revision + 1
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND control_revision = ${input.expectedControlRevision}
        RETURNING control_revision, snapshot_revision` as readonly Row[];
      if (updated.length !== 1) return { status: "conflict" };
      const nextRevision = Number(updated[0]!.control_revision);
      await appendControlEvent(tx, {
        runId: input.runId, userId: input.userId,
        action: nextControlState === "stopped" ? "stopped" : "stop_requested",
        actorUserId: input.actorUserId, priorState: controlState, newState: nextControlState,
        priorControlRevision: controlRevision, controlRevision: nextRevision,
        snapshotRevision: Number(updated[0]!.snapshot_revision), createdAt: input.createdAt,
      });
      return { status: nextControlState, controlState: nextControlState, controlRevision: nextRevision };
    });
  }

  async createApprovalCheckpoint(input: Parameters<ExecutionStore["createApprovalCheckpoint"]>[0]): Promise<HumanApprovalWriteResult> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`SELECT status, request_fingerprint, snapshot_revision, control_state, control_revision
        FROM public.execution_runs WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (rows.length !== 1) return { status: "not_found" };
      const row = rows[0]!;
      const existingRows = await tx`SELECT * FROM public.execution_human_approval_checkpoints
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId}` as readonly Row[];
      if (existingRows.length === 1) {
        const existing = mapApprovalCheckpoint(existingRows[0]);
        return existing.planFingerprint === input.planFingerprint && existing.stepFingerprint === input.stepFingerprint
          ? { status: "existing", checkpoint: existing, controlRevision: Number(row.control_revision) }
          : { status: "conflict" };
      }
      const controlState = row.control_state as ExecutionControlState;
      const controlRevision = Number(row.control_revision);
      if (row.status === "succeeded" || row.status === "failed" || ["stop_requested", "stopped", "returned"].includes(controlState)) {
        return { status: "terminal" };
      }
      if (Number(row.control_revision) !== input.expectedControlRevision || row.request_fingerprint !== input.planFingerprint) return { status: "conflict" };
      if (input.source === "owner_request" && input.actorUserId !== input.userId) return { status: "terminal" };
      const steps = await tx`SELECT status FROM public.execution_steps
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId} FOR UPDATE` as readonly Row[];
      if (steps.length !== 1) return { status: "not_found" };
      if (steps[0]!.status !== "pending" && steps[0]!.status !== "retry_pending") return { status: "unsafe_boundary" };
      await tx`INSERT INTO public.execution_human_approval_checkpoints (
        id, run_id, user_id, step_id, plan_fingerprint, step_fingerprint, source, requested_by, created_at
      ) VALUES (
        ${input.checkpointId}::uuid, ${input.runId}::uuid, ${input.userId}::uuid, ${input.stepId},
        ${input.planFingerprint}, ${input.stepFingerprint}, ${input.source},
        ${input.source === "owner_request" ? input.userId : null}::uuid, ${input.createdAt}::timestamptz
      )`;
      const updated = await tx`UPDATE public.execution_runs SET control_revision = control_revision + 1
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND control_revision = ${input.expectedControlRevision}
        RETURNING control_revision, snapshot_revision` as readonly Row[];
      if (updated.length !== 1) throw new Error("Execution approval checkpoint lost its control revision.");
      const nextRevision = Number(updated[0]!.control_revision);
      await appendControlEvent(tx, {
        runId: input.runId, userId: input.userId, action: "approval_required",
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}), checkpointId: input.checkpointId,
        priorState: controlState, newState: controlState, priorControlRevision: controlRevision,
        controlRevision: nextRevision, snapshotRevision: Number(updated[0]!.snapshot_revision), createdAt: input.createdAt,
      });
      const checkpointRows = await tx`SELECT * FROM public.execution_human_approval_checkpoints WHERE id = ${input.checkpointId}::uuid` as readonly Row[];
      if (checkpointRows.length !== 1) throw new Error("Execution approval checkpoint was not persisted.");
      return { status: "created", checkpoint: mapApprovalCheckpoint(checkpointRows[0]), controlRevision: nextRevision };
    });
  }

  async decideApprovalCheckpoint(input: Parameters<ExecutionStore["decideApprovalCheckpoint"]>[0]): Promise<HumanApprovalWriteResult> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`SELECT status, snapshot_revision, control_state, control_revision
        FROM public.execution_runs WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (rows.length !== 1) return { status: "not_found" };
      const row = rows[0]!;
      const checkpointRows = await tx`SELECT * FROM public.execution_human_approval_checkpoints
        WHERE id = ${input.checkpointId}::uuid AND run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (checkpointRows.length !== 1) return { status: "not_found" };
      const checkpoint = mapApprovalCheckpoint(checkpointRows[0]);
      const controlState = row.control_state as ExecutionControlState;
      const controlRevision = Number(row.control_revision);
      if (checkpoint.status !== "pending") {
        return { status: "already_decided", checkpoint, controlState, controlRevision };
      }
      if (input.actorUserId !== input.userId || row.status === "succeeded" || row.status === "failed"
        || ["stop_requested", "stopped", "returned"].includes(controlState)) return { status: "terminal" };
      if (controlRevision !== input.expectedControlRevision) return { status: "conflict" };
      if (input.decision === "return" && (!input.rationale || input.rationale.trim().length < 1 || input.rationale.trim().length > 1000)) {
        return { status: "invalid_checkpoint" };
      }
      const stepRows = await tx`SELECT status FROM public.execution_steps
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${checkpoint.stepId} FOR UPDATE` as readonly Row[];
      if (stepRows.length !== 1 || (stepRows[0]!.status !== "pending" && stepRows[0]!.status !== "retry_pending")) {
        return { status: "unsafe_boundary" };
      }
      const decision = input.decision === "approve" ? "approved" : "returned";
      const nextControlState: ExecutionControlState = decision === "returned" ? "returned" : controlState;
      const updatedCheckpoint = await tx`UPDATE public.execution_human_approval_checkpoints SET
          status = ${decision}, decided_by = ${input.actorUserId}::uuid, decided_at = ${input.decidedAt}::timestamptz,
          rationale = ${decision === "returned" ? input.rationale!.trim() : null}
        WHERE id = ${input.checkpointId}::uuid AND run_id = ${input.runId}::uuid
          AND user_id = ${input.userId}::uuid AND status = 'pending'
        RETURNING *` as readonly Row[];
      if (updatedCheckpoint.length !== 1) return { status: "conflict" };
      const updatedRun = await tx`UPDATE public.execution_runs SET control_state = ${nextControlState}, control_revision = control_revision + 1
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND control_revision = ${input.expectedControlRevision}
        RETURNING control_revision, snapshot_revision` as readonly Row[];
      if (updatedRun.length !== 1) throw new Error("Execution approval decision lost its control revision.");
      const nextRevision = Number(updatedRun[0]!.control_revision);
      await appendControlEvent(tx, {
        runId: input.runId, userId: input.userId, action: decision,
        actorUserId: input.actorUserId, checkpointId: input.checkpointId,
        priorState: controlState, newState: nextControlState, priorControlRevision: controlRevision,
        controlRevision: nextRevision, snapshotRevision: Number(updatedRun[0]!.snapshot_revision),
        ...(decision === "returned" ? { rationale: input.rationale!.trim() } : {}), createdAt: input.decidedAt,
      });
      return {
        status: decision, checkpoint: mapApprovalCheckpoint(updatedCheckpoint[0]),
        controlState: nextControlState, controlRevision: nextRevision,
      };
    });
  }

  async saveRunState(input: Parameters<ExecutionStore["saveRunState"]>[0]): Promise<ExecutionStoreWriteResult> {
    const rows = await this.sql`
      UPDATE public.execution_runs SET
        status = ${input.status}, snapshot = ${this.sql.json(json(input.snapshot))},
        snapshot_revision = snapshot_revision + 1,
        started_at = COALESCE(${input.startedAt ?? null}::timestamptz, started_at),
        completed_at = COALESCE(${input.completedAt ?? null}::timestamptz, completed_at),
        failure_code = ${input.status === "failed" ? input.failureCode ?? null : null},
        runtime_context = CASE WHEN ${input.retainUserInput === false}
          THEN runtime_context - 'userInput' ELSE runtime_context END
      WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND status = 'pending'
        AND ${input.status} = 'running' AND control_state = 'active' AND snapshot_revision = ${input.expectedRevision}
      RETURNING snapshot_revision
    ` as readonly Row[];
    if (rows.length === 1) return { status: "saved", snapshotRevision: Number(rows[0]!.snapshot_revision) };
    return await this.exists(input.runId, input.userId) ? { status: "conflict" } : { status: "not_found" };
  }

  async claimStep(input: Parameters<ExecutionStore["claimStep"]>[0]): Promise<ClaimDurableStepResult> {
    return this.sql.begin(async (tx) => {
      const runs = await tx`SELECT snapshot_revision, status, control_state FROM public.execution_runs
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (runs.length !== 1) return { status: "not_found" };
      if (Number(runs[0]!.snapshot_revision) !== input.expectedRevision || runs[0]!.status !== "running") return { status: "conflict" };
      if (runs[0]!.control_state !== "active") return { status: "control_blocked", controlState: runs[0]!.control_state as ExecutionControlState };
      const checkpoints = await tx`SELECT * FROM public.execution_human_approval_checkpoints
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId}` as readonly Row[];
      if (checkpoints.length === 1 && checkpoints[0]!.status === "pending") {
        return { status: "approval_required", checkpoint: mapApprovalCheckpoint(checkpoints[0]) };
      }
      if (checkpoints.length === 1 && checkpoints[0]!.status === "returned") {
        return { status: "control_blocked", controlState: "returned" };
      }
      const claimed = await tx`UPDATE public.execution_steps SET status = 'running', started_at = ${input.startedAt}::timestamptz
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId} AND status = 'pending'
        RETURNING execution_key` as readonly Row[];
      if (claimed.length !== 1 || typeof claimed[0]!.execution_key !== "string") {
        const prior = await tx`SELECT status FROM public.execution_steps
          WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId}` as readonly Row[];
        return prior.length === 1
          ? { status: "already_claimed", stepStatus: prior[0]!.status as DurableExecutionStep["status"] }
          : { status: "not_found" };
      }
      const updated = await tx`UPDATE public.execution_runs SET snapshot = ${tx.json(json(input.snapshot))},
        snapshot_revision = snapshot_revision + 1
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND snapshot_revision = ${input.expectedRevision}
        RETURNING snapshot_revision` as readonly Row[];
      if (updated.length !== 1) throw new Error("Execution step claim lost its locked run revision.");
      return { status: "claimed", executionKey: claimed[0]!.execution_key, snapshotRevision: Number(updated[0]!.snapshot_revision) };
    });
  }

  async scheduleStepRetry(input: Parameters<ExecutionStore["scheduleStepRetry"]>[0]): Promise<Awaited<ReturnType<ExecutionStore["scheduleStepRetry"]>>> {
    return this.sql.begin(async (tx) => {
      const runs = await tx`SELECT snapshot_revision, status, control_state FROM public.execution_runs
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (runs.length !== 1) return { status: "not_found" };
      if (Number(runs[0]!.snapshot_revision) !== input.expectedRevision || runs[0]!.status !== "running") return { status: "conflict" };
      const priorControlState = runs[0]!.control_state as ExecutionControlState;
      if (["paused", "stopped", "returned"].includes(priorControlState)) return { status: "conflict" };
      const steps = await tx`SELECT status, attempt FROM public.execution_steps
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId} FOR UPDATE` as readonly Row[];
      if (steps.length !== 1) return { status: "not_found" };
      if (steps[0]!.status !== "running") return { status: "conflict" };
      if (Number(steps[0]!.attempt) >= MAX_EXECUTION_STEP_ATTEMPTS) return { status: "attempt_limit" };
      const scheduled = await tx`UPDATE public.execution_steps SET
          status = 'retry_pending', next_retry_at = ${input.nextRetryAt}::timestamptz,
          result_envelope = NULL, result_payload_id = NULL, failure_code = NULL, completed_at = NULL
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
          AND step_id = ${input.stepId} AND status = 'running'
        RETURNING step_id` as readonly Row[];
      if (scheduled.length !== 1) return { status: "conflict" };
      const nextControlState: ExecutionControlState = priorControlState === "pause_requested" ? "paused"
        : priorControlState === "stop_requested" ? "stopped" : priorControlState;
      const updated = await tx`UPDATE public.execution_runs SET snapshot = ${tx.json(json(input.snapshot))},
          snapshot_revision = snapshot_revision + 1,
          control_state = ${nextControlState},
          control_revision = control_revision + CASE WHEN ${nextControlState} <> ${priorControlState} THEN 1 ELSE 0 END
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
          AND status = 'running' AND snapshot_revision = ${input.expectedRevision}
        RETURNING snapshot_revision, control_revision` as readonly Row[];
      if (updated.length !== 1) throw new Error("Retry scheduling lost its locked run revision.");
      const snapshotRevision = Number(updated[0]!.snapshot_revision);
      const controlRevision = Number(updated[0]!.control_revision);
      if (nextControlState !== priorControlState) {
        await tx`INSERT INTO public.execution_control_events (
          run_id, user_id, action, prior_state, new_state, prior_control_revision, control_revision,
          snapshot_revision, created_at
        ) VALUES (
          ${input.runId}::uuid, ${input.userId}::uuid, ${nextControlState === "paused" ? "paused" : "stopped"},
          ${priorControlState}, ${nextControlState}, ${controlRevision - 1}, ${controlRevision}, ${snapshotRevision}, clock_timestamp()
        )`;
      }
      return {
        status: "saved", snapshotRevision,
        ...(nextControlState !== "active" ? { controlState: nextControlState, controlRevision } : {}),
      };
    });
  }

  async claimRetryableStep(input: Parameters<ExecutionStore["claimRetryableStep"]>[0]): Promise<Awaited<ReturnType<ExecutionStore["claimRetryableStep"]>>> {
    return this.sql.begin(async (tx) => {
      const runs = await tx`SELECT snapshot_revision, status, control_state FROM public.execution_runs
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (runs.length !== 1) return { status: "not_found" };
      if (Number(runs[0]!.snapshot_revision) !== input.expectedRevision || runs[0]!.status !== "running") return { status: "conflict" };
      if (runs[0]!.control_state !== "active") return { status: "control_blocked", controlState: runs[0]!.control_state as ExecutionControlState };
      const steps = await tx`SELECT status, attempt, next_retry_at FROM public.execution_steps
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId} FOR UPDATE` as readonly Row[];
      if (steps.length !== 1) return { status: "not_found" };
      if (steps[0]!.status !== "retry_pending") {
        return { status: "already_claimed", stepStatus: steps[0]!.status as DurableExecutionStep["status"] };
      }
      if (Number(steps[0]!.attempt) >= MAX_EXECUTION_STEP_ATTEMPTS) return { status: "attempt_limit" };
      const checkpoints = await tx`SELECT * FROM public.execution_human_approval_checkpoints
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND step_id = ${input.stepId}` as readonly Row[];
      if (checkpoints.length === 1 && checkpoints[0]!.status === "pending") {
        return { status: "approval_required", checkpoint: mapApprovalCheckpoint(checkpoints[0]) };
      }
      if (checkpoints.length === 1 && checkpoints[0]!.status === "returned") {
        return { status: "control_blocked", controlState: "returned" };
      }
      const claimed = await tx`UPDATE public.execution_steps SET
          status = 'running', attempt = attempt + 1, started_at = clock_timestamp(), next_retry_at = NULL,
          result_envelope = NULL, result_payload_id = NULL, failure_code = NULL, completed_at = NULL
        WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
          AND step_id = ${input.stepId} AND status = 'retry_pending'
          AND next_retry_at <= clock_timestamp() AND attempt < ${MAX_EXECUTION_STEP_ATTEMPTS}
        RETURNING execution_key, attempt` as readonly Row[];
      if (claimed.length !== 1 || typeof claimed[0]!.execution_key !== "string") {
        const eligibility = await tx`SELECT next_retry_at, clock_timestamp() AS database_now
          FROM public.execution_steps WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
            AND step_id = ${input.stepId}` as readonly Row[];
        const nextRetryAt = iso(eligibility[0]?.next_retry_at);
        const databaseNow = iso(eligibility[0]?.database_now);
        if (nextRetryAt && databaseNow && nextRetryAt > databaseNow) return { status: "not_eligible", nextRetryAt };
        return { status: "attempt_limit" };
      }
      const updated = await tx`UPDATE public.execution_runs SET snapshot = ${tx.json(json(input.snapshot))},
          snapshot_revision = snapshot_revision + 1
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
          AND status = 'running' AND snapshot_revision = ${input.expectedRevision}
        RETURNING snapshot_revision` as readonly Row[];
      if (updated.length !== 1) throw new Error("Retry claim lost its locked run revision.");
      return {
        status: "claimed",
        executionKey: claimed[0]!.execution_key,
        attempt: Number(claimed[0]!.attempt),
        snapshotRevision: Number(updated[0]!.snapshot_revision),
      };
    });
  }

  async checkpoint(input: Parameters<ExecutionStore["checkpoint"]>[0]): Promise<ExecutionStoreWriteResult> {
    return this.sql.begin(async (tx) => {
      const runs = await tx`SELECT snapshot_revision, status, control_state FROM public.execution_runs
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (runs.length !== 1) return { status: "not_found" };
      if (Number(runs[0]!.snapshot_revision) !== input.expectedRevision) {
        const existing = await loadRun(tx, input.runId, input.userId);
        return existing && checkpointReplayMatches(existing, input)
          ? { status: "saved", snapshotRevision: existing.snapshotRevision,
            ...(existing.controlState !== "active" ? { controlState: existing.controlState, controlRevision: existing.controlRevision } : {}) }
          : { status: "conflict" };
      }

      for (const update of input.updates) {
        const expected = update.status === "skipped" ? "pending" : "running";
        const current = await tx`SELECT status, capability_id FROM public.execution_steps
          WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
            AND step_id = ${update.stepId} FOR UPDATE` as readonly Row[];
        if (current.length !== 1 || current[0]!.status !== expected) return { status: "conflict" };
        if (update.status === "succeeded" && !update.result) return { status: "conflict" };
        if (update.result) {
          const byteLength = executionResultJsonBytes(update.result);
          if (byteLength === null || byteLength > MAX_DURABLE_RESULT_PAYLOAD_BYTES) return { status: "result_too_large" };
          if (!validateExecutionStepResult(update.result, current[0]!.capability_id as CapabilityId)) return { status: "conflict" };
        }
        if (update.status !== "succeeded" && update.result !== undefined) return { status: "conflict" };
      }

      const storage = new Map<string, { readonly inline: boolean; readonly byteLength: number; readonly sha256: string; readonly databaseBytes: number }>();
      for (const update of input.updates) {
        if (!update.result) continue;
        const byteLength = executionResultJsonBytes(update.result);
        if (byteLength === null || byteLength > MAX_DURABLE_RESULT_PAYLOAD_BYTES) return { status: "result_too_large" };
        const measured = await tx`SELECT octet_length(${tx.json(json(update.result))}::jsonb::text) AS size_bytes` as readonly Row[];
        const databaseBytes = Number(measured[0]?.size_bytes);
        const mode = resultStorageMode(databaseBytes);
        if (databaseBytes > MAX_DURABLE_RESULT_JSONB_BYTES || mode === "too_large") {
          return { status: "result_too_large" };
        }
        storage.set(update.stepId, {
          inline: mode === "inline",
          byteLength,
          sha256: executionResultSha256(update.result),
          databaseBytes,
        });
      }

      for (const update of input.updates) {
        const expected = update.status === "skipped" ? "pending" : "running";
        const measured = storage.get(update.stepId);
        let resultEnvelope: unknown = update.result ?? null;
        let resultPayloadId: string | null = null;
        if (update.result && measured && !measured.inline) {
          resultPayloadId = randomUUID();
          const inserted = await tx`INSERT INTO public.execution_step_result_payloads (
              id, run_id, user_id, step_id, result_kind, payload, serialized_size_bytes, payload_sha256
            ) VALUES (
              ${resultPayloadId}::uuid, ${input.runId}::uuid, ${input.userId}::uuid,
              ${update.stepId}, ${update.result.kind}, ${tx.json(json(update.result))},
              ${measured.byteLength}, ${measured.sha256}
            ) RETURNING id` as readonly Row[];
          if (inserted.length !== 1) throw new Error("Execution store could not persist a result payload.");
          resultEnvelope = {
            kind: update.result.kind,
            value: {
              storage: "payload_ref",
              payloadId: resultPayloadId,
              resultKind: update.result.kind,
              byteLength: measured.byteLength,
              sha256: measured.sha256,
            },
          };
        }
        const updated = await tx`UPDATE public.execution_steps SET
          status = ${update.status},
          result_envelope = ${update.result ? tx.json(json(resultEnvelope)) : null}::jsonb,
          result_payload_id = ${resultPayloadId}::uuid,
          failure_code = ${update.failureCode ?? null},
          completed_at = ${update.completedAt}::timestamptz
          WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
            AND step_id = ${update.stepId} AND status = ${expected} RETURNING step_id` as readonly Row[];
        if (updated.length !== 1) throw new Error("Execution checkpoint lost a locked step row.");
      }

      const priorControlState = runs[0]!.control_state as ExecutionControlState;
      const nextControlState: ExecutionControlState = priorControlState === "pause_requested" ? "paused"
        : priorControlState === "stop_requested" ? "stopped" : priorControlState;
      const saved = await tx`UPDATE public.execution_runs SET
        status = ${input.runStatus}, snapshot = ${tx.json(json(input.snapshot))},
        snapshot_revision = snapshot_revision + 1,
        control_state = ${nextControlState},
        control_revision = control_revision + CASE WHEN ${nextControlState} <> ${priorControlState} THEN 1 ELSE 0 END,
        completed_at = COALESCE(${input.completedAt ?? null}::timestamptz, completed_at),
        failure_code = ${input.runStatus === "failed" ? input.failureCode ?? null : null},
        runtime_context = CASE WHEN ${input.retainUserInput === false}
          THEN runtime_context - 'userInput' ELSE runtime_context END
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND snapshot_revision = ${input.expectedRevision}
        RETURNING snapshot_revision, control_revision` as readonly Row[];
      if (saved.length !== 1) throw new Error("Execution checkpoint lost its locked run revision.");
      const snapshotRevision = Number(saved[0]!.snapshot_revision);
      const controlRevision = Number(saved[0]!.control_revision);
      if (nextControlState !== priorControlState) {
        await tx`INSERT INTO public.execution_control_events (
          run_id, user_id, action, prior_state, new_state, prior_control_revision, control_revision,
          snapshot_revision, created_at
        ) VALUES (
          ${input.runId}::uuid, ${input.userId}::uuid, ${nextControlState === "paused" ? "paused" : "stopped"},
          ${priorControlState}, ${nextControlState}, ${controlRevision - 1}, ${controlRevision}, ${snapshotRevision}, clock_timestamp()
        )`;
      }
      return {
        status: "saved", snapshotRevision,
        ...(nextControlState !== "active" ? { controlState: nextControlState, controlRevision } : {}),
      };
    });
  }

  private async exists(runId: string, userId: string): Promise<boolean> {
    const rows = await this.sql`SELECT 1 FROM public.execution_runs WHERE id = ${runId}::uuid AND user_id = ${userId}::uuid`;
    return rows.length > 0;
  }
}
