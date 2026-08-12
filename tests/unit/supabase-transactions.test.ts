import { afterEach, describe, expect, it, vi } from "vitest";

import type postgres from "postgres";

import type {
  CorrelationId,
  IdempotencyKey,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  TransactionContext,
  TransactionWork,
} from "../../lib/database/transactions";

const { postgresMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: postgresMock,
}));

import {
  createSupabaseDatabaseSql,
  requireSupabaseTransaction,
  SupabaseTransactionContextError,
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

const TEST_DATABASE_URL =
  "postgresql://postgres.test:password@example.test:6543/postgres";

function requestTrace(): RequestTrace {
  return {
    request_id:
      "10000000-0000-4000-8000-000000000001" as RequestId,
    correlation_id:
      "10000000-0000-4000-8000-000000000002" as CorrelationId,
    idempotency_key:
      "transaction-test-key" as IdempotencyKey,
  };
}

interface TransactionHarness {
  readonly sql: postgres.Sql;
  readonly transaction_sql: postgres.TransactionSql;
  readonly begin: ReturnType<typeof vi.fn>;
}

function createTransactionHarness(): TransactionHarness {
  const transactionSql = {
    unsafe: vi.fn(),
  } as unknown as postgres.TransactionSql;

  const begin = vi.fn(
    async (
      options: string,
      work: (
        transaction: postgres.TransactionSql,
      ) => Promise<unknown> | unknown,
    ) => {
      expect(options).toBe(
        "isolation level read committed",
      );

      return work(transactionSql);
    },
  );

  const sql = {
    begin,
  } as unknown as postgres.Sql;

  return {
    sql,
    transaction_sql: transactionSql,
    begin,
  };
}

afterEach(() => {
  postgresMock.mockReset();
  delete process.env.CAPA_DATABASE_URL;
});

describe("createSupabaseDatabaseSql", () => {
  it("creates a transaction-pooler-compatible client", () => {
    const expectedSql = {} as postgres.Sql;

    postgresMock.mockReturnValue(expectedSql);

    const result = createSupabaseDatabaseSql({
      connection_string: TEST_DATABASE_URL,
    });

    expect(result).toBe(expectedSql);

    expect(postgresMock).toHaveBeenCalledWith(
      TEST_DATABASE_URL,
      {
        prepare: false,
        max: 1,
        idle_timeout: 20,
        connect_timeout: 10,
        max_lifetime: 60 * 30,
        connection: {
          application_name: "lvtchat-capa",
        },
      },
    );
  });

  it("uses the server-only environment variable", () => {
    process.env.CAPA_DATABASE_URL =
      TEST_DATABASE_URL;

    const expectedSql = {} as postgres.Sql;

    postgresMock.mockReturnValue(expectedSql);

    expect(createSupabaseDatabaseSql()).toBe(
      expectedSql,
    );

    expect(postgresMock).toHaveBeenCalledWith(
      TEST_DATABASE_URL,
      expect.objectContaining({
        prepare: false,
      }),
    );
  });

  it("accepts controlled pool configuration", () => {
    postgresMock.mockReturnValue({});

    createSupabaseDatabaseSql({
      connection_string: TEST_DATABASE_URL,
      maximum_connections: 2,
      idle_timeout_seconds: 30,
      connect_timeout_seconds: 15,
    });

    expect(postgresMock).toHaveBeenCalledWith(
      TEST_DATABASE_URL,
      expect.objectContaining({
        max: 2,
        idle_timeout: 30,
        connect_timeout: 15,
      }),
    );
  });

  it("fails when the database URL is missing", () => {
    expect(() =>
      createSupabaseDatabaseSql(),
    ).toThrowError(
      "Missing CAPA_DATABASE_URL server environment variable.",
    );

    expect(postgresMock).not.toHaveBeenCalled();
  });

  it("rejects malformed database URLs", () => {
    expect(() =>
      createSupabaseDatabaseSql({
        connection_string: "not a database URL",
      }),
    ).toThrowError(
      "CAPA_DATABASE_URL is not a valid PostgreSQL connection URL.",
    );

    expect(postgresMock).not.toHaveBeenCalled();
  });

  it("rejects non-PostgreSQL protocols", () => {
    expect(() =>
      createSupabaseDatabaseSql({
        connection_string:
          "https://example.test/database",
      }),
    ).toThrowError(
      "CAPA_DATABASE_URL must use the postgres or postgresql protocol.",
    );

    expect(postgresMock).not.toHaveBeenCalled();
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])(
    "rejects invalid maximum_connections: %s",
    (maximumConnections) => {
      expect(() =>
        createSupabaseDatabaseSql({
          connection_string: TEST_DATABASE_URL,
          maximum_connections:
            maximumConnections,
        }),
      ).toThrowError(
        "maximum_connections must be a positive integer.",
      );
    },
  );

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])(
    "rejects invalid idle_timeout_seconds: %s",
    (idleTimeoutSeconds) => {
      expect(() =>
        createSupabaseDatabaseSql({
          connection_string: TEST_DATABASE_URL,
          idle_timeout_seconds:
            idleTimeoutSeconds,
        }),
      ).toThrowError(
        "idle_timeout_seconds must be a non-negative number.",
      );
    },
  );

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])(
    "rejects invalid connect_timeout_seconds: %s",
    (connectTimeoutSeconds) => {
      expect(() =>
        createSupabaseDatabaseSql({
          connection_string: TEST_DATABASE_URL,
          connect_timeout_seconds:
            connectTimeoutSeconds,
        }),
      ).toThrowError(
        "connect_timeout_seconds must be greater than zero.",
      );
    },
  );
});

