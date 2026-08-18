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
  AuditRepository,
} from "../../lib/database/repositories/audit-repository";

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
    "2026-08-12T01:00:00.000Z",
  );

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

const OTHER_ORGANIZATION_ID =
  "9508a4d7-36e6-49ae-ae36-8d33a6bba431" as
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

function requestTrace():
  RequestTrace {
  return {
    request_id:
      "098c6760-7c3a-4de2-92fa-cd45f46c2321" as
        RequestId,

    correlation_id:
      "55633f2e-eb6a-4dc6-840f-d4be782f9f23" as
        CorrelationId,

    idempotency_key:
      "integration-create-capa-001" as
        IdempotencyKey,
  };
}

function authentication():
  AuthenticationContext {
  return {
    principal: {
      principal_type:
        "human",

      user_id:
        USER_ID,
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
        "2026-08-12T00:00:00.000Z",
      ),

    expires_at:
      iso(
        "2026-08-12T02:00:00.000Z",
      ),

    reauthenticated_at:
      iso(
        "2026-08-12T00:55:00.000Z",
      ),
  };
}

function tenantContext(
  organizationId:
    OrganizationId =
      ORGANIZATION_ID,
): TenantContext {
  return {
    organization_id:
      organizationId,

    access_grant_id:
      "2bf86821-80f-42df-96f3-9e7ae645c061" as
        TenantAccessGrantId,

    access_path:
      controlled(
        "HUMAN_MEMBERSHIP",
      ),

    authorization_policy_version:
      "policy-1.0.0",

    resolved_at:
      iso(
        "2026-08-12T00:59:00.000Z",
      ),

    role_assignments: [],
  };
}

function command(
  organizationId:
    OrganizationId =
      ORGANIZATION_ID,
): CreateCapaCommand {
  return {
    authentication:
      authentication(),

    tenant:
      tenantContext(
        organizationId,
      ),

    owner_user_id:
      USER_ID,

    request_trace:
      requestTrace(),

    body: {
      initiating_event:
        "Seal defects exceeded the approved alert threshold.",

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
    decision:
      "allow",

    reason_code:
      controlled(
        "CREATE_ALLOWED",
      ),

    policy_version:
      "policy-1.0.0",

    evaluated_at:
      iso(
        "2026-08-12T01:00:00.000Z",
      ),

    relied_on_role_assignment_ids: [
      ROLE_ASSIGNMENT_ID,
    ],
  };
}

function createDatabase():
  InMemoryCapaDatabase {
  let transactionSequence =
    0;

  return new InMemoryCapaDatabase({
    generate_transaction_id() {
      transactionSequence += 1;

      return (
        `integration-transaction-${transactionSequence}`
      ) as TransactionId;
    },

    now() {
      return NOW;
    },
  });
}

function createDependencies(
  database:
    InMemoryCapaDatabase,

  auditRepository:
    AuditRepository =
      database,
): CreateCapaDependencies {
  return {
    transaction_manager:
      database,

    capa_repository:
      database,

    audit_repository:
      auditRepository,

    /*
     * The in-memory database owns the counter so allocation and CAPA
     * persistence share the same transaction snapshot.
     */
    case_number_allocator:
      database,

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
        controlled(
          "CAPA.INTAKE",
        ),

      default_confidentiality:
        controlled(
          "CUSTOMER_CONFIDENTIAL",
        ),

      authorization_purpose:
        controlled(
          "CAPA_CASE_CREATION",
        ),
    },
  };
}

