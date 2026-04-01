import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_CONVERSATION_ID_LENGTH = 200;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeConversationId(input: string | null): string {
  return typeof input === "string" ? input.trim() : "";
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
      .select("id, role, content, created_at, image_path, image_name")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("GET /api/messages error:", error);
      return jsonError("Failed to load messages.", 500);
    }

    return NextResponse.json({ messages: data ?? [] });
  } catch (error) {
    console.error("GET /api/messages unexpected error:", error);
    return jsonError("Unknown server error", 500);
  }
}