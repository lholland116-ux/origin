import { randomUUID } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IMAGE_GENERATION_DEFAULT_MODEL,
  IMAGE_GENERATION_DEFAULT_PROVIDER,
} from "@/lib/image-generation/config";
import {
  ReplicateFluxSchnellProvider,
  ReplicateFluxSchnellProviderError,
} from "@/lib/image-generation/providers/replicate-flux-schnell";
import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "@/lib/image-generation/provider";
import { normalizeGeneratedImageMimeType } from "@/lib/chat/generated-image-history";
import { validateImageGenerationRequest } from "@/lib/image-generation/validation";
import {
  generatedImageReferenceSchema,
  type GeneratedImageReference,
} from "@/lib/agent-runtime/application-contracts";

if (typeof window !== "undefined") throw new Error("Image Generation service is server-only");

const GENERATED_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ImageGenerationServiceInput = Readonly<{
  userId: string;
  conversationId: string;
  request: ImageGenerationRequest;
}>;

export type ExistingMessageImageGenerationServiceInput = ImageGenerationServiceInput & Readonly<{
  userMessageId: string;
  assistantMessageId: string;
}>;

export type ImageGenerationServiceResult = Readonly<{
  reference: GeneratedImageReference;
  /** Transient route-delivery bytes; never included in the durable reference. */
  responseBytes: Uint8Array;
}>;

export type ImageGenerationServiceErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "conversation_not_found"
  | "daily_limit_reached"
  | "monthly_limit_reached"
  | "configuration"
  | "provider_failure"
  | "invalid_provider_output"
  | "storage_failure"
  | "persistence_failure"
  | "internal_failure";

const ERROR_DETAILS: Readonly<Record<ImageGenerationServiceErrorCode, { status: number; code: string; message: string }>> = {
  unauthorized: { status: 401, code: "UNAUTHORIZED", message: "Authentication is required." },
  invalid_request: { status: 400, code: "INVALID_REQUEST", message: "The image generation request is not supported." },
  conversation_not_found: { status: 404, code: "INVALID_REQUEST", message: "Conversation not found." },
  daily_limit_reached: { status: 429, code: "IMAGE_DAILY_LIMIT_REACHED", message: "You've reached today's image generation limit." },
  monthly_limit_reached: { status: 429, code: "IMAGE_MONTHLY_LIMIT_REACHED", message: "You've reached this month's image generation limit." },
  configuration: { status: 500, code: "IMAGE_GENERATION_CONFIGURATION", message: "Image generation is not configured." },
  provider_failure: { status: 502, code: "IMAGE_GENERATION_PROVIDER", message: "The image generation provider could not complete the request." },
  invalid_provider_output: { status: 502, code: "INVALID_PROVIDER_OUTPUT", message: "The image generation provider returned an invalid image." },
  storage_failure: { status: 500, code: "INTERNAL_ERROR", message: "Image generation could not be completed." },
  persistence_failure: { status: 500, code: "INTERNAL_ERROR", message: "Image generation could not be completed." },
  internal_failure: { status: 500, code: "INTERNAL_ERROR", message: "Image generation could not be completed." },
};

export class ImageGenerationServiceError extends Error {
  readonly status: number;
  readonly publicCode: string;

  constructor(readonly code: ImageGenerationServiceErrorCode) {
    const details = ERROR_DETAILS[code];
    super(details.message);
    this.name = "ImageGenerationServiceError";
    this.status = details.status;
    this.publicCode = details.code;
  }
}

