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
    || !["54322", "57222"].includes(parsed.port)
    || parsed.pathname !== "/postgres") {
    throw new Error("Execution persistence integration tests may only use localhost database ports 54322 or 57222 and database postgres.");
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

  function createSnapshot(runActor: ReturnType<typeof createExecutionRunLifecycle>, stepActor: ReturnType<typeof createExecutionStepLifecycle>): ExecutionSnapshotEnvelope {
    return { version: 1, runtimeVersion: 1, snapshot: { run: runActor.getPersistedSnapshot(), steps: { "store-step": stepActor.getPersistedSnapshot() } } };
  }

  function input(): CreateDurableExecutionRunInput {
    const runActor = createExecutionRunLifecycle();
    const stepActor = createExecutionStepLifecycle();
    return {
      id: runId,
      userId,
      handoffVersion: 1,
      idempotencyKey: `store-${runId}`,
      requestFingerprint: "f".repeat(64),
      executionPlan: {
        version: 1,
        steps: [{ id: "store-step", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }],
        orderedStepIds: ["store-step"],
        plannerSource: "deterministic",
        governance: { maxSteps: 1, capabilityIds: ["standard"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
      },
      runtimeContext: { userInput: "local integration fixture", attachments: [], resourceReferences: [] },
      snapshot: createSnapshot(runActor, stepActor),
      steps: [{ stepId: "store-step", capabilityId: "standard", dependencyIds: [], executionKey: stepKey }],
      createdAt: new Date().toISOString(),
    };
  }

  beforeAll(async () => {
    if (!RUN_DATABASE_TESTS) return;
    requireLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
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
    expect((await store.createRun({ ...requested, id: randomUUID() })).status).toBe("existing");
    expect(await store.getRun({ runId, userId: otherUserId })).toBeNull();

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
    expect(loaded?.runtimeContext).not.toHaveProperty("userInput");
  });
});
