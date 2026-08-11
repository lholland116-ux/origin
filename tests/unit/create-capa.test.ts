import { describe, expect, it } from "vitest";

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
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
  UserId,
} from "../../lib/capa/domain/capa-types";

import {
  AuditEventAppendConflictError,
  createCapa,
  type CreateCapaCommand,
  type CreateCapaDependencies,
} from "../../lib/capa/application/create-capa";

import type {
  CapaPolicyDecision,
  CapaPolicyEvaluationRequest,
} from "../../lib/capa/authorization/capa-policy";

import type {
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
  TransactionContext,
  TransactionId,
  TransactionManager,
  TransactionWork,
} from "../../lib/database/transactions";

import type {
  AuthenticationContext,
  ServiceIdentityId,
  SessionId,
} from "../../lib/security/auth-context";

import type {
  RoleAssignmentId,
  TenantAccessGrantId,
  TenantContext,
} from "../../lib/security/tenant-context";

const NOW = new Date("2026-08-11T17:00:00.000Z");

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as OrganizationId;

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23" as UserId;

const CAPA_CASE_ID =
  "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as CapaCaseId;

const CASE_VERSION_ID =
  "a65d17e5-4688-4412-aa08-f2832b37f671" as CapaCaseVersionId;

const SECTION_VERSION_ID =
  "779594ce-cb78-4818-a173-4c1e8217637f" as CapaSectionVersionId;

const AUDIT_EVENT_ID =
  "bed889a5-8a47-4dd8-bebf-f79f31b795e7" as AuditEventId;

const ROLE_ASSIGNMENT_ID =
  "c0cf1844-61b9-432b-8355-f6c13fe48e67" as RoleAssignmentId;

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function iso(value: string): IsoDateTime {
  return value as IsoDateTime;
}

function humanAuthentication(
  overrides: Partial<AuthenticationContext> = {},
): AuthenticationContext {
  return {
    principal: {
      principal_type: "human",
      user_id: USER_ID,
    },
    session_id:
      "b7ca1234-bb73-480f-8c03-d1d234990267" as SessionId,
    authentication_method: controlled("OIDC"),
    assurance_level: controlled("MFA"),
    authenticated_at: iso("2026-08-11T16:00:00.000Z"),
    expires_at: iso("2026-08-11T18:00:00.000Z"),
    reauthenticated_at: iso("2026-08-11T16:55:00.000Z"),
    ...overrides,
  };
}

function serviceAuthentication(): AuthenticationContext {
  return {
    principal: {
      principal_type: "service",
      service_identity_id:
        "ea2cc413-0e7b-4488-a75e-0930c64472a7" as ServiceIdentityId,
    },
    session_id:
      "587f8fc1-ae91-4eb7-96b7-84a4339aaec6" as SessionId,
    authentication_method: controlled("SERVICE_CREDENTIAL"),
    assurance_level: controlled("SERVICE"),
    authenticated_at: iso("2026-08-11T16:00:00.000Z"),
    expires_at: iso("2026-08-11T18:00:00.000Z"),
  };
}

function tenantContext(): TenantContext {
  return {
    organization_id: ORGANIZATION_ID,
    access_grant_id:
      "2bf86821-80f7-42df-96f3-9e7ae645c061" as TenantAccessGrantId,
    access_path: controlled("HUMAN_MEMBERSHIP"),
    authorization_policy_version: "policy-1.0.0",
    resolved_at: iso("2026-08-11T16:59:00.000Z"),
    role_assignments: [],
  };
}

function validRequestTrace(): RequestTrace {
  return {
    request_id:
      "098c6760-7c3a-4de2-92fa-cd45f46c2321" as RequestId,
    correlation_id:
      "55633f2e-eb6a-4dc6-840f-d4be782f9f23" as CorrelationId,
    idempotency_key:
      "create-capa-test-001" as IdempotencyKey,
  };
}

function validCommand(
  overrides: Partial<CreateCapaCommand> = {},
): CreateCapaCommand {
  return {
    authentication: humanAuthentication(),
    tenant: tenantContext(),
    owner_user_id: USER_ID,
    request_trace: validRequestTrace(),
    body: {
      initiating_event:
        "  Seal defects exceeded the approved alert threshold.  ",
      source: {
        source_type: "NONCONFORMANCE",
        source_reference: "  NCR-2026-0042  ",
      },
      organization_reference: "  CAPA-LOCAL-19  ",
    },
    ...overrides,
  };
}

