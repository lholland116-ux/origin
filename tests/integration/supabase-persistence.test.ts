import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import postgres from "postgres";

import type {
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  ControlledCode,
  CorrelationId,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
  UserId,
} from "../../lib/capa/domain/capa-types";

import {
  SupabaseAuditRepository,
} from "../../lib/database/supabase/supabase-audit-repository";

import {
  SupabaseCapaRepository,
} from "../../lib/database/supabase/supabase-capa-repository";

import {
  createSupabaseDatabaseSql,
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

/**
 * Real PostgreSQL integration tests.
 *
 * These tests are restricted to the standard local Supabase database and
 * must never execute against a remote or production database.
 */
const DEFAULT_LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Real-database tests are opt-in so ordinary unit tests, CI jobs, and
 * Vercel builds never attempt to connect to a developer workstation.
 */
const RUN_DATABASE_INTEGRATION_TESTS =
  process.env.CAPA_DATABASE_INTEGRATION_TESTS ===
  "true";

const TEST_DATABASE_URL =
  process.env.CAPA_TEST_DATABASE_URL ??
  DEFAULT_LOCAL_DATABASE_URL;

function assertLocalDatabaseUrl(
  connectionString: string,
): void {
  let parsed: URL;

  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(
      "CAPA_TEST_DATABASE_URL is not a valid PostgreSQL URL.",
    );
  }

  if (
    parsed.protocol !== "postgres:" &&
    parsed.protocol !== "postgresql:"
  ) {
    throw new Error(
      "CAPA persistence integration tests require a PostgreSQL URL.",
    );
  }

  if (
    !["127.0.0.1", "localhost", "::1"].includes(
      parsed.hostname,
    )
  ) {
    throw new Error(
      "CAPA persistence integration tests may run only against a local database.",
    );
  }

  if (parsed.port !== "54322") {
    throw new Error(
      "CAPA persistence integration tests require the local Supabase database port 54322.",
    );
  }

  const databaseName =
    parsed.pathname.replace(/^\/+/, "");

  if (databaseName !== "postgres") {
    throw new Error(
      "CAPA persistence integration tests require the local postgres database.",
    );
  }
}

if (RUN_DATABASE_INTEGRATION_TESTS) {
  assertLocalDatabaseUrl(TEST_DATABASE_URL);
}

const ORGANIZATION_ID =
  randomUUID() as OrganizationId;

const USER_ID =
  randomUUID() as UserId;

const MEMBERSHIP_ID = randomUUID();

const CASE_ID =
  randomUUID() as CapaCaseId;

const CASE_VERSION_ID =
  randomUUID() as CapaCaseVersionId;

const SECTION_VERSION_ID =
  randomUUID() as CapaSectionVersionId;

const AUDIT_EVENT_ID =
  randomUUID() as AuditEventId;

/**
 * These values are stable for the stored event and its exact retry.
 * Generating new trace values for the retry would correctly constitute
 * different controlled audit content.
 */
const AUDIT_REQUEST_ID =
  randomUUID() as RequestId;

const AUDIT_CORRELATION_ID =
  randomUUID() as CorrelationId;

const ROLLBACK_CASE_ID =
  randomUUID() as CapaCaseId;

const ROLLBACK_CASE_VERSION_ID =
  randomUUID() as CapaCaseVersionId;

const NOW =
  "2026-08-12T18:00:00.000Z" as IsoDateTime;

function requestTrace(): RequestTrace {
  return {
    request_id:
      randomUUID() as RequestId,
    correlation_id:
      randomUUID() as CorrelationId,
  };
}

function capaCase(
  capaCaseId: CapaCaseId,
  caseVersionId: CapaCaseVersionId,
  caseNumber: string,
): CapaCase {
  return {
    organization_id: ORGANIZATION_ID,
    capa_case_id: capaCaseId,
    case_number: caseNumber,
    current_version_id: caseVersionId,
    status: "S00",
    owner_user_id: USER_ID,
    confidentiality:
      "CUSTOMER_CONFIDENTIAL" as ControlledCode,
    record_version: 1,
    effective_at: NOW,
    created_at: NOW,
    created_by: {
      actor_type: "human",
      actor_id: USER_ID,
    },
    updated_at: NOW,
    updated_by: {
      actor_type: "human",
      actor_id: USER_ID,
    },
  };
}

function sectionVersion(): CapaSectionVersion {
  return {
    organization_id: ORGANIZATION_ID,
    section_version_id:
      SECTION_VERSION_ID,
    capa_case_id: CASE_ID,
    section_type:
      "CAPA.INTAKE" as ControlledCode,
    version_number: 1,
    schema_version:
      "intake-schema-test-1.0.0",
    content: {
      initiating_event:
        "Durable PostgreSQL integration test",
      source: {
        source_type: "NONCONFORMANCE",
        source_reference: "NCR-TEST-0001",
      },
    },
    change_reason:
      "Initial integration-test intake",
    effective_at: NOW,
    created_at: NOW,
    created_by: {
      actor_type: "human",
      actor_id: USER_ID,
    },
  };
}

