import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  downloadGeneratedDocument,
  findGeneratedDocumentById,
} from "@/lib/documents/generated-document-server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  readonly params: Promise<{ readonly generatedDocumentId: string }>;
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
    return errorResponse(500, "The generated document could not be downloaded.");
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
    return errorResponse(500, "The generated document could not be downloaded.");
  }

  if (!record || record.userId !== userId) {
    return errorResponse(404, "Generated document not found.");
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadGeneratedDocument(record);
  } catch {
    return errorResponse(502, "The generated document could not be downloaded.");
  }

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": "attachment; filename=\"" + record.filename + "\"",
      "Content-Type": record.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
