import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  CapaCaseStatus,
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RoleId,
  UserId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaPolicyEvaluationRequest,
} from "../../lib/capa/authorization/capa-policy";

import {
  SupabaseCapaAuthorizationConfigurationError,
  SupabaseCapaAuthorizationPolicy,
  type SupabaseCapaAuthorizationPolicyOptions,
} from "../../lib/capa/authorization/supabase-capa-authorization-policy";

import type {
  AuthenticationContext,
  ServiceIdentityId,
  SessionId,
} from "../../lib/security/auth-context";

import type {
  RoleAssignmentId,
  TenantAccessGrantId,
  TenantContext,
  TenantRoleAssignment,
} from "../../lib/security/tenant-context";

const NOW =
  new Date("2026-08-17T15:00:00.000Z");

const ORGANIZATION_A =
  "10000000-0000-4000-8000-000000000001" as
    OrganizationId;

const ORGANIZATION_B =
  "20000000-0000-4000-8000-000000000001" as
    OrganizationId;

const USER_ID =
  "10000000-0000-4000-8000-000000000002" as
    UserId;

const MEMBERSHIP_ID =
  "10000000-0000-4000-8000-000000000011" as
    TenantAccessGrantId;

const OWNER_ASSIGNMENT_ID =
  "10000000-0000-4000-8000-000000000021" as
    RoleAssignmentId;

const REVIEWER_ASSIGNMENT_ID =
  "10000000-0000-4000-8000-000000000022" as
    RoleAssignmentId;

const APPROVER_ASSIGNMENT_ID =
  "10000000-0000-4000-8000-000000000023" as
    RoleAssignmentId;

const POLICY_VERSION =
  "authorization-policy-1.0.0";

interface SqlCall {
  readonly query: string;
  readonly values: readonly unknown[];
}

interface SqlHarness {
  readonly sql: postgres.Sql;
  readonly calls: SqlCall[];
  enqueue(...responses: readonly unknown[]): void;
}

function createSqlHarness(): SqlHarness {
  const responses: unknown[] = [];
  const calls: SqlCall[] = [];

  const tagged = vi.fn(
    async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      calls.push({
        query: strings
          .join("?")
          .replace(/\s+/g, " ")
          .trim(),
        values,
      });

      return responses.shift() ?? [];
    },
  );

  return {
    sql:
      tagged as unknown as postgres.Sql,
    calls,
    enqueue(...nextResponses) {
      responses.push(...nextResponses);
    },
  };
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function iso(
  value: string,
): IsoDateTime {
  return value as IsoDateTime;
}

function humanAuthentication(
  overrides:
    Partial<AuthenticationContext> = {},
): AuthenticationContext {
  return {
    principal: {
      principal_type: "human",
      user_id: USER_ID,
    },
    session_id:
      "10000000-0000-4000-8000-000000000031" as
        SessionId,
    authentication_method:
      controlled("SUPABASE_SESSION"),
    assurance_level:
      controlled("MFA"),
    authenticated_at:
      iso("2026-08-17T14:00:00.000Z"),
    expires_at:
      iso("2026-08-17T16:00:00.000Z"),
    reauthenticated_at:
      iso("2026-08-17T14:58:00.000Z"),
    ...overrides,
  };
}

function serviceAuthentication():
  AuthenticationContext {
  return {
    principal: {
      principal_type: "service",
      service_identity_id:
        "10000000-0000-4000-8000-000000000041" as
          ServiceIdentityId,
    },
    session_id:
      "10000000-0000-4000-8000-000000000042" as
        SessionId,
    authentication_method:
      controlled("SERVICE_CREDENTIAL"),
    assurance_level:
      controlled("SERVICE"),
    authenticated_at:
      iso("2026-08-17T14:00:00.000Z"),
    expires_at:
      iso("2026-08-17T16:00:00.000Z"),
  };
}

function assignment(
  overrides:
    Partial<TenantRoleAssignment> = {},
): TenantRoleAssignment {
  return {
    role_assignment_id:
      OWNER_ASSIGNMENT_ID,
    role_id:
      "CAPA_OWNER" as RoleId,
    scope:
      controlled("ORGANIZATION"),
    effective_at:
      iso("2026-08-17T13:00:00.000Z"),
    ...overrides,
  };
}

