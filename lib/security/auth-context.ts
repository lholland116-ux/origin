import type {
  ControlledCode,
  IsoDateTime,
  UserId,
} from "../capa/domain/capa-types";

/**
 * Provider-neutral authenticated identity context.
 *
 * Primary source:
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * IAM-001 through IAM-010
 * AUTH-001 through AUTH-010
 * SEC-AC-001
 *
 * This module does not grant authorization. It only represents
 * server-verified authentication facts.
 */

type BrandedSecurityId<Name extends string> = string & {
  readonly __brand: Name;
};

export type SessionId = BrandedSecurityId<"SessionId">;
export type ServiceIdentityId =
  BrandedSecurityId<"ServiceIdentityId">;

export type AuthenticatedPrincipal =
  | {
      readonly principal_type: "human";
      readonly user_id: UserId;
    }
  | {
      readonly principal_type: "service";
      readonly service_identity_id: ServiceIdentityId;
    };

/**
 * Server-verified authentication facts.
 *
 * session_id is an internal reference only. Raw session tokens,
 * passwords, MFA secrets, recovery codes and provider credentials must
 * never be placed in this object, logs or audit events.
 */
export interface AuthenticationContext {
  readonly principal: AuthenticatedPrincipal;
  readonly session_id: SessionId;
  readonly authentication_method: ControlledCode;
  readonly assurance_level: ControlledCode;
  readonly authenticated_at: IsoDateTime;
  readonly expires_at: IsoDateTime;
  readonly reauthenticated_at?: IsoDateTime;
}

/**
 * Returns true when the authenticated principal represents a named human.
 */
export function isHumanPrincipal(
  context: AuthenticationContext,
): context is AuthenticationContext & {
  readonly principal: {
    readonly principal_type: "human";
    readonly user_id: UserId;
  };
} {
  return context.principal.principal_type === "human";
}

/**
 * Returns true when the authenticated principal represents a restricted
 * non-human service identity.
 */
export function isServicePrincipal(
  context: AuthenticationContext,
): context is AuthenticationContext & {
  readonly principal: {
    readonly principal_type: "service";
    readonly service_identity_id: ServiceIdentityId;
  };
} {
  return context.principal.principal_type === "service";
}

/**
 * Evaluates whether the server-verified session is unexpired.
 *
 * The caller supplies trusted server time. Client time must never be used
 * to extend session validity.
 */
export function isSessionActive(
  context: AuthenticationContext,
  trustedNow: Date,
): boolean {
  const expirationTime = Date.parse(context.expires_at);

  return (
    Number.isFinite(expirationTime) &&
    expirationTime > trustedNow.getTime()
  );
}

/**
 * Evaluates whether recent reauthentication satisfies a caller-provided
 * maximum age.
 *
 * Exact maximum-age values remain configuration decisions under
 * SEC-TBD-002 and must not be hardcoded here.
 */
export function hasRecentReauthentication(
  context: AuthenticationContext,
  trustedNow: Date,
  maximumAgeMs: number,
): boolean {
  if (
    !Number.isFinite(maximumAgeMs) ||
    maximumAgeMs < 0 ||
    context.reauthenticated_at === undefined
  ) {
    return false;
  }

  const reauthenticatedTime = Date.parse(
    context.reauthenticated_at,
  );

  if (!Number.isFinite(reauthenticatedTime)) {
    return false;
  }

  const ageMs =
    trustedNow.getTime() - reauthenticatedTime;

  return ageMs >= 0 && ageMs <= maximumAgeMs;
}