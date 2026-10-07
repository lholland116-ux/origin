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
import {
  assertAdapterInput,
  fail,
  normalizedInputs,
  predecessorInputs,
  userObjective,
} from "@/lib/agent-runtime/capability-adapters/common";

export type ExistingMessageImageGenerator = (input: ExistingMessageImageGenerationServiceInput) => Promise<ImageGenerationServiceResult>;

export type ImageGenerationCapabilityAdapterDependencies = Readonly<{
  generate?: ExistingMessageImageGenerator;
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
      let generated: ImageGenerationServiceResult;
      try {
        generated = await generate({
          userId: binding.userId,
          conversationId: binding.conversationId,
          userMessageId: binding.userMessageId,
          assistantMessageId: binding.assistantMessageId,
          request: { prompt },
        });
      } catch (error) {
        if (error instanceof ImageGenerationServiceError) {
          if (error.code === "unauthorized" || error.code === "conversation_not_found") return fail("ownership_denied");
          if (error.code === "invalid_request") return fail("missing_input");
          if (error.code === "storage_failure" || error.code === "persistence_failure") return fail("persistence_failed");
          return fail("executor_failed");
        }
        return fail("executor_failed");
      }
      const reference = generatedImageReferenceSchema.safeParse(generated.reference);
      if (!reference.success || !matchesBinding(reference.data, binding)) return fail("invalid_executor_result");
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
