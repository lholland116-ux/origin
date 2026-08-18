import { describe, expect, it } from "vitest";

import type {
  ActorReference,
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseStatus,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  ControlledCode,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  AdvanceCapaVersionInput,
} from "../../lib/database/repositories/capa-repository";

import {
  InMemoryAuditQueryError,
  InMemoryCapaCaseNumberExhaustedError,
  InMemoryCapaDatabase,
  InMemoryCapaDatabaseConfigurationError,
  InMemoryDuplicateRecordError,
  InMemoryIntegrityError,
  InMemoryTransactionConflictError,
  InMemoryTransactionNotActiveError,
} from "../../lib/database/in-memory/in-memory-capa-database";

import type {
  AuditCursor,
} from "../../lib/database/repositories/audit-repository";

import type {
  TransactionContext,
  TransactionId,
} from "../../lib/database/transactions";

const NOW = new Date("2026-08-12T01:00:00.000Z");

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as OrganizationId;

const OTHER_ORGANIZATION_ID =
  "9508a4d7-36e6-49ae-ae36-8d33a6bba431" as OrganizationId;

const CASE_ID =
  "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as CapaCaseId;

const OTHER_CASE_ID =
  "45dd941d-f49d-4e9d-b118-c971c9d31f51" as CapaCaseId;

const VERSION_ID =
  "a65d17e5-4688-4412-aa08-f2832b37f671" as CapaCaseVersionId;

const NEXT_VERSION_ID =
  "9dff109c-baa2-4086-96bf-7b789251da09" as CapaCaseVersionId;

const SECTION_ID =
  "779594ce-cb78-4818-a173-4c1e8217637f" as CapaSectionVersionId;

const OTHER_SECTION_ID =
  "29680fc8-7633-4444-96f9-3099405a55c1" as CapaSectionVersionId;

const EVENT_ID =
  "bed889a5-8a47-4dd8-bebf-f79f31b795e7" as AuditEventId;

const ACTOR: ActorReference = {
  actor_type: "human",
  actor_id: "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23",
};

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function iso(value: string): IsoDateTime {
  return value as IsoDateTime;
}

function requestTrace(): RequestTrace {
  return {
    request_id:
      "098c6760-7c3a-4de2-92fa-cd45f46c2321" as RequestId,
    correlation_id:
      "55633f2e-eb6a-4dc6-840f-d4be782f9f23" as CorrelationId,
    idempotency_key:
      "database-adapter-test" as IdempotencyKey,
  };
}

function createDatabase(
  generateTransactionId?: () => TransactionId,
): InMemoryCapaDatabase {
  let sequence = 0;

  return new InMemoryCapaDatabase({
    generate_transaction_id:
      generateTransactionId ??
      (() => {
        sequence += 1;

        return `transaction-${sequence}` as TransactionId;
      }),

    now() {
      return NOW;
    },
  });
}

function capaCase(
  overrides: Partial<CapaCase> = {},
): CapaCase {
  return {
    organization_id: ORGANIZATION_ID,
    capa_case_id: CASE_ID,
    case_number: "CAPA-000001",
    current_version_id: VERSION_ID,
    status: "S00" as CapaCaseStatus,
    owner_user_id:
      "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23" as CapaCase["owner_user_id"],
    confidentiality:
      controlled("CUSTOMER_CONFIDENTIAL"),
    effective_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    record_version: 1,
    created_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    created_by: ACTOR,
    updated_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    updated_by: ACTOR,
    ...overrides,
  };
}

function sectionVersion(
  overrides: Partial<CapaSectionVersion> = {},
): CapaSectionVersion {
  return {
    organization_id: ORGANIZATION_ID,
    section_version_id: SECTION_ID,
    capa_case_id: CASE_ID,
    section_type: controlled("CAPA.INTAKE"),
    version_number: 1,
    schema_version: "intake-schema-1.0.0",
    content: {
      initiating_event: "Seal defect trend",
    },
    change_reason: "Initial CAPA intake",
    effective_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    created_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    created_by: ACTOR,
    ...overrides,
  };
}

function caseVersion(
  overrides: Partial<CapaCaseVersion> = {},
): CapaCaseVersion {
  return {
    organization_id: ORGANIZATION_ID,
    case_version_id: VERSION_ID,
    capa_case_id: CASE_ID,
    version_number: 1,
    change_reason: "Initial CAPA creation",
    status: "S00" as CapaCaseStatus,
    section_version_ids: [SECTION_ID],
    effective_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    created_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    created_by: ACTOR,
    ...overrides,
  };
}

