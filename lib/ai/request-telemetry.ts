export type AiTelemetryRoute = "standard" | "web_search";

export type AiTelemetryAttemptKind = "primary" | "image_retry";

export type AiTelemetryPlan = "free" | "pro";

/**
 * Telemetry records the provider domain rather than the current customer-facing
 * router domain. Future internal callers may use values the router does not.
 */
export const PROVIDER_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ProviderReasoningEffort =
  (typeof PROVIDER_REASONING_EFFORTS)[number];

export function isProviderReasoningEffort(
  value: string,
): value is ProviderReasoningEffort {
  return (PROVIDER_REASONING_EFFORTS as readonly string[]).includes(value);
}

export type AiTelemetryOutcome =
  | "success"
  | "api_error"
  | "cancelled"
  | "incomplete";

export type AiTelemetryTokenFields = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

export type AiRequestTelemetryRecord = {
  route: AiTelemetryRoute;
  attemptKind: AiTelemetryAttemptKind;
  model: string;
  webSearchCalls: number;
  reasoningEffort: ProviderReasoningEffort;
  plan: AiTelemetryPlan;
  outcome: AiTelemetryOutcome;
  latencyMs: number;
  hadImage: boolean;
} & AiTelemetryTokenFields;

/**
 * The privacy-safe subset of a Responses usage object needed for telemetry.
 * Fields are optional because unsuccessful or interrupted responses may not
 * include usage, even though completed Responses SDK objects do.
 */
export type OpenAIResponseUsage = {
  input_tokens?: number | null;
  input_tokens_details?: {
    cached_tokens?: number | null;
  } | null;
  output_tokens?: number | null;
  output_tokens_details?: {
    reasoning_tokens?: number | null;
  } | null;
  total_tokens?: number | null;
};

const EMPTY_TOKEN_FIELDS: AiTelemetryTokenFields = {
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
};

/**
 * Maps OpenAI Responses usage into the database contract without retaining
 * any request or response content. Missing usage is expected for some
 * terminal outcomes and is represented by nullable token fields.
 */
export function mapOpenAIResponseUsage(
  usage: OpenAIResponseUsage | null | undefined,
): AiTelemetryTokenFields {
  if (!usage) {
    return { ...EMPTY_TOKEN_FIELDS };
  }

  return {
    inputTokens: usage.input_tokens ?? null,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
}
