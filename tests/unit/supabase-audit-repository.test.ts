import { describe, expect, it, vi } from "vitest";

import type postgres from "postgres";

import type {
  ActorReference,
  AuditEvent,
  AuditEventId,
  ControlledCode,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  AuditCursor,
} from "../../lib/database/repositories/audit-repository";

import type {
  TransactionContext,
} from "../../lib/database/transactions";

import {
  SupabaseAuditQueryError,
  SupabaseAuditRepository,
} from "../../lib/database/supabase/supabase-audit-repository";

import {
  SupabaseTransactionContextError,
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as OrganizationId;

const EVENT_ID =
  "10000000-0000-4000-8000-000000000002" as AuditEventId;

const SECOND_EVENT_ID =
  "10000000-0000-4000-8000-000000000003" as AuditEventId;

const REQUEST_ID =
  "10000000-0000-4000-8000-000000000004" as RequestId;

const CORRELATION_ID =
  "10000000-0000-4000-8000-000000000005" as CorrelationId;

const IDEMPOTENCY_KEY =
  "capa-audit-test-key" as IdempotencyKey;

const NOW =
  "2026-08-12T17:00:00.000Z" as IsoDateTime;

const ACTOR: ActorReference = {
  actor_type: "human",
  actor_id:
    "10000000-0000-4000-8000-000000000006",
};

function requestTrace(): RequestTrace {
  return {
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
  };
}

function auditEvent(
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    organization_id: ORGANIZATION_ID,
    event_id: EVENT_ID,
    event_type:
      "EVT-CASE-CREATED" as ControlledCode,
    schema_version: "audit-schema-1.0.0",
    aggregate_type:
      "CAPA_CASE" as ControlledCode,
    aggregate_id:
      "10000000-0000-4000-8000-000000000010",
    actor: ACTOR,
    occurred_at: NOW,
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    action:
      "CREATE_CAPA_DRAFT" as ControlledCode,
    target: {
      object_type:
        "CAPA_CASE" as ControlledCode,
      object_id:
        "10000000-0000-4000-8000-000000000010",
    },
    outcome: "succeeded",
    configuration_versions: {
      workflow: "workflow-1.0.0",
      audit_schema: "audit-schema-1.0.0",
    },
    metadata: {
      case_number: "CAPA-2026-0001",
    },
    ...overrides,
  };
}

function auditRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    event_id: EVENT_ID,
    organization_id: ORGANIZATION_ID,
    event_type: "EVT-CASE-CREATED",
    schema_version: "audit-schema-1.0.0",
    aggregate_type: "CAPA_CASE",
    aggregate_id:
      "10000000-0000-4000-8000-000000000010",
    aggregate_version: null,
    actor_type: "human",
    actor_id:
      "10000000-0000-4000-8000-000000000006",
    actor_version: null,
    occurred_at: new Date(NOW),
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    idempotency_key: null,
    action: "CREATE_CAPA_DRAFT",
    target_object_type: "CAPA_CASE",
    target_object_id:
      "10000000-0000-4000-8000-000000000010",
    target_object_version_id: null,
    outcome: "succeeded",
    reason: null,
    before_object_type: null,
    before_object_id: null,
    before_object_version_id: null,
    after_object_type: null,
    after_object_id: null,
    after_object_version_id: null,
    change_set: null,
    configuration_versions: {
      workflow: "workflow-1.0.0",
      audit_schema: "audit-schema-1.0.0",
    },
    metadata: {
      case_number: "CAPA-2026-0001",
    },
    ...overrides,
  };
}

interface SqlCall {
  readonly query: string;
  readonly values: readonly unknown[];
}

interface SqlHarness {
  readonly sql: postgres.Sql;
  readonly transaction_sql: postgres.TransactionSql;
  readonly calls: SqlCall[];
  readonly json: ReturnType<typeof vi.fn>;
  enqueue(...responses: readonly unknown[]): void;
}

