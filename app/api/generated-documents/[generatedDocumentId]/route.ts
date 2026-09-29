import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  deleteGeneratedDocumentMetadata,
  findGeneratedDocumentById,
  removeGeneratedDocumentObject,
} from "@/lib/documents/generated-document-server";
import { validateGeneratedDocumentStoragePath } from "@/lib/documents/generated-document-storage";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  readonly params: Promise<{ readonly generatedDocumentId: string }>;
};

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
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

    if (authError || !user) return errorResponse(401, "Authentication is required.");
    userId = user.id;
  } catch {
    return errorResponse(500, "The generated document could not be deleted.");
  }

  let generatedDocumentId: string;
  try {
    generatedDocumentId = (await context.params).generatedDocumentId;
  } catch {
    return errorResponse(400, "The generated document identifier is invalid.");
  }

  if (!isValidUuid(generatedDocumentId)) {
    return errorResponse(400, "The generated document identifier is invalid.");
  }

  let record;
  try {
    record = await findGeneratedDocumentById({ userId, generatedDocumentId });
  } catch {
    return errorResponse(500, "The generated document could not be deleted.");
  }

  if (!record || record.userId !== userId) {
    return errorResponse(404, "Generated document not found.");
  }

  if (!validateGeneratedDocumentStoragePath(record.storagePath, {
    userId,
    conversationId: record.conversationId,
    generatedDocumentId: record.id,
    filename: record.filename,
    format: record.format,
  })) {
    return errorResponse(404, "Generated document not found.");
  }

  try {
    const { data: message, error } = await supabase
      .from("messages")
      .select("id")
      .eq("id", record.messageId)
      .eq("conversation_id", record.conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return errorResponse(500, "The generated document could not be deleted.");
    if (!message) return errorResponse(404, "Generated document not found.");
  } catch {
    return errorResponse(500, "The generated document could not be deleted.");
  }

  try {
    await removeGeneratedDocumentObject({ record });
  } catch {
    return errorResponse(502, "The generated document could not be deleted.");
  }

  try {
    const deleted = await deleteGeneratedDocumentMetadata(record);
    if (!deleted) {
      console.error("DELETE generated document metadata row was not deleted", {
        generatedDocumentId,
        conversationId: record.conversationId,
      });
      return errorResponse(500, "The generated document could not be deleted.");
    }
  } catch {
    console.error("DELETE generated document metadata deletion failed", {
      generatedDocumentId,
      conversationId: record.conversationId,
    });
    return errorResponse(500, "The generated document could not be deleted.");
  }

  return NextResponse.json(
    { ok: true, generatedDocumentId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
