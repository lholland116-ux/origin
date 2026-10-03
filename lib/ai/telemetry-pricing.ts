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

export type AiTelemetryCostUnavailableReason =
  | "usage_unavailable"
  | "invalid_usage"
  | "unknown_model"
  | "no_applicable_price"
  | "ambiguous_price"
  | "invalid_pricing";

export type AiTelemetryCostResult =
  | Readonly<{ available: true; nanoUsd: bigint; pricingVersion: string }>
  | Readonly<{ available: false; reason: AiTelemetryCostUnavailableReason }>;

export type AiTelemetryCostInput = Readonly<{
  provider: string;
  model: string;
  occurredAt: Date;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}>;

/**
 * Populate only from an approved provider pricing source. Keeping historical
 * entries preserves reproducible estimates after provider prices change.
 */
export const APPROVED_AI_TELEMETRY_PRICING = [] as const satisfies readonly AiTelemetryPricingEntry[];

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
): AiTelemetryCostResult {
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
  const nanoUsd =
    BigInt(nonCachedInputTokens) * pricing.inputNanoUsdPerToken +
    BigInt(input.cachedInputTokens) * pricing.cachedInputNanoUsdPerToken +
    BigInt(input.outputTokens) * pricing.outputNanoUsdPerToken;

  return { available: true, nanoUsd, pricingVersion: pricing.version };
}
