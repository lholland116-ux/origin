import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CapabilityId } from "@/lib/ai/capability-registry";
import type { OperationTokenUsage } from "@/lib/ai/operation-measurement";

if (typeof window !== "undefined") throw new Error("Provider cost ledger is server-only");

export const AGENT_PROVIDER_COST_POLICY_VERSION = 1 as const;
export const AGENT_PROVIDER_MAX_INPUT_TOKENS = 16_000 as const;
export const AGENT_PROVIDER_MAX_OUTPUT_TOKENS = 4_096 as const;
export const AGENT_PROVIDER_MAX_OPENAI_INVOCATIONS = 2 as const;
export const AGENT_PROVIDER_MAX_IMAGES = 1 as const;
export const AGENT_PROVIDER_MAX_RUN_NANO_USD = BigInt(250_000_000);
export const AGENT_PROVIDER_MAX_USER_DAY_NANO_USD = BigInt(500_000_000);
export const AGENT_PROVIDER_MAX_GLOBAL_DAY_NANO_USD = BigInt(3_000_000_000);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type ProviderCostInvocationContext = Readonly<{
  runId: string;
  stepId: string;
  attemptId: string;
  attemptNumber: number;
  capabilityId: "standard" | "file_analysis" | "document_generation" | "image_generation";
  reauthorize: () => Promise<boolean>;
}>;

export type ProviderCostAdmissionRequest = Readonly<{
  invocationSequence: number;
  provider: "openai" | "replicate";
  model: string;
  inputTokens?: number;
  maxOutputTokens?: number;
  requestedImages?: number;
}>;

export type ProviderCostAdmission = Readonly<{
  id: string;
  mayDispatch: boolean;
}>;

export type ProviderCostLedger = Readonly<{
  admit: (context: ProviderCostInvocationContext, request: ProviderCostAdmissionRequest) => Promise<ProviderCostAdmission>;
  beginDispatch: (admissionId: string) => Promise<boolean>;
  settle: (input: {
    admissionId: string;
    usage?: OperationTokenUsage;
    imageCount?: number;
    providerOperationId?: string;
  }) => Promise<void>;
  markUncertain: (input: { admissionId: string; code: string; providerOperationId?: string }) => Promise<void>;
  releaseBeforeDispatch: (input: { admissionId: string; code: string }) => Promise<void>;
}>;

