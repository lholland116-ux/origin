import type {
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RoleId,
  UserId,
} from "../capa/domain/capa-types";

import type {
  AuthenticationContext,
  SessionId,
} from "./auth-context";

import type {
  RoleAssignmentId,
  TenantAccessGrantId,
  TenantContext,
} from "./tenant-context";

/**
 * Development-only Supabase-to-CAPA context adapter.
 *
 * Primary source:
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * IAM-001 through IAM-010
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 *
 * This adapter supports development testing before the permanent
 * organization-membership and role-assignment tables are implemented.
 *
 * It must not receive or retain access tokens, refresh tokens, provider
 * tokens, passwords, MFA secrets, user_metadata or browser-supplied
 * authorization fields.
 */

const DEVELOPMENT_POLICY_VERSION =
  "development-policy-1.0.0";

const DEVELOPMENT_ROLE_ID =
  "CAPA_DEVELOPMENT_USER" as RoleId;

export interface SupabaseCapaSessionFacts {
  /**
   * Identity returned by server-side supabase.auth.getUser().
   */
  readonly verified_user_id: string;

  /**
   * Server-verified sign-in timestamp from the authenticated user.
   */
  readonly authenticated_at: string;

  /**
   * Supabase session expiry represented as Unix seconds.
   */
  readonly expires_at_epoch_seconds: number;
}

export interface DevelopmentCapaRequestContext {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly owner_user_id: UserId;
}

export type SupabaseCapaContextFailureReason =
  | "INVALID_USER_ID"
  | "INVALID_AUTHENTICATED_AT"
  | "INVALID_SESSION_EXPIRATION"
  | "SESSION_INACTIVE";

export class SupabaseCapaContextError extends Error {
  constructor(
    readonly reason_code:
      SupabaseCapaContextFailureReason,
  ) {
    super(
      "The authenticated CAPA request context could not be resolved.",
    );

    this.name = "SupabaseCapaContextError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function iso(
  value: Date,
): IsoDateTime {
  return value.toISOString() as IsoDateTime;
}

function requireVerifiedUserId(
  value: string,
): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new SupabaseCapaContextError(
      "INVALID_USER_ID",
    );
  }

  return normalized;
}

function parseAuthenticatedAt(
  value: string,
  trustedNow: Date,
): Date {
  const timestamp = Date.parse(value);

  if (
    !Number.isFinite(timestamp) ||
    timestamp > trustedNow.getTime()
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_AUTHENTICATED_AT",
    );
  }

  return new Date(timestamp);
}

function parseExpiration(
  value: number,
  trustedNow: Date,
): Date {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_SESSION_EXPIRATION",
    );
  }

  const expirationMilliseconds = value * 1_000;

  if (!Number.isFinite(expirationMilliseconds)) {
    throw new SupabaseCapaContextError(
      "INVALID_SESSION_EXPIRATION",
    );
  }

  if (
    expirationMilliseconds <=
    trustedNow.getTime()
  ) {
    throw new SupabaseCapaContextError(
      "SESSION_INACTIVE",
    );
  }

  return new Date(expirationMilliseconds);
}

/**
 * Resolves a temporary single-user development tenant.
 *
 * Until organization membership exists, the server-verified Supabase
 * user identity is also used as the development organization identity.
 * This provides deterministic per-user isolation without trusting a
 * tenant identifier sent by the browser.
 *
 * This mapping must be replaced before production CAPA deployment.
 */
export function resolveDevelopmentCapaRequestContext(
  facts: SupabaseCapaSessionFacts,
  trustedNow: Date,
): DevelopmentCapaRequestContext {
  if (!Number.isFinite(trustedNow.getTime())) {
    throw new SupabaseCapaContextError(
      "INVALID_AUTHENTICATED_AT",
    );
  }

  const verifiedUserId =
    requireVerifiedUserId(
      facts.verified_user_id,
    );

  const authenticatedAt =
    parseAuthenticatedAt(
      facts.authenticated_at,
      trustedNow,
    );

  const expiresAt =
    parseExpiration(
      facts.expires_at_epoch_seconds,
      trustedNow,
    );

  const userId =
    verifiedUserId as UserId;

  const organizationId =
    verifiedUserId as OrganizationId;

  const authentication: AuthenticationContext = {
    principal: {
      principal_type: "human",
      user_id: userId,
    },

    /*
     * This is a non-secret internal reference. It is not the Supabase
     * access token, refresh token or provider token.
     */
    session_id:
      `supabase:${verifiedUserId}:${facts.expires_at_epoch_seconds}` as SessionId,

    authentication_method:
      controlled("SUPABASE_SESSION"),

    /*
     * Do not claim MFA or step-up assurance unless Supabase AMR/AAL
     * evidence is explicitly verified in a future implementation.
     */
    assurance_level:
      controlled("SINGLE_FACTOR"),

    authenticated_at:
      iso(authenticatedAt),

    expires_at:
      iso(expiresAt),
  };

  const tenant: TenantContext = {
    organization_id: organizationId,

    access_grant_id:
      `development-access:${verifiedUserId}` as TenantAccessGrantId,

    access_path:
      controlled(
        "DEVELOPMENT_SINGLE_USER_TENANT",
      ),

    authorization_policy_version:
      DEVELOPMENT_POLICY_VERSION,

    resolved_at: iso(trustedNow),

    role_assignments: [
      {
        role_assignment_id:
          `development-role:${verifiedUserId}` as RoleAssignmentId,

        role_id: DEVELOPMENT_ROLE_ID,

        scope:
          controlled("ORGANIZATION"),

        effective_at:
          iso(authenticatedAt),

        expires_at:
          iso(expiresAt),
      },
    ],
  };

  return {
    authentication,
    tenant,
    owner_user_id: userId,
  };
}