import { describe, expect, it } from "vitest";

import type {
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RoleId,
} from "../../lib/capa/domain/capa-types";

import {
  evaluateTenantBoundary,
  getActiveRoleAssignments,
  hasActiveRoleAssignment,
  isRoleAssignmentActive,
  type RoleAssignmentId,
  type TenantAccessGrantId,
  type TenantContext,
  type TenantRoleAssignment,
} from "../../lib/security/tenant-context";

/**
 * Requirements-traced tenant-isolation tests.
 *
 * Primary source:
 * Document #9 — Security, Privacy, and Access-Control Specification
 *
 * Traceability:
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 * SEC-T-001
 * SEC-T-002
 * SEC-AC-001 through SEC-AC-003
 */

const TRUSTED_NOW = new Date("2026-08-11T15:00:00.000Z");

const ORGANIZATION_A =
  "550e8400-e29b-41d4-a716-446655440000" as OrganizationId;

const ORGANIZATION_B =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23" as OrganizationId;

const INVESTIGATOR_ROLE =
  "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as RoleId;

const REVIEWER_ROLE =
  "a65d17e5-4688-4412-aa08-f2832b37f671" as RoleId;

function iso(value: string): IsoDateTime {
  return value as IsoDateTime;
}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function roleAssignment(
  overrides: Partial<TenantRoleAssignment> = {},
): TenantRoleAssignment {
  return {
    role_assignment_id:
      "779594ce-cb78-4818-a173-4c1e8217637f" as RoleAssignmentId,
    role_id: INVESTIGATOR_ROLE,
    scope: controlled("CAPA.ASSIGNED"),
    effective_at: iso("2026-08-11T14:00:00.000Z"),
    ...overrides,
  };
}

function tenantContext(
  roleAssignments: readonly TenantRoleAssignment[] = [],
): TenantContext {
  return {
    organization_id: ORGANIZATION_A,
    access_grant_id:
      "c0cf1844-61b9-432b-8355-f6c13fe48e67" as TenantAccessGrantId,
    access_path: controlled("HUMAN_MEMBERSHIP"),
    authorization_policy_version: "policy-1.0.0",
    resolved_at: iso("2026-08-11T14:59:00.000Z"),
    role_assignments: roleAssignments,
  };
}

describe("tenant-boundary evaluation", () => {
  it("allows access when organization boundaries match", () => {
    expect(
      evaluateTenantBoundary(tenantContext(), {
        organization_id: ORGANIZATION_A,
      }),
    ).toEqual({
      allowed: true,
      reason_code: "TENANT_MATCH",
    });
  });

  it("denies cross-tenant access without revealing existence", () => {
    expect(
      evaluateTenantBoundary(tenantContext(), {
        organization_id: ORGANIZATION_B,
      }),
    ).toEqual({
      allowed: false,
      reason_code: "TENANT_SCOPE_DENIED",
    });
  });
});

describe("role-assignment activity", () => {
  it("accepts an effective assignment with no expiration", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment(),
        TRUSTED_NOW,
      ),
    ).toBe(true);
  });

  it("accepts an unexpired assignment", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment({
          expires_at: iso(
            "2026-08-11T15:30:00.000Z",
          ),
        }),
        TRUSTED_NOW,
      ),
    ).toBe(true);
  });

  it("accepts an assignment effective exactly now", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment({
          effective_at: iso(
            "2026-08-11T15:00:00.000Z",
          ),
        }),
        TRUSTED_NOW,
      ),
    ).toBe(true);
  });

  it("rejects a future assignment", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment({
          effective_at: iso(
            "2026-08-11T15:00:01.000Z",
          ),
        }),
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });

  it("rejects an assignment expiring exactly now", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment({
          expires_at: iso(
            "2026-08-11T15:00:00.000Z",
          ),
        }),
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });

  it("rejects an expired assignment", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment({
          expires_at: iso(
            "2026-08-11T14:59:59.000Z",
          ),
        }),
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });

  it("fails closed for an invalid effective timestamp", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment({
          effective_at: iso("invalid-date"),
        }),
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });

  it("fails closed for an invalid expiration timestamp", () => {
    expect(
      isRoleAssignmentActive(
        roleAssignment({
          expires_at: iso("invalid-date"),
        }),
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });
});

describe("active-role queries", () => {
  it("returns only currently active assignments", () => {
    const active = roleAssignment();
    const expired = roleAssignment({
      role_assignment_id:
        "bed889a5-8a47-4dd8-bebf-f79f31b795e7" as RoleAssignmentId,
      role_id: REVIEWER_ROLE,
      expires_at: iso("2026-08-11T14:00:00.000Z"),
    });

    expect(
      getActiveRoleAssignments(
        tenantContext([active, expired]),
        TRUSTED_NOW,
      ),
    ).toEqual([active]);
  });

  it("finds an exact active role assignment", () => {
    expect(
      hasActiveRoleAssignment(
        tenantContext([roleAssignment()]),
        INVESTIGATOR_ROLE,
        TRUSTED_NOW,
      ),
    ).toBe(true);
  });

  it("rejects a role that is not assigned", () => {
    expect(
      hasActiveRoleAssignment(
        tenantContext([roleAssignment()]),
        REVIEWER_ROLE,
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });

  it("rejects an assigned role when its assignment is inactive", () => {
    const futureAssignment = roleAssignment({
      effective_at: iso("2026-08-11T16:00:00.000Z"),
    });

    expect(
      hasActiveRoleAssignment(
        tenantContext([futureAssignment]),
        INVESTIGATOR_ROLE,
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });

  it("returns false when no role assignments exist", () => {
    expect(
      hasActiveRoleAssignment(
        tenantContext(),
        INVESTIGATOR_ROLE,
        TRUSTED_NOW,
      ),
    ).toBe(false);
  });
});