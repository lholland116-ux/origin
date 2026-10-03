import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(), from: vi.fn(), select: vi.fn(), gte: vi.fn(), lt: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn(), delete: vi.fn(), in: vi.fn(),
  highWater: { data: [] as Array<{ id: number; occurred_at: string }>, error: null as unknown },
  analyticsPages: [] as Array<{ data: unknown[] | null; error: unknown }>,
  retentionSelection: { data: [] as Array<{ id: number }>, error: null as unknown }, deletion: { error: null as unknown }, selectedColumns: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { AI_TELEMETRY_DEFAULT_RETENTION_BATCH_SIZE, AI_TELEMETRY_MAX_ANALYTICS_ROWS, AiTelemetryOperationsError, deleteExpiredAiTelemetry, getAiTelemetrySummary } from "@/lib/ai/telemetry-operations";

const FIRST = "2026-01-01T00:00:00.000Z";
const SECOND = "2026-01-01T00:00:01.000Z";

function telemetryRow(id: number, occurredAt = FIRST) {
  return { id, occurred_at: occurredAt, route: "standard", attempt_kind: "primary", model: "model-a", reasoning_effort: "medium", plan: "free", outcome: "success", latency_ms: 1, had_image: false, input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null };
}

function configure() {
  const builder = {} as Record<string, ReturnType<typeof vi.fn> | ((...args: unknown[]) => Promise<unknown>)>;
  let selection: "high_water" | "analytics" | "retention" | null = null;
  builder.select = mocks.select.mockImplementation((columns: string) => {
    mocks.selectedColumns.push(columns);
    selection = columns === "id,occurred_at" ? "high_water" : columns === "id" ? "retention" : "analytics";
    return builder;
  });
  builder.gte = mocks.gte.mockReturnValue(builder);
  builder.lt = mocks.lt.mockReturnValue(builder);
  builder.or = mocks.or.mockReturnValue(builder);
  builder.order = mocks.order.mockReturnValue(builder);
  builder.limit = mocks.limit.mockImplementation(async () => {
    if (selection === "high_water") return mocks.highWater;
    if (selection === "retention") return mocks.retentionSelection;
    return mocks.analyticsPages.shift() ?? { data: [], error: null };
  });
  builder.delete = mocks.delete.mockReturnValue(builder);
  builder.in = mocks.in.mockImplementation(async () => mocks.deletion);
  mocks.from.mockReturnValue(builder);
  mocks.createAdminClient.mockReturnValue({ from: mocks.from });
}

