import type postgres from "postgres";

import type {
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RoleId,
} from "../capa/domain/capa-types";

import type {
  RoleAssignmentId,
  TenantAccessGrantId,
  TenantContext,
  TenantRoleAssignment,
} from "./tenant-context";

import {
  resolveSupabaseAuthenticationContext,
  type CapaRequestContext,
  type SupabaseCapaSessionFacts,
} from "./supabase-capa-context";

/**
 * Durable, server-only Supabase-to-CAPA tenant-context resolver.
 *
 * Primary source:
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * IAM-001 through IAM-010
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 * SEC-AC-001 through SEC-AC-003
 *
 * This resolver uses only server-verified authentication facts and
 * durable organization, membership, and role-assignment records. It
 * never accepts an organization, owner, role, or permission from the
 * browser.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

interface MembershipRow extends postgres.Row {
  readonly membership_id: string;
  readonly organization_id: string;
  readonly authorization_policy_version: string;
}

interface RoleAssignmentRow extends postgres.Row {
  readonly role_assignment_id: string;
  readonly role_id: string;
  readonly scope_code: string;
  readonly effective_at: Date | string;
  readonly expires_at: Date | string | null;
}

export type SupabaseCapaTenantAccessFailureReason =
  | "NO_ACTIVE_MEMBERSHIP"
  | "AMBIGUOUS_ACTIVE_MEMBERSHIP"
  | "INVALID_MEMBERSHIP_DATA"
  | "INVALID_ROLE_ASSIGNMENT_DATA";

/**
 * Tenant-safe access failure raised after authentication succeeds.
 *
 * The public message intentionally does not reveal organization or role
 * existence. reason_code is suitable for controlled server diagnostics,
 * not an unfiltered browser response.
 */
export class SupabaseCapaTenantAccessError extends Error {
  constructor(
    readonly reason_code:
      SupabaseCapaTenantAccessFailureReason,
  ) {
    super(
      "The authenticated user does not have an unambiguous active CAPA tenant context.",
    );

    this.name = "SupabaseCapaTenantAccessError";
  }
}

function tenantAccessError(
  reason:
    SupabaseCapaTenantAccessFailureReason,
): never {
  throw new SupabaseCapaTenantAccessError(
    reason,
  );
}

function requireUuid(
  value: string,
  reason:
    SupabaseCapaTenantAccessFailureReason,
): string {
  if (!UUID_PATTERN.test(value)) {
    return tenantAccessError(reason);
  }

  return value;
}

function requireControlledCode(
  value: string,
  reason:
    SupabaseCapaTenantAccessFailureReason,
): ControlledCode {
  if (
    value.length < 1 ||
    value.length > 64 ||
    !CONTROLLED_CODE_PATTERN.test(value)
  ) {
    return tenantAccessError(reason);
  }

  return value as ControlledCode;
}

function requirePolicyVersion(
  value: string,
): string {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 100
  ) {
    return tenantAccessError(
      "INVALID_MEMBERSHIP_DATA",
    );
  }

  return value;
}

function databaseIso(
  value: Date | string,
  reason:
    SupabaseCapaTenantAccessFailureReason,
): IsoDateTime {
  const parsed =
    value instanceof Date
      ? value
      : new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return tenantAccessError(reason);
  }

  return parsed.toISOString() as IsoDateTime;
}

function optionalDatabaseIso(
  value: Date | string | null,
  reason:
    SupabaseCapaTenantAccessFailureReason,
): IsoDateTime | undefined {
  return value === null
    ? undefined
    : databaseIso(value, reason);
}

function roleAssignment(
  row: RoleAssignmentRow,
): TenantRoleAssignment {
  const reason =
    "INVALID_ROLE_ASSIGNMENT_DATA" as const;

  if (row.scope_code !== "ORGANIZATION") {
    return tenantAccessError(reason);
  }

  const expiresAt = optionalDatabaseIso(
    row.expires_at,
    reason,
  );

  return {
    role_assignment_id:
      requireUuid(
        row.role_assignment_id,
        reason,
      ) as RoleAssignmentId,

    role_id:
      requireControlledCode(
        row.role_id,
        reason,
      ) as unknown as RoleId,

    scope:
      requireControlledCode(
        row.scope_code,
        reason,
      ),

    effective_at:
      databaseIso(
        row.effective_at,
        reason,
      ),

    ...(expiresAt === undefined
      ? {}
      : {
          expires_at: expiresAt,
        }),
  };
}