function caseVersion(
  capaCaseId: CapaCaseId,
  caseVersionId: CapaCaseVersionId,
  sectionIds:
    readonly CapaSectionVersionId[],
): CapaCaseVersion {
  return {
    organization_id: ORGANIZATION_ID,
    case_version_id: caseVersionId,
    capa_case_id: capaCaseId,
    version_number: 1,
    change_reason:
      "Initial integration-test version",
    status: "S00",
    section_version_ids: sectionIds,
    effective_at: NOW,
    created_at: NOW,
    created_by: {
      actor_type: "human",
      actor_id: USER_ID,
    },
  };
}

function auditEvent(): AuditEvent {
  return {
    organization_id: ORGANIZATION_ID,
    event_id: AUDIT_EVENT_ID,
    event_type:
      "EVT-CASE-CREATED" as ControlledCode,
    schema_version:
      "audit-schema-test-1.0.0",
    aggregate_type:
      "CAPA_CASE" as ControlledCode,
    aggregate_id: CASE_ID,
    aggregate_version: 1,
    actor: {
      actor_type: "human",
      actor_id: USER_ID,
    },
    occurred_at: NOW,
    request_id: AUDIT_REQUEST_ID,
    correlation_id:
      AUDIT_CORRELATION_ID,
    action:
      "CREATE_CAPA_DRAFT" as ControlledCode,
    target: {
      object_type:
        "CAPA_CASE" as ControlledCode,
      object_id: CASE_ID,
      object_version_id: CASE_VERSION_ID,
    },
    outcome: "succeeded",
    change: {
      after_ref: {
        object_type:
          "CAPA_CASE" as ControlledCode,
        object_id: CASE_ID,
        object_version_id: CASE_VERSION_ID,
      },
    },
    configuration_versions: {
      workflow: "workflow-test-1.0.0",
      authorization_policy:
        "policy-test-1.0.0",
      intake_schema:
        "intake-schema-test-1.0.0",
      audit_schema:
        "audit-schema-test-1.0.0",
    },
    metadata: {
      case_number: "CAPA-DB-TEST-0001",
      initial_state: "S00",
    },
  };
}

const databaseSql =
  createSupabaseDatabaseSql({
    connection_string: TEST_DATABASE_URL,
    maximum_connections: 1,
  });

const transactionManager =
  new SupabaseTransactionManager(databaseSql);

const capaRepository =
  new SupabaseCapaRepository(databaseSql);

const auditRepository =
  new SupabaseAuditRepository(databaseSql);

/**
 * Dedicated local administrative client used only to create and clean up
 * integration-test tenant fixtures.
 */
const fixtureSql = postgres(
  TEST_DATABASE_URL,
  {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    connection: {
      application_name:
        "lvtchat-capa-integration-test",
    },
  },
);

beforeAll(async () => {
  if (!RUN_DATABASE_INTEGRATION_TESTS) {
    return;
  }

  await fixtureSql.begin(async (sql) => {
    await sql`
      insert into public.capa_organizations (
        organization_id,
        organization_name,
        authorization_policy_version,
        created_at,
        created_by_actor_type,
        created_by_actor_id,
        updated_at,
        updated_by_actor_type,
        updated_by_actor_id
      )
      values (
        ${ORGANIZATION_ID},
        ${"CAPA Persistence Integration Test"},
        ${"policy-test-1.0.0"},
        ${NOW},
        ${"system"},
        ${"integration-test"},
        ${NOW},
        ${"system"},
        ${"integration-test"}
      )
    `;

    await sql`
      insert into
        public.capa_organization_memberships (
          membership_id,
          organization_id,
          user_id,
          status,
          effective_at,
          created_at,
          created_by_actor_type,
          created_by_actor_id,
          updated_at,
          updated_by_actor_type,
          updated_by_actor_id
        )
      values (
        ${MEMBERSHIP_ID},
        ${ORGANIZATION_ID},
        ${USER_ID},
        ${"active"},
        ${NOW},
        ${NOW},
        ${"system"},
        ${"integration-test"},
        ${NOW},
        ${"system"},
        ${"integration-test"}
      )
    `;
  });
});

