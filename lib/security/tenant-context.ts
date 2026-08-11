import type {
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RoleId,
} from "../capa/domain/capa-types";

/**
 * Server-derived tenant and role-assignment context.
 *
 * Primary source:
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 * SEC-AC-001 through SEC-AC-003
 *
 * Authentication is not authorization. A valid authentication context
 * must be evaluated separately from this tenant context.
 */

type BrandedTenantId<Name extends string> = string & {
  readonly __brand: Name;
};

export type TenantAccessGrantId =
  BrandedTenantId<"TenantAccessGrantId">;

export type RoleAssignmentId =
  BrandedTenantId<"RoleAssignmentId">;

/**
 * Server-resolved role assignment.
 *
 * Role names, permission profiles and segregation-of-duties rules are
 * intentionally not hardcoded because SEC-TBD-003 remains open.
 */
export interface TenantRoleAssignment {
  readonly role_assignment_id: RoleAssignmentId;
  readonly role_id: RoleId;
  readonly scope: ControlledCode;
  readonly effective_at: IsoDateTime;
  readonly expires_at?: IsoDateTime;
}

/**
 * Active organization context derived from trusted server-side identity,
 * membership, service-scope or approved support-access records.
 *
 * The browser must not be allowed to construct an authoritative instance
 * of this context from request-body values.
 */
export interface TenantContext {
  readonly organization_id: OrganizationId;
  readonly access_grant_id: TenantAccessGrantId;
  readonly access_path: ControlledCode;
  readonly authorization_policy_version: string;
  readonly resolved_at: IsoDateTime;
  readonly role_assignments:
    readonly TenantRoleAssignment[];
}

/**
 * Minimal organization ownership contract for a tenant-bound resource.
 */
export interface TenantOwnedResource {
  readonly organization_id: OrganizationId;
}

/**
 * Safe tenant-boundary decision.
 *
 * The denial response deliberately does not reveal whether the requested
 * resource exists in another organization.
 */
export type TenantBoundaryDecision =
  | {
      readonly allowed: true;
      readonly reason_code: "TENANT_MATCH";
    }
  | {
      readonly allowed: false;
      readonly reason_code: "TENANT_SCOPE_DENIED";
    };

/**
 * Evaluates the mandatory organization boundary before object access.
 *
 * Trace: TEN-001, TEN-002, AUTH-001, SEC-AC-002
 */
export function evaluateTenantBoundary(
  context: TenantContext,
  resource: TenantOwnedResource,
): TenantBoundaryDecision {
  if (
    context.organization_id === resource.organization_id
  ) {
    return {
      allowed: true,
      reason_code: "TENANT_MATCH",
    };
  }

  return {
    allowed: false,
    reason_code: "TENANT_SCOPE_DENIED",
  };
}

/**
 * Determines whether a role assignment is active using trusted server
 * time.
 *
 * Invalid dates fail closed.
 */
export function isRoleAssignmentActive(
  assignment: TenantRoleAssignment,
  trustedNow: Date,
): boolean {
  const effectiveTime = Date.parse(
    assignment.effective_at,
  );

  if (
    !Number.isFinite(effectiveTime) ||
    effectiveTime > trustedNow.getTime()
  ) {
    return false;
  }

  if (assignment.expires_at === undefined) {
    return true;
  }

  const expirationTime = Date.parse(
    assignment.expires_at,
  );

  return (
    Number.isFinite(expirationTime) &&
    expirationTime > trustedNow.getTime()
  );
}

/**
 * Returns only active role assignments.
 *
 * This does not itself grant a permission. Authorization must still
 * evaluate operation, object, relationship, workflow state, version,
 * purpose, segregation of duties and step-up assurance.
 */
export function getActiveRoleAssignments(
  context: TenantContext,
  trustedNow: Date,
): readonly TenantRoleAssignment[] {
  return context.role_assignments.filter((assignment) =>
    isRoleAssignmentActive(assignment, trustedNow),
  );
}

/**
 * Checks whether the context has a currently active assignment for an
 * exact role identifier.
 *
 * This is an input to authorization, not a complete authorization
 * decision.
 */
export function hasActiveRoleAssignment(
  context: TenantContext,
  roleId: RoleId,
  trustedNow: Date,
): boolean {
  return context.role_assignments.some(
    (assignment) =>
      assignment.role_id === roleId &&
      isRoleAssignmentActive(assignment, trustedNow),
  );
}