import { describe, expect, it, vi } from "vitest";
import { captureMarketingLead, type MarketingLeadRpcArguments } from "../../lib/marketing/lead-capture-service";

const base = {
  idempotency_key: "21000000-0000-4000-8000-000000000001",
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
  it("normalizes and bounds lead input and submits only keyed fingerprints for abuse controls", async () => {
    const persist = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    const result = await captureMarketingLead(base, "198.51.100.42", "server-only-key", persist);
    expect(result).toEqual({ status: "created" });
    const args = persist.mock.calls[0]?.[0];
    expect(args?.p_business_email).toBe("avery@example.test");
    expect(args?.p_marketing_consent).toBe(false);
    expect(args?.p_utm_campaign).toBe("workflow_overview");
    expect(args?.p_ip_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(args?.p_email_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain("198.51.100.42");
    expect(JSON.stringify(args)).not.toContain("server-only-key");
  });

  it("uses stable fingerprints for the same keys and separates IP and email scopes", async () => {
    const first = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    const second = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    await captureMarketingLead(base, "198.51.100.42", "server-only-key", first);
    await captureMarketingLead(base, "198.51.100.42", "server-only-key", second);
    const firstArgs = first.mock.calls[0]?.[0];
    const secondArgs = second.mock.calls[0]?.[0];
    expect(firstArgs?.p_ip_fingerprint).toBe(secondArgs?.p_ip_fingerprint);
    expect(firstArgs?.p_email_fingerprint).toBe(secondArgs?.p_email_fingerprint);
    expect(firstArgs?.p_ip_fingerprint).not.toBe(firstArgs?.p_email_fingerprint);
  });

  it("does not persist honeypot hits or malformed/oversized submissions", async () => {
    const persist = vi.fn(async (arguments_: MarketingLeadRpcArguments) => { void arguments_; return "created"; });
    expect(await captureMarketingLead({ ...base, website: "bot" }, "198.51.100.42", "key", persist)).toEqual({ status: "spam" });
    expect(await captureMarketingLead({ ...base, workflow_problem: "x" }, "198.51.100.42", "key", persist)).toEqual({ status: "invalid" });
    expect(await captureMarketingLead({ ...base, current_process_tools: "x".repeat(1201) }, "198.51.100.42", "key", persist)).toEqual({ status: "invalid" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("maps persistence uncertainty to a safe result and preserves safe status codes", async () => {
    const down = await captureMarketingLead(base, "198.51.100.42", "key", async () => { throw new Error("sensitive backend details"); });
    expect(down).toEqual({ status: "unavailable" });
    const duplicate = await captureMarketingLead(base, "198.51.100.42", "key", async () => "duplicate");
    expect(duplicate).toEqual({ status: "duplicate" });
  });
});