export type ImageGenerationServiceDependencies = Readonly<{
  verifyConversation: (input: { userId: string; conversationId: string }) => Promise<boolean>;
  reserveQuota: (conversationId: string) => Promise<string>;
  startAttempt: (input: { attemptId: string; provider: string; model: string }) => Promise<boolean>;
  releaseQuota: (input: { attemptId: string; reason: ImageQuotaReleaseReason }) => Promise<void>;
  createProvider: () => Pick<ImageGenerationProvider, "generateImage">;
  uploadImage: (input: { storagePath: string; bytes: Uint8Array; mimeType: string }) => Promise<void>;
  completeGeneration: (input: {
    attemptId: string;
    conversationId: string;
    prompt: string;
    storagePath: string;
    mimeType: string;
    provider: string;
    model: string;
  }) => Promise<unknown>;
  completeGenerationForExistingMessages: (input: {
    attemptId: string;
    conversationId: string;
    prompt: string;
    userMessageId: string;
    assistantMessageId: string;
    storagePath: string;
    mimeType: string;
    provider: string;
    model: string;
  }) => Promise<unknown>;
  removeImage: (storagePath: string) => Promise<void>;
  createId: () => string;
  logFailure: (event: string, context: Readonly<Record<string, string>>) => void;
}>;

type ImageQuotaReleaseReason =
  | "provider_failure"
  | "invalid_provider_output"
  | "storage_failure"
  | "persistence_failure"
  | "request_aborted"
  | "internal_failure";

function safeMetadata(value: string): boolean {
  return value.length > 0 && value.length <= 100 && /^[a-zA-Z0-9._:/-]+$/.test(value);
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function extractMessage(error: unknown): string {
  return error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : "";
}

function durableIds(data: unknown): { userMessageId: string; assistantMessageId: string; imageId: string } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  if (typeof value.user_message_id !== "string" || !UUID_PATTERN.test(value.user_message_id)
    || typeof value.assistant_message_id !== "string" || !UUID_PATTERN.test(value.assistant_message_id)
    || typeof value.generated_image_id !== "string" || !UUID_PATTERN.test(value.generated_image_id)) return null;
  return {
    userMessageId: value.user_message_id,
    assistantMessageId: value.assistant_message_id,
    imageId: value.generated_image_id,
  };
}