afterAll(async () => {
  if (!RUN_DATABASE_INTEGRATION_TESTS) {
    return;
  }

  try {
    /**
     * Test cleanup requires bypassing append-only mutation triggers. The
     * URL guard above confines this privileged operation to the standard
     * local Supabase test database.
     */
    await fixtureSql.begin(async (sql) => {
      await sql`
        set local session_replication_role =
          replica
      `;

      await sql`
        delete from public.capa_audit_events
        where organization_id =
          ${ORGANIZATION_ID}
      `;

      await sql`
        delete from
          public.capa_case_version_sections
        where organization_id =
          ${ORGANIZATION_ID}
      `;

      await sql`
        delete from public.capa_case_versions
        where organization_id =
          ${ORGANIZATION_ID}
      `;

      await sql`
        delete from public.capa_section_versions
        where organization_id =
          ${ORGANIZATION_ID}
      `;

      await sql`
        delete from public.capa_cases
        where organization_id =
          ${ORGANIZATION_ID}
      `;

      await sql`
        delete from public.capa_role_assignments
        where organization_id =
          ${ORGANIZATION_ID}
      `;

      await sql`
        delete from
          public.capa_organization_memberships
        where organization_id =
          ${ORGANIZATION_ID}
      `;

      await sql`
        delete from public.capa_organizations
        where organization_id =
          ${ORGANIZATION_ID}
      `;
    });
  } finally {
    try {
      await databaseSql.end({
        timeout: 5,
      });
    } finally {
      await fixtureSql.end({
        timeout: 5,
      });
    }
  }
});

describe.skipIf(
  !RUN_DATABASE_INTEGRATION_TESTS,
).sequential(
  "durable Supabase CAPA persistence",
  () => {
    it("commits and retrieves one complete CAPA creation atomically", async () => {
      const aggregate = capaCase(
        CASE_ID,
        CASE_VERSION_ID,
        "CAPA-DB-TEST-0001",
      );

      const section = sectionVersion();

      const version = caseVersion(
        CASE_ID,
        CASE_VERSION_ID,
        [SECTION_VERSION_ID],
      );

      const event = auditEvent();

      const result =
        await transactionManager.runInTransaction(
          requestTrace(),
          async (transaction) => {
            await capaRepository.insertCase(
              transaction,
              aggregate,
            );

            await capaRepository.insertSectionVersion(
              transaction,
              section,
            );

            await capaRepository.insertCaseVersion(
              transaction,
              version,
            );

            return auditRepository.appendEvent(
              transaction,
              event,
            );
          },
        );

      expect(result).toEqual({
        status: "appended",
        event_id: AUDIT_EVENT_ID,
      });

      /**
       * New repository instances prove that reads come from committed
       * PostgreSQL state rather than repository-local memory.
       */
      const separateCapaRepository =
        new SupabaseCapaRepository(databaseSql);

      const separateAuditRepository =
        new SupabaseAuditRepository(databaseSql);

      await expect(
        separateCapaRepository.findCaseById(
          ORGANIZATION_ID,
          CASE_ID,
        ),
      ).resolves.toEqual(aggregate);

      await expect(
        separateCapaRepository.findSectionVersionById(
          ORGANIZATION_ID,
          CASE_ID,
          SECTION_VERSION_ID,
        ),
      ).resolves.toEqual(section);

      await expect(
        separateCapaRepository.findCaseVersionById(
          ORGANIZATION_ID,
          CASE_ID,
          CASE_VERSION_ID,
        ),
      ).resolves.toEqual(version);

      await expect(
        separateAuditRepository.findEventById(
          ORGANIZATION_ID,
          AUDIT_EVENT_ID,
        ),
      ).resolves.toEqual(event);
    });

    it("recognizes an exact idempotent audit retry", async () => {
      const controlledRetry = auditEvent();

      const result =
        await transactionManager.runInTransaction(
          requestTrace(),
          (transaction) =>
            auditRepository.appendEvent(
              transaction,
              controlledRetry,
            ),
        );

      expect(result).toEqual({
        status: "already_recorded",
        event_id: AUDIT_EVENT_ID,
      });
    });

    it("rolls back a CAPA aggregate when transaction work fails", async () => {
      const aggregate = capaCase(
        ROLLBACK_CASE_ID,
        ROLLBACK_CASE_VERSION_ID,
        "CAPA-DB-TEST-ROLLBACK",
      );

      const failure = new Error(
        "Intentional integration rollback",
      );

      await expect(
        transactionManager.runInTransaction(
          requestTrace(),
          async (transaction) => {
            await capaRepository.insertCase(
              transaction,
              aggregate,
            );

            throw failure;
          },
        ),
      ).rejects.toBe(failure);

      await expect(
        capaRepository.findCaseById(
          ORGANIZATION_ID,
          ROLLBACK_CASE_ID,
        ),
      ).resolves.toBeNull();
    });
  },
);