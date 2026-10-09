import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentFormat } from "@/lib/documents/generation/contracts";

if (typeof window !== "undefined") throw new Error("Trusted execution subjects are server-only");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT_BRAND: unique symbol = Symbol("trusted-execution-subject");
const trustedSubjectInstances = new WeakSet<object>();

export type TrustedExecutionSubjectInput = Readonly<{
  runId: string;
  stepId: string;
  executionKey: string;
  claimId: string;
  fencingGeneration: number;
}>;

export type TrustedExecutionSubject = Readonly<{
  readonly [SUBJECT_BRAND]: true;
  readonly runId: string;
  readonly stepId: string;
  readonly executionKey: string;
  readonly claimId: string;
  readonly fencingGeneration: number;
  readonly requestId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly capabilityId: "standard" | "file_analysis" | "document_generation" | "image_generation";
  readonly attemptNumber: number;
  readonly reasoningMode?: string;
  readonly plan: "free" | "pro";
  assertCurrent(): Promise<boolean>;
  reserveImageQuota(): Promise<string>;
  startImageAttempt(input: { attemptId: string; provider: string; model: string }): Promise<boolean>;
  releaseImageQuota(input: { attemptId: string; reason: string }): Promise<boolean>;
  completeImage(input: { attemptId: string; prompt: string; storagePath: string; mimeType: string; provider: string; model: string }): Promise<unknown>;
  persistDocument(input: {
    generatedDocumentId: string;
    storagePath: string;
    filename: string;
    format: DocumentFormat;
    mimeType: string;
    sizeBytes: number;
    templateId: string;
  }): Promise<unknown>;
}>;

type SubjectRow = Readonly<Record<string, unknown>>;
type ParsedSubjectIdentity = Readonly<{
  requestId: string;
  userId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  capabilityId: TrustedExecutionSubject["capabilityId"];
  attemptNumber: number;
  reasoningMode?: string;
  plan: "free" | "pro";
  executionKey: string;
}>;

function rowFromRpc(value: unknown): SubjectRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row) ? row as SubjectRow : null;
}

function parseRow(row: SubjectRow | null): ParsedSubjectIdentity | null {
  if (!row || typeof row.request_id !== "string" || !UUID.test(row.request_id)
    || typeof row.user_id !== "string" || !UUID.test(row.user_id)
    || typeof row.conversation_id !== "string" || !UUID.test(row.conversation_id)
    || typeof row.user_message_id !== "string" || !UUID.test(row.user_message_id)
    || typeof row.assistant_message_id !== "string" || !UUID.test(row.assistant_message_id)
    || typeof row.capability_id !== "string"
    || !["standard", "file_analysis", "document_generation", "image_generation"].includes(row.capability_id)
    || (row.plan !== "free" && row.plan !== "pro")
    || !Number.isSafeInteger(row.attempt_number) || (row.attempt_number as number) < 1
    || typeof row.execution_key !== "string" || !UUID.test(row.execution_key)) return null;
  return {
    requestId: row.request_id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    capabilityId: row.capability_id as TrustedExecutionSubject["capabilityId"],
    attemptNumber: row.attempt_number as number,
    ...(typeof row.reasoning_mode === "string" ? { reasoningMode: row.reasoning_mode } : {}),
    plan: row.plan,
    executionKey: row.execution_key,
  };
}

function validInput(input: TrustedExecutionSubjectInput): boolean {
  return UUID.test(input.runId) && UUID.test(input.executionKey) && UUID.test(input.claimId)
    && typeof input.stepId === "string" && input.stepId.length > 0 && input.stepId.length <= 128
    && Number.isSafeInteger(input.fencingGeneration) && input.fencingGeneration > 0;
}

