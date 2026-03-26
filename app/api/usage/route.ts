import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT ?? 20);

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json(
        { error: "Failed to load usage." },
        { status: 500 }
      );
    }

    const used = data?.message_count ?? 0;
    const limit = Number.isFinite(DAILY_LIMIT) ? DAILY_LIMIT : 20;

    return NextResponse.json({
      used,
      limit,
      remaining: Math.max(limit - used, 0),
    });
  } catch (error) {
    console.error("/api/usage unexpected error:", error);
    return NextResponse.json(
      { error: "Something went wrong in /api/usage." },
      { status: 500 }
    );
  }
}