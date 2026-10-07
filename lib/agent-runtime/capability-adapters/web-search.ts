import {
  webSearchOperationResultSchema,
  type WebSearchOperationResult,
} from "@/lib/agent-runtime/application-contracts";
import type { CapabilityExecutionInput, CapabilityExecutionResult, CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";
import { runWebSearchOperation, type WebSearchOperationExecution, type WebSearchOperationInput } from "@/lib/ai/web-search-operation-service";
import {
  assertAdapterInput,
  fail,
  normalizedInputs,
  predecessorInputs,
  requestContextFromBinding,
  userObjective,
} from "@/lib/agent-runtime/capability-adapters/common";

export type WebSearchOperationRunner = (input: WebSearchOperationInput) => Promise<WebSearchOperationExecution>;

export type WebSearchCapabilityAdapterDependencies = Readonly<{
  runOperation?: WebSearchOperationRunner;
}>;

export function createWebSearchCapabilityAdapter(
  dependencies: WebSearchCapabilityAdapterDependencies = {},
): CapabilityExecutor {
  const runOperation = dependencies.runOperation ?? runWebSearchOperation;
  return Object.freeze({
    async execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult> {
      const binding = assertAdapterInput(input, "web_search");
      const inputs = normalizedInputs(input);
      if (predecessorInputs(inputs).length > 0 || inputs.some((item) => item.source === "attachment")) {
        return fail("missing_predecessor_result");
      }
      const objective = userObjective(inputs);
      let execution: WebSearchOperationExecution;
      try {
        execution = await runOperation({
          requestContext: requestContextFromBinding(binding),
          objective,
          reasoningEffort: "medium",
          history: [{ role: "user", content: objective }],
          mode: "force",
        });
      } catch {
        return fail("executor_failed");
      }
      if (!execution.ok) {
        if (execution.error.code === "invalid_request_context") return fail("ownership_denied");
        if (execution.error.code === "invalid_predecessor_context") return fail("missing_predecessor_result");
        if (execution.error.code === "invalid_provider_result") return fail("invalid_executor_result");
        return fail("executor_failed");
      }
      const parsed = webSearchOperationResultSchema.safeParse(execution.result);
      if (!parsed.success || !matchesBinding(parsed.data, binding)) return fail("invalid_executor_result");
      return { kind: "search_results", value: parsed.data };
    },
  });
}

function matchesBinding(result: WebSearchOperationResult, binding: ReturnType<typeof assertAdapterInput>): boolean {
  return result.requestId === binding.requestId && result.userId === binding.userId
    && result.conversationId === binding.conversationId;
}