function auditEvent(
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    organization_id: ORGANIZATION_ID,
    event_id: EVENT_ID,
    event_type: controlled("EVT-CASE-CREATED"),
    schema_version: "audit-schema-1.0.0",
    aggregate_type: controlled("CAPA_CASE"),
    aggregate_id: CASE_ID,
    aggregate_version: 1,
    actor: ACTOR,
    occurred_at: iso(
      "2026-08-12T01:00:00.000Z",
    ),
    request_id: requestTrace().request_id,
    correlation_id:
      requestTrace().correlation_id,
    idempotency_key:
      requestTrace().idempotency_key,
    action: controlled("CREATE_CAPA_DRAFT"),
    target: {
      object_type: controlled("CAPA_CASE"),
      object_id: CASE_ID,
      object_version_id: VERSION_ID,
    },
    outcome: "succeeded",
    configuration_versions: {
      workflow: "workflow-1.0.0",
    },
    metadata: {},
    ...overrides,
  };
}

async function seedValidCase(
  database: InMemoryCapaDatabase,
): Promise<void> {
  await database.runInTransaction(
    requestTrace(),
    async (transaction) => {
      await database.insertCase(
        transaction,
        capaCase(),
      );

      await database.insertSectionVersion(
        transaction,
        sectionVersion(),
      );

      await database.insertCaseVersion(
        transaction,
        caseVersion(),
      );
    },
  );
}

describe("InMemoryCapaDatabase transactions", () => {
  it("returns the work result and supplies transaction metadata", async () => {
    const database = createDatabase();

    let observed:
      | TransactionContext
      | undefined;

    const result = await database.runInTransaction(
      requestTrace(),
      async (transaction) => {
        observed = transaction;
        return "committed";
      },
    );

    expect(result).toBe("committed");
    expect(observed).toMatchObject({
      transaction_id: "transaction-1",
      started_at: "2026-08-12T01:00:00.000Z",
      request_trace: requestTrace(),
    });
  });

  it("rejects reuse of an active transaction identity", async () => {
    const repeatedId =
      "repeated-transaction" as TransactionId;

    const database = createDatabase(
      () => repeatedId,
    );

    await expect(
      database.runInTransaction(
        requestTrace(),
        async () =>
          database.runInTransaction(
            requestTrace(),
            async () => undefined,
          ),
      ),
    ).rejects.toBeInstanceOf(
      InMemoryDuplicateRecordError,
    );
  });

  it("rejects operations using a completed transaction", async () => {
    const database = createDatabase();

    let completedTransaction:
      | TransactionContext
      | undefined;

    await database.runInTransaction(
      requestTrace(),
      async (transaction) => {
        completedTransaction = transaction;
      },
    );

    if (completedTransaction === undefined) {
      throw new Error(
        "Expected a completed transaction.",
      );
    }

    await expect(
      database.appendEvent(
        completedTransaction,
        auditEvent(),
      ),
    ).rejects.toBeInstanceOf(
      InMemoryTransactionNotActiveError,
    );
  });

  it("rejects a forged context using an active transaction identity", async () => {
    const database = createDatabase();

    await database.runInTransaction(
      requestTrace(),
      async (transaction) => {
        const forgedTransaction: TransactionContext = {
          ...transaction,
        };

        await expect(
          database.appendEvent(
            forgedTransaction,
            auditEvent(),
          ),
        ).rejects.toBeInstanceOf(
          InMemoryTransactionNotActiveError,
        );
      },
    );

    expect(
      await database.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      ),
    ).toBeNull();
  });

  it("rolls back writes when transaction work throws", async () => {
    const database = createDatabase();
    const failure = new Error("Work failed");

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertCase(
            transaction,
            capaCase(),
          );

          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    expect(
      await database.findCaseById(
        ORGANIZATION_ID,
        CASE_ID,
      ),
    ).toBeNull();

    expect(
      await database.caseNumberExists(
        ORGANIZATION_ID,
        "CAPA-000001",
      ),
    ).toBe(false);
  });

  it("rejects a stale concurrent transaction at commit", async () => {
    const database = createDatabase();

    let releaseFirst:
      | (() => void)
      | undefined;

    const firstGate = new Promise<void>(
      (resolve) => {
        releaseFirst = resolve;
      },
    );

    const firstTransaction =
      database.runInTransaction(
        requestTrace(),
        async () => {
          await firstGate;
          return "first";
        },
      );

    await database.runInTransaction(
      requestTrace(),
      async () => "second",
    );

    if (releaseFirst === undefined) {
      throw new Error(
        "Expected the first transaction release function.",
      );
    }

    releaseFirst();

    await expect(
      firstTransaction,
    ).rejects.toBeInstanceOf(
      InMemoryTransactionConflictError,
    );
  });
});

