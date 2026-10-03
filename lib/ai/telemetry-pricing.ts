import {
  GPT_5_6_LUNA_MODEL,
  GPT_6_LUNA_MODEL,
} from "./general-chat-config";

export type AiTelemetryPricingEntry = Readonly<{
  provider: string;
  model: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  inputNanoUsdPerToken: bigint;
  cachedInputNanoUsdPerToken: bigint;
  outputNanoUsdPerToken: bigint;
}>;

export type AiTelemetryToolPricingEntry = Readonly<{
  provider: string;
  tool: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  nanoUsdPerCall: bigint;
}>;

export type AiTelemetryCostUnavailableReason =
  | "usage_unavailable"
  | "invalid_usage"
  | "unknown_model"
  | "no_applicable_price"
  | "ambiguous_price"
  | "invalid_pricing"
  | "unknown_tool"
  | "no_applicable_tool_price"
  | "ambiguous_tool_price"
  | "invalid_tool_pricing";

export type AiTelemetryCostResult =
  | Readonly<{
      available: true;
      nanoUsd: bigint;
      pricingVersion: string;
      webSearchPricingVersion: string | null;
    }>
  | Readonly<{ available: false; reason: AiTelemetryCostUnavailableReason }>;

export type AiTelemetryCostInput = Readonly<{
  provider: string;
  model: string;
  occurredAt: Date;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  webSearchCalls: number;
}>;

/**
 * Populate only from an approved provider pricing source. Keeping historical
 * entries preserves reproducible estimates after provider prices change.
 *
 * The telemetry schema currently records uncached input, cached input, and
 * output tokens only. Cache writes and the >272K long-context premium are not
 * represented, so this schedule deliberately covers the supported short-
 * context dimensions without pretending to calculate the unsupported ones.
 */
export const APPROVED_AI_TELEMETRY_PRICING = [
  {
    provider: "openai",
    model: GPT_5_6_LUNA_MODEL,
    version: "openai-gpt-5.6-luna-2026-07-30",
    effectiveFrom: "2026-07-30T00:00:00.000Z",
    effectiveTo: null,
    inputNanoUsdPerToken: BigInt(200),
    cachedInputNanoUsdPerToken: BigInt(20),
    outputNanoUsdPerToken: BigInt(1_200),
  },
  {
    provider: "openai",
    model: GPT_6_LUNA_MODEL,
    version: "openai-gpt-6-luna-2026-10-03",
    effectiveFrom: "2026-10-03T00:00:00.000Z",
    effectiveTo: null,
    inputNanoUsdPerToken: BigInt(100),
    cachedInputNanoUsdPerToken: BigInt(10),
    outputNanoUsdPerToken: BigInt(500),
  },
] as const satisfies readonly AiTelemetryPricingEntry[];

/**
 * Kept separate from per-token model rates because Web Search is billed per
 * chargeable action. Retain old effective periods when provider pricing changes.
 */
export const APPROVED_AI_TELEMETRY_TOOL_PRICING = [
  {
    provider: "openai",
    tool: "web_search",
    version: "openai-web-search-2026-10-03",
    effectiveFrom: "2026-10-03T00:00:00.000Z",
    effectiveTo: null,
    nanoUsdPerCall: BigInt(10_000_000),
  },
] as const satisfies readonly AiTelemetryToolPricingEntry[];

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: bigint): boolean {
  return value >= BigInt(0);
}

function isValidPricingEntry(entry: AiTelemetryPricingEntry): boolean {
  if (!entry.provider || !entry.model || !entry.version || !isValidDate(entry.effectiveFrom)) {
    return false;
  }
  if (entry.effectiveTo !== null) {
    if (!isValidDate(entry.effectiveTo) || Date.parse(entry.effectiveFrom) >= Date.parse(entry.effectiveTo)) {
      return false;
    }
  }
  return [
    entry.inputNanoUsdPerToken,
    entry.cachedInputNanoUsdPerToken,
    entry.outputNanoUsdPerToken,
  ].every(isNonNegativeInteger);
}

