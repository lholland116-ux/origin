import { describe, expect, it } from "vitest";
import { summarizeAiTelemetry, type AiTelemetryAnalyticsRow } from "@/lib/ai/telemetry-analytics";
import type { AiTelemetryPricingEntry, AiTelemetryToolPricingEntry } from "@/lib/ai/telemetry-pricing";

const PRICE: AiTelemetryPricingEntry = {
  provider: "openai", model: "model-a", version: "v1", effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null,
  inputNanoUsdPerToken: BigInt(10), cachedInputNanoUsdPerToken: BigInt(2), outputNanoUsdPerToken: BigInt(20),
};

const WEB_SEARCH_PRICE: AiTelemetryToolPricingEntry = {
  provider: "openai", tool: "web_search", version: "search-v1",
  effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null,
  nanoUsdPerCall: BigInt(10_000_000),
};

function row(overrides: Partial<AiTelemetryAnalyticsRow> = {}): AiTelemetryAnalyticsRow {
  return {
    occurred_at: "2026-01-15T00:00:00.000Z", route: "standard", attempt_kind: "primary", model: "model-a",
    reasoning_effort: "medium", plan: "free", outcome: "success", latency_ms: 10, had_image: false,
    input_tokens: 10, cached_input_tokens: 2, output_tokens: 3, reasoning_tokens: 1, total_tokens: 13,
    web_search_calls: 0,
    ...overrides,
  };
}

