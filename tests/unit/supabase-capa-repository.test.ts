import { describe, expect, it, vi } from "vitest";

import type postgres from "postgres";

import type {
  ActorReference,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RequestTrace,
  UserId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaCaseListCursor,
} from "../../lib/database/repositories/capa-repository";

import type {
  TransactionContext,
} from "../../lib/database/transactions";

import {
  SupabaseCapaCaseListQueryError,
  SupabaseCapaRepository,
} from "../../lib/database/supabase/supabase-capa-repository";

import {
  SupabaseTransactionContextError,
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as OrganizationId;

const CASE_ID =
  "10000000-0000-4000-8000-000000000002" as CapaCaseId;

const CASE_VERSION_ID =
  "10000000-0000-4000-8000-000000000003" as CapaCaseVersionId;

const NEXT_CASE_VERSION_ID =
  "10000000-0000-4000-8000-000000000004" as CapaCaseVersionId;

const SECTION_VERSION_ID =
  "10000000-0000-4000-8000-000000000005" as CapaSectionVersionId;

const SECOND_SECTION_VERSION_ID =
  "10000000-0000-4000-8000-000000000006" as CapaSectionVersionId;

const USER_ID =
  "10000000-0000-4000-8000-000000000007" as UserId;

const NOW =
  "2026-08-12T16:00:00.000Z" as IsoDateTime;

const LATER =
  "2026-08-12T16:01:00.000Z" as IsoDateTime;

const ACTOR: ActorReference = {
  actor_type: "human",
  actor_id: USER_ID,
};

const VERSIONED_ACTOR: ActorReference = {
  actor_type: "service",
  actor_id: "capa-service",
  actor_version: "service-1.0.0",
};

function requestTrace(): RequestTrace {
  return {
    request_id:
      "10000000-0000-4000-8000-000000000008",
    correlation_id:
      "10000000-0000-4000-8000-000000000009",
  } as RequestTrace;
}

function caseRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    organization_id: ORGANIZATION_ID,
    capa_case_id: CASE_ID,
    case_number: "CAPA-2026-0001",
    current_version_id: CASE_VERSION_ID,
    status: "S00",
    owner_user_id: USER_ID,
    confidentiality: "CUSTOMER_CONFIDENTIAL",
    record_version: "1",
    effective_at: new Date(NOW),
    superseded_at: null,
    cancelled_at: null,
    closed_at: null,
    created_at: new Date(NOW),
    created_by_actor_type: "human",
    created_by_actor_id: USER_ID,
    created_by_actor_version: null,
    updated_at: new Date(NOW),
    updated_by_actor_type: "human",
    updated_by_actor_id: USER_ID,
    updated_by_actor_version: null,
    ...overrides,
  };
}

function caseVersionRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    organization_id: ORGANIZATION_ID,
    case_version_id: CASE_VERSION_ID,
    capa_case_id: CASE_ID,
    version_number: "1",
    parent_version_id: null,
    change_reason: "Initial version",
    status: "S00",
    effective_at: NOW,
    superseded_at: null,
    created_at: NOW,
    created_by_actor_type: "human",
    created_by_actor_id: USER_ID,
    created_by_actor_version: null,
    ...overrides,
  };
}

function sectionVersionRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    organization_id: ORGANIZATION_ID,
    section_version_id: SECTION_VERSION_ID,
    capa_case_id: CASE_ID,
    section_type: "CAPA.INTAKE",
    version_number: 1,
    parent_version_id: null,
    schema_version: "intake-1.0.0",
    content: {
      initiating_event: "Controlled test event",
    },
    change_reason: "Initial intake",
    effective_at: NOW,
    superseded_at: null,
    created_at: NOW,
    created_by_actor_type: "human",
    created_by_actor_id: USER_ID,
    created_by_actor_version: null,
    ...overrides,
  };
}

function capaCase(
  overrides: Partial<CapaCase> = {},
): CapaCase {
  return {
    organization_id: ORGANIZATION_ID,
    capa_case_id: CASE_ID,
    case_number: "CAPA-2026-0001",
    current_version_id: CASE_VERSION_ID,
    status: "S00",
    owner_user_id: USER_ID,
    confidentiality:
      "CUSTOMER_CONFIDENTIAL" as ControlledCode,
    record_version: 1,
    effective_at: NOW,
    created_at: NOW,
    created_by: ACTOR,
    updated_at: NOW,
    updated_by: ACTOR,
    ...overrides,
  };
}

