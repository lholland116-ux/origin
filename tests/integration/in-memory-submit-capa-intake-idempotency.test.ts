import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCapa,
  type CreateCapaCommand,
} from "../../lib/capa/application/create-capa";

import {
  submitCapaIntake,
  type SubmitCapaIntakeCommand,
  type SubmitCapaIntakeDependencies,
} from "../../lib/capa/application/submit-capa-intake";

import type {
  AuditEventId,
  CapaCaseVersionId,
  ControlledCode,
  CorrelationId,
  IdempotencyKey,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import {
  createCapaDevelopmentRuntime,
  type CapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";

import {
  resolveDevelopmentCapaRequestContext,
} from "../../lib/security/supabase-capa-context";

import type {
  AuditRepository,
} from "../../lib/database/repositories/audit-repository";

import type {
  CapaWorkflowRequestFingerprint,
} from "../../lib/database/repositories/capa-workflow-idempotency-repository";

const NOW =
  new Date(
    "2026-08-23T15:00:00.000Z",
  );

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
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

function trace(
  suffix: string,
  idempotencyKey: string,
): RequestTrace {
  const numericSuffix =
    suffix.padStart(12, "0");

  return {
    request_id:
      `10000000-0000-4000-8000-${numericSuffix}` as
        RequestId,
    correlation_id:
      `20000000-0000-4000-8000-${numericSuffix}` as
        CorrelationId,
    idempotency_key:
      idempotencyKey as
        IdempotencyKey,
  };
}

function runtime(): CapaDevelopmentRuntime {
  return createCapaDevelopmentRuntime({
    environment: "test",
    now: () => NOW,
    generate_uuid:
      uuidGenerator(),
  });
}

function context() {
  return resolveDevelopmentCapaRequestContext(
    {
      verified_user_id:
        USER_ID,
      authenticated_at:
        "2026-08-23T14:00:00.000Z",
      expires_at_epoch_seconds:
        Date.parse(
          "2026-08-23T16:00:00.000Z",
        ) / 1_000,
    },
    NOW,
  );
}

function createCommand(): CreateCapaCommand {
  const resolved = context();

  return {
    authentication:
      resolved.authentication,
    tenant:
      resolved.tenant,
    owner_user_id:
      resolved.owner_user_id,
    request_trace:
      trace(
        "1",
        "create-draft-integration-1",
      ),
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

function submissionDependencies(
  selectedRuntime:
    CapaDevelopmentRuntime,
  overrides: {
    readonly audit_repository?:
      AuditRepository;
    readonly workflow_version?:
      string;
  } = {},
): SubmitCapaIntakeDependencies {
  return {
    transaction_manager:
      selectedRuntime.database,
    capa_repository:
      selectedRuntime.database,
    audit_repository:
      overrides.audit_repository ??
      selectedRuntime.database,
    workflow_idempotency_repository:
      selectedRuntime.database,
    authorization_policy:
      selectedRuntime.dependencies
        .authorization_policy,
    id_generator:
      selectedRuntime.dependencies
        .id_generator,
    clock:
      selectedRuntime.dependencies.clock,
    configuration: {
      workflow_version:
        overrides.workflow_version ??
        selectedRuntime.dependencies
          .configuration
          .workflow_version,
      audit_schema_version:
        selectedRuntime.dependencies
          .configuration
          .audit_schema_version,
      authorization_purpose:
        controlled(
          "CAPA_WORKFLOW_TRANSITION",
        ),
    },
  };
}

async function createDraft(
  selectedRuntime:
    CapaDevelopmentRuntime,
) {
  const result =
    await createCapa(
      selectedRuntime.dependencies,
      createCommand(),
    );

  if (result.status !== "created") {
    throw new Error(
      "Expected the integration fixture to create a CAPA draft.",
    );
  }

  return result;
}

function submitCommand(
  created:
    Awaited<ReturnType<typeof createDraft>>,
): SubmitCapaIntakeCommand {
  const resolved = context();

  return {
    authentication:
      resolved.authentication,
    tenant:
      resolved.tenant,
    capa_case_id:
      created.capa_case
        .capa_case_id,
    expected_record_version:
      created.capa_case
        .record_version,
    expected_current_version_id:
      created.capa_case
        .current_version_id,
    request_trace:
      trace(
        "2",
        "submit-intake-integration-1",
      ),
  };
}

async function expectOneTransition(
  selectedRuntime:
    CapaDevelopmentRuntime,
  created:
    Awaited<ReturnType<typeof createDraft>>,
) {
  const storedCase =
    await selectedRuntime.database
      .findCaseById(
        created.capa_case
          .organization_id,
        created.capa_case
          .capa_case_id,
      );

  const auditPage =
    await selectedRuntime.database
      .listEventsForAggregate({
        organization_id:
          created.capa_case
            .organization_id,
        aggregate_type:
          controlled("CAPA_CASE"),
        aggregate_id:
          created.capa_case
            .capa_case_id,
        limit: 100,
      });

  expect(storedCase).toMatchObject({
    status: "S10",
    record_version: 2,
  });
  expect(auditPage.events)
    .toHaveLength(2);
  expect(
    auditPage.events.filter(
      (event) =>
        event.action ===
        "SUBMIT_CAPA_INTAKE",
    ),
  ).toHaveLength(1);
}

describe(
  "in-memory CAPA intake-submission idempotency",
  () => {
    it(
      "returns the authoritative S10 transition for an exact retry without writing again",
      async () => {
        const selectedRuntime =
          runtime();
        const created =
          await createDraft(
            selectedRuntime,
          );
        const dependencies =
          submissionDependencies(
            selectedRuntime,
          );
        const command =
          submitCommand(created);

        const first =
          await submitCapaIntake(
            dependencies,
            command,
          );
        const retry =
          await submitCapaIntake(
            dependencies,
            command,
          );

        expect(first.status).toBe(
          "submitted",
        );
        expect(retry.status).toBe(
          "already_submitted",
        );

        if (
          first.status !== "submitted" ||
          retry.status !==
            "already_submitted"
        ) {
          throw new Error(
            "Expected an initial transition and exact authoritative replay.",
          );
        }

        expect(retry.case_version)
          .toEqual(first.case_version);
        expect(retry.audit_event_id)
          .toBe(first.audit_event_id);

        await expectOneTransition(
          selectedRuntime,
          created,
        );
      },
    );

    it(
      "rejects a changed controlled configuration under the same workflow key",
      async () => {
        const selectedRuntime =
          runtime();
        const created =
          await createDraft(
            selectedRuntime,
          );
        const command =
          submitCommand(created);

        const first =
          await submitCapaIntake(
            submissionDependencies(
              selectedRuntime,
            ),
            command,
          );

        const conflict =
          await submitCapaIntake(
            submissionDependencies(
              selectedRuntime,
              {
                workflow_version:
                  "workflow-2.0.0",
              },
            ),
            command,
          );

        expect(first.status).toBe(
          "submitted",
        );
        expect(conflict).toEqual({
          status:
            "idempotency_conflict",
          reason_code:
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        });

        await expectOneTransition(
          selectedRuntime,
          created,
        );
      },
    );

    it(
      "rolls back a new workflow claim when the transition audit append fails",
      async () => {
        const selectedRuntime =
          runtime();
        const created =
          await createDraft(
            selectedRuntime,
          );
        const command =
          submitCommand(created);

        const conflictingAudit:
          AuditRepository = {
          async appendEvent(
            _transaction,
            event,
          ) {
            return {
              status: "conflict",
              event_id:
                event.event_id,
              reason_code:
                "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
            };
          },
          async findEventById() {
            return null;
          },
          async listEventsForAggregate(
            query,
          ) {
            return selectedRuntime.database
              .listEventsForAggregate(
                query,
              );
          },
        };

        await expect(
          submitCapaIntake(
            submissionDependencies(
              selectedRuntime,
              {
                audit_repository:
                  conflictingAudit,
              },
            ),
            command,
          ),
        ).rejects.toThrow(
          "Audit event identity was reused with different controlled content.",
        );

        const retry =
          await submitCapaIntake(
            submissionDependencies(
              selectedRuntime,
            ),
            command,
          );

        expect(retry.status).toBe(
          "submitted",
        );

        await expectOneTransition(
          selectedRuntime,
          created,
        );
      },
    );
    it(
      "rejects a committed workflow claim whose transition records are incomplete",
      async () => {
        const selectedRuntime =
          runtime();
        const created =
          await createDraft(
            selectedRuntime,
          );

        await expect(
          selectedRuntime.database
            .runInTransaction(
              trace(
                "3",
                "incomplete-workflow-claim-1",
              ),
              async (transaction) =>
                selectedRuntime.database
                  .claimWorkflowOperation(
                    transaction,
                    {
                      organization_id:
                        created.capa_case
                          .organization_id,
                      idempotency_key:
                        "incomplete-workflow-claim-1" as
                          IdempotencyKey,
                      operation_code:
                        controlled(
                          "SUBMIT_CAPA_INTAKE",
                        ),
                      request_fingerprint:
                        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as
                          CapaWorkflowRequestFingerprint,
                      capa_case_id:
                        created.capa_case
                          .capa_case_id,
                      source_case_version_id:
                        created.case_version
                          .case_version_id,
                      resulting_case_version_id:
                        "30000000-0000-4000-8000-000000000003" as
                          CapaCaseVersionId,
                      audit_event_id:
                        "40000000-0000-4000-8000-000000000004" as
                          AuditEventId,
                    },
                  ),
            ),
        ).rejects.toThrow(
          "A CAPA workflow-idempotency record references an incomplete transition.",
        );

        const storedCase =
          await selectedRuntime.database
            .findCaseById(
              created.capa_case
                .organization_id,
              created.capa_case
                .capa_case_id,
            );

        expect(storedCase).toMatchObject({
          status: "S00",
          record_version: 1,
        });
      },
    );

  },
);
