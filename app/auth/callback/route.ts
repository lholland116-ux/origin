import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/branding";

function sanitizeNextPath(nextPath: string | null) {
  if (!nextPath || !nextPath.startsWith("/")) {
    return BRAND.routes.app;
  }

  if (nextPath.startsWith("//")) {
    return BRAND.routes.app;
  }

  return nextPath;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL(next, requestUrl.origin));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback exchange error:", error.message);

    return NextResponse.redirect(
      new URL("/login?auth_error=callback", requestUrl.origin)
    );
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}