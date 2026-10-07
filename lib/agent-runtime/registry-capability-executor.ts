import type {
  CapabilityExecutionInput,
  CapabilityExecutionResult,
  CapabilityExecutor,
} from "@/lib/agent-runtime/capability-executor";
import { CapabilityAdapterError } from "@/lib/agent-runtime/capability-adapters/common";
import type { ExecutionRegistry } from "@/lib/agent-runtime/execution-registry";

/** Routes one already-authorized runtime step to exactly one statically registered executor. */
export function createRegistryCapabilityExecutor(registry: ExecutionRegistry): CapabilityExecutor {
  return Object.freeze({
    async execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult> {
      const executor = registry.get(input?.capabilityId);
      if (!executor) throw new CapabilityAdapterError("unsupported_capability");
      return executor.execute(input);
    },
  });
}
