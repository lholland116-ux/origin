import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  hydrateGeneratedImageRows,
  type GeneratedImageHistory,
} from "@/lib/chat/generated-image-history";

const MAX_CONVERSATION_ID_LENGTH = 200;
const SIGNED_IMAGE_URL_LIFETIME_SECONDS = 60 * 60;

type StoredDocumentStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed";

type StoredDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: StoredDocumentStatus;
  extraction_error?: string | null;
  conversation_id: string | null;
};

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
};

type TimeWidget = {
  type: "time";
  location: string;
  timezone: string;
};

type StoredWidget = TimeWidget | null;

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  image_path: string | null;
  image_name: string | null;
  documents: unknown;
  sources: unknown;
  source_count: number | null;
  widget: unknown;
};

type MessageImageRow = {
  id: string;
  message_id: string;
  storage_path: string;
  image_name: string;
  ordinal: number;
  created_at: string;
};

type MessageImageResponse = {
  image_path: string;
  image_name: string;
  image_url: string;
};

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeConversationId(input: string | null): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeStoredDocumentStatus(input: unknown): StoredDocumentStatus {
  if (
    input === "uploading" ||
    input === "processing" ||
    input === "ready" ||
    input === "failed"
  ) {
    return input;
  }

  return "failed";
}

function normalizeStoredDocuments(input: unknown): StoredDocument[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object"
    )
    .map(
      (item): StoredDocument => ({
        id: typeof item.id === "string" ? item.id : "",
        file_name:
          typeof item.file_name === "string"
            ? item.file_name
            : "Untitled document",
        mime_type: typeof item.mime_type === "string" ? item.mime_type : "",
        size_bytes: typeof item.size_bytes === "number" ? item.size_bytes : 0,
        extraction_status: normalizeStoredDocumentStatus(
          item.extraction_status
        ),
        extraction_error:
          typeof item.extraction_error === "string"
            ? item.extraction_error
            : null,
        conversation_id:
          typeof item.conversation_id === "string"
            ? item.conversation_id
            : null,
      })
    )
    .filter((doc) => doc.id.length > 0);
}

function normalizeSources(input: unknown): SourceItem[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();

  return input
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object"
    )
    .map((item) => {
      const url = typeof item.url === "string" ? item.url.trim() : "";
      const title =
        typeof item.title === "string" && item.title.trim().length > 0
          ? item.title.trim()
          : url;

      const snippet =
        typeof item.snippet === "string" && item.snippet.trim().length > 0
          ? item.snippet.trim()
          : undefined;

      return {
        title,
        url,
        snippet,
      };
    })
    .filter((source) => {
      if (!source.url) return false;
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    });
}

function normalizeSourceCount(
  input: unknown,
  fallbackSources: SourceItem[]
): number {
  return typeof input === "number" && input >= 0
    ? input
    : fallbackSources.length;
}

function normalizeWidget(input: unknown): StoredWidget {
  if (!input || typeof input !== "object") {
    return null;
  }

  const widget = input as Record<string, unknown>;

  if (widget.type !== "time") {
    return null;
  }

  const location =
    typeof widget.location === "string" ? widget.location.trim() : "";
  const timezone =
    typeof widget.timezone === "string" ? widget.timezone.trim() : "";

  if (!location || !timezone) {
    return null;
  }

  return {
    type: "time",
    location,
    timezone,
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object";
}

function isValidMessageImagePath(storagePath: string, userId: string): boolean {
  const pathSegments = storagePath.split("/");

  return (
    storagePath.length > 0 &&
    storagePath.length <= 500 &&
    storagePath.startsWith(`${userId}/`) &&
    !storagePath.startsWith("/") &&
    !storagePath.includes("..") &&
    !storagePath.includes("\\") &&
    pathSegments.every((segment) => segment.length > 0) &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(storagePath)
  );
}

function normalizeMessageImageRow(input: unknown): MessageImageRow | null {
  if (!isRecord(input)) return null;

  const id = typeof input.id === "string" ? input.id.trim() : "";
  const messageId =
    typeof input.message_id === "string" ? input.message_id.trim() : "";
  const storagePath =
    typeof input.storage_path === "string" ? input.storage_path.trim() : "";
  const imageName =
    typeof input.image_name === "string" ? input.image_name.trim() : "";
  const ordinal = input.ordinal;
  const createdAt =
    typeof input.created_at === "string" ? input.created_at : "";

  if (
    !id ||
    !messageId ||
    !storagePath ||
    !imageName ||
    imageName.length > 255 ||
    typeof ordinal !== "number" ||
    !Number.isInteger(ordinal) ||
    ordinal < 1 ||
    !createdAt
  ) {
    return null;
  }

  return {
    id,
    message_id: messageId,
    storage_path: storagePath,
    image_name: imageName,
    ordinal,
    created_at: createdAt,
  };
}

function rawMessageImageMessageId(input: unknown): string | null {
  if (!isRecord(input) || typeof input.message_id !== "string") {
    return null;
  }

  const messageId = input.message_id.trim();
  return messageId || null;
}

async function loadGeneratedImages(
  rows: unknown[],
  userId: string,
  conversationId: string,
): Promise<Map<string, GeneratedImageHistory>> {
  if (rows.length === 0) return new Map();

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("GET /api/messages generated image admin client unavailable", {
      conversationId,
      reason: error instanceof Error ? error.message : "Unknown error.",
    });
    return new Map();
  }

  return hydrateGeneratedImageRows({
    rows,
    userId,
    conversationId,
    sign: async (storagePath) => {
      try {
        const { data, error } = await admin.storage
          .from("chat-images")
          .createSignedUrl(storagePath, SIGNED_IMAGE_URL_LIFETIME_SECONDS);
        return error || !data?.signedUrl ? null : data.signedUrl;
      } catch (error) {
        console.error("GET /api/messages generated image signing failed", {
          conversationId,
          reason: error instanceof Error ? error.message : "Unknown error.",
        });
        return null;
      }
    },
  });
}

