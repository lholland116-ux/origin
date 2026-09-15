import { NextResponse } from "next/server";
import { isValidGeneratedImagePath, normalizeGeneratedImageMimeType } from "@/lib/chat/generated-image-history";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  readonly params: Promise<{ readonly generatedImageId: string }>;
};

type GeneratedImageRow = {
  id: unknown;
  message_id: unknown;
  conversation_id: unknown;
  user_id: unknown;
  storage_path: unknown;
  mime_type: unknown;
};

type GeneratedImageMessageRow = {
  id: unknown;
  role: unknown;
  content: unknown;
  documents: unknown;
  image_path: unknown;
  image_name: unknown;
  sources: unknown;
  source_count: unknown;
  widget: unknown;
};

function errorResponse(status: number, message: string, code?: string): NextResponse {
  return NextResponse.json(
    {
      error: message,
      ...(code ? { code } : {}),
    },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isEmptyJsonArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function isImageOnlyAssistantMessage(message: GeneratedImageMessageRow): boolean {
  const sourcesAreEmpty =
    message.sources === null ||
    (Array.isArray(message.sources) && message.sources.length === 0);

  return (
    message.role === "assistant" &&
    message.content === "" &&
    isEmptyJsonArray(message.documents) &&
    message.image_path === null &&
    message.image_name === null &&
    sourcesAreEmpty &&
    (message.source_count === null || message.source_count === 0) &&
    message.widget === null
  );
}

async function restoreStorageObject(
  storagePath: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.from("chat-images").upload(
      storagePath,
      Buffer.from(bytes),
      {
        contentType: mimeType,
        cacheControl: "3600",
        upsert: false,
      },
    );

    if (error) {
      console.error("DELETE generated image storage restore failed", {
        reason: error.message,
      });
    }
  } catch (error) {
    console.error("DELETE generated image storage restore exception", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
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
    return errorResponse(500, "The generated image could not be deleted.");
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
      .select("id, message_id, conversation_id, user_id, storage_path, mime_type")
      .eq("id", generatedImageId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return errorResponse(500, "The generated image could not be deleted.");
    }

    imageRow = data as GeneratedImageRow | null;
  } catch {
    return errorResponse(500, "The generated image could not be deleted.");
  }

  if (!imageRow) {
    return errorResponse(404, "Generated image not found.");
  }

  const imageId = typeof imageRow.id === "string" ? imageRow.id : "";
  const messageId = typeof imageRow.message_id === "string" ? imageRow.message_id : "";
  const conversationId =
    typeof imageRow.conversation_id === "string" ? imageRow.conversation_id : "";
  const rowUserId = typeof imageRow.user_id === "string" ? imageRow.user_id : "";
  const storagePath =
    typeof imageRow.storage_path === "string" ? imageRow.storage_path : "";
  const mimeType = normalizeGeneratedImageMimeType(imageRow.mime_type);

  if (
    imageId !== generatedImageId ||
    !isValidUuid(messageId) ||
    !isValidUuid(conversationId) ||
    rowUserId !== userId ||
    !mimeType ||
    !isValidGeneratedImagePath(storagePath, userId, conversationId)
  ) {
    return errorResponse(404, "Generated image not found.");
  }

  let imageMessage: GeneratedImageMessageRow | null;
  try {
    const { data, error } = await supabase
      .from("messages")
      .select(
        "id, role, content, documents, image_path, image_name, sources, source_count, widget",
      )
      .eq("id", messageId)
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return errorResponse(500, "The generated image could not be deleted.");
    }

    imageMessage = data as GeneratedImageMessageRow | null;
  } catch {
    return errorResponse(500, "The generated image could not be deleted.");
  }

  if (!imageMessage || !isImageOnlyAssistantMessage(imageMessage)) {
    return errorResponse(409, "This generated image cannot be deleted.", "IMAGE_MESSAGE_NOT_DELETABLE");
  }

  try {
    const { data: descendants, error } = await supabase
      .from("image_edit_lineage")
      .select("id")
      .eq("source_generated_image_id", generatedImageId)
      .limit(1);

    if (error) {
      return errorResponse(500, "The generated image could not be deleted.");
    }

    if (Array.isArray(descendants) && descendants.length > 0) {
      return errorResponse(
        409,
        "This image can't be deleted because edited images depend on it.",
        "IMAGE_HAS_DERIVATIVES",
      );
    }
  } catch {
    return errorResponse(500, "The generated image could not be deleted.");
  }

  let bytes: ArrayBuffer;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("chat-images")
      .download(storagePath);

    if (error || !data) {
      return errorResponse(502, "The generated image could not be deleted.");
    }

    bytes = await data.arrayBuffer();
    if (bytes.byteLength === 0) {
      return errorResponse(502, "The generated image could not be deleted.");
    }
  } catch {
    return errorResponse(502, "The generated image could not be deleted.");
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.from("chat-images").remove([storagePath]);

    if (error) {
      return errorResponse(502, "The generated image could not be deleted.");
    }
  } catch {
    return errorResponse(502, "The generated image could not be deleted.");
  }

  try {
    const { data: deletedMessages, error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .eq("role", "assistant")
      .select("id");

    if (error || !Array.isArray(deletedMessages) || deletedMessages.length !== 1) {
      await restoreStorageObject(storagePath, mimeType, bytes);
      return errorResponse(500, "The generated image could not be deleted.");
    }
  } catch {
    await restoreStorageObject(storagePath, mimeType, bytes);
    return errorResponse(500, "The generated image could not be deleted.");
  }

  return NextResponse.json(
    { ok: true, generatedImageId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
