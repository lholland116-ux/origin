import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const RAW_DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT ?? 20);
const DAILY_LIMIT = Number.isFinite(RAW_DAILY_LIMIT) ? RAW_DAILY_LIMIT : 20;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("usage")
      .select("message_count")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle();

    if (error) {
      console.error("GET /api/usage error:", error);
      return jsonError("Failed to load usage.", 500);
    }

    const used = data?.message_count ?? 0;
    const limit = DAILY_LIMIT;

    return NextResponse.json({
      used,
      limit,
      remaining: Math.max(limit - used, 0),
    });
  } catch (error) {
    console.error("/api/usage unexpected error:", error);
    return jsonError("Something went wrong in /api/usage.", 500);
  }
}