function createSqlHarness(): SqlHarness {
  const responses: unknown[] = [];
  const calls: SqlCall[] = [];

  function createTaggedSql() {
    return vi.fn(
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
  }

  const outerSql = createTaggedSql();
  const transactionSql = createTaggedSql();
  const json = vi.fn((value: unknown) => value);

  Object.assign(outerSql, {
    json,
    begin: vi.fn(
      async (
        _options: string,
        work: (
          sql: postgres.TransactionSql,
        ) => Promise<unknown>,
      ) =>
        work(
          transactionSql as unknown as postgres.TransactionSql,
        ),
    ),
  });

  Object.assign(transactionSql, {
    json,
  });

  return {
    sql: outerSql as unknown as postgres.Sql,
    transaction_sql:
      transactionSql as unknown as postgres.TransactionSql,
    calls,
    json,
    enqueue(...nextResponses) {
      responses.push(...nextResponses);
    },
  };
}

async function inTransaction<Result>(
  harness: SqlHarness,
  work: (
    transaction: TransactionContext,
  ) => Promise<Result>,
): Promise<Result> {
  const manager = new SupabaseTransactionManager(
    harness.sql,
  );

  return manager.runInTransaction(
    requestTrace(),
    work,
  );
}

describe("SupabaseAuditRepository append", () => {
  it("appends an immutable audit event", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      {
        event_id: EVENT_ID,
      },
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.appendEvent(
          transaction,
          auditEvent(),
        ),
    );

    expect(result).toEqual({
      status: "appended",
      event_id: EVENT_ID,
    });

    expect(harness.calls).toHaveLength(1);

    expect(harness.calls[0]?.query).toContain(
      "insert into public.capa_audit_events",
    );

    expect(harness.calls[0]?.query).toContain(
      "on conflict (event_id) do nothing",
    );
  });

  it("maps every optional audit field into the insert", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      {
        event_id: EVENT_ID,
      },
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const event = auditEvent({
      aggregate_version: 2,
      actor: {
        actor_type: "service",
        actor_id: "capa-service",
        actor_version: "service-1.0.0",
      },
      idempotency_key: IDEMPOTENCY_KEY,
      target: {
        object_type:
          "CAPA_CASE" as ControlledCode,
        object_id:
          "10000000-0000-4000-8000-000000000010",
        object_version_id:
          "10000000-0000-4000-8000-000000000011",
      },
      reason: "Controlled reason",
      change: {
        before_ref: {
          object_type:
            "CAPA_CASE" as ControlledCode,
          object_id:
            "10000000-0000-4000-8000-000000000010",
          object_version_id:
            "10000000-0000-4000-8000-000000000012",
        },
        after_ref: {
          object_type:
            "CAPA_CASE" as ControlledCode,
          object_id:
            "10000000-0000-4000-8000-000000000010",
          object_version_id:
            "10000000-0000-4000-8000-000000000011",
        },
        change_set: {
          status: {
            before: "S00",
            after: "S10",
          },
        },
      },
    });

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.appendEvent(
          transaction,
          event,
        );
      },
    );

    expect(harness.calls[0]?.values).toContain(2);
    expect(harness.calls[0]?.values).toContain(
      IDEMPOTENCY_KEY,
    );
    expect(harness.calls[0]?.values).toContain(
      "Controlled reason",
    );

    expect(harness.json).toHaveBeenCalledWith({
      status: {
        before: "S00",
        after: "S10",
      },
    });
  });

  it("returns already_recorded for an exact retry", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [],
      [auditRow()],
    );

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.appendEvent(
          transaction,
          auditEvent(),
        ),
    );

    expect(result).toEqual({
      status: "already_recorded",
      event_id: EVENT_ID,
    });

    expect(harness.calls).toHaveLength(2);
  });

  it("returns conflict for different existing content", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [],
      [
        auditRow({
          outcome: "failed",
        }),
      ],
    );

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.appendEvent(
          transaction,
          auditEvent(),
        ),
    );

    expect(result).toEqual({
      status: "conflict",
      event_id: EVENT_ID,
      reason_code:
        "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
    });
  });

  it("returns conflict when the colliding event is outside the organization", async () => {
    const harness = createSqlHarness();

    harness.enqueue([], []);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.appendEvent(
          transaction,
          auditEvent(),
        ),
    );

    expect(result).toEqual({
      status: "conflict",
      event_id: EVENT_ID,
      reason_code:
        "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
    });
  });

  it("rejects non-serializable audit JSON", async () => {
    const harness = createSqlHarness();

    const repository =
      new SupabaseAuditRepository(harness.sql);

    await expect(
      inTransaction(
        harness,
        async (transaction) =>
          repository.appendEvent(
            transaction,
            auditEvent({
              metadata:
                undefined as unknown as Readonly<
                  Record<string, unknown>
                >,
            }),
          ),
      ),
    ).rejects.toThrow(
      "CAPA audit content cannot be serialized as JSON.",
    );
  });

  it("rejects a forged transaction context", async () => {
    const harness = createSqlHarness();

    const repository =
      new SupabaseAuditRepository(harness.sql);

    await expect(
      repository.appendEvent(
        {
          transaction_id: "forged",
          started_at: NOW,
          request_trace: requestTrace(),
        } as TransactionContext,
        auditEvent(),
      ),
    ).rejects.toBeInstanceOf(
      SupabaseTransactionContextError,
    );
  });
});

