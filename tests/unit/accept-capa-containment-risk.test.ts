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
  CAPA_STATE,
} from "../../lib/capa/domain/capa-state";

import {
  CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,
  CAPA_CONTAINMENT_RISK_SECTION_TYPE,
} from "../../lib/capa/domain/capa-containment-risk";

import type {
  CapaPolicyDecision,
  CapaPolicyEvaluationRequest,
} from "../../lib/capa/authorization/capa-policy";

import type {
  CapaAuthorizationPolicy,
} from "../../lib/capa/authorization/capa-policy";

import type {
  AuthenticationContext,
  ServiceIdentityId,
  SessionId,
} from "../../lib/security/auth-context";

import type {
  TenantAccessGrantId,
  TenantContext,
} from "../../lib/security/tenant-context";

import type {
  AdvanceCapaVersionInput,
  AdvanceCapaVersionResult,
  CapaCaseListPage,
  CapaCaseListQuery,
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
  CapaWorkflowIdempotencyRepository,
  ClaimCapaWorkflowOperationResult,
} from "../../lib/database/repositories/capa-workflow-idempotency-repository";

import type {
  TransactionContext,
  TransactionId,
  TransactionManager,
} from "../../lib/database/transactions";

import type {
  CreateCapaIdGenerator,
} from "../../lib/capa/application/create-capa";

import {
  CAPA_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMATION,
  AcceptCapaContainmentRiskReplayIntegrityError,
  acceptCapaContainmentRisk,
  type AcceptCapaContainmentRiskCommand,
  type AcceptCapaContainmentRiskDependencies,
} from "../../lib/capa/application/accept-capa-containment-risk";

const NOW =
  new Date(
    "2026-08-29T12:00:00.000Z",
  );

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as
    OrganizationId;

const USER_ID =
  "10000000-0000-4000-8000-000000000002" as
    UserId;

const CAPA_CASE_ID =
  "10000000-0000-4000-8000-000000000003" as
    CapaCaseId;

const SOURCE_VERSION_ID =
  "10000000-0000-4000-8000-000000000004" as
    CapaCaseVersionId;

const INTAKE_SECTION_ID =
  "10000000-0000-4000-8000-000000000005" as
    CapaSectionVersionId;

function controlled(
  value:
    string,
): ControlledCode {
  return value as
    ControlledCode;
}

function iso(
  value:
    string,
): IsoDateTime {
  return value as
    IsoDateTime;
}

function generatedUuid(
  sequence:
    number,
): string {
  return `00000000-0000-4000-8000-${String(
    sequence,
  ).padStart(
    12,
    "0",
  )}`;
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
      "10000000-0000-4000-8000-000000000006" as
        SessionId,

    authentication_method:
      controlled(
        "SUPABASE_SESSION",
      ),

    assurance_level:
      controlled(
        "MFA",
      ),

    authenticated_at:
      iso(
        "2026-08-29T11:00:00.000Z",
      ),

    reauthenticated_at:
      iso(
        "2026-08-29T11:55:00.000Z",
      ),

    expires_at:
      iso(
        "2026-08-29T13:00:00.000Z",
      ),
  };
}

function serviceAuthentication():
  AuthenticationContext {
  return {
    principal: {
      principal_type:
        "service",

      service_identity_id:
        "10000000-0000-4000-8000-000000000099" as
          ServiceIdentityId,
    },

    session_id:
      "10000000-0000-4000-8000-000000000098" as
        SessionId,

    authentication_method:
      controlled(
        "SERVICE_IDENTITY",
      ),

    assurance_level:
      controlled(
        "SERVICE",
      ),

    authenticated_at:
      iso(
        "2026-08-29T11:00:00.000Z",
      ),

    reauthenticated_at:
      iso(
        "2026-08-29T11:55:00.000Z",
      ),

    expires_at:
      iso(
        "2026-08-29T13:00:00.000Z",
      ),
  };
}

