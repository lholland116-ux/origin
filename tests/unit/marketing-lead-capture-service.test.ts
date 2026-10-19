import { describe, expect, it, vi } from "vitest";
import { captureMarketingLead, type MarketingLeadRpcArguments } from "../../lib/marketing/lead-capture-service";
import { CLOUDFLARE_TURNSTILE_TEST_SECRET } from "../../lib/marketing/turnstile";

const base = {
  idempotency_key: "21000000-0000-4000-8000-000000000001",
  turnstile_token: "XXXX.DUMMY.TOKEN.XXXX",
  name: "Avery Example",
  business_email: "AVERY@EXAMPLE.TEST",
  company: "Example Medical",
  role: "Quality Engineer",
  workflow_problem: "We want to organize a manual inspection review workflow.",
  interest_type: "demo",
  current_process_tools: "",
  marketing_consent: false,
  source: "workflow_automation",
  utm_source: "owned_site",
  utm_medium: "web",
  utm_campaign: "workflow_overview",
  website: "",
};

describe("marketing lead capture service", () => {
  const verified = vi.fn(async (token: string) => token ? "verified" as const : "invalid" as const);

  it("validates Turnstile before normalizing and persisting only an email fingerprint", async () => {
    const persist = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    const result = await captureMarketingLead(base, CLOUDFLARE_TURNSTILE_TEST_SECRET, verified, persist);
    expect(result).toEqual({ status: "created" });
    expect(verified).toHaveBeenCalledWith(base.turnstile_token);
    const args = persist.mock.calls[0]?.[0];
    expect(args?.p_business_email).toBe("avery@example.test");
    expect(args?.p_marketing_consent).toBe(false);
    expect(args?.p_utm_campaign).toBe("workflow_overview");
    expect(args?.p_email_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(args).not.toHaveProperty("p_ip_fingerprint");
    expect(JSON.stringify(args)).not.toContain(base.turnstile_token);
    expect(JSON.stringify(args)).not.toContain(CLOUDFLARE_TURNSTILE_TEST_SECRET);
  });

  it("uses a stable opaque email fingerprint across retries with fresh single-use tokens", async () => {
    const first = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    const second = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    await captureMarketingLead(base, CLOUDFLARE_TURNSTILE_TEST_SECRET, verified, first);
    await captureMarketingLead({ ...base, turnstile_token: "fresh.DUMMY.TOKEN.XXXX" }, CLOUDFLARE_TURNSTILE_TEST_SECRET, verified, second);
    const firstArgs = first.mock.calls[0]?.[0];
    const secondArgs = second.mock.calls[0]?.[0];
    expect(firstArgs?.p_email_fingerprint).toBe(secondArgs?.p_email_fingerprint);
    expect(firstArgs?.p_request_fingerprint).toBe(secondArgs?.p_request_fingerprint);
    expect(firstArgs?.p_idempotency_key).toBe(secondArgs?.p_idempotency_key);
  });

  it("does not persist honeypot hits or malformed/oversized submissions", async () => {
    const persist = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    expect(await captureMarketingLead({ ...base, website: "bot" }, "key", verified, persist)).toEqual({ status: "spam" });
    expect(await captureMarketingLead({ ...base, workflow_problem: "x" }, "key", verified, persist)).toEqual({ status: "invalid" });
    expect(await captureMarketingLead({ ...base, current_process_tools: "x".repeat(1201) }, "key", verified, persist)).toEqual({ status: "invalid" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("fails closed on invalid, replayed, and unavailable Turnstile validation", async () => {
    const persist = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    const verify = vi.fn(async () => "verified" as const);
    expect(await captureMarketingLead({ ...base, turnstile_token: " padded " }, "key", verify, persist)).toEqual({ status: "invalid" });
    expect(verify).not.toHaveBeenCalled();
    expect(await captureMarketingLead(base, "key", async () => "invalid", persist)).toEqual({ status: "verification_failed" });
    expect(await captureMarketingLead(base, "key", async () => "unavailable", persist)).toEqual({ status: "unavailable" });
    expect(await captureMarketingLead(base, "", verified, persist)).toEqual({ status: "unavailable" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("maps persistence uncertainty to a safe result and preserves safe status codes", async () => {
    const down = await captureMarketingLead(base, "key", verified, async () => { throw new Error("sensitive backend details"); });
    expect(down).toEqual({ status: "unavailable" });
    const duplicate = await captureMarketingLead(base, "key", verified, async () => "duplicate");
    expect(duplicate).toEqual({ status: "duplicate" });
  });
});
