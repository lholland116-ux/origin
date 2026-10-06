import { randomUUID } from "node:crypto";
import type { CapabilityExecutor, ExecutionAuthorizer, ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import { XStateExecutionAdapter } from "@/lib/agent-runtime/xstate-runtime-adapter";
import type { ExecutionOutcome } from "@/lib/agent-runtime/runtime-contracts";

if (typeof window !== "undefined") {
  throw new Error("LVTChat execution runtime is server-only");
}

export type LvtChatExecutionRuntimeOptions = {
  readonly executor: CapabilityExecutor;
  readonly authorizer: ExecutionAuthorizer;
  readonly createExecutionId?: () => string;
  readonly now?: () => Date;
};

/** LVTChat-owned façade. XState types never appear in this public contract. */
export function createLvtChatExecutionRuntime(options: LvtChatExecutionRuntimeOptions) {
  const adapter = new XStateExecutionAdapter({
    createExecutionId: options.createExecutionId ?? randomUUID,
    now: options.now ?? (() => new Date()),
  });

  return Object.freeze({
    execute(handoff: unknown, input: ExecutionRuntimeInput): Promise<ExecutionOutcome> {
      return adapter.execute(handoff, input, options.executor, options.authorizer);
    },
  });
}
