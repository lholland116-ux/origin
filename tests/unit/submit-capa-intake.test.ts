import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersionId,
  ControlledCode,
  CorrelationId,
  IsoDateTime,
  RequestId,
  RequestTrace,
  UserId,
  OrganizationId,
} from "../../lib/capa/domain/capa-types";

import {
  CAPA_STATE,
} from "../../lib/capa/domain/capa-state";

import type {
  CapaPolicyDecision,
  CapaPolicyEvaluationRequest,
} from "../../lib/capa/authorization/capa-policy";

import type {
  AuthenticationContext,
  SessionId,
} from "../../lib/security/auth-context";

import type {
  RoleAssignmentId,
  TenantAccessGrantId,
  TenantContext,
} from "../../lib/security/tenant-context";

import type {
  AdvanceCapaVersionInput,
  AdvanceCapaVersionResult,
  CapaRepository,
} from "../../lib/database/repositories/capa-repository";

import type {
  AppendAuditEventResult,
  AuditEventPage,
  AuditEventQuery,
  AuditRepository,
} from "../../lib/database/repositories/audit-repository";

import type {
  CapaWorkflowIdempotencyRecord,
} from "../../lib/database/repositories/capa-workflow-idempotency-repository";

import type {
  TransactionContext,
  TransactionId,
  TransactionManager,
} from "../../lib/database/transactions";

import {
  AuditEventAppendConflictError,
} from "../../lib/capa/application/create-capa";

import {
  SubmitCapaIntakeIdempotencyConfigurationError,
  SubmitCapaIntakeIntegrityError,
  SubmitCapaIntakeReplayIntegrityError,
  submitCapaIntake,
  type SubmitCapaIntakeCommand,
  type SubmitCapaIntakeDependencies,
} from "../../lib/capa/application/submit-capa-intake";

const NOW =
  new Date("2026-08-22T14:00:00.000Z");

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as
    OrganizationId;

const USER_ID =
  "10000000-0000-4000-8000-000000000002" as
    UserId;

const CAPA_CASE_ID =
  "10000000-0000-4000-8000-000000000003" as
    CapaCaseId;

const CURRENT_VERSION_ID =
  "10000000-0000-4000-8000-000000000004" as
    CapaCaseVersionId;

const NEXT_VERSION_ID =
  "10000000-0000-4000-8000-000000000005" as
    CapaCaseVersionId;

const SECTION_VERSION_ID =
  "10000000-0000-4000-8000-000000000006" as
    CapaSectionVersionId;

const AUDIT_EVENT_ID =
  "10000000-0000-4000-8000-000000000007" as
    AuditEventId;

const ROLE_ASSIGNMENT_ID =
  "10000000-0000-4000-8000-000000000008" as
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

function authentication(
  overrides:
    Partial<AuthenticationContext> = {},
): AuthenticationContext {
  return {
    principal: {
      principal_type: "human",
      user_id: USER_ID,
    },
    session_id:
      "10000000-0000-4000-8000-000000000009" as
        SessionId,
    authentication_method:
      controlled("SUPABASE_SESSION"),
    assurance_level:
      controlled("MFA"),
    authenticated_at:
      iso("2026-08-22T13:00:00.000Z"),
    expires_at:
      iso("2026-08-22T15:00:00.000Z"),
    ...overrides,
  };
}

function tenant(): TenantContext {
  return {
    organization_id:
      ORGANIZATION_ID,
    access_grant_id:
      "10000000-0000-4000-8000-000000000010" as
        TenantAccessGrantId,
    access_path:
      controlled("SUPABASE_MEMBERSHIP"),
    authorization_policy_version:
      "policy-1.0.0",
    resolved_at:
      iso("2026-08-22T13:59:00.000Z"),
    role_assignments: [],
  };
}

function trace(): RequestTrace {
  return {
    request_id:
      "10000000-0000-4000-8000-000000000011" as
        RequestId,
    correlation_id:
      "10000000-0000-4000-8000-000000000012" as
        CorrelationId,
    idempotency_key:
      "submit-intake-1" as
        RequestTrace["idempotency_key"],
  };
}

