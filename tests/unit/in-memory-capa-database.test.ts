import { describe, expect, it, vi } from "vitest";

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
  CapaCaseListCursor,
} from "../../lib/database/repositories/capa-repository";

import {
  InMemoryAuditQueryError,
  InMemoryCapaCaseListQueryError,
  InMemoryCapaCaseNumberExhaustedError,
  InMemoryCapaDatabase,
  InMemoryCapaDatabaseConfigurationError,
  InMemoryCapaInvestigationActiveAdvisoryPersistenceError,
  InMemoryDuplicateRecordError,
  InMemoryIntegrityError,
  InMemoryTransactionConflictError,
  InMemoryTransactionNotActiveError,
} from "../../lib/database/in-memory/in-memory-capa-database";
import { CapaDevelopmentStateSnapshotError } from "../../lib/database/development/capa-development-state-snapshot";
import { createCapaRootCauseReviewAdvisoryGenerationTrace } from "../../lib/capa/ai/capa-ai-generation-trace";
import { CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA, CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE } from "../../lib/capa/ai/capa-root-cause-review-advisory-model-generator";

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

function s50AdvisoryInput(overrides: Record<string, unknown> = {}): any {
  const modelSafeContext = { trust: "model_safe_context", workflow_state: "S50", current_version_number: 4, comparison_version_number: null, current_section_versions: { investigation_ledger: "L1", root_cause_package: "R1", investigation_plan: null }, comparison_section_versions: null, references: [] };
  const generationTrace = createCapaRootCauseReviewAdvisoryGenerationTrace({
    rendered_prompt: "controlled S50 prompt",
    model_profile_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version,
    output_schema_name: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
    output_schema: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
    maximum_output_characters: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters,
    package: {
      scope: { organization_id: ORGANIZATION_ID, capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4, workflow_state: "S50" },
      agent: { agent_id: "AG-REVIEW", agent_version: "ag-review-1.0.0" },
      trace: { run_id: "60000000-0000-4000-8000-000000000001" as any, prompt_package_id: "70000000-0000-4000-8000-000000000001" as any, request_id: requestTrace().request_id, correlation_id: requestTrace().correlation_id, assembled_at: "2026-08-12T01:00:00.000Z" as any },
      context_provenance: { model_safe_context: modelSafeContext },
      governance: { advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, human_acceptance_required: true },
    },
  });
  return {
    context: { trust: "authoritative_server_context", organization_id: ORGANIZATION_ID, capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4, workflow_state: "S50" },
    response: { run_id: generationTrace.package.trace.run_id, output_id: "80000000-0000-4000-8000-000000000001" as any, output_schema_version: "capa_review_packet_draft-1.0.0", status: "completed_draft", proposal: { neutral_review_summary: "No additional review summary was supplied.", version_changes: [], blockers_warnings: [], evidence_map: [] }, uncertainty_and_limitations: [], citations: [], warnings: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, review_disposition: null, workflow_transition: null, human_acceptance_required: true },
    generation_trace: generationTrace,
    reference_manifest: [],
    request_id: requestTrace().request_id,
    correlation_id: requestTrace().correlation_id,
    ...overrides,
  };
}

