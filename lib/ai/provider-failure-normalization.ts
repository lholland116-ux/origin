import { APIConnectionError } from "openai";

/**
 * EAI_AGAIN is emitted while resolving the provider host, before a request can
 * reach it. Other connection failures (including timeouts/resets) are ambiguous.
 */
export function isTemporaryProviderDnsFailure(error: unknown): boolean {
  if (!(error instanceof APIConnectionError) || error.status !== undefined) return false;
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 3 && cause && typeof cause === "object"; depth += 1) {
    const record = cause as { code?: unknown; cause?: unknown };
    if (record.code === "EAI_AGAIN") return true;
    cause = record.cause;
  }
  return false;
}
