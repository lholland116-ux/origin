import { describe, expect, it } from "vitest";

import type {
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../../lib/capa/domain/capa-types";

import {
  HUMAN_ONLY_CAPA_OPERATIONS,
  STEP_UP_CAPA_OPERATIONS,
  evaluateCapaAuthorizationPreconditions,
  requiresHumanAuthority,
  requiresStepUpAuthentication,
  type CapaAuthorizationPreconditionRequest,
} from "../../lib/capa/authorization/capa-permissions";

import type {
  AuthenticationContext,
  ServiceIdentityId,
  SessionId,
} from "../../lib/security/auth-context";

import type {
  TenantAccessGrantId,
  TenantContext,
} from "../../lib/security/tenant-context";

/**
 * Requirements-traced authorization-precondition tests.
 *
 * Traceability:
 * WFR-002
 * WFR-007
 * WFR-013
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

function iso(value: string): IsoDateTime {
  return value as IsoDateTime;
}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function humanAuthentication(
  overrides: Partial<AuthenticationContext> = {},
): AuthenticationContext {
  return {
    principal: {
      principal_type: "human",
      user_id:
        "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as UserId,
    },
    session_id:
      "a65d17e5-4688-4412-aa08-f2832b37f671" as SessionId,
    authentication_method: controlled("OIDC"),
    assurance_level: controlled("MFA"),
    authenticated_at: iso("2026-08-11T14:00:00.000Z"),
    expires_at: iso("2026-08-11T16:00:00.000Z"),
    reauthenticated_at: iso("2026-08-11T14:55:00.000Z"),
    ...overrides,
  };
}

function serviceAuthentication(): AuthenticationContext {
  return {
    principal: {
      principal_type: "service",
      service_identity_id:
        "779594ce-cb78-4818-a173-4c1e8217637f" as ServiceIdentityId,
    },
    session_id:
      "bed889a5-8a47-4dd8-bebf-f79f31b795e7" as SessionId,
    authentication_method: controlled("SERVICE_CREDENTIAL"),
    assurance_level: controlled("SERVICE"),
    authenticated_at: iso("2026-08-11T14:00:00.000Z"),
    expires_at: iso("2026-08-11T16:00:00.000Z"),
  };
}

function tenantContext(): TenantContext {
  return {
    organization_id: ORGANIZATION_A,
    access_grant_id:
      "c0cf1844-61b9-432b-8355-f6c13fe48e67" as TenantAccessGrantId,
    access_path: controlled("HUMAN_MEMBERSHIP"),
    authorization_policy_version: "policy-1.0.0",
    resolved_at: iso("2026-08-11T14:59:00.000Z"),
    role_assignments: [],
  };
}

function request(
  overrides: Partial<CapaAuthorizationPreconditionRequest> = {},
): CapaAuthorizationPreconditionRequest {
  return {
    authentication: humanAuthentication(),
    tenant: tenantContext(),
    resource: {
      organization_id: ORGANIZATION_A,
    },
    operation: "view_case",
    trusted_now: TRUSTED_NOW,
    ...overrides,
  };
}

describe("CAPA operation classifications", () => {
  it("classifies human-only decisions", () => {
    expect(requiresHumanAuthority("approve_root_cause")).toBe(
      true,
    );
    expect(requiresHumanAuthority("close_case")).toBe(true);
    expect(requiresHumanAuthority("submit_intake")).toBe(true);
    expect(requiresHumanAuthority("view_case")).toBe(false);

    expect(
      HUMAN_ONLY_CAPA_OPERATIONS.has("reopen_case"),
    ).toBe(true);
  });

  it("classifies step-up operations", () => {
    expect(
      requiresStepUpAuthentication("approve_action_plan"),
    ).toBe(true);

    expect(
      requiresStepUpAuthentication("export_case"),
    ).toBe(true);

    expect(
      requiresStepUpAuthentication("edit_case"),
    ).toBe(false);

    expect(
      requiresStepUpAuthentication("submit_intake"),
    ).toBe(false);

    expect(
      STEP_UP_CAPA_OPERATIONS.has("cancel_case"),
    ).toBe(true);

    expect(
      requiresHumanAuthority("release_investigation"),
    ).toBe(true);

    expect(
      requiresStepUpAuthentication("release_investigation"),
    ).toBe(false);
  });
});

describe("S50 root-cause gate preconditions", () => {
  it.each(["approve_root_cause", "return_root_cause_for_investigation"] as const)("requires human authority and fresh step-up for %s", (operation) => {
    expect(requiresHumanAuthority(operation)).toBe(true);
    expect(requiresStepUpAuthentication(operation)).toBe(true);
    expect(HUMAN_ONLY_CAPA_OPERATIONS.has(operation)).toBe(true);
    expect(STEP_UP_CAPA_OPERATIONS.has(operation)).toBe(true);
  });
});

describe("mandatory authorization preconditions", () => {
  it("denies an expired session", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: humanAuthentication({
          expires_at: iso(
            "2026-08-11T14:59:59.000Z",
          ),
        }),
      }),
    );

    expect(result).toEqual({
      status: "denied",
      reason_code: "SESSION_INACTIVE",
      authorization_policy_version: "policy-1.0.0",
    });
  });

  it("denies cross-tenant access", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        resource: {
          organization_id: ORGANIZATION_B,
        },
      }),
    );

    expect(result).toEqual({
      status: "denied",
      reason_code: "TENANT_SCOPE_DENIED",
      authorization_policy_version: "policy-1.0.0",
    });
  });

  it("denies a service identity performing a human decision", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: serviceAuthentication(),
        operation: "approve_root_cause",
        step_up_maximum_age_ms: 10 * 60 * 1000,
      }),
    );

    expect(result).toEqual({
      status: "denied",
      reason_code: "AUTHORIZED_HUMAN_REQUIRED",
      authorization_policy_version: "policy-1.0.0",
    });
  });

  it("denies a step-up operation with missing configuration", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        operation: "approve_root_cause",
      }),
    );

    expect(result).toEqual({
      status: "denied",
      reason_code: "STEP_UP_CONFIGURATION_MISSING",
      authorization_policy_version: "policy-1.0.0",
    });
  });

  it("denies non-finite step-up configuration", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        operation: "approve_root_cause",
        step_up_maximum_age_ms: Number.POSITIVE_INFINITY,
      }),
    );

    expect(result.reason_code).toBe(
      "STEP_UP_CONFIGURATION_MISSING",
    );
  });

  it("denies negative step-up configuration", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        operation: "approve_root_cause",
        step_up_maximum_age_ms: -1,
      }),
    );

    expect(result.reason_code).toBe(
      "STEP_UP_CONFIGURATION_MISSING",
    );
  });

  it("denies a step-up operation without recent reauthentication", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: humanAuthentication({
          reauthenticated_at: iso(
            "2026-08-11T14:00:00.000Z",
          ),
        }),
        operation: "approve_root_cause",
        step_up_maximum_age_ms: 10 * 60 * 1000,
      }),
    );

    expect(result).toEqual({
      status: "denied",
      reason_code:
        "STEP_UP_REAUTHENTICATION_REQUIRED",
      authorization_policy_version: "policy-1.0.0",
    });
  });

  it("passes mandatory checks for a recently reauthenticated human", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        operation: "approve_root_cause",
        step_up_maximum_age_ms: 10 * 60 * 1000,
      }),
    );

    expect(result).toEqual({
      status: "requires_policy_evaluation",
      reason_code:
        "MANDATORY_PRECONDITIONS_SATISFIED",
      authorization_policy_version: "policy-1.0.0",
    });
  });

  it("accepts step-up evidence at the exact configured boundary", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: humanAuthentication({
          reauthenticated_at: iso(
            "2026-08-11T14:00:00.000Z",
          ),
        }),
        operation: "approve_scope",
        step_up_maximum_age_ms: 60 * 60 * 1000,
      }),
    );

    expect(result).toMatchObject({
      status: "requires_policy_evaluation",
      reason_code:
        "MANDATORY_PRECONDITIONS_SATISFIED",
    });
  });

  it("rejects step-up evidence one millisecond outside the configured boundary", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: humanAuthentication({
          reauthenticated_at: iso(
            "2026-08-11T13:59:59.999Z",
          ),
        }),
        operation: "accept_containment_risk",
        step_up_maximum_age_ms: 60 * 60 * 1000,
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      reason_code:
        "STEP_UP_REAUTHENTICATION_REQUIRED",
    });
  });

  it("passes mandatory checks for a permitted service operation", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: serviceAuthentication(),
        operation: "view_case",
      }),
    );

    expect(result).toEqual({
      status: "requires_policy_evaluation",
      reason_code:
        "MANDATORY_PRECONDITIONS_SATISFIED",
      authorization_policy_version: "policy-1.0.0",
    });
  });

  it("evaluates session failure before tenant information", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: humanAuthentication({
          expires_at: iso(
            "2026-08-11T14:00:00.000Z",
          ),
        }),
        resource: {
          organization_id: ORGANIZATION_B,
        },
      }),
    );

    expect(result.reason_code).toBe("SESSION_INACTIVE");
  });

  it("evaluates tenant denial before human authority", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request({
        authentication: serviceAuthentication(),
        resource: {
          organization_id: ORGANIZATION_B,
        },
        operation: "approve_root_cause",
        step_up_maximum_age_ms: 10 * 60 * 1000,
      }),
    );

    expect(result.reason_code).toBe(
      "TENANT_SCOPE_DENIED",
    );
  });

  it("never returns a final authorization grant", () => {
    const result = evaluateCapaAuthorizationPreconditions(
      request(),
    );

    expect(result.status).toBe(
      "requires_policy_evaluation",
    );

    expect(result).not.toHaveProperty("allowed", true);
    expect(result).not.toHaveProperty("authorized", true);
  });
});
