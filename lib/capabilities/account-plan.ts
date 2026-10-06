export type AccountPlan = "free" | "pro";

export type AccountPlanResolution =
  | { readonly kind: "resolved"; readonly userId: string; readonly plan: AccountPlan }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_account" }
  | { readonly kind: "lookup_failed" };

export type ProfilePlanLookup = (
  userId: string,
) => PromiseLike<{ readonly plan: unknown | null; readonly error?: unknown | null }>;

/** Resolves profiles.plan without conflating database failure with genuine Free. */
export async function resolveAccountPlan(params: {
  readonly userId: string;
  readonly lookup: ProfilePlanLookup;
}): Promise<AccountPlanResolution> {
  let result: Awaited<ReturnType<ProfilePlanLookup>>;
  try {
    result = await params.lookup(params.userId);
  } catch {
    return { kind: "lookup_failed" };
  }

  if (typeof result !== "object" || result === null) {
    return { kind: "lookup_failed" };
  }
  if (result.error) return { kind: "lookup_failed" };
  if (result.plan === null) return { kind: "not_found" };
  if (result.plan !== "free" && result.plan !== "pro") {
    return { kind: "invalid_account" };
  }

  return { kind: "resolved", userId: params.userId, plan: result.plan };
}
