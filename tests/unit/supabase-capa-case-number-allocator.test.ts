import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  CorrelationId,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import {
  CapaCaseNumberAllocationError,
  CapaCaseNumberExhaustedError,
  SupabaseCapaCaseNumberAllocator,
} from "../../lib/database/supabase/supabase-capa-case-number-allocator";

import {
  SupabaseTransactionContextError,
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

import type {
  TransactionContext,
} from "../../lib/database/transactions";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as
    OrganizationId;

interface SqlCall {
  readonly query: string;
  readonly values: readonly unknown[];
}

interface SqlHarness {
  readonly sql: postgres.Sql;
  readonly calls: SqlCall[];

  enqueue(
    ...responses: readonly unknown[]
  ): void;
}

function requestTrace(): RequestTrace {
  return {
    request_id:
      "20000000-0000-4000-8000-000000000002" as
        RequestId,

    correlation_id:
      "30000000-0000-4000-8000-000000000003" as
        CorrelationId,
  };
}

function createSqlHarness(): SqlHarness {
  const responses: unknown[] = [];
  const calls: SqlCall[] = [];

  const transactionTagged = vi.fn(
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

  const outerSql = Object.assign(
    vi.fn(),
    {
      begin: vi.fn(
        async (
          _options: string,
          work: (
            transactionSql:
              postgres.TransactionSql,
          ) => Promise<unknown>,
        ) =>
          work(
            transactionTagged as unknown as
              postgres.TransactionSql,
          ),
      ),
    },
  );

  return {
    sql:
      outerSql as unknown as
        postgres.Sql,

    calls,

    enqueue(...nextResponses) {
      responses.push(
        ...nextResponses,
      );
    },
  };
}

async function inTransaction<Result>(
  harness: SqlHarness,
  work: (
    transaction: TransactionContext,
  ) => Promise<Result>,
): Promise<Result> {
  const manager =
    new SupabaseTransactionManager(
      harness.sql,
    );

  return manager.runInTransaction(
    requestTrace(),
    work,
  );
}

async function allocate(
  harness: SqlHarness,
): Promise<string> {
  const allocator =
    new SupabaseCapaCaseNumberAllocator();

  return inTransaction(
    harness,
    (transaction) =>
      allocator.allocateNextCaseNumber(
        transaction,
        ORGANIZATION_ID,
      ),
  );
}

describe(
  "SupabaseCapaCaseNumberAllocator",
  () => {
    it(
      "formats the first allocated number",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          {
            last_allocated_number: 1,
          },
        ]);

        await expect(
          allocate(harness),
        ).resolves.toBe(
          "CAPA-000001",
        );
      },
    );

    it(
      "formats a PostgreSQL bigint string",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          {
            last_allocated_number:
              "42",
          },
        ]);

        await expect(
          allocate(harness),
        ).resolves.toBe(
          "CAPA-000042",
        );
      },
    );

    it(
      "formats the maximum controlled number",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          {
            last_allocated_number:
              999_999,
          },
        ]);

        await expect(
          allocate(harness),
        ).resolves.toBe(
          "CAPA-999999",
        );
      },
    );

    it(
      "executes the atomic organization-scoped upsert",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          {
            last_allocated_number: 1,
          },
        ]);

        await allocate(harness);

        expect(harness.calls).toHaveLength(
          1,
        );

        expect(
          harness.calls[0]?.query,
        ).toContain(
          "insert into public.capa_case_number_counters as counter",
        );

        expect(
          harness.calls[0]?.query,
        ).toContain(
          "on conflict (organization_id) do update",
        );

        expect(
          harness.calls[0]?.query,
        ).toContain(
          "counter.last_allocated_number + 1",
        );

        expect(
          harness.calls[0]?.query,
        ).toContain(
          "returning counter.last_allocated_number",
        );

        expect(
          harness.calls[0]?.values,
        ).toEqual([
          ORGANIZATION_ID,
          999_999,
        ]);
      },
    );

    it(
      "raises a named exhaustion error when no row is returned",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([]);

        await expect(
          allocate(harness),
        ).rejects.toEqual(
          expect.objectContaining({
            name:
              "CapaCaseNumberExhaustedError",

            message:
              "The organization has exhausted its available CAPA case numbers.",
          }),
        );
      },
    );

    it(
      "raises a named result error when multiple rows are returned",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          {
            last_allocated_number: 1,
          },
          {
            last_allocated_number: 2,
          },
        ]);

        await expect(
          allocate(harness),
        ).rejects.toEqual(
          expect.objectContaining({
            name:
              "CapaCaseNumberAllocationError",

            message:
              "The CAPA case-number allocator returned an unexpected result.",
          }),
        );
      },
    );

    it(
      "rejects an undefined allocation row",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          undefined,
        ]);

        await expect(
          allocate(harness),
        ).rejects.toThrow(
          "The CAPA case-number allocator returned an unexpected result.",
        );
      },
    );

    it.each([
      {
        value: Number.NaN,
        description: "NaN",
      },
      {
        value:
          Number.POSITIVE_INFINITY,
        description: "Infinity",
      },
      {
        value: 1.5,
        description: "a fraction",
      },
      {
        value: 0,
        description: "zero",
      },
      {
        value: -1,
        description: "a negative number",
      },
      {
        value: 1_000_000,
        description:
          "a number above the controlled maximum",
      },
      {
        value: "not-a-number",
        description:
          "a malformed bigint string",
      },
    ])(
      "rejects $description",
      async ({ value }) => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          {
            last_allocated_number:
              value,
          },
        ]);

        await expect(
          allocate(harness),
        ).rejects.toThrow(
          "The CAPA case-number allocator returned an invalid value.",
        );
      },
    );

    it(
      "propagates a database failure",
      async () => {
        const harness =
          createSqlHarness();

        const databaseError =
          new Error(
            "database unavailable",
          );

        harness.enqueue(
          databaseError,
        );

        await expect(
          allocate(harness),
        ).rejects.toBe(
          databaseError,
        );
      },
    );

    it(
      "rejects a forged transaction context before querying",
      async () => {
        const harness =
          createSqlHarness();

        const allocator =
          new SupabaseCapaCaseNumberAllocator();

        const forged =
          Object.freeze({
            transaction_id:
              "forged-transaction",

            started_at:
              "2026-08-17T19:00:00.000Z",

            request_trace:
              requestTrace(),
          }) as TransactionContext;

        await expect(
          allocator.allocateNextCaseNumber(
            forged,
            ORGANIZATION_ID,
          ),
        ).rejects.toBeInstanceOf(
          SupabaseTransactionContextError,
        );

        expect(
          harness.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "rejects reuse of a completed transaction context",
      async () => {
        const harness =
          createSqlHarness();

        const allocator =
          new SupabaseCapaCaseNumberAllocator();

        let completed:
          | TransactionContext
          | undefined;

        harness.enqueue([
          {
            last_allocated_number: 1,
          },
        ]);

        await inTransaction(
          harness,
          async (transaction) => {
            completed =
              transaction;

            await allocator
              .allocateNextCaseNumber(
                transaction,
                ORGANIZATION_ID,
              );
          },
        );

        expect(completed).toBeDefined();

        await expect(
          allocator.allocateNextCaseNumber(
            completed as TransactionContext,
            ORGANIZATION_ID,
          ),
        ).rejects.toBeInstanceOf(
          SupabaseTransactionContextError,
        );

        expect(
          harness.calls,
        ).toHaveLength(1);
      },
    );
  },
);

describe(
  "CAPA case-number allocation errors",
  () => {
    it(
      "provides a stable default allocation error",
      () => {
        const error =
          new CapaCaseNumberAllocationError();

        expect(error.name).toBe(
          "CapaCaseNumberAllocationError",
        );

        expect(error.message).toBe(
          "The CAPA case number could not be allocated.",
        );
      },
    );

    it(
      "uses a specialized exhaustion error",
      () => {
        const error =
          new CapaCaseNumberExhaustedError();

        expect(error).toBeInstanceOf(
          CapaCaseNumberAllocationError,
        );

        expect(error.name).toBe(
          "CapaCaseNumberExhaustedError",
        );
      },
    );
  },
);