import {
  generatedDocumentReferenceSchema,
  standardOperationResultSchema,
} from "@/lib/agent-runtime/application-contracts";
import { selectDocumentOutputFormat } from "@/lib/agent-runtime/document-output-format";
import type { CapabilityExecutionInput, CapabilityExecutionResult, CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";
import { GeneratedDocumentPersistenceError, persistGeneratedDocumentForExistingMessage } from "@/lib/ai/generated-document-persistence-service";
import { generateTemplateOutput } from "@/lib/documents/generation/generate";
import { parseWorkbookExtractionReply } from "@/lib/documents/generation/workbook-extraction-contract";
import { DocumentGenerationValidationError } from "@/lib/documents/generation/validation";
import type { GeneratedArtifact } from "@/lib/documents/generation/contracts";
import type { TemplateVariablesRecord } from "@/lib/documents/generation/templates/types";
import {
  assertAdapterInput,
  CapabilityAdapterError,
  failDocumentGeneration,
  failWithMetadata,
  normalizedInputs,
  predecessorInputs,
  requireExecutionKey,
  requireResultKind,
} from "@/lib/agent-runtime/capability-adapters/common";

export type DocumentRenderer = typeof generateTemplateOutput;
export type ExistingMessageDocumentPersister = typeof persistGeneratedDocumentForExistingMessage;

export type DocumentGenerationCapabilityAdapterDependencies = Readonly<{
  render?: DocumentRenderer;
  persist?: ExistingMessageDocumentPersister;
}>;

function documentOptions(inputs: ReturnType<typeof normalizedInputs>): string {
  const userInputs = inputs.filter((item) => item.source === "user");
  if (userInputs.length > 1) return failDocumentGeneration("missing_input", "input_shape");
  if (inputs.some((item) => item.source === "attachment")) return failDocumentGeneration("missing_input", "input_shape");
  const objective = userInputs[0]?.value.trim() ?? "";
  if (userInputs.length === 1 && !objective) return failDocumentGeneration("missing_input", "input_shape");
  return objective;
}

function requestedTitle(objective: string): string {
  const match = objective.match(/\btitle(?:d)?\s*(?::|as)?\s*["“']([^"”'\n]{1,160})["”']/i);
  return match?.[1]?.trim() || "Generated document";
}

export function createDocumentGenerationCapabilityAdapter(
  dependencies: DocumentGenerationCapabilityAdapterDependencies = {},
): CapabilityExecutor {
  const render = dependencies.render ?? generateTemplateOutput;
  const persist = dependencies.persist ?? persistGeneratedDocumentForExistingMessage;
  return Object.freeze({
    async execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult> {
      const binding = assertAdapterInput(input, "document_generation");
      let inputs: ReturnType<typeof normalizedInputs>;
      try {
        inputs = normalizedInputs(input);
      } catch (error) {
        if (error instanceof CapabilityAdapterError && error.code === "missing_input") {
          return failDocumentGeneration("missing_input", "input_shape");
        }
        throw error;
      }
      // A later document step may run after the runtime has safely discarded user
      // text. In that case the validated Standard predecessor is sufficient and
      // the narrow V1 defaults apply (simple-document, PDF, generic title).
      const objective = documentOptions(inputs);
      const predecessors = predecessorInputs(inputs);
      if (predecessors.length !== 1) return failDocumentGeneration("missing_predecessor_result", "predecessor_validation");
      let standardValue: unknown;
      try {
        standardValue = requireResultKind(predecessors[0]!.result, "text");
      } catch (error) {
        if (error instanceof CapabilityAdapterError && error.code === "missing_predecessor_result") {
          return failDocumentGeneration("missing_predecessor_result", "predecessor_validation");
        }
        throw error;
      }
      const standard = standardOperationResultSchema.safeParse(standardValue);
      if (!standard.success || standard.data.requestId !== binding.requestId || standard.data.userId !== binding.userId
        || standard.data.conversationId !== binding.conversationId) {
        return failDocumentGeneration("missing_predecessor_result", "predecessor_validation");
      }

      let generationRequestId: string;
      try {
        generationRequestId = requireExecutionKey(input);
      } catch (error) {
        if (error instanceof CapabilityAdapterError && error.code === "missing_input") {
          return failDocumentGeneration("missing_input", "missing_execution_key");
        }
        throw error;
      }
      const formatSelection = selectDocumentOutputFormat(objective);
      if (formatSelection.kind !== "selected") {
        return failDocumentGeneration("missing_input", "format_rejection");
      }
      const format = formatSelection.format;
      const templateId = format === "xlsx" ? "tabular-workbook" : "simple-document";
      let variables: TemplateVariablesRecord;
      if (format === "xlsx") {
        let workbook;
        try {
          workbook = parseWorkbookExtractionReply(standard.data.reply);
        } catch {
          return failDocumentGeneration("missing_input", "document_render_validation");
        }
        variables = {
          title: requestedTitle(objective),
          sheetName: workbook.sheetName,
          columns: workbook.columns,
          rows: workbook.rows,
        };
      } else {
        variables = { title: requestedTitle(objective), body: standard.data.reply };
      }
      const deadlineAtMs = input.context.executionDeadlineAtMs;
      if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
        return failWithMetadata("transient_dependency_failure", { phase: "pre_execution", retrySafety: "SAFE_RETRY" });
      }
      let artifact: GeneratedArtifact;
      try {
        artifact = await render({
          templateId,
          formats: [format],
          variables,
          packageAsZip: false,
        });
      } catch (error) {
        if (error instanceof DocumentGenerationValidationError) {
          return failDocumentGeneration("missing_input", "document_render_validation");
        }
        return failWithMetadata("executor_failed", { phase: "pre_execution", retrySafety: "TERMINAL" });
      }
      if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
        // Rendering is local and side-effect-free until persistence begins.
        return failWithMetadata("transient_dependency_failure", { phase: "pre_execution", retrySafety: "SAFE_RETRY" });
      }

      let persisted: Awaited<ReturnType<ExistingMessageDocumentPersister>>;
      // Persistence acknowledgement can be lost after the object/row write. The stable
      // generation key is not sufficient proof that replay cannot duplicate or orphan data.
      try {
        persisted = await persist({
          userId: binding.userId,
          conversationId: binding.conversationId,
          generationRequestId,
          templateId,
          generatedOutput: artifact,
          assistantMessageId: binding.assistantMessageId,
          ...(input.context.trustedExecutionSubject
            ? { trustedExecutionSubject: input.context.trustedExecutionSubject }
            : {}),
        });
      } catch (error) {
        if (error instanceof GeneratedDocumentPersistenceError) {
          if (error.code === "invalid_output") {
            return failWithMetadata("invalid_executor_result", { phase: "pre_persistence", retrySafety: "TERMINAL" });
          }
          return failWithMetadata("persistence_failed", { phase: "persistence", retrySafety: "RECOVERY_REQUIRED" });
        }
        return failWithMetadata("persistence_failed", { phase: "persistence", retrySafety: "RECOVERY_REQUIRED" });
      }
      const reference = generatedDocumentReferenceSchema.safeParse(persisted.reference);
      if (!reference.success || reference.data.conversationId !== binding.conversationId
        || reference.data.messageId !== binding.assistantMessageId) {
        return failWithMetadata("persistence_failed", { phase: "post_persistence", retrySafety: "RECOVERY_REQUIRED" });
      }
      // Keep delivery bytes transient. Only the existing durable reference crosses this boundary.
      return { kind: "document", value: reference.data };
    },
  });
}