describe("InMemoryCapaDatabase immutable inserts", () => {
  it("rejects duplicate case identities and case numbers", async () => {
    const database = createDatabase();

    await seedValidCase(database);

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertCase(
            transaction,
            capaCase(),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryDuplicateRecordError,
    );

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertCase(
            transaction,
            capaCase({
              capa_case_id: OTHER_CASE_ID,
            }),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryDuplicateRecordError,
    );
  });

  it("rejects duplicate section and case-version identities", async () => {
    const database = createDatabase();

    await seedValidCase(database);

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertSectionVersion(
            transaction,
            sectionVersion(),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryDuplicateRecordError,
    );

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertCaseVersion(
            transaction,
            caseVersion(),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryDuplicateRecordError,
    );
  });
});

describe(
  "InMemoryCapaDatabase case-number allocation",
  () => {
    it.each([
      {
        maximum: Number.NaN,
        description: "NaN",
      },
      {
        maximum: Number.POSITIVE_INFINITY,
        description: "infinity",
      },
      {
        maximum: 0,
        description: "zero",
      },
      {
        maximum: -1,
        description: "a negative number",
      },
      {
        maximum: 1.5,
        description: "a fractional number",
      },
      {
        maximum: 1_000_000,
        description:
          "a number above the controlled maximum",
      },
    ])(
      "rejects $description as an invalid maximum",
      ({ maximum }) => {
        expect(
          () =>
            new InMemoryCapaDatabase({
              generate_transaction_id() {
                return "invalid-configuration" as TransactionId;
              },

              now() {
                return NOW;
              },

              maximum_case_number:
                maximum,
            }),
        ).toThrow(
          InMemoryCapaDatabaseConfigurationError,
        );
      },
    );

    it("provides stable named allocation errors", () => {
      const configurationError =
        new InMemoryCapaDatabaseConfigurationError();

      expect(configurationError).toMatchObject({
        name: "InMemoryCapaDatabaseConfigurationError",
        message:
          "The in-memory CAPA case-number maximum must be a positive safe integer no greater than 999999.",
      });

      const exhaustionError =
        new InMemoryCapaCaseNumberExhaustedError();

      expect(exhaustionError).toMatchObject({
        name: "InMemoryCapaCaseNumberExhaustedError",
        message:
          "The organization has exhausted its available CAPA case numbers.",
      });
    });

    it(
      "allocates sequential organization-local numbers and rolls back failed allocations",
      async () => {
        const database = createDatabase();
        const failure = new Error(
          "Simulated transaction failure.",
        );

        await expect(
          database.runInTransaction(
            requestTrace(),
            async (transaction) => {
              await expect(
                database.allocateNextCaseNumber(
                  transaction,
                  ORGANIZATION_ID,
                ),
              ).resolves.toBe("CAPA-000001");

              throw failure;
            },
          ),
        ).rejects.toBe(failure);

        const first =
          await database.runInTransaction(
            requestTrace(),
            (transaction) =>
              database.allocateNextCaseNumber(
                transaction,
                ORGANIZATION_ID,
              ),
          );

        const second =
          await database.runInTransaction(
            requestTrace(),
            (transaction) =>
              database.allocateNextCaseNumber(
                transaction,
                ORGANIZATION_ID,
              ),
          );

        const otherOrganization =
          await database.runInTransaction(
            requestTrace(),
            (transaction) =>
              database.allocateNextCaseNumber(
                transaction,
                OTHER_ORGANIZATION_ID,
              ),
          );

        expect(first).toBe("CAPA-000001");
        expect(second).toBe("CAPA-000002");
        expect(otherOrganization).toBe(
          "CAPA-000001",
        );
      },
    );

    it(
      "fails closed after an organization exhausts its controlled range",
      async () => {
        let transactionSequence = 0;

        const database =
          new InMemoryCapaDatabase({
            generate_transaction_id() {
              transactionSequence += 1;

              return (
                `limited-transaction-${transactionSequence}`
              ) as TransactionId;
            },

            now() {
              return NOW;
            },

            maximum_case_number: 2,
          });

        for (const expected of [
          "CAPA-000001",
          "CAPA-000002",
        ]) {
          await expect(
            database.runInTransaction(
              requestTrace(),
              (transaction) =>
                database.allocateNextCaseNumber(
                  transaction,
                  ORGANIZATION_ID,
                ),
            ),
          ).resolves.toBe(expected);
        }

        await expect(
          database.runInTransaction(
            requestTrace(),
            (transaction) =>
              database.allocateNextCaseNumber(
                transaction,
                ORGANIZATION_ID,
              ),
          ),
        ).rejects.toBeInstanceOf(
          InMemoryCapaCaseNumberExhaustedError,
        );
      },
    );
  },
);