function tenant():
  TenantContext {
  return {
    organization_id:
      ORGANIZATION_ID,

    access_grant_id:
      "10000000-0000-4000-8000-000000000007" as
        TenantAccessGrantId,

    access_path:
      controlled(
        "SUPABASE_MEMBERSHIP",
      ),

    authorization_policy_version:
      "policy-1.0.0",

    resolved_at:
      iso(
        "2026-08-29T11:59:00.000Z",
      ),

    role_assignments:
      [],
  };
}

function trace():
  RequestTrace {
  return {
    request_id:
      "10000000-0000-4000-8000-000000000008" as
        RequestId,

    correlation_id:
      "10000000-0000-4000-8000-000000000009" as
        CorrelationId,

    idempotency_key:
      "accept-containment-risk-1" as
        RequestTrace[
          "idempotency_key"
        ],
  };
}

function validContainmentRisk() {
  return {
    actions: [{
      action_id: "containment-001",
      action_type: "containment",
      description: "Place affected inventory on controlled hold.",
      owner_user_id: USER_ID,
      action_date: "2026-08-28",
      target_date: "2026-08-30",
      completed_date: null,
      status: "in_progress",
      rationale: "Prevent unintended use during investigation.",
      supporting_evidence_references: ["hold-001"],
    }],
    impact_scope: {
      products: ["Device family A"],
      processes: ["Machining operation 40"],
      data: [],
      customers: [],
      patients: [],
    },
    risk_evaluation: {
      method: "QP-17",
      terminology_version: "revision-6",
      result: "Controlled pending investigation",
      rationale: "Immediate controls reduce exposure while investigation proceeds.",
    },
    missing_risk_information: [],
    escalations: [{
      process: "Regulatory assessment",
      reference: "RA-2026-001",
      status: "resolved",
      rationale: "Separate assessment completed.",
    }],
  };
}
function validBody() {
  return {
    containment_risk:
      validContainmentRisk(),

    approval: {
      decision:
        "approve",

      confirmation:
        CAPA_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMATION,

      rationale:
        "Reviewed the problem definition, boundaries, source, applicability, extent, priority, target date, and resolved escalations.",
    },
  };
}

function command(
  overrides:
    Partial<AcceptCapaContainmentRiskCommand> = {},
): AcceptCapaContainmentRiskCommand {
  return {
    authentication:
      authentication(),

    tenant:
      tenant(),

    capa_case_id:
      CAPA_CASE_ID,

    expected_record_version:
      2,

    expected_current_version_id:
      SOURCE_VERSION_ID,

    request_trace:
      trace(),

    body:
      validBody(),

    ...overrides,
  };
}

function sourceCase():
  CapaCase {
  const actor = {
    actor_type:
      "human" as const,

    actor_id:
      USER_ID,
  };

  return {
    organization_id:
      ORGANIZATION_ID,

    capa_case_id:
      CAPA_CASE_ID,

    case_number:
      "CAPA-000009",

    current_version_id:
      SOURCE_VERSION_ID,

    status:
      CAPA_STATE
        .CONTAINMENT_AND_IMPACT_RISK,

    owner_user_id:
      USER_ID,

    confidentiality:
      controlled(
        "CUSTOMER_CONFIDENTIAL",
      ),

    effective_at:
      iso(
        "2026-08-29T11:00:00.000Z",
      ),

    record_version:
      2,

    created_at:
      iso(
        "2026-08-29T10:00:00.000Z",
      ),

    created_by:
      actor,

    updated_at:
      iso(
        "2026-08-29T11:00:00.000Z",
      ),

    updated_by:
      actor,
  };
}

function sourceVersion():
  CapaCaseVersion {
  return {
    organization_id:
      ORGANIZATION_ID,

    case_version_id:
      SOURCE_VERSION_ID,

    capa_case_id:
      CAPA_CASE_ID,

    version_number:
      2,

    change_reason:
      "Submit CAPA intake for triage and scope",

    status:
      CAPA_STATE
        .CONTAINMENT_AND_IMPACT_RISK,

    section_version_ids: [
      INTAKE_SECTION_ID,
    ],

    effective_at:
      iso(
        "2026-08-29T11:00:00.000Z",
      ),

    created_at:
      iso(
        "2026-08-29T11:00:00.000Z",
      ),

    created_by: {
      actor_type:
        "human",

      actor_id:
        USER_ID,
    },
  };
}

