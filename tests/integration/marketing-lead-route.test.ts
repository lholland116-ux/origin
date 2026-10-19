import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "../../app/api/marketing/leads/route";

const validPayload = {
  idempotency_key: "21000000-0000-4000-8000-000000000001",
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

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://lvtchat.com/api/marketing/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.42", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/marketing/leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = ["synthetic", "test", "key"].join("-");
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: "created", error: null });
  });

  it("validates, rate-limits, and persists through the server-only RPC without returning lead details", async () => {
    const response = await POST(request(validPayload));
    expect(response.status).toBe(201);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ status: "received" });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const [functionName, arguments_] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(functionName).toBe("submit_marketing_lead");
    expect(arguments_).toMatchObject({
      p_business_email: "avery@example.test",
      p_interest_type: "demo",
      p_marketing_consent: false,
      p_source: "workflow_automation",
    });
    expect(String(arguments_?.p_ip_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(arguments_?.p_email_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(responseBody)).not.toContain("Avery");
    expect(JSON.stringify(responseBody)).not.toContain("example.test");
  });

  it("returns the same receipt for an idempotent replay and never logs or returns database text", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "duplicate", error: null });
    const response = await POST(request(validPayload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "received" });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "PII-bearing database detail" } });
    const failed = await POST(request({ ...validPayload, idempotency_key: "21000000-0000-4000-8000-000000000002" }));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "submission_unavailable" });
  });

  it("rejects invalid payloads and malformed or oversized bodies before persistence", async () => {
    const invalid = await POST(request({ ...validPayload, workflow_problem: "x" }));
    expect(invalid.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const malformed = await POST(request("not json"));
    expect(malformed.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const oversized = await POST(request(validPayload, { "content-length": "999999" }));
    expect(oversized.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed without a trusted client IP, while a honeypot hit receives no persistence", async () => {
    const missingIp = await POST(request(validPayload, { "x-real-ip": "" }));
    expect(missingIp.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const spam = await POST(request({ ...validPayload, website: "https://spam.example" }));
    expect(spam.status).toBe(202);
    expect(await spam.json()).toEqual({ status: "received" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps shared rate limiting and idempotency conflicts to safe responses", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "rate_limited", error: null });
    const limited = await POST(request(validPayload));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });

    mocks.rpc.mockResolvedValueOnce({ data: "conflict", error: null });
    const conflict = await POST(request({ ...validPayload, idempotency_key: "21000000-0000-4000-8000-000000000003" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "submission_conflict" });
  });
});
