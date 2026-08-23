import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  ControlledCode,
  CorrelationId,
  IdempotencyKey,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowRequestFingerprint,
} from "../../lib/database/repositories/capa-workflow-idempotency-repository";

import {
  CapaWorkflowIdempotencyConfigurationError,
  CapaWorkflowIdempotencyError,
  SupabaseCapaWorkflowIdempotencyRepository,
} from "../../lib/database/supabase/supabase-capa-workflow-idempotency-repository";

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

const IDEMPOTENCY_KEY =
  "submit-intake-request-1" as
    IdempotencyKey;

const OPERATION_CODE =
  "SUBMIT_CAPA_INTAKE" as
    ControlledCode;

const FINGERPRINT =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as
    CapaWorkflowRequestFingerprint;

const OTHER_FINGERPRINT =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as
    CapaWorkflowRequestFingerprint;

const CASE_ID =
  "20000000-0000-4000-8000-000000000002" as
    CapaCaseId;

const SOURCE_VERSION_ID =
  "30000000-0000-4000-8000-000000000003" as
    CapaCaseVersionId;

const RESULTING_VERSION_ID =
  "40000000-0000-4000-8000-000000000004" as
    CapaCaseVersionId;

const AUDIT_EVENT_ID =
  "50000000-0000-4000-8000-000000000005" as
    AuditEventId;

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
      "60000000-0000-4000-8000-000000000006" as
        RequestId,
    correlation_id:
      "70000000-0000-4000-8000-000000000007" as
        CorrelationId,
    idempotency_key:
      IDEMPOTENCY_KEY,
  };
}

function validRecord(
  overrides:
    Partial<CapaWorkflowIdempotencyRecord> = {},
): CapaWorkflowIdempotencyRecord {
  return {
    organization_id:
      ORGANIZATION_ID,
    idempotency_key:
      IDEMPOTENCY_KEY,
    operation_code:
      OPERATION_CODE,
    request_fingerprint:
      FINGERPRINT,
    capa_case_id:
      CASE_ID,
    source_case_version_id:
      SOURCE_VERSION_ID,
    resulting_case_version_id:
      RESULTING_VERSION_ID,
    audit_event_id:
      AUDIT_EVENT_ID,
    ...overrides,
  };
}

