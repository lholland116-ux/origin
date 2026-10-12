import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  handleDocumentGenerationRecovery,
  readDocumentGenerationRecoveryConfig,
  type DocumentGenerationRecoveryDependencies,
} from "@/lib/agent-runtime/document-generation-recovery-trigger";
import {
  finalizeAcceptedExecution,
  reconcileDocumentGenerationArtifact,
} from "@/lib/agent-runtime/server-workflow-http";

export function createServerDocumentGenerationRecoveryDependencies(): DocumentGenerationRecoveryDependencies {
  return {
    config: readDocumentGenerationRecoveryConfig(),
    consumeNonce: async (nonceHash) => {
      const { data, error } = await createAdminClient().rpc("consume_agent_execution_trigger_nonce", {
        p_nonce_sha256: nonceHash,
      });
      if (error || typeof data !== "boolean") throw new Error("Recovery replay protection unavailable.");
      return data;
    },
    reconcile: reconcileDocumentGenerationArtifact,
    finalize: finalizeAcceptedExecution,
    log: (event) => console.info(JSON.stringify({ component: "document_generation_recovery", ...event })),
  };
}

export function handleServerDocumentGenerationRecovery(request: Request): Promise<Response> {
  return handleDocumentGenerationRecovery(request, createServerDocumentGenerationRecoveryDependencies());
}
