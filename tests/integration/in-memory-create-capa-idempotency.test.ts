import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCapa,
  type CreateCapaCommand,
  type CreateCapaDependencies,
} from "../../lib/capa/application/create-capa";

import type {
  CapaPolicyDecision,
} from "../../lib/capa/authorization/capa-policy";

import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  ControlledCode,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
  UserId,
} from "../../lib/capa/domain/capa-types";

import {
  InMemoryCapaDatabase,
} from "../../lib/database/in-memory/in-memory-capa-database";

import type {
  TransactionId,
} from "../../lib/database/transactions";

import type {
  AuthenticationContext,
  SessionId,
} from "../../lib/security/auth-context";

import type {
  RoleAssignmentId,
  TenantAccessGrantId,
  TenantContext,
} from "../../lib/security/tenant-context";

const NOW =
  new Date(
    "2026-08-22T12:00:00.000Z",
  );

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23" as
    UserId;

const CAPA_CASE_ID =
  "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as
    CapaCaseId;

const CASE_VERSION_ID =
  "a65d17e5-4688-4412-aa08-f2832b37f671" as
    CapaCaseVersionId;

const SECTION_VERSION_ID =
  "779594ce-cb78-4818-a173-4c1e8217637f" as
    CapaSectionVersionId;

const AUDIT_EVENT_ID =
  "bed889a5-8a47-4dd8-bebf-f79f31b795e7" as
    AuditEventId;

const ROLE_ASSIGNMENT_ID =
  "c0cf1844-61b9-432b-8355-f6c13fe48e67" as
    RoleAssignmentId;

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function iso(
  value: string,
): IsoDateTime {
  return value as IsoDateTime;
}

function trace(): RequestTrace {
  return {
    request_id:
      "098c6760-7c3a-4de2-92fa-cd45f46c2321" as
        RequestId,
    correlation_id:
      "55633f2e-eb6a-4dc6-840f-d4be782f9f23" as
        CorrelationId,
    idempotency_key:
      "integration-idempotency-001" as
        IdempotencyKey,
  };
}

function authentication():
  AuthenticationContext {
  return {
    principal: {
      principal_type: "human",
      user_id: USER_ID,
    },
    session_id:
      "b7ca1234-bb73-480f-8c03-d1d234990267" as
        SessionId,
    authentication_method:
      controlled("OIDC"),
    assurance_level:
      controlled("MFA"),
    authenticated_at:
      iso(
        "2026-08-22T11:00:00.000Z",
      ),
    expires_at:
      iso(
        "2026-08-22T13:00:00.000Z",
      ),
    reauthenticated_at:
      iso(
        "2026-08-22T11:55:00.000Z",
      ),
  };
}

function tenant(): TenantContext {
  return {
    organization_id:
      ORGANIZATION_ID,
    access_grant_id:
      "2bf86821-80f-42df-96f3-9e7ae645c061" as
        TenantAccessGrantId,
    access_path:
      controlled("HUMAN_MEMBERSHIP"),
    authorization_policy_version:
      "policy-1.0.0",
    resolved_at:
      iso(
        "2026-08-22T11:59:00.000Z",
      ),
    role_assignments: [],
  };
}

function command(
  initiatingEvent =
    "Seal defects exceeded the approved alert threshold.",
): CreateCapaCommand {
  return {
    authentication:
      authentication(),
    tenant: tenant(),
    owner_user_id: USER_ID,
    request_trace: trace(),
    body: {
      initiating_event:
        initiatingEvent,
      source: {
        source_type:
          "NONCONFORMANCE",
        source_reference:
          "NCR-2026-0042",
      },
      organization_reference:
        "CAPA-LOCAL-19",
    },
  };
}

function allowDecision():
  CapaPolicyDecision {
  return {
    decision: "allow",
    reason_code:
      controlled("CREATE_ALLOWED"),
    policy_version:
      "policy-1.0.0",
    evaluated_at:
      iso(
        "2026-08-22T12:00:00.000Z",
      ),
    relied_on_role_assignment_ids: [
      ROLE_ASSIGNMENT_ID,
    ],
  };
}

