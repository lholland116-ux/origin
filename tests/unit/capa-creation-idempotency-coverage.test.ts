import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCapa,
  CreateCapaIdempotencyConfigurationError,
  CreateCapaReplayIntegrityError,
  type CreateCapaCommand,
  type CreateCapaDependencies,
} from "../../lib/capa/application/create-capa";

import {
  createCapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";

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

import type {
  CapaRepository,
} from "../../lib/database/repositories/capa-repository";

import type {
  CapaCreationRequestFingerprint,
} from "../../lib/database/repositories/capa-creation-idempotency-repository";

import {
  InMemoryIntegrityError,
} from "../../lib/database/in-memory/in-memory-capa-database";

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
    "2026-08-22T14:00:00.000Z",
  );

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23" as
    UserId;

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
        "2026-08-22T13:00:00.000Z",
      ),
    expires_at:
      iso(
        "2026-08-22T15:00:00.000Z",
      ),
    reauthenticated_at:
      iso(
        "2026-08-22T13:55:00.000Z",
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
        "2026-08-22T13:59:00.000Z",
      ),
    role_assignments: [],
  };
}

function trace(
  key: string | undefined,
): RequestTrace {
  return {
    request_id:
      "098c6760-7c3a-4de2-92fa-cd45f46c2321" as
        RequestId,
    correlation_id:
      "55633f2e-eb6a-4dc6-840f-d4be782f9f23" as
        CorrelationId,
    ...(key === undefined
      ? {}
      : {
          idempotency_key:
            key as IdempotencyKey,
        }),
  };
}

function command(
  key: string | undefined,
): CreateCapaCommand {
  return {
    authentication:
      authentication(),
    tenant: tenant(),
    owner_user_id: USER_ID,
    request_trace: trace(key),
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
    decision: "allow",
    reason_code:
      controlled("CREATE_ALLOWED"),
    policy_version:
      "policy-1.0.0",
    evaluated_at:
      iso(
        "2026-08-22T14:00:00.000Z",
      ),
    relied_on_role_assignment_ids: [
      ROLE_ASSIGNMENT_ID,
    ],
  };
}

function uuidGenerator(): () => string {
  let sequence = 0;

  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(
      sequence,
    ).padStart(12, "0")}`;
  };
}

function dependencies() {
  const runtime =
    createCapaDevelopmentRuntime({
      environment: "test",
      now: () => NOW,
      generate_uuid:
        uuidGenerator(),
    });

  const controlledDependencies:
    CreateCapaDependencies = {
    ...runtime.dependencies,
    authorization_policy: {
      async evaluate() {
        return allowDecision();
      },
    },
  };

  return {
    runtime,
    dependencies:
      controlledDependencies,
  };
}

describe(
  "CAPA creation-idempotency application guards",
  () => {
    it.each([
      {
        description: "missing",
        key: undefined,
      },
      {
        description: "empty",
        key: "",
      },
      {
        description: "too long",
        key: "x".repeat(129),
      },
      {
        description:
          "surrounded by whitespace",
        key: " padded ",
      },
    ])(
      "rejects a $description creation key",
      async ({ key }) => {
        const selected =
          dependencies();

        await expect(
          createCapa(
            selected.dependencies,
            command(key),
          ),
        ).rejects.toEqual(
          expect.objectContaining({
            name:
              "CreateCapaIdempotencyConfigurationError",
            message:
              "CAPA creation requires a valid idempotency key.",
          }),
        );
      },
    );

    it(
      "provides stable named application errors",
      () => {
        expect(
          new CreateCapaIdempotencyConfigurationError(),
        ).toBeInstanceOf(Error);

        expect(
          new CreateCapaReplayIntegrityError(),
        ).toEqual(
          expect.objectContaining({
            name:
              "CreateCapaReplayIntegrityError",
            message:
              "The authoritative CAPA creation retry record is incomplete.",
          }),
        );
      },
    );

    it(
      "creates a canonical fingerprint when optional intake references are absent",
      async () => {
        const selected =
          dependencies();

        const baseCommand =
          command(
            "coverage-optional-fields-1",
          );

        const result =
          await createCapa(
            selected.dependencies,
            {
              ...baseCommand,
              body: {
                initiating_event:
                  "Seal defects exceeded the approved alert threshold.",
                source: {
                  source_type:
                    "NONCONFORMANCE",
                },
              },
            },
          );

        expect(result.status)
          .toBe("created");
      },
    );

    it(
      "fails closed when an exact retry cannot resolve its authoritative aggregate",
      async () => {
        const selected =
          dependencies();

        const first =
          await createCapa(
            selected.dependencies,
            command(
              "coverage-idempotency-1",
            ),
          );

        expect(first.status)
          .toBe("created");

        const incompleteRepository =
          new Proxy(
            selected.runtime.database,
            {
              get(target, property) {
                if (
                  property ===
                  "findCaseById"
                ) {
                  return async () => null;
                }

                const value = Reflect.get(
                  target,
                  property,
                );

                return typeof value ===
                  "function"
                  ? value.bind(target)
                  : value;
              },
            },
          ) as CapaRepository;

        await expect(
          createCapa(
            {
              ...selected.dependencies,
              capa_repository:
                incompleteRepository,
            },
            command(
              "coverage-idempotency-1",
            ),
          ),
        ).rejects.toBeInstanceOf(
          CreateCapaReplayIntegrityError,
        );
      },
    );

    it(
      "rejects a committed creation claim whose aggregate is incomplete",
      async () => {
        const selected =
          dependencies();
        const database =
          selected.runtime.database;

        await expect(
          database.runInTransaction(
            trace(
              "incomplete-claim-1",
            ),
            async (transaction) => {
              await database
                .claimCreation(
                  transaction,
                  {
                    organization_id:
                      ORGANIZATION_ID,
                    idempotency_key:
                      "incomplete-claim-1" as
                        IdempotencyKey,
                    request_fingerprint:
                      "a".repeat(64) as
                        CapaCreationRequestFingerprint,
                    capa_case_id:
                      "00000000-0000-4000-8000-000000000101" as
                        CapaCaseId,
                    case_version_id:
                      "00000000-0000-4000-8000-000000000102" as
                        CapaCaseVersionId,
                    section_version_id:
                      "00000000-0000-4000-8000-000000000103" as
                        CapaSectionVersionId,
                    audit_event_id:
                      "00000000-0000-4000-8000-000000000104" as
                        AuditEventId,
                  },
                );
            },
          ),
        ).rejects.toBeInstanceOf(
          InMemoryIntegrityError,
        );
      },
    );
  },
);