describe("SupabaseTransactionManager", () => {
  it("executes work through one physical transaction", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    const result = await manager.runInTransaction(
      requestTrace(),
      async (transaction) => {
        expect(
          requireSupabaseTransaction(transaction),
        ).toBe(harness.transaction_sql);

        return "completed";
      },
    );

    expect(result).toBe("completed");
    expect(harness.begin).toHaveBeenCalledTimes(1);
  });

  it("creates an opaque frozen transaction context", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    await manager.runInTransaction(
      requestTrace(),
      async (transaction) => {
        expect(transaction.transaction_id).toEqual(
          expect.any(String),
        );

        expect(transaction.started_at).toEqual(
          expect.any(String),
        );

        expect(
          Number.isNaN(
            Date.parse(transaction.started_at),
          ),
        ).toBe(false);

        expect(Object.isFrozen(transaction)).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            transaction.request_trace,
          ),
        ).toBe(true);
      },
    );
  });

  it("preserves request tracing without retaining a mutable reference", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    const trace = requestTrace();

    await manager.runInTransaction(
      trace,
      async (transaction) => {
        expect(transaction.request_trace).toEqual(
          trace,
        );

        expect(transaction.request_trace).not.toBe(
          trace,
        );
      },
    );
  });

  it("supports request traces without an idempotency key", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    const trace: RequestTrace = {
      request_id:
        "10000000-0000-4000-8000-000000000003" as RequestId,
      correlation_id:
        "10000000-0000-4000-8000-000000000004" as CorrelationId,
    };

    await manager.runInTransaction(
      trace,
      async (transaction) => {
        expect(transaction.request_trace).toEqual(
          trace,
        );

        expect(
          transaction.request_trace,
        ).not.toHaveProperty("idempotency_key");

        expect(
          Object.isFrozen(
            transaction.request_trace,
          ),
        ).toBe(true);
      },
    );
  });

  it("rejects a copied transaction context", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    await manager.runInTransaction(
      requestTrace(),
      async (transaction) => {
        const copiedTransaction: TransactionContext = {
          ...transaction,
        };

        expect(() =>
          requireSupabaseTransaction(
            copiedTransaction,
          ),
        ).toThrowError(
          SupabaseTransactionContextError,
        );
      },
    );
  });

  it("rejects a manufactured transaction context", () => {
    const forged = {
      transaction_id:
        "forged-transaction",
      started_at:
        "2026-08-12T16:00:00.000Z",
      request_trace: requestTrace(),
    } as TransactionContext;

    expect(() =>
      requireSupabaseTransaction(forged),
    ).toThrowError(
      SupabaseTransactionContextError,
    );
  });

  it("rejects a completed transaction context", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    let completedTransaction:
      | TransactionContext
      | undefined;

    await manager.runInTransaction(
      requestTrace(),
      async (transaction) => {
        completedTransaction = transaction;

        expect(
          requireSupabaseTransaction(transaction),
        ).toBe(harness.transaction_sql);
      },
    );

    expect(completedTransaction).toBeDefined();

    expect(() =>
      requireSupabaseTransaction(
        completedTransaction!,
      ),
    ).toThrowError(
      SupabaseTransactionContextError,
    );
  });

  it("invalidates the context when work throws", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    const failure = new Error(
      "Controlled transaction failure",
    );

    let failedTransaction:
      | TransactionContext
      | undefined;

    await expect(
      manager.runInTransaction(
        requestTrace(),
        async (transaction) => {
          failedTransaction = transaction;
          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    expect(failedTransaction).toBeDefined();

    expect(() =>
      requireSupabaseTransaction(
        failedTransaction!,
      ),
    ).toThrowError(
      SupabaseTransactionContextError,
    );
  });

  it("propagates the original transaction failure", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    const failure = new Error(
      "Database work failed",
    );

    await expect(
      manager.runInTransaction(
        requestTrace(),
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });

  it("rejects a non-function transaction callback", async () => {
    const harness = createTransactionHarness();

    const manager = new SupabaseTransactionManager(
      harness.sql,
    );

    await expect(
      manager.runInTransaction(
        requestTrace(),
        null as unknown as TransactionWork<unknown>,
      ),
    ).rejects.toThrowError(
      "Transaction work must be a function.",
    );

    expect(harness.begin).not.toHaveBeenCalled();
  });
});