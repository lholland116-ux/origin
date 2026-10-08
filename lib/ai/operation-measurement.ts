export type OperationOutcome = "success" | "api_error" | "cancelled" | "incomplete";

export type OperationTokenUsage = Readonly<{
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens?: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}>;

export type ProviderResponseUsage = Readonly<{
  input_tokens?: number | null;
  input_tokens_details?: Readonly<{ cached_tokens?: number | null; cache_write_tokens?: number | null }> | null;
  output_tokens?: number | null;
  output_tokens_details?: Readonly<{ reasoning_tokens?: number | null }> | null;
  total_tokens?: number | null;
}>;

/** Safe provider measurement projection; it deliberately excludes response content. */
export function mapProviderResponseUsage(
  usage: ProviderResponseUsage | null | undefined,
): OperationTokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? null,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    ...(usage?.input_tokens_details?.cache_write_tokens === undefined
      ? {}
      : { cacheWriteTokens: usage.input_tokens_details.cache_write_tokens }),
    outputTokens: usage?.output_tokens ?? null,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  };
}