describe("InMemoryCapaDatabase optimistic concurrency", () => {
  function advanceInput(
    overrides: Partial<AdvanceCapaVersionInput> = {},
  ): AdvanceCapaVersionInput {
    return {
      organization_id: ORGANIZATION_ID,
      capa_case_id: CASE_ID,
      expected_record_version: 1,
      expected_current_version_id: VERSION_ID,
      next_current_version_id: NEXT_VERSION_ID,
      next_status: "S10" as CapaCaseStatus,
      updated_at: iso(
        "2026-08-12T01:30:00.000Z",
      ),
      updated_by: ACTOR,
      ...overrides,
    };
  }

  it("advances the current version when expectations match", async () => {
    const database = createDatabase();

    await seedValidCase(database);

    const result = await database.runInTransaction(
      requestTrace(),
      async (transaction) => {
        await database.insertCaseVersion(
          transaction,
          caseVersion({
            case_version_id: NEXT_VERSION_ID,
            version_number: 2,
            parent_version_id: VERSION_ID,
            status: "S10" as CapaCaseStatus,
          }),
        );

        return database.advanceCurrentVersion(
          transaction,
          advanceInput(),
        );
      },
    );

    expect(result).toMatchObject({
      status: "updated",
      capa_case: {
        current_version_id: NEXT_VERSION_ID,
        status: "S10",
        record_version: 2,
        updated_at:
          "2026-08-12T01:30:00.000Z",
      },
    });
  });

  it("returns each controlled concurrency conflict", async () => {
    const database = createDatabase();

    await seedValidCase(database);

    const missingCase =
      await database.runInTransaction(
        requestTrace(),
        async (transaction) =>
          database.advanceCurrentVersion(
            transaction,
            advanceInput({
              capa_case_id: OTHER_CASE_ID,
            }),
          ),
      );

    expect(missingCase).toEqual({
      status: "conflict",
      reason_code:
        "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
    });

    const staleRecord =
      await database.runInTransaction(
        requestTrace(),
        async (transaction) =>
          database.advanceCurrentVersion(
            transaction,
            advanceInput({
              expected_record_version: 99,
            }),
          ),
      );

    expect(staleRecord).toEqual({
      status: "conflict",
      reason_code: "RECORD_VERSION_CONFLICT",
    });

    const staleCurrentVersion =
      await database.runInTransaction(
        requestTrace(),
        async (transaction) =>
          database.advanceCurrentVersion(
            transaction,
            advanceInput({
              expected_current_version_id:
                NEXT_VERSION_ID,
            }),
          ),
      );

    expect(staleCurrentVersion).toEqual({
      status: "conflict",
      reason_code: "CURRENT_VERSION_CONFLICT",
    });

    const missingNextVersion =
      await database.runInTransaction(
        requestTrace(),
        async (transaction) =>
          database.advanceCurrentVersion(
            transaction,
            advanceInput(),
          ),
      );

    expect(missingNextVersion).toEqual({
      status: "conflict",
      reason_code:
        "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
    });
  });
});

