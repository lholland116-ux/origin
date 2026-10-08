import { createHash } from "node:crypto";
import { z } from "zod";
import { resolveDailyUsageLimits } from "@/lib/capabilities/daily-usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CANONICAL_REQUEST_BYTES = 65_536;

const uuidSchema = z.string().regex(UUID_PATTERN);
const storedImageSchema = z.object({
  imagePath: z.string().trim().min(1).max(500),
  imageName: z.string().trim().min(1).max(255),
}).strict();

export const agentRequestAcceptanceInputSchema = z.object({
  conversationId: uuidSchema,
  /** Client-generated retry key; it carries no user/owner authority. */
  idempotencyKey: uuidSchema,
  message: z.string().trim().min(1).max(20_000),
  documentIds: z.array(uuidSchema).max(10).default([]),
  images: z.array(storedImageSchema).max(3).default([]),
  requestOptions: z.object({
    routingMode: z.enum(["auto", "standard", "web_search"]).default("auto"),
    reasoningMode: z.enum(["instant", "medium", "high"]).optional(),
  }).strict().default({ routingMode: "auto" }),
}).strict().superRefine((input, context) => {
  if (new Set(input.documentIds).size !== input.documentIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate document references are not allowed.", path: ["documentIds"] });
  }
  if (new Set(input.images.map((image) => image.imagePath)).size !== input.images.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate image references are not allowed.", path: ["images"] });
  }
});

export type AgentRequestAcceptanceInput = z.infer<typeof agentRequestAcceptanceInputSchema>;

export type AgentRequestAcceptance = Readonly<{
  kind: "accepted";
  replayed: boolean;
  /** Reuse verbatim as execution_runs.idempotency_key when a run is created. */
  idempotencyKey: string;
  /** Fingerprint verified by the acceptance RPC and retained for run association. */
  requestFingerprint: string;
  binding: RequestMessageBinding;
  usageDate: string;
}>;

export type AgentRequestAcceptanceResult =
  | AgentRequestAcceptance
  | Readonly<{ kind: "limit_reached"; messageCount: number }>
  | Readonly<{ kind: "invalid_request" }>
  | Readonly<{ kind: "unauthorized" }>
  | Readonly<{ kind: "idempotency_conflict" }>
  | Readonly<{ kind: "unavailable" }>;

export type RequestAcceptanceRpcInput = Readonly<{
  userId: string;
  conversationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  requestOptions: AgentRequestAcceptanceInput["requestOptions"];
  message: string;
  documentIds: string[];
  images: Array<{ storage_path: string; image_name: string }>;
  usageDate: string;
  freeDailyLimit: number;
  proDailyLimit: number;
}>;