function command(
  overrides:
    Partial<SubmitCapaIntakeCommand> = {},
): SubmitCapaIntakeCommand {
  return {
    authentication:
      authentication(),
    tenant:
      tenant(),
    capa_case_id:
      CAPA_CASE_ID,
    expected_record_version: 1,
    expected_current_version_id:
      CURRENT_VERSION_ID,
    request_trace:
      trace(),
    ...overrides,
  };
}

function draftCase(
  overrides:
    Partial<CapaCase> = {},
): CapaCase {
  return {
    organization_id:
      ORGANIZATION_ID,
    capa_case_id:
      CAPA_CASE_ID,
    case_number:
      "CAPA-000001",
    current_version_id:
      CURRENT_VERSION_ID,
    status:
      CAPA_STATE.DRAFT_INTAKE,
    owner_user_id:
      USER_ID,
    confidentiality:
      controlled("CUSTOMER_CONFIDENTIAL"),
    effective_at:
      iso("2026-08-22T13:30:00.000Z"),
    record_version: 1,
    created_at:
      iso("2026-08-22T13:30:00.000Z"),
    created_by: {
      actor_type: "human",
      actor_id: USER_ID,
    },
    updated_at:
      iso("2026-08-22T13:30:00.000Z"),
    updated_by: {
      actor_type: "human",
      actor_id: USER_ID,
    },
    ...overrides,
  };
}

function draftVersion(
  overrides:
    Partial<CapaCaseVersion> = {},
): CapaCaseVersion {
  return {
    organization_id:
      ORGANIZATION_ID,
    case_version_id:
      CURRENT_VERSION_ID,
    capa_case_id:
      CAPA_CASE_ID,
    version_number: 1,
    change_reason:
      "Initial CAPA draft creation",
    status:
      CAPA_STATE.DRAFT_INTAKE,
    section_version_ids: [
      SECTION_VERSION_ID,
    ],
    effective_at:
      iso("2026-08-22T13:30:00.000Z"),
    created_at:
      iso("2026-08-22T13:30:00.000Z"),
    created_by: {
      actor_type: "human",
      actor_id: USER_ID,
    },
    ...overrides,
  };
}

function allowDecision():
  CapaPolicyDecision {
  return {
    decision: "allow",
    reason_code:
      controlled("AUTHORIZED"),
    policy_version:
      "policy-1.0.0",
    evaluated_at:
      iso("2026-08-22T14:00:00.000Z"),
    relied_on_role_assignment_ids: [
      ROLE_ASSIGNMENT_ID,
    ],
  };
}

interface Harness {
  readonly dependencies:
    SubmitCapaIntakeDependencies;
  readonly order: string[];
  readonly policy_requests:
    CapaPolicyEvaluationRequest[];
  readonly inserted_versions:
    CapaCaseVersion[];
  readonly advance_inputs:
    AdvanceCapaVersionInput[];
  readonly audit_events:
    AuditEvent[];
  readonly workflow_claims:
    CapaWorkflowIdempotencyRecord[];
  setCase(value: CapaCase | null): void;
  setVersion(
    value: CapaCaseVersion | null,
  ): void;
  setResultVersion(
    value: CapaCaseVersion | null,
  ): void;
  setClaimStatus(
    value:
      | "claimed"
      | "already_claimed"
      | "conflict",
  ): void;
  setPolicy(
    value: CapaPolicyDecision,
  ): void;
  setAdvance(
    value: AdvanceCapaVersionResult,
  ): void;
  setAudit(
    value: AppendAuditEventResult,
  ): void;
}

