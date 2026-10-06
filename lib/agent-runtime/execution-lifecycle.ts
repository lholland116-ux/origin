import { createActor, createMachine, type SnapshotFrom } from "xstate";
import type { ExecutionRunStatus, ExecutionStepStatus } from "@/lib/agent-runtime/runtime-contracts";

const runLifecycleMachine = createMachine({
  id: "lvtchat-execution-run",
  initial: "pending",
  states: {
    pending: { on: { START: "running" } },
    running: { on: { SUCCEED: "succeeded", FAIL: "failed" } },
    succeeded: { type: "final" },
    failed: { type: "final" },
  },
});

const stepLifecycleMachine = createMachine({
  id: "lvtchat-execution-step",
  initial: "pending",
  states: {
    pending: { on: { START: "running", SKIP: "skipped" } },
    running: { on: { SUCCEED: "succeeded", FAIL: "failed" } },
    succeeded: { type: "final" },
    failed: { type: "final" },
    skipped: { type: "final" },
  },
});

function lifecycleView<Status extends string>(
  getStatus: () => Status,
  send: (type: "START" | "SUCCEED" | "FAIL" | "SKIP") => void,
  getPersistedSnapshot: () => unknown,
  stop: () => void,
) {
  return Object.freeze({
    get status(): Status {
      return getStatus();
    },
    start() {
      send("START");
    },
    succeed() {
      send("SUCCEED");
    },
    fail() {
      send("FAIL");
    },
    skip() {
      send("SKIP");
    },
    getPersistedSnapshot(): unknown {
      return getPersistedSnapshot();
    },
    stop() {
      stop();
    },
  });
}

/** XState lifecycle actors keep runtime inputs and collaborators outside actor context. */
export function createExecutionRunLifecycle(persistedSnapshot?: unknown) {
  const actor = persistedSnapshot === undefined
    ? createActor(runLifecycleMachine).start()
    : createActor(runLifecycleMachine, { snapshot: persistedSnapshot as SnapshotFrom<typeof runLifecycleMachine> }).start();
  return lifecycleView<ExecutionRunStatus>(
    () => actor.getSnapshot().value as ExecutionRunStatus,
    (type) => actor.send({ type: type as "START" | "SUCCEED" | "FAIL" }),
    () => actor.getPersistedSnapshot(),
    () => actor.stop(),
  );
}

/** A pending step may be skipped when a dependency failed; all other terminal transitions require running. */
export function createExecutionStepLifecycle(persistedSnapshot?: unknown) {
  const actor = persistedSnapshot === undefined
    ? createActor(stepLifecycleMachine).start()
    : createActor(stepLifecycleMachine, { snapshot: persistedSnapshot as SnapshotFrom<typeof stepLifecycleMachine> }).start();
  return lifecycleView<ExecutionStepStatus>(
    () => actor.getSnapshot().value as ExecutionStepStatus,
    (type) => actor.send({ type }),
    () => actor.getPersistedSnapshot(),
    () => actor.stop(),
  );
}
