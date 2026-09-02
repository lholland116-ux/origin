import type postgres from "postgres";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(
  () => ({
    create_sql:
      vi.fn(),
  }),
);

vi.mock(
  "../../lib/database/supabase/supabase-transactions",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import(
          "../../lib/database/supabase/supabase-transactions"
        )
      >();

    return {
      ...actual,

      createSupabaseDatabaseSql:
        mocks.create_sql,
    };
  },
);

import {
  CapaProductionRuntimeConfigurationError,
  createCapaProductionRuntime,
  currentCapaSystemDate,
  getCapaProductionRuntime,
} from "../../lib/capa/application/capa-production-runtime";

import type {
  CapaIntakeAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/capa-intake-advisory-model-generator";

import type {
  CapaContainmentRiskAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/capa-containment-risk-advisory-model-generator";

import type {
  CapaIntakeAdvisoryRetrievalConfiguration,
} from "../../lib/capa/ai/capa-intake-advisory-retrieval-request-factory";

import {
  resolveDevelopmentCapaRequestContext,
} from "../../lib/security/supabase-capa-context";

import {
  SupabaseCapaAuthorizationPolicy,
} from "../../lib/capa/authorization/supabase-capa-authorization-policy";

import {
  SupabaseAuditRepository,
} from "../../lib/database/supabase/supabase-audit-repository";

import {
  SupabaseCapaCaseNumberAllocator,
} from "../../lib/database/supabase/supabase-capa-case-number-allocator";

import {
  SupabaseCapaWorkflowIdempotencyRepository,
} from "../../lib/database/supabase/supabase-capa-workflow-idempotency-repository";

import {
  SupabaseCapaRepository,
} from "../../lib/database/supabase/supabase-capa-repository";

import {
  SupabaseCapaKnowledgeRepository,
} from "../../lib/database/supabase/supabase-capa-knowledge-repository";

import {
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

const NOW =
  new Date(
    "2026-08-19T12:00:00.000Z",
  );

const SQL =
  vi.fn() as unknown as postgres.Sql;

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

type ProductionRuntimeGlobal =
  typeof globalThis & {
    __lvt_capa_production_runtime__?:
      ReturnType<
        typeof createCapaProductionRuntime
      >;
  };

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
        "The production runtime-composition test must not invoke the model.",
      );
    },
  };
}

function containmentRiskStructuredModelClient():
  CapaContainmentRiskAdvisoryStructuredModelClient {
  return {
    async generateStructured() {
      throw new Error(
        "The production S20 runtime-composition test must not invoke the model.",
      );
    },
  };
}

function requestContext() {
  return resolveDevelopmentCapaRequestContext(
    {
      verified_user_id:
        USER_ID,

      authenticated_at:
        "2026-08-19T11:00:00.000Z",

      expires_at_epoch_seconds:
        Date.parse(
          "2026-08-19T13:00:00.000Z",
        ) / 1_000,
    },

    NOW,
  );
}

function productionGlobal():
  ProductionRuntimeGlobal {
  return globalThis as
    ProductionRuntimeGlobal;
}

function clearProductionRuntime():
  void {
  delete productionGlobal()
    .__lvt_capa_production_runtime__;
}

function uuidGenerator():
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

beforeEach(() => {
  clearProductionRuntime();

  mocks.create_sql.mockReset();
  mocks.create_sql.mockReturnValue(
    SQL,
  );
});

afterEach(() => {
  clearProductionRuntime();
});

