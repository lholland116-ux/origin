import { describe, expect, it } from "vitest";
import type { PlanStep } from "@/lib/ai/intelligence-plan";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { InMemoryExecutionStore } from "@/lib/agent-runtime/in-memory-execution-store";
import type { CreateDurableExecutionRunInput, ExecutionSnapshotEnvelope, PersistedExecutionPlan } from "@/lib/agent-runtime/execution-store";
import { ExecutionSnapshotError, validateExecutionSnapshot } from "@/lib/agent-runtime/execution-snapshot";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const RUN_ID = "b1000000-0000-4000-8000-000000000001";
const KEY = "c1000000-0000-4000-8000-000000000001";

const steps: PlanStep[] = [{ id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }];
const plan: PersistedExecutionPlan = {
  version: 1,
  steps,
  orderedStepIds: ["step-1"],
  plannerSource: "deterministic",
  governance: { maxSteps: 1, capabilityIds: ["standard"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
};

function snapshot(): ExecutionSnapshotEnvelope {
  const run = createExecutionRunLifecycle();
  const step = createExecutionStepLifecycle();
  return { version: 1, runtimeVersion: 1, snapshot: { run: run.getPersistedSnapshot(), steps: { "step-1": step.getPersistedSnapshot() } } };
}

function createInput(overrides: Partial<CreateDurableExecutionRunInput> = {}): CreateDurableExecutionRunInput {
  return {
    id: RUN_ID,
    userId: USER_ID,
    handoffVersion: 1,
    idempotencyKey: "idempotency-1",
    requestFingerprint: "a".repeat(64),
    executionPlan: plan,
    runtimeContext: { userInput: "private user text", attachments: [], resourceReferences: [] },
    snapshot: snapshot(),
    steps: [{ stepId: "step-1", capabilityId: "standard", dependencyIds: [], executionKey: KEY }],
    createdAt: "2026-10-06T12:00:00.000Z",
    ...overrides,
  };
}

function runningSnapshot(): ExecutionSnapshotEnvelope {
  const run = createExecutionRunLifecycle();
  const step = createExecutionStepLifecycle();
  run.start();
  step.start();
  return { version: 1, runtimeVersion: 1, snapshot: { run: run.getPersistedSnapshot(), steps: { "step-1": step.getPersistedSnapshot() } } };
}

describe("durable execution store contract and snapshot envelope", () => {
  it("creates and loads an owned run and its pending step without persisting objective text", async () => {
    const store = new InMemoryExecutionStore();
    const created = await store.createRun(createInput());
    expect(created.status).toBe("created");
    const loaded = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(loaded).toMatchObject({ status: "pending", snapshotRevision: 0, executionPlan: { version: 1 } });
    expect(loaded?.steps).toMatchObject([{ status: "pending", attempt: 1, executionKey: KEY }]);
    expect(JSON.stringify(loaded?.executionPlan)).not.toContain("private user text");
    expect(await store.getRun({ runId: RUN_ID, userId: "a1000000-0000-4000-8000-000000000002" })).toBeNull();
  });

  it("deduplicates the same owner/key and rejects a key rebound to different request content", async () => {
    const store = new InMemoryExecutionStore();
    const [first, repeated] = await Promise.all([store.createRun(createInput()), store.createRun(createInput())]);
    expect([first.status, repeated.status].sort()).toEqual(["created", "existing"]);
    expect(await store.createRun(createInput({ requestFingerprint: "b".repeat(64) }))).toEqual({ status: "idempotency_conflict" });
  });

  it("allows only one concurrent atomic step claim and returns its durable execution key", async () => {
    const store = new InMemoryExecutionStore();
    await store.createRun(createInput());
    const run = createExecutionRunLifecycle();
    run.start();
    const running = await store.saveRunState({ runId: RUN_ID, userId: USER_ID, expectedRevision: 0, status: "running", snapshot: { ...snapshot(), snapshot: { ...snapshot().snapshot, run: run.getPersistedSnapshot() } }, startedAt: "2026-10-06T12:00:01.000Z" });
    expect(running.status).toBe("saved");
    const claims = await Promise.all([1, 2].map(() => store.claimStep({
      runId: RUN_ID,
      userId: USER_ID,
      stepId: "step-1",
      expectedRevision: 1,
      snapshot: runningSnapshot(),
      startedAt: "2026-10-06T12:00:02.000Z",
    })));
    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "conflict")).toHaveLength(1);
    expect(claims.find((claim) => claim.status === "claimed")).toMatchObject({ executionKey: KEY, snapshotRevision: 2 });
  });

  it("rejects stale revisions and commits result plus checkpoint state together", async () => {
    const store = new InMemoryExecutionStore();
    await store.createRun(createInput());
    const runActor = createExecutionRunLifecycle();
    const stepActor = createExecutionStepLifecycle();
    runActor.start();
    const running = await store.saveRunState({ runId: RUN_ID, userId: USER_ID, expectedRevision: 0, status: "running", snapshot: {
      version: 1, runtimeVersion: 1, snapshot: { run: runActor.getPersistedSnapshot(), steps: { "step-1": stepActor.getPersistedSnapshot() } },
    }, startedAt: "2026-10-06T12:00:01.000Z" });
    expect(running).toMatchObject({ status: "saved", snapshotRevision: 1 });
    stepActor.start();
    const claim = await store.claimStep({ runId: RUN_ID, userId: USER_ID, stepId: "step-1", expectedRevision: 1, snapshot: {
      version: 1, runtimeVersion: 1, snapshot: { run: runActor.getPersistedSnapshot(), steps: { "step-1": stepActor.getPersistedSnapshot() } },
    }, startedAt: "2026-10-06T12:00:02.000Z" });
    expect(claim.status).toBe("claimed");
    stepActor.succeed();
    runActor.succeed();
    const checkpoint = {
      version: 1 as const,
      runtimeVersion: 1 as const,
      snapshot: { run: runActor.getPersistedSnapshot(), steps: { "step-1": stepActor.getPersistedSnapshot() } },
    };
    const stale = await store.checkpoint({ runId: RUN_ID, userId: USER_ID, expectedRevision: 1, runStatus: "succeeded", snapshot: checkpoint, updates: [{ stepId: "step-1", status: "succeeded", result: { kind: "text", value: "result" }, completedAt: "2026-10-06T12:00:03.000Z" }], completedAt: "2026-10-06T12:00:03.000Z" });
    expect(stale.status).toBe("conflict");
    const saved = await store.checkpoint({ runId: RUN_ID, userId: USER_ID, expectedRevision: 2, runStatus: "succeeded", snapshot: checkpoint, updates: [{ stepId: "step-1", status: "succeeded", result: { kind: "text", value: "result" }, completedAt: "2026-10-06T12:00:03.000Z" }], completedAt: "2026-10-06T12:00:03.000Z", retainUserInput: false });
    expect(saved).toMatchObject({ status: "saved", snapshotRevision: 3 });
    const loaded = await store.getRun({ runId: RUN_ID, userId: USER_ID });
    expect(loaded).toMatchObject({ status: "succeeded", steps: [{ status: "succeeded", result: { kind: "text", value: "result" } }] });
    expect(loaded?.runtimeContext).not.toHaveProperty("userInput");
  });

  it("validates v1 snapshot states and rejects malformed and unknown versions", () => {
    const initial = snapshot();
    expect(validateExecutionSnapshot(initial, { runStatus: "pending", stepStatuses: { "step-1": "pending" } })).toEqual(initial);
    expect(() => validateExecutionSnapshot({ ...initial, version: 2 })).toThrow(ExecutionSnapshotError);
    expect(() => validateExecutionSnapshot({ ...initial, snapshot: { ...initial.snapshot, run: { ...initial.snapshot.run as object, value: "future_state" } } })).toThrow(ExecutionSnapshotError);
    expect(() => validateExecutionSnapshot({ ...initial, snapshot: { ...initial.snapshot, run: { ...initial.snapshot.run as object, context: { executor: {} } } } })).toThrow(ExecutionSnapshotError);
  });
});