export class ProviderCostLedgerError extends Error {
  constructor(readonly code: "unavailable" | "denied" | "invalid_response") {
    super("Provider cost admission is unavailable.");
    this.name = "ProviderCostLedgerError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function boundedCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "provider_outcome_unknown";
}

export function createProviderCostLedger(): ProviderCostLedger {
  return Object.freeze({
    async admit(context, request) {
      if (!UUID_PATTERN.test(context.runId) || !UUID_PATTERN.test(context.attemptId)
        || context.stepId.length < 1 || context.stepId.length > 128
        || !Number.isInteger(context.attemptNumber) || context.attemptNumber < 1 || context.attemptNumber > 3
        || !Number.isInteger(request.invocationSequence) || request.invocationSequence < 1 || request.invocationSequence > 2
        || !(await context.reauthorize())) throw new ProviderCostLedgerError("denied");
      const admin = createAdminClient();
      let result: unknown;
      try {
        const { data, error } = await admin.rpc("admit_agent_provider_cost", {
          p_run_id: context.runId,
          p_step_id: context.stepId,
          p_attempt_id: context.attemptId,
          p_attempt_number: context.attemptNumber,
          p_invocation_sequence: request.invocationSequence,
          p_capability_id: context.capabilityId,
          p_provider: request.provider,
          p_model: request.model,
          p_input_tokens: request.inputTokens ?? null,
          p_max_output_tokens: request.maxOutputTokens ?? null,
          p_requested_images: request.requestedImages ?? null,
        });
        if (error) throw error;
        result = data;
      } catch {
        throw new ProviderCostLedgerError("unavailable");
      }
      if (!isRecord(result) || typeof result.admission_id !== "string" || !UUID_PATTERN.test(result.admission_id)
        || typeof result.may_dispatch !== "boolean") throw new ProviderCostLedgerError("invalid_response");
      return { id: result.admission_id, mayDispatch: result.may_dispatch };
    },
    async beginDispatch(admissionId) {
      if (!UUID_PATTERN.test(admissionId)) throw new ProviderCostLedgerError("invalid_response");
      const admin = createAdminClient();
      try {
        const { data, error } = await admin.rpc("begin_agent_provider_cost_dispatch", { p_admission_id: admissionId });
        if (error) throw error;
        return isRecord(data) && data.may_dispatch === true && data.status === "dispatched";
      } catch {
        throw new ProviderCostLedgerError("unavailable");
      }
    },
    async settle(input) {
      if (!UUID_PATTERN.test(input.admissionId)) throw new ProviderCostLedgerError("invalid_response");
      const usage = input.usage;
      const stable = {
        outcome: "settled",
        inputTokens: usage?.inputTokens ?? null,
        cachedInputTokens: usage?.cachedInputTokens ?? null,
        cacheWriteTokens: usage?.cacheWriteTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        imageCount: input.imageCount ?? null,
        providerOperationId: input.providerOperationId ?? null,
      };
      await settleRpc({
        admissionId: input.admissionId,
        outcome: "settled",
        settlementFingerprint: fingerprint(stable),
        inputTokens: stable.inputTokens,
        cachedInputTokens: stable.cachedInputTokens,
        cacheWriteTokens: stable.cacheWriteTokens,
        outputTokens: stable.outputTokens,
        imageCount: stable.imageCount,
        providerOperationId: stable.providerOperationId,
        outcomeCode: "provider_succeeded",
      });
    },
    async markUncertain(input) {
      const stable = { outcome: "uncertain", code: boundedCode(input.code), providerOperationId: input.providerOperationId ?? null };
      await settleRpc({
        admissionId: input.admissionId,
        outcome: "uncertain",
        settlementFingerprint: fingerprint(stable),
        providerOperationId: stable.providerOperationId,
        outcomeCode: stable.code,
      });
    },
    async releaseBeforeDispatch(input) {
      const stable = { outcome: "no_charge", code: boundedCode(input.code) };
      await settleRpc({
        admissionId: input.admissionId,
        outcome: "no_charge",
        settlementFingerprint: fingerprint(stable),
        outcomeCode: stable.code,
      });
    },
  });
}

async function settleRpc(input: {
  admissionId: string;
  outcome: "settled" | "uncertain" | "no_charge";
  settlementFingerprint: string;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  outputTokens?: number | null;
  imageCount?: number | null;
  providerOperationId?: string | null;
  outcomeCode: string;
}): Promise<void> {
  if (!UUID_PATTERN.test(input.admissionId) || !HASH_PATTERN.test(input.settlementFingerprint)) {
    throw new ProviderCostLedgerError("invalid_response");
  }
  const admin = createAdminClient();
  try {
    const { error } = await admin.rpc("settle_agent_provider_cost", {
      p_admission_id: input.admissionId,
      p_outcome: input.outcome,
      p_settlement_fingerprint: input.settlementFingerprint,
      p_input_tokens: input.inputTokens ?? null,
      p_cached_input_tokens: input.cachedInputTokens ?? null,
      p_cache_write_tokens: input.cacheWriteTokens ?? null,
      p_output_tokens: input.outputTokens ?? null,
      p_image_count: input.imageCount ?? null,
      p_provider_operation_id: input.providerOperationId ?? null,
      p_outcome_code: boundedCode(input.outcomeCode),
    });
    if (error) throw error;
  } catch {
    throw new ProviderCostLedgerError("unavailable");
  }
}

export function isGovernedAutonomousCapability(capabilityId: CapabilityId): boolean {
  return capabilityId === "standard" || capabilityId === "file_analysis"
    || capabilityId === "document_generation" || capabilityId === "image_generation";
}
