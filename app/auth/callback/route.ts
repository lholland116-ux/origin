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

const NON_PRODUCTION_ENVIRONMENTS = new Set(["development", "test"]);

function isInternalHostname(hostname: string) {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "0.0.0.0" ||
    normalizedHostname === "::" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "0:0:0:0:0:0:0:0" ||
    normalizedHostname === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  const ipv4Octets = normalizedHostname.split(".").map(Number);

  if (
    ipv4Octets.length === 4 &&
    ipv4Octets.every(
      (octet) =>
        Number.isInteger(octet) && octet >= 0 && octet <= 255
    )
  ) {
    const [first, second] = ipv4Octets;

    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }

  return (
    normalizedHostname.endsWith(".local") ||
    normalizedHostname.endsWith(".internal") ||
    normalizedHostname.endsWith(".lan")
  );
}

function getRedirectOrigin(requestOrigin: string) {
  const runtimeEnvironment = process.env.NODE_ENV;
  const isNonProduction = NON_PRODUCTION_ENVIRONMENTS.has(
    runtimeEnvironment ?? ""
  );
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!configuredAppUrl) {
    if (isNonProduction) {
      return requestOrigin;
    }

    throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  }

  let appUrl: URL;

  try {
    appUrl = new URL(configuredAppUrl);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_APP_URL.");
  }

  if (
    (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") ||
    appUrl.username ||
    appUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    (appUrl.pathname !== "/" && appUrl.pathname !== "")
  ) {
    throw new Error("Invalid NEXT_PUBLIC_APP_URL.");
  }

  if (
    !isNonProduction &&
    (appUrl.protocol !== "https:" || isInternalHostname(appUrl.hostname))
  ) {
    throw new Error("NEXT_PUBLIC_APP_URL is not a safe production origin.");
  }

  return appUrl.origin;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"));
  let redirectOrigin: string;

  try {
    redirectOrigin = getRedirectOrigin(requestUrl.origin);
  } catch (error) {
    console.error("Auth callback redirect configuration error:", error);

    return new NextResponse("Auth callback is not configured.", {
      status: 500,
    });
  }

  if (!code) {
    return NextResponse.redirect(new URL(next, redirectOrigin));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback exchange error:", error.message);

    return NextResponse.redirect(
      new URL("/login?auth_error=callback", redirectOrigin)
    );
  }

  return NextResponse.redirect(new URL(next, redirectOrigin));
}