describe(
  "in-memory CAPA creation integration",
  () => {
    it(
      "commits the allocated number, case, section, version and audit event atomically",
      async () => {
        const database =
          createDatabase();

        const result =
          await createCapa(
            createDependencies(
              database,
            ),
            command(),
          );

        expect(
          result.status,
        ).toBe(
          "created",
        );

        if (
          result.status !==
          "created"
        ) {
          throw new Error(
            `Expected CAPA creation, received ${result.status}.`,
          );
        }

        expect(
          result.capa_case
            .case_number,
        ).toBe(
          "CAPA-000001",
        );

        const storedCase =
          await database
            .findCaseById(
              ORGANIZATION_ID,
              result.capa_case
                .capa_case_id,
            );

        const storedVersion =
          await database
            .findCaseVersionById(
              ORGANIZATION_ID,
              result.capa_case
                .capa_case_id,
              result.case_version
                .case_version_id,
            );

        const storedSection =
          await database
            .findSectionVersionById(
              ORGANIZATION_ID,
              result.capa_case
                .capa_case_id,
              result.section_version
                .section_version_id,
            );

        const storedAudit =
          await database
            .findEventById(
              ORGANIZATION_ID,
              result.audit_event_id,
            );

        expect(
          storedCase,
        ).toEqual(
          result.capa_case,
        );

        expect(
          storedVersion,
        ).toEqual(
          result.case_version,
        );

        expect(
          storedSection,
        ).toEqual(
          result.section_version,
        );

        expect(
          storedAudit,
        ).toMatchObject({
          organization_id:
            ORGANIZATION_ID,

          event_id:
            AUDIT_EVENT_ID,

          event_type:
            "EVT-CASE-CREATED",

          aggregate_type:
            "CAPA_CASE",

          aggregate_id:
            CAPA_CASE_ID,

          aggregate_version:
            1,

          action:
            "CREATE_CAPA_DRAFT",

          outcome:
            "succeeded",

          metadata: {
            case_number:
              "CAPA-000001",
          },
        });

        expect(
          await database
            .caseNumberExists(
              ORGANIZATION_ID,
              "CAPA-000001",
            ),
        ).toBe(true);

        const auditPage =
          await database
            .listEventsForAggregate({
              organization_id:
                ORGANIZATION_ID,

              aggregate_type:
                controlled(
                  "CAPA_CASE",
                ),

              aggregate_id:
                CAPA_CASE_ID,

              limit: 100,
            });

        expect(
          auditPage.events,
        ).toHaveLength(1);

        expect(
          auditPage.events[0],
        ).toEqual(
          storedAudit,
        );

        expect(
          auditPage.next_cursor,
        ).toBeUndefined();
      },
    );

    it(
      "rolls back the allocated number and every CAPA write when audit persistence fails",
      async () => {
        const database =
          createDatabase();

        const auditFailure =
          new Error(
            "Simulated audit persistence failure",
          );

        const failingAuditRepository:
          AuditRepository = {
          async appendEvent() {
            throw auditFailure;
          },

          async findEventById(
            organizationId,
            eventId,
          ) {
            return database
              .findEventById(
                organizationId,
                eventId,
              );
          },

          async listEventsForAggregate(
            query,
          ) {
            return database
              .listEventsForAggregate(
                query,
              );
          },
        };

        await expect(
          createCapa(
            createDependencies(
              database,
              failingAuditRepository,
            ),
            command(),
          ),
        ).rejects.toBe(
          auditFailure,
        );

        expect(
          await database
            .findCaseById(
              ORGANIZATION_ID,
              CAPA_CASE_ID,
            ),
        ).toBeNull();

        expect(
          await database
            .findCaseVersionById(
              ORGANIZATION_ID,
              CAPA_CASE_ID,
              CASE_VERSION_ID,
            ),
        ).toBeNull();

        expect(
          await database
            .findSectionVersionById(
              ORGANIZATION_ID,
              CAPA_CASE_ID,
              SECTION_VERSION_ID,
            ),
        ).toBeNull();

        expect(
          await database
            .findEventById(
              ORGANIZATION_ID,
              AUDIT_EVENT_ID,
            ),
        ).toBeNull();

        expect(
          await database
            .caseNumberExists(
              ORGANIZATION_ID,
              "CAPA-000001",
            ),
        ).toBe(false);

        /*
         * A successful retry must receive CAPA-000001 again. This proves
         * the failed transaction did not consume the counter value.
         */
        const retry =
          await createCapa(
            createDependencies(
              database,
            ),
            command(),
          );

        expect(
          retry.status,
        ).toBe(
          "created",
        );

        if (
          retry.status !==
          "created"
        ) {
          throw new Error(
            `Expected retry creation, received ${retry.status}.`,
          );
        }

        expect(
          retry.capa_case
            .case_number,
        ).toBe(
          "CAPA-000001",
        );
      },
    );

    it(
      "isolates records and case-number sequences by organization",
      async () => {
        const database =
          createDatabase();

        const first =
          await createCapa(
            createDependencies(
              database,
            ),
            command(
              ORGANIZATION_ID,
            ),
          );

        const second =
          await createCapa(
            createDependencies(
              database,
            ),
            command(
              OTHER_ORGANIZATION_ID,
            ),
          );

        expect(
          first.status,
        ).toBe(
          "created",
        );

        expect(
          second.status,
        ).toBe(
          "created",
        );

        if (
          first.status !==
            "created" ||
          second.status !==
            "created"
        ) {
          throw new Error(
            "Expected both organization-scoped CAPA creations to succeed.",
          );
        }

        expect(
          first.capa_case
            .case_number,
        ).toBe(
          "CAPA-000001",
        );

        expect(
          second.capa_case
            .case_number,
        ).toBe(
          "CAPA-000001",
        );

        expect(
          await database
            .findCaseById(
              ORGANIZATION_ID,
              CAPA_CASE_ID,
            ),
        ).toEqual(
          first.capa_case,
        );

        expect(
          await database
            .findCaseById(
              OTHER_ORGANIZATION_ID,
              CAPA_CASE_ID,
            ),
        ).toEqual(
          second.capa_case,
        );

        expect(
          await database
            .findCaseVersionById(
              OTHER_ORGANIZATION_ID,
              CAPA_CASE_ID,
              CASE_VERSION_ID,
            ),
        ).toEqual(
          second.case_version,
        );

        expect(
          await database
            .findSectionVersionById(
              OTHER_ORGANIZATION_ID,
              CAPA_CASE_ID,
              SECTION_VERSION_ID,
            ),
        ).toEqual(
          second.section_version,
        );

        expect(
          await database
            .findEventById(
              OTHER_ORGANIZATION_ID,
              AUDIT_EVENT_ID,
            ),
        ).toEqual(
          expect.objectContaining({
            organization_id:
              OTHER_ORGANIZATION_ID,
          }),
        );

        expect(
          await database
            .caseNumberExists(
              OTHER_ORGANIZATION_ID,
              "CAPA-000001",
            ),
        ).toBe(true);
      },
    );

    it(
      "returns independent copies instead of exposing stored mutable values",
      async () => {
        const database =
          createDatabase();

        const result =
          await createCapa(
            createDependencies(
              database,
            ),
            command(),
          );

        expect(
          result.status,
        ).toBe(
          "created",
        );

        if (
          result.status !==
          "created"
        ) {
          throw new Error(
            `Expected CAPA creation, received ${result.status}.`,
          );
        }

        const firstRead =
          await database
            .findCaseById(
              ORGANIZATION_ID,
              CAPA_CASE_ID,
            );

        const secondRead =
          await database
            .findCaseById(
              ORGANIZATION_ID,
              CAPA_CASE_ID,
            );

        expect(
          firstRead,
        ).toEqual(
          result.capa_case,
        );

        expect(
          secondRead,
        ).toEqual(
          result.capa_case,
        );

        expect(
          firstRead,
        ).not.toBe(
          secondRead,
        );
      },
    );
  },
);