function isValidToolPricingEntry(entry: AiTelemetryToolPricingEntry): boolean {
  if (!entry.provider || !entry.tool || !entry.version || !isValidDate(entry.effectiveFrom)) {
    return false;
  }
  if (entry.effectiveTo !== null) {
    if (!isValidDate(entry.effectiveTo) || Date.parse(entry.effectiveFrom) >= Date.parse(entry.effectiveTo)) {
      return false;
    }
  }
  return entry.nanoUsdPerCall >= BigInt(0);
}

function unavailable(reason: AiTelemetryCostUnavailableReason): AiTelemetryCostResult {
  return { available: false, reason };
}

function hasUsableTokens(input: AiTelemetryCostInput): input is AiTelemetryCostInput & {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
} {
  return input.inputTokens !== null && input.cachedInputTokens !== null && input.outputTokens !== null;
}

export function estimateAiTelemetryCost(
  input: AiTelemetryCostInput,
  pricingSchedule: readonly AiTelemetryPricingEntry[] = APPROVED_AI_TELEMETRY_PRICING,
  toolPricingSchedule: readonly AiTelemetryToolPricingEntry[] = APPROVED_AI_TELEMETRY_TOOL_PRICING,
): AiTelemetryCostResult {
  if (!Number.isInteger(input.webSearchCalls) || input.webSearchCalls < 0) {
    return unavailable("invalid_usage");
  }
  if (!hasUsableTokens(input)) return unavailable("usage_unavailable");
  if (
    !Number.isInteger(input.inputTokens) ||
    !Number.isInteger(input.cachedInputTokens) ||
    !Number.isInteger(input.outputTokens) ||
    input.inputTokens < 0 ||
    input.cachedInputTokens < 0 ||
    input.outputTokens < 0 ||
    input.cachedInputTokens > input.inputTokens
  ) {
    return unavailable("invalid_usage");
  }
  if (!Number.isFinite(input.occurredAt.valueOf())) return unavailable("invalid_pricing");

  const matchingModel = pricingSchedule.filter(
    (entry) => entry.provider === input.provider && entry.model === input.model,
  );
  if (matchingModel.length === 0) return unavailable("unknown_model");
  if (matchingModel.some((entry) => !isValidPricingEntry(entry))) return unavailable("invalid_pricing");

  const occurredAt = input.occurredAt.valueOf();
  const applicable = matchingModel.filter((entry) => {
    const from = Date.parse(entry.effectiveFrom);
    const to = entry.effectiveTo === null ? null : Date.parse(entry.effectiveTo);
    return occurredAt >= from && (to === null || occurredAt < to);
  });
  if (applicable.length === 0) return unavailable("no_applicable_price");
  if (applicable.length > 1) return unavailable("ambiguous_price");

  const pricing = applicable[0]!;
  const nonCachedInputTokens = input.inputTokens - input.cachedInputTokens;
  let nanoUsd =
    BigInt(nonCachedInputTokens) * pricing.inputNanoUsdPerToken +
    BigInt(input.cachedInputTokens) * pricing.cachedInputNanoUsdPerToken +
    BigInt(input.outputTokens) * pricing.outputNanoUsdPerToken;

  let webSearchPricingVersion: string | null = null;
  if (input.webSearchCalls > 0) {
    const matchingTool = toolPricingSchedule.filter(
      (entry) => entry.provider === input.provider && entry.tool === "web_search",
    );
    if (matchingTool.length === 0) return unavailable("unknown_tool");
    if (matchingTool.some((entry) => !isValidToolPricingEntry(entry))) {
      return unavailable("invalid_tool_pricing");
    }

    const applicableTool = matchingTool.filter((entry) => {
      const from = Date.parse(entry.effectiveFrom);
      const to = entry.effectiveTo === null ? null : Date.parse(entry.effectiveTo);
      return occurredAt >= from && (to === null || occurredAt < to);
    });
    if (applicableTool.length === 0) return unavailable("no_applicable_tool_price");
    if (applicableTool.length > 1) return unavailable("ambiguous_tool_price");

    const toolPricing = applicableTool[0]!;
    nanoUsd += BigInt(input.webSearchCalls) * toolPricing.nanoUsdPerCall;
    webSearchPricingVersion = toolPricing.version;
  }

  return {
    available: true,
    nanoUsd,
    pricingVersion: pricing.version,
    webSearchPricingVersion,
  };
}