function sectionVersion(
  overrides: Partial<CapaSectionVersion> = {},
): CapaSectionVersion {
  return {
    organization_id: ORGANIZATION_ID,
    section_version_id: SECTION_VERSION_ID,
    capa_case_id: CASE_ID,
    section_type: "CAPA.INTAKE" as ControlledCode,
    version_number: 1,
    schema_version: "intake-1.0.0",
    content: {
      initiating_event: "Controlled test event",
    },
    change_reason: "Initial intake",
    effective_at: NOW,
    created_at: NOW,
    created_by: ACTOR,
    ...overrides,
  };
}

function caseVersion(
  overrides: Partial<CapaCaseVersion> = {},
): CapaCaseVersion {
  return {
    organization_id: ORGANIZATION_ID,
    case_version_id: CASE_VERSION_ID,
    capa_case_id: CASE_ID,
    version_number: 1,
    change_reason: "Initial version",
    status: "S00",
    section_version_ids: [SECTION_VERSION_ID],
    effective_at: NOW,
    created_at: NOW,
    created_by: ACTOR,
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

    return tagged;
  }

  const transactionTagged = createTaggedSql();
  const outerTagged = createTaggedSql();

  const json = vi.fn((value: unknown) => value);

  Object.assign(transactionTagged, {
    json,
  });

  Object.assign(outerTagged, {
    json,
    begin: vi.fn(
      async (
        _options: string,
        work: (
          sql: postgres.TransactionSql,
        ) => Promise<unknown>,
      ) =>
        work(
          transactionTagged as unknown as postgres.TransactionSql,
        ),
    ),
  });

  return {
    sql: outerTagged as unknown as postgres.Sql,
    transaction_sql:
      transactionTagged as unknown as postgres.TransactionSql,
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

describe("SupabaseCapaRepository case listing", () => {
  const SECOND_CASE_ID =
    "20000000-0000-4000-8000-000000000002" as CapaCaseId;

  const THIRD_CASE_ID =
    "30000000-0000-4000-8000-000000000003" as CapaCaseId;

  const EARLIER =
    "2026-08-12T15:59:00.000Z" as IsoDateTime;

  it("returns an empty final organization-scoped page", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(
        harness.sql,
      );

    await expect(
      repository.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 25,
      }),
    ).resolves.toEqual({
      cases: [],
    });

    expect(harness.calls[0]?.values)
      .toEqual([
        ORGANIZATION_ID,
        26,
      ]);

    expect(harness.calls[0]?.query)
      .toContain(
        "where organization_id = ? order by created_at desc, capa_case_id desc limit ?",
      );
  });

  it("fetches limit plus one and returns a bounded next cursor", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      caseRow({
        capa_case_id:
          THIRD_CASE_ID,
        case_number:
          "CAPA-000003",
        created_at:
          new Date(LATER),
      }),
      caseRow({
        capa_case_id:
          SECOND_CASE_ID,
        case_number:
          "CAPA-000002",
        created_at:
          new Date(NOW),
      }),
      caseRow({
        case_number:
          "CAPA-000001",
        created_at:
          new Date(EARLIER),
      }),
    ]);

    const repository =
      new SupabaseCapaRepository(
        harness.sql,
      );

    const page =
      await repository.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 2,
      });

    expect(
      page.cases.map(
        (item) =>
          item.capa_case_id,
      ),
    ).toEqual([
      THIRD_CASE_ID,
      SECOND_CASE_ID,
    ]);

    expect(page.next_cursor)
      .toEqual({
        created_at: NOW,
        capa_case_id:
          SECOND_CASE_ID,
      });

    expect(harness.calls[0]?.values)
      .toEqual([
        ORGANIZATION_ID,
        3,
      ]);
  });

  it("continues with the complete keyset cursor and no final cursor", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      caseRow({
        case_number:
          "CAPA-000001",
        created_at:
          new Date(EARLIER),
      }),
    ]);

    const repository =
      new SupabaseCapaRepository(
        harness.sql,
      );

    const cursor = {
      created_at: NOW,
      capa_case_id:
        SECOND_CASE_ID,
    } as CapaCaseListCursor;

    const page =
      await repository.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 2,
        cursor,
      });

    expect(page.cases).toHaveLength(1);
    expect(page.next_cursor)
      .toBeUndefined();

    expect(harness.calls[0]?.values)
      .toEqual([
        ORGANIZATION_ID,
        NOW,
        NOW,
        SECOND_CASE_ID,
        3,
      ]);

    expect(harness.calls[0]?.query)
      .toContain(
        "created_at < ? or ( created_at = ? and capa_case_id < ? )",
      );
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    1.5,
    101,
  ])(
    "rejects invalid case-list limit %s before querying",
    async (limit) => {
      const harness = createSqlHarness();

      const repository =
        new SupabaseCapaRepository(
          harness.sql,
        );

      await expect(
        repository.listCases({
          organization_id:
            ORGANIZATION_ID,
          limit,
        }),
      ).rejects.toBeInstanceOf(
        SupabaseCapaCaseListQueryError,
      );

      expect(harness.calls).toEqual([]);
    },
  );

  it.each([
    {
      created_at: "not-a-date",
      capa_case_id:
        SECOND_CASE_ID,
    },
    {
      created_at:
        "2026-08-12T16:00:00Z",
      capa_case_id:
        SECOND_CASE_ID,
    },
    {
      created_at: NOW,
      capa_case_id:
        "not-a-uuid",
    },
  ])(
    "rejects invalid case-list cursor %# before querying",
    async (cursor) => {
      const harness = createSqlHarness();

      const repository =
        new SupabaseCapaRepository(
          harness.sql,
        );

      await expect(
        repository.listCases({
          organization_id:
            ORGANIZATION_ID,
          limit: 25,
          cursor:
            cursor as CapaCaseListCursor,
        }),
      ).rejects.toBeInstanceOf(
        SupabaseCapaCaseListQueryError,
      );

      expect(harness.calls).toEqual([]);
    },
  );

  it("provides a stable named case-list query error", () => {
    const error =
      new SupabaseCapaCaseListQueryError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(
      "SupabaseCapaCaseListQueryError",
    );
    expect(error.message).toBe(
      "The CAPA case-list query parameters are invalid.",
    );
  });

  it("rejects a malformed case returned in a list", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      caseRow({
        record_version:
          "not-a-version",
      }),
    ]);

    const repository =
      new SupabaseCapaRepository(
        harness.sql,
      );

    await expect(
      repository.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 1,
      }),
    ).rejects.toThrow(
      "Invalid CAPA record version returned by the CAPA database.",
    );
  });

  it("propagates a database list failure", async () => {
    const databaseError =
      new Error("database unavailable");

    const sql = vi.fn(
      async () => {
        throw databaseError;
      },
    ) as unknown as postgres.Sql;

    const repository =
      new SupabaseCapaRepository(sql);

    await expect(
      repository.listCases({
        organization_id:
          ORGANIZATION_ID,
        limit: 25,
      }),
    ).rejects.toBe(databaseError);
  });
});