function tenantContext(
  overrides:
    Partial<TenantContext> = {},
): TenantContext {
  return {
    organization_id:
      ORGANIZATION_A,
    access_grant_id:
      MEMBERSHIP_ID,
    access_path:
      controlled("SUPABASE_MEMBERSHIP"),
    authorization_policy_version:
      POLICY_VERSION,
    resolved_at:
      iso("2026-08-17T14:59:00.000Z"),
    role_assignments: [
      assignment(),
    ],
    ...overrides,
  };
}

function policyRequest(
  overrides:
    Partial<CapaPolicyEvaluationRequest> = {},
): CapaPolicyEvaluationRequest {
  return {
    authentication:
      humanAuthentication(),
    tenant:
      tenantContext(),
    operation:
      "create_case",
    resource: {
      organization_id:
        ORGANIZATION_A,
      resource_type:
        controlled("CAPA_CASE"),
    },
    purpose:
      controlled("CAPA_CASE_CREATION"),
    trusted_now:
      NOW,
    ...overrides,
  };
}

function approvalRequest(
  overrides:
    Partial<CapaPolicyEvaluationRequest> = {},
): CapaPolicyEvaluationRequest {
  return policyRequest({
    operation:
      "approve_root_cause",
    authentication:
      humanAuthentication(),
    tenant:
      tenantContext({
        role_assignments: [
          assignment({
            role_assignment_id:
              APPROVER_ASSIGNMENT_ID,
            role_id:
              "CAPA_APPROVER" as RoleId,
          }),
        ],
      }),
    resource: {
      organization_id:
        ORGANIZATION_A,
      resource_type:
        controlled("CAPA_CASE"),
      workflow_state:
        "S50" as CapaCaseStatus,
      relationship:
        controlled("NOT_CASE_OWNER"),
    },
    purpose:
      controlled("CAPA_GATE_DECISION"),
    ...overrides,
  });
}

function membershipRow(
  overrides:
    Record<string, unknown> = {},
) {
  return {
    authorization_policy_version:
      POLICY_VERSION,
    ...overrides,
  };
}

function authorityRow(
  overrides:
    Record<string, unknown> = {},
) {
  return {
    role_assignment_id:
      OWNER_ASSIGNMENT_ID,
    role_id:
      "CAPA_OWNER",
    permissions: [
      "capa.case.create",
      "capa.case.view",
      "capa.case.edit",
      "capa.case.submit",
    ],
    human_authority:
      true,
    ...overrides,
  };
}

function policyOptions(
  overrides:
    Partial<
      SupabaseCapaAuthorizationPolicyOptions
    > = {},
): SupabaseCapaAuthorizationPolicyOptions {
  return {
    step_up_maximum_age_ms:
      10 * 60 * 1_000,
    required_step_up_assurance:
      controlled("MFA"),
    ...overrides,
  };
}

function createPolicy(
  harness: SqlHarness,
  options:
    SupabaseCapaAuthorizationPolicyOptions =
      policyOptions(),
): SupabaseCapaAuthorizationPolicy {
  return new SupabaseCapaAuthorizationPolicy(
    harness.sql,
    options,
  );
}

async function evaluateWithAuthority(
  request:
    CapaPolicyEvaluationRequest,
  memberships:
    readonly unknown[] = [
      membershipRow(),
    ],
  authorities:
    readonly unknown[] = [
      authorityRow(),
    ],
) {
  const harness = createSqlHarness();

  harness.enqueue(
    memberships,
    authorities,
  );

  const result =
    await createPolicy(
      harness,
    ).evaluate(request);

  return {
    result,
    harness,
  };
}