describe("InMemoryCapaDatabase audit events", () => {
  it("supports append, exact retry and conflicting reuse", async () => {
    const database = createDatabase();
    const event = auditEvent();

    const results = await database.runInTransaction(
      requestTrace(),
      async (transaction) => {
        const appended = await database.appendEvent(
          transaction,
          event,
        );

        const retry = await database.appendEvent(
          transaction,
          event,
        );

        const conflict = await database.appendEvent(
          transaction,
          auditEvent({
            action: controlled(
              "DIFFERENT_ACTION",
            ),
          }),
        );

        return {
          appended,
          retry,
          conflict,
        };
      },
    );

    expect(results.appended.status).toBe(
      "appended",
    );

    expect(results.retry.status).toBe(
      "already_recorded",
    );

    expect(results.conflict).toEqual({
      status: "conflict",
      event_id: EVENT_ID,
      reason_code:
        "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
    });

    expect(
      await database.findEventById(
        ORGANIZATION_ID,
        EVENT_ID,
      ),
    ).toEqual(event);
  });

  it("sorts and paginates matching events", async () => {
    const database = createDatabase();

    const firstId =
      "00000000-0000-4000-8000-000000000001" as AuditEventId;

    const secondId =
      "00000000-0000-4000-8000-000000000002" as AuditEventId;

    const thirdId =
      "00000000-0000-4000-8000-000000000003" as AuditEventId;

    const otherOrganizationEventId =
      "00000000-0000-4000-8000-000000000004" as AuditEventId;

    await database.runInTransaction(
      requestTrace(),
      async (transaction) => {
        /*
         * Insert secondId before firstId with the same timestamp to prove
         * that equal timestamps are deterministically ordered by event ID.
         */
        await database.appendEvent(
          transaction,
          auditEvent({
            event_id: secondId,
            occurred_at: iso(
              "2026-08-12T01:00:00.000Z",
            ),
          }),
        );

        await database.appendEvent(
          transaction,
          auditEvent({
            event_id: firstId,
            occurred_at: iso(
              "2026-08-12T01:00:00.000Z",
            ),
          }),
        );

        /*
         * This later matching event exercises normal timestamp ordering.
         */
        await database.appendEvent(
          transaction,
          auditEvent({
            event_id: thirdId,
            occurred_at: iso(
              "2026-08-12T02:00:00.000Z",
            ),
          }),
        );

        /*
         * This event must remain outside the requested tenant boundary.
         */
        await database.appendEvent(
          transaction,
          auditEvent({
            event_id: otherOrganizationEventId,
            organization_id:
              OTHER_ORGANIZATION_ID,
          }),
        );
      },
    );

    const firstPage =
      await database.listEventsForAggregate({
        organization_id: ORGANIZATION_ID,
        aggregate_type:
          controlled("CAPA_CASE"),
        aggregate_id: CASE_ID,
        limit: 1,
      });

    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.events[0].event_id).toBe(
      firstId,
    );
    expect(firstPage.next_cursor).toBe("1");

    const secondPage =
      await database.listEventsForAggregate({
        organization_id: ORGANIZATION_ID,
        aggregate_type:
          controlled("CAPA_CASE"),
        aggregate_id: CASE_ID,
        limit: 1,
        cursor:
          firstPage.next_cursor as AuditCursor,
      });

    expect(secondPage.events).toHaveLength(1);
    expect(secondPage.events[0].event_id).toBe(
      secondId,
    );
    expect(secondPage.next_cursor).toBe("2");

    const thirdPage =
      await database.listEventsForAggregate({
        organization_id: ORGANIZATION_ID,
        aggregate_type:
          controlled("CAPA_CASE"),
        aggregate_id: CASE_ID,
        limit: 1,
        cursor:
          secondPage.next_cursor as AuditCursor,
      });

    expect(thirdPage.events).toHaveLength(1);
    expect(thirdPage.events[0].event_id).toBe(
      thirdId,
    );
    expect(thirdPage.next_cursor).toBeUndefined();
  });

  it("rejects invalid limits and cursors", async () => {
    const database = createDatabase();

    for (const limit of [0, 101, 1.5]) {
      await expect(
        database.listEventsForAggregate({
          organization_id: ORGANIZATION_ID,
          aggregate_type:
            controlled("CAPA_CASE"),
          aggregate_id: CASE_ID,
          limit,
        }),
      ).rejects.toBeInstanceOf(
        InMemoryAuditQueryError,
      );
    }

    for (const cursor of ["-1", "1.5", "invalid"]) {
      await expect(
        database.listEventsForAggregate({
          organization_id: ORGANIZATION_ID,
          aggregate_type:
            controlled("CAPA_CASE"),
          aggregate_id: CASE_ID,
          limit: 10,
          cursor: cursor as AuditCursor,
        }),
      ).rejects.toBeInstanceOf(
        InMemoryAuditQueryError,
      );
    }
  });
});

describe("InMemoryCapaDatabase integrity validation", () => {
  it("rejects a case with an invalid current version", async () => {
    const database = createDatabase();

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertCase(
            transaction,
            capaCase(),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryIntegrityError,
    );
  });

  it("rejects a section referencing a missing case", async () => {
    const database = createDatabase();

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertSectionVersion(
            transaction,
            sectionVersion(),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryIntegrityError,
    );
  });

  it("rejects a case version referencing a missing case", async () => {
    const database = createDatabase();

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertCaseVersion(
            transaction,
            caseVersion({
              section_version_ids: [],
            }),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryIntegrityError,
    );
  });

  it("rejects a case version referencing a missing section", async () => {
    const database = createDatabase();

    await expect(
      database.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await database.insertCase(
            transaction,
            capaCase(),
          );

          await database.insertCaseVersion(
            transaction,
            caseVersion({
              section_version_ids: [
                OTHER_SECTION_ID,
              ],
            }),
          );
        },
      ),
    ).rejects.toBeInstanceOf(
      InMemoryIntegrityError,
    );
  });
});