function defaultDependencies(): ImageGenerationServiceDependencies {
  let clientPromise: ReturnType<typeof createServerSupabaseClient> | undefined;
  const client = () => clientPromise ??= createServerSupabaseClient();
  let adminClient: ReturnType<typeof createAdminClient> | undefined;
  const admin = () => adminClient ??= createAdminClient();
  const release = async (input: { attemptId: string; reason: ImageQuotaReleaseReason }) => {
    try {
      const { error } = await (await client()).rpc("release_image_generation_quota", {
        p_attempt_id: input.attemptId,
        p_reason: input.reason,
      });
      if (error) console.error("Image Generation quota release failed", { reason: input.reason });
    } catch {
      console.error("Image Generation quota release exception", { reason: input.reason });
    }
  };

  return {
    verifyConversation: async ({ userId, conversationId }) => {
      const { data, error } = await (await client()).from("conversations")
        .select("id").eq("id", conversationId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error("Conversation lookup failed.");
      return Boolean(data);
    },
    reserveQuota: async (conversationId) => {
      const { data, error } = await (await client()).rpc("reserve_image_generation_quota", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const attemptId = row && typeof row === "object" ? (row as Record<string, unknown>).attempt_id : null;
      if (typeof attemptId !== "string" || !UUID_PATTERN.test(attemptId)) throw new Error("Quota reservation response was invalid.");
      return attemptId;
    },
    startAttempt: async ({ attemptId, provider, model }) => {
      const { data, error } = await (await client()).rpc("start_image_generation_attempt", {
        p_attempt_id: attemptId,
        p_provider: provider,
        p_model: model,
      });
      if (error) throw error;
      return data === true;
    },
    releaseQuota: release,
    createProvider: () => new ReplicateFluxSchnellProvider(),
    uploadImage: async ({ storagePath, bytes, mimeType }) => {
      const { error } = await admin().storage.from("chat-images").upload(storagePath, Buffer.from(bytes), {
        contentType: mimeType,
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw new Error("Image storage upload failed.");
    },
    completeGeneration: async (input) => {
      const { data, error } = await (await client()).rpc("complete_generated_image_generation", {
        p_attempt_id: input.attemptId,
        p_conversation_id: input.conversationId,
        p_content: input.prompt,
        p_storage_path: input.storagePath,
        p_mime_type: input.mimeType,
        p_provider: input.provider,
        p_model: input.model,
      });
      if (error) throw error;
      return data;
    },
    completeGenerationForExistingMessages: async (input) => {
      const { data, error } = await (await client()).rpc(
        "complete_generated_image_generation_for_existing_messages",
        {
          p_attempt_id: input.attemptId,
          p_conversation_id: input.conversationId,
          p_content: input.prompt,
          p_user_message_id: input.userMessageId,
          p_assistant_message_id: input.assistantMessageId,
          p_storage_path: input.storagePath,
          p_mime_type: input.mimeType,
          p_provider: input.provider,
          p_model: input.model,
        },
      );
      if (error) throw error;
      return data;
    },
    removeImage: async (storagePath) => {
      const { error } = await admin().storage.from("chat-images").remove([storagePath]);
      if (error) throw new Error("Image storage cleanup failed.");
    },
    createId: randomUUID,
    logFailure: (event, context) => console.error(event, context),
  };
}

function createImageGenerationOperation<TInput extends ImageGenerationServiceInput>(
  dependencies: ImageGenerationServiceDependencies,
  completeGeneration: (input: TInput, completion: {
    attemptId: string;
    conversationId: string;
    prompt: string;
    storagePath: string;
    mimeType: string;
    provider: string;
    model: string;
  }) => Promise<unknown>,
) {
  return async function generateImage(input: TInput): Promise<ImageGenerationServiceResult> {
    const releaseQuota = async (attemptId: string, reason: ImageQuotaReleaseReason) => {
      try {
        await dependencies.releaseQuota({ attemptId, reason });
      } catch {
        dependencies.logFailure("Image Generation quota release exception", { reason });
      }
    };
    if (!UUID_PATTERN.test(input.userId) || !UUID_PATTERN.test(input.conversationId)) {
      throw new ImageGenerationServiceError("invalid_request");
    }
    const validated = validateImageGenerationRequest(input.request);
    if (!validated.success || (validated.request.model !== undefined && validated.request.model !== IMAGE_GENERATION_DEFAULT_MODEL)) {
      throw new ImageGenerationServiceError("invalid_request");
    }

    let conversationOwned: boolean;
    try {
      conversationOwned = await dependencies.verifyConversation({ userId: input.userId, conversationId: input.conversationId });
    } catch {
      throw new ImageGenerationServiceError("internal_failure");
    }
    if (!conversationOwned) throw new ImageGenerationServiceError("conversation_not_found");

    let attemptId: string;
    try {
      attemptId = await dependencies.reserveQuota(input.conversationId);
      if (!UUID_PATTERN.test(attemptId)) throw new Error("Quota reservation response was invalid.");
    } catch (error) {
      const message = extractMessage(error);
      if (message === "IMAGE_DAILY_LIMIT_REACHED") throw new ImageGenerationServiceError("daily_limit_reached");
      if (message === "IMAGE_MONTHLY_LIMIT_REACHED") throw new ImageGenerationServiceError("monthly_limit_reached");
      if (message === "CONVERSATION_NOT_FOUND") throw new ImageGenerationServiceError("conversation_not_found");
      if (message === "UNAUTHORIZED") throw new ImageGenerationServiceError("unauthorized");
      throw new ImageGenerationServiceError("internal_failure");
    }

    let started = false;
    try {
      started = await dependencies.startAttempt({
        attemptId,
        provider: IMAGE_GENERATION_DEFAULT_PROVIDER,
        model: IMAGE_GENERATION_DEFAULT_MODEL,
      });
    } catch {
      started = false;
    }
    if (!started) {
      await releaseQuota(attemptId, "internal_failure");
      throw new ImageGenerationServiceError("internal_failure");
    }

    let result: ImageGenerationResult;
    try {
      result = await dependencies.createProvider().generateImage(validated.request);
    } catch (error) {
      const providerError = error instanceof ReplicateFluxSchnellProviderError ? error : null;
      await releaseQuota(attemptId, providerError?.code === "invalid_output" ? "invalid_provider_output" : "provider_failure");
      if (providerError?.code === "configuration") throw new ImageGenerationServiceError("configuration");
      if (providerError?.code === "invalid_request") throw new ImageGenerationServiceError("invalid_request");
      if (providerError?.code === "invalid_output") throw new ImageGenerationServiceError("invalid_provider_output");
      if (providerError?.code === "provider_failure") throw new ImageGenerationServiceError("provider_failure");
      throw new ImageGenerationServiceError("internal_failure");
    }

    const mimeType = normalizeGeneratedImageMimeType(result.mimeType);
    const providerName = typeof result.provider === "string" ? result.provider.trim() : "";
    const modelName = typeof result.model === "string" ? result.model.trim() : "";
    const generatedBytes = result.bytes instanceof Uint8Array ? result.bytes : null;
    if (!mimeType || !GENERATED_MIME_EXTENSIONS[mimeType] || !generatedBytes?.byteLength
      || !safeMetadata(providerName) || !safeMetadata(modelName)) {
      await releaseQuota(attemptId, "invalid_provider_output");
      throw new ImageGenerationServiceError("invalid_provider_output");
    }

    const storagePath = `generated/${input.userId}/${input.conversationId}/${dependencies.createId()}.${GENERATED_MIME_EXTENSIONS[mimeType]}`;
    try {
      await dependencies.uploadImage({ storagePath, bytes: generatedBytes, mimeType });
    } catch {
      await releaseQuota(attemptId, "storage_failure");
      dependencies.logFailure("Image Generation storage upload failed", { conversationId: input.conversationId });
      throw new ImageGenerationServiceError("storage_failure");
    }

    let persisted: unknown;
    try {
      persisted = await completeGeneration(input, {
        attemptId,
        conversationId: input.conversationId,
        prompt: validated.request.prompt,
        storagePath,
        mimeType,
        provider: providerName,
        model: modelName,
      });
    } catch {
      persisted = null;
    }
    const ids = durableIds(persisted);
    if (!ids) {
      try {
        await dependencies.removeImage(storagePath);
      } catch {
        dependencies.logFailure("Image Generation storage cleanup failed", { conversationId: input.conversationId });
      }
      await releaseQuota(attemptId, "persistence_failure");
      throw new ImageGenerationServiceError("persistence_failure");
    }

    const parsedReference = generatedImageReferenceSchema.safeParse({
      kind: "generated_image",
      imageId: ids.imageId,
      conversationId: input.conversationId,
      userMessageId: ids.userMessageId,
      assistantMessageId: ids.assistantMessageId,
      mimeType,
      provider: providerName,
      model: modelName,
    });
    if (!parsedReference.success) {
      try {
        await dependencies.removeImage(storagePath);
      } catch {
        dependencies.logFailure("Image Generation storage cleanup failed", { conversationId: input.conversationId });
      }
      await releaseQuota(attemptId, "persistence_failure");
      throw new ImageGenerationServiceError("persistence_failure");
    }

    return { reference: parsedReference.data, responseBytes: generatedBytes };
  };
}

export function createImageGenerationService(dependencies: ImageGenerationServiceDependencies = defaultDependencies()) {
  return createImageGenerationOperation(dependencies, (_input, completion) =>
    dependencies.completeGeneration(completion),
  );
}

export function createImageGenerationServiceForExistingMessages(
  dependencies: ImageGenerationServiceDependencies = defaultDependencies(),
) {
  const generate = createImageGenerationOperation<ExistingMessageImageGenerationServiceInput>(
    dependencies,
    (input, completion) => dependencies.completeGenerationForExistingMessages({
      ...completion,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
    }),
  );
  return async function generateImageForExistingMessages(
    input: ExistingMessageImageGenerationServiceInput,
  ): Promise<ImageGenerationServiceResult> {
    const userMessageId = normalizeUuid(input.userMessageId);
    const assistantMessageId = normalizeUuid(input.assistantMessageId);
    if (
      !userMessageId ||
      !assistantMessageId ||
      userMessageId === assistantMessageId
    ) {
      throw new ImageGenerationServiceError("invalid_request");
    }
    return generate({ ...input, userMessageId, assistantMessageId });
  };
}

export const generateImage = createImageGenerationService();
export const generateImageForExistingMessages = createImageGenerationServiceForExistingMessages();