describe(
  "SupabaseCapaAuthorizationPolicy configuration",
  () => {
    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
    ])(
      "rejects invalid step-up maximum age: %s",
      (
        stepUpMaximumAge,
      ) => {
        const harness =
          createSqlHarness();

        expect(
          () =>
            createPolicy(
              harness,
              policyOptions({
                step_up_maximum_age_ms:
                  stepUpMaximumAge,
              }),
            ),
        ).toThrow(
          SupabaseCapaAuthorizationConfigurationError,
        );
      },
    );

    it.each([
      "",
      "A".repeat(65),
      "INVALID CODE",
    ])(
      "rejects an invalid assurance code",
      (
        assuranceCode,
      ) => {
        const harness =
          createSqlHarness();

        expect(
          () =>
            createPolicy(
              harness,
              policyOptions({
                required_step_up_assurance:
                  controlled(
                    assuranceCode,
                  ),
              }),
            ),
        ).toThrow(
          SupabaseCapaAuthorizationConfigurationError,
        );
      },
    );

    it(
      "uses a named configuration error",
      () => {
        const harness =
          createSqlHarness();

        try {
          createPolicy(
            harness,
            policyOptions({
              step_up_maximum_age_ms:
                -1,
            }),
          );

          throw new Error(
            "Expected invalid configuration.",
          );
        } catch (error) {
          expect(error).toBeInstanceOf(
            SupabaseCapaAuthorizationConfigurationError,
          );

          expect(
            (
              error as
                SupabaseCapaAuthorizationConfigurationError
            ).name,
          ).toBe(
            "SupabaseCapaAuthorizationConfigurationError",
          );
        }
      },
    );
  },
);

describe(
  "SupabaseCapaAuthorizationPolicy mandatory controls",
  () => {
    it(
      "rejects invalid trusted server time before querying",
      async () => {
        const harness =
          createSqlHarness();

        await expect(
          createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              trusted_now:
                new Date(Number.NaN),
            }),
          ),
        ).rejects.toBeInstanceOf(
          SupabaseCapaAuthorizationConfigurationError,
        );

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "denies an inactive session before querying",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              authentication:
                humanAuthentication({
                  expires_at:
                    iso(
                      "2026-08-17T15:00:00.000Z",
                    ),
                }),
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "SESSION_INACTIVE",
          policy_version:
            POLICY_VERSION,
          evaluated_at:
            NOW.toISOString(),
        });

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "denies a cross-tenant resource before querying",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              resource: {
                organization_id:
                  ORGANIZATION_B,
                resource_type:
                  controlled("CAPA_CASE"),
              },
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "TENANT_SCOPE_DENIED",
        });

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "denies a service principal performing a human-only operation",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            approvalRequest({
              authentication:
                serviceAuthentication(),
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "AUTHORIZED_HUMAN_REQUIRED",
        });

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "denies service principals in the human membership policy",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              authentication:
                serviceAuthentication(),
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "HUMAN_PRINCIPAL_REQUIRED",
        });

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "returns a step-up decision without querying",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            approvalRequest({
              authentication:
                humanAuthentication({
                  reauthenticated_at:
                    undefined,
                }),
            }),
          );

        expect(result).toEqual({
          decision: "step_up",
          reason_code:
            "STEP_UP_REAUTHENTICATION_REQUIRED",
          policy_version:
            POLICY_VERSION,
          evaluated_at:
            NOW.toISOString(),
          required_assurance:
            "MFA",
        });

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "denies an unauthorized purpose",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              purpose:
                controlled(
                  "CAPA_CASE_EXPORT",
                ),
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "PURPOSE_NOT_AUTHORIZED",
        });

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );
  },
);