function createDatabase():
  InMemoryCapaDatabase {
  let transactionSequence = 0;

  return new InMemoryCapaDatabase({
    generate_transaction_id() {
      transactionSequence += 1;
      return `idempotency-transaction-${transactionSequence}` as
        TransactionId;
    },
    now() {
      return NOW;
    },
  });
}

interface Harness {
  readonly database:
    InMemoryCapaDatabase;
  readonly dependencies:
    CreateCapaDependencies;
  readonly allocationCalls:
    () => number;
}

function createHarness(): Harness {
  const database = createDatabase();
  let allocations = 0;

  return {
    database,
    allocationCalls() {
      return allocations;
    },
    dependencies: {
      transaction_manager: database,
      capa_repository: database,
      audit_repository: database,
      creation_idempotency_repository:
        database,
      case_number_allocator: {
        async allocateNextCaseNumber(
          transaction,
          organizationId,
        ) {
          allocations += 1;
          return database
            .allocateNextCaseNumber(
              transaction,
              organizationId,
            );
        },
      },
      authorization_policy: {
        async evaluate() {
          return allowDecision();
        },
      },
      id_generator: {
        generateCapaCaseId() {
          return CAPA_CASE_ID;
        },
        generateCaseVersionId() {
          return CASE_VERSION_ID;
        },
        generateSectionVersionId() {
          return SECTION_VERSION_ID;
        },
        generateAuditEventId() {
          return AUDIT_EVENT_ID;
        },
      },
      clock: {
        now() {
          return NOW;
        },
      },
      configuration: {
        workflow_version:
          "workflow-1.0.0",
        intake_schema_version:
          "intake-schema-1.0.0",
        audit_schema_version:
          "audit-schema-1.0.0",
        intake_section_type:
          controlled("CAPA.INTAKE"),
        default_confidentiality:
          controlled(
            "CUSTOMER_CONFIDENTIAL",
          ),
        authorization_purpose:
          controlled(
            "CAPA_CASE_CREATION",
          ),
      },
    },
  };
}

async function expectOneStoredCreation(
  database: InMemoryCapaDatabase,
) {
  const page =
    await database.listCases({
      organization_id:
        ORGANIZATION_ID,
      limit: 100,
    });

  const auditPage =
    await database
      .listEventsForAggregate({
        organization_id:
          ORGANIZATION_ID,
        aggregate_type:
          controlled("CAPA_CASE"),
        aggregate_id:
          CAPA_CASE_ID,
        limit: 100,
      });

  expect(page.cases).toHaveLength(1);
  expect(auditPage.events)
    .toHaveLength(1);
}

describe(
  "in-memory CAPA creation idempotency",
  () => {
    it(
      "returns the authoritative CAPA for an exact retry without allocating another case number",
      async () => {
        const harness =
          createHarness();

        const first =
          await createCapa(
            harness.dependencies,
            command(),
          );

        const retry =
          await createCapa(
            harness.dependencies,
            command(),
          );

        expect(first.status).toBe(
          "created",
        );
        expect(retry.status).toBe(
          "already_created",
        );

        if (
          first.status !== "created" ||
          retry.status !==
            "already_created"
        ) {
          throw new Error(
            "Expected an initial creation and exact authoritative replay.",
          );
        }

        expect(retry.capa_case)
          .toEqual(first.capa_case);
        expect(retry.case_version)
          .toEqual(first.case_version);
        expect(retry.section_version)
          .toEqual(first.section_version);
        expect(retry.audit_event_id)
          .toBe(first.audit_event_id);
        expect(harness.allocationCalls())
          .toBe(1);

        await expectOneStoredCreation(
          harness.database,
        );
      },
    );

    it(
      "rejects different request content under the same key without allocating or writing again",
      async () => {
        const harness =
          createHarness();

        const first =
          await createCapa(
            harness.dependencies,
            command(),
          );

        const conflict =
          await createCapa(
            harness.dependencies,
            command(
              "A different controlled initiating event.",
            ),
          );

        expect(first.status).toBe(
          "created",
        );
        expect(conflict).toEqual({
          status:
            "idempotency_conflict",
          reason_code:
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        });
        expect(harness.allocationCalls())
          .toBe(1);

        await expectOneStoredCreation(
          harness.database,
        );
      },
    );
  },
);