function allowDecision(): CapaPolicyDecision {
  return {
    decision: "allow",
    reason_code: controlled("CREATE_ALLOWED"),
    policy_version: "policy-1.0.0",
    evaluated_at: iso("2026-08-11T17:00:00.000Z"),
    relied_on_role_assignment_ids: [
      ROLE_ASSIGNMENT_ID,
    ],
  };
}

interface Harness {
  readonly dependencies: CreateCapaDependencies;
  readonly write_order: string[];
  readonly inserted_cases: CapaCase[];
  readonly inserted_versions: CapaCaseVersion[];
  readonly inserted_sections: CapaSectionVersion[];
  readonly appended_events: AuditEvent[];
  readonly policy_requests:
    CapaPolicyEvaluationRequest[];
  readonly transaction_requests: RequestTrace[];

  setPolicyDecision(
    decision: CapaPolicyDecision,
  ): void;

  setAuditResult(
    result: AppendAuditEventResult,
  ): void;

  failCaseInsert(error: Error): void;
}

function createHarness(): Harness {
  const writeOrder: string[] = [];
  const insertedCases: CapaCase[] = [];
  const insertedVersions: CapaCaseVersion[] = [];
  const insertedSections: CapaSectionVersion[] = [];
  const appendedEvents: AuditEvent[] = [];

  const policyRequests:
    CapaPolicyEvaluationRequest[] = [];

  const transactionRequests: RequestTrace[] = [];

  let policyDecision = allowDecision();

  let auditResult: AppendAuditEventResult = {
    status: "appended",
    event_id: AUDIT_EVENT_ID,
  };

  let caseInsertError: Error | undefined;

  const transactionContext: TransactionContext = {
    transaction_id:
      "a33f15a0-14d1-42c8-93d7-bba2393c2959" as TransactionId,
    started_at: iso("2026-08-11T17:00:00.000Z"),
    request_trace: validRequestTrace(),
  };

  const transactionManager: TransactionManager = {
    async runInTransaction<Result>(
      requestTrace: RequestTrace,
      work: TransactionWork<Result>,
    ): Promise<Result> {
      transactionRequests.push(requestTrace);
      return work(transactionContext);
    },
  };

  const capaRepository: CapaRepository = {
    async findCaseById() {
      return null;
    },

    async findCaseVersionById() {
      return null;
    },

    async findSectionVersionById() {
      return null;
    },

    async caseNumberExists() {
      return false;
    },

    async insertCase(_transaction, capaCase) {
      writeOrder.push("case");

      if (caseInsertError !== undefined) {
        throw caseInsertError;
      }

      insertedCases.push(capaCase);
    },

    async insertSectionVersion(
      _transaction,
      sectionVersion,
    ) {
      writeOrder.push("section");
      insertedSections.push(sectionVersion);
    },

    async insertCaseVersion(
      _transaction,
      caseVersion,
    ) {
      writeOrder.push("version");
      insertedVersions.push(caseVersion);
    },

    async advanceCurrentVersion():
      Promise<AdvanceCapaVersionResult> {
      return {
        status: "conflict",
        reason_code:
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    },
  };

  const auditRepository: AuditRepository = {
    async appendEvent(_transaction, event) {
      writeOrder.push("audit");
      appendedEvents.push(event);
      return auditResult;
    },

    async findEventById() {
      return null;
    },

    async listEventsForAggregate(
      _query: AuditEventQuery,
    ): Promise<AuditEventPage> {
      return {
        events: [],
      };
    },
  };

  const dependencies: CreateCapaDependencies = {
    transaction_manager: transactionManager,
    capa_repository: capaRepository,
    audit_repository: auditRepository,

    authorization_policy: {
      async evaluate(request) {
        policyRequests.push(request);
        return policyDecision;
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

      async generateCaseNumber(organizationId) {
        expect(organizationId).toBe(ORGANIZATION_ID);
        return "CAPA-2026-0001";
      },
    },

    clock: {
      now() {
        return NOW;
      },
    },

    configuration: {
      workflow_version: "workflow-1.0.0",
      intake_schema_version: "intake-schema-1.0.0",
      audit_schema_version: "audit-schema-1.0.0",
      intake_section_type: controlled("CAPA.INTAKE"),
      default_confidentiality: controlled(
        "CUSTOMER_CONFIDENTIAL",
      ),
      authorization_purpose: controlled(
        "CAPA_CASE_CREATION",
      ),
    },
  };

  return {
    dependencies,
    write_order: writeOrder,
    inserted_cases: insertedCases,
    inserted_versions: insertedVersions,
    inserted_sections: insertedSections,
    appended_events: appendedEvents,
    policy_requests: policyRequests,
    transaction_requests: transactionRequests,

    setPolicyDecision(decision) {
      policyDecision = decision;
    },

    setAuditResult(result) {
      auditResult = result;
    },

    failCaseInsert(error) {
      caseInsertError = error;
    },
  };
}

describe("createCapa authorization", () => {
  it("denies an inactive session before policy evaluation", async () => {
    const harness = createHarness();

    const result = await createCapa(
      harness.dependencies,
      validCommand({
        authentication: humanAuthentication({
          expires_at: iso(
            "2026-08-11T16:59:59.000Z",
          ),
        }),
      }),
    );

    expect(result).toEqual({
      status: "authorization_denied",
      reason_code: "SESSION_INACTIVE",
      policy_version: "policy-1.0.0",
    });

    expect(harness.policy_requests).toHaveLength(0);
    expect(harness.write_order).toEqual([]);
  });

  it("returns a configured policy denial", async () => {
    const harness = createHarness();

    harness.setPolicyDecision({
      decision: "deny",
      reason_code: controlled("CREATE_DENIED"),
      policy_version: "policy-1.0.0",
      evaluated_at: iso(
        "2026-08-11T17:00:00.000Z",
      ),
    });

    const result = await createCapa(
      harness.dependencies,
      validCommand(),
    );

    expect(result).toEqual({
      status: "authorization_denied",
      reason_code: "CREATE_DENIED",
      policy_version: "policy-1.0.0",
    });

    expect(harness.write_order).toEqual([]);
  });

  it("returns a configured step-up decision", async () => {
    const harness = createHarness();

    harness.setPolicyDecision({
      decision: "step_up",
      reason_code: controlled("MFA_REQUIRED"),
      policy_version: "policy-1.0.0",
      evaluated_at: iso(
        "2026-08-11T17:00:00.000Z",
      ),
      required_assurance: controlled(
        "PHISHING_RESISTANT_MFA",
      ),
    });

    const result = await createCapa(
      harness.dependencies,
      validCommand(),
    );

    expect(result).toEqual({
      status: "step_up_required",
      reason_code: "MFA_REQUIRED",
      policy_version: "policy-1.0.0",
      required_assurance:
        "PHISHING_RESISTANT_MFA",
    });

    expect(harness.write_order).toEqual([]);
  });
});

describe("createCapa request validation", () => {
  it("returns normalized validation issues without writing", async () => {
    const harness = createHarness();

    const result = await createCapa(
      harness.dependencies,
      validCommand({
        body: {
          initiating_event: "   ",
          source: {
            source_type: "INVALID SOURCE",
          },
          organization_id: ORGANIZATION_ID,
        },
      }),
    );

    expect(result.status).toBe("validation_failed");

    if (result.status === "validation_failed") {
      expect(result.issues.length).toBeGreaterThan(0);

      expect(
        result.issues.map((issue) => issue.path),
      ).toContain("initiating_event");
    }

    expect(harness.transaction_requests).toHaveLength(0);
    expect(harness.write_order).toEqual([]);
  });
});

describe("createCapa atomic record creation", () => {
  it("creates the aggregate, section, version and audit event", async () => {
    const harness = createHarness();

    const result = await createCapa(
      harness.dependencies,
      validCommand(),
    );

    expect(result.status).toBe("created");
    expect(harness.transaction_requests).toHaveLength(1);

    expect(harness.write_order).toEqual([
      "case",
      "section",
      "version",
      "audit",
    ]);

    expect(harness.inserted_cases).toHaveLength(1);
    expect(harness.inserted_sections).toHaveLength(1);
    expect(harness.inserted_versions).toHaveLength(1);
    expect(harness.appended_events).toHaveLength(1);

    const capaCase = harness.inserted_cases[0];
    const section = harness.inserted_sections[0];
    const version = harness.inserted_versions[0];
    const audit = harness.appended_events[0];

    expect(capaCase).toMatchObject({
      organization_id: ORGANIZATION_ID,
      capa_case_id: CAPA_CASE_ID,
      case_number: "CAPA-2026-0001",
      current_version_id: CASE_VERSION_ID,
      status: "S00",
      owner_user_id: USER_ID,
      record_version: 1,
    });

    expect(section).toMatchObject({
      section_version_id: SECTION_VERSION_ID,
      capa_case_id: CAPA_CASE_ID,
      version_number: 1,
      schema_version: "intake-schema-1.0.0",
      content: {
        initiating_event:
          "Seal defects exceeded the approved alert threshold.",
        source: {
          source_type: "NONCONFORMANCE",
          source_reference: "NCR-2026-0042",
        },
        organization_reference: "CAPA-LOCAL-19",
      },
    });

    expect(version).toMatchObject({
      case_version_id: CASE_VERSION_ID,
      capa_case_id: CAPA_CASE_ID,
      version_number: 1,
      status: "S00",
      section_version_ids: [SECTION_VERSION_ID],
    });

    expect(audit).toMatchObject({
      event_id: AUDIT_EVENT_ID,
      event_type: "EVT-CASE-CREATED",
      schema_version: "audit-schema-1.0.0",
      aggregate_id: CAPA_CASE_ID,
      aggregate_version: 1,
      actor: {
        actor_type: "human",
        actor_id: USER_ID,
      },
      outcome: "succeeded",
      configuration_versions: {
        workflow: "workflow-1.0.0",
        authorization_policy: "policy-1.0.0",
        intake_schema: "intake-schema-1.0.0",
        audit_schema: "audit-schema-1.0.0",
      },
      metadata: {
        case_number: "CAPA-2026-0001",
        initial_state: "S00",
        relied_on_role_assignment_ids: [
          ROLE_ASSIGNMENT_ID,
        ],
      },
    });

    expect(audit).not.toHaveProperty("session_token");
    expect(audit).not.toHaveProperty("password");
  });

  it("records service attribution when policy permits it", async () => {
    const harness = createHarness();

    const result = await createCapa(
      harness.dependencies,
      validCommand({
        authentication: serviceAuthentication(),
      }),
    );

    expect(result.status).toBe("created");

    expect(
      harness.inserted_cases[0].created_by,
    ).toEqual({
      actor_type: "service",
      actor_id:
        "ea2cc413-0e7b-4488-a75e-0930c64472a7",
    });
  });

  it("accepts an exact idempotent audit append", async () => {
    const harness = createHarness();

    harness.setAuditResult({
      status: "already_recorded",
      event_id: AUDIT_EVENT_ID,
    });

    const result = await createCapa(
      harness.dependencies,
      validCommand(),
    );

    expect(result.status).toBe("created");
  });

  it("fails on an audit identity conflict", async () => {
    const harness = createHarness();

    harness.setAuditResult({
      status: "conflict",
      event_id: AUDIT_EVENT_ID,
      reason_code:
        "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
    });

    await expect(
      createCapa(
        harness.dependencies,
        validCommand(),
      ),
    ).rejects.toBeInstanceOf(
      AuditEventAppendConflictError,
    );
  });

  it("propagates a business-write failure before audit append", async () => {
    const harness = createHarness();
    const databaseError = new Error(
      "Database insert failed",
    );

    harness.failCaseInsert(databaseError);

    await expect(
      createCapa(
        harness.dependencies,
        validCommand(),
      ),
    ).rejects.toBe(databaseError);

    expect(harness.write_order).toEqual(["case"]);
    expect(harness.appended_events).toHaveLength(0);
  });

  it("sends the expected final-policy context", async () => {
    const harness = createHarness();

    await createCapa(
      harness.dependencies,
      validCommand(),
    );

    expect(harness.policy_requests).toHaveLength(1);

    expect(harness.policy_requests[0]).toMatchObject({
      operation: "create_case",
      purpose: "CAPA_CASE_CREATION",
      resource: {
        organization_id: ORGANIZATION_ID,
        resource_type: "CAPA_CASE",
      },
      trusted_now: NOW,
    });
  });
});