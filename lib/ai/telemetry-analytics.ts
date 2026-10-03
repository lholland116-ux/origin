import type { Database } from "@/lib/database.types";
import {
  APPROVED_AI_TELEMETRY_PRICING,
  APPROVED_AI_TELEMETRY_TOOL_PRICING,
  estimateAiTelemetryCost,
  type AiTelemetryPricingEntry,
  type AiTelemetryToolPricingEntry,
} from "@/lib/ai/telemetry-pricing";

export type AiTelemetryAnalyticsRow = Pick<
  Database["public"]["Tables"]["ai_request_telemetry"]["Row"],
  | "occurred_at"
  | "route"
  | "attempt_kind"
  | "model"
  | "reasoning_effort"
  | "plan"
  | "outcome"
  | "latency_ms"
  | "had_image"
  | "input_tokens"
  | "cached_input_tokens"
  | "output_tokens"
  | "reasoning_tokens"
  | "total_tokens"
  | "web_search_calls"
>;

export type AiTelemetryLatencyStats = Readonly<{
  count: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}>;

export type AiTelemetryTokenStats = Readonly<{
  total: number;
  rowsWithValue: number;
  coverageRate: number | null;
}>;

export type AiTelemetrySummary = Readonly<{
  totalProviderInvocations: number;
  totalWebSearchCalls: number;
  observedPrimaryRequests: number;
  imageRetryInvocations: number;
  observedImageRetryRate: number | null;
  nonSuccessRate: number | null;
  byRoute: Record<string, number>;
  byAttemptKind: Record<string, number>;
  byReasoningEffort: Record<string, number>;
  byPlan: Record<string, number>;
  byOutcome: Record<string, number>;
  byModel: Record<string, number>;
  byRouteAndEffort: Record<string, Record<string, number>>;
  byPlanAndRoute: Record<string, Record<string, number>>;
  byPlanAndEffort: Record<string, Record<string, number>>;
  byOutcomeAndRoute: Record<string, Record<string, number>>;
  latencyByRouteAndAttemptKind: Record<string, Record<string, AiTelemetryLatencyStats>>;
  tokens: Readonly<{
    input: AiTelemetryTokenStats;
    cachedInput: AiTelemetryTokenStats;
    output: AiTelemetryTokenStats;
    reasoning: AiTelemetryTokenStats;
    total: AiTelemetryTokenStats;
    cachedInputRate: number | null;
    reasoningOutputRate: number | null;
  }>;
  costs: Readonly<{
    calculableCostRows: number;
    uncalculableCostRows: number;
    costCoverageRate: number | null;
    calculableProviderCostNanoUsd: bigint;
    calculablePrimaryCostNanoUsd: bigint;
    calculableRetryCostNanoUsd: bigint;
    estimatedProviderCostPerObservedPrimaryRequestNanoUsd: bigint | null;
    byModel: Record<string, bigint>;
    byRoute: Record<string, bigint>;
    byPlan: Record<string, bigint>;
    byReasoningEffort: Record<string, bigint>;
    byAttemptKind: Record<string, bigint>;
  }>;
}>;

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function incrementCross(target: Record<string, Record<string, number>>, first: string, second: string): void {
  const nested = target[first] ?? (target[first] = {});
  increment(nested, second);
}

function addCost(target: Record<string, bigint>, key: string, amount: bigint): void {
  target[key] = (target[key] ?? BigInt(0)) + amount;
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  const index = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower]!;
  const weight = index - lower;
  return sortedValues[lower]! + (sortedValues[upper]! - sortedValues[lower]!) * weight;
}

function latencyStats(values: number[]): AiTelemetryLatencyStats {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    averageMs: total / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1]!,
  };
}

function tokenStats(values: Array<number | null>, totalRows: number): AiTelemetryTokenStats {
  const present = values.filter((value): value is number => value !== null);
  return {
    total: present.reduce((sum, value) => sum + value, 0),
    rowsWithValue: present.length,
    coverageRate: totalRows === 0 ? null : present.length / totalRows,
  };
}