describe(
  "SupabaseCapaAuthorizationPolicy workflow and segregation controls",
  () => {
    it(
      "requires workflow state for a state-bound operation",
      async () => {
        const harness =
          createSqlHarness();

        const request =
          approvalRequest({
            resource: {
              organization_id:
                ORGANIZATION_A,
              resource_type:
                controlled("CAPA_CASE"),
              relationship:
                controlled(
                  "NOT_CASE_OWNER",
                ),
            },
          });

        const result =
          await createPolicy(
            harness,
          ).evaluate(request);

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "WORKFLOW_STATE_REQUIRED",
        });
      },
    );

    it(
      "denies an operation from the wrong workflow state",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            approvalRequest({
              resource: {
                organization_id:
                  ORGANIZATION_A,
                resource_type:
                  controlled("CAPA_CASE"),
                workflow_state:
                  "S70" as CapaCaseStatus,
                relationship:
                  controlled(
                    "NOT_CASE_OWNER",
                  ),
              },
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "WORKFLOW_STATE_NOT_AUTHORIZED",
        });
      },
    );

    it.each([
      [
        undefined,
        "RELATIONSHIP_REQUIRED",
      ],
      [
        "CASE_OWNER",
        "SEGREGATION_OF_DUTIES_DENIED",
      ],
      [
        "UNVERIFIED_RELATIONSHIP",
        "RELATIONSHIP_NOT_AUTHORIZED",
      ],
    ] as const)(
      "fails closed for relationship %s",
      async (
        relationship,
        expectedReason,
      ) => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            approvalRequest({
              resource: {
                organization_id:
                  ORGANIZATION_A,
                resource_type:
                  controlled("CAPA_CASE"),
                workflow_state:
                  "S50" as CapaCaseStatus,
                ...(relationship ===
                undefined
                  ? {}
                  : {
                      relationship:
                        controlled(
                          relationship,
                        ),
                    }),
              },
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            expectedReason,
        });

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it.each([
      [
        "edit_case",
        "S130",
        "CAPA_CASE_EDIT",
      ],
      [
        "submit_intake",
        "S10",
        "CAPA_WORKFLOW_TRANSITION",
      ],
      [
        "submit_for_review",
        "S10",
        "CAPA_WORKFLOW_TRANSITION",
      ],
      [
        "export_case",
        "S110",
        "CAPA_CASE_EXPORT",
      ],
    ] as const)(
      "denies %s from state %s",
      async (
        operation,
        workflowState,
        purpose,
      ) => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              operation,
              resource: {
                organization_id:
                  ORGANIZATION_A,
                resource_type:
                  controlled("CAPA_CASE"),
                workflow_state:
                  workflowState as
                    CapaCaseStatus,
              },
              purpose:
                controlled(purpose),
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "WORKFLOW_STATE_NOT_AUTHORIZED",
        });
      },
    );
  },
);

describe(
  "SupabaseCapaAuthorizationPolicy submit-intake controls",
  () => {
    it(
      "denies a service principal submitting intake before querying",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              authentication:
                serviceAuthentication(),
              operation:
                "submit_intake",
              resource: {
                organization_id:
                  ORGANIZATION_A,
                resource_type:
                  controlled("CAPA_CASE"),
                workflow_state:
                  "S00" as CapaCaseStatus,
              },
              purpose:
                controlled(
                  "CAPA_WORKFLOW_TRANSITION",
                ),
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "AUTHORIZED_HUMAN_REQUIRED",
        });

        expect(harness.calls)
          .toHaveLength(0);
      },
    );

    it(
      "denies an incorrect submit-intake purpose before querying",
      async () => {
        const harness =
          createSqlHarness();

        const result =
          await createPolicy(
            harness,
          ).evaluate(
            policyRequest({
              operation:
                "submit_intake",
              resource: {
                organization_id:
                  ORGANIZATION_A,
                resource_type:
                  controlled("CAPA_CASE"),
                workflow_state:
                  "S00" as CapaCaseStatus,
              },
              purpose:
                controlled(
                  "CAPA_CASE_ACCESS",
                ),
            }),
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "PURPOSE_NOT_AUTHORIZED",
        });

        expect(harness.calls)
          .toHaveLength(0);
      },
    );
  },
);

