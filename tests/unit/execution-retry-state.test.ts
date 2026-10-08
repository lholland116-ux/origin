import { describe, expect, it } from "vitest";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { InMemoryExecutionStore } from "@/lib/agent-runtime/in-memory-execution-store";
import type { CreateDurableExecutionRunInput, ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";
import { executionStepSchema, MAX_EXECUTION_STEP_ATTEMPTS } from "@/lib/agent-runtime/runtime-contracts";

const USER_ID = "a9000000-0000-4000-8000-000000000001";
const RUN_ID = "b9000000-0000-4000-8000-000000000001";
const EXECUTION_KEY = "c9000000-0000-4000-8000-000000000001";
const REQUEST_BINDING = {
  requestId: "d9000000-0000-4000-8000-000000000001",
  userId: USER_ID,
  conversationId: "a9000000-0000-4000-8000-000000000002",
  userMessageId: "d9000000-0000-4000-8000-000000000002",
  assistantMessageId: "d9000000-0000-4000-8000-000000000003",
};
const RETRY_AT = "2026-10-07T14:00:00.000Z";

function envelope(
  run: ReturnType<typeof createExecutionRunLifecycle>,
  step: ReturnType<typeof createExecutionStepLifecycle>,
): ExecutionSnapshotEnvelope {
  return {
    version: 1,
    runtimeVersion: 1,
    snapshot: { run: run.getPersistedSnapshot(), steps: { "step-1": step.getPersistedSnapshot() } },
  };
}

function input(): CreateDurableExecutionRunInput {
  const run = createExecutionRunLifecycle();
  const step = createExecutionStepLifecycle();
  return {
    id: RUN_ID,
    userId: USER_ID,
    handoffVersion: 1,
    idempotencyKey: "retry-state-unit-test",
    requestFingerprint: "a".repeat(64),
    executionPlan: {
      version: 1,
      steps: [{ id: "step-1", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" }],
      orderedStepIds: ["step-1"],
      plannerSource: "deterministic",
      governance: { maxSteps: 1, capabilityIds: ["standard"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
    },
    runtimeContext: {
      conversationId: REQUEST_BINDING.conversationId,
      requestMessageBinding: REQUEST_BINDING,
      userInput: "same immutable request",
      attachments: [],
      resourceReferences: [],
    },
    snapshot: envelope(run, step),
    steps: [{ stepId: "step-1", capabilityId: "standard", dependencyIds: [], executionKey: EXECUTION_KEY }],
    createdAt: "2026-10-07T13:00:00.000Z",
  };
}

async function claimInitialStep(store: InMemoryExecutionStore) {
  const run = createExecutionRunLifecycle();
  const step = createExecutionStepLifecycle();
  await store.createRun(input());
  run.start();
  await store.saveRunState({
    runId: RUN_ID,
    userId: USER_ID,
    expectedRevision: 0,
    status: "running",
    snapshot: envelope(run, step),
    startedAt: "2026-10-07T13:00:01.000Z",
  });
  step.start();
  const claimed = await store.claimStep({
    runId: RUN_ID,
    userId: USER_ID,
    stepId: "step-1",
    expectedRevision: 1,
    snapshot: envelope(run, step),
    startedAt: "2026-10-07T13:00:02.000Z",
  });
  expect(claimed).toMatchObject({ status: "claimed", snapshotRevision: 2, executionKey: EXECUTION_KEY });
  return { run, step };
}

describe("durable retry state foundation", () => {
  it("strictly validates retry_pending and the hard attempt ceiling", () => {
    const retryStep = {
      id: "step-1",
      capability: "standard",
      status: "retry_pending",
      dependsOn: [],
      startedAt: "2026-10-07T13:00:02.000Z",
      attempt: 1,
      nextRetryAt: RETRY_AT,
    };
    expect(executionStepSchema.safeParse(retryStep).success).toBe(true);
    expect(executionStepSchema.safeParse({ ...retryStep, nextRetryAt: undefined }).success).toBe(false);
    expect(executionStepSchema.safeParse({ ...retryStep, status: "running" }).success).toBe(false);
    expect(executionStepSchema.safeParse({ ...retryStep, attempt: 0 }).success).toBe(false);
    expect(executionStepSchema.safeParse({ ...retryStep, attempt: MAX_EXECUTION_STEP_ATTEMPTS + 1 }).success).toBe(false);
    expect(executionStepSchema.safeParse({ ...retryStep, resultRef: "stale-result" }).success).toBe(false);
  });

  it("persists retry scheduling, denies early claims without revision changes, then increments once at eligibility", async () => {
    let now = new Date("2026-10-07T13:59:59.000Z");
    const store = new InMemoryExecutionStore(() => new Date(now));
    const { run, step } = await claimInitialStep(store);
    step.scheduleRetry();
    const scheduled = await store.scheduleStepRetry({
      runId: RUN_ID,
      userId: USER_ID,
      stepId: "step-1",
      expectedRevision: 2,
      snapshot: envelope(run, step),
      nextRetryAt: RETRY_AT,
    });
    expect(scheduled).toEqual({ status: "saved", snapshotRevision: 3 });
    expect(await store.scheduleStepRetry({
      runId: RUN_ID,
      userId: USER_ID,
      stepId: "step-1",
      expectedRevision: 2,
      snapshot: envelope(run, step),
      nextRetryAt: RETRY_AT,
    })).toEqual({ status: "conflict" });

    step.claimRetry();
    const retrySnapshot = envelope(run, step);
    expect(await store.claimRetryableStep({
      runId: RUN_ID,
      userId: USER_ID,
      stepId: "step-1",
      expectedRevision: 3,
      snapshot: retrySnapshot,
    })).toEqual({ status: "not_eligible", nextRetryAt: RETRY_AT });
    expect(await store.getRun({ runId: RUN_ID, userId: USER_ID })).toMatchObject({
      status: "running",
      snapshotRevision: 3,
      steps: [{ status: "retry_pending", attempt: 1, nextRetryAt: RETRY_AT }],
      runtimeContext: { requestMessageBinding: REQUEST_BINDING },
    });

    now = new Date(RETRY_AT);
    const retryClaim = await store.claimRetryableStep({
      runId: RUN_ID,
      userId: USER_ID,
      stepId: "step-1",
      expectedRevision: 3,
      snapshot: retrySnapshot,
    });
    expect(retryClaim).toEqual({ status: "claimed", executionKey: EXECUTION_KEY, attempt: 2, snapshotRevision: 4 });
    expect(await store.getRun({ runId: RUN_ID, userId: USER_ID })).toMatchObject({
      steps: [{ status: "running", attempt: 2, executionKey: EXECUTION_KEY, startedAt: RETRY_AT }],
      runtimeContext: { requestMessageBinding: REQUEST_BINDING },
    });
  });

  it("atomically admits only one concurrent retry claimant and enforces attempt three", async () => {
    const now = new Date("2026-10-07T14:00:00.000Z");
    const store = new InMemoryExecutionStore(() => new Date(now));
    const { run, step } = await claimInitialStep(store);
    step.scheduleRetry();
    await store.scheduleStepRetry({ runId: RUN_ID, userId: USER_ID, stepId: "step-1", expectedRevision: 2, snapshot: envelope(run, step), nextRetryAt: now.toISOString() });
    step.claimRetry();
    const retrySnapshot = envelope(run, step);
    const claims = await Promise.all([1, 2].map(() => store.claimRetryableStep({
      runId: RUN_ID, userId: USER_ID, stepId: "step-1", expectedRevision: 3, snapshot: retrySnapshot,
    })));
    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "conflict")).toHaveLength(1);
    expect(await store.getRun({ runId: RUN_ID, userId: USER_ID })).toMatchObject({ snapshotRevision: 4, steps: [{ status: "running", attempt: 2 }] });

    step.scheduleRetry();
    const secondSchedule = await store.scheduleStepRetry({ runId: RUN_ID, userId: USER_ID, stepId: "step-1", expectedRevision: 4, snapshot: envelope(run, step), nextRetryAt: now.toISOString() });
    expect(secondSchedule).toEqual({ status: "saved", snapshotRevision: 5 });
    step.claimRetry();
    const thirdAttemptSnapshot = envelope(run, step);
    expect(await store.claimRetryableStep({ runId: RUN_ID, userId: USER_ID, stepId: "step-1", expectedRevision: 5, snapshot: thirdAttemptSnapshot }))
      .toEqual({ status: "claimed", executionKey: EXECUTION_KEY, attempt: 3, snapshotRevision: 6 });

    step.scheduleRetry();
    expect(await store.scheduleStepRetry({ runId: RUN_ID, userId: USER_ID, stepId: "step-1", expectedRevision: 6, snapshot: envelope(run, step), nextRetryAt: now.toISOString() }))
      .toEqual({ status: "attempt_limit" });
    expect(await store.getRun({ runId: RUN_ID, userId: USER_ID })).toMatchObject({ snapshotRevision: 6, steps: [{ status: "running", attempt: MAX_EXECUTION_STEP_ATTEMPTS }] });
  });
});
