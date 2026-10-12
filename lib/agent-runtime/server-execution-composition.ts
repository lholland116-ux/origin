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
import { createDocumentGenerationArtifactReconciler } from "@/lib/agent-runtime/document-generation-reconciliation";

if (typeof window !== "undefined") throw new Error("Server execution composition is server-only");

async function resolveAcceptedImages(binding: RequestMessageBinding): Promise<readonly RuntimeAttachmentReference[]> {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.from("message_images").select("id,ordinal")
    .eq("message_id", binding.userMessageId).order("ordinal", { ascending: true });
  if (error || !data) throw new Error("Accepted image lookup unavailable.");
  return data.map((image) => ({ id: image.id, kind: "image" as const }));
}

/**
 * Server-only composition for accepted runs. Bounded execution is reachable
 * only through the default-disabled, authenticated internal wake boundary.
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
  const reconcileDocumentGenerationArtifact = createDocumentGenerationArtifactReconciler({
    enabled: process.env.AGENT_EXECUTION_RECOVERY_ENABLED === "true",
    expectedAuthorizationSecret: process.env.AGENT_EXECUTION_RECOVERY_AUTHORIZATION,
    loadAcceptedRun: (runId) => store.getAcceptedRunForFinalization({ runId }),
    reconcile: async (input) => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("reconcile_trusted_document_generation_artifact", {
        p_run_id: input.runId,
        p_step_id: input.stepId,
        p_execution_key: input.executionKey,
        p_expected_snapshot_revision: input.expectedSnapshotRevision,
        p_snapshot: input.snapshot,
        p_result_envelope: input.result,
        p_artifact_sha256: input.artifactSha256,
      });
      if (error) throw new Error("Document generation reconciliation was unavailable.");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.status !== "string") {
        throw new Error("Document generation reconciliation returned invalid data.");
      }
      const status = row.status;
      if (!["reconciled", "already_reconciled", "not_found", "not_eligible", "conflict", "stale_claim"].includes(status)) {
        throw new Error("Document generation reconciliation returned an unknown status.");
      }
      return {
        status: status as "reconciled" | "already_reconciled" | "not_found" | "not_eligible" | "conflict" | "stale_claim",
        source: "rpc" as const,
        ...(Number.isSafeInteger(row.snapshot_revision) ? { snapshotRevision: Number(row.snapshot_revision) } : {}),
      };
    },
  });
  return Object.freeze({
    ...composer,
    // Internal server/worker-compatible persistence operation only.
    finalizeAcceptedExecution: finalizer.finalize,
    listPendingExecutionFinalizations: finalizer.listPendingRunIds,
    // Internal-only bounded invocation; only the HMAC-protected wake boundary calls it.
    runTrustedExecutionWorkerOnce: worker.runOnce,
    // Explicitly owner-authorized, server-only recovery; no client route accepts
    // artifact identifiers and the feature is disabled unless both gates pass.
    reconcileDocumentGenerationArtifact,
    control: Object.freeze({
      pause: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.pause(input),
      resume: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.resumeControlOnly(input),
      stop: (input: { runId: string; authenticatedUserId: string; expectedControlRevision: number }) => runtime.stop(input),
      approveCheckpoint: (input: { runId: string; authenticatedUserId: string; checkpointId: string; expectedControlRevision: number }) => runtime.approveCheckpoint(input),
      returnCheckpoint: (input: { runId: string; authenticatedUserId: string; checkpointId: string; expectedControlRevision: number; rationale: string }) => runtime.returnCheckpoint(input),
    }),
  });
}