describe("AI telemetry operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.highWater = { data: [], error: null };
    mocks.analyticsPages = [];
    mocks.retentionSelection = { data: [], error: null };
    mocks.deletion = { error: null };
    mocks.selectedColumns = [];
    configure();
  });

  it("returns an empty summary from a bounded high-water query without fetching pages", async () => {
    const from = new Date(FIRST);
    const to = new Date("2026-01-02T00:00:00.000Z");
    const summary = await getAiTelemetrySummary({ from, to });
    expect(summary.totalProviderInvocations).toBe(0);
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("ai_request_telemetry");
    expect(mocks.selectedColumns).toEqual(["id,occurred_at"]);
    expect(mocks.gte).toHaveBeenCalledWith("occurred_at", from.toISOString());
    expect(mocks.lt).toHaveBeenCalledWith("occurred_at", to.toISOString());
    expect(mocks.order).toHaveBeenNthCalledWith(1, "occurred_at", { ascending: false });
    expect(mocks.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(mocks.limit).toHaveBeenCalledWith(1);
  });

  it("uses high-water-bounded keyset pages without duplicates when a later row is inserted", async () => {
    mocks.highWater = { data: [{ id: 2_000, occurred_at: SECOND }], error: null };
    mocks.analyticsPages = [
      { data: Array.from({ length: 1_000 }, (_row, index) => telemetryRow(index + 1)), error: null },
      { data: Array.from({ length: 1_000 }, (_row, index) => telemetryRow(index + 1_001, SECOND)), error: null },
      { data: [], error: null },
    ];
    const summary = await getAiTelemetrySummary({ from: new Date(FIRST), to: new Date("2026-01-02") });
    expect(summary.totalProviderInvocations).toBe(2_000);
    expect(mocks.selectedColumns[1]).toBe("id,occurred_at,route,attempt_kind,model,reasoning_effort,plan,outcome,latency_ms,had_image,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens");
    expect(mocks.selectedColumns).not.toContain("user_id");
    expect(mocks.or).toHaveBeenNthCalledWith(1, `occurred_at.lt.${SECOND},and(occurred_at.eq.${SECOND},id.lte.2000)`);
    expect(mocks.or).toHaveBeenNthCalledWith(2, expect.stringContaining(`occurred_at.eq.${FIRST},id.gt.1000`));
    expect(mocks.or).toHaveBeenNthCalledWith(2, expect.stringContaining("id.lte.2000"));
    expect(mocks.order).toHaveBeenNthCalledWith(3, "occurred_at", { ascending: true });
    expect(mocks.order).toHaveBeenNthCalledWith(4, "id", { ascending: true });
    expect(mocks.limit).toHaveBeenLastCalledWith(1000);
  });

  it("accepts exactly 50,000 high-water-bounded rows and rejects 50,001 without returning a partial summary", async () => {
    mocks.highWater = { data: [{ id: AI_TELEMETRY_MAX_ANALYTICS_ROWS, occurred_at: SECOND }], error: null };
    mocks.analyticsPages = Array.from({ length: AI_TELEMETRY_MAX_ANALYTICS_ROWS / 1000 }, (_value, page) => ({ data: Array.from({ length: 1000 }, (_row, index) => telemetryRow(page * 1000 + index + 1)), error: null }));
    mocks.analyticsPages.push({ data: [], error: null });
    await expect(getAiTelemetrySummary({ from: new Date(FIRST), to: new Date("2026-02-01") })).resolves.toMatchObject({ totalProviderInvocations: AI_TELEMETRY_MAX_ANALYTICS_ROWS });

    vi.clearAllMocks();
    configure();
    mocks.highWater = { data: [{ id: AI_TELEMETRY_MAX_ANALYTICS_ROWS + 1, occurred_at: SECOND }], error: null };
    mocks.analyticsPages = Array.from({ length: 51 }, (_value, page) => ({ data: Array.from({ length: 1000 }, (_row, index) => telemetryRow(page * 1000 + index + 1)), error: null }));
    await expect(getAiTelemetrySummary({ from: new Date(FIRST), to: new Date("2026-02-01") })).rejects.toMatchObject({ code: "dataset_limit" });
  });

  it("rejects invalid ranges and admin/database failures without exposing raw details", async () => {
    await expect(getAiTelemetrySummary({ from: new Date("invalid"), to: new Date() })).rejects.toMatchObject({ code: "invalid_range" });
    mocks.createAdminClient.mockImplementationOnce(() => { throw new Error("private admin configuration"); });
    await expect(getAiTelemetrySummary({ from: new Date(FIRST), to: new Date("2026-02-01") })).rejects.toEqual(new AiTelemetryOperationsError("database_error"));
    mocks.highWater = { data: null as never, error: { message: "private database detail" } };
    await expect(getAiTelemetrySummary({ from: new Date(FIRST), to: new Date("2026-02-01") })).rejects.toEqual(new AiTelemetryOperationsError("database_error"));
    expect(new AiTelemetryOperationsError("database_error").message).not.toContain("private");
  });

  it("deletes one deterministically ordered oldest batch with strict cutoff and lookahead", async () => {
    mocks.retentionSelection = { data: [{ id: 1 }, { id: 2 }, { id: 3 }], error: null };
    const result = await deleteExpiredAiTelemetry({ now: new Date("2026-04-01T00:00:00.000Z"), retentionDays: 90, batchSize: 2 });
    expect(result).toEqual({ deletedCount: 2, cutoff: new Date("2026-01-01T00:00:00.000Z"), hasMore: true });
    expect(mocks.select).toHaveBeenCalledWith("id");
    expect(mocks.lt).toHaveBeenLastCalledWith("occurred_at", "2026-01-01T00:00:00.000Z");
    expect(mocks.order).toHaveBeenLastCalledWith("id", { ascending: true });
    expect(mocks.limit).toHaveBeenLastCalledWith(3);
    expect(mocks.in).toHaveBeenCalledWith("id", [1, 2]);
    expect(mocks.delete).toHaveBeenCalledOnce();
  });

  it("uses the 90-day and 1,000-row defaults, retains exact-cutoff rows, and validates bounds", async () => {
    const result = await deleteExpiredAiTelemetry({ now: new Date("2026-04-01T00:00:00.000Z") });
    expect(result).toEqual({ deletedCount: 0, cutoff: new Date("2026-01-01T00:00:00.000Z"), hasMore: false });
    expect(mocks.lt).toHaveBeenCalledWith("occurred_at", "2026-01-01T00:00:00.000Z");
    expect(mocks.limit).toHaveBeenCalledWith(AI_TELEMETRY_DEFAULT_RETENTION_BATCH_SIZE + 1);
    await expect(deleteExpiredAiTelemetry({ retentionDays: 0 })).rejects.toMatchObject({ code: "invalid_retention" });
    await expect(deleteExpiredAiTelemetry({ batchSize: 5001 })).rejects.toMatchObject({ code: "invalid_retention" });
  });

  it("reports retention select and delete failures without raw database details", async () => {
    mocks.retentionSelection = { data: null as never, error: { message: "private select failure" } };
    await expect(deleteExpiredAiTelemetry()).rejects.toEqual(new AiTelemetryOperationsError("database_error"));
    mocks.retentionSelection = { data: [{ id: 1 }], error: null };
    mocks.deletion = { error: { message: "private delete failure" } };
    await expect(deleteExpiredAiTelemetry()).rejects.toEqual(new AiTelemetryOperationsError("database_error"));
  });
});
