import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_TITLE_LENGTH = 120;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeTitle(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("GET /api/conversations error:", error);
      return jsonError("Failed to load conversations.", 500);
    }

    return NextResponse.json({ conversations: data ?? [] });
  } catch (error) {
    console.error("GET /api/conversations unexpected error:", error);
    return jsonError("Unknown server error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    let body: unknown = null;

    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const title = normalizeTitle((body as { title?: unknown } | null)?.title);
    const finalTitle = title ? title.slice(0, MAX_TITLE_LENGTH) : "New Chat";

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        title: finalTitle,
        user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .select("id, title, updated_at")
      .single();

    if (error) {
      console.error("POST /api/conversations error:", error);
      return jsonError("Failed to create conversation.", 500);
    }

    return NextResponse.json({ conversation: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/conversations unexpected error:", error);
    return jsonError("Invalid request body.", 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid request body.", 400);
    }

    const id =
      typeof (body as { id?: unknown }).id === "string"
        ? (body as { id: string }).id.trim()
        : "";

    const title = normalizeTitle((body as { title?: unknown }).title);

    if (!id || !title) {
      return jsonError("Conversation id and title are required.", 400);
    }

    const finalTitle = title.slice(0, MAX_TITLE_LENGTH);

    const { data, error } = await supabase
      .from("conversations")
      .update({
        title: finalTitle,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, title, updated_at")
      .single();

    if (error) {
      console.error("PATCH /api/conversations error:", error);
      return jsonError("Failed to rename conversation.", 500);
    }

    return NextResponse.json({ conversation: data });
  } catch (error) {
    console.error("PATCH /api/conversations unexpected error:", error);
    return jsonError("Invalid request body.", 400);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";

    if (!id) {
      return jsonError("Conversation id is required.", 400);
    }

    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("DELETE /api/conversations error:", error);
      return jsonError("Failed to delete conversation.", 500);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/conversations unexpected error:", error);
    return jsonError("Unknown server error", 500);
  }
}