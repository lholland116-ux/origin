import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IMAGE_GENERATION_DEFAULT_MODEL,
} from "@/lib/image-generation/config";
import {
  ReplicateFluxSchnellProvider,
  ReplicateFluxSchnellProviderError,
  type ReplicateFluxSchnellProviderErrorCode,
} from "@/lib/image-generation/providers/replicate-flux-schnell";
import { validateImageGenerationRequest } from "@/lib/image-generation/validation";
import { normalizeGeneratedImageMimeType } from "@/lib/chat/generated-image-history";

export const runtime = "nodejs";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const SUPPORTED_FIELDS = new Set([
  "conversationId",
  "prompt",
  "model",
  "aspectRatio",
  "seed",
]);

type ImageGenerationErrorCode =
  | "UNAUTHORIZED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "REQUEST_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_FIELD"
  | "IMAGE_GENERATION_CONFIGURATION"
  | "IMAGE_GENERATION_PROVIDER"
  | "INVALID_PROVIDER_OUTPUT"
  | "INTERNAL_ERROR";

class RequestBodyTooLargeError extends Error {}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GENERATED_MIME_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

function isSafeMetadata(value: string): boolean {
  return value.length > 0 && value.length <= 100 && /^[a-zA-Z0-9._:/-]+$/.test(value);
}

function isSafeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function getDurableIds(data: unknown): {
  userMessageId?: string;
  assistantMessageId?: string;
  generatedImageId?: string;
} {
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row)) return {};

  return {
    ...(isSafeUuid(row.user_message_id)
      ? { userMessageId: row.user_message_id }
      : {}),
    ...(isSafeUuid(row.assistant_message_id)
      ? { assistantMessageId: row.assistant_message_id }
      : {}),
    ...(isSafeUuid(row.generated_image_id)
      ? { generatedImageId: row.generated_image_id }
      : {}),
  };
}

function errorResponse(
  status: number,
  code: ImageGenerationErrorCode,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");

  if (!contentType) {
    return false;
  }

  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function hasOversizedContentLength(request: Request): boolean {
  const contentLength = request.headers.get("content-length");

  if (!contentLength) {
    return false;
  }

  const parsedLength = Number(contentLength);
  return Number.isFinite(parsedLength) && parsedLength > MAX_REQUEST_BODY_BYTES;
}

async function readRequestBody(request: Request): Promise<string> {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bodyBytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderError(
  error: unknown,
): error is ReplicateFluxSchnellProviderError & {
  code: ReplicateFluxSchnellProviderErrorCode;
} {
  return error instanceof ReplicateFluxSchnellProviderError;
}

function mapProviderError(error: unknown): Response {
  if (!isProviderError(error)) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Image generation could not be completed.",
    );
  }

  switch (error.code) {
    case "invalid_request":
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The image generation request is not supported.",
      );
    case "configuration":
      return errorResponse(
        500,
        "IMAGE_GENERATION_CONFIGURATION",
        "Image generation is not configured.",
      );
    case "provider_failure":
      return errorResponse(
        502,
        "IMAGE_GENERATION_PROVIDER",
        "The image generation provider could not complete the request.",
      );
    case "invalid_output":
      return errorResponse(
        502,
        "INVALID_PROVIDER_OUTPUT",
        "The image generation provider returned an invalid image.",
      );
  }
}

