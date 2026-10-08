import {
  generatedImageReferenceSchema,
  type GeneratedImageReference,
} from "@/lib/agent-runtime/application-contracts";
import type { CapabilityExecutionInput, CapabilityExecutionResult, CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";
import {
  generateImageForExistingMessages,
  ImageGenerationServiceError,
  type ExistingMessageImageGenerationServiceInput,
  type ImageGenerationServiceResult,
} from "@/lib/ai/image-generation-service";
import { IMAGE_GENERATION_PROMPT_MAX_LENGTH } from "@/lib/image-generation/config";
import type { ProviderCostLedger } from "@/lib/agent-runtime/provider-cost-ledger";
import {
  assertAdapterInput,
  fail,
  failWithMetadata,
  normalizedInputs,
  predecessorInputs,
  userObjective,
} from "@/lib/agent-runtime/capability-adapters/common";

export type ExistingMessageImageGenerator = (input: ExistingMessageImageGenerationServiceInput) => Promise<ImageGenerationServiceResult>;

export type ImageGenerationCapabilityAdapterDependencies = Readonly<{
  generate?: ExistingMessageImageGenerator;
  providerCostLedger?: ProviderCostLedger;
}>;

export function createImageGenerationCapabilityAdapter(
  dependencies: ImageGenerationCapabilityAdapterDependencies = {},
): CapabilityExecutor {
  const generate = dependencies.generate ?? generateImageForExistingMessages;
  return Object.freeze({
    async execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult> {
      const binding = assertAdapterInput(input, "image_generation");
      const inputs = normalizedInputs(input);
      if (predecessorInputs(inputs).length > 0 || inputs.some((item) => item.source === "attachment")) {
        return fail("missing_input");
      }
      const prompt = userObjective(inputs);
      if (prompt.length > IMAGE_GENERATION_PROMPT_MAX_LENGTH) return fail("missing_input");
      if (!dependencies.generate && (!input.context.providerCost || !dependencies.providerCostLedger)) {
        return failWithMetadata("executor_failed", { phase: "pre_provider", retrySafety: "TERMINAL" });
      }
      let generated: ImageGenerationServiceResult;
      // Quota reservation and provider/storage writes make every ambiguous outcome non-replayable.
      try {
        generated = await generate({
          userId: binding.userId,
          conversationId: binding.conversationId,
          userMessageId: binding.userMessageId,
          assistantMessageId: binding.assistantMessageId,
          request: { prompt },
          ...(input.context.providerCost && dependencies.providerCostLedger
            ? { providerCost: { context: input.context.providerCost, ledger: dependencies.providerCostLedger } }
            : {}),
        });
      } catch (error) {
        if (error instanceof ImageGenerationServiceError) {
          if (error.code === "unauthorized" || error.code === "conversation_not_found") return fail("ownership_denied");
          if (error.code === "invalid_request") return fail("missing_input");
          if (error.code === "daily_limit_reached" || error.code === "monthly_limit_reached") return fail("quota_exhausted");
          if (error.code === "provider_cost_denied") return fail("quota_exhausted");
          if (error.code === "configuration") return failWithMetadata("executor_failed", { phase: "pre_provider", retrySafety: "TERMINAL" });
          if (error.code === "storage_failure") return failWithMetadata("persistence_failed", { phase: "persistence", retrySafety: "RECOVERY_REQUIRED" });
          if (error.code === "persistence_failure") return failWithMetadata("persistence_failed", { phase: "post_persistence", retrySafety: "RECOVERY_REQUIRED" });
          return failWithMetadata("executor_failed", { phase: "provider_in_flight", retrySafety: "RECOVERY_REQUIRED" });
        }
        return failWithMetadata("executor_failed", { phase: "unknown", retrySafety: "RECOVERY_REQUIRED" });
      }
      const reference = generatedImageReferenceSchema.safeParse(generated.reference);
      if (!reference.success || !matchesBinding(reference.data, binding)) {
        return failWithMetadata("invalid_executor_result", { phase: "post_persistence", retrySafety: "RECOVERY_REQUIRED" });
      }
      // responseBytes are transient delivery data; only the service's safe reference is durable.
      return { kind: "image", value: reference.data };
    },
  });
}

function matchesBinding(reference: GeneratedImageReference, binding: ReturnType<typeof assertAdapterInput>): boolean {
  return reference.conversationId === binding.conversationId
    && reference.userMessageId === binding.userMessageId
    && reference.assistantMessageId === binding.assistantMessageId;
}