async function loadSubjectRow(input: TrustedExecutionSubjectInput, allowPending = false): Promise<ReturnType<typeof parseRow>> {
  if (!validInput(input)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_trusted_agent_execution_subject", {
    p_run_id: input.runId,
    p_step_id: input.stepId,
    p_execution_key: input.executionKey,
    p_claim_id: input.claimId,
    p_fencing_generation: input.fencingGeneration,
    p_allow_pending: allowPending,
  });
  if (error) return null;
  const parsed = parseRow(rowFromRpc(data));
  if (!parsed) return null;

  const { data: authResult, error: authError } = await admin.auth.admin.getUserById(parsed.userId);
  const authUser = authResult?.user as unknown as { id?: unknown; banned_until?: unknown; deleted_at?: unknown } | null;
  if (authError || !authUser || authUser.id !== parsed.userId || authUser.deleted_at) return null;
  if (typeof authUser.banned_until === "string" && Date.parse(authUser.banned_until) > Date.now()) return null;
  return parsed;
}

async function requiredRpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await createAdminClient().rpc(name, params);
  if (error) throw new Error("Trusted execution persistence is unavailable.");
  return data as T;
}

/**
 * Creates no authority from caller-provided owner data: PostgreSQL resolves the
 * owner and binding from the accepted run, and verifies the active claim,
 * fencing generation, running step, controls, approval state and entitlement.
 */
export async function resolveTrustedExecutionSubject(
  input: TrustedExecutionSubjectInput,
): Promise<TrustedExecutionSubject | null> {
  const identity = await loadSubjectRow(input, true);
  if (!identity) return null;
  const claimArgs = {
    p_run_id: input.runId,
    p_step_id: input.stepId,
    p_execution_key: input.executionKey,
    p_claim_id: input.claimId,
    p_fencing_generation: input.fencingGeneration,
  };
  const subject: TrustedExecutionSubject = Object.freeze({
    [SUBJECT_BRAND]: true as const,
    ...input,
    ...identity,
    async assertCurrent() {
      const latest = await loadSubjectRow(input);
      return Boolean(latest && latest.userId === identity.userId && latest.requestId === identity.requestId
        && latest.conversationId === identity.conversationId && latest.userMessageId === identity.userMessageId
        && latest.assistantMessageId === identity.assistantMessageId && latest.capabilityId === identity.capabilityId
        && latest.executionKey === input.executionKey);
    },
    async reserveImageQuota() {
      if (identity.capabilityId !== "image_generation") throw new Error("Trusted execution capability mismatch.");
      const data = await requiredRpc<unknown>("reserve_trusted_image_generation_quota", claimArgs);
      const attemptId = typeof data === "string" ? data : Array.isArray(data) && typeof data[0] === "string" ? data[0] : null;
      if (!attemptId || !UUID.test(attemptId)) throw new Error("Image quota reservation was unavailable.");
      return attemptId;
    },
    async startImageAttempt(args) {
      if (identity.capabilityId !== "image_generation") return false;
      return await requiredRpc<boolean>("start_trusted_image_generation_attempt", { ...claimArgs,
        p_attempt_id: args.attemptId, p_provider: args.provider, p_model: args.model });
    },
    async releaseImageQuota(args) {
      if (identity.capabilityId !== "image_generation") return false;
      return await requiredRpc<boolean>("release_trusted_image_generation_quota", { ...claimArgs,
        p_attempt_id: args.attemptId, p_reason: args.reason });
    },
    async completeImage(args) {
      if (identity.capabilityId !== "image_generation") throw new Error("Trusted execution capability mismatch.");
      return await requiredRpc("complete_trusted_image_generation", { ...claimArgs,
        p_attempt_id: args.attemptId, p_content: args.prompt, p_storage_path: args.storagePath,
        p_mime_type: args.mimeType, p_provider: args.provider, p_model: args.model });
    },
    async persistDocument(args) {
      if (identity.capabilityId !== "document_generation") throw new Error("Trusted execution capability mismatch.");
      return await requiredRpc("persist_trusted_generated_document_for_execution", { ...claimArgs,
        p_generated_document_id: args.generatedDocumentId, p_storage_path: args.storagePath,
        p_filename: args.filename, p_format: args.format, p_mime_type: args.mimeType,
        p_size_bytes: args.sizeBytes, p_template_id: args.templateId });
    },
  });
  trustedSubjectInstances.add(subject);
  return subject;
}

export function isTrustedExecutionSubject(value: unknown): value is TrustedExecutionSubject {
  return Boolean(value && typeof value === "object" && trustedSubjectInstances.has(value));
}