export async function POST(request: Request): Promise<Response> {
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  let userId = "";

  try {
    supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Authentication is required.",
      );
    }

    userId = user.id;
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Image generation could not be completed.",
    );
  }

  if (!hasJsonContentType(request)) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json.",
    );
  }

  if (hasOversizedContentLength(request)) {
    return errorResponse(
      413,
      "REQUEST_TOO_LARGE",
      "The image generation request is too large.",
    );
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        413,
        "REQUEST_TOO_LARGE",
        "The image generation request is too large.",
      );
    }

    return errorResponse(
      400,
      "INVALID_JSON",
      "The image generation request body is invalid.",
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return errorResponse(
      400,
      "INVALID_JSON",
      "The image generation request body is invalid JSON.",
    );
  }

  if (!isRecord(parsedBody)) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "The image generation request must be an object.",
    );
  }

  const unsupportedField = Object.keys(parsedBody).find(
    (field) => !SUPPORTED_FIELDS.has(field),
  );

  if (unsupportedField) {
    return errorResponse(
      400,
      "UNSUPPORTED_FIELD",
      "The image generation request contains an unsupported field.",
    );
  }

  const rawConversationId = parsedBody.conversationId;
  if (!isSafeUuid(rawConversationId)) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "A valid conversationId is required.",
    );
  }

  const providerBody = { ...parsedBody };
  delete providerBody.conversationId;
  const validated = validateImageGenerationRequest(providerBody);

  if (!validated.success) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "The image generation request is invalid.",
    );
  }

  if (
    validated.request.model !== undefined &&
    validated.request.model !== IMAGE_GENERATION_DEFAULT_MODEL
  ) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "The requested image generation model is not supported.",
    );
  }

  let conversation: { id: string } | null = null;
  let conversationError: { message?: string } | null = null;
  try {
    ({ data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", rawConversationId)
      .eq("user_id", userId)
      .maybeSingle());
  } catch (error) {
    conversationError = {
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }

  if (conversationError) {
    console.error("POST /api/image-generation conversation lookup failed", {
      conversationId: rawConversationId,
      reason: conversationError.message,
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Image generation could not be completed.",
    );
  }

  if (!conversation) {
    return errorResponse(
      404,
      "INVALID_REQUEST",
      "Conversation not found.",
    );
  }

  let result: Awaited<ReturnType<ReplicateFluxSchnellProvider["generateImage"]>>;

  try {
    const provider = new ReplicateFluxSchnellProvider();
    result = await provider.generateImage(validated.request);
  } catch (error) {
    return mapProviderError(error);
  }

  const mimeType = normalizeGeneratedImageMimeType(result.mimeType);
  const providerName = typeof result.provider === "string" ? result.provider.trim() : "";
  const modelName = typeof result.model === "string" ? result.model.trim() : "";
  const generatedBytes =
    result.bytes instanceof Uint8Array ? result.bytes : null;

  if (
    !mimeType ||
    !GENERATED_MIME_EXTENSIONS[mimeType] ||
    !generatedBytes ||
    !generatedBytes.byteLength ||
    !isSafeMetadata(providerName) ||
    !isSafeMetadata(modelName)
  ) {
    return errorResponse(
      502,
      "INVALID_PROVIDER_OUTPUT",
      "The image generation provider returned an invalid image.",
    );
  }

  const storagePath =
    `generated/${userId}/${rawConversationId}/${crypto.randomUUID()}.` +
    GENERATED_MIME_EXTENSIONS[mimeType];
  const admin = (() => {
    try {
      return createAdminClient();
    } catch (error) {
      console.error("POST /api/image-generation admin client unavailable", {
        reason: error instanceof Error ? error.message : "Unknown error.",
      });
      return null;
    }
  })();

  if (!admin) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Image generation could not be completed.",
    );
  }

  let uploadError: { message?: string } | null = null;
  try {
    ({ error: uploadError } = await admin.storage
      .from("chat-images")
      .upload(storagePath, Buffer.from(generatedBytes), {
        contentType: mimeType,
        cacheControl: "3600",
        upsert: false,
      }));
  } catch (error) {
    console.error("POST /api/image-generation storage upload exception", {
      conversationId: rawConversationId,
      reason: error instanceof Error ? error.message : "Unknown error.",
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Image generation could not be completed.",
    );
  }

  if (uploadError) {
    console.error("POST /api/image-generation storage upload failed", {
      conversationId: rawConversationId,
      reason: uploadError.message,
    });
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Image generation could not be completed.",
    );
  }

  let persisted: unknown;
  let persistenceError: { message?: string } | null = null;
  try {
    ({ data: persisted, error: persistenceError } = await supabase.rpc(
      "create_generated_image_chat_exchange",
      {
        p_conversation_id: rawConversationId,
        p_content: validated.request.prompt,
        p_storage_path: storagePath,
        p_mime_type: mimeType,
        p_provider: providerName,
        p_model: modelName,
      },
    ));
  } catch (error) {
    persistenceError = {
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }

  if (persistenceError) {
    console.error("POST /api/image-generation persistence failed", {
      conversationId: rawConversationId,
      reason: persistenceError.message,
    });
    try {
      await admin.storage.from("chat-images").remove([storagePath]);
    } catch (cleanupError) {
      console.error("POST /api/image-generation storage cleanup failed", {
        conversationId: rawConversationId,
        reason: cleanupError instanceof Error ? cleanupError.message : "Unknown error.",
      });
    }
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Image generation could not be completed.",
    );
  }

  const durableIds = getDurableIds(persisted);
  const responseBytes = new ArrayBuffer(generatedBytes.byteLength);
  new Uint8Array(responseBytes).set(generatedBytes);

  return new Response(responseBytes, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-LVTChat-Image-Provider": providerName,
      "X-LVTChat-Image-Model": modelName,
      ...(durableIds.userMessageId
        ? { "X-LVTChat-User-Message-Id": durableIds.userMessageId }
        : {}),
      ...(durableIds.assistantMessageId
        ? { "X-LVTChat-Assistant-Message-Id": durableIds.assistantMessageId }
        : {}),
      ...(durableIds.generatedImageId
        ? { "X-LVTChat-Generated-Image-Id": durableIds.generatedImageId }
        : {}),
    },
  });
}