describe("SupabaseAuditRepository reads", () => {
  it("returns null when the tenant-scoped event is absent", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    await expect(
      repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      ),
    ).resolves.toBeNull();

    expect(harness.calls[0]?.values).toEqual([
      ORGANIZATION_ID,
      EVENT_ID,
    ]);
  });

  it("maps a minimal audit event", async () => {
    const harness = createSqlHarness();

    harness.enqueue([auditRow()]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      );

    expect(result).toEqual(auditEvent());

    expect(result).not.toHaveProperty(
      "aggregate_version",
    );
    expect(result).not.toHaveProperty(
      "idempotency_key",
    );
    expect(result).not.toHaveProperty("reason");
    expect(result).not.toHaveProperty("change");
  });

  it("maps a complete audit event", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        aggregate_version: "2",
        actor_type: "service",
        actor_id: "capa-service",
        actor_version: "service-1.0.0",
        idempotency_key: IDEMPOTENCY_KEY,
        target_object_version_id:
          "10000000-0000-4000-8000-000000000011",
        reason: "Controlled reason",
        before_object_type: "CAPA_CASE",
        before_object_id:
          "10000000-0000-4000-8000-000000000010",
        before_object_version_id:
          "10000000-0000-4000-8000-000000000012",
        after_object_type: "CAPA_CASE",
        after_object_id:
          "10000000-0000-4000-8000-000000000010",
        after_object_version_id:
          "10000000-0000-4000-8000-000000000011",
        change_set: {
          status: {
            before: "S00",
            after: "S10",
          },
        },
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      );

    expect(result).toMatchObject({
      aggregate_version: 2,
      actor: {
        actor_type: "service",
        actor_id: "capa-service",
        actor_version: "service-1.0.0",
      },
      idempotency_key: IDEMPOTENCY_KEY,
      reason: "Controlled reason",
      target: {
        object_version_id:
          "10000000-0000-4000-8000-000000000011",
      },
      change: {
        before_ref: {
          object_version_id:
            "10000000-0000-4000-8000-000000000012",
        },
        after_ref: {
          object_version_id:
            "10000000-0000-4000-8000-000000000011",
        },
        change_set: {
          status: {
            before: "S00",
            after: "S10",
          },
        },
      },
    });
  });

  it.each([
    0,
    -1,
    "invalid",
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "rejects invalid aggregate versions: %s",
    async (aggregateVersion) => {
      const harness = createSqlHarness();

      harness.enqueue([
        auditRow({
          aggregate_version:
            aggregateVersion,
        }),
      ]);

      const repository =
        new SupabaseAuditRepository(harness.sql);

      await expect(
        repository.findEventById(
          ORGANIZATION_ID,
          EVENT_ID,
        ),
      ).rejects.toThrow(
        "Invalid aggregate version returned by the CAPA audit database.",
      );
    },
  );

  it.each([
    null,
    [],
    "invalid",
  ])(
    "rejects invalid metadata: %s",
    async (metadata) => {
      const harness = createSqlHarness();

      harness.enqueue([
        auditRow({ metadata }),
      ]);

      const repository =
        new SupabaseAuditRepository(harness.sql);

      await expect(
        repository.findEventById(
          ORGANIZATION_ID,
          EVENT_ID,
        ),
      ).rejects.toThrow(
        "Invalid metadata returned by the CAPA audit database.",
      );
    },
  );

  it("rejects non-string configuration values", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        configuration_versions: {
          workflow: 2,
        },
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    await expect(
      repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      ),
    ).rejects.toThrow(
      "Invalid configuration versions returned by the CAPA audit database.",
    );
  });

  it.each([
    null,
    [],
    "invalid",
  ])(
    "rejects invalid configuration maps: %s",
    async (configurationVersions) => {
      const harness = createSqlHarness();

      harness.enqueue([
        auditRow({
          configuration_versions:
            configurationVersions,
        }),
      ]);

      const repository =
        new SupabaseAuditRepository(harness.sql);

      await expect(
        repository.findEventById(
          ORGANIZATION_ID,
          EVENT_ID,
        ),
      ).rejects.toThrow(
        "Invalid configuration versions returned by the CAPA audit database.",
      );
    },
  );

  it("rejects malformed before references", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        before_object_type: "CAPA_CASE",
        before_object_id: null,
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    await expect(
      repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      ),
    ).rejects.toThrow(
      "Invalid before-object reference returned by the CAPA audit database.",
    );
  });

  it("rejects malformed after references", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        after_object_type: null,
        after_object_id:
          "10000000-0000-4000-8000-000000000010",
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    await expect(
      repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      ),
    ).rejects.toThrow(
      "Invalid after-object reference returned by the CAPA audit database.",
    );
  });

  it("rejects malformed change sets", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        change_set: [],
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    await expect(
      repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      ),
    ).rejects.toThrow(
      "Invalid change set returned by the CAPA audit database.",
    );
  });

  it("maps references without version identities", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        before_object_type: "CAPA_CASE",
        before_object_id:
          "10000000-0000-4000-8000-000000000010",
        before_object_version_id: null,
        after_object_type: "CAPA_CASE",
        after_object_id:
          "10000000-0000-4000-8000-000000000010",
        after_object_version_id: null,
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      );

    expect(result?.change).toEqual({
      before_ref: {
        object_type: "CAPA_CASE",
        object_id:
          "10000000-0000-4000-8000-000000000010",
      },
      after_ref: {
        object_type: "CAPA_CASE",
        object_id:
          "10000000-0000-4000-8000-000000000010",
      },
    });
  });

  it("maps an after-only audit change", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        after_object_type: "CAPA_CASE",
        after_object_id:
          "10000000-0000-4000-8000-000000000010",
        after_object_version_id:
          "10000000-0000-4000-8000-000000000011",
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      );

    expect(result?.change).toEqual({
      after_ref: {
        object_type: "CAPA_CASE",
        object_id:
          "10000000-0000-4000-8000-000000000010",
        object_version_id:
          "10000000-0000-4000-8000-000000000011",
      },
    });

    expect(result?.change).not.toHaveProperty(
      "before_ref",
    );
  });

  it("maps a before-only audit change", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        before_object_type: "CAPA_CASE",
        before_object_id:
          "10000000-0000-4000-8000-000000000010",
        before_object_version_id:
          "10000000-0000-4000-8000-000000000012",
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      );

    expect(result?.change).toEqual({
      before_ref: {
        object_type: "CAPA_CASE",
        object_id:
          "10000000-0000-4000-8000-000000000010",
        object_version_id:
          "10000000-0000-4000-8000-000000000012",
      },
    });

    expect(result?.change).not.toHaveProperty(
      "after_ref",
    );
  });
});