function intakeSection():
  CapaSectionVersion {
  return {
    organization_id:
      ORGANIZATION_ID,

    section_version_id:
      INTAKE_SECTION_ID,

    capa_case_id:
      CAPA_CASE_ID,

    section_type:
      controlled(
        "CAPA.INTAKE",
      ),

    version_number:
      1,

    schema_version:
      "intake-schema-1.0.0",

    content: {
      initiating_event:
        "NCR-2026-0042",

      source:
        "Nonconformance",

      organization_reference:
        "NCR-2026-0042",
    },

    change_reason:
      "Initial CAPA draft intake",

    effective_at:
      iso(
        "2026-08-29T10:00:00.000Z",
      ),

    created_at:
      iso(
        "2026-08-29T10:00:00.000Z",
      ),

    created_by: {
      actor_type:
        "human",

      actor_id:
        USER_ID,
    },
  };
}

class TestTransactionManager
  implements TransactionManager {
  calls = 0;

  async runInTransaction<Result>(
    requestTrace:
      RequestTrace,

    work:
      (
        transaction:
          TransactionContext,
      ) => Promise<Result>,
  ): Promise<Result> {
    this.calls += 1;

    return work({
      transaction_id:
        generatedUuid(
          900 + this.calls,
        ) as TransactionId,

      started_at:
        iso(
          NOW.toISOString(),
        ),

      request_trace:
        requestTrace,
    });
  }
}

class TestCapaRepository
  implements CapaRepository {
  caseValue:
    CapaCase;

  readonly caseVersions =
    new Map<
      string,
      CapaCaseVersion
    >();

  readonly sectionVersions =
    new Map<
      string,
      CapaSectionVersion
    >();

  findCaseCalls = 0;

  insertedSections:
    CapaSectionVersion[] = [];

  insertedVersions:
    CapaCaseVersion[] = [];

  constructor() {
    this.caseValue =
      sourceCase();

    const version =
      sourceVersion();

    const intake =
      intakeSection();

    this.caseVersions.set(
      version.case_version_id,
      version,
    );

    this.sectionVersions.set(
      intake.section_version_id,
      intake,
    );
  }

  async listCases(
    _query:
      CapaCaseListQuery,
  ): Promise<CapaCaseListPage> {
    return {
      cases: [
        this.caseValue,
      ],
    };
  }

  async findCaseById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,
  ): Promise<CapaCase | null> {
    this.findCaseCalls += 1;

    return (
      organizationId ===
        ORGANIZATION_ID &&
      capaCaseId ===
        CAPA_CASE_ID
    )
      ? this.caseValue
      : null;
  }

  async findCaseVersionById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,

    caseVersionId:
      CapaCaseVersionId,
  ): Promise<CapaCaseVersion | null> {
    if (
      organizationId !==
        ORGANIZATION_ID ||
      capaCaseId !==
        CAPA_CASE_ID
    ) {
      return null;
    }

    return (
      this.caseVersions.get(
        caseVersionId,
      ) ?? null
    );
  }

  async findSectionVersionById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,

    sectionVersionId:
      CapaSectionVersionId,
  ): Promise<CapaSectionVersion | null> {
    if (
      organizationId !==
        ORGANIZATION_ID ||
      capaCaseId !==
        CAPA_CASE_ID
    ) {
      return null;
    }

    return (
      this.sectionVersions.get(
        sectionVersionId,
      ) ?? null
    );
  }

  async caseNumberExists():
    Promise<boolean> {
    return false;
  }

  async insertCase():
    Promise<void> {
    throw new Error(
      "insertCase must not execute during G-02.",
    );
  }

  async insertSectionVersion(
    _transaction:
      TransactionContext,

    sectionVersion:
      CapaSectionVersion,
  ): Promise<void> {
    this.insertedSections.push(
      sectionVersion,
    );

    this.sectionVersions.set(
      sectionVersion
        .section_version_id,
      sectionVersion,
    );
  }

  async insertCaseVersion(
    _transaction:
      TransactionContext,

    caseVersion:
      CapaCaseVersion,
  ): Promise<void> {
    this.insertedVersions.push(
      caseVersion,
    );

    this.caseVersions.set(
      caseVersion
        .case_version_id,
      caseVersion,
    );
  }

  async advanceCurrentVersion(
    _transaction:
      TransactionContext,

    input:
      AdvanceCapaVersionInput,
  ): Promise<AdvanceCapaVersionResult> {
    if (
      input.organization_id !==
        ORGANIZATION_ID ||
      input.capa_case_id !==
        CAPA_CASE_ID
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }

    if (
      this.caseValue
        .record_version !==
      input.expected_record_version
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "RECORD_VERSION_CONFLICT",
      };
    }

    if (
      this.caseValue
        .current_version_id !==
      input
        .expected_current_version_id
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "CURRENT_VERSION_CONFLICT",
      };
    }

    const next =
      this.caseVersions.get(
        input
          .next_current_version_id,
      );

    if (
      next === undefined ||
      next.capa_case_id !==
        CAPA_CASE_ID ||
      next.status !==
        input.next_status
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }

    this.caseValue = {
      ...this.caseValue,

      current_version_id:
        input
          .next_current_version_id,

      status:
        input.next_status,

      record_version:
        this.caseValue
          .record_version + 1,

      updated_at:
        input.updated_at,

      updated_by:
        input.updated_by,
    };

    return {
      status:
        "updated",

      capa_case:
        this.caseValue,
    };
  }
}

