import {
  generatedDocumentReferenceSchema,
  standardOperationResultSchema,
} from "@/lib/agent-runtime/application-contracts";
import type { CapabilityExecutionInput, CapabilityExecutionResult, CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";
import { GeneratedDocumentPersistenceError, persistGeneratedDocumentForExistingMessage } from "@/lib/ai/generated-document-persistence-service";
import { generateTemplateOutput } from "@/lib/documents/generation/generate";
import { DocumentGenerationValidationError } from "@/lib/documents/generation/validation";
import type { GeneratedArtifact } from "@/lib/documents/generation/contracts";
import type { TemplateOutputFormat } from "@/lib/documents/generation/templates/types";
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

const supportedFormatMap: Readonly<Record<string, TemplateOutputFormat>> = Object.freeze({
  txt: "txt",
  md: "md",
  markdown: "md",
  docx: "docx",
  pdf: "pdf",
});

function requestedFormat(objective: string): TemplateOutputFormat {
  const unsupportedFormats = /\b(?:xlsx|spreadsheet|pptx|presentation|slides?|zip|archive)\b/gi;
  const outputAction = /\b(?:create|generate|export|save|deliver|produce|make|provide|want|need|request)\b/gi;
  for (const match of objective.matchAll(unsupportedFormats)) {
    const prefix = objective.slice(0, match.index);
    const clauseStart = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf("!"), prefix.lastIndexOf("?"), prefix.lastIndexOf(";")) + 1;
    const clause = prefix.slice(clauseStart);
    const actions = [...clause.matchAll(outputAction)];
    const action = actions.at(-1);
    if (!action) continue;
    const betweenActionAndFormat = clause.slice(action.index! + action[0].length);
    if (!/\b(?:from|using|based\s+on|about|for|of|with|analy[sz]e|review|summari[sz]e)\b/i.test(betweenActionAndFormat)) {
      return failDocumentGeneration("missing_input", "format_rejection");
    }
  }
  const matches = [...objective.matchAll(/\b(txt|md|markdown|docx|pdf)\b/gi)]
    .map((match) => supportedFormatMap[match[1]!.toLowerCase()]!);
  if (/\bword\s+(?:document|file|format)\b/i.test(objective)) matches.push("docx");
  if (/\b(?:plain\s+)?text\s+(?:file|document|format)\b/i.test(objective)) matches.push("txt");
  const unique = [...new Set(matches)];
  if (unique.length > 1) return failDocumentGeneration("missing_input", "format_rejection");
  return unique[0] ?? "pdf";
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
      const format = requestedFormat(objective);
      const deadlineAtMs = input.context.executionDeadlineAtMs;
      if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
        return failWithMetadata("transient_dependency_failure", { phase: "pre_execution", retrySafety: "SAFE_RETRY" });
      }
      let artifact: GeneratedArtifact;
      try {
        artifact = await render({
          templateId: "simple-document",
          formats: [format],
          variables: { title: requestedTitle(objective), body: standard.data.reply },
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
          templateId: "simple-document",
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
