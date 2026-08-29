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
 * Supabase-to-CAPA authenticated-context contracts and development
 * resolver.
 *
 * Primary source:
 * Document #9 â€” LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * IAM-001 through IAM-010
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 *
 * The provider-neutral contracts and authentication resolver are shared
 * by development and durable context resolvers. The development tenant
 * mapping remains explicitly temporary and must never be selected for
 * production CAPA operations.
 *
 * This module must not receive or retain access tokens, refresh tokens,
 * provider tokens, passwords, MFA secrets, user_metadata, or
 * browser-supplied authorization fields.
 */
const DEVELOPMENT_POLICY_VERSION =
  "development-policy-1.0.0";

const DEVELOPMENT_ROLE_ID =
  "CAPA_OWNER" as RoleId;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Minimal identity and session facts verified by trusted server code.
 *
 * Raw credentials and authentication tokens are deliberately excluded.
 */
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

  /**
   * Authenticator Assurance Level obtained only from a server-verified
   * Supabase JWT.
   *
   * Optional for compatibility with pre-step-up callers. Absence is treated
   * as aal1 and can never satisfy a controlled CAPA gate.
   */
  readonly verified_aal?:
    | "aal1"
    | "aal2";

  /**
   * Unix timestamp of the latest qualifying MFA AMR event derived from a
   * server-verified JWT.
   *
   * It is deliberately absent for legacy string-form AMR because those
   * values do not prove authentication recency.
   */
  readonly verified_reauthenticated_at_epoch_seconds?:
    number;
}

/**
 * Provider-neutral trusted context used by CAPA application commands.
 *
 * Implementations may resolve this context from development fixtures or
 * durable organization membership and role-assignment records.
 */
export interface CapaRequestContext {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly owner_user_id: UserId;
}

/**
 * Validated identity shared by development and durable CAPA context
 * resolvers.
 */
export interface SupabaseAuthenticationResolution {
  readonly authentication: AuthenticationContext;
  readonly user_id: UserId;
}

/**
 * Context-resolver contract used by the CAPA API boundary.
 *
 * A resolver must use server-verified identity facts and trusted server
 * time. Browser-supplied organization, owner, role, or authorization
 * fields must never be treated as authoritative.
 */
export type SupabaseCapaContextResolver = (
  facts: SupabaseCapaSessionFacts,
  trustedNow: Date,
) =>
  | CapaRequestContext
  | Promise<CapaRequestContext>;

/**
 * Compatibility alias for development-specific callers.
 */
export type DevelopmentCapaRequestContext =
  CapaRequestContext;

export type SupabaseCapaContextFailureReason =
  | "INVALID_USER_ID"
  | "INVALID_AUTHENTICATED_AT"
  | "INVALID_SESSION_EXPIRATION"
  | "INVALID_ASSURANCE_LEVEL"
  | "INVALID_REAUTHENTICATION_AT"
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
): UserId {
  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    !UUID_PATTERN.test(normalized)
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_USER_ID",
    );
  }

  return normalized as UserId;
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

function verifiedAal(
  value:
    | "aal1"
    | "aal2"
    | undefined,
):
  | "aal1"
  | "aal2" {
  if (value === undefined) {
    return "aal1";
  }

  if (
    value !== "aal1" &&
    value !== "aal2"
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_ASSURANCE_LEVEL",
    );
  }

  return value;
}

function parseVerifiedReauthentication(
  value: number | undefined,
  aal:
    | "aal1"
    | "aal2",
  authenticatedAt: Date,
  expiresAt: Date,
  trustedNow: Date,
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    aal !== "aal2" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_REAUTHENTICATION_AT",
    );
  }

  const milliseconds =
    value * 1_000;

  if (
    !Number.isFinite(milliseconds)
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_REAUTHENTICATION_AT",
    );
  }

  const timestamp =
    new Date(milliseconds);

  if (
    timestamp.getTime() <
      authenticatedAt.getTime() ||
    timestamp.getTime() >
      trustedNow.getTime() ||
    timestamp.getTime() >=
      expiresAt.getTime()
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_REAUTHENTICATION_AT",
    );
  }

  return timestamp;
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

  const expirationMilliseconds =
    value * 1_000;

  if (
    !Number.isFinite(
      expirationMilliseconds,
    )
  ) {
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

  return new Date(
    expirationMilliseconds,
  );
}