describe(
  "SupabaseCapaAuthorizationPolicy durable authority",
  () => {
    it(
      "denies when active membership is absent",
      async () => {
        const {
          result,
          harness,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "ACTIVE_MEMBERSHIP_NOT_FOUND",
        });

        expect(
          harness.calls,
        ).toHaveLength(1);
      },
    );

    it(
      "denies ambiguous membership results",
      async () => {
        const {
          result,
          harness,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow(),
              membershipRow(),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "ACTIVE_MEMBERSHIP_NOT_FOUND",
        });

        expect(
          harness.calls,
        ).toHaveLength(1);
      },
    );

    it(
      "denies an undefined membership row",
      async () => {
        const {
          result,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [undefined],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "INVALID_AUTHORIZATION_DATA",
        });
      },
    );

    it(
      "denies malformed membership policy data",
      async () => {
        const {
          result,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow({
                authorization_policy_version:
                  1,
              }),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "INVALID_AUTHORIZATION_DATA",
        });
      },
    );

    it(
      "denies a policy-version mismatch",
      async () => {
        const {
          result,
          harness,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow({
                authorization_policy_version:
                  "authorization-policy-2.0.0",
              }),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "AUTHORIZATION_POLICY_VERSION_MISMATCH",
        });

        expect(
          harness.calls,
        ).toHaveLength(1);
      },
    );

    it(
      "denies when no active authority exists",
      async () => {
        const {
          result,
          harness,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow(),
            ],
            [],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "REQUIRED_PERMISSION_NOT_GRANTED",
        });

        expect(
          harness.calls,
        ).toHaveLength(2);
      },
    );

    it.each([
      {
        permissions: null,
      },
      {
        permissions: [
          "capa.case.create",
          7,
        ],
      },
      {
        human_authority:
          "yes",
      },
    ])(
      "denies malformed authority data: %j",
      async (
        malformed,
      ) => {
        const {
          result,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow(),
            ],
            [
              authorityRow(
                malformed,
              ),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "INVALID_AUTHORIZATION_DATA",
        });
      },
    );

    it(
      "does not use a database assignment absent from the trusted context",
      async () => {
        const {
          result,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow(),
            ],
            [
              authorityRow({
                role_assignment_id:
                  REVIEWER_ASSIGNMENT_ID,
              }),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "REQUIRED_PERMISSION_NOT_GRANTED",
        });
      },
    );

    it(
      "requires both assignment ID and role ID to match",
      async () => {
        const {
          result,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow(),
            ],
            [
              authorityRow({
                role_id:
                  "CAPA_REVIEWER",
              }),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "REQUIRED_PERMISSION_NOT_GRANTED",
        });
      },
    );

    it(
      "ignores an expired context assignment",
      async () => {
        const request =
          policyRequest({
            tenant:
              tenantContext({
                role_assignments: [
                  assignment({
                    expires_at:
                      iso(
                        "2026-08-17T15:00:00.000Z",
                      ),
                  }),
                ],
              }),
          });

        const {
          result,
        } =
          await evaluateWithAuthority(
            request,
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "REQUIRED_PERMISSION_NOT_GRANTED",
        });
      },
    );

    it(
      "denies a human-only action when the role lacks human authority",
      async () => {
        const request =
          approvalRequest();

        const {
          result,
        } =
          await evaluateWithAuthority(
            request,
            [
              membershipRow(),
            ],
            [
              authorityRow({
                role_assignment_id:
                  APPROVER_ASSIGNMENT_ID,
                role_id:
                  "CAPA_APPROVER",
                permissions: [
                  "capa.gate.approve",
                ],
                human_authority:
                  false,
              }),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "REQUIRED_PERMISSION_NOT_GRANTED",
        });
      },
    );

    it(
      "denies an assignment without the required permission",
      async () => {
        const {
          result,
        } =
          await evaluateWithAuthority(
            policyRequest(),
            [
              membershipRow(),
            ],
            [
              authorityRow({
                permissions: [
                  "capa.case.view",
                ],
              }),
            ],
          );

        expect(result).toMatchObject({
          decision: "deny",
          reason_code:
            "REQUIRED_PERMISSION_NOT_GRANTED",
        });
      },
    );
  },
);

