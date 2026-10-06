import { createActor, createMachine } from "xstate";
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

type LifecycleMachine = typeof runLifecycleMachine | typeof stepLifecycleMachine;

function createLifecycleActor<Status extends string>(machine: LifecycleMachine) {
  const actor = createActor(machine).start();
  return Object.freeze({
    get status(): Status {
      return actor.getSnapshot().value as Status;
    },
    start() {
      actor.send({ type: "START" });
    },
    succeed() {
      actor.send({ type: "SUCCEED" });
    },
    fail() {
      actor.send({ type: "FAIL" });
    },
    skip() {
      actor.send({ type: "SKIP" });
    },
    getPersistedSnapshot(): unknown {
      return actor.getPersistedSnapshot();
    },
    stop() {
      actor.stop();
    },
  });
}

/** XState lifecycle actors keep runtime inputs and collaborators outside actor context. */
export function createExecutionRunLifecycle() {
  return createLifecycleActor<ExecutionRunStatus>(runLifecycleMachine);
}

/** A pending step may be skipped when a dependency failed; all other terminal transitions require running. */
export function createExecutionStepLifecycle() {
  return createLifecycleActor<ExecutionStepStatus>(stepLifecycleMachine);
}
