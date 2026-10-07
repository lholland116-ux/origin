import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  IMAGE_GENERATION_DEFAULT_MODEL,
} from "@/lib/image-generation/config";
import { validateImageGenerationRequest } from "@/lib/image-generation/validation";
import { generateImage, ImageGenerationServiceError } from "@/lib/ai/image-generation-service";

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
  | "IMAGE_DAILY_LIMIT_REACHED"
  | "IMAGE_MONTHLY_LIMIT_REACHED"
  | "INTERNAL_ERROR";

class RequestBodyTooLargeError extends Error {}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
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

  try {
    const generated = await generateImage({
      userId,
      conversationId: rawConversationId,
      request: validated.request,
    });
    const responseBytes = new ArrayBuffer(generated.responseBytes.byteLength);
    new Uint8Array(responseBytes).set(generated.responseBytes);
    return new Response(responseBytes, {
      status: 200,
      headers: {
        "Content-Type": generated.reference.mimeType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-LVTChat-Image-Provider": generated.reference.provider,
        "X-LVTChat-Image-Model": generated.reference.model,
        "X-LVTChat-User-Message-Id": generated.reference.userMessageId,
        "X-LVTChat-Assistant-Message-Id": generated.reference.assistantMessageId,
        "X-LVTChat-Generated-Image-Id": generated.reference.imageId,
      },
    });
  } catch (error) {
    if (error instanceof ImageGenerationServiceError) {
      return errorResponse(error.status, error.publicCode as ImageGenerationErrorCode, error.message);
    }
    return errorResponse(500, "INTERNAL_ERROR", "Image generation could not be completed.");
  }
}
