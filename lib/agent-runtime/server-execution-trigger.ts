import "server-only";
import { randomUUID } from "node:crypto";
import { handleExecutionTrigger, type ExecutionTriggerDependencies } from "@/lib/agent-runtime/execution-trigger";
import { runTrustedExecutionWorkerOnce } from "@/lib/agent-runtime/server-workflow-http";
import { createAdminClient } from "@/lib/supabase/admin";

function oneRpcRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : null;
}

export function createServerExecutionTriggerDependencies(): ExecutionTriggerDependencies {
  return {
    enabled: process.env.AGENT_EXECUTION_TRIGGER_ENABLED === "true",
    secret: process.env.AGENT_EXECUTION_TRIGGER_SECRET,
    consumeNonce: async (nonceHash) => {
      const { data, error } = await createAdminClient().rpc("consume_agent_execution_trigger_nonce", {
        p_nonce_sha256: nonceHash,
      });
      if (error || typeof data !== "boolean") throw new Error("Trigger replay protection unavailable.");
      return data;
    },
    acquireInvocation: async (claimId) => {
      const { data, error } = await createAdminClient().rpc("acquire_agent_execution_trigger_gate", {
        p_claim_id: claimId,
      });
      const row = oneRpcRow(data);
      if (error || !row) throw new Error("Trigger concurrency gate unavailable.");
      if (row.status === "busy") return { status: "busy" };
      if (row.status !== "acquired" || !Number.isSafeInteger(row.fencing_generation)
        || Number(row.fencing_generation) < 1) throw new Error("Trigger concurrency gate returned invalid data.");
      return { status: "acquired", fencingGeneration: Number(row.fencing_generation) };
    },
    renewInvocation: async (claimId, fencingGeneration) => {
      const { data, error } = await createAdminClient().rpc("renew_agent_execution_trigger_gate", {
        p_claim_id: claimId,
        p_fencing_generation: fencingGeneration,
      });
      if (error || typeof data !== "boolean") throw new Error("Trigger concurrency gate renewal unavailable.");
      return data;
    },
    releaseInvocation: async (claimId, fencingGeneration) => {
      const { data, error } = await createAdminClient().rpc("release_agent_execution_trigger_gate", {
        p_claim_id: claimId,
        p_fencing_generation: fencingGeneration,
      });
      if (error || typeof data !== "boolean") throw new Error("Trigger concurrency gate release unavailable.");
      return data;
    },
    runOnce: runTrustedExecutionWorkerOnce,
    createInvocationId: randomUUID,
    log: (event) => console.info(JSON.stringify({ component: "agent_execution_trigger", ...event })),
  };
}

export function handleServerExecutionTrigger(request: Request): Promise<Response> {
  return handleExecutionTrigger(request, createServerExecutionTriggerDependencies());
}
