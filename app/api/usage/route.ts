import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAW_FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_MESSAGE_LIMIT ?? 20);
const RAW_PRO_DAILY_LIMIT = Number(process.env.PRO_DAILY_MESSAGE_LIMIT ?? 300);

const FREE_DAILY_LIMIT = Number.isFinite(RAW_FREE_DAILY_LIMIT)
  ? RAW_FREE_DAILY_LIMIT
  : 20;

const PRO_DAILY_LIMIT = Number.isFinite(RAW_PRO_DAILY_LIMIT)
  ? RAW_PRO_DAILY_LIMIT
  : 300;

type Plan = "free" | "pro";

type ProfileRow = {
  plan: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function normalizePlan(plan: string | null | undefined): Plan {
  return plan === "pro" ? "pro" : "free";
}

function getDailyLimit(plan: Plan): number {
  return plan === "pro" ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    if (profileError) {
      console.error("GET /api/usage profile error:", profileError);
      return jsonError("Failed to load profile.", 500);
    }

    const plan = normalizePlan(profile?.plan);
    const limit = getDailyLimit(plan);

    const today = new Date().toISOString().slice(0, 10);

    const { data: usageRow, error: usageError } = await supabase
      .from("usage")
      .select("message_count")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle();

    if (usageError) {
      console.error("GET /api/usage usage error:", usageError);
      return jsonError("Failed to load usage.", 500);
    }

    const used = usageRow?.message_count ?? 0;
    const remaining = Math.max(limit - used, 0);

    return NextResponse.json(
      {
        used,
        limit,
        remaining,
        plan,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("/api/usage unexpected error:", error);
    return jsonError("Something went wrong in /api/usage.", 500);
  }
}