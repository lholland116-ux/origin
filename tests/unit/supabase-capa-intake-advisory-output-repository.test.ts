import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  CapaIntakeAdvisoryResponse,
} from "../../lib/capa/ai/capa-intake-advisory-contract";

import type {
  CapaIntakeAdvisoryGenerationTraceCapture,
} from "../../lib/capa/ai/capa-ai-generation-trace";

import {
  SupabaseCapaIntakeAdvisoryOutputRepository,
} from "../../lib/database/supabase/supabase-capa-intake-advisory-output-repository";

import {
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

function harness() {
  const calls: {
    query: string;
    values: readonly unknown[];
  }[] = [];

  const responses: unknown[] = [];

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

      const response =
        responses.shift();

      if (response instanceof Error) {
        throw response;
      }

      return response ?? [];
    },
  );

  const transaction =
    Object.assign(
      tagged,
      {
        json: (value: unknown) => value,
      },
    );

  const sql =
    Object.assign(
      tagged,
      {
        json: (value: unknown) => value,

        begin: vi.fn(
          async (
            _options: string,
            work: (
              value:
                postgres.TransactionSql,
            ) => Promise<unknown>,
          ) =>
            work(
              transaction as unknown as
                postgres.TransactionSql,
            ),
        ),
      },
    ) as unknown as postgres.Sql;

  return {
    sql,
    calls,

    enqueue(
      ...values: unknown[]
    ) {
      responses.push(...values);
    },
  };
}

const ORG =
  "10000000-0000-4000-8000-000000000001";

const CASE_ID =
  "20000000-0000-4000-8000-000000000001";

const CASE_VERSION_ID =
  "30000000-0000-4000-8000-000000000001";

const USER_ID =
  "40000000-0000-4000-8000-000000000001";

const REQUEST_ID =
  "50000000-0000-4000-8000-000000000001";

const CORRELATION_ID =
  "60000000-0000-4000-8000-000000000001";

const RUN_ID =
  "70000000-0000-4000-8000-000000000001";

const OUTPUT_ID =
  "80000000-0000-4000-8000-000000000001";

const PROMPT_PACKAGE_ID =
  "90000000-0000-4000-8000-000000000002";

const context = {
  organization_id: ORG,
  capa_case_id: CASE_ID,
  case_version_id: CASE_VERSION_ID,
  record_version: 2,
  workflow_state: "S10",
  user_id: USER_ID,
  active_role_ids: ["CAPA_OWNER"],
  minimum_case_context: [],
} as never;

const response = {
  run_id: RUN_ID,
  output_id: OUTPUT_ID,
  output_schema_version:
    "capa-intake-draft-output-1.0.0",
  status: "completed_draft",
  proposal: {
    problem_statement_draft:
      "A controlled intake draft.",
    scope_dimensions: [
      "training record",
    ],
    missing_dimensions: [
      "extent",
    ],
    containment_risk_questions: [
      "Is immediate containment required?",
    ],
    investigation_questions: [
      "How was the discrepancy detected?",
    ],
  },
  citations: [],
  assumptions: [],
  missing_information: [
    "extent",
  ],
  conflicts_and_alternatives: [],
  uncertainty_and_limitations: [],
  human_action_required: [
    "Review and edit the advisory draft.",
  ],
  warnings: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
} as unknown as CapaIntakeAdvisoryResponse;