describe(
  "createCapaProductionRuntime",
  () => {
    it(
      "assembles the durable CAPA adapters around one SQL client",
      () => {
        const runtime =
          createCapaProductionRuntime({
            sql: SQL,
            now: () => NOW,
            generate_uuid:
              uuidGenerator(),
          });

        expect(
          runtime.database,
        ).toBeInstanceOf(
          SupabaseCapaRepository,
        );

        expect(
          runtime.dependencies
            .capa_repository,
        ).toBe(
          runtime.database,
        );

        expect(
          runtime.dependencies
            .transaction_manager,
        ).toBeInstanceOf(
          SupabaseTransactionManager,
        );

        expect(
          runtime.dependencies
            .audit_repository,
        ).toBeInstanceOf(
          SupabaseAuditRepository,
        );

        expect(
          runtime.dependencies
            .case_number_allocator,
        ).toBeInstanceOf(
          SupabaseCapaCaseNumberAllocator,
        );

        expect(
          runtime.dependencies
            .authorization_policy,
        ).toBeInstanceOf(
          SupabaseCapaAuthorizationPolicy,
        );

        expect(
          runtime.submit_intake_dependencies
            .transaction_manager,
        ).toBe(
          runtime.dependencies
            .transaction_manager,
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
          runtime.dependencies
            .audit_repository,
        );

        expect(
          runtime.submit_intake_dependencies
            .workflow_idempotency_repository,
        ).toBeInstanceOf(
          SupabaseCapaWorkflowIdempotencyRepository,
        );

        expect(
          runtime.submit_intake_dependencies
            .authorization_policy,
        ).toBe(
          runtime.dependencies
            .authorization_policy,
        );

        expect(
          runtime.submit_intake_dependencies
            .configuration,
        ).toEqual({
          workflow_version:
            "workflow-1.0.0",
          audit_schema_version:
            "audit-schema-1.0.0",
          authorization_purpose:
            "CAPA_WORKFLOW_TRANSITION",
        });

        expect(
          runtime.accept_containment_risk_dependencies
            .transaction_manager,
        ).toBe(runtime.submit_intake_dependencies.transaction_manager);
        expect(
          runtime.accept_containment_risk_dependencies
            .capa_repository,
        ).toBe(runtime.database);
        expect(
          runtime.approve_scope_dependencies
            .configuration,
        ).toMatchObject({
          step_up_maximum_age_ms: 60 * 60 * 1000,
        });

        expect(
          runtime.accept_containment_risk_dependencies
            .configuration,
        ).toMatchObject({
          workflow_version: "workflow-1.0.0",
          audit_schema_version: "audit-schema-1.0.0",
          step_up_maximum_age_ms: 60 * 60 * 1000,
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
          runtime.approve_scope_dependencies
            .configuration
            .step_up_maximum_age_ms,
        ).toBe(
          runtime.accept_containment_risk_dependencies
            .configuration
            .step_up_maximum_age_ms,
        );

        expect(
          runtime.update_investigation_progress_dependencies
            .transaction_manager,
        ).toBe(
          runtime.submit_intake_dependencies
            .transaction_manager,
        );
        expect(
          runtime.update_investigation_progress_dependencies
            .capa_repository,
        ).toBe(runtime.database);
        expect(
          runtime.update_investigation_progress_dependencies
            .audit_repository,
        ).toBe(
          runtime.submit_intake_dependencies
            .audit_repository,
        );
        expect(
          runtime.update_investigation_progress_dependencies
            .workflow_idempotency_repository,
        ).toBe(
          runtime.submit_intake_dependencies
            .workflow_idempotency_repository,
        );
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
        ).toBe(
          runtime.submit_intake_dependencies
            .transaction_manager,
        );
        expect(
          runtime.submit_root_cause_dependencies
            .capa_repository,
        ).toBe(runtime.database);
        expect(
          runtime.submit_root_cause_dependencies
            .audit_repository,
        ).toBe(
          runtime.submit_intake_dependencies
            .audit_repository,
        );
        expect(
          runtime.submit_root_cause_dependencies
            .workflow_idempotency_repository,
        ).toBe(
          runtime.submit_intake_dependencies
            .workflow_idempotency_repository,
        );
        expect(
          runtime.submit_root_cause_dependencies
            .configuration,
        ).toEqual(
          runtime.submit_intake_dependencies.configuration,
        );

        expect(
          runtime.knowledge_repository,
        ).toBeInstanceOf(
          SupabaseCapaKnowledgeRepository,
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
          "capa-agent-registry-1.0.0",
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
          runtime.resolve_context,
        ).toEqual(
          expect.any(Function),
        );

        expect(
          mocks.create_sql,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "uses controlled production defaults",
      () => {
        const runtime =
          createCapaProductionRuntime({
            sql: SQL,
            now: () => NOW,
            generate_uuid:
              uuidGenerator(),
          });

        expect(
          runtime.dependencies
            .configuration,
        ).toEqual({
          workflow_version:
            "workflow-1.0.0",

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

        expect(
          runtime.dependencies
            .clock
            .now(),
        ).toBe(NOW);
      },
    );

    it(
      "uses the supplied UUID generator for every CAPA identity",
      () => {
        const runtime =
          createCapaProductionRuntime({
            sql: SQL,
            generate_uuid:
              uuidGenerator(),
          });

        const generator =
          runtime.dependencies
            .id_generator;

        expect(
          generator.generateCapaCaseId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000001",
        );

        expect(
          generator.generateCaseVersionId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000002",
        );

        expect(
          generator.generateSectionVersionId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000003",
        );

        expect(
          generator.generateAuditEventId(),
        ).toBe(
          "00000000-0000-4000-8000-000000000004",
        );
      },
    );

    it(
      "accepts explicit controlled release configuration",
      () => {
        const runtime =
          createCapaProductionRuntime({
            sql: SQL,

            workflow_version:
              "workflow-2.1.0",

            intake_schema_version:
              "intake-schema-2.0.0",

            audit_schema_version:
              "audit-schema-2.0.0",

            step_up_maximum_age_ms:
              0,

            required_step_up_assurance:
              "PHISHING_RESISTANT_MFA",
          });

        expect(
          runtime.dependencies
            .configuration,
        ).toMatchObject({
          workflow_version:
            "workflow-2.1.0",

          intake_schema_version:
            "intake-schema-2.0.0",

          audit_schema_version:
            "audit-schema-2.0.0",
        });

        expect(
          runtime.approve_scope_dependencies
            .configuration
            .step_up_maximum_age_ms,
        ).toBe(0);

        expect(
          runtime.accept_containment_risk_dependencies
            .configuration
            .step_up_maximum_age_ms,
        ).toBe(0);
      },
    );

    it.each([
      {
        field:
          "workflow_version" as const,
        value: "",
      },
      {
        field:
          "workflow_version" as const,
        value: " workflow-1.0.0",
      },
      {
        field:
          "intake_schema_version" as const,
        value:
          "x".repeat(101),
      },
      {
        field:
          "audit_schema_version" as const,
        value:
          "audit schema 1",
      },
    ])(
      "rejects invalid $field value '$value'",
      ({
        field,
        value,
      }) => {
        expect(
          () =>
            createCapaProductionRuntime({
              sql: SQL,
              [field]: value,
            }),
        ).toThrow(
          CapaProductionRuntimeConfigurationError,
        );
      },
    );

    it(
      "keeps the production runtime usable without AI configuration but fails advisory creation closed",
      () => {
        const runtime =
          createCapaProductionRuntime({
            sql:
              SQL,

            now:
              () => NOW,

            generate_uuid:
              uuidGenerator(),
          });

        expect(
          runtime.database,
        ).toBeInstanceOf(
          SupabaseCapaRepository,
        );

        expect(
          () =>
            runtime
              .create_intake_advisory_service(
                requestContext(),
              ),
        ).toThrow(
          CapaProductionRuntimeConfigurationError,
        );

        expect(
          () =>
            runtime
              .create_containment_risk_advisory_service(
                requestContext(),
              ),
        ).toThrow(
          CapaProductionRuntimeConfigurationError,
        );
      },
    );

    it("creates request-scoped S20 advisory services from an injected client without an OpenAI key", () => {
      const previousApiKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const runtime = createCapaProductionRuntime({
          sql: SQL,
          now: () => NOW,
          generate_uuid: uuidGenerator(),
          containment_risk_advisory: {
            model: "test-controlled-model",
            structured_model_client:
              containmentRiskStructuredModelClient(),
          },
        });

        const first = runtime.create_containment_risk_advisory_service(requestContext());
        const second = runtime.create_containment_risk_advisory_service(requestContext());

        expect(first).not.toBe(second);
        expect(first.execute).toEqual(expect.any(Function));
        expect(second.execute).toEqual(expect.any(Function));
        expect(runtime.create_intake_advisory_service).toEqual(expect.any(Function));
        expect(() => runtime.create_intake_advisory_service(requestContext())).toThrow(CapaProductionRuntimeConfigurationError);
      } finally {
        if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousApiKey;
      }
    });

    it.each(["", "   "])("rejects invalid S20 model configuration '%s'", (model) => {
      expect(() => createCapaProductionRuntime({ sql: SQL, containment_risk_advisory: { model } })).toThrow(CapaProductionRuntimeConfigurationError);
    });

    it(
      "uses an injected provider-neutral model client without requiring an OpenAI API key",
      () => {
        const previousApiKey =
          process.env.OPENAI_API_KEY;

        delete process.env.OPENAI_API_KEY;

        try {
          const modelClient =
            structuredModelClient();

          const runtime =
            createCapaProductionRuntime({
              sql:
                SQL,

              now:
                () => NOW,

              generate_uuid:
                uuidGenerator(),

              intake_advisory: {
                model:
                  "test-controlled-model",

                retrieval_configuration:
                  advisoryRetrievalConfiguration(),

                structured_model_client:
                  modelClient,
              },
            });

          const first =
            runtime
              .create_intake_advisory_service(
                requestContext(),
              );

          const second =
            runtime
              .create_intake_advisory_service(
                requestContext(),
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
        } finally {
          if (
            previousApiKey ===
              undefined
          ) {
            delete process.env
              .OPENAI_API_KEY;
          } else {
            process.env
              .OPENAI_API_KEY =
                previousApiKey;
          }
        }
      },
    );

    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
    ])(
      "rejects invalid step-up maximum age %s",
      (maximumAge) => {
        expect(
          () =>
            createCapaProductionRuntime({
              sql: SQL,

              step_up_maximum_age_ms:
                maximumAge,
            }),
        ).toThrow(
          CapaProductionRuntimeConfigurationError,
        );
      },
    );

    it.each([
      "",
      " MFA",
      "MFA VALUE",
      "1MFA",
      "M".repeat(65),
    ])(
      "rejects invalid required assurance '%s'",
      (assurance) => {
        expect(
          () =>
            createCapaProductionRuntime({
              sql: SQL,

              required_step_up_assurance:
                assurance,
            }),
        ).toThrow(
          CapaProductionRuntimeConfigurationError,
        );
      },
    );

    it(
      "uses a stable named configuration error",
      () => {
        const error =
          new CapaProductionRuntimeConfigurationError(
            "Invalid production configuration.",
          );

        expect(error).toMatchObject({
          name:
            "CapaProductionRuntimeConfigurationError",

          message:
            "Invalid production configuration.",
        });
      },
    );

    it(
      "creates the configured database client when SQL is not injected",
      () => {
        const runtime =
          createCapaProductionRuntime({
            now: () => NOW,
            generate_uuid:
              uuidGenerator(),
          });

        expect(
          mocks.create_sql,
        ).toHaveBeenCalledTimes(1);

        expect(
          runtime.database,
        ).toBeInstanceOf(
          SupabaseCapaRepository,
        );
      },
    );


    it(
      "provides the production retrieval system clock",
      () => {
        const before = Date.now();
        const result = currentCapaSystemDate();
        const after = Date.now();

        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.getTime()).toBeLessThanOrEqual(after);
      },
    );
  },
);

describe(
  "getCapaProductionRuntime",
  () => {
    it(
      "returns one process-shared durable runtime",
      () => {
        const first =
          getCapaProductionRuntime();

        const second =
          getCapaProductionRuntime();

        expect(second).toBe(first);

        const trustedNow =
          first.dependencies
            .clock
            .now();

        expect(
          trustedNow,
        ).toBeInstanceOf(Date);

        expect(
          Number.isFinite(
            trustedNow.getTime(),
          ),
        ).toBe(true);

        expect(
          mocks.create_sql,
        ).toHaveBeenCalledTimes(1);

        expect(
          productionGlobal()
            .__lvt_capa_production_runtime__,
        ).toBe(first);
      },
    );
  },
);
