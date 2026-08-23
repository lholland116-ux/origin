import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ControlledCode,
  OrganizationId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaPolicyEvaluationRequest,
} from "../../lib/capa/authorization/capa-policy";

import {
  CapaDevelopmentRuntimeDisabledError,
  createCapaDevelopmentRuntime,
  getCapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";

import {
  resolveDevelopmentCapaRequestContext,
} from "../../lib/security/supabase-capa-context";

const NOW =
  new Date(
    "2026-08-12T14:00:00.000Z",
  );

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

const OTHER_ORGANIZATION_ID =
  "8eb089a8-d26f-4662-948d-d0fb5d5e81fe" as
    OrganizationId;

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function createUuidGenerator():
  () => string {
  let sequence = 0;

  return () => {
    sequence += 1;

    return `00000000-0000-4000-8000-${String(
      sequence,
    ).padStart(
      12,
      "0",
    )}`;
  };
}

function requestTrace():
  RequestTrace {
  return {
    request_id:
      "runtime-request-1",

    correlation_id:
      "runtime-correlation-1",
  } as RequestTrace;
}

function developmentContext() {
  return resolveDevelopmentCapaRequestContext(
    {
      verified_user_id:
        USER_ID,

      authenticated_at:
        "2026-08-12T13:00:00.000Z",

      expires_at_epoch_seconds:
        Date.parse(
          "2026-08-12T15:00:00.000Z",
        ) / 1_000,
    },

    NOW,
  );
}

function policyRequest(
  overrides:
    Partial<CapaPolicyEvaluationRequest> = {},
): CapaPolicyEvaluationRequest {
  const context =
    developmentContext();

  return {
    authentication:
      context.authentication,

    tenant:
      context.tenant,

    operation:
      "create_case",

    resource: {
      organization_id:
        context.tenant
          .organization_id,

      resource_type:
        controlled(
          "CAPA_CASE",
        ),
    },

    purpose:
      controlled(
        "CAPA_CASE_CREATION",
      ),

    trusted_now:
      NOW,

    ...overrides,
  };
}

describe(
  "createCapaDevelopmentRuntime",
  () => {
    it(
      "assembles one isolated transaction-bound in-memory CAPA runtime",
      () => {
        const runtime =
          createCapaDevelopmentRuntime({
            environment:
              "test",

            now:
              () => NOW,

            generate_uuid:
              createUuidGenerator(),
          });

        expect(
          runtime.dependencies
            .transaction_manager,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.dependencies
            .capa_repository,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.dependencies
            .audit_repository,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.dependencies
            .case_number_allocator,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.submit_intake_dependencies
            .transaction_manager,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.submit_intake_dependencies
            .capa_repository,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.submit_intake_dependencies
            .audit_repository,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.submit_intake_dependencies
            .workflow_idempotency_repository,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.submit_intake_dependencies
            .configuration,
        ).toEqual({
          workflow_version:
            "workflow-development-1.0.0",
          audit_schema_version:
            "audit-schema-1.0.0",
          authorization_purpose:
            "CAPA_WORKFLOW_TRANSITION",
        });

        expect(
          runtime.dependencies
            .clock
            .now(),
        ).toBe(
          NOW,
        );

        expect(
          runtime.dependencies
            .configuration,
        ).toEqual({
          workflow_version:
            "workflow-development-1.0.0",

          intake_schema_version:
            "intake-schema-1.0.0",

          audit_schema_version:
            "audit-schema-1.0.0",

          intake_section_type:
            "CAPA.INTAKE",

          default_confidentiality:
            "CUSTOMER_CONFIDENTIAL",

          authorization_purpose:
            "CAPA_CASE_CREATION",
        });
      },
    );

    it(
      "generates unique controlled record identities",
      () => {
        const runtime =
          createCapaDevelopmentRuntime({
            environment:
              "test",

            now:
              () => NOW,

            generate_uuid:
              createUuidGenerator(),
          });

        const generator =
          runtime.dependencies
            .id_generator;

        expect(
          generator
            .generateCapaCaseId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000001",
        );

        expect(
          generator
            .generateCaseVersionId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000002",
        );

        expect(
          generator
            .generateSectionVersionId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000003",
        );

        expect(
          generator
            .generateAuditEventId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000004",
        );
      },
    );

    it(
      "allocates organization-scoped numbers with commit and rollback behavior",
      async () => {
        const runtime =
          createCapaDevelopmentRuntime({
            environment:
              "test",

            now:
              () => NOW,

            generate_uuid:
              createUuidGenerator(),
          });

        const organizationId =
          USER_ID as
            OrganizationId;

        const trace =
          requestTrace();

        const rollbackFailure =
          new Error(
            "Simulated transaction failure",
          );

        await expect(
          runtime.database
            .runInTransaction(
              trace,
              async (
                transaction,
              ) => {
                const allocated =
                  await runtime
                    .dependencies
                    .case_number_allocator
                    .allocateNextCaseNumber(
                      transaction,
                      organizationId,
                    );

                expect(
                  allocated,
                ).toBe(
                  "CAPA-000001",
                );

                throw rollbackFailure;
              },
            ),
        ).rejects.toBe(
          rollbackFailure,
        );

        const firstCommitted =
          await runtime.database
            .runInTransaction(
              trace,
              (
                transaction,
              ) =>
                runtime
                  .dependencies
                  .case_number_allocator
                  .allocateNextCaseNumber(
                    transaction,
                    organizationId,
                  ),
            );

        const secondCommitted =
          await runtime.database
            .runInTransaction(
              trace,
              (
                transaction,
              ) =>
                runtime
                  .dependencies
                  .case_number_allocator
                  .allocateNextCaseNumber(
                    transaction,
                    organizationId,
                  ),
            );

        const otherOrganization =
          await runtime.database
            .runInTransaction(
              trace,
              (
                transaction,
              ) =>
                runtime
                  .dependencies
                  .case_number_allocator
                  .allocateNextCaseNumber(
                    transaction,
                    OTHER_ORGANIZATION_ID,
                  ),
            );

        expect(
          firstCommitted,
        ).toBe(
          "CAPA-000001",
        );

        expect(
          secondCommitted,
        ).toBe(
          "CAPA-000002",
        );

        expect(
          otherOrganization,
        ).toBe(
          "CAPA-000001",
        );
      },
    );

    it(
      "uses the generated transaction identity",
      async () => {
        const runtime =
          createCapaDevelopmentRuntime({
            environment:
              "test",

            now:
              () => NOW,

            generate_uuid:
              createUuidGenerator(),
          });

        const trace =
          requestTrace();

        const transaction =
          await runtime.database
            .runInTransaction(
              trace,
              async (
                context,
              ) =>
                context,
            );

        expect(
          transaction
            .transaction_id,
        ).toBe(
          "00000000-0000-4000-8000-000000000001",
        );

        expect(
          transaction
            .started_at,
        ).toBe(
          "2026-08-12T14:00:00.000Z",
        );

        expect(
          transaction
            .request_trace,
        ).toEqual(
          trace,
        );
      },
    );

    it(
      "blocks creation in a production environment",
      () => {
        expect(
          () =>
            createCapaDevelopmentRuntime({
              environment:
                "production",
            }),
        ).toThrow(
          CapaDevelopmentRuntimeDisabledError,
        );
      },
    );

    it(
      "supports default clock and UUID providers outside production",
      () => {
        const runtime =
          createCapaDevelopmentRuntime({
            environment:
              "test",
          });

        expect(
          runtime.dependencies
            .clock
            .now(),
        ).toBeInstanceOf(
          Date,
        );

        expect(
          runtime.dependencies
            .id_generator
            .generateCapaCaseId(),
        ).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      },
    );

    it(
      "uses NODE_ENV when no explicit environment is supplied",
      () => {
        expect(
          () =>
            createCapaDevelopmentRuntime(),
        ).not.toThrow();
      },
    );
  },
);

describe(
  "development CAPA authorization policy",
  () => {
    function createPolicy() {
      return createCapaDevelopmentRuntime({
        environment:
          "test",

        now:
          () => NOW,

        generate_uuid:
          createUuidGenerator(),
      }).dependencies
        .authorization_policy;
    }

    it(
      "allows development CAPA creation",
      async () => {
        const decision =
          await createPolicy()
            .evaluate(
              policyRequest(),
            );

        expect(
          decision,
        ).toEqual({
          decision:
            "allow",

          reason_code:
            "DEVELOPMENT_CREATE_ALLOWED",

          policy_version:
            "development-policy-1.0.0",

          evaluated_at:
            "2026-08-12T14:00:00.000Z",

          relied_on_role_assignment_ids: [
            `development-role:${USER_ID}`,
          ],
        });
      },
    );

    it(
      "allows development CAPA case listing",
      async () => {
        const request =
          policyRequest();

        const decision =
          await createPolicy()
            .evaluate({
              ...request,

              operation:
                "view_case",

              resource: {
                organization_id:
                  request.tenant
                    .organization_id,

                resource_type:
                  controlled(
                    "CAPA_CASE_COLLECTION",
                  ),
              },

              purpose:
                controlled(
                  "CAPA_CASE_ACCESS",
                ),
            });

        expect(
          decision,
        ).toEqual({
          decision:
            "allow",

          reason_code:
            "DEVELOPMENT_VIEW_ALLOWED",

          policy_version:
            "development-policy-1.0.0",

          evaluated_at:
            "2026-08-12T14:00:00.000Z",

          relied_on_role_assignment_ids: [
            `development-role:${USER_ID}`,
          ],
        });
      },
    );

    it(
      "allows development CAPA intake submission",
      async () => {
        const request =
          policyRequest();

        const decision =
          await createPolicy()
            .evaluate({
              ...request,
              operation:
                "submit_intake",
              resource: {
                organization_id:
                  request.tenant
                    .organization_id,
                resource_type:
                  controlled("CAPA_CASE"),
                workflow_state:
                  "S00",
              },
              purpose:
                controlled(
                  "CAPA_WORKFLOW_TRANSITION",
                ),
            });

        expect(decision).toEqual({
          decision: "allow",
          reason_code:
            "DEVELOPMENT_SUBMIT_INTAKE_ALLOWED",
          policy_version:
            "development-policy-1.0.0",
          evaluated_at:
            "2026-08-12T14:00:00.000Z",
          relied_on_role_assignment_ids: [
            `development-role:${USER_ID}`,
          ],
        });
      },
    );

    it.each([
      {
        name:
          "non-development access path",

        mutate(
          request:
            CapaPolicyEvaluationRequest,
        ): CapaPolicyEvaluationRequest {
          return {
            ...request,

            tenant: {
              ...request.tenant,

              access_path:
                controlled(
                  "HUMAN_MEMBERSHIP",
                ),
            },
          };
        },
      },
      {
        name:
          "organization mismatch",

        mutate(
          request:
            CapaPolicyEvaluationRequest,
        ): CapaPolicyEvaluationRequest {
          return {
            ...request,

            resource: {
              ...request.resource,

              organization_id:
                OTHER_ORGANIZATION_ID,
            },
          };
        },
      },
      {
        name:
          "unsupported operation",

        mutate(
          request:
            CapaPolicyEvaluationRequest,
        ): CapaPolicyEvaluationRequest {
          return {
            ...request,

            operation:
              "edit_case",
          };
        },
      },
      {
        name:
          "missing development role",

        mutate(
          request:
            CapaPolicyEvaluationRequest,
        ): CapaPolicyEvaluationRequest {
          return {
            ...request,

            tenant: {
              ...request.tenant,

              role_assignments: [],
            },
          };
        },
      },
      {
        name:
          "incorrect role scope",

        mutate(
          request:
            CapaPolicyEvaluationRequest,
        ): CapaPolicyEvaluationRequest {
          return {
            ...request,

            tenant: {
              ...request.tenant,

              role_assignments:
                request.tenant
                  .role_assignments
                  .map(
                    (
                      assignment,
                    ) => ({
                      ...assignment,

                      scope:
                        controlled(
                          "CASE_ONLY",
                        ),
                    }),
                  ),
            },
          };
        },
      },
    ])(
      "denies $name",
      async ({
        mutate,
      }) => {
        const decision =
          await createPolicy()
            .evaluate(
              mutate(
                policyRequest(),
              ),
            );

        expect(
          decision,
        ).toEqual({
          decision:
            "deny",

          reason_code:
            "DEVELOPMENT_POLICY_DENIED",

          policy_version:
            "development-policy-1.0.0",

          evaluated_at:
            "2026-08-12T14:00:00.000Z",
        });
      },
    );
  },
);

describe(
  "getCapaDevelopmentRuntime",
  () => {
    it(
      "reuses one process-shared runtime",
      () => {
        const globalRuntime =
          globalThis as
            typeof globalThis & {
              __lvt_capa_development_runtime__?:
                unknown;
            };

        delete globalRuntime
          .__lvt_capa_development_runtime__;

        const first =
          getCapaDevelopmentRuntime();

        const second =
          getCapaDevelopmentRuntime();

        expect(
          second,
        ).toBe(
          first,
        );
      },
    );
  },
);