export type RequestAcceptanceDependencies = Readonly<{
  authenticate: () => Promise<string | null>;
  accept: (input: RequestAcceptanceRpcInput) => Promise<Readonly<{ data: unknown; error: unknown | null }>>;
  now?: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Fingerprints normalized, validated execution-affecting input, never prompt text alone. */
export function fingerprintAgentRequest(input: AgentRequestAcceptanceInput): string {
  const value = canonical({
    version: 1,
    conversationId: input.conversationId,
    message: input.message,
    documentIds: input.documentIds,
    images: input.images,
    requestOptions: input.requestOptions,
  });
  if (Buffer.byteLength(value, "utf8") > MAX_CANONICAL_REQUEST_BYTES) {
    throw new RangeError("The validated request exceeds the acceptance fingerprint limit.");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function acceptedPayload(value: unknown): Omit<AgentRequestAcceptance, "requestFingerprint"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== "accepted" || typeof row.replayed !== "boolean"
    || typeof row.idempotencyKey !== "string" || typeof row.usageDate !== "string") return null;
  const binding = {
    requestId: row.requestId,
    userId: row.userId,
    conversationId: row.conversationId,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
  };
  const parsedBinding = z.object({
    requestId: uuidSchema,
    userId: uuidSchema,
    conversationId: uuidSchema,
    userMessageId: uuidSchema,
    assistantMessageId: uuidSchema,
  }).strict().refine((candidate) => candidate.userMessageId !== candidate.assistantMessageId).safeParse(binding);
  if (!parsedBinding.success || !/^\d{4}-\d{2}-\d{2}$/.test(row.usageDate)) return null;
  return {
    kind: "accepted",
    replayed: row.replayed,
    idempotencyKey: row.idempotencyKey,
    binding: parsedBinding.data,
    usageDate: row.usageDate,
  };
}

function failureCode(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : "";
}

export function createAgentRequestAcceptanceService(dependencies: RequestAcceptanceDependencies) {
  return Object.freeze({
    async accept(rawInput: unknown): Promise<AgentRequestAcceptanceResult> {
      const parsed = agentRequestAcceptanceInputSchema.safeParse(rawInput);
      if (!parsed.success) return { kind: "invalid_request" };

      let userId: string | null;
      try {
        userId = await dependencies.authenticate();
      } catch {
        return { kind: "unavailable" };
      }
      if (!userId || !UUID_PATTERN.test(userId)) return { kind: "unauthorized" };

      let requestFingerprint: string;
      try {
        requestFingerprint = fingerprintAgentRequest(parsed.data);
      } catch {
        return { kind: "invalid_request" };
      }

      const limits = resolveDailyUsageLimits(dependencies.env ?? process.env);
      const developmentBypass = (dependencies.env ?? process.env).NODE_ENV === "development";
      const effectiveLimits = developmentBypass
        ? { free: 2_147_483_647, pro: 2_147_483_647 }
        : limits;
      const usageDate = (dependencies.now?.() ?? new Date()).toISOString().slice(0, 10);

      let result: Awaited<ReturnType<RequestAcceptanceDependencies["accept"]>>;
      try {
        result = await dependencies.accept({
          userId,
          conversationId: parsed.data.conversationId,
          idempotencyKey: parsed.data.idempotencyKey,
          requestFingerprint,
          requestOptions: parsed.data.requestOptions,
          message: parsed.data.message,
          documentIds: [...parsed.data.documentIds],
          images: parsed.data.images.map((image) => ({ storage_path: image.imagePath, image_name: image.imageName })),
          usageDate,
          freeDailyLimit: effectiveLimits.free,
          proDailyLimit: effectiveLimits.pro,
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (result.error) {
        return failureCode(result.error).includes("REQUEST_IDEMPOTENCY_CONFLICT")
          ? { kind: "idempotency_conflict" }
          : { kind: "unavailable" };
      }

      const accepted = acceptedPayload(result.data);
      if (accepted) {
        if (accepted.binding.userId !== userId
          || accepted.binding.conversationId !== parsed.data.conversationId
          || accepted.idempotencyKey !== parsed.data.idempotencyKey) return { kind: "unavailable" };
        // This is the exact fingerprint submitted to the RPC above. The RPC
        // returns accepted only after verifying the same value against its
        // immutable ledger row (including on replay).
        return { ...accepted, requestFingerprint };
      }

      if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
        const row = result.data as Record<string, unknown>;
        if (row.kind === "limit_reached" && Number.isSafeInteger(row.messageCount) && (row.messageCount as number) >= 0) {
          return { kind: "limit_reached", messageCount: row.messageCount as number };
        }
      }
      return { kind: "unavailable" };
    },
  });
}

const productionDependencies: RequestAcceptanceDependencies = {
  authenticate: async () => {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  accept: async (input) => {
    const client = createAdminClient();
    const { data, error } = await client.rpc("accept_agent_request", {
      p_user_id: input.userId,
      p_conversation_id: input.conversationId,
      p_idempotency_key: input.idempotencyKey,
      p_request_fingerprint: input.requestFingerprint,
      p_request_options: input.requestOptions,
      p_message: input.message,
      p_document_ids: input.documentIds,
      p_images: input.images,
      p_usage_date: input.usageDate,
      p_free_daily_limit: input.freeDailyLimit,
      p_pro_daily_limit: input.proDailyLimit,
    });
    return { data, error };
  },
};

export const agentRequestAcceptanceService = createAgentRequestAcceptanceService(productionDependencies);