/**
 * Validates minimized server-verified Supabase session facts and creates
 * a provider-neutral authentication context.
 *
 * Tenant membership and authorization are deliberately not resolved
 * here. Development and durable resolvers perform those operations
 * separately.
 */
export function resolveSupabaseAuthenticationContext(
  facts: SupabaseCapaSessionFacts,
  trustedNow: Date,
): SupabaseAuthenticationResolution {
  if (
    !Number.isFinite(
      trustedNow.getTime(),
    )
  ) {
    throw new SupabaseCapaContextError(
      "INVALID_AUTHENTICATED_AT",
    );
  }

  const userId =
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

  const aal =
    verifiedAal(
      facts.verified_aal,
    );

  const reauthenticatedAt =
    parseVerifiedReauthentication(
      facts.verified_reauthenticated_at_epoch_seconds,
      aal,
      authenticatedAt,
      expiresAt,
      trustedNow,
    );

  return {
    user_id: userId,

    authentication: {
      principal: {
        principal_type: "human",
        user_id: userId,
      },

      /*
       * This is a non-secret internal reference. It is not the Supabase
       * access token, refresh token, or provider token.
       */
      session_id:
        `supabase:${userId}:${facts.expires_at_epoch_seconds}` as
          SessionId,

      authentication_method:
        controlled("SUPABASE_SESSION"),

      /**
       * aal2 is accepted only when it originated from server-verified
       * Supabase JWT claims. A timestamped qualifying MFA AMR event is
       * independently required to establish recent reauthentication.
       */
      assurance_level:
        controlled(
          aal === "aal2"
            ? "MFA"
            : "SINGLE_FACTOR",
        ),

      authenticated_at:
        iso(authenticatedAt),

      expires_at:
        iso(expiresAt),

      ...(reauthenticatedAt === undefined
        ? {}
        : {
            reauthenticated_at:
              iso(
                reauthenticatedAt,
              ),
          }),
    },
  };
}

/**
 * Resolves a temporary single-user development tenant.
 *
 * The server-verified Supabase user identity is also used as the
 * development organization identity. This provides deterministic
 * per-user isolation without trusting a tenant identifier supplied by
 * the browser.
 *
 * This resolver must never be selected for production CAPA operations.
 * Production requires durable organization membership, role assignment,
 * organization status, and policy-version resolution.
 */
export function resolveDevelopmentCapaRequestContext(
  facts: SupabaseCapaSessionFacts,
  trustedNow: Date,
): CapaRequestContext {
  const {
    authentication,
    user_id: userId,
  } = resolveSupabaseAuthenticationContext(
    facts,
    trustedNow,
  );

  /*
   * This cast is confined to the temporary development mapping. Durable
   * resolvers obtain an independent organization UUID from membership.
   */
  const organizationId =
    userId as unknown as OrganizationId;

  const tenant: TenantContext = {
    organization_id:
      organizationId,

    access_grant_id:
      `development-access:${userId}` as
        TenantAccessGrantId,

    access_path:
      controlled(
        "DEVELOPMENT_SINGLE_USER_TENANT",
      ),

    authorization_policy_version:
      DEVELOPMENT_POLICY_VERSION,

    resolved_at:
      iso(trustedNow),

    role_assignments: [
      {
        role_assignment_id:
          `development-role:${userId}` as
            RoleAssignmentId,

        role_id:
          DEVELOPMENT_ROLE_ID,

        scope:
          controlled("ORGANIZATION"),

        effective_at:
          authentication.authenticated_at,

        expires_at:
          authentication.expires_at,
      },
    ],
  };

  return {
    authentication,
    tenant,
    owner_user_id: userId,
  };
}