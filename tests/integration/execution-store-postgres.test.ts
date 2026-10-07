import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";
import type { CreateDurableExecutionRunInput, ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";

const RUN_DATABASE_TESTS = process.env.EXECUTION_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.EXECUTION_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function requireLocalDatabase(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("EXECUTION_TEST_DATABASE_URL must be a local PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || !["54322", "57222", "57242"].includes(parsed.port)
    || parsed.pathname !== "/postgres") {
    throw new Error("Execution persistence integration tests may only use localhost database ports 54322, 57222, or 57242 and database postgres.");
  }
}

const describeDatabase = RUN_DATABASE_TESTS ? describe : describe.skip;

describeDatabase("Supabase execution store (local PostgreSQL only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const runId = randomUUID();
  const stepKey = randomUUID();
  const retryRunId = randomUUID();
  const retryStepKey = randomUUID();
  const claimRunId = randomUUID();
  const claimStepKey = randomUUID();

  function createSnapshot(runActor: ReturnType<typeof createExecutionRunLifecycle>, stepActor: ReturnType<typeof createExecutionStepLifecycle>): ExecutionSnapshotEnvelope {
    return { version: 1, runtimeVersion: 1, snapshot: { run: runActor.getPersistedSnapshot(), steps: { "store-step": stepActor.getPersistedSnapshot() } } };
  }

  function input(ids: { readonly runId?: string; readonly stepKey?: string } = {}): CreateDurableExecutionRunInput {
    const runActor = createExecutionRunLifecycle();
    const stepActor = createExecutionStepLifecycle();
    const conversationId = randomUUID();
    const selectedRunId = ids.runId ?? runId;
    return {
      id: selectedRunId,
      userId,
      handoffVersion: 1,
      idempotencyKey: "store-" + selectedRunId,
      requestFingerprint: "f".repeat(64),
      executionPlan: {
        version: 1,
        steps: [{ id: "store-step", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }],
        orderedStepIds: ["store-step"],
        plannerSource: "deterministic",
        governance: { maxSteps: 1, capabilityIds: ["standard"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
      },
      runtimeContext: {
        conversationId,
        requestMessageBinding: {
          requestId: randomUUID(),
          userId,
          conversationId,
          userMessageId: randomUUID(),
          assistantMessageId: randomUUID(),
        },
        userInput: "local integration fixture",
        attachments: [],
        resourceReferences: [],
      },
      snapshot: createSnapshot(runActor, stepActor),
      steps: [{ stepId: "store-step", capabilityId: "standard", dependencyIds: [], executionKey: ids.stepKey ?? stepKey }],
      createdAt: new Date().toISOString(),
    };
  }

  beforeAll(async () => {
    if (!RUN_DATABASE_TESTS) return;
    requireLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 5 });
    await sql`SELECT 1`;
    await sql`INSERT INTO auth.users (id, aud, role, email) VALUES
      (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@execution.test`}),
      (${otherUserId}::uuid, 'authenticated', 'authenticated', ${`${otherUserId}@execution.test`})`;
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => {
    if (!RUN_DATABASE_TESTS || !sql) return;
    await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid OR id = ${otherUserId}::uuid`;
    await sql.end();
  });

  it("enforces owner-scoped idempotent creation and a single concurrent atomic claim", async () => {
    const requested = input();
    expect((await store.createRun(requested)).status).toBe("created");
    const idempotentReplay = await store.createRun({ ...requested, id: randomUUID() });
    expect(idempotentReplay.status).toBe("existing");
    if (idempotentReplay.status === "existing") {
      expect(idempotentReplay.run.runtimeContext.requestMessageBinding).toEqual(requested.runtimeContext.requestMessageBinding);
    }
    expect(await store.getRun({ runId, userId: otherUserId })).toBeNull();
    await expect(sql`
      UPDATE public.execution_runs
      SET runtime_context = jsonb_set(
        runtime_context,
        '{requestMessageBinding,assistantMessageId}',
        to_jsonb(${randomUUID()}::text)
      )
      WHERE id = ${runId}::uuid AND user_id = ${userId}::uuid
    `).rejects.toThrow("Execution plan identity is immutable");

    const runActor = createExecutionRunLifecycle();
    const stepActor = createExecutionStepLifecycle();
    runActor.start();
    const started = await store.saveRunState({ runId, userId, expectedRevision: 0, status: "running", snapshot: createSnapshot(runActor, stepActor), startedAt: new Date().toISOString() });
    expect(started.status).toBe("saved");
    stepActor.start();
    const runningSnapshot = createSnapshot(runActor, stepActor);
    const [first, second] = await Promise.all([1, 2].map(() => store.claimStep({
      runId, userId, stepId: "store-step", expectedRevision: 1, snapshot: runningSnapshot, startedAt: new Date().toISOString(),
    })));
    expect([first, second].filter((result) => result.status === "claimed")).toHaveLength(1);
    expect([first, second].filter((result) => result.status === "conflict")).toHaveLength(1);
    expect([first, second].find((result) => result.status === "claimed")).toMatchObject({ executionKey: stepKey, snapshotRevision: 2 });

    stepActor.succeed();
    runActor.succeed();
    const snapshot = createSnapshot(runActor, stepActor);
    const checkpoint = await store.checkpoint({
      runId, userId, expectedRevision: 2, runStatus: "succeeded", snapshot,
      updates: [{ stepId: "store-step", status: "succeeded", result: { kind: "text", value: "mock result" }, completedAt: new Date().toISOString() }],
      completedAt: new Date().toISOString(), retainUserInput: false,
    });
    expect(checkpoint.status).toBe("saved");
    const loaded = await store.getRun({ runId, userId });
    expect(loaded).toMatchObject({ status: "succeeded", snapshotRevision: 3, steps: [{ status: "succeeded", result: { kind: "text", value: "mock result" } }] });
    expect(loaded?.runtimeContext.requestMessageBinding).toEqual(requested.runtimeContext.requestMessageBinding);
    expect(loaded?.runtimeContext).not.toHaveProperty("userInput");
  });

  it("persists retry eligibility across store recreation and denies early claims without revision changes", async () => {
    const requested = input({ runId: retryRunId, stepKey: retryStepKey });
    expect((await store.createRun(requested)).status).toBe("created");
    const runActor = createExecutionRunLifecycle();
    const stepActor = createExecutionStepLifecycle();
    runActor.start();
    expect((await store.saveRunState({
      runId: retryRunId,
      userId,
      expectedRevision: 0,
      status: "running",
      snapshot: createSnapshot(runActor, stepActor),
      startedAt: new Date().toISOString(),
    })).status).toBe("saved");
    stepActor.start();
    expect((await store.claimStep({
      runId: retryRunId,
      userId,
      stepId: "store-step",
      expectedRevision: 1,
      snapshot: createSnapshot(runActor, stepActor),
      startedAt: new Date().toISOString(),
    })).status).toBe("claimed");

    stepActor.scheduleRetry();
    const nextRetryAt = "2099-01-01T00:00:00.000Z";
    expect(await store.scheduleStepRetry({
      runId: retryRunId,
      userId,
      stepId: "store-step",
      expectedRevision: 2,
      snapshot: createSnapshot(runActor, stepActor),
      nextRetryAt,
    })).toEqual({ status: "saved", snapshotRevision: 3 });
    expect(await store.scheduleStepRetry({
      runId: retryRunId,
      userId,
      stepId: "store-step",
      expectedRevision: 2,
      snapshot: createSnapshot(runActor, stepActor),
      nextRetryAt,
    })).toEqual({ status: "conflict" });

    const restartedStore = new SupabaseExecutionStore(sql);
    const loaded = await restartedStore.getRun({ runId: retryRunId, userId });
    expect(loaded).toMatchObject({
      status: "running",
      snapshotRevision: 3,
      steps: [{ status: "retry_pending", attempt: 1, nextRetryAt, executionKey: retryStepKey }],
      runtimeContext: { requestMessageBinding: requested.runtimeContext.requestMessageBinding },
    });

    stepActor.claimRetry();
    expect(await restartedStore.claimRetryableStep({
      runId: retryRunId,
      userId,
      stepId: "store-step",
      expectedRevision: 3,
      snapshot: createSnapshot(runActor, stepActor),
    })).toEqual({ status: "not_eligible", nextRetryAt });
    expect(await restartedStore.getRun({ runId: retryRunId, userId })).toMatchObject({
      snapshotRevision: 3,
      steps: [{ status: "retry_pending", attempt: 1, nextRetryAt }],
    });
  });

  it("atomically claims eligible retries once and enforces the hard attempt bound", async () => {
    expect((await store.createRun(input({ runId: claimRunId, stepKey: claimStepKey }))).status).toBe("created");
    const runActor = createExecutionRunLifecycle();
    const stepActor = createExecutionStepLifecycle();
    runActor.start();
    expect((await store.saveRunState({
      runId: claimRunId,
      userId,
      expectedRevision: 0,
      status: "running",
      snapshot: createSnapshot(runActor, stepActor),
      startedAt: new Date().toISOString(),
    })).status).toBe("saved");
    stepActor.start();
    expect((await store.claimStep({
      runId: claimRunId,
      userId,
      stepId: "store-step",
      expectedRevision: 1,
      snapshot: createSnapshot(runActor, stepActor),
      startedAt: new Date().toISOString(),
    })).status).toBe("claimed");

    stepActor.scheduleRetry();
    const eligibleAt = "2000-01-01T00:00:00.000Z";
    expect(await store.scheduleStepRetry({
      runId: claimRunId,
      userId,
      stepId: "store-step",
      expectedRevision: 2,
      snapshot: createSnapshot(runActor, stepActor),
      nextRetryAt: eligibleAt,
    })).toEqual({ status: "saved", snapshotRevision: 3 });
    stepActor.claimRetry();
    const retrySnapshot = createSnapshot(runActor, stepActor);
    const [first, second] = await Promise.all([
      store.claimRetryableStep({ runId: claimRunId, userId, stepId: "store-step", expectedRevision: 3, snapshot: retrySnapshot }),
      new SupabaseExecutionStore(sql).claimRetryableStep({ runId: claimRunId, userId, stepId: "store-step", expectedRevision: 3, snapshot: retrySnapshot }),
    ]);
    expect([first, second].filter((result) => result.status === "claimed")).toHaveLength(1);
    expect([first, second].filter((result) => result.status === "conflict")).toHaveLength(1);
    expect([first, second].find((result) => result.status === "claimed")).toMatchObject({
      status: "claimed",
      executionKey: claimStepKey,
      attempt: 2,
      snapshotRevision: 4,
    });
    expect(await store.getRun({ runId: claimRunId, userId })).toMatchObject({
      snapshotRevision: 4,
      steps: [{ status: "running", attempt: 2, executionKey: claimStepKey }],
    });

    stepActor.scheduleRetry();
    expect(await store.scheduleStepRetry({
      runId: claimRunId, userId, stepId: "store-step", expectedRevision: 4,
      snapshot: createSnapshot(runActor, stepActor), nextRetryAt: eligibleAt,
    })).toEqual({ status: "saved", snapshotRevision: 5 });
    stepActor.claimRetry();
    expect(await store.claimRetryableStep({
      runId: claimRunId, userId, stepId: "store-step", expectedRevision: 5,
      snapshot: createSnapshot(runActor, stepActor),
    })).toMatchObject({ status: "claimed", attempt: 3, snapshotRevision: 6 });
    stepActor.scheduleRetry();
    expect(await store.scheduleStepRetry({
      runId: claimRunId, userId, stepId: "store-step", expectedRevision: 6,
      snapshot: createSnapshot(runActor, stepActor), nextRetryAt: eligibleAt,
    })).toEqual({ status: "saved", snapshotRevision: 7 });
    stepActor.claimRetry();
    expect(await store.claimRetryableStep({
      runId: claimRunId, userId, stepId: "store-step", expectedRevision: 7,
      snapshot: createSnapshot(runActor, stepActor),
    })).toEqual({ status: "attempt_limit" });
    expect(await store.getRun({ runId: claimRunId, userId })).toMatchObject({
      snapshotRevision: 7,
      steps: [{ status: "retry_pending", attempt: 3, nextRetryAt: eligibleAt }],
    });
  });
});
