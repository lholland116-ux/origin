import { createIntelligenceDecisionCoordinator } from "@/lib/ai/intelligence-decision-coordinator";
import { createStandardCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/standard";
import { createWebSearchCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/web-search";
import { createFileAnalysisCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/file-analysis";
import { createDocumentGenerationCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/document-generation";
import { createImageGenerationCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/image-generation";
import { createImageEditingCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/image-editing";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { executionAuthorizer } from "@/lib/agent-runtime/execution-authorizer";
import { createExecutionRegistry } from "@/lib/agent-runtime/execution-registry";
import { createRegistryCapabilityExecutor } from "@/lib/agent-runtime/registry-capability-executor";
import { requestMessageBindingValidator } from "@/lib/agent-runtime/request-message-binding";
import { agentRequestAcceptanceService } from "@/lib/agent-runtime/request-acceptance";
import { createAcceptedExecutionComposer } from "@/lib/agent-runtime/accepted-execution-composition";
import type { ExecutionStore } from "@/lib/agent-runtime/execution-store";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import type { RuntimeAttachmentReference } from "@/lib/agent-runtime/capability-executor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

if (typeof window !== "undefined") throw new Error("Server execution composition is server-only");

async function resolveAcceptedImages(binding: RequestMessageBinding): Promise<readonly RuntimeAttachmentReference[]> {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.from("message_images").select("id,ordinal")
    .eq("message_id", binding.userMessageId).order("ordinal", { ascending: true });
  if (error || !data) throw new Error("Accepted image lookup unavailable.");
  return data.map((image) => ({ id: image.id, kind: "image" as const }));
}

/**
 * Production-oriented but dormant composition. It binds all six static
 * adapters and the concrete authorizer. The returned interface only prepares
 * and associates a run; bounded authenticated dispatch is a later gate.
 */
export function createServerAcceptedExecutionComposition(store: ExecutionStore) {
  const registry = createExecutionRegistry({
    standardExecutor: createStandardCapabilityAdapter(),
    webSearchExecutor: createWebSearchCapabilityAdapter(),
    fileAnalysisExecutor: createFileAnalysisCapabilityAdapter(),
    documentGenerationExecutor: createDocumentGenerationCapabilityAdapter(),
    imageGenerationExecutor: createImageGenerationCapabilityAdapter(),
    imageEditingExecutor: createImageEditingCapabilityAdapter(),
  });
  const runtime = new DurableXStateExecutionRuntime({
    store,
    executor: createRegistryCapabilityExecutor(registry),
    authorizer: executionAuthorizer,
    requestMessageBindingValidator,
  });
  const coordinator = createIntelligenceDecisionCoordinator({ modelPlanningAllowed: false });
  const composer = createAcceptedExecutionComposer({
    accept: (input) => agentRequestAcceptanceService.accept(input),
    lookup: (identity) => store.lookupAcceptedRequestRun(identity),
    associate: (handoff, runtimeInput, identity) => runtime.associateAcceptedRequest(handoff, runtimeInput, identity),
    resolveImages: resolveAcceptedImages,
    decide: (input) => coordinator.decideIntelligenceAction(input),
  });
  return Object.freeze({
    ...composer,
    control: Object.freeze({
      pause: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.pause(input),
      resume: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.resumeControlOnly(input),
      stop: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.stop(input),
      approveCheckpoint: (input: { runId: string; authenticatedUserId: string; checkpointId: string; expectedControlRevision: number }) => runtime.approveCheckpoint(input),
      returnCheckpoint: (input: { runId: string; authenticatedUserId: string; checkpointId: string; expectedControlRevision: number; rationale: string }) => runtime.returnCheckpoint(input),
    }),
  });
}