class TestAuditRepository
  implements AuditRepository {
  readonly events =
    new Map<
      string,
      AuditEvent
    >();

  async appendEvent(
    _transaction:
      TransactionContext,

    event:
      AuditEvent,
  ): Promise<AppendAuditEventResult> {
    if (
      this.events.has(
        event.event_id,
      )
    ) {
      return {
        status:
          "conflict",

        event_id:
          event.event_id,

        reason_code:
          "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
      };
    }

    this.events.set(
      event.event_id,
      event,
    );

    return {
      status:
        "appended",

      event_id:
        event.event_id,
    };
  }

  async findEventById(
    organizationId:
      OrganizationId,

    eventId:
      AuditEventId,
  ): Promise<AuditEvent | null> {
    const event =
      this.events.get(
        eventId,
      );

    if (
      event === undefined ||
      event.organization_id !==
        organizationId
    ) {
      return null;
    }

    return event;
  }

  async listEventsForAggregate(
    query:
      AuditEventQuery,
  ): Promise<AuditEventPage> {
    return {
      events:
        [...this.events.values()]
          .filter(
            (event) =>
              event.organization_id ===
                query.organization_id &&
              event.aggregate_type ===
                query.aggregate_type &&
              event.aggregate_id ===
                query.aggregate_id,
          )
          .slice(
            0,
            query.limit,
          ),
    };
  }
}

class TestWorkflowIdempotencyRepository
  implements CapaWorkflowIdempotencyRepository {
  readonly records =
    new Map<
      string,
      CapaWorkflowIdempotencyRecord
    >();

  async claimWorkflowOperation(
    _transaction:
      TransactionContext,

    record:
      CapaWorkflowIdempotencyRecord,
  ): Promise<ClaimCapaWorkflowOperationResult> {
    const key =
      `${record.organization_id}:${record.idempotency_key}`;

    const existing =
      this.records.get(key);

    if (
      existing === undefined
    ) {
      this.records.set(
        key,
        record,
      );

      return {
        status:
          "claimed",

        record,
      };
    }

    if (
      existing.operation_code ===
        record.operation_code &&
      existing.request_fingerprint ===
        record.request_fingerprint
    ) {
      return {
        status:
          "already_claimed",

        record:
          existing,
      };
    }

    return {
      status:
        "conflict",

      record:
        existing,

      reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    };
  }
}

