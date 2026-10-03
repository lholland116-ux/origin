import { describe, expect, it } from "vitest";
import {
  APPROVED_AI_TELEMETRY_PRICING,
  estimateAiTelemetryCost,
  type AiTelemetryPricingEntry,
} from "@/lib/ai/telemetry-pricing";

const PRICE: AiTelemetryPricingEntry = {
  provider: "openai",
  model: "model-a",
  version: "v1",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: "2026-02-01T00:00:00.000Z",
  inputNanoUsdPerToken: BigInt(10),
  cachedInputNanoUsdPerToken: BigInt(2),
  outputNanoUsdPerToken: BigInt(20),
};

function estimate(overrides: Partial<Parameters<typeof estimateAiTelemetryCost>[0]> = {}, schedule = [PRICE]) {
  return estimateAiTelemetryCost({
    provider: "openai", model: "model-a", occurredAt: new Date("2026-01-15T00:00:00.000Z"),
    inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, ...overrides,
  }, schedule);
}

describe("estimateAiTelemetryCost", () => {
  it("uses exact model matching, inclusive starts, and integer nano-USD arithmetic", () => {
    expect(estimate({ occurredAt: new Date(PRICE.effectiveFrom) })).toEqual({
      available: true, nanoUsd: BigInt(144), pricingVersion: "v1",
    });
  });

  it("uses an exclusive effective end and supports open-ended periods", () => {
    expect(estimate({ occurredAt: new Date(PRICE.effectiveTo!) })).toEqual({ available: false, reason: "no_applicable_price" });
    expect(estimate({ occurredAt: new Date("2026-03-01T00:00:00.000Z") }, [{ ...PRICE, effectiveTo: null }])).toEqual({
      available: true, nanoUsd: BigInt(144), pricingVersion: "v1",
    });
  });

  it("fails closed for unknown, missing, overlapping, and invalid price configuration", () => {
    expect(estimate({ model: "other" })).toEqual({ available: false, reason: "unknown_model" });
    expect(estimate({ occurredAt: new Date("2025-12-01T00:00:00.000Z") })).toEqual({ available: false, reason: "no_applicable_price" });
    expect(estimate({}, [PRICE, { ...PRICE, version: "v2" }])).toEqual({ available: false, reason: "ambiguous_price" });
    expect(estimate({}, [{ ...PRICE, inputNanoUsdPerToken: BigInt(-1) }])).toEqual({ available: false, reason: "invalid_pricing" });
  });

  it("makes absent or invalid usage unavailable rather than zero", () => {
    expect(estimate({ inputTokens: null })).toEqual({ available: false, reason: "usage_unavailable" });
    expect(estimate({ cachedInputTokens: 11 })).toEqual({ available: false, reason: "invalid_usage" });
    expect(estimate({ outputTokens: -1 })).toEqual({ available: false, reason: "invalid_usage" });
  });

  it("accepts reported zero usage and does not bill reasoning or total-token breakdowns", () => {
    expect(estimate({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })).toEqual({
      available: true, nanoUsd: BigInt(0), pricingVersion: "v1",
    });
    expect(estimate()).toEqual({ available: true, nanoUsd: BigInt(144), pricingVersion: "v1" });
  });

  it("ships with no guessed production prices", () => {
    expect(APPROVED_AI_TELEMETRY_PRICING).toEqual([]);
  });
});
