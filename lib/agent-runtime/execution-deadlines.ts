/** Cooperative bounds for one HTTP-triggered trusted worker invocation. */
export const EXECUTION_INVOCATION_BUDGET_MS = 30_000 as const;
export const EXECUTION_PROVIDER_DISPATCH_BUDGET_MS = 20_000 as const;
export const EXECUTION_MIN_PROVIDER_DISPATCH_REMAINING_MS = 5_000 as const;

if (EXECUTION_PROVIDER_DISPATCH_BUDGET_MS >= EXECUTION_INVOCATION_BUDGET_MS
  || EXECUTION_MIN_PROVIDER_DISPATCH_REMAINING_MS >= EXECUTION_PROVIDER_DISPATCH_BUDGET_MS) {
  throw new Error("Trusted execution deadline policy is invalid.");
}
