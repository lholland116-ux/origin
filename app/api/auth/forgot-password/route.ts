import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ForgotPasswordBody = {
  email?: string;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAppUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isValidAbsoluteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function successResponse() {
  return NextResponse.json(
    {
      message:
        "If an account exists for that email, a password reset link has been sent.",
    },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  try {
    let body: ForgotPasswordBody;

    try {
      body = (await request.json()) as ForgotPasswordBody;
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const email = body.email?.trim().toLowerCase() ?? "";

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const appUrl = normalizeAppUrl(rawAppUrl);

    if (!appUrl || !isValidAbsoluteUrl(appUrl)) {
      console.error(
        "Forgot password config error: invalid NEXT_PUBLIC_APP_URL",
        rawAppUrl
      );
      return successResponse();
    }

    const redirectTo = `${appUrl}/auth/callback?next=/reset-password`;

    console.log("Forgot password redirectTo:", redirectTo);

    const supabase = await createServerSupabaseClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      console.error("resetPasswordForEmail error:", error.message);
    }

    return successResponse();
  } catch (error) {
    console.error("Forgot password route unexpected error:", error);
    return successResponse();
  }
}