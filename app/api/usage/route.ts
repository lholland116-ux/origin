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

const FREE_IMAGE_DAILY_LIMIT = 2;
const FREE_IMAGE_MONTHLY_LIMIT = 10;
const PRO_IMAGE_DAILY_LIMIT = 20;
const PRO_IMAGE_MONTHLY_LIMIT = 200;

type Plan = "free" | "pro";

type ProfileRow = {
  plan: string | null;
};

type ImageGenerationAttemptRow = {
  status: string | null;
  expires_at: string | null;
  completed_at: string | null;
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

function normalizePlan(plan: string | null | undefined): Plan | null {
  if (plan === "free" || plan === "pro") {
    return plan;
  }

  return null;
}

function getDailyLimit(plan: Plan): number {
  return plan === "pro" ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
}

function getImageLimits(plan: Plan): {
  daily: number;
  monthly: number;
} {
  return plan === "pro"
    ? { daily: PRO_IMAGE_DAILY_LIMIT, monthly: PRO_IMAGE_MONTHLY_LIMIT }
    : { daily: FREE_IMAGE_DAILY_LIMIT, monthly: FREE_IMAGE_MONTHLY_LIMIT };
}

function getUtcWindowStarts(now: Date): {
  dayStart: number;
  monthStart: number;
} {
  return {
    dayStart: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    monthStart: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  };
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
    if (!plan) {
      return jsonError("Failed to load profile.", 500);
    }

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

    const { data: imageAttemptRows, error: imageAttemptError } = await supabase
      .from("image_generation_attempts")
      .select("status, expires_at, completed_at")
      .eq("user_id", user.id);

    if (imageAttemptError) {
      console.error("GET /api/usage image-generation attempts error:", imageAttemptError);
      return jsonError("Failed to load image usage.", 500);
    }

    const now = new Date();
    const nowMs = now.getTime();
    const { dayStart, monthStart } = getUtcWindowStarts(now);
    let dailyImageUsed = 0;
    let dailyImageReserved = 0;
    let monthlyImageUsed = 0;
    let monthlyImageReserved = 0;

    for (const row of (imageAttemptRows ?? []) as ImageGenerationAttemptRow[]) {
      if (row.status === "succeeded" && row.completed_at) {
        const completedAtMs = Date.parse(row.completed_at);
        if (Number.isFinite(completedAtMs)) {
          if (completedAtMs >= dayStart) dailyImageUsed += 1;
          if (completedAtMs >= monthStart) monthlyImageUsed += 1;
        }
      }

      if (row.status === "reserved" && row.expires_at) {
        const expiresAtMs = Date.parse(row.expires_at);
        if (Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) {
          dailyImageReserved += 1;
          monthlyImageReserved += 1;
        }
      }
    }

    const imageLimits = getImageLimits(plan);

    return NextResponse.json(
      {
        used,
        limit,
        remaining,
        plan,
        imageGeneration: {
          plan,
          daily: {
            used: dailyImageUsed,
            reserved: dailyImageReserved,
            limit: imageLimits.daily,
            remaining: Math.max(
              imageLimits.daily - dailyImageUsed - dailyImageReserved,
              0,
            ),
          },
          monthly: {
            used: monthlyImageUsed,
            reserved: monthlyImageReserved,
            limit: imageLimits.monthly,
            remaining: Math.max(
              imageLimits.monthly - monthlyImageUsed - monthlyImageReserved,
              0,
            ),
          },
        },
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
