/**
 * Minimizes verified Supabase JWT AAL/AMR claims into the exact facts the
 * CAPA authorization boundary needs.
 *
 * Raw JWTs, access tokens, refresh tokens, MFA codes, factor secrets and
 * browser-supplied assurance claims must never cross this boundary.
 */

export const SUPABASE_CAPA_VERIFIED_AAL_VALUES = [
  "aal1",
  "aal2",
] as const;

export type SupabaseCapaVerifiedAal =
  (typeof SUPABASE_CAPA_VERIFIED_AAL_VALUES)[number];

export const SUPABASE_CAPA_QUALIFYING_MFA_AMR_METHODS = [
  "totp",
  "mfa/totp",
  "mfa/phone",
  "mfa/webauthn",
] as const;

export type SupabaseCapaQualifyingMfaAmrMethod =
  (typeof SUPABASE_CAPA_QUALIFYING_MFA_AMR_METHODS)[number];

export interface SupabaseCapaStepUpFacts {
  readonly verified_aal:
    SupabaseCapaVerifiedAal;

  /**
   * Present only when a verified JWT contains a timestamped qualifying
   * second-factor AMR entry.
   *
   * Absence is intentional and fail-closed: aal2 without timestamped AMR
   * proves elevated assurance but does not prove recency.
   */
  readonly verified_reauthenticated_at_epoch_seconds?:
    number;
}

export class SupabaseCapaStepUpFactsError
  extends Error {
  constructor(
    readonly reason_code:
      "INVALID_VERIFIED_AAL",
  ) {
    super(
      "Verified Supabase step-up facts could not be minimized safely.",
    );

    this.name =
      "SupabaseCapaStepUpFactsError";
  }
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isQualifyingMfaMethod(
  value: unknown,
): value is
  SupabaseCapaQualifyingMfaAmrMethod {
  return (
    value === "totp" ||
    value === "mfa/totp" ||
    value === "mfa/phone" ||
    value === "mfa/webauthn"
  );
}

function latestQualifyingTimestamp(
  amr: unknown,
): number | undefined {
  if (!Array.isArray(amr)) {
    return undefined;
  }

  let latest:
    number | undefined;

  for (const entry of amr) {
    /*
     * Legacy RFC-8176 string AMR values prove method presence only.
     * They do not contain a trusted verification time and therefore cannot
     * satisfy CAPA step-up recency.
     */
    if (typeof entry === "string") {
      continue;
    }

    if (
      !isPlainObject(entry) ||
      !isQualifyingMfaMethod(
        entry.method,
      ) ||
      !Number.isSafeInteger(
        entry.timestamp,
      ) ||
      (entry.timestamp as number) <= 0
    ) {
      continue;
    }

    const timestamp =
      entry.timestamp as number;

    if (
      latest === undefined ||
      timestamp > latest
    ) {
      latest = timestamp;
    }
  }

  return latest;
}

/**
 * Derives minimized CAPA authentication facts from already-verified
 * Supabase JWT claims.
 *
 * This function does not verify a JWT. Its caller must supply claims only
 * after server-side cryptographic or Auth-server verification.
 */
export function deriveSupabaseCapaStepUpFacts(
  input: {
    readonly aal: unknown;
    readonly amr: unknown;
  },
): SupabaseCapaStepUpFacts {
  if (
    input.aal !== "aal1" &&
    input.aal !== "aal2"
  ) {
    throw new SupabaseCapaStepUpFactsError(
      "INVALID_VERIFIED_AAL",
    );
  }

  if (input.aal === "aal1") {
    return Object.freeze({
      verified_aal:
        "aal1",
    });
  }

  const reauthenticatedAt =
    latestQualifyingTimestamp(
      input.amr,
    );

  return Object.freeze({
    verified_aal:
      "aal2",

    ...(reauthenticatedAt === undefined
      ? {}
      : {
          verified_reauthenticated_at_epoch_seconds:
            reauthenticatedAt,
        }),
  });
}
