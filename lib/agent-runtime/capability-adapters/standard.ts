import {
  fileContextMatchesExecutionContext,
  standardOperationResultSchema,
  webSearchOperationResultSchema,
  type FileContextResult,
  type StandardOperationResult,
  type WebSearchOperationResult,
} from "@/lib/agent-runtime/application-contracts";
import type { CapabilityExecutionInput, CapabilityExecutionResult, CapabilityExecutor, ResolvedExecutionInput } from "@/lib/agent-runtime/capability-executor";
import { runStandardOperation, StandardOperationError, type StandardOperationEvent, type StandardOperationInput } from "@/lib/ai/standard-operation-service";
import {
  assertAdapterInput,
  CapabilityAdapterError,
  fail,
  normalizedInputs,
  predecessorInputs,
  requestContextFromBinding,
  userObjective,
} from "@/lib/agent-runtime/capability-adapters/common";

export type StandardOperationRunner = (input: StandardOperationInput) => AsyncIterable<StandardOperationEvent>;

export type StandardCapabilityAdapterDependencies = Readonly<{
  runOperation?: StandardOperationRunner;
}>;

function matchingPredecessors(inputs: readonly ResolvedExecutionInput[], binding: ReturnType<typeof assertAdapterInput>) {
  let fileContext: FileContextResult | undefined;
  let webSearchResult: WebSearchOperationResult | undefined;
  for (const predecessor of predecessorInputs(inputs)) {
    if (predecessor.result.kind === "structured_data") {
      if (fileContext) return fail("missing_predecessor_result");
      const candidate = fileContextMatchesExecutionContext(predecessor.result.value, {
        authenticatedUserId: binding.userId,
        conversationId: binding.conversationId,
      }) ? predecessor.result.value : null;
      if (!candidate) return fail("missing_predecessor_result");
      fileContext = candidate;
      continue;
    }
    if (predecessor.result.kind === "search_results") {
      if (webSearchResult) return fail("missing_predecessor_result");
      const parsed = webSearchOperationResultSchema.safeParse(predecessor.result.value);
      if (!parsed.success || parsed.data.requestId !== binding.requestId || parsed.data.userId !== binding.userId
        || parsed.data.conversationId !== binding.conversationId) return fail("missing_predecessor_result");
      webSearchResult = parsed.data;
      continue;
    }
    return fail("missing_predecessor_result");
  }
  return { fileContext, webSearchResult };
}

export function createStandardCapabilityAdapter(
  dependencies: StandardCapabilityAdapterDependencies = {},
): CapabilityExecutor {
  const runOperation = dependencies.runOperation ?? runStandardOperation;
  return Object.freeze({
    async execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult> {
      const binding = assertAdapterInput(input, "standard");
      const inputs = normalizedInputs(input);
      if (inputs.some((item) => item.source === "attachment")) {
        // Runtime attachment identifiers are not image URLs or file contents. File context
        // is prepared by file_analysis; Standard does not resolve storage on its own.
        return fail("missing_input");
      }
      const objective = userObjective(inputs);
      const { fileContext, webSearchResult } = matchingPredecessors(inputs, binding);
      const operationInput: StandardOperationInput = {
        requestContext: requestContextFromBinding(binding),
        objective,
        reasoningEffort: "medium",
        history: [{ role: "user", content: objective }],
        ...(fileContext ? { fileContext } : {}),
        ...(webSearchResult ? { webSearchResult } : {}),
      };

      let completion: StandardOperationResult | undefined;
      let deltas = "";
      try {
        const events = runOperation(operationInput);
        for await (const event of events) {
          if (event.type === "text_delta") {
            if (typeof event.text !== "string") return fail("invalid_executor_result");
            deltas += event.text;
          } else if (event.type === "completion") {
            if (completion) return fail("invalid_executor_result");
            const parsed = standardOperationResultSchema.safeParse(event.result);
            if (!parsed.success || parsed.data.requestId !== binding.requestId || parsed.data.userId !== binding.userId
              || parsed.data.conversationId !== binding.conversationId) return fail("invalid_executor_result");
            completion = parsed.data;
          } else if (event.type !== "attempt_started" && event.type !== "measurement") {
            return fail("invalid_executor_result");
          }
        }
      } catch (error) {
        if (error instanceof CapabilityAdapterError) throw error;
        if (error instanceof StandardOperationError) {
          if (error.code === "invalid_request_context") return fail("ownership_denied");
          if (error.code === "invalid_predecessor_context") return fail("missing_predecessor_result");
          return fail("executor_failed");
        }
        return fail("executor_failed");
      }
      if (!completion) return fail("invalid_executor_result");
      // The core completion is authoritative (notably after its own image fallback).
      // For this text-only adapter, the collected stream must represent that reply.
      if (deltas.trim() !== completion.reply.trim()) return fail("invalid_executor_result");
      return { kind: "text", value: completion };
    },
  });
}