function createHarness(): Harness {
  const order: string[] = [];
  const policyRequests:
    CapaPolicyEvaluationRequest[] = [];
  const insertedVersions:
    CapaCaseVersion[] = [];
  const advanceInputs:
    AdvanceCapaVersionInput[] = [];
  const auditEvents:
    AuditEvent[] = [];
  const workflowClaims:
    CapaWorkflowIdempotencyRecord[] = [];

  let selectedCase:
    CapaCase | null =
      draftCase();
  let selectedVersion:
    CapaCaseVersion | null =
      draftVersion();
  let selectedResultVersion:
    CapaCaseVersion | null =
      draftVersion({
        case_version_id:
          NEXT_VERSION_ID,
        parent_version_id:
          CURRENT_VERSION_ID,
        version_number: 2,
        status:
          CAPA_STATE.TRIAGE_AND_SCOPE,
      });
  let selectedClaimStatus:
    | "claimed"
    | "already_claimed"
    | "conflict" =
      "claimed";
  let selectedPolicy =
    allowDecision();
  let selectedAdvance:
    AdvanceCapaVersionResult = {
    status: "updated",
    capa_case:
      draftCase({
        current_version_id:
          NEXT_VERSION_ID,
        status:
          CAPA_STATE.TRIAGE_AND_SCOPE,
        record_version: 2,
        updated_at:
          iso("2026-08-22T14:00:00.000Z"),
      }),
  };
  let selectedAudit:
    AppendAuditEventResult = {
    status: "appended",
    event_id:
      AUDIT_EVENT_ID,
  };

  const transactionContext:
    TransactionContext = {
    transaction_id:
      "10000000-0000-4000-8000-000000000013" as
        TransactionId,
    started_at:
      iso("2026-08-22T14:00:00.000Z"),
    request_trace:
      trace(),
  };

  const transactionManager:
    TransactionManager = {
    async runInTransaction(
      requestTrace,
      work,
    ) {
      expect(requestTrace)
        .toEqual(trace());
      return work(
        transactionContext,
      );
    },
  };

  const repository:
    CapaRepository = {
    async listCases() {
      return { cases: [] };
    },
    async findCaseById() {
      order.push("find-case");
      return selectedCase;
    },
    async findCaseVersionById(
      _organizationId,
      _capaCaseId,
      caseVersionId,
    ) {
      order.push("find-version");
      return caseVersionId ===
        NEXT_VERSION_ID
        ? selectedResultVersion
        : selectedVersion;
    },
    async findSectionVersionById() {
      return null;
    },
    async caseNumberExists() {
      return false;
    },
    async insertCase() {
      throw new Error(
        "Unexpected case insert.",
      );
    },
    async insertSectionVersion() {
      throw new Error(
        "Unexpected section insert.",
      );
    },
    async insertCaseVersion(
      transaction,
      version,
    ) {
      expect(transaction)
        .toBe(transactionContext);
      order.push("insert-version");
      insertedVersions.push(version);
    },
    async advanceCurrentVersion(
      transaction,
      input,
    ) {
      expect(transaction)
        .toBe(transactionContext);
      order.push("advance");
      advanceInputs.push(input);
      return selectedAdvance;
    },
  };

  const auditRepository:
    AuditRepository = {
    async appendEvent(
      transaction,
      event,
    ) {
      expect(transaction)
        .toBe(transactionContext);
      order.push("audit");
      auditEvents.push(event);
      return selectedAudit;
    },
    async findEventById() {
      return null;
    },
    async listEventsForAggregate(
      _query: AuditEventQuery,
    ): Promise<AuditEventPage> {
      return { events: [] };
    },
  };

  const dependencies:
    SubmitCapaIntakeDependencies = {
    transaction_manager:
      transactionManager,
    capa_repository:
      repository,
    audit_repository:
      auditRepository,
    workflow_idempotency_repository: {
      async claimWorkflowOperation(
        transaction,
        record,
      ) {
        expect(transaction)
          .toBe(transactionContext);
        order.push("idempotency");
        workflowClaims.push(record);

        if (
          selectedClaimStatus ===
          "conflict"
        ) {
          return {
            status: "conflict",
            record,
            reason_code:
              "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          };
        }

        return {
          status:
            selectedClaimStatus,
          record,
        };
      },
    },
    authorization_policy: {
      async evaluate(request) {
        order.push("policy");
        policyRequests.push(request);
        return selectedPolicy;
      },
    },
    id_generator: {
      generateCapaCaseId() {
        return CAPA_CASE_ID;
      },
      generateCaseVersionId() {
        return NEXT_VERSION_ID;
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
      audit_schema_version:
        "audit-schema-1.0.0",
      authorization_purpose:
        controlled(
          "CAPA_WORKFLOW_TRANSITION",
        ),
    },
  };

  return {
    dependencies,
    order,
    policy_requests:
      policyRequests,
    inserted_versions:
      insertedVersions,
    advance_inputs:
      advanceInputs,
    audit_events:
      auditEvents,
    workflow_claims:
      workflowClaims,
    setCase(value) {
      selectedCase = value;
    },
    setVersion(value) {
      selectedVersion = value;
    },
    setResultVersion(value) {
      selectedResultVersion = value;
    },
    setClaimStatus(value) {
      selectedClaimStatus = value;
    },
    setPolicy(value) {
      selectedPolicy = value;
    },
    setAdvance(value) {
      selectedAdvance = value;
    },
    setAudit(value) {
      selectedAudit = value;
    },
  };
}

describe(
  "submitCapaIntake",
  () => {
    it(
      "denies an inactive session before reading the case",
      async () => {
        const harness =
          createHarness();

        const result =
          await submitCapaIntake(
            harness.dependencies,
            command({
              authentication:
                authentication({
                  expires_at:
                    iso("2026-08-22T14:00:00.000Z"),
                }),
            }),
          );

        expect(result).toMatchObject({
          status:
            "authorization_denied",
          reason_code:
            "SESSION_INACTIVE",
        });
        expect(harness.order)
          .toEqual([]);
      },
    );

    it(
      "returns a tenant-safe result when the case is absent",
      async () => {
        const harness =
          createHarness();
        harness.setCase(null);

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).resolves.toEqual({
          status:
            "not_found_or_not_authorized",
        });
        expect(harness.order)
          .toEqual(["find-case"]);
      },
    );

    it(
      "returns a configured policy denial",
      async () => {
        const harness =
          createHarness();
        harness.setPolicy({
          decision: "deny",
          reason_code:
            controlled("DENIED"),
          policy_version:
            "policy-1.0.0",
          evaluated_at:
            iso("2026-08-22T14:00:00.000Z"),
        });

        const result =
          await submitCapaIntake(
            harness.dependencies,
            command(),
          );

        expect(result).toMatchObject({
          status:
            "authorization_denied",
          reason_code: "DENIED",
        });
        expect(harness.order)
          .toEqual([
            "find-case",
            "find-version",
            "policy",
          ]);
      },
    );

    it(
      "returns a configured step-up decision",
      async () => {
        const harness =
          createHarness();
        harness.setPolicy({
          decision: "step_up",
          reason_code:
            controlled("MFA_REQUIRED"),
          policy_version:
            "policy-1.0.0",
          evaluated_at:
            iso("2026-08-22T14:00:00.000Z"),
          required_assurance:
            controlled("MFA"),
        });

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).resolves.toMatchObject({
          status:
            "step_up_required",
          required_assurance:
            "MFA",
        });
      },
    );

    it(
      "blocks a case outside Draft Intake even if policy is misconfigured to allow it",
      async () => {
        const harness =
          createHarness();
        harness.setCase(
          draftCase({
            status:
              CAPA_STATE.TRIAGE_AND_SCOPE,
          }),
        );

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).resolves.toEqual({
          status:
            "workflow_conflict",
          reason_code:
            "WORKFLOW_STATE_NOT_ALLOWED",
        });
      },
    );

    it.each([
      {
        description:
          "record version",
        caseValue:
          draftCase({
            record_version: 2,
          }),
        reason:
          "RECORD_VERSION_CONFLICT",
      },
      {
        description:
          "current version",
        caseValue:
          draftCase({
            current_version_id:
              NEXT_VERSION_ID,
          }),
        reason:
          "CURRENT_VERSION_CONFLICT",
      },
    ] as const)(
      "returns a controlled $description conflict",
      async ({
        caseValue,
        reason,
      }) => {
        const harness =
          createHarness();
        harness.setCase(caseValue);

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).resolves.toEqual({
          status:
            "concurrency_conflict",
          reason_code: reason,
        });
      },
    );

    it(
      "fails closed when the authoritative current version is missing",
      async () => {
        const harness =
          createHarness();
        harness.setVersion(null);

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).rejects.toBeInstanceOf(
          SubmitCapaIntakeIntegrityError,
        );
      },
    );

    it(
      "creates the immutable S10 version, advances the aggregate and appends its audit event in order",
      async () => {
        const harness =
          createHarness();

        const result =
          await submitCapaIntake(
            harness.dependencies,
            command(),
          );

        expect(result).toMatchObject({
          status: "submitted",
          capa_case: {
            status: "S10",
            record_version: 2,
          },
          case_version: {
            case_version_id:
              NEXT_VERSION_ID,
            parent_version_id:
              CURRENT_VERSION_ID,
            version_number: 2,
            status: "S10",
            section_version_ids: [
              SECTION_VERSION_ID,
            ],
          },
          audit_event_id:
            AUDIT_EVENT_ID,
        });

        expect(harness.order)
          .toEqual([
            "find-case",
            "find-version",
            "policy",
            "idempotency",
            "insert-version",
            "advance",
            "audit",
          ]);

        expect(
          harness.advance_inputs[0],
        ).toMatchObject({
          expected_record_version: 1,
          expected_current_version_id:
            CURRENT_VERSION_ID,
          next_current_version_id:
            NEXT_VERSION_ID,
          next_status: "S10",
        });

        expect(
          harness.audit_events[0],
        ).toMatchObject({
          event_type:
            "EVT-CASE-STATE-CHANGED",
          action:
            "SUBMIT_CAPA_INTAKE",
          aggregate_version: 2,
          change: {
            before_ref: {
              object_version_id:
                CURRENT_VERSION_ID,
            },
            after_ref: {
              object_version_id:
                NEXT_VERSION_ID,
            },
          },
          metadata: {
            from_state: "S00",
            to_state: "S10",
            relied_on_role_assignment_ids: [
              ROLE_ASSIGNMENT_ID,
            ],
          },
        });

        expect(
          harness.policy_requests[0],
        ).toMatchObject({
          operation:
            "submit_intake",
          purpose:
            "CAPA_WORKFLOW_TRANSITION",
          resource: {
            capa_case_id:
              CAPA_CASE_ID,
            case_version_id:
              CURRENT_VERSION_ID,
            workflow_state: "S00",
          },
        });
      },
    );

    it(
      "returns a controlled conflict when the aggregate changes inside the transaction",
      async () => {
        const harness =
          createHarness();
        harness.setAdvance({
          status: "conflict",
          reason_code:
            "RECORD_VERSION_CONFLICT",
        });

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).resolves.toEqual({
          status:
            "concurrency_conflict",
          reason_code:
            "RECORD_VERSION_CONFLICT",
        });

        expect(harness.audit_events)
          .toHaveLength(0);
      },
    );

    it(
      "returns the authoritative transition for an exact retry without writing again",
      async () => {
        const harness =
          createHarness();

        harness.setCase(
          draftCase({
            current_version_id:
              NEXT_VERSION_ID,
            status:
              CAPA_STATE.TRIAGE_AND_SCOPE,
            record_version: 2,
          }),
        );
        harness.setClaimStatus(
          "already_claimed",
        );

        const result =
          await submitCapaIntake(
            harness.dependencies,
            command(),
          );

        expect(result).toMatchObject({
          status:
            "already_submitted",
          capa_case: {
            current_version_id:
              NEXT_VERSION_ID,
            status: "S10",
          },
          case_version: {
            case_version_id:
              NEXT_VERSION_ID,
            parent_version_id:
              CURRENT_VERSION_ID,
            status: "S10",
          },
          audit_event_id:
            AUDIT_EVENT_ID,
        });
        expect(harness.inserted_versions)
          .toHaveLength(0);
        expect(harness.advance_inputs)
          .toHaveLength(0);
        expect(harness.audit_events)
          .toHaveLength(0);
      },
    );

    it(
      "returns a controlled conflict when the workflow key is reused for different content",
      async () => {
        const harness =
          createHarness();

        harness.setClaimStatus(
          "conflict",
        );

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).resolves.toEqual({
          status:
            "idempotency_conflict",
          reason_code:
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        });
        expect(harness.inserted_versions)
          .toHaveLength(0);
        expect(harness.advance_inputs)
          .toHaveLength(0);
        expect(harness.audit_events)
          .toHaveLength(0);
      },
    );

    it(
      "claims the workflow key before material transition writes",
      async () => {
        const harness =
          createHarness();

        await submitCapaIntake(
          harness.dependencies,
          command(),
        );

        expect(harness.order.indexOf(
          "idempotency",
        )).toBeLessThan(
          harness.order.indexOf(
            "insert-version",
          ),
        );
        expect(
          harness.workflow_claims[0],
        ).toMatchObject({
          organization_id:
            ORGANIZATION_ID,
          idempotency_key:
            "submit-intake-1",
          operation_code:
            "SUBMIT_CAPA_INTAKE",
          capa_case_id:
            CAPA_CASE_ID,
          source_case_version_id:
            CURRENT_VERSION_ID,
          resulting_case_version_id:
            NEXT_VERSION_ID,
          audit_event_id:
            AUDIT_EVENT_ID,
          request_fingerprint:
            expect.stringMatching(
              /^[0-9a-f]{64}$/,
            ),
        });
      },
    );

    it(
      "fails closed when an exact retry cannot resolve its resulting version",
      async () => {
        const harness =
          createHarness();

        harness.setCase(
          draftCase({
            current_version_id:
              NEXT_VERSION_ID,
            status:
              CAPA_STATE.TRIAGE_AND_SCOPE,
            record_version: 2,
          }),
        );
        harness.setClaimStatus(
          "already_claimed",
        );
        harness.setResultVersion(null);

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).rejects.toThrow(
          "The authoritative CAPA intake-submission retry record is incomplete.",
        );
      },
    );

    it(
      "fails closed when the audit-event identity conflicts",
      async () => {
        const harness =
          createHarness();
        harness.setAudit({
          status: "conflict",
          event_id:
            AUDIT_EVENT_ID,
          reason_code:
            "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
        });

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command(),
          ),
        ).rejects.toBeInstanceOf(
          AuditEventAppendConflictError,
        );
      },
    );
    it.each([
      {
        description: "missing",
        value: undefined,
      },
      {
        description: "empty",
        value: "",
      },
      {
        description: "too long",
        value: "x".repeat(129),
      },
      {
        description:
          "surrounded by whitespace",
        value: " submit-intake-1 ",
      },
    ])(
      "rejects a $description workflow idempotency key before claiming",
      async ({ value }) => {
        const harness =
          createHarness();

        await expect(
          submitCapaIntake(
            harness.dependencies,
            command({
              request_trace: {
                ...trace(),
                idempotency_key:
                  value as RequestTrace["idempotency_key"],
              },
            }),
          ),
        ).rejects.toBeInstanceOf(
          SubmitCapaIntakeIdempotencyConfigurationError,
        );

        expect(harness.workflow_claims)
          .toHaveLength(0);
      },
    );

    it(
      "provides stable named workflow-idempotency application errors",
      () => {
        const configurationError =
          new SubmitCapaIntakeIdempotencyConfigurationError();
        const replayError =
          new SubmitCapaIntakeReplayIntegrityError();

        expect(configurationError).toMatchObject({
          name:
            "SubmitCapaIntakeIdempotencyConfigurationError",
          message:
            "CAPA intake submission requires a valid idempotency key.",
        });
        expect(replayError).toMatchObject({
          name:
            "SubmitCapaIntakeReplayIntegrityError",
          message:
            "The authoritative CAPA intake-submission retry record is incomplete.",
        });
      },
    );

  },
);