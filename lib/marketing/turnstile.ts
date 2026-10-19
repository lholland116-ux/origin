import { randomUUID } from "node:crypto";

export const CLOUDFLARE_TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const MARKETING_TURNSTILE_ACTION = "marketing_lead_submit";
export const MARKETING_TURNSTILE_HOSTNAME = "lvtchat.com";
export const MARKETING_TURNSTILE_TIMEOUT_MS = 5_000;
const TOKEN_TTL_MS = 5 * 60 * 1_000;
const CLOCK_SKEW_MS = 30_000;

export const CLOUDFLARE_TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA";
export const CLOUDFLARE_TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const TEST_KEYS = new Set([
  CLOUDFLARE_TURNSTILE_TEST_SITEKEY,
  CLOUDFLARE_TURNSTILE_TEST_SECRET,
  "2x00000000000000000000AB",
  "2x0000000000000000000000000000000AA",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
  "3x0000000000000000000000000000000AA",
]);

export type MarketingTurnstileConfig = Readonly<{
  siteKey: string;
  secretKey: string;
  expectedHostname: string;
  expectedAction: string;
}>;

export type TurnstileVerification = "verified" | "invalid" | "unavailable";

function validConfiguredValue(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u0020\u007f]/.test(value);
}

export function getMarketingTurnstileConfig(
  env: NodeJS.ProcessEnv = process.env,
): MarketingTurnstileConfig | null {
  const siteKey = env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  const secretKey = env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!validConfiguredValue(siteKey) || !validConfiguredValue(secretKey)) return null;
  if (env.NODE_ENV === "production" && (TEST_KEYS.has(siteKey) || TEST_KEYS.has(secretKey))) return null;

  return {
    siteKey,
    secretKey,
    expectedHostname: MARKETING_TURNSTILE_HOSTNAME,
    expectedAction: MARKETING_TURNSTILE_ACTION,
  };
}

type SiteverifyResponse = Readonly<{
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  challenge_ts?: unknown;
}>;

export async function verifyMarketingTurnstileToken(
  token: string,
  config: MarketingTurnstileConfig,
  options: Readonly<{
    fetcher?: typeof fetch;
    now?: number;
  }> = {},
): Promise<TurnstileVerification> {
  if (!token || token.length > 2048 || token.trim() !== token) return "invalid";
  if (!validConfiguredValue(config.secretKey)
    || !validConfiguredValue(config.expectedHostname)
    || !validConfiguredValue(config.expectedAction)) return "unavailable";

  const form = new URLSearchParams({
    secret: config.secretKey,
    response: token,
    idempotency_key: randomUUID(),
  });

  try {
    const response = await (options.fetcher ?? fetch)(CLOUDFLARE_TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(MARKETING_TURNSTILE_TIMEOUT_MS),
    });
    if (!response.ok) return "unavailable";

    const result = await response.json() as SiteverifyResponse;
    if (result.success !== true) return "invalid";
    if (typeof result.hostname !== "string"
      || result.hostname.toLowerCase() !== config.expectedHostname.toLowerCase()
      || result.action !== config.expectedAction) return "invalid";
    if (typeof result.challenge_ts !== "string") return "invalid";

    const challengeTime = Date.parse(result.challenge_ts);
    if (!Number.isFinite(challengeTime)) return "invalid";
    const now = options.now ?? Date.now();
    if (challengeTime > now + CLOCK_SKEW_MS || now - challengeTime > TOKEN_TTL_MS) return "invalid";
    return "verified";
  } catch {
    return "unavailable";
  }
}
