/**
 * Pure presentation helpers for Supabase TOTP enrollment.
 *
 * These functions never receive a TOTP secret, MFA code, access token,
 * refresh token, provider token or browser authorization assertion.
 */

export interface SupabaseMfaFactorSummaryInput {
  readonly id: string;
  readonly factor_type: string;
  readonly status: string;
}

export interface SupabaseTotpFactorSummary {
  readonly verified_factor_ids:
    readonly string[];

  readonly unverified_factor_ids:
    readonly string[];
}

export function summarizeSupabaseTotpFactors(
  factors:
    readonly SupabaseMfaFactorSummaryInput[],
): SupabaseTotpFactorSummary {
  const verified:
    string[] = [];

  const unverified:
    string[] = [];

  for (const factor of factors) {
    if (
      factor.factor_type !== "totp" ||
      factor.id.trim().length === 0
    ) {
      continue;
    }

    if (factor.status === "verified") {
      verified.push(
        factor.id,
      );
      continue;
    }

    if (factor.status === "unverified") {
      unverified.push(
        factor.id,
      );
    }
  }

  return Object.freeze({
    verified_factor_ids:
      Object.freeze(
        [...verified],
      ),

    unverified_factor_ids:
      Object.freeze(
        [...unverified],
      ),
  });
}

/**
 * Produces a non-executable image data URL for the SVG supplied by the
 * Supabase TOTP enrollment response.
 *
 * URI encoding prevents raw SVG markup from being injected into the page.
 */
export function createSupabaseTotpQrDataUrl(
  svg: string,
): string {
  if (svg.trim().length === 0) {
    throw new Error(
      "A non-empty TOTP QR code is required.",
    );
  }

  return (
    "data:image/svg+xml;utf-8," +
    encodeURIComponent(svg)
  );
}
