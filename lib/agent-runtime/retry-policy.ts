import type { ExecutionFailureDescriptor } from "@/lib/agent-runtime/runtime-contracts";
import { EXECUTION_FAILURE_CODES, EXECUTION_FAILURE_PHASES, MAX_EXECUTION_STEP_ATTEMPTS, RETRY_SAFETY_CLASSES } from "@/lib/agent-runtime/runtime-contracts";

export const RETRY_BACKOFF_MS = Object.freeze([1_000, 3_000] as const);
export const MAX_RETRY_DELAY_MS = 30_000;

export type RetryDecision =
  | Readonly<{ action: "retry"; backoffMs: number }>
  | Readonly<{ action: "fail" }>
  | Readonly<{ action: "recovery_required" }>;

function isNormalizedFailure(value: unknown): value is ExecutionFailureDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const failure = value as Record<string, unknown>;
  if (Object.keys(failure).some((key) => !["code", "phase", "retrySafety", "retryAfterMs"].includes(key))) return false;
  return EXECUTION_FAILURE_CODES.includes(failure.code as (typeof EXECUTION_FAILURE_CODES)[number])
    && EXECUTION_FAILURE_PHASES.includes(failure.phase as (typeof EXECUTION_FAILURE_PHASES)[number])
    && RETRY_SAFETY_CLASSES.includes(failure.retrySafety as (typeof RETRY_SAFETY_CLASSES)[number])
    && (failure.retryAfterMs === undefined
      || (typeof failure.retryAfterMs === "number" && Number.isSafeInteger(failure.retryAfterMs) && failure.retryAfterMs >= 0));
}

function hasQualifiedReplaySafety(capabilityId: string, failure: ExecutionFailureDescriptor): boolean {
  if (failure.code !== "transient_dependency_failure" || failure.retrySafety !== "SAFE_RETRY") return false;
  if ((capabilityId === "standard" || capabilityId === "web_search") && failure.phase === "pre_provider") return true;
  return capabilityId === "file_analysis" && failure.phase === "read_only_lookup";
}

/** LVTChat-owned deterministic retry policy. Only explicitly normalized safe failures are eligible. */
export function decideRetry(input: {
  readonly capabilityId: string;
  readonly failure: unknown;
  readonly attempt: number;
}): RetryDecision {
  if (!isNormalizedFailure(input.failure) || !Number.isInteger(input.attempt)
    || input.attempt < 1 || input.attempt > MAX_EXECUTION_STEP_ATTEMPTS) {
    return { action: "recovery_required" };
  }

  if (input.failure.retrySafety === "TERMINAL") return { action: "fail" };
  if (input.failure.retrySafety === "RECOVERY_REQUIRED"
    || !hasQualifiedReplaySafety(input.capabilityId, input.failure)) {
    return { action: "recovery_required" };
  }

  if (input.attempt >= MAX_EXECUTION_STEP_ATTEMPTS) return { action: "fail" };
  const policyDelay = RETRY_BACKOFF_MS[input.attempt - 1];
  const retryAfter = Math.min(input.failure.retryAfterMs ?? 0, MAX_RETRY_DELAY_MS);
  return {
    action: "retry",
    backoffMs: Math.min(MAX_RETRY_DELAY_MS, Math.max(policyDelay, retryAfter)),
  };
}
