import { createIntelligenceDecisionCoordinator } from "@/lib/ai/intelligence-decision-coordinator";
import { createStandardCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/standard";
import { createWebSearchCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/web-search";
import { createFileAnalysisCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/file-analysis";
import { createDocumentGenerationCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/document-generation";
import { createImageGenerationCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/image-generation";
import { createImageEditingCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/image-editing";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { createTrustedBackgroundExecutionAuthorizer, executionAuthorizer } from "@/lib/agent-runtime/execution-authorizer";
import { createExecutionRegistry } from "@/lib/agent-runtime/execution-registry";
import { createRegistryCapabilityExecutor } from "@/lib/agent-runtime/registry-capability-executor";
import { requestMessageBindingValidator } from "@/lib/agent-runtime/request-message-binding";
import { agentRequestAcceptanceService } from "@/lib/agent-runtime/request-acceptance";
import { createAcceptedExecutionComposer } from "@/lib/agent-runtime/accepted-execution-composition";
import { createAcceptedExecutionFinalizer } from "@/lib/agent-runtime/accepted-execution-finalization";
import type { ExecutionStore } from "@/lib/agent-runtime/execution-store";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import type { RuntimeAttachmentReference } from "@/lib/agent-runtime/capability-executor";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProviderCostLedger } from "@/lib/agent-runtime/provider-cost-ledger";
import { resolveTrustedExecutionSubject } from "@/lib/agent-runtime/trusted-execution-subject";
import { createTrustedExecutionWorker } from "@/lib/agent-runtime/trusted-execution-worker";

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
  const providerCostLedger = createProviderCostLedger();
  const registry = createExecutionRegistry({
    standardExecutor: createStandardCapabilityAdapter({ providerCostLedger }),
    webSearchExecutor: createWebSearchCapabilityAdapter(),
    fileAnalysisExecutor: createFileAnalysisCapabilityAdapter(),
    documentGenerationExecutor: createDocumentGenerationCapabilityAdapter(),
    imageGenerationExecutor: createImageGenerationCapabilityAdapter({ providerCostLedger }),
    imageEditingExecutor: createImageEditingCapabilityAdapter(),
  });
  const runtime = new DurableXStateExecutionRuntime({
    store,
    executor: createRegistryCapabilityExecutor(registry),
    authorizer: executionAuthorizer,
    requestMessageBindingValidator,
    resolveTrustedExecutionSubject,
    createTrustedBackgroundAuthorizer: createTrustedBackgroundExecutionAuthorizer,
  });
  const coordinator = createIntelligenceDecisionCoordinator({ modelPlanningAllowed: false });
  const composer = createAcceptedExecutionComposer({
    accept: (input) => agentRequestAcceptanceService.accept(input),
    lookup: (identity) => store.lookupAcceptedRequestRun(identity),
    associate: (handoff, runtimeInput, identity) => runtime.associateAcceptedRequest(handoff, runtimeInput, identity),
    resolveImages: resolveAcceptedImages,
    decide: (input) => coordinator.decideIntelligenceAction(input),
  });
  const finalizer = createAcceptedExecutionFinalizer({
    loadAcceptedRun: (runId) => store.getAcceptedRunForFinalization({ runId }),
    finalizeAtomically: async ({ runId, finalText }) => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("finalize_accepted_agent_execution", {
        p_run_id: runId,
        p_final_text: finalText,
      });
      if (error) throw new Error("Durable execution finalization was unavailable.");
      return data;
    },
    listPendingRunIds: async (limit) => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("list_pending_agent_execution_finalizations", {
        p_limit: limit,
      });
      if (error || !Array.isArray(data)) throw new Error("Durable finalization discovery was unavailable.");
      return data.flatMap((row) => row && typeof row === "object" && "run_id" in row
        && typeof row.run_id === "string" ? [row.run_id] : []);
    },
  });
  const worker = createTrustedExecutionWorker({
    store,
    runtime,
    finalizeAcceptedExecution: finalizer.finalize,
    listPendingFinalizationRunIds: finalizer.listPendingRunIds,
  });
  return Object.freeze({
    ...composer,
    // Internal server/worker-compatible persistence operation only. No HTTP
    // handler invokes it; a separately qualified trigger must remain dormant.
    finalizeAcceptedExecution: finalizer.finalize,
    listPendingExecutionFinalizations: finalizer.listPendingRunIds,
    // Internal-only bounded invocation; deliberately not wired to HTTP or a scheduler.
    runTrustedExecutionWorkerOnce: worker.runOnce,
    control: Object.freeze({
      pause: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.pause(input),
      resume: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.resumeControlOnly(input),
      stop: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.stop(input),
      approveCheckpoint: (input: { runId: string; authenticatedUserId: string; checkpointId: string; expectedControlRevision: number }) => runtime.approveCheckpoint(input),
      returnCheckpoint: (input: { runId: string; authenticatedUserId: string; checkpointId: string; expectedControlRevision: number; rationale: string }) => runtime.returnCheckpoint(input),
    }),
  });
}
