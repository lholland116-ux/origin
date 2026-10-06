import type postgres from "postgres";
import type {
  ClaimDurableStepResult,
  CreateDurableExecutionRunInput,
  CreateDurableExecutionRunResult,
  DurableExecutionRun,
  DurableExecutionStep,
  ExecutionStore,
  ExecutionStoreWriteResult,
} from "@/lib/agent-runtime/execution-store";

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
  if (!isRecord(value) || typeof value.run_id !== "string" || typeof value.user_id !== "string"
    || typeof value.step_id !== "string" || typeof value.capability_id !== "string"
    || !Array.isArray(value.dependency_ids) || typeof value.execution_key !== "string"
    || typeof value.status !== "string" || value.attempt !== 1) {
    throw new Error("Execution store returned an invalid step record.");
  }
  return {
    runId: value.run_id,
    userId: value.user_id,
    stepId: value.step_id,
    capabilityId: value.capability_id,
    dependencyIds: value.dependency_ids.filter((item): item is string => typeof item === "string"),
    attempt: 1,
    executionKey: value.execution_key,
    status: value.status as DurableExecutionStep["status"],
    ...(isRecord(value.result_envelope) ? { result: value.result_envelope as DurableExecutionStep["result"] } : {}),
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
    || !isRecord(value.snapshot)) {
    throw new Error("Execution store returned an invalid run record.");
  }
  const snapshotRevision = Number(value.snapshot_revision);
  if (!Number.isSafeInteger(snapshotRevision) || snapshotRevision < 0) throw new Error("Execution store returned an invalid snapshot revision.");
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
    ...(typeof value.failure_code === "string" ? { failureCode: value.failure_code } : {}),
    snapshotSchemaVersion: value.snapshot_schema_version,
    snapshotRevision,
    snapshot: value.snapshot as DurableExecutionRun["snapshot"],
    createdAt: iso(value.created_at) ?? "",
    ...(iso(value.started_at) ? { startedAt: iso(value.started_at) } : {}),
    ...(iso(value.completed_at) ? { completedAt: iso(value.completed_at) } : {}),
    steps: steps.map(mapStep),
  };
}

async function loadRun(sql: ExecutionSql, runId: string, userId: string): Promise<DurableExecutionRun | null> {
  const runs = await sql`SELECT * FROM public.execution_runs WHERE id = ${runId}::uuid AND user_id = ${userId}::uuid` as readonly Row[];
  const row = runs[0];
  if (!row) return null;
  const steps = await sql`SELECT * FROM public.execution_steps WHERE run_id = ${runId}::uuid AND user_id = ${userId}::uuid ORDER BY created_at, step_id`;
  return mapRun(row, steps);
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
      const run = await loadRun(tx, input.id, input.userId);
      if (!run) throw new Error("Execution store could not read a newly created run.");
      return { status: "created", run };
    });
  }

  async getRun(input: { readonly runId: string; readonly userId: string }): Promise<DurableExecutionRun | null> {
    return this.sql.begin("isolation level repeatable read", (tx) => loadRun(tx, input.runId, input.userId));
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
        AND ${input.status} = 'running' AND snapshot_revision = ${input.expectedRevision}
      RETURNING snapshot_revision
    ` as readonly Row[];
    if (rows.length === 1) return { status: "saved", snapshotRevision: Number(rows[0]!.snapshot_revision) };
    return await this.exists(input.runId, input.userId) ? { status: "conflict" } : { status: "not_found" };
  }

  async claimStep(input: Parameters<ExecutionStore["claimStep"]>[0]): Promise<ClaimDurableStepResult> {
    return this.sql.begin(async (tx) => {
      const runs = await tx`SELECT snapshot_revision, status FROM public.execution_runs
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (runs.length !== 1) return { status: "not_found" };
      if (Number(runs[0]!.snapshot_revision) !== input.expectedRevision || runs[0]!.status !== "running") return { status: "conflict" };
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

  async checkpoint(input: Parameters<ExecutionStore["checkpoint"]>[0]): Promise<ExecutionStoreWriteResult> {
    return this.sql.begin(async (tx) => {
      const runs = await tx`SELECT snapshot_revision FROM public.execution_runs
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid FOR UPDATE` as readonly Row[];
      if (runs.length !== 1) return { status: "not_found" };
      if (Number(runs[0]!.snapshot_revision) !== input.expectedRevision) return { status: "conflict" };

      for (const update of input.updates) {
        const expected = update.status === "skipped" ? "pending" : "running";
        const current = await tx`SELECT status FROM public.execution_steps
          WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
            AND step_id = ${update.stepId} FOR UPDATE` as readonly Row[];
        if (current.length !== 1 || current[0]!.status !== expected) return { status: "conflict" };
      }

      for (const update of input.updates) {
        const expected = update.status === "skipped" ? "pending" : "running";
        const updated = await tx`UPDATE public.execution_steps SET
          status = ${update.status},
          result_envelope = ${update.result ? tx.json(json(update.result)) : null}::jsonb,
          failure_code = ${update.failureCode ?? null},
          completed_at = ${update.completedAt}::timestamptz
          WHERE run_id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid
            AND step_id = ${update.stepId} AND status = ${expected} RETURNING step_id` as readonly Row[];
        if (updated.length !== 1) throw new Error("Execution checkpoint lost a locked step row.");
      }

      const saved = await tx`UPDATE public.execution_runs SET
        status = ${input.runStatus}, snapshot = ${tx.json(json(input.snapshot))},
        snapshot_revision = snapshot_revision + 1,
        completed_at = COALESCE(${input.completedAt ?? null}::timestamptz, completed_at),
        failure_code = ${input.runStatus === "failed" ? input.failureCode ?? null : null},
        runtime_context = CASE WHEN ${input.retainUserInput === false}
          THEN runtime_context - 'userInput' ELSE runtime_context END
        WHERE id = ${input.runId}::uuid AND user_id = ${input.userId}::uuid AND snapshot_revision = ${input.expectedRevision}
        RETURNING snapshot_revision` as readonly Row[];
      if (saved.length !== 1) throw new Error("Execution checkpoint lost its locked run revision.");
      return { status: "saved", snapshotRevision: Number(saved[0]!.snapshot_revision) };
    });
  }

  private async exists(runId: string, userId: string): Promise<boolean> {
    const rows = await this.sql`SELECT 1 FROM public.execution_runs WHERE id = ${runId}::uuid AND user_id = ${userId}::uuid`;
    return rows.length > 0;
  }
}
