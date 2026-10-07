import { z } from "zod";
import {
  generatedImageReferenceSchema,
  type GeneratedImageReference,
} from "@/lib/agent-runtime/application-contracts";
import type { CapabilityExecutionInput, CapabilityExecutionResult, CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";
import {
  ImageEditOrchestrationError,
  orchestrateImageEditForExistingMessages,
  type ImageEditExistingMessageOrchestratorInput,
  type ImageEditOrchestrationResult,
  type ImageEditOrchestratorDependencies,
} from "@/lib/image-generation/image-edit-orchestrator";
import { createDefaultImageEditServerDependenciesForExistingMessages } from "@/lib/image-generation/image-edit-server-dependencies";
import { RUNWARE_IMAGE_EDIT_MODEL, RUNWARE_IMAGE_EDIT_PROVIDER, IMAGE_GENERATION_PROMPT_MAX_LENGTH } from "@/lib/image-generation/config";
import { validateImageEditLineage, type ImageEditLineage } from "@/lib/image-generation/lineage";
import {
  assertAdapterInput,
  fail,
  normalizedInputs,
  predecessorInputs,
  requireExecutionKey,
  userObjective,
} from "@/lib/agent-runtime/capability-adapters/common";

const imageEditingResultSchema = z.object({
  kind: z.literal("image_edit"),
  reference: generatedImageReferenceSchema,
  lineage: z.object({
    operation: z.literal("edit"),
    source: z.object({ kind: z.literal("generated_image"), generatedImageId: z.string().uuid() }).strict(),
    derivativeGeneratedImageId: z.string().uuid(),
    instruction: z.string().min(1).max(IMAGE_GENERATION_PROMPT_MAX_LENGTH),
  }).strict(),
  imageEditRequestId: z.string().uuid(),
}).strict();

export type ImageEditingCapabilityResult = z.infer<typeof imageEditingResultSchema>;
export type ExistingMessageImageEditDependenciesFactory = (input: {
  authenticatedUserId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
}) => Promise<ImageEditOrchestratorDependencies>;
export type ExistingMessageImageEditor = (
  input: ImageEditExistingMessageOrchestratorInput,
  dependencies: ImageEditOrchestratorDependencies,
) => Promise<ImageEditOrchestrationResult>;

export type ImageEditingCapabilityAdapterDependencies = Readonly<{
  createDependencies?: ExistingMessageImageEditDependenciesFactory;
  orchestrate?: ExistingMessageImageEditor;
}>;

function referenceFromPredecessor(value: unknown, binding: ReturnType<typeof assertAdapterInput>): GeneratedImageReference {
  const direct = generatedImageReferenceSchema.safeParse(value);
  const edited = imageEditingResultSchema.safeParse(value);
  const reference = direct.success ? direct.data : edited.success ? edited.data.reference : null;
  if (!reference || reference.conversationId !== binding.conversationId
    || reference.userMessageId !== binding.userMessageId || reference.assistantMessageId !== binding.assistantMessageId) {
    return fail("missing_predecessor_result");
  }
  if (edited.success) {
    const lineage = validateImageEditLineage(edited.data.lineage);
    if (!lineage.success || lineage.lineage.derivativeGeneratedImageId !== reference.imageId) {
      return fail("missing_predecessor_result");
    }
  }
  return reference;
}

function safeResult(result: ImageEditOrchestrationResult,
  binding: ReturnType<typeof assertAdapterInput>, source: GeneratedImageReference, instruction: string): ImageEditingCapabilityResult {
  if (result.kind === "in_progress") return fail("indeterminate_step");
  if (result.kind === "conflict") return fail("idempotency_conflict");
  if (result.kind === "completed_result_unavailable") return fail("persistence_failed");
  if (result.conversationId !== binding.conversationId || result.userMessageId !== binding.userMessageId
    || result.assistantMessageId !== binding.assistantMessageId || !result.generatedImageId
    || !z.string().uuid().safeParse(result.imageEditRequestId).success) return fail("persistence_failed");

  const reference = generatedImageReferenceSchema.safeParse({
    kind: "generated_image",
    imageId: result.generatedImageId,
    conversationId: binding.conversationId,
    userMessageId: binding.userMessageId,
    assistantMessageId: binding.assistantMessageId,
    mimeType: "image/png",
    provider: RUNWARE_IMAGE_EDIT_PROVIDER,
    model: RUNWARE_IMAGE_EDIT_MODEL,
  });
  if (!reference.success) return fail("persistence_failed");
  const lineageResult = validateImageEditLineage({
    operation: "edit",
    source: { kind: "generated_image", generatedImageId: source.imageId },
    derivativeGeneratedImageId: reference.data.imageId,
    instruction,
  });
  if (!lineageResult.success) return fail("invalid_executor_result");
  const parsed = imageEditingResultSchema.safeParse({
    kind: "image_edit",
    reference: reference.data,
    lineage: lineageResult.lineage,
    imageEditRequestId: result.imageEditRequestId,
  });
  if (!parsed.success) return fail("invalid_executor_result");
  return parsed.data;
}

export function createImageEditingCapabilityAdapter(
  dependencies: ImageEditingCapabilityAdapterDependencies = {},
): CapabilityExecutor {
  const createDependencies = dependencies.createDependencies ?? createDefaultImageEditServerDependenciesForExistingMessages;
  const orchestrate = dependencies.orchestrate ?? orchestrateImageEditForExistingMessages;
  return Object.freeze({
    async execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult> {
      const binding = assertAdapterInput(input, "image_editing");
      const inputs = normalizedInputs(input);
      const instruction = userObjective(inputs);
      if (instruction.length > IMAGE_GENERATION_PROMPT_MAX_LENGTH) return fail("missing_input");
      // The current plan contract requires an image attachment marker for this
      // capability. It is not used as the edit source: only the typed declared
      // image predecessor below may provide the generated-image identity.
      if (inputs.some((item) => item.source === "attachment" && item.reference.kind !== "image")) {
        return fail("missing_input");
      }
      const predecessors = predecessorInputs(inputs);
      if (predecessors.length !== 1 || predecessors[0]!.result.kind !== "image") return fail("missing_predecessor_result");
      const sourceReference = referenceFromPredecessor(predecessors[0]!.result.value, binding);
      const idempotencyKey = requireExecutionKey(input);
      const request: ImageEditExistingMessageOrchestratorInput = {
        authenticatedUserId: binding.userId,
        conversationId: binding.conversationId,
        userMessageId: binding.userMessageId,
        assistantMessageId: binding.assistantMessageId,
        sourceReference: { kind: "generated_image", generatedImageId: sourceReference.imageId },
        instruction,
        idempotencyKey,
      };
      let imageEditDependencies: ImageEditOrchestratorDependencies;
      try {
        imageEditDependencies = await createDependencies({
          authenticatedUserId: binding.userId,
          conversationId: binding.conversationId,
          userMessageId: binding.userMessageId,
          assistantMessageId: binding.assistantMessageId,
        });
      } catch {
        return fail("persistence_failed");
      }
      let result: ImageEditOrchestrationResult;
      try {
        result = await orchestrate(request, imageEditDependencies);
      } catch (error) {
        if (error instanceof ImageEditOrchestrationError) {
          if (error.code === "invalid_request" || error.code === "invalid_source") return fail("missing_input");
          if (error.code === "idempotency_conflict") return fail("idempotency_conflict");
          if (error.code === "operation_in_progress" || error.code === "completed_replay") return fail("indeterminate_step");
          if (error.code === "source_forbidden" || error.code === "source_not_found") return fail("ownership_denied");
          if (error.code === "persistence_failure" || error.code === "storage_failure" || error.code === "completed_result_unavailable") return fail("persistence_failed");
          return fail("executor_failed");
        }
        return fail("executor_failed");
      }
      return { kind: "image", value: safeResult(result, binding, sourceReference, instruction) };
    },
  });
}

export type SafeImageEditLineage = ImageEditLineage;