describe("summarizeAiTelemetry", () => {
  it("represents an empty dataset explicitly", () => {
    const summary = summarizeAiTelemetry([]);
    expect(summary.totalProviderInvocations).toBe(0);
    expect(summary.totalWebSearchCalls).toBe(0);
    expect(summary.observedImageRetryRate).toBeNull();
    expect(summary.tokens.input.coverageRate).toBeNull();
    expect(summary.costs.costCoverageRate).toBeNull();
  });

  it("counts invocations, primary requests, retry observations, and deterministic groupings", () => {
    const rows = [
      row({ had_image: true }),
      row({ attempt_kind: "image_retry", latency_ms: 30, reasoning_effort: "low", outcome: "incomplete", input_tokens: 5, cached_input_tokens: 1, output_tokens: 2, reasoning_tokens: 1, total_tokens: 7 }),
      row({ route: "web_search", plan: "pro", latency_ms: 20, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 }),
    ];
    const summary = summarizeAiTelemetry(rows, { pricingSchedule: [PRICE] });
    expect(summary.totalProviderInvocations).toBe(3);
    expect(summary.observedPrimaryRequests).toBe(2);
    expect(summary.imageRetryInvocations).toBe(1);
    expect(summary.observedImageRetryRate).toBe(1);
    expect(summary.byRoute).toEqual({ standard: 2, web_search: 1 });
    expect(summary.byAttemptKind).toEqual({ primary: 2, image_retry: 1 });
    expect(summary.byReasoningEffort).toEqual({ medium: 2, low: 1 });
    expect(summary.byPlan).toEqual({ free: 2, pro: 1 });
    expect(summary.byOutcome).toEqual({ success: 2, incomplete: 1 });
    expect(summary.byModel).toEqual({ "model-a": 3 });
    expect(summary.byRouteAndEffort.standard).toEqual({ medium: 1, low: 1 });
    expect(summary.byPlanAndRoute).toEqual({ free: { standard: 2 }, pro: { web_search: 1 } });
    expect(summary.byPlanAndEffort.free).toEqual({ medium: 1, low: 1 });
    expect(summary.byOutcomeAndRoute.incomplete).toEqual({ standard: 1 });
    expect(summary.nonSuccessRate).toBe(1 / 3);
    expect(summary.costs.calculableProviderCostNanoUsd).toBe(BigInt(226));
    expect(summary.costs.calculablePrimaryCostNanoUsd).toBe(BigInt(144));
    expect(summary.costs.calculableRetryCostNanoUsd).toBe(BigInt(82));
    expect(summary.costs.calculableCostRows).toBe(3);
    expect(summary.costs.uncalculableCostRows).toBe(0);
    expect(summary.costs.costCoverageRate).toBe(1);
    expect(summary.costs.byModel).toEqual({ "model-a": BigInt(226) });
    expect(summary.costs.byRoute).toEqual({ standard: BigInt(226), web_search: BigInt(0) });
    expect(summary.costs.byPlan).toEqual({ free: BigInt(226), pro: BigInt(0) });
    expect(summary.costs.byReasoningEffort).toEqual({ medium: BigInt(144), low: BigInt(82) });
    expect(summary.costs.byAttemptKind).toEqual({ primary: BigInt(144), image_retry: BigInt(82) });
    expect(summary.costs.estimatedProviderCostPerObservedPrimaryRequestNanoUsd).toBe(BigInt(113));
  });

  it("uses continuous percentiles and preserves null-versus-zero token coverage", () => {
    const summary = summarizeAiTelemetry([
      row({ latency_ms: 0, input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null }),
      row({ latency_ms: 10, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 }),
      row({ latency_ms: 20, input_tokens: 10, cached_input_tokens: 5, output_tokens: 4, reasoning_tokens: 2, total_tokens: 14 }),
      row({ latency_ms: 30, input_tokens: 10, cached_input_tokens: 1, output_tokens: 4, reasoning_tokens: 1, total_tokens: 14 }),
    ]);
    const latency = summary.latencyByRouteAndAttemptKind.standard.primary;
    expect(latency).toMatchObject({ count: 4, averageMs: 15, p50Ms: 15, maxMs: 30 });
    expect(latency.p95Ms).toBeCloseTo(28.5);
    expect(summary.tokens.input).toEqual({ total: 20, rowsWithValue: 3, coverageRate: 0.75 });
    expect(summary.tokens.cachedInputRate).toBe(6 / 20);
    expect(summary.tokens.reasoningOutputRate).toBe(3 / 8);
    expect(summary.observedImageRetryRate).toBeNull();
    expect(summary.costs.costCoverageRate).toBe(0);
    expect(summary.costs.calculableCostRows).toBe(0);
    expect(summary.costs.uncalculableCostRows).toBe(4);
    expect(summary.costs.estimatedProviderCostPerObservedPrimaryRequestNanoUsd).toBeNull();
  });

  it("returns null token ratios for zero denominators and is semantically deterministic across row order", () => {
    const rows = [
      row({ route: "web_search", plan: "pro", latency_ms: 30, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }),
      row({ attempt_kind: "image_retry", reasoning_effort: "low", outcome: "incomplete", latency_ms: 5, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }),
    ];
    const forward = summarizeAiTelemetry(rows, { pricingSchedule: [PRICE] });
    const reversed = summarizeAiTelemetry([...rows].reverse(), { pricingSchedule: [PRICE] });
    expect(forward.tokens.cachedInputRate).toBeNull();
    expect(forward.tokens.reasoningOutputRate).toBeNull();
    expect(forward).toEqual(reversed);
  });

  it("does not charge reasoning or total-token breakdowns a second time", () => {
    const baseline = summarizeAiTelemetry([row()], { pricingSchedule: [PRICE] });
    const changedBreakdowns = summarizeAiTelemetry([
      row({ reasoning_tokens: 999_999, total_tokens: 999_999 }),
    ], { pricingSchedule: [PRICE] });
    expect(changedBreakdowns.costs.calculableProviderCostNanoUsd).toBe(
      baseline.costs.calculableProviderCostNanoUsd,
    );
  });

  it("includes actual Web Search tool fees in route cost and exposes the observed call total", () => {
    const summary = summarizeAiTelemetry([
      row({
        route: "web_search",
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        web_search_calls: 1,
      }),
    ], { pricingSchedule: [PRICE], toolPricingSchedule: [WEB_SEARCH_PRICE] });

    expect(summary.totalWebSearchCalls).toBe(1);
    expect(summary.costs.calculableProviderCostNanoUsd).toBe(BigInt(10_000_000));
    expect(summary.costs.byRoute).toEqual({ web_search: BigInt(10_000_000) });
  });
});
