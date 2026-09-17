import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ImageEditOrchestrationError,
  orchestrateImageEdit,
  type ImageEditOrchestrationResult,
} from "@/lib/image-generation/image-edit-orchestrator";
import {
  validateImageEditSourceReference,
  type ImageEditSourceReference,
} from "@/lib/image-generation/lineage";
import {
  createImageEditServerDependencies,
  type ImageEditServerDependencies,
} from "@/lib/image-generation/image-edit-server-dependencies";

export const runtime = "nodejs";

const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const REQUEST_FIELDS = [
  "conversationId",
  "sourceReference",
  "instruction",
  "idempotencyKey",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class RequestBodyTooLargeError extends Error {}

type ParsedRequest = Readonly<{
  conversationId: string;
  sourceReference: ImageEditSourceReference;
  instruction: string;
  idempotencyKey: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function unavailableSourceResponse(): Response {
  return errorResponse(
    404,
    "IMAGE_EDIT_SOURCE_UNAVAILABLE",
    "The image edit source is unavailable.",
  );
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return (
    typeof contentType === "string" &&
    contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function hasOversizedContentLength(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;

  const parsedLength = Number(contentLength);
  return Number.isFinite(parsedLength) && parsedLength > MAX_REQUEST_BODY_BYTES;
}

async function readRequestBody(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

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

function parseRequestBody(value: unknown): ParsedRequest | null {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_FIELDS)) return null;

  const conversationId = value.conversationId;
  const instruction = value.instruction;
  const idempotencyKey = value.idempotencyKey;
  const sourceResult = validateImageEditSourceReference(value.sourceReference);

  if (
    !isUuid(conversationId) ||
    !isUuid(idempotencyKey) ||
    typeof instruction !== "string" ||
    instruction.trim().length === 0 ||
    instruction.length > 4000 ||
    !sourceResult.success
  ) {
    return null;
  }

  const source = sourceResult.source;
  if (
    (source.kind === "generated_image" && !isUuid(source.generatedImageId)) ||
    (source.kind === "uploaded_image" && !isUuid(source.messageId))
  ) {
    return null;
  }

  return {
    conversationId,
    sourceReference: source,
    instruction,
    idempotencyKey,
  };
}

type ConversationPreflightResult = "available" | "unavailable" | "failed";

async function preflightConversation(
  authenticatedClient: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  conversationId: string,
): Promise<ConversationPreflightResult> {
  try {
    const { data, error } = await authenticatedClient
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return "failed";
    if (data === null || data === undefined) return "unavailable";
    if (!isRecord(data) || !isUuid(data.id)) return "failed";

    return data.id.toLowerCase() === conversationId.toLowerCase()
      ? "available"
      : "failed";
  } catch {
    return "failed";
  }
}

function resultResponse(result: ImageEditOrchestrationResult): Response {
  switch (result.kind) {
    case "completed":
      return new Response(
        JSON.stringify({
          status: "completed",
          replayed: false,
          conversationId: result.conversationId,
          imageEditRequestId: result.imageEditRequestId,
          userMessageId: result.userMessageId,
          assistantMessageId: result.assistantMessageId,
          generatedImageId: result.generatedImageId,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    case "completed_replay":
      return new Response(
        JSON.stringify({
          status: "completed",
          replayed: true,
          conversationId: result.conversationId,
          imageEditRequestId: result.imageEditRequestId,
          userMessageId: result.userMessageId,
          assistantMessageId: result.assistantMessageId,
          generatedImageId: result.generatedImageId,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    case "in_progress":
      return new Response(JSON.stringify({ status: "in_progress" }), {
        status: 202,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    case "conflict":
      return errorResponse(409, "IMAGE_EDIT_IDEMPOTENCY_CONFLICT", "The image edit request conflicts with an existing request.");
    case "completed_result_unavailable":
      return errorResponse(
        410,
        "IMAGE_EDIT_RESULT_UNAVAILABLE",
        "The completed image edit result is no longer available.",
      );
  }
}

function orchestrationErrorResponse(
  error: unknown,
  dependencies: ImageEditServerDependencies,
): Response {
  if (!(error instanceof ImageEditOrchestrationError)) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "The image edit could not be completed.",
    );
  }

  switch (error.code) {
    case "invalid_request":
      return errorResponse(400, "INVALID_REQUEST", "The image edit request is invalid.");
    case "idempotency_conflict":
      return errorResponse(
        409,
        "IMAGE_EDIT_IDEMPOTENCY_CONFLICT",
        "The image edit request conflicts with an existing request.",
      );
    case "operation_in_progress":
      return new Response(JSON.stringify({ status: "in_progress" }), {
        status: 202,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    case "completed_result_unavailable":
      return errorResponse(
        410,
        "IMAGE_EDIT_RESULT_UNAVAILABLE",
        "The completed image edit result is no longer available.",
      );
    case "quota_exhausted": {
      const quotaCode = dependencies.getLastQuotaErrorCode();
      return quotaCode
        ? errorResponse(
            429,
            quotaCode,
            "You've reached your image editing limit.",
          )
        : errorResponse(
            500,
            "INTERNAL_ERROR",
            "The image edit could not be completed.",
          );
    }
    case "source_forbidden":
    case "source_not_found":
    case "invalid_source":
      return unavailableSourceResponse();
    case "provider_timeout":
      return errorResponse(504, "IMAGE_EDIT_PROVIDER_TIMEOUT", "The image edit provider timed out.");
    case "provider_failure":
      return errorResponse(502, "IMAGE_EDIT_PROVIDER_FAILURE", "The image edit provider failed.");
    case "invalid_provider_output":
      return errorResponse(
        502,
        "IMAGE_EDIT_INVALID_PROVIDER_OUTPUT",
        "The image edit provider returned an invalid result.",
      );
    case "provider_configuration":
      return errorResponse(500, "IMAGE_EDIT_CONFIGURATION", "Image editing is not configured.");
    case "attempt_start_failed":
      return errorResponse(500, "IMAGE_EDIT_ATTEMPT_START_FAILED", "The image edit could not be started.");
    case "storage_failure":
    case "persistence_failure":
    case "internal_failure":
      return errorResponse(500, "INTERNAL_ERROR", "The image edit could not be completed.");
    case "completed_replay":
      return errorResponse(500, "INTERNAL_ERROR", "The image edit could not be completed.");
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "The image edit endpoint accepts JSON only.",
    );
  }

  if (hasOversizedContentLength(request)) {
    return errorResponse(413, "REQUEST_TOO_LARGE", "The image edit request is too large.");
  }

  let bodyText: string;
  try {
    bodyText = await readRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(413, "REQUEST_TOO_LARGE", "The image edit request is too large.");
    }

    return errorResponse(400, "INVALID_REQUEST", "The image edit request is invalid.");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    return errorResponse(400, "INVALID_JSON", "The image edit request is invalid JSON.");
  }

  let authenticatedClient: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  let authenticatedUserId: string;

  try {
    authenticatedClient = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await authenticatedClient.auth.getUser();

    if (error || !user?.id) {
      return errorResponse(401, "UNAUTHORIZED", "Authentication is required.");
    }

    authenticatedUserId = user.id;
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "The image edit could not be completed.");
  }

  const parsedRequest = parseRequestBody(parsedBody);
  if (!parsedRequest) {
    return errorResponse(400, "INVALID_REQUEST", "The image edit request is invalid.");
  }

  const conversationStatus = await preflightConversation(
    authenticatedClient,
    authenticatedUserId,
    parsedRequest.conversationId,
  );
  if (conversationStatus === "unavailable") {
    return unavailableSourceResponse();
  }
  if (conversationStatus === "failed") {
    return errorResponse(500, "INTERNAL_ERROR", "The image edit could not be completed.");
  }

  let serviceClient: ReturnType<typeof createAdminClient>;
  try {
    serviceClient = createAdminClient();
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "The image edit could not be completed.");
  }

  let dependencies: ImageEditServerDependencies;
  try {
    dependencies = createImageEditServerDependencies({
      authenticatedClient,
      serviceClient,
      authenticatedUserId,
      conversationId: parsedRequest.conversationId,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "The image edit could not be completed.");
  }

  try {
    const result = await orchestrateImageEdit(
      {
        authenticatedUserId,
        conversationId: parsedRequest.conversationId,
        sourceReference: parsedRequest.sourceReference,
        instruction: parsedRequest.instruction,
        idempotencyKey: parsedRequest.idempotencyKey,
      },
      dependencies,
    );

    return resultResponse(result);
  } catch (error) {
    return orchestrationErrorResponse(error, dependencies);
  }
}