function databaseRow(
  overrides:
    Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    organization_id:
      ORGANIZATION_ID,
    idempotency_key:
      IDEMPOTENCY_KEY,
    operation_code:
      OPERATION_CODE,
    request_fingerprint:
      FINGERPRINT,
    capa_case_id:
      CASE_ID,
    source_case_version_id:
      SOURCE_VERSION_ID,
    resulting_case_version_id:
      RESULTING_VERSION_ID,
    audit_event_id:
      AUDIT_EVENT_ID,
    ...overrides,
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

async function claim(
  harness: SqlHarness,
  record:
    CapaWorkflowIdempotencyRecord =
      validRecord(),
) {
  const repository =
    new SupabaseCapaWorkflowIdempotencyRepository();

  return inTransaction(
    harness,
    (transaction) =>
      repository.claimWorkflowOperation(
        transaction,
        record,
      ),
  );
}

describe(
  "SupabaseCapaWorkflowIdempotencyRepository",
  () => {
    it(
      "claims a new organization-local workflow key",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          databaseRow(),
        ]);

        await expect(
          claim(harness),
        ).resolves.toEqual({
          status: "claimed",
          record: validRecord(),
        });

        expect(harness.calls).toHaveLength(
          1,
        );
        expect(
          harness.calls[0]?.query,
        ).toContain(
          "insert into public.capa_workflow_idempotency",
        );
        expect(
          harness.calls[0]?.query,
        ).toContain(
          "on conflict ( organization_id, idempotency_key ) do nothing",
        );
        expect(
          harness.calls[0]?.values,
        ).toEqual([
          ORGANIZATION_ID,
          IDEMPOTENCY_KEY,
          OPERATION_CODE,
          FINGERPRINT,
          CASE_ID,
          SOURCE_VERSION_ID,
          RESULTING_VERSION_ID,
          AUDIT_EVENT_ID,
        ]);
      },
    );

    it(
      "returns the authoritative record for an exact retry",
      async () => {
        const harness =
          createSqlHarness();

        const authoritativeVersionId =
          "80000000-0000-4000-8000-000000000008";

        harness.enqueue(
          [],
          [
            databaseRow({
              resulting_case_version_id:
                authoritativeVersionId,
            }),
          ],
        );

        const result =
          await claim(harness);

        expect(result).toMatchObject({
          status:
            "already_claimed",
          record: {
            resulting_case_version_id:
              authoritativeVersionId,
            operation_code:
              OPERATION_CODE,
            request_fingerprint:
              FINGERPRINT,
          },
        });

        expect(harness.calls).toHaveLength(
          2,
        );
        expect(
          harness.calls[1]?.query,
        ).toContain(
          "where organization_id = ? and idempotency_key = ? limit 1",
        );
        expect(
          harness.calls[1]?.values,
        ).toEqual([
          ORGANIZATION_ID,
          IDEMPOTENCY_KEY,
        ]);
      },
    );

    it.each([
      {
        description:
          "different request content",
        overrides: {
          request_fingerprint:
            OTHER_FINGERPRINT,
        },
      },
      {
        description:
          "a different operation",
        overrides: {
          operation_code:
            "APPROVE_ROOT_CAUSE" as
              ControlledCode,
        },
      },
    ])(
      "returns a controlled conflict for $description",
      async ({ overrides }) => {
        const harness =
          createSqlHarness();

        harness.enqueue(
          [],
          [databaseRow()],
        );

        await expect(
          claim(
            harness,
            validRecord(overrides),
          ),
        ).resolves.toEqual({
          status: "conflict",
          record: validRecord(),
          reason_code:
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        });
      },
    );

    it(
      "fails closed when a conflicting claim cannot be resolved",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([], []);

        await expect(
          claim(harness),
        ).rejects.toThrow(
          "The CAPA workflow idempotency repository returned an unexpected result.",
        );
      },
    );

    it(
      "rejects multiple inserted rows",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          databaseRow(),
          databaseRow(),
        ]);

        await expect(
          claim(harness),
        ).rejects.toBeInstanceOf(
          CapaWorkflowIdempotencyError,
        );
      },
    );

    it(
      "rejects multiple authoritative rows",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue(
          [],
          [
            databaseRow(),
            databaseRow(),
          ],
        );

        await expect(
          claim(harness),
        ).rejects.toThrow(
          "The CAPA workflow idempotency repository returned an unexpected result.",
        );
      },
    );

    it.each([
      null,
      {},
      {
        ...databaseRow(),
        audit_event_id: 42,
      },
    ])(
      "rejects malformed database row %#",
      async (row) => {
        const harness =
          createSqlHarness();

        harness.enqueue([row]);

        await expect(
          claim(harness),
        ).rejects.toThrow(
          "The CAPA workflow idempotency repository returned an invalid row.",
        );
      },
    );

    it(
      "rejects a returned row containing invalid controlled data",
      async () => {
        const harness =
          createSqlHarness();

        harness.enqueue([
          databaseRow({
            capa_case_id:
              "not-a-uuid",
          }),
        ]);

        await expect(
          claim(harness),
        ).rejects.toBeInstanceOf(
          CapaWorkflowIdempotencyConfigurationError,
        );
      },
    );

    it.each([
      "organization_id",
      "capa_case_id",
      "source_case_version_id",
      "resulting_case_version_id",
      "audit_event_id",
    ] as const)(
      "rejects invalid %s before querying",
      async (field) => {
        const harness =
          createSqlHarness();

        await expect(
          claim(
            harness,
            validRecord({
              [field]: "not-a-uuid",
            }),
          ),
        ).rejects.toThrow(
          `${field} must be a valid UUID.`,
        );

        expect(harness.calls).toHaveLength(
          0,
        );
      },
    );

    it.each([
      "",
      " key-with-whitespace ",
      "x".repeat(129),
    ])(
      "rejects invalid idempotency key %#",
      async (value) => {
        const harness =
          createSqlHarness();

        await expect(
          claim(
            harness,
            validRecord({
              idempotency_key:
                value as IdempotencyKey,
            }),
          ),
        ).rejects.toThrow(
          "idempotency_key must contain 1 through 128 characters without surrounding whitespace.",
        );

        expect(harness.calls).toHaveLength(
          0,
        );
      },
    );

    it.each([
      "",
      "INVALID OPERATION",
      "1INVALID",
      `A${"x".repeat(64)}`,
    ])(
      "rejects invalid operation code %#",
      async (value) => {
        const harness =
          createSqlHarness();

        await expect(
          claim(
            harness,
            validRecord({
              operation_code:
                value as ControlledCode,
            }),
          ),
        ).rejects.toThrow(
          "operation_code must be a valid controlled code containing at most 64 characters.",
        );

        expect(harness.calls).toHaveLength(
          0,
        );
      },
    );

    it.each([
      "abc",
      "A".repeat(64),
    ])(
      "rejects invalid request fingerprint %#",
      async (value) => {
        const harness =
          createSqlHarness();

        await expect(
          claim(
            harness,
            validRecord({
              request_fingerprint:
                value as CapaWorkflowRequestFingerprint,
            }),
          ),
        ).rejects.toThrow(
          "request_fingerprint must be a lowercase hexadecimal SHA-256 digest.",
        );

        expect(harness.calls).toHaveLength(
          0,
        );
      },
    );

    it(
      "rejects identical source and resulting versions before querying",
      async () => {
        const harness =
          createSqlHarness();

        await expect(
          claim(
            harness,
            validRecord({
              resulting_case_version_id:
                SOURCE_VERSION_ID,
            }),
          ),
        ).rejects.toThrow(
          "source_case_version_id and resulting_case_version_id must be distinct.",
        );

        expect(harness.calls).toHaveLength(
          0,
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

        harness.enqueue(databaseError);

        await expect(
          claim(harness),
        ).rejects.toBe(
          databaseError,
        );
      },
    );

    it(
      "rejects a forged transaction before querying",
      async () => {
        const harness =
          createSqlHarness();
        const repository =
          new SupabaseCapaWorkflowIdempotencyRepository();
        const forged =
          Object.freeze({
            transaction_id:
              "forged-transaction",
            started_at:
              "2026-08-23T12:00:00.000Z",
            request_trace:
              requestTrace(),
          }) as TransactionContext;

        await expect(
          repository.claimWorkflowOperation(
            forged,
            validRecord(),
          ),
        ).rejects.toBeInstanceOf(
          SupabaseTransactionContextError,
        );

        expect(harness.calls).toHaveLength(
          0,
        );
      },
    );

    it(
      "rejects reuse of a completed transaction",
      async () => {
        const harness =
          createSqlHarness();
        const repository =
          new SupabaseCapaWorkflowIdempotencyRepository();
        let completed:
          | TransactionContext
          | undefined;

        harness.enqueue([
          databaseRow(),
        ]);

        await inTransaction(
          harness,
          async (transaction) => {
            completed = transaction;
            await repository
              .claimWorkflowOperation(
                transaction,
                validRecord(),
              );
          },
        );

        await expect(
          repository.claimWorkflowOperation(
            completed as TransactionContext,
            validRecord(),
          ),
        ).rejects.toBeInstanceOf(
          SupabaseTransactionContextError,
        );

        expect(harness.calls).toHaveLength(
          1,
        );
      },
    );
  },
);

describe(
  "CAPA workflow-idempotency errors",
  () => {
    it(
      "provides a stable default repository error",
      () => {
        const error =
          new CapaWorkflowIdempotencyError();

        expect(error.name).toBe(
          "CapaWorkflowIdempotencyError",
        );
        expect(error.message).toBe(
          "The CAPA workflow idempotency claim could not be resolved.",
        );
      },
    );

    it(
      "provides a specialized configuration error",
      () => {
        const error =
          new CapaWorkflowIdempotencyConfigurationError(
            "invalid configuration",
          );

        expect(error).toBeInstanceOf(
          CapaWorkflowIdempotencyError,
        );
        expect(error.name).toBe(
          "CapaWorkflowIdempotencyConfigurationError",
        );
        expect(error.message).toBe(
          "invalid configuration",
        );
      },
    );
  },
);