describe("InMemoryCapaDatabase transactions", () => {
  it("round-trips empty and valid state snapshots defensively", async () => {
    const empty = createDatabase();
    const emptyHydrated = new InMemoryCapaDatabase({
      generate_transaction_id: () => "hydrated-empty" as TransactionId,
      now: () => NOW,
      initial_snapshot: empty.exportSnapshot(),
    });
    expect(emptyHydrated.exportSnapshot()).toEqual(empty.exportSnapshot());

    const seeded = createDatabase();
    await seedValidCase(seeded);
    const snapshot = seeded.exportSnapshot();
    const mutated = snapshot as unknown as { cases: [string, { case_number: string }][] };
    mutated.cases[0]![1].case_number = "MUTATED";
    expect((await seeded.findCaseById(ORGANIZATION_ID, CASE_ID))?.case_number).toBe("CAPA-000001");
    const hydrated = new InMemoryCapaDatabase({
      generate_transaction_id: () => "hydrated-valid" as TransactionId,
      now: () => NOW,
      initial_snapshot: seeded.exportSnapshot(),
    });
    expect(await hydrated.findCaseById(ORGANIZATION_ID, CASE_ID)).toEqual(await seeded.findCaseById(ORGANIZATION_ID, CASE_ID));
  });

  it("runs before_commit once on the candidate before publishing it", async () => {
    let database!: InMemoryCapaDatabase;
    const beforeCommit = vi.fn(async (snapshot) => {
      expect(snapshot.revision).toBe(1);
      expect(database.exportSnapshot().revision).toBe(0);
    });
    database = new InMemoryCapaDatabase({
      generate_transaction_id: () => "hook-1" as TransactionId,
      now: () => NOW,
      before_commit: beforeCommit,
    });
    await database.runInTransaction(requestTrace(), async () => "committed");
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    expect(database.exportSnapshot().revision).toBe(1);
  });

  it("rejects a failed before_commit without publishing candidate state", async () => {
    const database = new InMemoryCapaDatabase({
      generate_transaction_id: () => "hook-failure" as TransactionId,
      now: () => NOW,
      before_commit: async () => { throw new Error("disk unavailable"); },
    });
    await expect(database.runInTransaction(requestTrace(), async () => "not committed")).rejects.toThrow("disk unavailable");
    expect(database.exportSnapshot().revision).toBe(0);
  });

  it("does not invoke before_commit when transaction work fails", async () => {
    const beforeCommit = vi.fn(async () => undefined);
    const database = new InMemoryCapaDatabase({
      generate_transaction_id: () => "work-failure" as TransactionId,
      now: () => NOW,
      before_commit: beforeCommit,
    });
    await expect(database.runInTransaction(requestTrace(), async () => { throw new Error("work failed"); })).rejects.toThrow("work failed");
    expect(beforeCommit).not.toHaveBeenCalled();
    expect(database.exportSnapshot().revision).toBe(0);
  });

  it("rejects malformed, unsupported, and referentially corrupt snapshots", () => {
    const snapshot = createDatabase().exportSnapshot();
    expect(() => new InMemoryCapaDatabase({ generate_transaction_id: () => "bad-1" as TransactionId, now: () => NOW,
      initial_snapshot: { ...snapshot, revision: -1 } as never })).toThrow(CapaDevelopmentStateSnapshotError);
    expect(() => new InMemoryCapaDatabase({ generate_transaction_id: () => "bad-2" as TransactionId, now: () => NOW,
      initial_snapshot: { ...snapshot, schema_version: "unsupported" } as never })).toThrow(CapaDevelopmentStateSnapshotError);
    expect(() => new InMemoryCapaDatabase({ generate_transaction_id: () => "bad-3" as TransactionId, now: () => NOW,
      initial_snapshot: { ...snapshot, cases: [["broken", {}]] } as never })).toThrow(CapaDevelopmentStateSnapshotError);
  });

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

describe("InMemoryCapaDatabase case listing", () => {
  const OLDEST_CASE_ID =
    "10000000-0000-4000-8000-000000000001" as CapaCaseId;

  const TIED_LOWER_CASE_ID =
    "20000000-0000-4000-8000-000000000002" as CapaCaseId;

  const TIED_HIGHER_CASE_ID =
    "30000000-0000-4000-8000-000000000003" as CapaCaseId;

  const OTHER_TENANT_CASE_ID =
    "90000000-0000-4000-8000-000000000009" as CapaCaseId;

  interface ListFixture {
    readonly organization_id:
      OrganizationId;
    readonly capa_case_id:
      CapaCaseId;
    readonly case_version_id:
      CapaCaseVersionId;
    readonly section_version_id:
      CapaSectionVersionId;
    readonly case_number: string;
    readonly created_at:
      IsoDateTime;
  }

  const LIST_FIXTURES:
    readonly ListFixture[] = [
      {
        organization_id:
          ORGANIZATION_ID,
        capa_case_id:
          OLDEST_CASE_ID,
        case_version_id:
          "41000000-0000-4000-8000-000000000001" as CapaCaseVersionId,
        section_version_id:
          "51000000-0000-4000-8000-000000000001" as CapaSectionVersionId,
        case_number: "CAPA-000001",
        created_at: iso(
          "2026-08-12T00:30:00.000Z",
        ),
      },
      {
        organization_id:
          ORGANIZATION_ID,
        capa_case_id:
          TIED_LOWER_CASE_ID,
        case_version_id:
          "42000000-0000-4000-8000-000000000002" as CapaCaseVersionId,
        section_version_id:
          "52000000-0000-4000-8000-000000000002" as CapaSectionVersionId,
        case_number: "CAPA-000002",
        created_at: iso(
          "2026-08-12T00:45:00.000Z",
        ),
      },
      {
        organization_id:
          ORGANIZATION_ID,
        capa_case_id:
          TIED_HIGHER_CASE_ID,
        case_version_id:
          "43000000-0000-4000-8000-000000000003" as CapaCaseVersionId,
        section_version_id:
          "53000000-0000-4000-8000-000000000003" as CapaSectionVersionId,
        case_number: "CAPA-000003",
        created_at: iso(
          "2026-08-12T00:45:00.000Z",
        ),
      },
      {
        organization_id:
          OTHER_ORGANIZATION_ID,
        capa_case_id:
          OTHER_TENANT_CASE_ID,
        case_version_id:
          "49000000-0000-4000-8000-000000000009" as CapaCaseVersionId,
        section_version_id:
          "59000000-0000-4000-8000-000000000009" as CapaSectionVersionId,
        case_number: "CAPA-000001",
        created_at: iso(
          "2026-08-12T01:00:00.000Z",
        ),
      },
    ];

  async function seedListFixtures(
    database: InMemoryCapaDatabase,
  ): Promise<void> {
    await database.runInTransaction(
      requestTrace(),
      async (transaction) => {
        for (const fixture of
          LIST_FIXTURES) {
          await database.insertCase(
            transaction,
            capaCase({
              organization_id:
                fixture.organization_id,
              capa_case_id:
                fixture.capa_case_id,
              case_number:
                fixture.case_number,
              current_version_id:
                fixture.case_version_id,
              effective_at:
                fixture.created_at,
              created_at:
                fixture.created_at,
              updated_at:
                fixture.created_at,
            }),
          );

          await database.insertSectionVersion(
            transaction,
            sectionVersion({
              organization_id:
                fixture.organization_id,
              capa_case_id:
                fixture.capa_case_id,
              section_version_id:
                fixture.section_version_id,
              effective_at:
                fixture.created_at,
              created_at:
                fixture.created_at,
            }),
          );

          await database.insertCaseVersion(
            transaction,
            caseVersion({
              organization_id:
                fixture.organization_id,
              capa_case_id:
                fixture.capa_case_id,
              case_version_id:
                fixture.case_version_id,
              section_version_ids: [
                fixture.section_version_id,
              ],
              effective_at:
                fixture.created_at,
              created_at:
                fixture.created_at,
            }),
          );
        }
      },
    );
  }

  it("isolates organization-scoped case lists", async () => {
    const database = createDatabase();
    await seedListFixtures(database);

    const primaryPage =
      await database.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 10,
      });

    expect(
      primaryPage.cases.map(
        (item) =>
          item.organization_id,
      ),
    ).toEqual([
      ORGANIZATION_ID,
      ORGANIZATION_ID,
      ORGANIZATION_ID,
    ]);

    const otherPage =
      await database.listCases({
        organization_id:
          OTHER_ORGANIZATION_ID,
        limit: 10,
      });

    expect(
      otherPage.cases.map(
        (item) =>
          item.capa_case_id,
      ),
    ).toEqual([
      OTHER_TENANT_CASE_ID,
    ]);
  });

  it("orders newest cases first with a descending identity tie-breaker", async () => {
    const database = createDatabase();
    await seedListFixtures(database);

    const page =
      await database.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 10,
      });

    expect(
      page.cases.map(
        (item) =>
          item.capa_case_id,
      ),
    ).toEqual([
      TIED_HIGHER_CASE_ID,
      TIED_LOWER_CASE_ID,
      OLDEST_CASE_ID,
    ]);

    expect(page.next_cursor)
      .toBeUndefined();
  });

  it("paginates without gaps or duplicate cases", async () => {
    const database = createDatabase();
    await seedListFixtures(database);

    const firstPage =
      await database.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 2,
      });

    expect(
      firstPage.cases.map(
        (item) =>
          item.capa_case_id,
      ),
    ).toEqual([
      TIED_HIGHER_CASE_ID,
      TIED_LOWER_CASE_ID,
    ]);

    expect(firstPage.next_cursor)
      .toEqual({
        created_at: iso(
          "2026-08-12T00:45:00.000Z",
        ),
        capa_case_id:
          TIED_LOWER_CASE_ID,
      });

    const secondPage =
      await database.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 2,
        cursor:
          firstPage.next_cursor!,
      });

    expect(
      secondPage.cases.map(
        (item) =>
          item.capa_case_id,
      ),
    ).toEqual([
      OLDEST_CASE_ID,
    ]);

    expect(secondPage.next_cursor)
      .toBeUndefined();
  });

  it("returns defensive case copies", async () => {
    const database = createDatabase();
    await seedListFixtures(database);

    const firstPage =
      await database.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 1,
      });

    const returnedCase =
      firstPage.cases[0] as {
        case_number: string;
      };

    returnedCase.case_number =
      "CAPA-FORGED";

    const secondPage =
      await database.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 1,
      });

    expect(
      secondPage.cases[0]
        ?.case_number,
    ).toBe("CAPA-000003");
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    1.5,
    101,
  ])(
    "rejects invalid case-list limit %s",
    async (limit) => {
      const database = createDatabase();

      await expect(
        database.listCases({
          organization_id:
            ORGANIZATION_ID,
          limit,
        }),
      ).rejects.toBeInstanceOf(
        InMemoryCapaCaseListQueryError,
      );
    },
  );

  it.each([
    {
      created_at: "not-a-date",
      capa_case_id:
        TIED_LOWER_CASE_ID,
    },
    {
      created_at:
        "2026-08-12T00:45:00Z",
      capa_case_id:
        TIED_LOWER_CASE_ID,
    },
    {
      created_at:
        "2026-08-12T00:45:00.000Z",
      capa_case_id:
        "not-a-uuid",
    },
  ])(
    "rejects invalid case-list cursor %#",
    async (cursor) => {
      const database = createDatabase();

      await expect(
        database.listCases({
          organization_id:
            ORGANIZATION_ID,
          limit: 10,
          cursor:
            cursor as CapaCaseListCursor,
        }),
      ).rejects.toBeInstanceOf(
        InMemoryCapaCaseListQueryError,
      );
    },
  );

  it("provides a stable named case-list query error", () => {
    const error =
      new InMemoryCapaCaseListQueryError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(
      "InMemoryCapaCaseListQueryError",
    );
    expect(error.message).toBe(
      "The in-memory CAPA case-list query parameters are invalid.",
    );
  });
});

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

  it("fails closed for malformed S50 advisory persistence input", async () => {
    const database = createDatabase();
    await expect(database.runInTransaction(requestTrace(), async (transaction) => {
      await database.save(transaction, {
        context: {
          trust: "authoritative_server_context",
          organization_id: ORGANIZATION_ID,
          capa_case_id: CASE_ID,
          case_version_id: VERSION_ID,
          record_version: 1,
          workflow_state: "S50",
        },
        response: {
          output_schema_version: "capa_review_packet_draft-1.0.0",
          status: "completed_draft",
          advisory_only: true,
          workflow_mutated: false,
          controlled_record_mutated: true,
          review_disposition: null,
          workflow_transition: null,
          human_acceptance_required: true,
        },
        generation_trace: {},
        reference_manifest: [],
        request_id: requestTrace().request_id,
        correlation_id: requestTrace().correlation_id,
      } as any);
    })).rejects.toBeInstanceOf(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
  });

  it("persists and reads one governed S50 output, trace, and exact manifest", async () => {
    const database = createDatabase();
    await database.runInTransaction(requestTrace(), async (transaction) => {
      await database.insertCase(transaction, capaCase({ status: "S50" as CapaCaseStatus, record_version: 4 }));
      await database.insertSectionVersion(transaction, sectionVersion());
      await database.insertCaseVersion(transaction, caseVersion({ status: "S50" as CapaCaseStatus, version_number: 4 }));
      await expect(database.save(transaction, s50AdvisoryInput())).resolves.toBe("saved");
    });
    const result = await database.findById(ORGANIZATION_ID, "80000000-0000-4000-8000-000000000001");
    expect(result).toMatchObject({ response: { output_schema_version: "capa_review_packet_draft-1.0.0" }, generation_trace: { package: { agent: { agent_id: "AG-REVIEW" } } }, reference_manifest: { document: { entries: [] } } });
  });

  it.each([
    ["current version", { capaCase: capaCase({ status: "S50" as CapaCaseStatus, current_version_id: NEXT_VERSION_ID, record_version: 4 }), caseVersion: caseVersion({ case_version_id: NEXT_VERSION_ID, status: "S50" as CapaCaseStatus, version_number: 4 }) }],
    ["record version", { capaCase: capaCase({ status: "S50" as CapaCaseStatus, record_version: 5 }), caseVersion: caseVersion({ status: "S50" as CapaCaseStatus, version_number: 5 }) }],
    ["workflow", { capaCase: capaCase({ status: "S40" as CapaCaseStatus }), caseVersion: caseVersion({ status: "S40" as CapaCaseStatus }) }],
  ])("returns case_changed for stale S50 %s", async (_name, values) => {
    const database = createDatabase();
    await database.runInTransaction(requestTrace(), async (transaction) => {
      await database.insertCase(transaction, values.capaCase);
      await database.insertSectionVersion(transaction, sectionVersion());
      await database.insertCaseVersion(transaction, values.caseVersion);
    });
    await expect(database.runInTransaction(requestTrace(), (transaction) => database.save(transaction, s50AdvisoryInput()))).resolves.toBe("case_changed");
  });

  it("rejects request/correlation mismatch, invalid governance, invalid trace, and partial or duplicate manifests", async () => {
    const database = createDatabase();
    await database.runInTransaction(requestTrace(), async (transaction) => {
      await database.insertCase(transaction, capaCase({ status: "S50" as CapaCaseStatus, record_version: 4 }));
      await database.insertSectionVersion(transaction, sectionVersion());
      await database.insertCaseVersion(transaction, caseVersion({ status: "S50" as CapaCaseStatus, version_number: 4 }));
    });
    await expect(database.runInTransaction({ ...requestTrace(), request_id: "90000000-0000-4000-8000-000000000001" as RequestId }, (transaction) => database.save(transaction, s50AdvisoryInput()))).rejects.toBeInstanceOf(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
    await expect(database.runInTransaction({ ...requestTrace(), correlation_id: "90000000-0000-4000-8000-000000000001" as CorrelationId }, (transaction) => database.save(transaction, s50AdvisoryInput()))).rejects.toBeInstanceOf(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
    for (const invalid of [
      s50AdvisoryInput({ response: { ...s50AdvisoryInput().response, controlled_record_mutated: true } }),
      s50AdvisoryInput({ generation_trace: { ...s50AdvisoryInput().generation_trace, package: { ...s50AdvisoryInput().generation_trace.package, trace: { ...s50AdvisoryInput().generation_trace.package.trace, run_id: "90000000-0000-4000-8000-000000000001" } } } }),
      s50AdvisoryInput({ reference_manifest: [{ reference_key: "R1", trust: "authoritative_server_context", source_kind: "causal_hypothesis", version_scope: "current", source_id: "H1" }] }),
    ]) {
      await expect(database.runInTransaction(requestTrace(), (transaction) => database.save(transaction, invalid))).rejects.toBeInstanceOf(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
    }
  });

  it("enforces nonempty exact mappings and controlled source kinds and scopes", async () => {
    const database = createDatabase();
    await database.runInTransaction(requestTrace(), async (transaction) => {
      await database.insertCase(transaction, capaCase({ status: "S50" as CapaCaseStatus, record_version: 4 }));
      await database.insertSectionVersion(transaction, sectionVersion());
      await database.insertCaseVersion(transaction, caseVersion({ status: "S50" as CapaCaseStatus, version_number: 4 }));
    });
    const safeReference = { reference_key: "R1", trust: "authoritative_server_context", source_kind: "causal_hypothesis", version_scope: "current" };
    const valid = s50AdvisoryInput({ generation_trace: (() => { const base = s50AdvisoryInput().generation_trace; return { ...base, package: { ...base.package, context_provenance: { model_safe_context: { ...base.package.context_provenance.model_safe_context, references: [safeReference] } } } }; })(), reference_manifest: [{ ...safeReference, source_id: "H1" }] });
    await expect(database.runInTransaction(requestTrace(), (transaction) => database.save(transaction, valid))).resolves.toBe("saved");
    const invalidMappings = [
      { reference_manifest: [{ ...safeReference, source_id: "H1" }, { ...safeReference, source_id: "H2" }] },
      { reference_manifest: [] },
      { reference_manifest: [{ ...safeReference, source_id: "H1" }, { ...safeReference, reference_key: "R2", source_id: "H2" }] },
      { reference_manifest: [{ ...safeReference, source_id: "H1" }], safe: { source_kind: "unsupported" } },
      { reference_manifest: [{ ...safeReference, source_id: "H1" }], safe: { version_scope: "unsupported" } },
      { reference_manifest: [{ ...safeReference, source_id: "H1" }], safe: { source_id: "SERVER-ID" } },
    ];
    for (const invalid of invalidMappings) {
      const base = s50AdvisoryInput();
      const alteredSafe = { ...safeReference, ...(invalid.safe ?? {}) };
      const alteredTrace = { ...base.generation_trace, package: { ...base.generation_trace.package, context_provenance: { model_safe_context: { ...base.generation_trace.package.context_provenance.model_safe_context, references: [alteredSafe] } } } };
      await expect(database.runInTransaction(requestTrace(), (transaction) => database.save(transaction, { ...base, generation_trace: alteredTrace, reference_manifest: invalid.reference_manifest }))).rejects.toBeInstanceOf(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
    }
    const duplicateSafe = s50AdvisoryInput();
    duplicateSafe.generation_trace = { ...duplicateSafe.generation_trace, package: { ...duplicateSafe.generation_trace.package, context_provenance: { model_safe_context: { ...duplicateSafe.generation_trace.package.context_provenance.model_safe_context, references: [safeReference, safeReference] } } } };
    duplicateSafe.reference_manifest = [{ ...safeReference, source_id: "H1" }, { ...safeReference, source_id: "H2" }];
    await expect(database.runInTransaction(requestTrace(), (transaction) => database.save(transaction, duplicateSafe))).rejects.toBeInstanceOf(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
  });

  it("does not commit a valid advisory when the surrounding transaction fails", async () => {
    const database = createDatabase();
    await expect(database.runInTransaction(requestTrace(), async (transaction) => {
      await database.insertCase(transaction, capaCase({ status: "S50" as CapaCaseStatus, record_version: 4 }));
      await database.insertSectionVersion(transaction, sectionVersion());
      await database.insertCaseVersion(transaction, caseVersion({ status: "S50" as CapaCaseStatus, version_number: 4 }));
      await database.save(transaction, s50AdvisoryInput());
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    await expect(database.findById(ORGANIZATION_ID, "80000000-0000-4000-8000-000000000001")).resolves.toBeNull();
  });
});
