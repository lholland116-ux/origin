import { createAdminClient } from "@/lib/supabase/admin";
import { isValidGeneratedImagePath, normalizeGeneratedImageMimeType } from "@/lib/chat/generated-image-history";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GENERATED_MIME_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

type RouteContext = {
  readonly params: Promise<{ readonly generatedImageId: string }>;
};

type GeneratedImageRow = {
  conversation_id: unknown;
  mime_type: unknown;
  storage_path: unknown;
};

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  let userId: string;

  try {
    supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse(401, "Authentication is required.");
    }

    userId = user.id;
  } catch {
    return errorResponse(500, "The generated image could not be downloaded.");
  }

  let generatedImageId: string;
  try {
    generatedImageId = (await context.params).generatedImageId;
  } catch {
    return errorResponse(400, "The generated image identifier is invalid.");
  }

  if (!isValidUuid(generatedImageId)) {
    return errorResponse(400, "The generated image identifier is invalid.");
  }

  let imageRow: GeneratedImageRow | null;
  try {
    const { data, error } = await supabase
      .from("message_generated_images")
      .select("conversation_id, storage_path, mime_type")
      .eq("id", generatedImageId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return errorResponse(500, "The generated image could not be downloaded.");
    }

    imageRow = data as GeneratedImageRow | null;
  } catch {
    return errorResponse(500, "The generated image could not be downloaded.");
  }

  if (!imageRow) {
    return errorResponse(404, "Generated image not found.");
  }

  const conversationId =
    typeof imageRow.conversation_id === "string"
      ? imageRow.conversation_id
      : "";
  const storagePath =
    typeof imageRow.storage_path === "string" ? imageRow.storage_path : "";
  const mimeType = normalizeGeneratedImageMimeType(imageRow.mime_type);
  const extension = mimeType ? GENERATED_MIME_EXTENSIONS[mimeType] : undefined;

  if (
    !isValidUuid(conversationId) ||
    !mimeType ||
    !extension ||
    !isValidGeneratedImagePath(storagePath, userId, conversationId)
  ) {
    return errorResponse(404, "Generated image not found.");
  }

  let imageBlob: Blob;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("chat-images")
      .download(storagePath);

    if (error || !data) {
      return errorResponse(502, "The generated image could not be downloaded.");
    }

    imageBlob = data;
  } catch {
    return errorResponse(502, "The generated image could not be downloaded.");
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await imageBlob.arrayBuffer();
  } catch {
    return errorResponse(502, "The generated image could not be downloaded.");
  }

  if (bytes.byteLength === 0) {
    return errorResponse(502, "The generated image could not be downloaded.");
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition":
        `attachment; filename="lvtchat-image-${generatedImageId}.${extension}"`,
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
