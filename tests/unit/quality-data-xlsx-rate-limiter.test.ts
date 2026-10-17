import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

import { SupabaseQualityDataXlsxApiRateLimiter } from "../../lib/quality-data/quality-data-xlsx-rate-limiter";

describe("shared quality-data XLSX rate limiter", () => {
  beforeEach(() => rpc.mockReset());

  it("uses the trusted server user and action with the atomic database RPC", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const limiter = new SupabaseQualityDataXlsxApiRateLimiter();
    await expect(limiter.consume("30000000-0000-4000-8000-000000000001", "inspect")).resolves.toBe("allowed");
    expect(rpc).toHaveBeenCalledWith("consume_quality_data_xlsx_api_rate_limit", {
      p_user_id: "30000000-0000-4000-8000-000000000001",
      p_action: "inspect",
    });
  });

  it("distinguishes the rate limit response from unavailable database protection", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: new Error("database unavailable") });
    const limiter = new SupabaseQualityDataXlsxApiRateLimiter();
    await expect(limiter.consume("30000000-0000-4000-8000-000000000001", "ingest")).resolves.toBe("limited");
    await expect(limiter.consume("30000000-0000-4000-8000-000000000001", "ingest")).resolves.toBe("unavailable");
    expect(rpc).toHaveBeenNthCalledWith(1, "consume_quality_data_xlsx_api_rate_limit", {
      p_user_id: "30000000-0000-4000-8000-000000000001", p_action: "ingest",
    });
  });

  it("uses a shared parse lease and releases only its generated lease identity", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: true, error: null });
    const limiter = new SupabaseQualityDataXlsxApiRateLimiter();
    const slot = await limiter.acquireParseSlot("30000000-0000-4000-8000-000000000001");
    expect(slot).not.toBe("busy");
    expect(slot).not.toBe("unavailable");
    if (typeof slot === "string") throw new Error("Expected an acquired shared parse lease.");
    await slot.release();
    expect(rpc).toHaveBeenNthCalledWith(1, "acquire_quality_data_xlsx_api_parse_slot", expect.objectContaining({
      p_user_id: "30000000-0000-4000-8000-000000000001",
    }));
    const acquiredArgs = rpc.mock.calls[0]?.[1] as { p_lease_id?: string } | undefined;
    expect(acquiredArgs?.p_lease_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(rpc).toHaveBeenNthCalledWith(2, "release_quality_data_xlsx_api_parse_slot", { p_lease_id: acquiredArgs?.p_lease_id });
  });

  it("fails closed when the shared parse slot cannot be acquired", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: new Error("database unavailable") });
    const limiter = new SupabaseQualityDataXlsxApiRateLimiter();
    await expect(limiter.acquireParseSlot("30000000-0000-4000-8000-000000000001")).resolves.toBe("busy");
    await expect(limiter.acquireParseSlot("30000000-0000-4000-8000-000000000001")).resolves.toBe("unavailable");
  });
});