export class SupabaseCapaDurableContextResolver {
  constructor(
    private readonly sql: postgres.Sql,
  ) {}

  readonly resolve = async (
      facts: SupabaseCapaSessionFacts,
      trustedNow: Date,
    ): Promise<CapaRequestContext> => {
      const {
        authentication,
        user_id: userId,
      } = resolveSupabaseAuthenticationContext(
        facts,
        trustedNow,
      );

      const trustedNowIso =
        trustedNow.toISOString();

      /*
       * limit 2 is deliberate: one row is unambiguous, zero denies, and
       * two proves that an explicit organization-selection mechanism is
       * required before access can continue.
       */
      const memberships =
        await this.sql<MembershipRow[]>`
          select
            membership.membership_id,
            membership.organization_id,
            organization.authorization_policy_version
          from public.capa_organization_memberships
            as membership
          join public.capa_organizations
            as organization
            on organization.organization_id =
              membership.organization_id
          where membership.user_id = ${userId}
            and membership.status = 'active'
            and membership.effective_at <=
              ${trustedNowIso}
            and (
              membership.expires_at is null
              or membership.expires_at >
                ${trustedNowIso}
            )
            and organization.status = 'active'
            and organization.effective_at <=
              ${trustedNowIso}
            and (
              organization.superseded_at is null
              or organization.superseded_at >
                ${trustedNowIso}
            )
          order by membership.organization_id,
            membership.membership_id
          limit 2
        `;

      if (memberships.length === 0) {
        return tenantAccessError(
          "NO_ACTIVE_MEMBERSHIP",
        );
      }

      if (memberships.length !== 1) {
        return tenantAccessError(
          "AMBIGUOUS_ACTIVE_MEMBERSHIP",
        );
      }

      const membership = memberships[0];

      if (membership === undefined) {
        return tenantAccessError(
          "INVALID_MEMBERSHIP_DATA",
        );
      }

      const membershipId =
        requireUuid(
          membership.membership_id,
          "INVALID_MEMBERSHIP_DATA",
        );

      const organizationId =
        requireUuid(
          membership.organization_id,
          "INVALID_MEMBERSHIP_DATA",
        ) as OrganizationId;

      const assignmentRows =
        await this.sql<RoleAssignmentRow[]>`
          select
            assignment.role_assignment_id,
            assignment.role_id,
            assignment.scope_code,
            assignment.effective_at,
            assignment.expires_at
          from public.capa_role_assignments
            as assignment
          join public.capa_roles as role
            on role.role_id = assignment.role_id
          where assignment.organization_id =
              ${organizationId}
            and assignment.membership_id =
              ${membershipId}
            and assignment.user_id = ${userId}
            and assignment.status = 'active'
            and assignment.scope_code =
              'ORGANIZATION'
            and assignment.effective_at <=
              ${trustedNowIso}
            and (
              assignment.expires_at is null
              or assignment.expires_at >
                ${trustedNowIso}
            )
            and role.status = 'active'
          order by assignment.role_assignment_id
        `;

      const tenant: TenantContext = {
        organization_id:
          organizationId,

        access_grant_id:
          membershipId as TenantAccessGrantId,

        access_path:
          "SUPABASE_MEMBERSHIP" as ControlledCode,

        authorization_policy_version:
          requirePolicyVersion(
            membership.authorization_policy_version,
          ),

        resolved_at:
          trustedNowIso as IsoDateTime,

        role_assignments:
          assignmentRows.map(
            roleAssignment,
          ),
      };

      return {
        authentication,
        tenant,
        owner_user_id: userId,
      };
    };
}