export function summarizeAiTelemetry(
  rows: readonly AiTelemetryAnalyticsRow[],
  options: Readonly<{
    pricingSchedule?: readonly AiTelemetryPricingEntry[];
    toolPricingSchedule?: readonly AiTelemetryToolPricingEntry[];
    provider?: string;
  }> = {},
): AiTelemetrySummary {
  const byRoute: Record<string, number> = {};
  const byAttemptKind: Record<string, number> = {};
  const byReasoningEffort: Record<string, number> = {};
  const byPlan: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byRouteAndEffort: Record<string, Record<string, number>> = {};
  const byPlanAndRoute: Record<string, Record<string, number>> = {};
  const byPlanAndEffort: Record<string, Record<string, number>> = {};
  const byOutcomeAndRoute: Record<string, Record<string, number>> = {};
  const latencyValues: Record<string, Record<string, number[]>> = {};
  const costByModel: Record<string, bigint> = {};
  const costByRoute: Record<string, bigint> = {};
  const costByPlan: Record<string, bigint> = {};
  const costByReasoningEffort: Record<string, bigint> = {};
  const costByAttemptKind: Record<string, bigint> = {};
  const inputValues: Array<number | null> = [];
  const cachedInputValues: Array<number | null> = [];
  const outputValues: Array<number | null> = [];
  const reasoningValues: Array<number | null> = [];
  const totalValues: Array<number | null> = [];
  let primaryRequests = 0;
  let totalWebSearchCalls = 0;
  let retries = 0;
  let imageBearingStandardPrimaries = 0;
  let nonSuccess = 0;
  let cachedInputNumerator = 0;
  let cachedInputDenominator = 0;
  let reasoningNumerator = 0;
  let reasoningDenominator = 0;
  let calculableCostRows = 0;
  let calculableProviderCostNanoUsd = BigInt(0);
  let calculablePrimaryCostNanoUsd = BigInt(0);
  let calculableRetryCostNanoUsd = BigInt(0);
  const pricingSchedule = options.pricingSchedule ?? APPROVED_AI_TELEMETRY_PRICING;
  const toolPricingSchedule = options.toolPricingSchedule ?? APPROVED_AI_TELEMETRY_TOOL_PRICING;
  const provider = options.provider ?? "openai";

  for (const row of rows) {
    increment(byRoute, row.route);
    increment(byAttemptKind, row.attempt_kind);
    increment(byReasoningEffort, row.reasoning_effort);
    increment(byPlan, row.plan);
    increment(byOutcome, row.outcome);
    increment(byModel, row.model);
    totalWebSearchCalls += row.web_search_calls;
    incrementCross(byRouteAndEffort, row.route, row.reasoning_effort);
    incrementCross(byPlanAndRoute, row.plan, row.route);
    incrementCross(byPlanAndEffort, row.plan, row.reasoning_effort);
    incrementCross(byOutcomeAndRoute, row.outcome, row.route);

    const latencyByAttempt = latencyValues[row.route] ?? (latencyValues[row.route] = {});
    (latencyByAttempt[row.attempt_kind] ??= []).push(row.latency_ms);
    inputValues.push(row.input_tokens);
    cachedInputValues.push(row.cached_input_tokens);
    outputValues.push(row.output_tokens);
    reasoningValues.push(row.reasoning_tokens);
    totalValues.push(row.total_tokens);

    if (row.attempt_kind === "primary") primaryRequests += 1;
    if (row.attempt_kind === "image_retry") retries += 1;
    if (row.route === "standard" && row.attempt_kind === "primary" && row.had_image) {
      imageBearingStandardPrimaries += 1;
    }
    if (row.outcome !== "success") nonSuccess += 1;
    if (row.input_tokens !== null && row.cached_input_tokens !== null) {
      cachedInputNumerator += row.cached_input_tokens;
      cachedInputDenominator += row.input_tokens;
    }
    if (row.output_tokens !== null && row.reasoning_tokens !== null) {
      reasoningNumerator += row.reasoning_tokens;
      reasoningDenominator += row.output_tokens;
    }

    const cost = estimateAiTelemetryCost({
      provider,
      model: row.model,
      occurredAt: new Date(row.occurred_at),
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      webSearchCalls: row.web_search_calls,
    }, pricingSchedule, toolPricingSchedule);
    if (cost.available) {
      calculableCostRows += 1;
      calculableProviderCostNanoUsd += cost.nanoUsd;
      if (row.attempt_kind === "primary") calculablePrimaryCostNanoUsd += cost.nanoUsd;
      if (row.attempt_kind === "image_retry") calculableRetryCostNanoUsd += cost.nanoUsd;
      addCost(costByModel, row.model, cost.nanoUsd);
      addCost(costByRoute, row.route, cost.nanoUsd);
      addCost(costByPlan, row.plan, cost.nanoUsd);
      addCost(costByReasoningEffort, row.reasoning_effort, cost.nanoUsd);
      addCost(costByAttemptKind, row.attempt_kind, cost.nanoUsd);
    }
  }

  const latencyByRouteAndAttemptKind: Record<string, Record<string, AiTelemetryLatencyStats>> = {};
  for (const [route, byAttempt] of Object.entries(latencyValues)) {
    latencyByRouteAndAttemptKind[route] = {};
    for (const [attemptKind, values] of Object.entries(byAttempt)) {
      latencyByRouteAndAttemptKind[route][attemptKind] = latencyStats(values);
    }
  }

  const totalRows = rows.length;
  const fullyCovered = totalRows > 0 && calculableCostRows === totalRows;
  return {
    totalProviderInvocations: totalRows,
    totalWebSearchCalls,
    observedPrimaryRequests: primaryRequests,
    imageRetryInvocations: retries,
    observedImageRetryRate: imageBearingStandardPrimaries === 0 ? null : retries / imageBearingStandardPrimaries,
    nonSuccessRate: totalRows === 0 ? null : nonSuccess / totalRows,
    byRoute,
    byAttemptKind,
    byReasoningEffort,
    byPlan,
    byOutcome,
    byModel,
    byRouteAndEffort,
    byPlanAndRoute,
    byPlanAndEffort,
    byOutcomeAndRoute,
    latencyByRouteAndAttemptKind,
    tokens: {
      input: tokenStats(inputValues, totalRows),
      cachedInput: tokenStats(cachedInputValues, totalRows),
      output: tokenStats(outputValues, totalRows),
      reasoning: tokenStats(reasoningValues, totalRows),
      total: tokenStats(totalValues, totalRows),
      cachedInputRate: cachedInputDenominator === 0 ? null : cachedInputNumerator / cachedInputDenominator,
      reasoningOutputRate: reasoningDenominator === 0 ? null : reasoningNumerator / reasoningDenominator,
    },
    costs: {
      calculableCostRows,
      uncalculableCostRows: totalRows - calculableCostRows,
      costCoverageRate: totalRows === 0 ? null : calculableCostRows / totalRows,
      calculableProviderCostNanoUsd,
      calculablePrimaryCostNanoUsd,
      calculableRetryCostNanoUsd,
      estimatedProviderCostPerObservedPrimaryRequestNanoUsd:
        fullyCovered && primaryRequests > 0 ? calculableProviderCostNanoUsd / BigInt(primaryRequests) : null,
      byModel: costByModel,
      byRoute: costByRoute,
      byPlan: costByPlan,
      byReasoningEffort: costByReasoningEffort,
      byAttemptKind: costByAttemptKind,
    },
  };
}
