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
  fail,
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
  if (userInputs.length > 1) return fail("missing_input");
  if (inputs.some((item) => item.source === "attachment")) return fail("missing_input");
  const objective = userInputs[0]?.value.trim() ?? "";
  if (userInputs.length === 1 && !objective) return fail("missing_input");
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
  if (/\b(?:xlsx|spreadsheet|pptx|presentation|slides?|zip|archive)\b/i.test(objective)) return fail("missing_input");
  const matches = [...objective.matchAll(/\b(txt|md|markdown|docx|pdf)\b/gi)]
    .map((match) => supportedFormatMap[match[1]!.toLowerCase()]!);
  if (/\bword\s+(?:document|file|format)\b/i.test(objective)) matches.push("docx");
  if (/\b(?:plain\s+)?text\s+(?:file|document|format)\b/i.test(objective)) matches.push("txt");
  const unique = [...new Set(matches)];
  if (unique.length > 1) return fail("missing_input");
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
      const inputs = normalizedInputs(input);
      // A later document step may run after the runtime has safely discarded user
      // text. In that case the validated Standard predecessor is sufficient and
      // the narrow V1 defaults apply (simple-document, PDF, generic title).
      const objective = documentOptions(inputs);
      const predecessors = predecessorInputs(inputs);
      if (predecessors.length !== 1) return fail("missing_predecessor_result");
      const standardValue = requireResultKind(predecessors[0]!.result, "text");
      const standard = standardOperationResultSchema.safeParse(standardValue);
      if (!standard.success || standard.data.requestId !== binding.requestId || standard.data.userId !== binding.userId
        || standard.data.conversationId !== binding.conversationId) return fail("missing_predecessor_result");

      const generationRequestId = requireExecutionKey(input);
      const format = requestedFormat(objective);
      let artifact: GeneratedArtifact;
      try {
        artifact = await render({
          templateId: "simple-document",
          formats: [format],
          variables: { title: requestedTitle(objective), body: standard.data.reply },
          packageAsZip: false,
        });
      } catch (error) {
        if (error instanceof DocumentGenerationValidationError) return fail("missing_input");
        return failWithMetadata("executor_failed", { phase: "pre_execution", retrySafety: "TERMINAL" });
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
