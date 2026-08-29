/**
 * Pure browser-presentation helpers for controlled Supabase TOTP step-up.
 *
 * These helpers never receive access tokens, refresh tokens, TOTP secrets,
 * challenge identifiers or raw session objects.
 */

export interface SupabaseMfaFactorOptionInput {
  readonly id: string;
  readonly factor_type: string;
  readonly status: string;
  readonly friendly_name?: string | null;
}

export interface SupabaseVerifiedTotpFactorOption {
  readonly factor_id: string;
  readonly label: string;
}

export function verifiedTotpFactorOptions(
  factors:
    readonly SupabaseMfaFactorOptionInput[],
): readonly SupabaseVerifiedTotpFactorOption[] {
  const options:
    SupabaseVerifiedTotpFactorOption[] = [];

  const seen =
    new Set<string>();

  for (const factor of factors) {
    const factorId =
      factor.id.trim();

    if (
      factor.factor_type !== "totp" ||
      factor.status !== "verified" ||
      factorId.length === 0 ||
      seen.has(factorId)
    ) {
      continue;
    }

    seen.add(factorId);

    const friendlyName =
      factor.friendly_name?.trim();

    options.push(
      Object.freeze({
        factor_id:
          factorId,

        label:
          friendlyName === undefined ||
          friendlyName.length === 0
            ? `Authenticator ${options.length + 1}`
            : `${friendlyName} · ${options.length + 1}`,
      }),
    );
  }

  return Object.freeze(
    [...options],
  );
}

export function normalizedTotpCode(
  value: string,
): string | null {
  const normalized =
    value.trim();

  return /^\d{6}$/.test(
    normalized,
  )
    ? normalized
    : null;
}

function isRecord(
  value: unknown,
): value is Readonly<
  Record<string, unknown>
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Browser-side confirmation only.
 *
 * This is deliberately not an authorization decision. The CAPA server must
 * independently verify the JWT and enforce trusted AAL/AMR recency.
 */
export function hasTimestampedTotpAuthenticationMethod(
  methods: unknown,
): boolean {
  if (!Array.isArray(methods)) {
    return false;
  }

  for (const entry of methods) {
    /*
     * String-form AMR proves method presence but carries no trustworthy
     * recency timestamp. It cannot satisfy controlled step-up confirmation.
     */
    if (
      typeof entry === "string" ||
      !isRecord(entry)
    ) {
      continue;
    }

    const method =
      entry.method;

    const timestamp =
      entry.timestamp;

    if (
      (
        method === "totp" ||
        method === "mfa/totp"
      ) &&
      typeof timestamp === "number" &&
      Number.isSafeInteger(
        timestamp,
      ) &&
      timestamp > 0
    ) {
      return true;
    }
  }

  return false;
}