describe("SupabaseCapaRepository reads", () => {
  it("returns null when a tenant-scoped case is absent", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      repository.findCaseById(
        ORGANIZATION_ID,
        CASE_ID,
      ),
    ).resolves.toBeNull();

    expect(harness.calls[0]?.values).toEqual([
      ORGANIZATION_ID,
      CASE_ID,
    ]);
  });

  it("maps a complete CAPA aggregate", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      caseRow({
        record_version: 2,
        effective_at: NOW,
        superseded_at: LATER,
        cancelled_at:
          "2026-08-12T16:02:00.000Z",
        closed_at: null,
        created_by_actor_type: "service",
        created_by_actor_id: "creator-service",
        created_by_actor_version: "1.0.0",
        updated_by_actor_type: "service",
        updated_by_actor_id: "updater-service",
        updated_by_actor_version: "2.0.0",
      }),
    ]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await repository.findCaseById(
      ORGANIZATION_ID,
      CASE_ID,
    );

    expect(result).toMatchObject({
      organization_id: ORGANIZATION_ID,
      capa_case_id: CASE_ID,
      record_version: 2,
      effective_at: NOW,
      superseded_at: LATER,
      cancelled_at:
        "2026-08-12T16:02:00.000Z",
      created_by: {
        actor_type: "service",
        actor_id: "creator-service",
        actor_version: "1.0.0",
      },
      updated_by: {
        actor_type: "service",
        actor_id: "updater-service",
        actor_version: "2.0.0",
      },
    });

    expect(result).not.toHaveProperty("closed_at");
  });

  it.each([
    0,
    -1,
    "not-a-number",
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "rejects invalid aggregate versions: %s",
    async (recordVersion) => {
      const harness = createSqlHarness();

      harness.enqueue([
        caseRow({
          record_version: recordVersion,
        }),
      ]);

      const repository =
        new SupabaseCapaRepository(harness.sql);

      await expect(
        repository.findCaseById(
          ORGANIZATION_ID,
          CASE_ID,
        ),
      ).rejects.toThrow(
        "Invalid CAPA record version returned by the CAPA database.",
      );
    },
  );

  it("returns null when a case version is absent", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      repository.findCaseVersionById(
        ORGANIZATION_ID,
        CASE_ID,
        CASE_VERSION_ID,
      ),
    ).resolves.toBeNull();

    expect(harness.calls).toHaveLength(1);
  });

  it("maps a case version with ordered section references", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [
        caseVersionRow({
          version_number: 2,
          parent_version_id:
            "10000000-0000-4000-8000-000000000010",
          superseded_at: LATER,
          created_by_actor_type: "service",
          created_by_actor_id: "capa-service",
          created_by_actor_version:
            "service-1.0.0",
        }),
      ],
      [
        {
          section_version_id:
            SECTION_VERSION_ID,
        },
        {
          section_version_id:
            SECOND_SECTION_VERSION_ID,
        },
      ],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result =
      await repository.findCaseVersionById(
        ORGANIZATION_ID,
        CASE_ID,
        CASE_VERSION_ID,
      );

    expect(result).toMatchObject({
      version_number: 2,
      section_version_ids: [
        SECTION_VERSION_ID,
        SECOND_SECTION_VERSION_ID,
      ],
      superseded_at: LATER,
      created_by: VERSIONED_ACTOR,
    });

    expect(result).toHaveProperty(
      "parent_version_id",
    );

    expect(harness.calls[1]?.query).toContain(
      "order by display_order asc",
    );
  });

  it("returns null when a section version is absent", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      repository.findSectionVersionById(
        ORGANIZATION_ID,
        CASE_ID,
        SECTION_VERSION_ID,
      ),
    ).resolves.toBeNull();
  });

  it("maps a complete section version", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      sectionVersionRow({
        version_number: "2",
        parent_version_id:
          SECOND_SECTION_VERSION_ID,
        superseded_at: LATER,
        created_by_actor_type: "service",
        created_by_actor_id: "capa-service",
        created_by_actor_version:
          "service-1.0.0",
      }),
    ]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result =
      await repository.findSectionVersionById(
        ORGANIZATION_ID,
        CASE_ID,
        SECTION_VERSION_ID,
      );

    expect(result).toMatchObject({
      version_number: 2,
      parent_version_id:
        SECOND_SECTION_VERSION_ID,
      superseded_at: LATER,
      content: {
        initiating_event:
          "Controlled test event",
      },
      created_by: VERSIONED_ACTOR,
    });
  });

  it.each([
    null,
    [],
    "invalid",
  ])(
    "rejects invalid section content: %s",
    async (content) => {
      const harness = createSqlHarness();

      harness.enqueue([
        sectionVersionRow({ content }),
      ]);

      const repository =
        new SupabaseCapaRepository(harness.sql);

      await expect(
        repository.findSectionVersionById(
          ORGANIZATION_ID,
          CASE_ID,
          SECTION_VERSION_ID,
        ),
      ).rejects.toThrow(
        "Invalid CAPA section content returned by the database.",
      );
    },
  );

  it("checks organization-local case-number existence", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [{ exists: true }],
      [{ exists: false }],
      [],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      repository.caseNumberExists(
        ORGANIZATION_ID,
        "CAPA-2026-0001",
      ),
    ).resolves.toBe(true);

    await expect(
      repository.caseNumberExists(
        ORGANIZATION_ID,
        "CAPA-2026-0002",
      ),
    ).resolves.toBe(false);

    await expect(
      repository.caseNumberExists(
        ORGANIZATION_ID,
        "CAPA-2026-0003",
      ),
    ).resolves.toBe(false);
  });
});