const generationTrace = {
  prompt_package: {
    scope: {
      organization_id: ORG,
      capa_case_id: CASE_ID,
      case_version_id: CASE_VERSION_ID,
      record_version: 2,
      workflow_state: "S10",
    },

    trace: {
      run_id: RUN_ID,
      prompt_package_id:
        PROMPT_PACKAGE_ID,
      request_id: REQUEST_ID,
      correlation_id:
        CORRELATION_ID,
      assembled_at:
        "2026-08-27T12:00:00.000Z",
    },

    agent: {
      agent_id: "AG-INTAKE",
      agent_version:
        "ag-intake-1.0.0",
      output_type:
        "capa-intake-draft-output-1.0.0",
    },

    component_versions: {
      assembly_version:
        "capa-prompt-assembly-1.0.0",
      platform_policy_version:
        "capa-platform-policy-1.0.0",
      product_policy_version:
        "capa-product-policy-1.0.0",
      agent_version:
        "ag-intake-1.0.0",
      workflow_context_version:
        "capa-workflow-context-1.0.0",
      authorization_context_version:
        "capa-authorization-context-1.0.0",
      case_context_schema_version:
        "capa-minimum-case-context-1.0.0",
      retrieval_policy_version:
        "capa-retrieval-policy-1.0.0",
      tool_policy_version:
        "capa-tool-policy-1.0.0",
      output_schema_version:
        "capa-intake-draft-output-1.0.0",
      model_profile_version:
        "capa-model-profile-1.0.0",
      evaluation_suite_version:
        "capa-ai-evaluation-1.0.0",
    },

    layers: [
      {
        position: 1,
        name:
          "platform_system_policy",
        trust:
          "controlled_system",
        content: {
          instruction:
            "Platform policy",
        },
        content_version:
          "capa-platform-policy-1.0.0",
      },
      {
        position: 2,
        name: "product_policy",
        trust:
          "controlled_system",
        content: {
          instruction:
            "Product policy",
        },
        content_version:
          "capa-product-policy-1.0.0",
      },
      {
        position: 3,
        name: "agent_definition",
        trust:
          "controlled_system",
        content: {
          instruction:
            "Agent definition",
        },
        content_version:
          "ag-intake-1.0.0",
      },
      {
        position: 4,
        name: "workflow_context",
        trust:
          "trusted_server_context",
        content: {
          workflow_state: "S10",
        },
        content_version:
          "capa-workflow-context-1.0.0",
      },
      {
        position: 5,
        name:
          "authorization_context",
        trust:
          "trusted_server_context",
        content: {
          authorized_operation:
            "draft_intake_analysis",
          authorization_policy_version:
            "capa-authorization-context-1.0.0",
        },
        content_version:
          "capa-authorization-context-1.0.0",
      },
      {
        position: 6,
        name:
          "minimum_case_context",
        trust:
          "trusted_server_context",
        content: [],
        content_version:
          "capa-minimum-case-context-1.0.0",
      },
      {
        position: 7,
        name: "retrieved_sources",
        trust: "untrusted_data",
        content: [],
        content_version:
          "capa-retrieval-policy-1.0.0",
      },
      {
        position: 8,
        name: "user_request",
        trust: "untrusted_data",
        content: {
          trust:
            "untrusted_data",
          provenance_type:
            "user_request",
          content:
            "Assess intake completeness.",
        },
        content_version:
          "capa-prompt-assembly-1.0.0",
      },
      {
        position: 9,
        name: "tool_results",
        trust: "untrusted_data",
        content: [],
        content_version:
          "capa-tool-policy-1.0.0",
      },
      {
        position: 10,
        name: "output_contract",
        trust:
          "controlled_system",
        content: {
          instruction:
            "Return controlled structured advisory output.",
        },
        content_version:
          "capa-intake-draft-output-1.0.0",
      },
    ],

    reduction_applied: false,
  },

  rendered_prompt:
    "controlled rendered prompt",

  model_profile_version:
    "capa-model-profile-1.0.0",
} as unknown as
  CapaIntakeAdvisoryGenerationTraceCapture;

const input = {
  context,
  response,
  generation_trace:
    generationTrace,
  request_id: REQUEST_ID as never,
  correlation_id:
    CORRELATION_ID as never,
};

