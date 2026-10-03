import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  limit: vi.fn(),
  delete: vi.fn(),
  in: vi.fn(),
  analyticsPages: [] as Array<{ data: unknown[] | null; error: unknown }>,
  retentionSelection: { data: [] as Array<{ id: number }>, error: null as unknown },
  deletion: { error: null as unknown },
  selectedColumns: "",
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import {
  AI_TELEMETRY_MAX_ANALYTICS_ROWS,
  AiTelemetryOperationsError,
  deleteExpiredAiTelemetry,
  getAiTelemetrySummary,
} from "@/lib/ai/telemetry-operations";

function telemetryRow(index: number) {
  return {
    occurred_at: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`, route: "standard", attempt_kind: "primary",
    model: "model-a", reasoning_effort: "medium", plan: "free", outcome: "success", latency_ms: 1,
    had_image: false, input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null,
  };
}

function configure() {
  const builder = {} as Record<string, ReturnType<typeof vi.fn> | ((...args: unknown[]) => Promise<unknown>)>;
  builder.select = mocks.select.mockImplementation((columns: string) => {
    mocks.selectedColumns = columns;
    return builder;
  });
  builder.gte = mocks.gte.mockReturnValue(builder);
  builder.lt = mocks.lt.mockReturnValue(builder);
  builder.order = mocks.order.mockReturnValue(builder);
  builder.range = mocks.range.mockImplementation(async () => mocks.analyticsPages.shift() ?? { data: [], error: null });
  builder.limit = mocks.limit.mockImplementation(async () => mocks.retentionSelection);
  builder.delete = mocks.delete.mockReturnValue(builder);
  builder.in = mocks.in.mockImplementation(async () => mocks.deletion);
  mocks.from.mockReturnValue(builder);
  mocks.createAdminClient.mockReturnValue({ from: mocks.from });
}

describe("AI telemetry operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analyticsPages = [];
    mocks.retentionSelection = { data: [], error: null };
    mocks.deletion = { error: null };
    configure();
  });

  it("retrieves an empty half-open range through the service-role client", async () => {
    mocks.analyticsPages = [{ data: [], error: null }];
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-02T00:00:00.000Z");
    const summary = await getAiTelemetrySummary({ from, to });

    expect(summary.totalProviderInvocations).toBe(0);
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("ai_request_telemetry");
    expect(mocks.selectedColumns).toContain("occurred_at");
    expect(mocks.gte).toHaveBeenCalledWith("occurred_at", from.toISOString());
    expect(mocks.lt).toHaveBeenCalledWith("occurred_at", to.toISOString());
    expect(mocks.order).toHaveBeenNthCalledWith(1, "occurred_at", { ascending: true });
    expect(mocks.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
  });

  it("paginates deterministically and accepts the exact maximum dataset size", async () => {
    mocks.analyticsPages = Array.from({ length: AI_TELEMETRY_MAX_ANALYTICS_ROWS / 1000 }, () => ({
      data: Array.from({ length: 1000 }, (_value, index) => telemetryRow(index)), error: null,
    }));
    mocks.analyticsPages.push({ data: [], error: null });
    const summary = await getAiTelemetrySummary({ from: new Date("2026-01-01"), to: new Date("2026-02-01") });
    expect(summary.totalProviderInvocations).toBe(AI_TELEMETRY_MAX_ANALYTICS_ROWS);
    expect(mocks.range).toHaveBeenCalledTimes(51);
  });

  it("fails closed rather than returning a partial analytics dataset", async () => {
    mocks.analyticsPages = Array.from({ length: 51 }, () => ({
      data: Array.from({ length: 1000 }, (_value, index) => telemetryRow(index)), error: null,
    }));
    await expect(getAiTelemetrySummary({ from: new Date("2026-01-01"), to: new Date("2026-02-01") })).rejects.toMatchObject({ code: "dataset_limit" });
  });

  it("rejects invalid ranges and database failures with safe operational errors", async () => {
    await expect(getAiTelemetrySummary({ from: new Date("invalid"), to: new Date() })).rejects.toMatchObject({ code: "invalid_range" });
    mocks.analyticsPages = [{ data: null, error: { message: "private database detail" } }];
    await expect(getAiTelemetrySummary({ from: new Date("2026-01-01"), to: new Date("2026-02-01") })).rejects.toEqual(
      new AiTelemetryOperationsError("database_error"),
    );
  });

  it("deletes one bounded oldest batch with strict cutoff semantics and lookahead", async () => {
    mocks.retentionSelection = { data: [{ id: 1 }, { id: 2 }, { id: 3 }], error: null };
    const now = new Date("2026-04-01T00:00:00.000Z");
    const result = await deleteExpiredAiTelemetry({ now, retentionDays: 90, batchSize: 2 });
    expect(result).toEqual({ deletedCount: 2, cutoff: new Date("2026-01-01T00:00:00.000Z"), hasMore: true });
    expect(mocks.select).toHaveBeenCalledWith("id");
    expect(mocks.lt).toHaveBeenLastCalledWith("occurred_at", "2026-01-01T00:00:00.000Z");
    expect(mocks.limit).toHaveBeenCalledWith(3);
    expect(mocks.in).toHaveBeenCalledWith("id", [1, 2]);
  });

  it("retains an exact-cutoff row by using strict lt and validates bounded options", async () => {
    const result = await deleteExpiredAiTelemetry({ now: new Date("2026-04-01T00:00:00.000Z") });
    expect(result.deletedCount).toBe(0);
    expect(mocks.lt).toHaveBeenCalledWith("occurred_at", "2026-01-01T00:00:00.000Z");
    await deleteExpiredAiTelemetry({ now: new Date("2026-04-01T00:00:00.000Z"), retentionDays: 10 });
    expect(mocks.lt).toHaveBeenLastCalledWith("occurred_at", "2026-03-22T00:00:00.000Z");
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