describe("SupabaseCapaRepository writes", () => {
  it("inserts the CAPA aggregate through the active transaction", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.insertCase(
          transaction,
          capaCase({
            superseded_at: LATER,
            created_by: VERSIONED_ACTOR,
            updated_by: VERSIONED_ACTOR,
          }),
        );
      },
    );

    expect(harness.calls[0]?.query).toContain(
      "insert into public.capa_cases",
    );

    expect(harness.calls[0]?.values).toContain(
      CASE_ID,
    );
  });

  it("inserts JSON section content through the active transaction", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.insertSectionVersion(
          transaction,
          sectionVersion({
            content: {
              retained: "value",
              omitted: undefined,
            },
            parent_version_id:
              SECOND_SECTION_VERSION_ID,
            superseded_at: LATER,
            created_by: VERSIONED_ACTOR,
          }),
        );
      },
    );

    expect(harness.calls[0]?.query).toContain(
      "insert into public.capa_section_versions",
    );

    expect(harness.json).toHaveBeenCalledWith({
      retained: "value",
    });
  });

  it("rejects non-serializable section content", async () => {
    const harness = createSqlHarness();

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      inTransaction(
        harness,
        async (transaction) =>
          repository.insertSectionVersion(
            transaction,
            sectionVersion({
              content:
                undefined as unknown as Readonly<
                  Record<string, unknown>
                >,
            }),
          ),
      ),
    ).rejects.toThrow(
      "CAPA content cannot be serialized as JSON.",
    );
  });

  it("inserts a case version and its ordered section mappings", async () => {
    const harness = createSqlHarness();

    harness.enqueue([], [], []);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.insertCaseVersion(
          transaction,
          caseVersion({
            parent_version_id:
              NEXT_CASE_VERSION_ID,
            superseded_at: LATER,
            created_by: VERSIONED_ACTOR,
            section_version_ids: [
              SECTION_VERSION_ID,
              SECOND_SECTION_VERSION_ID,
            ],
          }),
        );
      },
    );

    expect(harness.calls).toHaveLength(3);

    expect(harness.calls[0]?.query).toContain(
      "insert into public.capa_case_versions",
    );

    expect(harness.calls[1]?.query).toContain(
      "insert into public.capa_case_version_sections",
    );

    expect(harness.calls[1]?.values).toContain(0);
    expect(harness.calls[2]?.values).toContain(1);
  });

  it("supports a case version without section mappings", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.insertCaseVersion(
          transaction,
          caseVersion({
            section_version_ids: [],
          }),
        );
      },
    );

    expect(harness.calls).toHaveLength(1);
  });

  it("fails closed for a sparse section-reference collection", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const sparse =
      new Array<CapaSectionVersionId>(1);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      inTransaction(
        harness,
        async (transaction) =>
          repository.insertCaseVersion(
            transaction,
            caseVersion({
              section_version_ids: sparse,
            }),
          ),
      ),
    ).rejects.toThrow(
      "Missing CAPA section version identity.",
    );
  });

  it("rejects writes using forged transaction contexts", async () => {
    const harness = createSqlHarness();

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      repository.insertCase(
        {
          transaction_id: "forged",
          started_at: NOW,
          request_trace: requestTrace(),
        } as TransactionContext,
        capaCase(),
      ),
    ).rejects.toBeInstanceOf(
      SupabaseTransactionContextError,
    );
  });
});

