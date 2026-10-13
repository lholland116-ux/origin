import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  handlePredispatchStandardRecovery,
  readPredispatchRecoveryConfig,
  type PredispatchRecoveryDependencies,
  type PredispatchRecoveryResult,
} from "@/lib/agent-runtime/predispatch-standard-recovery-trigger";

export function createServerPredispatchRecoveryDependencies(): PredispatchRecoveryDependencies {
  return {
    config: readPredispatchRecoveryConfig(),
    consumeNonce: async (nonceHash) => {
      const { data, error } = await createAdminClient()
        .rpc("consume_agent_execution_trigger_nonce", { p_nonce_sha256: nonceHash })
        .abortSignal(AbortSignal.timeout(15_000));
      if (error || typeof data !== "boolean") throw new Error("Replay protection unavailable.");
      return data;
    },
    recover: async (input) => {
      const { data, error } = await createAdminClient()
        .rpc("recover_trusted_predispatch_standard_step", {
          p_run_id: input.runId,
          p_expected_snapshot_revision: input.snapshotRevision,
          p_expected_snapshot_sha256: input.snapshotSha256,
          p_expected_claim_id: input.claimId,
          p_expected_fencing_generation: input.fencingGeneration,
          p_expected_execution_key: input.executionKey,
        })
        .abortSignal(AbortSignal.timeout(15_000));
      const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
      if (error || !row || !["recovered", "already_recovered", "not_found", "not_eligible", "conflict", "stale_claim"].includes(row.status)) {
        throw new Error("Pre-dispatch recovery unavailable.");
      }
      return { status: row.status as PredispatchRecoveryResult["status"] };
    },
    log: (event) => console.info(JSON.stringify({ component: "predispatch_standard_recovery", ...event })),
  };
}

export function handleServerPredispatchStandardRecovery(request: Request): Promise<Response> {
  return handlePredispatchStandardRecovery(request, createServerPredispatchRecoveryDependencies());
}
