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
  CapaDevelopmentRuntimeAdvisoryConfigurationError,
  CapaDevelopmentRuntimeDisabledError,
  createCapaDevelopmentRuntime,
  getCapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";

import {
  CapaDevelopmentOrganizationConfigurationError,
} from "../../lib/security/capa-development-organization";

import type {
  CapaIntakeAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/capa-intake-advisory-model-generator";

import type {
  CapaContainmentRiskAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/capa-containment-risk-advisory-model-generator";

import type {
  CapaInvestigationPlanningAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-model-profile";

import type {
  CapaInvestigationActiveAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/capa-investigation-active-advisory-model-profile";

import type {
  CapaRootCauseReviewAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-model-generator";

import type {
  CapaIntakeAdvisoryRetrievalConfiguration,
} from "../../lib/capa/ai/capa-intake-advisory-retrieval-request-factory";

import {
  InMemoryCapaKnowledgeDatabase,
} from "../../lib/database/in-memory/in-memory-capa-knowledge-database";

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

const SHARED_DEVELOPMENT_ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";

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

function advisoryRetrievalConfiguration():
  CapaIntakeAdvisoryRetrievalConfiguration {
  return {
    collection_id:
      "7d974143-2bdc-4178-b529-9571a4f25a4a" as
        CapaIntakeAdvisoryRetrievalConfiguration[
          "collection_id"
        ],

    collection_version_id:
      "62baea6e-f42c-424d-bdc8-01fce5921fb0" as
        CapaIntakeAdvisoryRetrievalConfiguration[
          "collection_version_id"
        ],

    retrieval_policy_version:
      "capa-retrieval-policy-1.0.0",

    source_precedence_policy_version:
      "test-source-precedence-1.0.0",

    query_construction_version:
      "capa-knowledge-query-1.0.0",

    ranking_policy_version:
      "test-ranking-policy-1.0.0",

    citation_policy_version:
      "test-citation-policy-1.0.0",
  };
}

function structuredModelClient():
  CapaIntakeAdvisoryStructuredModelClient {
  return {
    async generateStructured() {
      throw new Error(
        "The runtime-composition test must not invoke the model.",
      );
    },
  };
}

function containmentRiskStructuredModelClient():
  CapaContainmentRiskAdvisoryStructuredModelClient {
  return {
    async generateStructured() {
      throw new Error(
        "The development S20 runtime-composition test must not invoke the model.",
      );
    },
  };
}

function investigationPlanningStructuredModelClient():
  CapaInvestigationPlanningAdvisoryStructuredModelClient {
  return {
    async generateStructured() {
      throw new Error(
        "The development S30 runtime-composition test must not invoke the model.",
      );
    },
  };
}

function investigationActiveStructuredModelClient():
  CapaInvestigationActiveAdvisoryStructuredModelClient {
  return {
    async generateStructured() {
      throw new Error(
        "The development S40 runtime-composition test must not invoke the model.",
      );
    },
  };
}

function rootCauseReviewStructuredModelClient():
  CapaRootCauseReviewAdvisoryStructuredModelClient {
  return {
    async generateStructured() {
      throw new Error(
        "The development S50 runtime-composition test must not invoke the model.",
      );
    },
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

function developmentContext(
  userId: string = USER_ID,
) {
  return resolveDevelopmentCapaRequestContext(
    {
      verified_user_id:
        userId,

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

function rootCauseGatePolicyRequest(
  userId: string = USER_ID,
  overrides:
    Partial<CapaPolicyEvaluationRequest> = {},
): CapaPolicyEvaluationRequest {
  const context = developmentContext(userId);

  return policyRequest({
    authentication: context.authentication,
    tenant: context.tenant,
    operation: "approve_root_cause",
    resource: {
      organization_id: context.tenant.organization_id,
      resource_type: controlled("CAPA_CASE"),
      workflow_state: "S50",
      relationship: controlled("NOT_CASE_OWNER"),
    },
    purpose: controlled("CAPA_GATE_DECISION"),
    ...overrides,
  });
}

async function withDevelopmentRole<T>(
  role: string,
  action: () => T | Promise<T>,
): Promise<T> {
  const previousRole =
    process.env.CAPA_DEVELOPMENT_ROLE_ID;

  process.env.CAPA_DEVELOPMENT_ROLE_ID = role;

  try {
    return await action();
  } finally {
    if (previousRole === undefined) {
      delete process.env.CAPA_DEVELOPMENT_ROLE_ID;
    } else {
      process.env.CAPA_DEVELOPMENT_ROLE_ID = previousRole;
    }
  }
}

async function withDevelopmentOrganization<T>(
  organizationId: string | undefined,
  action: () => T | Promise<T>,
): Promise<T> {
  const previousOrganizationId =
    process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID;

  if (organizationId === undefined) {
    delete process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID;
  } else {
    process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID =
      organizationId;
  }

  try {
    return await action();
  } finally {
    if (previousOrganizationId === undefined) {
      delete process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID;
    } else {
      process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID =
        previousOrganizationId;
    }
  }
}

describe(
  "createCapaDevelopmentRuntime",
  () => {
    it.each([
      ["CAPA_OWNER", false],
      ["CAPA_REVIEWER", true],
      ["CAPA_APPROVER", true],
    ])(
      "uses the selected development role for S50 AG-REVIEW activation and authorization (%s)",
      async (role, agentEligible) => {
        await withDevelopmentRole(role, async () => {
          const context = developmentContext();
          const runtime = createCapaDevelopmentRuntime({
            environment: "test",
            now: () => NOW,
            generate_uuid: createUuidGenerator(),
          });

          expect(
            context.tenant.role_assignments[0].role_id,
          ).toBe(role);

          const activationDecision =
            runtime.agent_activation_service.evaluate({
              agent_id: "AG-REVIEW",
              agent_version:
                "ag-review-1.0.0" as never,
              workflow_state: "S50",
              operation:
                "assemble_review_packet",
              active_role_ids: [role] as never,
              requested_tool_ids: [
                "TOOL-CASE-READ",
                "TOOL-EVIDENCE-READ",
                "TOOL-STRUCTURED-DRAFT",
              ] as never,
              output_schema_version:
                "capa_review_packet_draft-1.0.0" as never,
            });

          expect(
            activationDecision.eligible,
          ).toBe(agentEligible);

          const authorizationDecision =
            await runtime.dependencies
              .authorization_policy.evaluate(
                policyRequest({
                  operation:
                    "request_ai_root_cause_review_advisory",
                  tenant: context.tenant,
                  authentication:
                    context.authentication,
                  resource: {
                    organization_id:
                      context.tenant.organization_id,
                    resource_type:
                      controlled("CAPA_CASE"),
                    workflow_state: "S50",
                  },
                  purpose: controlled(
                    "CAPA_AI_ROOT_CAUSE_REVIEW_ADVISORY",
                  ),
                }),
              );

          expect(
            authorizationDecision.decision,
          ).toBe("allow");
          expect(
            authorizationDecision,
          ).toMatchObject({
            relied_on_role_assignment_ids: [
              `development-role:${USER_ID}`,
            ],
          });
        });
      },
    );

    it(
      "uses the selected shared development organization for policy scope",
      async () => {
        await withDevelopmentOrganization(
          SHARED_DEVELOPMENT_ORGANIZATION_ID,
          async () => {
            const context = developmentContext();
            const runtime = createCapaDevelopmentRuntime({
              environment: "test",
              now: () => NOW,
              generate_uuid: createUuidGenerator(),
            });

            const allowed =
              await runtime.dependencies
                .authorization_policy.evaluate(
                  policyRequest({
                    operation:
                      "request_ai_root_cause_review_advisory",
                    tenant: context.tenant,
                    authentication:
                      context.authentication,
                    resource: {
                      organization_id:
                        SHARED_DEVELOPMENT_ORGANIZATION_ID as
                          OrganizationId,
                      resource_type:
                        controlled("CAPA_CASE"),
                      workflow_state: "S50",
                    },
                    purpose: controlled(
                      "CAPA_AI_ROOT_CAUSE_REVIEW_ADVISORY",
                    ),
                  }),
                );

            expect(allowed).toMatchObject({
              decision: "allow",
              relied_on_role_assignment_ids: [
                `development-role:${USER_ID}`,
              ],
            });

            const wrongOrganization =
              await runtime.dependencies
                .authorization_policy.evaluate(
                  policyRequest({
                    tenant: context.tenant,
                    authentication:
                      context.authentication,
                    resource: {
                      organization_id:
                        OTHER_ORGANIZATION_ID,
                      resource_type:
                        controlled("CAPA_CASE"),
                      workflow_state: "S50",
                    },
                    purpose: controlled(
                      "CAPA_AI_ROOT_CAUSE_REVIEW_ADVISORY",
                    ),
                  }),
                );

            expect(wrongOrganization).toMatchObject({
              decision: "deny",
              reason_code:
                "DEVELOPMENT_POLICY_DENIED",
            });
          },
        );
      },
    );

    it(
      "derives CASE_OWNER versus NOT_CASE_OWNER from authenticated principals",
      async () => {
        await withDevelopmentOrganization(
          SHARED_DEVELOPMENT_ORGANIZATION_ID,
          async () => {
            const capaOwner =
              developmentContext(USER_ID);
            const sameUser =
              developmentContext(USER_ID);
            const differentUser =
              developmentContext(
                "8eb089a8-d26f-4662-948d-d0fb5d5e81fe",
              );

            const relationshipFor = (
              context: ReturnType<typeof developmentContext>,
            ) =>
              context.owner_user_id ===
                capaOwner.owner_user_id
                ? "CASE_OWNER"
                : "NOT_CASE_OWNER";

            expect(
              sameUser.tenant.organization_id,
            ).toBe(SHARED_DEVELOPMENT_ORGANIZATION_ID);
            expect(
              differentUser.tenant.organization_id,
            ).toBe(SHARED_DEVELOPMENT_ORGANIZATION_ID);
            expect(relationshipFor(sameUser)).toBe(
              "CASE_OWNER",
            );
            expect(relationshipFor(differentUser)).toBe(
              "NOT_CASE_OWNER",
            );
          },
        );
      },
    );

    it(
      "fails closed for invalid organization configuration and remains disabled in production",
      async () => {
        await withDevelopmentOrganization(
          "not-a-uuid",
          async () => {
            expect(() =>
              createCapaDevelopmentRuntime({
                environment: "test",
              }),
            ).toThrow(
              CapaDevelopmentOrganizationConfigurationError,
            );

            expect(() =>
              createCapaDevelopmentRuntime({
                environment: "production",
              }),
            ).toThrow(CapaDevelopmentRuntimeDisabledError);
          },
        );
      },
    );

    it("composes the request-scoped S50 advisory over in-memory persistence", () => {
      const runtime = createCapaDevelopmentRuntime({
        environment: "test",
        now: () => NOW,
        generate_uuid: createUuidGenerator(),
        root_cause_review_advisory: {
          structured_model_client: rootCauseReviewStructuredModelClient(),
        },
      });

      const service = runtime.create_root_cause_review_advisory_service(
        developmentContext(),
      );

      expect(service.execute).toEqual(expect.any(Function));
      expect((service as any).dependencies.output_repository).toBe(runtime.database);
      expect((service as any).dependencies.transaction_manager).toBe(runtime.database);
    });

    it("fails closed when the development S50 advisory is not configured", () => {
      const runtime = createCapaDevelopmentRuntime({
        environment: "test",
        now: () => NOW,
        generate_uuid: createUuidGenerator(),
      });

      expect(() =>
        runtime.create_root_cause_review_advisory_service(developmentContext()),
      ).toThrow(CapaDevelopmentRuntimeAdvisoryConfigurationError);
    });

    it("composes request-scoped S40 advisory and adoption services over in-memory persistence", () => {
      const runtime = createCapaDevelopmentRuntime({
        environment: "test",
        now: () => NOW,
        generate_uuid: createUuidGenerator(),
        investigation_active_advisory: {
          structured_model_client: investigationActiveStructuredModelClient(),
        },
      });

      const advisory = runtime.create_investigation_active_advisory_service(
        developmentContext(),
      );
      const adoption = runtime.create_investigation_active_adoption_service(
        developmentContext(),
      );

      expect(advisory).not.toBe(adoption);
      expect(advisory.execute).toEqual(expect.any(Function));
      expect(adoption.adopt).toEqual(expect.any(Function));
      expect((advisory as any).dependencies.output_repository).toBe(runtime.database);
    });

    it("allows the real S40 adoption service to pass development authorization", async () => {
      const runtime = createCapaDevelopmentRuntime({
        environment: "test",
        now: () => NOW,
        generate_uuid: createUuidGenerator(),
      });
      const adoption = runtime.create_investigation_active_adoption_service(
        developmentContext(),
      );

      await expect(adoption.adopt({
        capa_case_id: "30000000-0000-4000-8000-000000000001" as never,
        adoption_intent: {
          expected_case_version_id: "40000000-0000-4000-8000-000000000001" as never,
          expected_record_version: 4,
          output_id: "50000000-0000-4000-8000-000000000001" as never,
          selected_items: [{
            proposal_key: "P1",
            adopted_content: {
              gap: "The controlled record is unavailable.",
              why_it_matters: "The evidence requires human review.",
              recommended_next_step: "Review the controlled archive.",
            },
          }],
        },
        request_trace: {
          request_id: "60000000-0000-4000-8000-000000000001" as never,
          correlation_id: "70000000-0000-4000-8000-000000000001" as never,
          idempotency_key: "s40-development-adoption" as never,
        },
      })).resolves.toEqual({ status: "output_not_found_or_not_authorized" });
    });

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
          runtime.accept_containment_risk_dependencies
            .transaction_manager,
        ).toBe(runtime.database);
        expect(
          runtime.accept_containment_risk_dependencies
            .capa_repository,
        ).toBe(runtime.database);
        expect(
          runtime.accept_containment_risk_dependencies
            .configuration,
        ).toMatchObject({
          workflow_version: "workflow-development-1.0.0",
          audit_schema_version: "audit-schema-1.0.0",
          step_up_maximum_age_ms: 15 * 60 * 1000,
          required_step_up_assurance: "MFA",
          approval_rationale_required: true,
        });

        expect(
          runtime.release_investigation_dependencies
            .configuration,
        ).toEqual(
          runtime.submit_intake_dependencies.configuration,
        );

        expect(
          runtime.update_investigation_progress_dependencies
            .transaction_manager,
        ).toBe(runtime.database);
        expect(
          runtime.update_investigation_progress_dependencies
            .capa_repository,
        ).toBe(runtime.database);
        expect(
          runtime.update_investigation_progress_dependencies
            .audit_repository,
        ).toBe(runtime.database);
        expect(
          runtime.update_investigation_progress_dependencies
            .workflow_idempotency_repository,
        ).toBe(runtime.database);
        expect(
          runtime.update_investigation_progress_dependencies
            .configuration.authorization_purpose,
        ).toBe("CAPA_CASE_EDIT");
        expect(
          "participant_eligibility_repository" in
            runtime.update_investigation_progress_dependencies,
        ).toBe(false);

        expect(
          runtime.submit_root_cause_dependencies
            .transaction_manager,
        ).toBe(runtime.database);
        expect(
          runtime.submit_root_cause_dependencies
            .capa_repository,
        ).toBe(runtime.database);
        expect(
          runtime.submit_root_cause_dependencies
            .audit_repository,
        ).toBe(runtime.database);
        expect(
          runtime.submit_root_cause_dependencies
            .workflow_idempotency_repository,
        ).toBe(runtime.database);
        expect(
          runtime.submit_root_cause_dependencies
            .configuration,
        ).toEqual(
          runtime.submit_intake_dependencies.configuration,
        );

        expect(
          runtime.knowledge_repository,
        ).toBeInstanceOf(
          InMemoryCapaKnowledgeDatabase,
        );

        expect(
          runtime.knowledge_retrieval_service
            .retrieve,
        ).toEqual(
          expect.any(Function),
        );
        expect(
          runtime.knowledge_retrieval_service
            .validateCitation,
        ).toEqual(
          expect.any(Function),
        );

        expect(
          runtime.tool_gateway.execute,
        ).toEqual(
          expect.any(Function),
        );
        expect(runtime.tool_gateway)
          .not.toHaveProperty(
            "transitionWorkflow",
          );

        expect(
          runtime.agent_activation_service
            .registry_version,
        ).toBe(
          "capa-agent-registry-1.3.0",
        );

        const activationDecision =
          runtime.agent_activation_service
            .evaluate({
              agent_id: "AG-INTAKE",
              agent_version:
                "ag-intake-1.0.0" as never,
              workflow_state: "S10",
              operation:
                "draft_intake_analysis",
              active_role_ids: [
                "CAPA_OWNER" as never,
              ],
              requested_tool_ids: [
                "TOOL-CASE-READ",
              ],
              output_schema_version:
                "capa-intake-draft-output-1.0.0" as never,
            });

        expect(activationDecision)
          .toMatchObject({
            eligible: true,
            reason_code:
              "AGENT_ELIGIBLE",
          });

        expect(
          runtime.prompt_assembly_service
            .configuration,
        ).toMatchObject({
          agent_id: "AG-INTAKE",
          agent_version:
            "ag-intake-1.0.0",
          allowed_workflow_states: [
            "S10",
          ],
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
      "fails closed when the development advisory runtime is not configured",
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
          () =>
            runtime
              .create_intake_advisory_service(
                developmentContext(),
              ),
        ).toThrow(
          CapaDevelopmentRuntimeAdvisoryConfigurationError,
        );

        expect(
          () =>
            runtime
              .create_containment_risk_advisory_service(
                developmentContext(),
              ),
        ).toThrow(
          CapaDevelopmentRuntimeAdvisoryConfigurationError,
        );

        expect(
          () =>
            runtime.create_investigation_planning_advisory_service(
              developmentContext(),
            ),
        ).toThrow(CapaDevelopmentRuntimeAdvisoryConfigurationError);
      },
    );

    it("creates fresh request-scoped S20 advisory services from an injected client", () => {
      const runtime = createCapaDevelopmentRuntime({
        environment: "test",
        now: () => NOW,
        generate_uuid: createUuidGenerator(),
        containment_risk_advisory: {
          structured_model_client:
            containmentRiskStructuredModelClient(),
        },
      });

      const first = runtime.create_containment_risk_advisory_service(developmentContext());
      const second = runtime.create_containment_risk_advisory_service(developmentContext());

      expect(first).not.toBe(second);
      expect(first.execute).toEqual(expect.any(Function));
      expect(second.execute).toEqual(expect.any(Function));
      expect(() => runtime.create_intake_advisory_service(developmentContext())).toThrow(CapaDevelopmentRuntimeAdvisoryConfigurationError);
    });

    it("creates request-scoped S30 services using the same in-memory repository and transaction manager", () => {
      const runtime = createCapaDevelopmentRuntime({
        environment: "test",
        now: () => NOW,
        generate_uuid: createUuidGenerator(),
        investigation_planning_advisory: {
          structured_model_client:
            investigationPlanningStructuredModelClient(),
        },
      });

      const first = runtime.create_investigation_planning_advisory_service(
        developmentContext(),
      );
      const second = runtime.create_investigation_planning_advisory_service(
        developmentContext(),
      );

      expect(first).not.toBe(second);
      expect(first.execute).toEqual(expect.any(Function));
      expect((first as any).dependencies.output_repository).toBe(runtime.database);
      expect((first as any).dependencies.transaction_manager).toBe(runtime.database);
    });

    it(
      "creates a fresh request-scoped advisory service from injected development configuration",
      () => {
        const modelClient =
          structuredModelClient();

        const runtime =
          createCapaDevelopmentRuntime({
            environment:
              "test",

            now:
              () => NOW,

            generate_uuid:
              createUuidGenerator(),

            intake_advisory: {
              retrieval_configuration:
                advisoryRetrievalConfiguration(),

              structured_model_client:
                modelClient,
            },
          });

        const first =
          runtime
            .create_intake_advisory_service(
              developmentContext(),
            );

        const second =
          runtime
            .create_intake_advisory_service(
              developmentContext(),
            );

        expect(first).not.toBe(second);

        expect(first.advise)
          .toEqual(
            expect.any(Function),
          );

        expect(second.advise)
          .toEqual(
            expect.any(Function),
          );
      },
    );

    it("wires a request-scoped adoption service to the in-memory repository", () => {
      const runtime = createCapaDevelopmentRuntime({ environment: "test" });
      const service = runtime.create_investigation_planning_adoption_service(
        developmentContext(),
      );
      expect(service.adopt).toEqual(expect.any(Function));
      expect(runtime.release_investigation_dependencies.adoption_repository)
        .toBe(runtime.database);
    });

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

    it("allows both S50 root-cause gate operations for a non-owner CAPA_APPROVER", async () => {
      await withDevelopmentOrganization(
        SHARED_DEVELOPMENT_ORGANIZATION_ID,
        async () => {
          await withDevelopmentRole("CAPA_APPROVER", async () => {
            const policy = createPolicy();
            const request = rootCauseGatePolicyRequest(
              OTHER_ORGANIZATION_ID,
            );

            for (const [operation, reason_code] of [
              [
                "approve_root_cause",
                "DEVELOPMENT_ROOT_CAUSE_APPROVAL_ALLOWED",
              ],
              [
                "return_root_cause_for_investigation",
                "DEVELOPMENT_ROOT_CAUSE_RETURN_ALLOWED",
              ],
            ] as const) {
              await expect(
                policy.evaluate({
                  ...request,
                  operation,
                }),
              ).resolves.toMatchObject({
                decision: "allow",
                reason_code,
                policy_version:
                  "development-policy-1.0.0",
              });
            }
          });
        },
      );
    });

    it("denies both S50 root-cause gate operations for a CAPA_APPROVER who owns the case", async () => {
      await withDevelopmentOrganization(
        SHARED_DEVELOPMENT_ORGANIZATION_ID,
        async () => {
          await withDevelopmentRole("CAPA_APPROVER", async () => {
            const policy = createPolicy();
            const request = rootCauseGatePolicyRequest(USER_ID, {
              resource: {
                organization_id:
                  SHARED_DEVELOPMENT_ORGANIZATION_ID as
                    OrganizationId,
                resource_type: controlled("CAPA_CASE"),
                workflow_state: "S50",
                relationship: controlled("CASE_OWNER"),
              },
            });

            for (const operation of [
              "approve_root_cause",
              "return_root_cause_for_investigation",
            ] as const) {
              await expect(
                policy.evaluate({
                  ...request,
                  operation,
                }),
              ).resolves.toMatchObject({
                decision: "deny",
                reason_code: "DEVELOPMENT_POLICY_DENIED",
              });
            }
          });
        },
      );
    });

    it("allows the existing gate operation for S70 and denies non-S70 action-plan review", async () => {
      await withDevelopmentOrganization(
        SHARED_DEVELOPMENT_ORGANIZATION_ID,
        async () => {
          await withDevelopmentRole("CAPA_APPROVER", async () => {
            const policy = createPolicy();
            const context = developmentContext(OTHER_ORGANIZATION_ID);
            const request = policyRequest({
              authentication: context.authentication,
              tenant: context.tenant,
              operation: "approve_action_plan",
              resource: {
                organization_id: context.tenant.organization_id,
                resource_type: controlled("CAPA_CASE"),
                workflow_state: "S70",
                relationship: controlled("NOT_CASE_OWNER"),
              },
              purpose: controlled("CAPA_GATE_DECISION"),
            });
            await expect(policy.evaluate(request)).resolves.toMatchObject({
              decision: "allow",
              reason_code: "DEVELOPMENT_ACTION_PLAN_REVIEW_ALLOWED",
            });
            await expect(policy.evaluate({
              ...request,
              resource: { ...request.resource, workflow_state: "S60" },
            })).resolves.toMatchObject({ decision: "deny", reason_code: "DEVELOPMENT_POLICY_DENIED" });
            await expect(policy.evaluate({
              ...request,
              resource: { ...request.resource, relationship: controlled("CASE_OWNER") },
            })).resolves.toMatchObject({ decision: "deny", reason_code: "DEVELOPMENT_POLICY_DENIED" });
          });
        },
      );
    });

    it.each([
      "CAPA_OWNER",
      "CAPA_REVIEWER",
      "CAPA_CONTRIBUTOR",
      "CAPA_AUDITOR",
    ] as const)("denies both root-cause gate operations for development role %s", async (role) => {
      await withDevelopmentOrganization(
        SHARED_DEVELOPMENT_ORGANIZATION_ID,
        async () => {
          await withDevelopmentRole(role, async () => {
            const policy = createPolicy();
            const request = rootCauseGatePolicyRequest(
              OTHER_ORGANIZATION_ID,
            );

            for (const operation of [
              "approve_root_cause",
              "return_root_cause_for_investigation",
            ] as const) {
              await expect(
                policy.evaluate({
                  ...request,
                  operation,
                }),
              ).resolves.toMatchObject({
                decision: "deny",
                reason_code: "DEVELOPMENT_POLICY_DENIED",
              });
            }
          });
        },
      );
    });

    it.each([
      [
        "wrong workflow state",
        {
          resource: {
            organization_id:
              SHARED_DEVELOPMENT_ORGANIZATION_ID as
                OrganizationId,
            resource_type: controlled("CAPA_CASE"),
            workflow_state: "S40",
            relationship: controlled("NOT_CASE_OWNER"),
          },
        },
      ],
      ["wrong purpose", { purpose: controlled("CAPA_CASE_EDIT") }],
      [
        "wrong organization",
        {
          resource: {
            organization_id: OTHER_ORGANIZATION_ID,
            resource_type: controlled("CAPA_CASE"),
            workflow_state: "S50",
            relationship: controlled("NOT_CASE_OWNER"),
          },
        },
      ],
      [
        "missing relationship",
        {
          resource: {
            organization_id:
              SHARED_DEVELOPMENT_ORGANIZATION_ID as
                OrganizationId,
            resource_type: controlled("CAPA_CASE"),
            workflow_state: "S50",
          },
        },
      ],
      [
        "owner relationship",
        {
          resource: {
            organization_id:
              SHARED_DEVELOPMENT_ORGANIZATION_ID as
                OrganizationId,
            resource_type: controlled("CAPA_CASE"),
            workflow_state: "S50",
            relationship: controlled("CASE_OWNER"),
          },
        },
      ],
    ] as const)("denies a gate request with %s", async (_label, overrides) => {
      await withDevelopmentOrganization(
        SHARED_DEVELOPMENT_ORGANIZATION_ID,
        async () => {
          await withDevelopmentRole("CAPA_APPROVER", async () => {
            const policy = createPolicy();
            const request = rootCauseGatePolicyRequest(
              OTHER_ORGANIZATION_ID,
              overrides,
            );

            await expect(policy.evaluate(request)).resolves.toMatchObject({
              decision: "deny",
              reason_code: "DEVELOPMENT_POLICY_DENIED",
            });
          });
        },
      );
    });

    it.each([
      ["missing assignment", []],
      [
        "inactive assignment",
        [
          {
            role_assignment_id: `development-role:${OTHER_ORGANIZATION_ID}`,
            role_id: "CAPA_APPROVER",
            scope: controlled("ORGANIZATION"),
            effective_at: "2026-08-12T13:00:00.000Z",
            expires_at: "2026-08-12T13:59:59.000Z",
          },
        ],
      ],
      [
        "wrong assignment scope",
        [
          {
            role_assignment_id: `development-role:${OTHER_ORGANIZATION_ID}`,
            role_id: "CAPA_APPROVER",
            scope: controlled("CASE_ONLY"),
            effective_at: "2026-08-12T13:00:00.000Z",
            expires_at: "2026-08-12T15:00:00.000Z",
          },
        ],
      ],
    ] as const)("denies a gate request with %s", async (_label, role_assignments) => {
      await withDevelopmentOrganization(
        SHARED_DEVELOPMENT_ORGANIZATION_ID,
        async () => {
          await withDevelopmentRole("CAPA_APPROVER", async () => {
            const policy = createPolicy();
            const request = rootCauseGatePolicyRequest(
              OTHER_ORGANIZATION_ID,
              {
                tenant: {
                  ...rootCauseGatePolicyRequest(
                    OTHER_ORGANIZATION_ID,
                  ).tenant,
                  role_assignments: role_assignments as never,
                },
              },
            );

            await expect(policy.evaluate(request)).resolves.toMatchObject({
              decision: "deny",
              reason_code: "DEVELOPMENT_POLICY_DENIED",
            });
          });
        },
      );
    });

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

    it(
      "allows development human CAPA scope approval",
      async () => {
        const request =
          policyRequest();

        const decision =
          await createPolicy()
            .evaluate({
              ...request,

              operation:
                "approve_scope",

              resource: {
                organization_id:
                  request.tenant
                    .organization_id,

                resource_type:
                  controlled(
                    "CAPA_CASE",
                  ),

                workflow_state:
                  "S10",
              },

              purpose:
                controlled(
                  "CAPA_GATE_DECISION",
                ),
            });

        expect(decision).toEqual({
          decision:
            "allow",

          reason_code:
            "DEVELOPMENT_APPROVE_SCOPE_ALLOWED",

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

    it("allows development human G-02 containment/risk acceptance", async () => {
      const request = policyRequest();
      const decision = await createPolicy().evaluate({
        ...request,
        operation: "accept_containment_risk",
        resource: {
          organization_id: request.tenant.organization_id,
          resource_type: controlled("CAPA_CASE"),
          workflow_state: "S20",
        },
        purpose: controlled("CAPA_GATE_DECISION"),
      });
      expect(decision).toMatchObject({
        decision: "allow",
        reason_code: "DEVELOPMENT_ACCEPT_CONTAINMENT_RISK_ALLOWED",
      });
    });

    it("allows controlled S40 investigation progress editing", async () => {
      const request = policyRequest();
      const decision = await createPolicy().evaluate({
        ...request,
        operation: "edit_case",
        resource: {
          organization_id: request.tenant.organization_id,
          resource_type: controlled("CAPA_CASE"),
          workflow_state: "S40",
        },
        purpose: controlled("CAPA_CASE_EDIT"),
      });
      expect(decision).toEqual({
        decision: "allow",
        reason_code: "DEVELOPMENT_EDIT_CASE_ALLOWED",
        policy_version: "development-policy-1.0.0",
        evaluated_at: "2026-08-12T14:00:00.000Z",
        relied_on_role_assignment_ids: [`development-role:${USER_ID}`],
      });
    });

    it("allows controlled S40 root-cause submission for review", async () => {
      const request = policyRequest();
      const decision = await createPolicy().evaluate({
        ...request,
        operation: "submit_for_review",
        resource: {
          organization_id: request.tenant.organization_id,
          resource_type: controlled("CAPA_CASE"),
          workflow_state: "S40",
        },
        purpose: controlled("CAPA_WORKFLOW_TRANSITION"),
      });
      expect(decision).toEqual({
        decision: "allow",
        reason_code: "DEVELOPMENT_SUBMIT_FOR_REVIEW_ALLOWED",
        policy_version: "development-policy-1.0.0",
        evaluated_at: "2026-08-12T14:00:00.000Z",
        relied_on_role_assignment_ids: [`development-role:${USER_ID}`],
      });
    });

    it.each([
      ["edit_case", "CAPA_CASE_EDIT"],
      ["submit_for_review", "CAPA_WORKFLOW_TRANSITION"],
    ] as const)("keeps %s fail-closed outside the valid development boundary", async (operation, purpose) => {
      const request = policyRequest();
      const base = {
        ...request,
        operation,
        resource: {
          organization_id: request.tenant.organization_id,
          resource_type: controlled("CAPA_CASE"),
          workflow_state: "S40" as const,
        },
        purpose: controlled(purpose),
      };
      await expect(createPolicy().evaluate({
        ...base,
        tenant: { ...base.tenant, role_assignments: [] },
      })).resolves.toMatchObject({ decision: "deny", reason_code: "DEVELOPMENT_POLICY_DENIED" });
      await expect(createPolicy().evaluate({
        ...base,
        resource: { ...base.resource, organization_id: OTHER_ORGANIZATION_ID },
      })).resolves.toMatchObject({ decision: "deny", reason_code: "DEVELOPMENT_POLICY_DENIED" });
      await expect(createPolicy().evaluate({
        ...base,
        tenant: { ...base.tenant, access_path: controlled("HUMAN_MEMBERSHIP") },
      })).resolves.toMatchObject({ decision: "deny", reason_code: "DEVELOPMENT_POLICY_DENIED" });
    });

    it(
      "allows governed development AI intake advisory requests",
      async () => {
        const request =
          policyRequest();

        const decision =
          await createPolicy()
            .evaluate({
              ...request,

              operation:
                "request_ai_intake_advisory",

              resource: {
                organization_id:
                  request.tenant
                    .organization_id,

                resource_type:
                  controlled(
                    "CAPA_CASE",
                  ),

                workflow_state:
                  "S10",
              },

              purpose:
                controlled(
                  "CAPA_AI_INTAKE_ADVISORY",
                ),
            });

        expect(decision).toEqual({
          decision:
            "allow",

          reason_code:
            "DEVELOPMENT_AI_INTAKE_ADVISORY_ALLOWED",

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

    it("allows governed development S20 containment-risk advisory requests", async () => {
      const request = policyRequest();
      const decision = await createPolicy().evaluate({
        ...request,
        operation: "request_ai_containment_risk_advisory",
        resource: {
          organization_id: request.tenant.organization_id,
          resource_type: controlled("CAPA_CASE"),
          workflow_state: "S20",
        },
        purpose: controlled("CAPA_AI_CONTAINMENT_RISK_ADVISORY"),
      });

      expect(decision).toEqual({
        decision: "allow",
        reason_code: "DEVELOPMENT_AI_CONTAINMENT_RISK_ADVISORY_ALLOWED",
        policy_version: "development-policy-1.0.0",
        evaluated_at: "2026-08-12T14:00:00.000Z",
        relied_on_role_assignment_ids: [`development-role:${USER_ID}`],
      });
    });

    it("allows governed development S30 investigation-planning advisory requests", async () => {
      const request = policyRequest();
      const decision = await createPolicy().evaluate({
        ...request,
        operation: "request_ai_investigation_planning_advisory",
        resource: {
          organization_id: request.tenant.organization_id,
          resource_type: controlled("CAPA_CASE"),
          workflow_state: "S30",
        },
        purpose: controlled("CAPA_AI_INVESTIGATION_PLANNING_ADVISORY"),
      });

      expect(decision).toEqual({
        decision: "allow",
        reason_code: "DEVELOPMENT_AI_INVESTIGATION_PLANNING_ADVISORY_ALLOWED",
        policy_version: "development-policy-1.0.0",
        evaluated_at: "2026-08-12T14:00:00.000Z",
        relied_on_role_assignment_ids: [`development-role:${USER_ID}`],
      });
    });

    it.each([
      {
        operation: "adopt_ai_investigation_planning_proposal",
        workflow_state: "S30",
        purpose: "CAPA_AI_INVESTIGATION_PLANNING_ADOPTION",
        reason_code: "DEVELOPMENT_AI_INVESTIGATION_PLANNING_ADOPTION_ALLOWED",
      },
      {
        operation: "adopt_ai_investigation_active_proposal",
        workflow_state: "S40",
        purpose: "CAPA_AI_INVESTIGATION_ACTIVE_ADOPTION",
        reason_code: "DEVELOPMENT_AI_INVESTIGATION_ACTIVE_ADOPTION_ALLOWED",
      },
    ] as const)("allows governed development %s", async ({ operation, workflow_state, purpose, reason_code }) => {
      const request = policyRequest();
      await expect(createPolicy().evaluate({
        ...request,
        operation,
        resource: {
          organization_id: request.tenant.organization_id,
          resource_type: controlled("CAPA_CASE"),
          workflow_state,
        },
        purpose: controlled(purpose),
      })).resolves.toEqual({
        decision: "allow",
        reason_code,
        policy_version: "development-policy-1.0.0",
        evaluated_at: "2026-08-12T14:00:00.000Z",
        relied_on_role_assignment_ids: [`development-role:${USER_ID}`],
      });
    });

    it("allows both S40 investigation-active workspace operations", async () => {
      const request = policyRequest();
      for (const [operation, purpose, reason_code] of [
        ["read_investigation_active_workspace_draft", "CAPA_INVESTIGATION_ACTIVE_WORKSPACE_READ", "DEVELOPMENT_AI_INVESTIGATION_ACTIVE_WORKSPACE_READ_ALLOWED"],
        ["edit_investigation_active_workspace_draft", "CAPA_INVESTIGATION_ACTIVE_WORKSPACE_EDIT", "DEVELOPMENT_AI_INVESTIGATION_ACTIVE_WORKSPACE_EDIT_ALLOWED"],
      ] as const) {
        await expect(createPolicy().evaluate({
          ...request,
          operation,
          resource: {
            organization_id: request.tenant.organization_id,
            resource_type: controlled("CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT"),
            workflow_state: "S40",
          },
          purpose: controlled(purpose),
        })).resolves.toMatchObject({ decision: "allow", reason_code });
      }
    });

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
                "close_case",
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

    it("wires the request-scoped S40 workspace service to the development database", () => {
      const runtime = createCapaDevelopmentRuntime({ now: () => NOW });
      const service = runtime.create_investigation_active_workspace_draft_service({} as any);
      expect(service).toEqual(expect.objectContaining({ load: expect.any(Function), save: expect.any(Function) }));
    });

    it("wires the request-scoped S60 action-plan workspace service to the development database", () => {
      const runtime = createCapaDevelopmentRuntime({ now: () => NOW });
      const service = runtime.create_action_plan_workspace_draft_service({} as any);
      expect(service).toEqual(expect.objectContaining({ load: expect.any(Function), save: expect.any(Function) }));
    });

    it("wires the human-controlled S50 root-cause gate", () => {
      const runtime = createCapaDevelopmentRuntime({ now: () => NOW });
      expect(runtime.decide_root_cause_gate_dependencies).toEqual(expect.objectContaining({
        transaction_manager: runtime.database,
        capa_repository: runtime.database,
        audit_repository: runtime.database,
        workflow_idempotency_repository: runtime.database,
      }));
      expect(runtime.decide_root_cause_gate_dependencies.configuration.authorization_purpose).toBe("CAPA_GATE_DECISION");
    });

    it("wires the human-controlled S70 action-plan review to the shared development transaction runtime", () => {
      const runtime = createCapaDevelopmentRuntime({ now: () => NOW });
      expect(runtime.decide_action_plan_review_dependencies).toEqual(expect.objectContaining({
        transaction_manager: runtime.database,
        capa_repository: runtime.database,
        audit_repository: runtime.database,
        workflow_idempotency_repository: runtime.database,
        review_decision_repository: runtime.database,
      }));
      expect(runtime.decide_action_plan_review_dependencies.configuration.authorization_purpose).toBe("CAPA_GATE_DECISION");
    });
  },
);