describe("SupabaseCapaRepository optimistic concurrency", () => {
  function advanceInput() {
    return {
      organization_id: ORGANIZATION_ID,
      capa_case_id: CASE_ID,
      expected_record_version: 1,
      expected_current_version_id:
        CASE_VERSION_ID,
      next_current_version_id:
        NEXT_CASE_VERSION_ID,
      next_status: "S10" as const,
      updated_at: LATER,
      updated_by: VERSIONED_ACTOR,
    };
  }

  it("rejects a missing or invalid next version", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.advanceCurrentVersion(
          transaction,
          advanceInput(),
        ),
    );

    expect(result).toEqual({
      status: "conflict",
      reason_code:
        "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
    });

    expect(harness.calls).toHaveLength(1);
  });

  it("returns the updated aggregate", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [
        {
          case_version_id:
            NEXT_CASE_VERSION_ID,
        },
      ],
      [
        caseRow({
          current_version_id:
            NEXT_CASE_VERSION_ID,
          status: "S10",
          record_version: 2,
          updated_at: LATER,
          updated_by_actor_type: "service",
          updated_by_actor_id:
            "capa-service",
          updated_by_actor_version:
            "service-1.0.0",
        }),
      ],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.advanceCurrentVersion(
          transaction,
          advanceInput(),
        ),
    );

    expect(result).toMatchObject({
      status: "updated",
      capa_case: {
        current_version_id:
          NEXT_CASE_VERSION_ID,
        status: "S10",
        record_version: 2,
        updated_by: VERSIONED_ACTOR,
      },
    });
  });

  it("returns a missing-case conflict after a lost update", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [{ case_version_id: NEXT_CASE_VERSION_ID }],
      [],
      [],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.advanceCurrentVersion(
          transaction,
          advanceInput(),
        ),
    );

    expect(result).toEqual({
      status: "conflict",
      reason_code:
        "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
    });
  });

  it("returns a record-version conflict", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [{ case_version_id: NEXT_CASE_VERSION_ID }],
      [],
      [
        {
          record_version: "2",
          current_version_id:
            CASE_VERSION_ID,
        },
      ],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.advanceCurrentVersion(
          transaction,
          advanceInput(),
        ),
    );

    expect(result).toEqual({
      status: "conflict",
      reason_code:
        "RECORD_VERSION_CONFLICT",
    });
  });

  it("returns a current-version conflict", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [{ case_version_id: NEXT_CASE_VERSION_ID }],
      [],
      [
        {
          record_version: 1,
          current_version_id:
            NEXT_CASE_VERSION_ID,
        },
      ],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.advanceCurrentVersion(
          transaction,
          advanceInput(),
        ),
    );

    expect(result).toEqual({
      status: "conflict",
      reason_code:
        "CURRENT_VERSION_CONFLICT",
    });
  });

  it("fails closed for an invalid authoritative record version", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [{ case_version_id: NEXT_CASE_VERSION_ID }],
      [],
      [
        {
          record_version:
            "invalid-version",
          current_version_id:
            CASE_VERSION_ID,
        },
      ],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await expect(
      inTransaction(
        harness,
        async (transaction) =>
          repository.advanceCurrentVersion(
            transaction,
            advanceInput(),
          ),
      ),
    ).rejects.toThrow(
      "Invalid CAPA record version returned by the CAPA database.",
    );
  });
});

