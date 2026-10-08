import {
  generatedDocumentReferenceSchema,
  generatedImageReferenceSchema,
  standardOperationResultSchema,
  webSearchOperationResultSchema,
} from "@/lib/agent-runtime/application-contracts";
import { CAPABILITY_REGISTRY } from "@/lib/ai/capability-registry";
import { validateExecutionStepResult } from "@/lib/agent-runtime/xstate-runtime-adapter";
import type { DurableExecutionRun } from "@/lib/agent-runtime/execution-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FINAL_MESSAGE_LENGTH = 200_000;

export type AcceptedExecutionFinalizationResult = Readonly<{
  status: "finalized" | "replayed" | "not_found" | "not_ready" | "conflict" | "unavailable";
  assistantMessageId?: string;
}>;

export type AcceptedExecutionFinalizerDependencies = Readonly<{
  /** Resolves the owner from the durable acceptance association; no owner ID is supplied by the caller. */
  loadAcceptedRun: (runId: string) => Promise<DurableExecutionRun | null>;
  finalizeAtomically: (input: { runId: string; finalText: string }) => Promise<unknown>;
  listPendingRunIds: (limit: number) => Promise<readonly string[]>;
}>;

function finalTextFor(run: DurableExecutionRun): string | null {
  const binding = run.runtimeContext.requestMessageBinding;
  if (!binding || run.executionPlan.orderedStepIds.length < 1) return null;
  const orderedSteps = run.executionPlan.orderedStepIds.map((stepId) => run.steps.find((step) => step.stepId === stepId));
  if (orderedSteps.some((step) => !step || step.status !== "succeeded" || !step.result)) return null;
  const last = orderedSteps[orderedSteps.length - 1]!;
  const value = last.result!.value;

  if (last.capabilityId === "standard" && last.result!.kind === "text") {
    const parsed = standardOperationResultSchema.safeParse(value);
    if (!parsed.success || parsed.data.requestId !== binding.requestId
      || parsed.data.userId !== binding.userId || parsed.data.conversationId !== binding.conversationId
      || !parsed.data.reply.trim()) return null;
    return parsed.data.reply;
  }

  if (last.capabilityId === "web_search" && last.result!.kind === "search_results") {
    const parsed = webSearchOperationResultSchema.safeParse(value);
    if (!parsed.success || parsed.data.requestId !== binding.requestId
      || parsed.data.userId !== binding.userId || parsed.data.conversationId !== binding.conversationId
      || parsed.data.outcome !== "success" || !parsed.data.reply.trim()) return null;
    // Keep the persisted provider reply verbatim. V1 stores source title/URL
    // pairs but not stable citation IDs, so no citation markers are invented.
    return parsed.data.reply;
  }

  if (last.capabilityId === "document_generation" && last.result!.kind === "document") {
    const parsed = generatedDocumentReferenceSchema.safeParse(value);
    if (!parsed.success || parsed.data.messageId !== binding.assistantMessageId
      || parsed.data.conversationId !== binding.conversationId) return null;
    return "Your requested document is ready.";
  }

  if ((last.capabilityId === "image_generation" || last.capabilityId === "image_editing")
    && last.result!.kind === "image") {
    const parsed = generatedImageReferenceSchema.safeParse(value);
    if (!parsed.success || parsed.data.assistantMessageId !== binding.assistantMessageId
      || parsed.data.userMessageId !== binding.userMessageId
      || parsed.data.conversationId !== binding.conversationId) return null;
    return "Your requested image is ready.";
  }

  // Structured/file-analysis data and intermediate planner output are not
  // user-facing prose. The existing artifact rows remain attached to this
  // same message; do not serialize internal result envelopes into chat text.
  return "Your request has completed successfully.";
}

function isReady(run: DurableExecutionRun): boolean {
  const binding = run.runtimeContext.requestMessageBinding;
  const plannedStepIds = run.executionPlan.orderedStepIds;
  return run.status === "succeeded"
    && run.controlState === "active"
    && Boolean(run.acceptedRequestId && binding?.requestId === run.acceptedRequestId
      && run.acceptanceFingerprint && /^[0-9a-f]{64}$/.test(run.acceptanceFingerprint))
    && Boolean(binding && binding.userId === run.userId
      && binding.conversationId === run.runtimeContext.conversationId)
    && new Set(plannedStepIds).size === plannedStepIds.length
    && run.steps.length === plannedStepIds.length
    && plannedStepIds.every((stepId) => run.steps.some((step) => step.stepId === stepId))
    && run.steps.every((step) => {
      const definition = run.executionPlan.steps.find((candidate) => candidate.id === step.stepId);
      return step.status === "succeeded" && Boolean(step.result) && CAPABILITY_REGISTRY.has(step.capabilityId)
        && definition?.capability === step.capabilityId
        && JSON.stringify(definition.dependsOn) === JSON.stringify(step.dependencyIds)
        && validateExecutionStepResult(step.result, step.capabilityId);
    })
    && run.approvalCheckpoints.every((checkpoint) => checkpoint.status === "approved");
}

function parsedRpcResult(value: unknown, runId: string, assistantMessageId: string): "finalized" | "replayed" | "conflict" {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return "conflict";
  const result = row as Record<string, unknown>;
  if (result.runId !== runId || result.assistantMessageId !== assistantMessageId
    || !/^[0-9a-f]{64}$/.test(String(result.completionSha256))
    || typeof result.finalizedAt !== "string") return "conflict";
  return result.status === "finalized" || result.status === "replayed" ? result.status : "conflict";
}

export function createAcceptedExecutionFinalizer(dependencies: AcceptedExecutionFinalizerDependencies) {
  return Object.freeze({
    async finalize(runId: string): Promise<AcceptedExecutionFinalizationResult> {
      if (!UUID_PATTERN.test(runId)) return { status: "not_found" };
      const normalizedRunId = runId.toLowerCase();
      let run: DurableExecutionRun | null;
      try {
        run = await dependencies.loadAcceptedRun(normalizedRunId);
      } catch {
        return { status: "unavailable" };
      }
      if (!run) return { status: "not_found" };
      if (!isReady(run) || !run.runtimeContext.requestMessageBinding) return { status: "not_ready" };

      const finalText = finalTextFor(run);
      if (!finalText || !finalText.trim() || finalText.length > MAX_FINAL_MESSAGE_LENGTH
        || finalText.startsWith("[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:")) return { status: "not_ready" };

      try {
        const status = parsedRpcResult(
          await dependencies.finalizeAtomically({ runId: normalizedRunId, finalText }),
          normalizedRunId,
          run.runtimeContext.requestMessageBinding.assistantMessageId,
        );
        return status === "conflict"
          ? { status }
          : { status, assistantMessageId: run.runtimeContext.requestMessageBinding.assistantMessageId };
      } catch {
        return { status: "unavailable" };
      }
    },

    async listPendingRunIds(limit = 100): Promise<readonly string[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return [];
      try {
        const ids = await dependencies.listPendingRunIds(limit);
        return Object.freeze(ids.filter((id) => UUID_PATTERN.test(id)).slice(0, limit));
      } catch {
        return [];
      }
    },
  });
}