describe(
  "SupabaseCapaAuthorizationPolicy successful decisions",
  () => {
    it(
      "authorizes case creation using a current owner assignment",
      async () => {
        const {
          result,
          harness,
        } =
          await evaluateWithAuthority(
            policyRequest(),
          );

        expect(result).toEqual({
          decision: "allow",
          reason_code:
            "AUTHORIZED_BY_ACTIVE_ROLE_ASSIGNMENT",
          policy_version:
            POLICY_VERSION,
          evaluated_at:
            NOW.toISOString(),
          relied_on_role_assignment_ids: [
            OWNER_ASSIGNMENT_ID,
          ],
        });

        expect(
          result.decision,
        ).toBe("allow");

        if (
          result.decision !== "allow"
        ) {
          throw new Error(
            "Expected authorization.",
          );
        }

        expect(
          Object.isFrozen(
            result
              .relied_on_role_assignment_ids,
          ),
        ).toBe(true);

        expect(
          harness.calls,
        ).toHaveLength(2);

        expect(
          harness.calls[0]?.query,
        ).toContain(
          "limit 2",
        );

        expect(
          harness.calls[0]?.values,
        ).toEqual([
          ORGANIZATION_A,
          MEMBERSHIP_ID,
          USER_ID,
          NOW.toISOString(),
          NOW.toISOString(),
          NOW.toISOString(),
          NOW.toISOString(),
        ]);

        expect(
          harness.calls[1]?.query,
        ).toContain(
          "assignment.scope_code =",
        );

        expect(
          harness.calls[1]?.values,
        ).toEqual([
          ORGANIZATION_A,
          MEMBERSHIP_ID,
          USER_ID,
          "ORGANIZATION",
          NOW.toISOString(),
          NOW.toISOString(),
        ]);
      },
    );

    it(
      "authorizes intake submission from draft using a current owner assignment",
      async () => {
        const {
          result,
          harness,
        } =
          await evaluateWithAuthority(
            policyRequest({
              operation:
                "submit_intake",
              resource: {
                organization_id:
                  ORGANIZATION_A,
                resource_type:
                  controlled("CAPA_CASE"),
                workflow_state:
                  "S00" as CapaCaseStatus,
              },
              purpose:
                controlled(
                  "CAPA_WORKFLOW_TRANSITION",
                ),
            }),
          );

        expect(result).toEqual({
          decision: "allow",
          reason_code:
            "AUTHORIZED_BY_ACTIVE_ROLE_ASSIGNMENT",
          policy_version:
            POLICY_VERSION,
          evaluated_at:
            NOW.toISOString(),
          relied_on_role_assignment_ids: [
            OWNER_ASSIGNMENT_ID,
          ],
        });

        expect(harness.calls)
          .toHaveLength(2);
      },
    );

    it(
      "authorizes a root-cause approval using an active approver assignment",
      async () => {
        const request =
          approvalRequest();

        const {
          result,
        } =
          await evaluateWithAuthority(
            request,
            [
              membershipRow(),
            ],
            [
              authorityRow({
                role_assignment_id:
                  APPROVER_ASSIGNMENT_ID,
                role_id:
                  "CAPA_APPROVER",
                permissions: [
                  "capa.case.view",
                  "capa.review.disposition",
                  "capa.gate.approve",
                ],
              }),
            ],
          );

        expect(result).toEqual({
          decision: "allow",
          reason_code:
            "AUTHORIZED_BY_ACTIVE_ROLE_ASSIGNMENT",
          policy_version:
            POLICY_VERSION,
          evaluated_at:
            NOW.toISOString(),
          relied_on_role_assignment_ids: [
            APPROVER_ASSIGNMENT_ID,
          ],
        });
      },
    );

    it(
      "records every matching active assignment used by the decision",
      async () => {
        const secondAssignment =
          REVIEWER_ASSIGNMENT_ID;

        const request =
          policyRequest({
            tenant:
              tenantContext({
                role_assignments: [
                  assignment(),
                  assignment({
                    role_assignment_id:
                      secondAssignment,
                    role_id:
                      "CAPA_OWNER" as
                        RoleId,
                  }),
                ],
              }),
          });

        const {
          result,
        } =
          await evaluateWithAuthority(
            request,
            [
              membershipRow(),
            ],
            [
              authorityRow(),
              authorityRow({
                role_assignment_id:
                  secondAssignment,
              }),
            ],
          );

        expect(result).toMatchObject({
          decision: "allow",
          relied_on_role_assignment_ids: [
            OWNER_ASSIGNMENT_ID,
            secondAssignment,
          ],
        });
      },
    );
  },
);