describe("SupabaseCapaRepository optional-field branches", () => {
  it("maps a minimal aggregate without optional timestamps or actor versions", async () => {
    const harness = createSqlHarness();

    harness.enqueue([caseRow()]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await repository.findCaseById(
      ORGANIZATION_ID,
      CASE_ID,
    );

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(
      "superseded_at",
    );
    expect(result).not.toHaveProperty(
      "cancelled_at",
    );
    expect(result).not.toHaveProperty(
      "closed_at",
    );
    expect(result?.created_by).toEqual(ACTOR);
    expect(result?.updated_by).toEqual(ACTOR);
  });

  it("maps a closed aggregate with its closure timestamp", async () => {
    const harness = createSqlHarness();

    const closedAt =
      "2026-08-12T16:03:00.000Z" as IsoDateTime;

    harness.enqueue([
      caseRow({
        status: "S130",
        closed_at: closedAt,
        cancelled_at: null,
      }),
    ]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await repository.findCaseById(
      ORGANIZATION_ID,
      CASE_ID,
    );

    expect(result).toMatchObject({
      status: "S130",
      closed_at: closedAt,
    });

    expect(result).not.toHaveProperty(
      "cancelled_at",
    );
  });

  it("maps a minimal case version without optional fields", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [caseVersionRow()],
      [],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result =
      await repository.findCaseVersionById(
        ORGANIZATION_ID,
        CASE_ID,
        CASE_VERSION_ID,
      );

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(
      "parent_version_id",
    );
    expect(result).not.toHaveProperty(
      "superseded_at",
    );
    expect(result?.created_by).toEqual(ACTOR);
    expect(result?.section_version_ids).toEqual(
      [],
    );
  });

  it("maps a minimal section version without optional fields", async () => {
    const harness = createSqlHarness();

    harness.enqueue([
      sectionVersionRow(),
    ]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result =
      await repository.findSectionVersionById(
        ORGANIZATION_ID,
        CASE_ID,
        SECTION_VERSION_ID,
      );

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(
      "parent_version_id",
    );
    expect(result).not.toHaveProperty(
      "superseded_at",
    );
    expect(result?.created_by).toEqual(ACTOR);
  });

  it("inserts present terminal timestamps and absent actor versions", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const cancelledAt =
      "2026-08-12T16:02:00.000Z" as IsoDateTime;

    const closedAt =
      "2026-08-12T16:03:00.000Z" as IsoDateTime;

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.insertCase(
          transaction,
          capaCase({
            cancelled_at: cancelledAt,
            closed_at: closedAt,
            created_by: ACTOR,
            updated_by: ACTOR,
          }),
        );
      },
    );

    expect(harness.calls[0]?.values).toContain(
      cancelledAt,
    );
    expect(harness.calls[0]?.values).toContain(
      closedAt,
    );

    const nullCount =
      harness.calls[0]?.values.filter(
        (value) => value === null,
      ).length;

    expect(nullCount).toBeGreaterThanOrEqual(3);
  });

  it("inserts a section with absent optional fields", async () => {
    const harness = createSqlHarness();
    harness.enqueue([]);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.insertSectionVersion(
          transaction,
          sectionVersion({
            created_by: ACTOR,
          }),
        );
      },
    );

    expect(harness.calls[0]?.values).toContain(
      null,
    );

    expect(harness.calls[0]?.query).toContain(
      "insert into public.capa_section_versions",
    );
  });

  it("inserts a section mapping without an actor version", async () => {
    const harness = createSqlHarness();

    harness.enqueue([], []);

    const repository =
      new SupabaseCapaRepository(harness.sql);

    await inTransaction(
      harness,
      async (transaction) => {
        await repository.insertCaseVersion(
          transaction,
          caseVersion({
            created_by: ACTOR,
            section_version_ids: [
              SECTION_VERSION_ID,
            ],
          }),
        );
      },
    );

    expect(harness.calls).toHaveLength(2);

    expect(harness.calls[1]?.values).toContain(
      null,
    );
  });

  it("advances with an actor that has no actor version", async () => {
    const harness = createSqlHarness();

    harness.enqueue(
      [
        {
          case_version_id:
            NEXT_CASE_VERSION_ID,
        },
      ],
      [],
      [
        {
          record_version: 1,
          current_version_id:
            NEXT_CASE_VERSION_ID,
        },
      ],
    );

    const repository =
      new SupabaseCapaRepository(harness.sql);

    const result = await inTransaction(
      harness,
      async (transaction) =>
        repository.advanceCurrentVersion(
          transaction,
          {
            organization_id:
              ORGANIZATION_ID,
            capa_case_id: CASE_ID,
            expected_record_version: 1,
            expected_current_version_id:
              CASE_VERSION_ID,
            next_current_version_id:
              NEXT_CASE_VERSION_ID,
            next_status: "S10",
            updated_at: LATER,
            updated_by: ACTOR,
          },
        ),
    );

    expect(result).toEqual({
      status: "conflict",
      reason_code:
        "CURRENT_VERSION_CONFLICT",
    });

    expect(harness.calls[1]?.values).toContain(
      null,
    );
  });
});