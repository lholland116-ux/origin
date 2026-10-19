import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  CLOUDFLARE_TURNSTILE_TEST_SECRET,
  CLOUDFLARE_TURNSTILE_TEST_SITEKEY,
  MARKETING_TURNSTILE_ACTION,
} from "../../lib/marketing/turnstile";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "../../app/api/marketing/leads/route";

const validPayload = {
  idempotency_key: "21000000-0000-4000-8000-000000000001",
  turnstile_token: "XXXX.DUMMY.TOKEN.XXXX",
  name: "Avery Example",
  business_email: "AVERY@example.test",
  company: "Example Medical",
  role: "Quality Engineer",
  workflow_problem: "We want to organize a manual inspection review workflow.",
  interest_type: "demo",
  current_process_tools: "Spreadsheet and document review",
  marketing_consent: false,
  source: "workflow_automation",
  utm_source: "owned_site",
  utm_medium: "web",
  utm_campaign: "workflow_overview",
  website: "",
};

const successResponse = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  success: true,
  hostname: "lvtchat.com",
  action: MARKETING_TURNSTILE_ACTION,
  challenge_ts: new Date().toISOString(),
  ...overrides,
}), { status: 200, headers: { "content-type": "application/json" } });

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://lvtchat.com/api/marketing/leads", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/marketing/leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = ["synthetic", "test", "key"].join("-");
    vi.stubEnv("NODE_ENV", "test");
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY = CLOUDFLARE_TURNSTILE_TEST_SITEKEY;
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = CLOUDFLARE_TURNSTILE_TEST_SECRET;
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: "created", error: null });
    vi.stubGlobal("fetch", vi.fn(async () => successResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("validates Turnstile server-side and persists without IP-derived arguments or returning lead details", async () => {
    const response = await POST(request(validPayload));
    expect(response.status).toBe(201);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ status: "received" });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const verifyBody = new URLSearchParams(String(init.body));
    expect(verifyBody.get("secret")).toBe(CLOUDFLARE_TURNSTILE_TEST_SECRET);
    expect(verifyBody.get("response")).toBe(validPayload.turnstile_token);
    expect(verifyBody.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(verifyBody.has("remoteip")).toBe(false);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");

    expect(mocks.rpc).toHaveBeenCalledOnce();
    const [functionName, arguments_] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(functionName).toBe("submit_marketing_lead");
    expect(arguments_).toMatchObject({
      p_business_email: "avery@example.test",
      p_interest_type: "demo",
      p_marketing_consent: false,
      p_source: "workflow_automation",
    });
    expect(arguments_).not.toHaveProperty("p_ip_fingerprint");
    expect(JSON.stringify(responseBody)).not.toContain("Avery");
    expect(JSON.stringify(responseBody)).not.toContain("example.test");
  });

  it("does not trust any client forwarding header and does not send an IP to Siteverify", async () => {
    const response = await POST(request(validPayload, {
      "x-real-ip": "203.0.113.77",
      "x-forwarded-for": "198.51.100.99, 192.0.2.8",
      forwarded: "for=192.0.2.40;proto=https;by=198.51.100.10",
      "x-client-ip": "198.51.100.55",
    }));
    expect(response.status).toBe(201);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(String(init.body)).has("remoteip")).toBe(false);
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_ip_fingerprint");
  });

  it("returns the same receipt for an idempotent retry with a fresh single-use token", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "created", error: null });
    mocks.rpc.mockResolvedValueOnce({ data: "duplicate", error: null });
    const first = await POST(request(validPayload));
    const second = await POST(request({ ...validPayload, turnstile_token: "FRESH.DUMMY.TOKEN.XXXX" }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "received" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstArgs = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    const secondArgs = mocks.rpc.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(secondArgs.p_idempotency_key).toBe(firstArgs.p_idempotency_key);
    expect(secondArgs.p_request_fingerprint).toBe(firstArgs.p_request_fingerprint);
    expect(secondArgs.p_email_fingerprint).toBe(firstArgs.p_email_fingerprint);
  });

  it("rejects invalid, expired, and replayed tokens before the database RPC", async () => {
    const responses = [
      { success: false, "error-codes": ["invalid-input-response"] },
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      { success: true, hostname: "lvtchat.com", action: MARKETING_TURNSTILE_ACTION, challenge_ts: "2000-01-01T00:00:00.000Z" },
      { success: true, hostname: "lvtchat.com", action: MARKETING_TURNSTILE_ACTION, challenge_ts: "not-a-timestamp" },
    ];
    for (const body of responses) {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
      const response = await POST(request({ ...validPayload, idempotency_key: crypto.randomUUID() }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "verification_failed" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects hostname, action, and future-timestamp mismatches", async () => {
    for (const body of [
      { hostname: "attacker.example" },
      { action: "other_action" },
      { challenge_ts: new Date(Date.now() + 60_000).toISOString() },
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(successResponse(body));
      const response = await POST(request({ ...validPayload, idempotency_key: crypto.randomUUID() }));
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when required configuration is missing, malformed, or contains official test keys in production", async () => {
    const configured = {
      site: process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY,
      secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    for (const variable of [
      "NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY",
      "CLOUDFLARE_TURNSTILE_SECRET_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]) {
      delete process.env[variable];
      const missing = await POST(request(validPayload));
      expect(missing.status).toBe(503);
      expect(await missing.json()).toEqual({ error: "submission_unavailable" });
      process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY = configured.site;
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = configured.secret;
      process.env.NEXT_PUBLIC_SUPABASE_URL = configured.url;
      process.env.SUPABASE_SERVICE_ROLE_KEY = configured.serviceKey;
    }

    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = " invalid-with-whitespace ";
    const malformedSecret = await POST(request(validPayload));
    expect(malformedSecret.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();

    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = CLOUDFLARE_TURNSTILE_TEST_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    const testKeyInProduction = await POST(request(validPayload));
    expect(testKeyInProduction.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed on Siteverify timeout or unavailability without logging provider details", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("private network detail", "TimeoutError"));
    const timeout = await POST(request(validPayload));
    expect(timeout.status).toBe(503);
    expect(await timeout.json()).toEqual({ error: "submission_unavailable" });

    vi.mocked(fetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const unavailable = await POST(request({ ...validPayload, idempotency_key: crypto.randomUUID() }));
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("private network detail");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads and malformed or oversized bodies before verification", async () => {
    const invalid = await POST(request({ ...validPayload, workflow_problem: "x" }));
    expect(invalid.status).toBe(400);
    const malformed = await POST(request("not json"));
    expect(malformed.status).toBe(400);
    const oversized = await POST(request(validPayload, { "content-length": "999999" }));
    expect(oversized.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the honeypot non-persistent after valid verification and preserves optional consent", async () => {
    const spam = await POST(request({ ...validPayload, website: "https://spam.example" }));
    expect(spam.status).toBe(202);
    expect(await spam.json()).toEqual({ status: "received" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();

    const consentResponse = await POST(request({ ...validPayload, idempotency_key: crypto.randomUUID(), marketing_consent: true }));
    expect(consentResponse.status).toBe(201);
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({ p_marketing_consent: true });
  });

  it("maps database rate limits, idempotency conflicts, and failures to sanitized responses", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "rate_limited", error: null });
    expect((await POST(request(validPayload))).status).toBe(429);
    mocks.rpc.mockResolvedValueOnce({ data: "conflict", error: null });
    expect((await POST(request({ ...validPayload, idempotency_key: crypto.randomUUID() }))).status).toBe(409);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "PII-bearing database detail" } });
    const failure = await POST(request({ ...validPayload, idempotency_key: crypto.randomUUID() }));
    expect(failure.status).toBe(503);
    expect(JSON.stringify(await failure.json())).not.toContain("PII-bearing");
  });
});
