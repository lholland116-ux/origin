import {
  fileContextMatchesExecutionContext,
  type FileContextResult,
} from "@/lib/agent-runtime/application-contracts";
import type { CapabilityExecutionInput, CapabilityExecutionResult, CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";
import {
  FileContextPreparationError,
  prepareFileContext,
  type FileContextServiceInput,
} from "@/lib/ai/file-context-service";
import {
  assertAdapterInput,
  attachmentInputs,
  fail,
  failWithMetadata,
  normalizedInputs,
  predecessorInputs,
} from "@/lib/agent-runtime/capability-adapters/common";

export type FileContextPreparer = (input: FileContextServiceInput) => Promise<FileContextResult>;

export type FileAnalysisCapabilityAdapterDependencies = Readonly<{
  prepareFileContext?: FileContextPreparer;
}>;

export function createFileAnalysisCapabilityAdapter(
  dependencies: FileAnalysisCapabilityAdapterDependencies = {},
): CapabilityExecutor {
  // Kept injectable at the qualified service boundary; no adapter-level document lookup.
  const prepare = dependencies.prepareFileContext ?? prepareFileContext;
  return Object.freeze({
    async execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult> {
      const binding = assertAdapterInput(input, "file_analysis");
      const inputs = normalizedInputs(input);
      if (predecessorInputs(inputs).length > 0) return fail("missing_predecessor_result");
      if (inputs.filter((item) => item.source === "user").length > 1) return fail("missing_input");
      const attachments = attachmentInputs(inputs);
      if (attachments.length < 1 || attachments.some((item) => item.reference.kind !== "file")) return fail("missing_input");
      const documentIds = attachments.map((item) => item.reference.id);
      let result: FileContextResult;
      try {
        result = await prepare({ userId: binding.userId, conversationId: binding.conversationId, documentIds });
      } catch (error) {
        if (error instanceof FileContextPreparationError) {
          if (error.code === "invalid_reference") return fail("missing_input");
          if (error.code === "document_unavailable") return fail("ownership_denied");
          if (error.code === "context_too_large") return fail("result_too_large");
          if (error.code === "temporary_lookup_failure") {
            return failWithMetadata("transient_dependency_failure", { phase: "read_only_lookup", retrySafety: "SAFE_RETRY" });
          }
          return failWithMetadata("persistence_failed", { phase: "read_only_lookup", retrySafety: "RECOVERY_REQUIRED" });
        }
        return failWithMetadata("executor_failed", { phase: "read_only_lookup", retrySafety: "RECOVERY_REQUIRED" });
      }
      if (!fileContextMatchesExecutionContext(result, {
        authenticatedUserId: binding.userId,
        conversationId: binding.conversationId,
      })) return fail("invalid_executor_result");
      return { kind: "structured_data", value: result };
    },
  });
}
