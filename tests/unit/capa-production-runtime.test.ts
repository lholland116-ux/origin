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
  getCapaProductionRuntime,
} from "../../lib/capa/application/capa-production-runtime";

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
  SupabaseCapaRepository,
} from "../../lib/database/supabase/supabase-capa-repository";

import {
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

const NOW =
  new Date(
    "2026-08-19T12:00:00.000Z",
  );

const SQL =
  vi.fn() as unknown as postgres.Sql;

type ProductionRuntimeGlobal =
  typeof globalThis & {
    __lvt_capa_production_runtime__?:
      ReturnType<
        typeof createCapaProductionRuntime
      >;
  };

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