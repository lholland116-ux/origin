import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_CONVERSATION_ID_LENGTH = 200;

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

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  image_path: string | null;
  image_name: string | null;
  documents: unknown;
};

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
        "id, role, content, created_at, image_path, image_name, documents"
      )
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("GET /api/messages error:", error);
      return jsonError("Failed to load messages.", 500);
    }

    const normalizedMessages = ((data ?? []) as MessageRow[]).map((message) => ({
      ...message,
      documents: normalizeStoredDocuments(message.documents),
    }));

    return NextResponse.json({ messages: normalizedMessages });
  } catch (error) {
    console.error("GET /api/messages unexpected error:", error);
    return jsonError("Unknown server error", 500);
  }
}