async function signMessageImage(
  supabase: ServerSupabaseClient,
  row: MessageImageRow,
  userId: string
): Promise<MessageImageResponse | null> {
  if (!isValidMessageImagePath(row.storage_path, userId)) {
    console.error("GET /api/messages invalid child image path", {
      imageId: row.id,
      messageId: row.message_id,
    });
    return null;
  }

  try {
    const { data, error } = await supabase.storage
      .from("chat-images")
      .createSignedUrl(row.storage_path, SIGNED_IMAGE_URL_LIFETIME_SECONDS);

    if (error || !data?.signedUrl) {
      console.error("GET /api/messages child image signing failed", {
        imageId: row.id,
        messageId: row.message_id,
        reason: error?.message || "Signed URL was missing.",
      });
      return null;
    }

    return {
      image_path: row.storage_path,
      image_name: row.image_name,
      image_url: data.signedUrl,
    };
  } catch (error) {
    console.error("GET /api/messages child image signing error", {
      imageId: row.id,
      messageId: row.message_id,
      reason: error instanceof Error ? error.message : "Unknown signing error.",
    });
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const conversationId = normalizeConversationId(
      req.nextUrl.searchParams.get("conversationId")
    );

    if (!conversationId) {
      return jsonError("conversationId is required.", 400);
    }

    if (conversationId.length > MAX_CONVERSATION_ID_LENGTH) {
      return jsonError("conversationId is too long.", 400);
    }

    const { data, error } = await supabase
      .from("messages")
      .select(
        `
          id,
          role,
          content,
          created_at,
          image_path,
          image_name,
          documents,
          sources,
          source_count,
          widget
        `
      )
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("GET /api/messages error:", error);
      return jsonError("Failed to load messages.", 500);
    }

    const parentMessages = (data ?? []) as MessageRow[];
    const parentMessageIds = parentMessages.map((message) => message.id);
    const parentMessageIdSet = new Set(parentMessageIds);
    const childRowsByMessageId = new Map<string, MessageImageRow[]>();
    const childMessageIds = new Set<string>();

    if (parentMessageIds.length > 0) {
      const {
        data: childData,
        error: childError,
      } = await supabase
        .from("message_images")
        .select(
          `
            id,
            message_id,
            storage_path,
            image_name,
            ordinal,
            created_at
          `
        )
        .in("message_id", parentMessageIds)
        .order("ordinal", { ascending: true });

      if (childError) {
        console.error("GET /api/messages child image query failed", {
          conversationId,
          messageCount: parentMessageIds.length,
          reason: childError.message,
        });
      } else {
        for (const rawRow of (childData ?? []) as unknown[]) {
          const rawMessageId = rawMessageImageMessageId(rawRow);
          if (rawMessageId && parentMessageIdSet.has(rawMessageId)) {
            childMessageIds.add(rawMessageId);
          }

          const row = normalizeMessageImageRow(rawRow);
          if (!row || !parentMessageIdSet.has(row.message_id)) {
            continue;
          }

          const rows = childRowsByMessageId.get(row.message_id) ?? [];
          rows.push(row);
          childRowsByMessageId.set(row.message_id, rows);
        }
      }
    }

    const signedImagesByMessageId = new Map<string, MessageImageResponse[]>();

    await Promise.all(
      Array.from(childRowsByMessageId.entries()).map(
        async ([messageId, rows]) => {
          rows.sort(
            (left, right) =>
              left.ordinal - right.ordinal ||
              left.created_at.localeCompare(right.created_at) ||
              left.id.localeCompare(right.id)
          );

          const signedImages = await Promise.all(
            rows.map((row) => signMessageImage(supabase, row, user.id))
          );

          signedImagesByMessageId.set(
            messageId,
            signedImages.filter(
              (image): image is MessageImageResponse => image !== null
            )
          );
        }
      )
    );

    const generatedImagesByMessageId = new Map<string, GeneratedImageHistory>();

    if (parentMessageIds.length > 0) {
      const { data: generatedData, error: generatedError } = await supabase
        .from("message_generated_images")
        .select(
          `
            id,
            message_id,
            conversation_id,
            user_id,
            storage_path,
            mime_type,
            provider,
            model
          `,
        )
        .in("message_id", parentMessageIds)
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (generatedError) {
        console.error("GET /api/messages generated image query failed", {
          conversationId,
          reason: generatedError.message,
        });
      } else {
        const hydratedGeneratedImages = await loadGeneratedImages(
          (generatedData ?? []) as unknown[],
          user.id,
          conversationId,
        );
        for (const [messageId, image] of hydratedGeneratedImages) {
          if (parentMessageIdSet.has(messageId)) {
            generatedImagesByMessageId.set(messageId, image);
          }
        }
      }
    }

    const normalizedMessages = parentMessages.map((message) => {
      const sources = normalizeSources(message.sources);

      return {
        ...message,
        documents: normalizeStoredDocuments(message.documents),
        sources,
        sourceCount: normalizeSourceCount(message.source_count, sources),
        widget: normalizeWidget(message.widget),
        images: signedImagesByMessageId.get(message.id) ?? [],
        has_child_images: childMessageIds.has(message.id),
        ...(generatedImagesByMessageId.has(message.id)
          ? { generatedImage: generatedImagesByMessageId.get(message.id) }
          : {}),
      };
    });

    return NextResponse.json({ messages: normalizedMessages });
  } catch (error) {
    console.error("GET /api/messages unexpected error:", error);
    return jsonError("Unknown server error", 500);
  }
}