describe("SupabaseAuditRepository pagination", () => {
  it.each([
    0,
    -1,
    101,
    1.5,
    Number.NaN,
  ])(
    "rejects invalid page limits: %s",
    async (limit) => {
      const harness = createSqlHarness();

      const repository =
        new SupabaseAuditRepository(harness.sql);

      await expect(
        repository.listEventsForAggregate({
          organization_id:
            ORGANIZATION_ID,
          aggregate_type:
            "CAPA_CASE" as ControlledCode,
          aggregate_id: "case-1",
          limit,
        }),
      ).rejects.toBeInstanceOf(
        SupabaseAuditQueryError,
      );
    },
  );

  it.each([
    "-1",
    "1.5",
    "invalid",
    String(Number.MAX_SAFE_INTEGER + 1),
  ])(
    "rejects invalid cursors: %s",
    async (cursor) => {
      const harness = createSqlHarness();

      const repository =
        new SupabaseAuditRepository(harness.sql);

      await expect(
        repository.listEventsForAggregate({
          organization_id:
            ORGANIZATION_ID,
          aggregate_type:
            "CAPA_CASE" as ControlledCode,
          aggregate_id: "case-1",
          limit: 10,
          cursor: cursor as AuditCursor,
        }),
      ).rejects.toBeInstanceOf(
        SupabaseAuditQueryError,
      );
    },
  );

  it("returns a final ordered page without a cursor", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow(),
      auditRow({
        event_id: SECOND_EVENT_ID,
        occurred_at:
          "2026-08-12T17:01:00.000Z",
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.listEventsForAggregate({
        organization_id:
          ORGANIZATION_ID,
        aggregate_type:
          "CAPA_CASE" as ControlledCode,
        aggregate_id:
          "10000000-0000-4000-8000-000000000010",
        limit: 2,
      });

    expect(result.events).toHaveLength(2);
    expect(result).not.toHaveProperty(
      "next_cursor",
    );

    expect(harness.calls[0]?.query).toContain(
      "order by occurred_at asc, event_id asc",
    );

    expect(harness.calls[0]?.values).toContain(0);
  });

  it("returns a bounded page and next cursor", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow(),
      auditRow({
        event_id: SECOND_EVENT_ID,
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.listEventsForAggregate({
        organization_id:
          ORGANIZATION_ID,
        aggregate_type:
          "CAPA_CASE" as ControlledCode,
        aggregate_id:
          "10000000-0000-4000-8000-000000000010",
        limit: 1,
      });

    expect(result.events).toHaveLength(1);
    expect(result.next_cursor).toBe(
      "1",
    );
  });

  it("continues from a valid cursor offset", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      auditRow({
        event_id: SECOND_EVENT_ID,
      }),
    ]);

    const repository =
      new SupabaseAuditRepository(harness.sql);

    const result =
      await repository.listEventsForAggregate({
        organization_id:
          ORGANIZATION_ID,
        aggregate_type:
          "CAPA_CASE" as ControlledCode,
        aggregate_id:
          "10000000-0000-4000-8000-000000000010",
        limit: 10,
        cursor: "1" as AuditCursor,
      });

    expect(result.events).toHaveLength(1);
    expect(harness.calls[0]?.values).toContain(1);
  });
});