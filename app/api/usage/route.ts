import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DAILY_LIMIT = 20;

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
      return NextResponse.json(
        { error: "Failed to load usage." },
        { status: 500 }
      );
    }

    const used = data?.message_count ?? 0;

    return NextResponse.json({
      used,
      limit: DAILY_LIMIT,
      remaining: Math.max(DAILY_LIMIT - used, 0),
    });
  } catch (error) {
    console.error("/api/usage error:", error);
    return NextResponse.json(
      { error: "Something went wrong in /api/usage." },
      { status: 500 }
    );
  }
}