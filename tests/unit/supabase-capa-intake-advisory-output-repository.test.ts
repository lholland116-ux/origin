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

      return responses.shift() ?? [];
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

const input = {
  context,
  response,
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

      expect(test.calls).toHaveLength(2);

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