describe(
  "Supabase CAPA intake advisory output repository",
  () => {
    it("persists a validated advisory only while the CAPA case remains current", async () => {
      const test = harness();

      test.enqueue([
        {
          capa_case_id: CASE_ID,
        },
      ]);

      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      const result =
        await manager.runInTransaction(
          {
            request_id:
              REQUEST_ID as never,
            correlation_id:
              CORRELATION_ID as never,
          },
          (transaction) =>
            repository.save(
              transaction,
              input,
            ),
        );

      expect(result).toBe("saved");

      expect(test.calls).toHaveLength(3);

      expect(
        test.calls[0]?.query,
      ).toContain(
        "from public.capa_cases",
      );

      expect(
        test.calls[0]?.query,
      ).toContain(
        "current_version_id = ?",
      );

      expect(
        test.calls[0]?.query,
      ).toContain(
        "record_version = ?",
      );

      expect(
        test.calls[0]?.query,
      ).toContain(
        "status = ?",
      );

      expect(
        test.calls[0]?.query,
      ).toContain(
        "for update",
      );

      expect(
        test.calls[0]?.values,
      ).toEqual(
        expect.arrayContaining([
          ORG,
          CASE_ID,
          CASE_VERSION_ID,
          2,
          "S10",
        ]),
      );

      expect(
        test.calls[1]?.query,
      ).toContain(
        "insert into public.capa_ai_outputs",
      );

      expect(
        test.calls[1]?.values,
      ).toEqual(
        expect.arrayContaining([
          ORG,
          OUTPUT_ID,
          RUN_ID,
          CASE_ID,
          CASE_VERSION_ID,
          REQUEST_ID,
          CORRELATION_ID,
          "AG-INTAKE",
          "ag-intake-1.0.0",
          "capa-intake-draft-output-1.0.0",
          "completed_draft",
          true,
          false,
        ]),
      );
      const traceCall =
        test.calls[2];

      expect(
        traceCall?.query,
      ).toContain(
        "insert into public.capa_ai_generation_traces",
      );

      expect(
        traceCall?.values,
      ).toEqual(
        expect.arrayContaining([
          ORG,
          RUN_ID,
          OUTPUT_ID,
          CASE_ID,
          CASE_VERSION_ID,
          2,
          "completed_draft",
          REQUEST_ID,
          CORRELATION_ID,
          PROMPT_PACKAGE_ID,
          "capa-ai-generation-trace-1.0.0",
          "sha256-canonical-json-v1",
          "capa-model-profile-1.0.0",
          generationTrace
            .prompt_package,
        ]),
      );

      const fingerprintValues =
        traceCall?.values.filter(
          (value): value is string =>
            typeof value === "string" &&
            /^[0-9a-f]{64}$/.test(
              value,
            ),
        ) ?? [];

      expect(
        fingerprintValues,
      ).toHaveLength(4);
    });

    it("refuses persistence when the CAPA case changed before the guarded write", async () => {
      const test = harness();

      test.enqueue([]);

      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      const result =
        await manager.runInTransaction(
          {
            request_id:
              REQUEST_ID as never,
            correlation_id:
              CORRELATION_ID as never,
          },
          (transaction) =>
            repository.save(
              transaction,
              input,
            ),
        );

      expect(result).toBe(
        "case_changed",
      );

      expect(test.calls).toHaveLength(1);

      expect(
        test.calls.some(
          (call) =>
            call.query.includes(
              "insert into public.capa_ai_outputs",
            ),
        ),
      ).toBe(false);

      expect(
        test.calls.some(
          (call) =>
            call.query.includes(
              "insert into public.capa_ai_generation_traces",
            ),
        ),
      ).toBe(false);
    });

    it("rejects request-trace mismatch before issuing SQL", async () => {
      const test = harness();

      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      await expect(
        manager.runInTransaction(
          {
            request_id:
              "90000000-0000-4000-8000-000000000001" as never,
            correlation_id:
              CORRELATION_ID as never,
          },
          (transaction) =>
            repository.save(
              transaction,
              input,
            ),
        ),
      ).rejects.toMatchObject({
        name:
          "SupabaseCapaIntakeAdvisoryOutputRepositoryError",
      });

      expect(test.calls).toHaveLength(0);
    });

    it("fails closed for invalid advisory authority invariants", async () => {
      const test = harness();

      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      await expect(
        manager.runInTransaction(
          {
            request_id:
              REQUEST_ID as never,
            correlation_id:
              CORRELATION_ID as never,
          },
          (transaction) =>
            repository.save(
              transaction,
              {
                ...input,
                response: {
                  ...response,
                  workflow_mutated:
                    true,
                } as never,
              },
            ),
        ),
      ).rejects.toMatchObject({
        name:
          "SupabaseCapaIntakeAdvisoryOutputRepositoryError",
      });

      expect(test.calls).toHaveLength(0);
    });

    it("rejects generation-run identity mismatch before issuing SQL", async () => {
      const test = harness();

      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      const mismatchedTrace = {
        ...generationTrace,
        prompt_package: {
          ...generationTrace.prompt_package,
          trace: {
            ...generationTrace
              .prompt_package
              .trace,
            run_id:
              "91000000-0000-4000-8000-000000000001",
          },
        },
      } as unknown as
        CapaIntakeAdvisoryGenerationTraceCapture;

      await expect(
        manager.runInTransaction(
          {
            request_id:
              REQUEST_ID as never,
            correlation_id:
              CORRELATION_ID as never,
          },
          (transaction) =>
            repository.save(
              transaction,
              {
                ...input,
                generation_trace:
                  mismatchedTrace,
              },
            ),
        ),
      ).rejects.toMatchObject({
        name:
          "SupabaseCapaIntakeAdvisoryOutputRepositoryError",
      });

      expect(test.calls).toHaveLength(0);
    });

    it("rejects malformed generation trace before issuing SQL", async () => {
      const test = harness();

      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      const malformedTrace = {
        ...generationTrace,
        prompt_package: {
          ...generationTrace.prompt_package,
          layers: [],
        },
      } as unknown as
        CapaIntakeAdvisoryGenerationTraceCapture;

      await expect(
        manager.runInTransaction(
          {
            request_id:
              REQUEST_ID as never,
            correlation_id:
              CORRELATION_ID as never,
          },
          (transaction) =>
            repository.save(
              transaction,
              {
                ...input,
                generation_trace:
                  malformedTrace,
              },
            ),
        ),
      ).rejects.toMatchObject({
        name:
          "SupabaseCapaIntakeAdvisoryOutputRepositoryError",
      });

      expect(test.calls).toHaveLength(0);
    });

    it("fails the transaction when generation-trace persistence fails", async () => {
      const test = harness();

      test.enqueue(
        [
          {
            capa_case_id: CASE_ID,
          },
        ],
        [],
        new Error(
          "simulated generation-trace insert failure",
        ),
      );

      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      await expect(
        manager.runInTransaction(
          {
            request_id:
              REQUEST_ID as never,
            correlation_id:
              CORRELATION_ID as never,
          },
          (transaction) =>
            repository.save(
              transaction,
              input,
            ),
        ),
      ).rejects.toThrow(
        "simulated generation-trace insert failure",
      );

      expect(test.calls).toHaveLength(3);

      expect(
        test.calls[1]?.query,
      ).toContain(
        "insert into public.capa_ai_outputs",
      );

      expect(
        test.calls[2]?.query,
      ).toContain(
        "insert into public.capa_ai_generation_traces",
      );
    });

    it("rejects a manufactured transaction context", async () => {
      const repository =
        new SupabaseCapaIntakeAdvisoryOutputRepository();

      await expect(
        repository.save(
          Object.freeze({
            transaction_id:
              "fake-transaction",
            started_at:
              "2026-08-25T12:00:00.000Z",
            request_trace: {
              request_id:
                REQUEST_ID,
              correlation_id:
                CORRELATION_ID,
            },
          }) as never,
          input,
        ),
      ).rejects.toMatchObject({
        name:
          "SupabaseTransactionContextError",
      });
    });
  },
);
