import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_TURNSTILE_TEST_SECRET,
  CLOUDFLARE_TURNSTILE_TEST_SITEKEY,
  MARKETING_TURNSTILE_ACTION,
  MARKETING_TURNSTILE_HOSTNAME,
  MARKETING_TURNSTILE_TIMEOUT_MS,
  getMarketingTurnstileConfig,
  verifyMarketingTurnstileToken,
} from "../../lib/marketing/turnstile";

const now = Date.parse("2026-10-19T12:00:00.000Z");
const config = {
  siteKey: CLOUDFLARE_TURNSTILE_TEST_SITEKEY,
  secretKey: CLOUDFLARE_TURNSTILE_TEST_SECRET,
  expectedHostname: MARKETING_TURNSTILE_HOSTNAME,
  expectedAction: MARKETING_TURNSTILE_ACTION,
};

function siteverify(overrides: Record<string, unknown> = {}): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({
    success: true,
    hostname: MARKETING_TURNSTILE_HOSTNAME,
    action: MARKETING_TURNSTILE_ACTION,
    challenge_ts: new Date(now).toISOString(),
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("marketing Turnstile verification", () => {
  it("requires both keys and rejects official test keys in production", () => {
    expect(getMarketingTurnstileConfig({ NODE_ENV: "test" })).toBeNull();
    expect(getMarketingTurnstileConfig({
      NODE_ENV: "test",
      NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: CLOUDFLARE_TURNSTILE_TEST_SITEKEY,
      CLOUDFLARE_TURNSTILE_SECRET_KEY: CLOUDFLARE_TURNSTILE_TEST_SECRET,
    })).toMatchObject({ expectedHostname: "lvtchat.com", expectedAction: "marketing_lead_submit" });
    expect(getMarketingTurnstileConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: CLOUDFLARE_TURNSTILE_TEST_SITEKEY,
      CLOUDFLARE_TURNSTILE_SECRET_KEY: "production-secret",
    })).toBeNull();
    expect(getMarketingTurnstileConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: "production-site-key",
      CLOUDFLARE_TURNSTILE_SECRET_KEY: CLOUDFLARE_TURNSTILE_TEST_SECRET,
    })).toBeNull();
  });

  it("accepts a recent successful token and rejects missing, expired, future, or malformed timestamps", async () => {
    const valid = siteverify();
    await expect(verifyMarketingTurnstileToken("synthetic-token", config, { fetcher: valid, now })).resolves.toBe("verified");

    for (const challengeTime of [
      new Date(now - 5 * 60_000 - 1).toISOString(),
      new Date(now + 30_001).toISOString(),
      "not-a-timestamp",
      undefined,
    ]) {
      const fetcher = siteverify({ challenge_ts: challengeTime });
      await expect(verifyMarketingTurnstileToken("synthetic-token", config, { fetcher, now })).resolves.toBe("invalid");
    }
  });

  it("requires the exact verified hostname and action and Siteverify success", async () => {
    for (const response of [
      { hostname: "attacker.example" },
      { action: "other_action" },
      { success: false },
    ]) {
      await expect(verifyMarketingTurnstileToken("synthetic-token", config, {
        fetcher: siteverify(response), now,
      })).resolves.toBe("invalid");
    }
  });

  it("treats Siteverify transport and malformed-response failures as unavailable", async () => {
    await expect(verifyMarketingTurnstileToken("synthetic-token", config, {
      fetcher: vi.fn(async () => { throw new Error("synthetic transport error"); }), now,
    })).resolves.toBe("unavailable");
    await expect(verifyMarketingTurnstileToken("synthetic-token", config, {
      fetcher: vi.fn(async () => new Response("not-json", { status: 200 })), now,
    })).resolves.toBe("unavailable");
    expect(MARKETING_TURNSTILE_TIMEOUT_MS).toBe(5_000);
  });

  it("rejects malformed tokens before contacting Siteverify", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(verifyMarketingTurnstileToken(" padded ", config, { fetcher, now })).resolves.toBe("invalid");
    await expect(verifyMarketingTurnstileToken("x".repeat(2049), config, { fetcher, now })).resolves.toBe("invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