class AllowPolicy
  implements CapaAuthorizationPolicy {
  readonly requests:
    CapaPolicyEvaluationRequest[] = [];

  async evaluate(
    request:
      CapaPolicyEvaluationRequest,
  ): Promise<CapaPolicyDecision> {
    this.requests.push(
      request,
    );

    return {
      decision:
        "allow",

      reason_code:
        controlled(
          "TEST_SCOPE_APPROVAL_ALLOWED",
        ),

      policy_version:
        "policy-1.0.0",

      evaluated_at:
        iso(
          request.trusted_now
            .toISOString(),
        ),

      relied_on_role_assignment_ids:
        [],
    };
  }
}

class TestIdGenerator
  implements CreateCapaIdGenerator {
  private caseVersionSequence =
    100;

  private sectionSequence =
    200;

  private auditSequence =
    300;

  generateCapaCaseId():
    CapaCaseId {
    return generatedUuid(
      999,
    ) as CapaCaseId;
  }

  generateCaseVersionId():
    CapaCaseVersionId {
    this.caseVersionSequence +=
      1;

    return generatedUuid(
      this.caseVersionSequence,
    ) as CapaCaseVersionId;
  }

  generateSectionVersionId():
    CapaSectionVersionId {
    this.sectionSequence +=
      1;

    return generatedUuid(
      this.sectionSequence,
    ) as CapaSectionVersionId;
  }

  generateAuditEventId():
    AuditEventId {
    this.auditSequence +=
      1;

    return generatedUuid(
      this.auditSequence,
    ) as AuditEventId;
  }
}

interface Fixture {
  readonly transactionManager:
    TestTransactionManager;

  readonly repository:
    TestCapaRepository;

  readonly auditRepository:
    TestAuditRepository;

  readonly idempotencyRepository:
    TestWorkflowIdempotencyRepository;

  readonly policy:
    AllowPolicy;

  readonly dependencies:
    AcceptCapaContainmentRiskDependencies;
}

function fixture():
  Fixture {
  const transactionManager =
    new TestTransactionManager();

  const repository =
    new TestCapaRepository();

  const auditRepository =
    new TestAuditRepository();

  const idempotencyRepository =
    new TestWorkflowIdempotencyRepository();

  const policy =
    new AllowPolicy();

  return {
    transactionManager,
    repository,
    auditRepository,
    idempotencyRepository,
    policy,

    dependencies: {
      transaction_manager:
        transactionManager,

      capa_repository:
        repository,

      audit_repository:
        auditRepository,

      workflow_idempotency_repository:
        idempotencyRepository,

      authorization_policy:
        policy,

      id_generator:
        new TestIdGenerator(),

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

        step_up_maximum_age_ms:
          15 * 60 * 1000,

        required_step_up_assurance:
          controlled(
            "MFA",
          ),

        approval_rationale_required:
          true,
      },
    },
  };
}

describe(
  "G-02 CAPA containment/risk acceptance",
  () => {
    it(
      "persists immutable containment/risk, advances S20 to S30, and records decision plus transition audits",
      async () => {
        const test =
          fixture();

        const result =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command(),
          );

        expect(
          result.status,
        ).toBe("approved");

        if (
          result.status !==
          "approved"
        ) {
          return;
        }

        expect(
          result.capa_case.status,
        ).toBe(
          CAPA_STATE
            .INVESTIGATION_PLANNING,
        );

        expect(
          result.capa_case
            .record_version,
        ).toBe(3);

        expect(
          result.case_version,
        ).toMatchObject({
          version_number:
            3,

          parent_version_id:
            SOURCE_VERSION_ID,

          status:
            CAPA_STATE
              .INVESTIGATION_PLANNING,
        });

        expect(
          result
            .containment_risk_section_version
            .section_type,
        ).toBe(
          CAPA_CONTAINMENT_RISK_SECTION_TYPE,
        );

        expect(
          result
            .containment_risk_section_version
            .schema_version,
        ).toBe(
          CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,
        );

        expect(
          result.case_version
            .section_version_ids,
        ).toEqual([
          INTAKE_SECTION_ID,

          result
            .containment_risk_section_version
            .section_version_id,
        ]);

        const events =
          [...test.auditRepository
            .events.values()];

        expect(events)
          .toHaveLength(2);

        expect(
          events.map(
            (event) =>
              event.event_type,
          ),
        ).toEqual([
          "EVT-APPROVAL",
          "EVT-STATE-TRANSITION",
        ]);

        const approval =
          events[0];

        const transition =
          events[1];

        expect(
          approval?.metadata,
        ).toMatchObject({
          gate:
            "G-02",

          decision:
            "approved",

          from_state:
            "S20",

          to_state:
            "S30",

          containment_risk_section_version_id:
            result
              .containment_risk_section_version
              .section_version_id,

          state_transition_event_id:
            result
              .transition_audit_event_id,
        });

        expect(
          transition?.metadata,
        ).toMatchObject({
          gate:
            "G-02",

          transition_event:
            "Accept containment and risk",

          from_state:
            "S20",

          to_state:
            "S30",

          approval_event_id:
            result
              .approval_audit_event_id,
        });

        expect(
          test.policy.requests,
        ).toHaveLength(1);

        expect(
          test.policy.requests[0],
        ).toMatchObject({
          operation:
            "accept_containment_risk",

          purpose:
            "CAPA_GATE_DECISION",

          resource: {
            workflow_state:
              "S20",
          },
        });
      },
    );

    it(
      "does not disclose G-02 blocker facts before fine-grained authorization",
      async () => {
        const test =
          fixture();

        let policyCalls = 0;

        const denyPolicy:
          CapaAuthorizationPolicy = {
          async evaluate(
            request:
              CapaPolicyEvaluationRequest,
          ): Promise<CapaPolicyDecision> {
            policyCalls += 1;

            return {
              decision:
                "deny",

              reason_code:
                controlled(
                  "TEST_SCOPE_APPROVAL_DENIED",
                ),

              policy_version:
                "policy-1.0.0",

              evaluated_at:
                iso(
                  request.trusted_now
                    .toISOString(),
                ),
            };
          },
        };

        const body =
          validBody();

        const result =
          await acceptCapaContainmentRisk(
            {
              ...test.dependencies,

              authorization_policy:
                denyPolicy,
            },
            command({
              body: {
                ...body,

                containment_risk: {
                  ...body.containment_risk,

                  missing_risk_information: [
                    "Protected unresolved supplier scope.",
                  ],
                },
              },
            }),
          );

        expect(result).toEqual({
          status:
            "authorization_denied",

          reason_code:
            "TEST_SCOPE_APPROVAL_DENIED",

          policy_version:
            "policy-1.0.0",
        });

        expect(policyCalls)
          .toBe(1);

        expect(
          test.transactionManager
            .calls,
        ).toBe(0);

        expect(
          test.repository
            .insertedSections,
        ).toHaveLength(0);

        expect(
          test.auditRepository
            .events.size,
        ).toBe(0);
      },
    );

    it(
      "does not enforce caller source-version coordinates before fine-grained authorization",
      async () => {
        const test =
          fixture();

        let policyCalls = 0;

        const denyPolicy:
          CapaAuthorizationPolicy = {
          async evaluate(
            request:
              CapaPolicyEvaluationRequest,
          ): Promise<CapaPolicyDecision> {
            policyCalls += 1;

            return {
              decision:
                "deny",

              reason_code:
                controlled(
                  "TEST_SCOPE_APPROVAL_DENIED",
                ),

              policy_version:
                "policy-1.0.0",

              evaluated_at:
                iso(
                  request.trusted_now
                    .toISOString(),
                ),
            };
          },
        };

        const result =
          await acceptCapaContainmentRisk(
            {
              ...test.dependencies,

              authorization_policy:
                denyPolicy,
            },
            command({
              expected_record_version:
                999,
            }),
          );

        expect(result).toEqual({
          status:
            "authorization_denied",

          reason_code:
            "TEST_SCOPE_APPROVAL_DENIED",

          policy_version:
            "policy-1.0.0",
        });

        expect(policyCalls)
          .toBe(1);

        expect(
          test.transactionManager
            .calls,
        ).toBe(0);
      },
    );

    it(
      "blocks G-02 before persistence when deterministic prerequisites are unresolved",
      async () => {
        const test =
          fixture();

        const body =
          validBody();

        const result =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command({
              body: {
                ...body,

                containment_risk: {
                  ...body.containment_risk,

                  missing_risk_information: [
                    "Potential supplier scope remains unresolved.",
                  ],
                },
              },
            }),
          );

        expect(result).toEqual({
          status:
            "gate_blocked",

          blocker_codes: [
            "UNRESOLVED_RISK_INFORMATION",
          ],
        });

        expect(
          test.transactionManager
            .calls,
        ).toBe(0);

        expect(
          test.repository
            .insertedSections,
        ).toHaveLength(0);

        expect(
          test.auditRepository
            .events.size,
        ).toBe(0);
      },
    );

    it(
      "requires explicit human G-02 confirmation",
      async () => {
        const test =
          fixture();

        const body =
          validBody();

        const result =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command({
              body: {
                ...body,

                approval: {
                  ...body.approval,

                  confirmation:
                    "not-confirmed",
                },
              },
            }),
          );

        expect(result).toEqual({
          status:
            "validation_failed",

          reason_code:
            "INVALID_APPROVAL_CONFIRMATION",
        });

        expect(
          test.transactionManager
            .calls,
        ).toBe(0);
      },
    );

    it(
      "rejects a service principal before CAPA record lookup",
      async () => {
        const test =
          fixture();

        const result =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command({
              authentication:
                serviceAuthentication(),
            }),
          );

        expect(
          result.status,
        ).toBe(
          "authorization_denied",
        );

        if (
          result.status ===
          "authorization_denied"
        ) {
          expect(
            result.reason_code,
          ).toBe(
            "AUTHORIZED_HUMAN_REQUIRED",
          );
        }

        expect(
          test.repository
            .findCaseCalls,
        ).toBe(0);
      },
    );

    it(
      "requires recent step-up reauthentication before CAPA record lookup",
      async () => {
        const test =
          fixture();

        const auth =
          authentication();

        const result =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command({
              authentication: {
                ...auth,

                reauthenticated_at:
                  undefined,
              },
            }),
          );

        expect(
          result.status,
        ).toBe(
          "step_up_required",
        );

        if (
          result.status ===
          "step_up_required"
        ) {
          expect(
            result.reason_code,
          ).toBe(
            "STEP_UP_REAUTHENTICATION_REQUIRED",
          );

          expect(
            result.required_assurance,
          ).toBe("MFA");
        }

        expect(
          test.repository
            .findCaseCalls,
        ).toBe(0);
      },
    );

    it(
      "replays the exact committed G-02 operation without duplicate business or audit writes",
      async () => {
        const test =
          fixture();

        const first =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command(),
          );

        expect(
          first.status,
        ).toBe("approved");

        const second =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command(),
          );

        expect(
          second.status,
        ).toBe(
          "already_approved",
        );

        expect(
          test.auditRepository
            .events.size,
        ).toBe(2);

        expect(
          test.repository
            .insertedSections,
        ).toHaveLength(1);

        expect(
          test.repository
            .insertedVersions,
        ).toHaveLength(1);

        expect(
          test.repository
            .caseValue
            .record_version,
        ).toBe(3);

        if (
          first.status ===
            "approved" &&
          second.status ===
            "already_approved"
        ) {
          expect(
            second
              .approval_audit_event_id,
          ).toBe(
            first
              .approval_audit_event_id,
          );

          expect(
            second
              .transition_audit_event_id,
          ).toBe(
            first
              .transition_audit_event_id,
          );
        }
      },
    );

    it(
      "fails closed when the same idempotency key is reused with different approval content",
      async () => {
        const test =
          fixture();

        const first =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command(),
          );

        expect(
          first.status,
        ).toBe("approved");

        const body =
          validBody();

        const second =
          await acceptCapaContainmentRisk(
            test.dependencies,
            command({
              body: {
                ...body,

                approval: {
                  ...body.approval,

                  rationale:
                    "A different decision rationale.",
                },
              },
            }),
          );

        expect(second).toEqual({
          status:
            "idempotency_conflict",

          reason_code:
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        });

        expect(
          test.auditRepository
            .events.size,
        ).toBe(2);
      },
    );

    it("requires a human rationale under the pilot configuration", async () => {
      const test = fixture();
      const body = validBody();
      const result = await acceptCapaContainmentRisk(
        test.dependencies,
        command({ body: { ...body, approval: { ...body.approval, rationale: null } } }),
      );
      expect(result).toEqual({
        status: "validation_failed",
        reason_code: "APPROVAL_RATIONALE_REQUIRED",
      });
      expect(test.repository.findCaseCalls).toBe(0);
    });

    it("returns a controlled stale record-version conflict after authorization", async () => {
      const test = fixture();
      const result = await acceptCapaContainmentRisk(
        test.dependencies,
        command({ expected_record_version: 1 }),
      );
      expect(result).toEqual({
        status: "concurrency_conflict",
        reason_code: "RECORD_VERSION_CONFLICT",
      });
      expect(test.policy.requests).toHaveLength(1);
      expect(test.transactionManager.calls).toBe(0);
    });

    it("returns a controlled stale current-version conflict atomically", async () => {
      const test = fixture();
      test.repository.caseValue = {
        ...test.repository.caseValue,
        current_version_id: generatedUuid(777) as CapaCaseVersionId,
      };
      const result = await acceptCapaContainmentRisk(test.dependencies, command());
      expect(result).toEqual({
        status: "concurrency_conflict",
        reason_code: "CURRENT_VERSION_CONFLICT",
      });
      expect(test.auditRepository.events).toHaveLength(0);
    });

    it("fails closed across tenant boundaries", async () => {
      const test = fixture();
      const otherTenant = {
        ...tenant(),
        organization_id: generatedUuid(778) as OrganizationId,
      };
      const result = await acceptCapaContainmentRisk(
        test.dependencies,
        command({ tenant: otherTenant }),
      );
      expect(result.status).toBe("not_found_or_not_authorized");
      expect(test.repository.findCaseCalls).toBe(1);
    });

    it("propagates section persistence failure before aggregate or audit writes", async () => {
      const test = fixture();
      test.repository.insertSectionVersion = async () => {
        throw new Error("section persistence failed");
      };
      await expect(
        acceptCapaContainmentRisk(test.dependencies, command()),
      ).rejects.toThrow("section persistence failed");
      expect(test.repository.insertedVersions).toHaveLength(0);
      expect(test.auditRepository.events).toHaveLength(0);
    });

    it("propagates aggregate advancement failure before audit writes", async () => {
      const test = fixture();
      test.repository.advanceCurrentVersion = async () => {
        throw new Error("aggregate advancement failed");
      };
      await expect(
        acceptCapaContainmentRisk(test.dependencies, command()),
      ).rejects.toThrow("aggregate advancement failed");
      expect(test.auditRepository.events).toHaveLength(0);
    });

    it.each([1, 2])("fails closed when audit append %i fails", async (failureCall) => {
      const test = fixture();
      let calls = 0;
      test.auditRepository.appendEvent = async (_transaction, event) => {
        calls += 1;
        if (calls === failureCall) {
          return {
            status: "conflict",
            event_id: event.event_id,
            reason_code: "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
          };
        }
        test.auditRepository.events.set(event.event_id, event);
        return { status: "appended", event_id: event.event_id };
      };
      await expect(
        acceptCapaContainmentRisk(test.dependencies, command()),
      ).rejects.toThrow();
    });

    it("fails closed when an exact replay is incomplete", async () => {
      const test = fixture();
      const first = await acceptCapaContainmentRisk(test.dependencies, command());
      expect(first.status).toBe("approved");
      test.auditRepository.events.clear();
      await expect(
        acceptCapaContainmentRisk(test.dependencies, command()),
      ).rejects.toBeInstanceOf(AcceptCapaContainmentRiskReplayIntegrityError);
    });
  },
);
