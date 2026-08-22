import {
  createHash,
} from "node:crypto";

import type {
  ActorReference,
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  ControlledCode,
  IdempotencyKey,
  IsoDateTime,
  RequestTrace,
  UserId,
} from "../domain/capa-types";

import {
  CAPA_STATE,
} from "../domain/capa-state";

import {
  CreateCapaDraftRequestSchema,
  type CreateCapaDraftRequest,
} from "../validation/capa-schema";

import {
  evaluateCapaAuthorizationPreconditions,
} from "../authorization/capa-permissions";

import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";

import type {
  AuthenticationContext,
} from "../../security/auth-context";

import type {
  TenantContext,
} from "../../security/tenant-context";

import type {
  CapaRepository,
} from "../../database/repositories/capa-repository";

import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";

import type {
  CapaCaseNumberAllocator,
} from "../../database/repositories/capa-case-number-allocator";

import type {
  CapaCreationIdempotencyRepository,
  CapaCreationIdempotencyRecord,
  CapaCreationRequestFingerprint,
} from "../../database/repositories/capa-creation-idempotency-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

/**
 * Controlled CAPA draft-creation use case.
 *
 * Primary sources:
 * Document #3 â€” User Requirements Specification
 * Document #4 â€” Workflow and State Specification
 * Document #8 â€” Data Model and Audit-Trail Specification
 * Document #9 â€” Security, Privacy, and Access-Control Specification
 *
 * Traceability:
 * URS-CASE-001
 * WFR-001 through WFR-004
 * DM-COM-001 through DM-COM-009
 * VER-001
 * AUD-001 through AUD-004
 * AUTH-001
 * TEN-001
 *
 * This service coordinates the use case but remains independent of the
 * physical database, ORM, identity provider and HTTP framework.
 */

const IDEMPOTENCY_KEY_MAXIMUM_LENGTH =
  128;

const CREATION_FINGERPRINT_VERSION =
  "capa-create-request-v1";

export interface CreateCapaIdGenerator {
  generateCapaCaseId(): CapaCaseId;
  generateCaseVersionId(): CapaCaseVersionId;
  generateSectionVersionId(): CapaSectionVersionId;
  generateAuditEventId(): AuditEventId;
}

export interface CreateCapaClock {
  /** Returns trusted server time. */
  now(): Date;
}

export interface CreateCapaConfiguration {
  readonly workflow_version: string;
  readonly intake_schema_version: string;
  readonly audit_schema_version: string;
  readonly intake_section_type:
    ControlledCode;
  readonly default_confidentiality:
    ControlledCode;
  readonly authorization_purpose:
    ControlledCode;
}

export interface CreateCapaCommand {
  readonly authentication:
    AuthenticationContext;
  readonly tenant: TenantContext;

  /**
   * Owner resolved from trusted membership or assignment information.
   * This value must not be accepted from an ordinary browser body.
   */
  readonly owner_user_id: UserId;
  readonly request_trace: RequestTrace;
  readonly body: unknown;
}

export interface CreateCapaDependencies {
  readonly transaction_manager:
    TransactionManager;
  readonly capa_repository:
    CapaRepository;
  readonly audit_repository:
    AuditRepository;

  /**
   * Claims an organization-local creation key before any case number or
   * material record is written.
   */
  readonly creation_idempotency_repository:
    CapaCreationIdempotencyRepository;

  readonly case_number_allocator:
    CapaCaseNumberAllocator;
  readonly authorization_policy:
    CapaAuthorizationPolicy;
  readonly id_generator:
    CreateCapaIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration:
    CreateCapaConfiguration;
}

export interface CreateCapaValidationIssue {
  readonly path: string;
  readonly message: string;
}

interface CompletedCreation {
  readonly capa_case: CapaCase;
  readonly case_version:
    CapaCaseVersion;
  readonly section_version:
    CapaSectionVersion;
  readonly audit_event_id:
    AuditEventId;
}

export type CreateCapaResult =
  | ({
      readonly status: "created";
    } & CompletedCreation)
  | ({
      readonly status:
        "already_created";
    } & CompletedCreation)
  | {
      readonly status:
        "idempotency_conflict";
      readonly reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    }
  | {
      readonly status:
        "validation_failed";
      readonly issues:
        readonly CreateCapaValidationIssue[];
    }
  | {
      readonly status:
        "authorization_denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
  | {
      readonly status:
        "step_up_required";
      readonly reason_code: string;
      readonly policy_version: string;
      readonly required_assurance:
        ControlledCode;
    };

/** Raised when an audit identity is reused with different content. */
export class AuditEventAppendConflictError
  extends Error {
  constructor() {
    super(
      "Audit event identity was reused with different controlled content.",
    );
    this.name =
      "AuditEventAppendConflictError";
  }
}

/** Raised when creation is invoked without a usable request key. */
export class CreateCapaIdempotencyConfigurationError
  extends Error {
  constructor() {
    super(
      "CAPA creation requires a valid idempotency key.",
    );
    this.name =
      "CreateCapaIdempotencyConfigurationError";
  }
}

/** Raised if an exact retry cannot resolve its committed aggregate. */
export class CreateCapaReplayIntegrityError
  extends Error {
  constructor() {
    super(
      "The authoritative CAPA creation retry record is incomplete.",
    );
    this.name =
      "CreateCapaReplayIntegrityError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function iso(value: Date): IsoDateTime {
  return value.toISOString() as IsoDateTime;
}

function actorFromAuthentication(
  authentication: AuthenticationContext,
): ActorReference {
  if (
    authentication.principal
      .principal_type === "human"
  ) {
    return {
      actor_type: "human",
      actor_id:
        authentication.principal.user_id,
    };
  }

  return {
    actor_type: "service",
    actor_id:
      authentication.principal
        .service_identity_id,
  };
}

function validateCreateRequest(
  body: unknown,
):
  | {
      readonly success: true;
      readonly data:
        CreateCapaDraftRequest;
    }
  | {
      readonly success: false;
      readonly issues:
        readonly CreateCapaValidationIssue[];
    } {
  const parsed =
    CreateCapaDraftRequestSchema.safeParse(
      body,
    );

  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
    };
  }

  return {
    success: false,
    issues: parsed.error.issues.map(
      (issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }),
    ),
  };
}

function requireIdempotencyKey(
  trace: RequestTrace,
): IdempotencyKey {
  const key = trace.idempotency_key;

  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length >
      IDEMPOTENCY_KEY_MAXIMUM_LENGTH ||
    key.trim() !== key
  ) {
    throw new CreateCapaIdempotencyConfigurationError();
  }

  return key;
}

/**
 * Produces a deterministic digest from validated semantic input and the
 * controlled configuration that affects the resulting records.
 * Optional values are represented explicitly as null so equivalent
 * requests produce the same digest.
 */
function creationRequestFingerprint(
  command: CreateCapaCommand,
  request: CreateCapaDraftRequest,
  configuration:
    CreateCapaConfiguration,
  authorizationPolicyVersion:
    string,
): CapaCreationRequestFingerprint {
  const canonicalRequest = {
    fingerprint_version:
      CREATION_FINGERPRINT_VERSION,
    organization_id:
      command.tenant.organization_id,
    owner_user_id:
      command.owner_user_id,
    request: {
      initiating_event:
        request.initiating_event,
      source: {
        source_type:
          request.source.source_type,
        source_reference:
          request.source
            .source_reference ?? null,
      },
      organization_reference:
        request.organization_reference ??
        null,
    },
    configuration: {
      workflow_version:
        configuration.workflow_version,
      intake_schema_version:
        configuration
          .intake_schema_version,
      audit_schema_version:
        configuration.audit_schema_version,
      intake_section_type:
        configuration.intake_section_type,
      default_confidentiality:
        configuration
          .default_confidentiality,
      authorization_purpose:
        configuration
          .authorization_purpose,
      authorization_policy_version:
        authorizationPolicyVersion,
    },
  };

  return createHash("sha256")
    .update(
      JSON.stringify(canonicalRequest),
      "utf8",
    )
    .digest("hex") as
      CapaCreationRequestFingerprint;
}

function creationRecord(
  organizationId:
    CapaCreationIdempotencyRecord[
      "organization_id"
    ],
  idempotencyKey:
    IdempotencyKey,
  requestFingerprint:
    CapaCreationRequestFingerprint,
  capaCaseId: CapaCaseId,
  caseVersionId:
    CapaCaseVersionId,
  sectionVersionId:
    CapaSectionVersionId,
  auditEventId: AuditEventId,
): CapaCreationIdempotencyRecord {
  return {
    organization_id: organizationId,
    idempotency_key: idempotencyKey,
    request_fingerprint:
      requestFingerprint,
    capa_case_id: capaCaseId,
    case_version_id: caseVersionId,
    section_version_id:
      sectionVersionId,
    audit_event_id: auditEventId,
  };
}

async function recoverCompletedCreation(
  dependencies: CreateCapaDependencies,
  record:
    CapaCreationIdempotencyRecord,
): Promise<CompletedCreation> {
  const [capaCase, caseVersion, sectionVersion] =
    await Promise.all([
      dependencies.capa_repository
        .findCaseById(
          record.organization_id,
          record.capa_case_id,
        ),
      dependencies.capa_repository
        .findCaseVersionById(
          record.organization_id,
          record.capa_case_id,
          record.case_version_id,
        ),
      dependencies.capa_repository
        .findSectionVersionById(
          record.organization_id,
          record.capa_case_id,
          record.section_version_id,
        ),
    ]);

  if (
    capaCase === null ||
    caseVersion === null ||
    sectionVersion === null ||
    capaCase.current_version_id !==
      record.case_version_id ||
    caseVersion.capa_case_id !==
      record.capa_case_id ||
    !caseVersion.section_version_ids
      .includes(
        record.section_version_id,
      ) ||
    sectionVersion.capa_case_id !==
      record.capa_case_id
  ) {
    throw new CreateCapaReplayIntegrityError();
  }

  return {
    capa_case: capaCase,
    case_version: caseVersion,
    section_version: sectionVersion,
    audit_event_id:
      record.audit_event_id,
  };
}

export async function createCapa(
  dependencies: CreateCapaDependencies,
  command: CreateCapaCommand,
): Promise<CreateCapaResult> {
  const trustedNow =
    dependencies.clock.now();

  const preconditionResult =
    evaluateCapaAuthorizationPreconditions({
      authentication:
        command.authentication,
      tenant: command.tenant,
      resource: {
        organization_id:
          command.tenant.organization_id,
      },
      operation: "create_case",
      trusted_now: trustedNow,
    });

  if (
    preconditionResult.status ===
    "denied"
  ) {
    return {
      status: "authorization_denied",
      reason_code:
        preconditionResult.reason_code,
      policy_version:
        preconditionResult
          .authorization_policy_version,
    };
  }

  const policyDecision =
    await dependencies
      .authorization_policy.evaluate({
        authentication:
          command.authentication,
        tenant: command.tenant,
        operation: "create_case",
        resource: {
          organization_id:
            command.tenant.organization_id,
          resource_type:
            controlled("CAPA_CASE"),
        },
        purpose:
          dependencies.configuration
            .authorization_purpose,
        trusted_now: trustedNow,
      });

  if (policyDecision.decision === "deny") {
    return {
      status: "authorization_denied",
      reason_code:
        policyDecision.reason_code,
      policy_version:
        policyDecision.policy_version,
    };
  }

  if (
    policyDecision.decision === "step_up"
  ) {
    return {
      status: "step_up_required",
      reason_code:
        policyDecision.reason_code,
      policy_version:
        policyDecision.policy_version,
      required_assurance:
        policyDecision.required_assurance,
    };
  }

  const validated =
    validateCreateRequest(command.body);

  if (!validated.success) {
    return {
      status: "validation_failed",
      issues: validated.issues,
    };
  }

  const idempotencyKey =
    requireIdempotencyKey(
      command.request_trace,
    );
  const organizationId =
    command.tenant.organization_id;
  const requestFingerprint =
    creationRequestFingerprint(
      command,
      validated.data,
      dependencies.configuration,
      policyDecision.policy_version,
    );

  const capaCaseId =
    dependencies.id_generator
      .generateCapaCaseId();
  const caseVersionId =
    dependencies.id_generator
      .generateCaseVersionId();
  const sectionVersionId =
    dependencies.id_generator
      .generateSectionVersionId();
  const auditEventId =
    dependencies.id_generator
      .generateAuditEventId();

  const candidateClaim =
    creationRecord(
      organizationId,
      idempotencyKey,
      requestFingerprint,
      capaCaseId,
      caseVersionId,
      sectionVersionId,
      auditEventId,
    );
  const timestamp = iso(trustedNow);
  const actor = actorFromAuthentication(
    command.authentication,
  );

  return dependencies.transaction_manager
    .runInTransaction(
      command.request_trace,
      async (transaction) => {
        const claim =
          await dependencies
            .creation_idempotency_repository
            .claimCreation(
              transaction,
              candidateClaim,
            );

        if (claim.status === "conflict") {
          return {
            status:
              "idempotency_conflict",
            reason_code:
              claim.reason_code,
          };
        }

        if (
          claim.status ===
          "already_claimed"
        ) {
          return {
            status: "already_created",
            ...(await recoverCompletedCreation(
              dependencies,
              claim.record,
            )),
          };
        }

        const caseNumber =
          await dependencies
            .case_number_allocator
            .allocateNextCaseNumber(
              transaction,
              organizationId,
            );

        const sectionVersion:
          CapaSectionVersion = {
          organization_id:
            organizationId,
          section_version_id:
            sectionVersionId,
          capa_case_id: capaCaseId,
          section_type:
            dependencies.configuration
              .intake_section_type,
          version_number: 1,
          schema_version:
            dependencies.configuration
              .intake_schema_version,
          content: {
            initiating_event:
              validated.data
                .initiating_event,
            source:
              validated.data.source,
            organization_reference:
              validated.data
                .organization_reference,
          },
          change_reason:
            "Initial CAPA draft intake",
          effective_at: timestamp,
          created_at: timestamp,
          created_by: actor,
        };

        const caseVersion:
          CapaCaseVersion = {
          organization_id:
            organizationId,
          case_version_id:
            caseVersionId,
          capa_case_id: capaCaseId,
          version_number: 1,
          change_reason:
            "Initial CAPA draft creation",
          status:
            CAPA_STATE.DRAFT_INTAKE,
          section_version_ids: [
            sectionVersionId,
          ],
          effective_at: timestamp,
          created_at: timestamp,
          created_by: actor,
        };

        const capaCase: CapaCase = {
          organization_id:
            organizationId,
          capa_case_id: capaCaseId,
          case_number: caseNumber,
          current_version_id:
            caseVersionId,
          status:
            CAPA_STATE.DRAFT_INTAKE,
          owner_user_id:
            command.owner_user_id,
          confidentiality:
            dependencies.configuration
              .default_confidentiality,
          effective_at: timestamp,
          record_version: 1,
          created_at: timestamp,
          created_by: actor,
          updated_at: timestamp,
          updated_by: actor,
        };

        const auditEvent: AuditEvent = {
          organization_id:
            organizationId,
          event_id: auditEventId,
          event_type:
            controlled(
              "EVT-CASE-CREATED",
            ),
          schema_version:
            dependencies.configuration
              .audit_schema_version,
          aggregate_type:
            controlled("CAPA_CASE"),
          aggregate_id: capaCaseId,
          aggregate_version: 1,
          actor,
          occurred_at: timestamp,
          request_id:
            command.request_trace
              .request_id,
          correlation_id:
            command.request_trace
              .correlation_id,
          idempotency_key:
            idempotencyKey,
          action:
            controlled(
              "CREATE_CAPA_DRAFT",
            ),
          target: {
            object_type:
              controlled("CAPA_CASE"),
            object_id: capaCaseId,
            object_version_id:
              caseVersionId,
          },
          outcome: "succeeded",
          change: {
            after_ref: {
              object_type:
                controlled("CAPA_CASE"),
              object_id: capaCaseId,
              object_version_id:
                caseVersionId,
            },
          },
          configuration_versions: {
            workflow:
              dependencies.configuration
                .workflow_version,
            authorization_policy:
              policyDecision
                .policy_version,
            intake_schema:
              dependencies.configuration
                .intake_schema_version,
            audit_schema:
              dependencies.configuration
                .audit_schema_version,
          },
          metadata: {
            case_number: caseNumber,
            initial_state:
              CAPA_STATE.DRAFT_INTAKE,
            relied_on_role_assignment_ids:
              policyDecision
                .relied_on_role_assignment_ids,
          },
        };

        await dependencies.capa_repository
          .insertCase(
            transaction,
            capaCase,
          );
        await dependencies.capa_repository
          .insertSectionVersion(
            transaction,
            sectionVersion,
          );
        await dependencies.capa_repository
          .insertCaseVersion(
            transaction,
            caseVersion,
          );

        const auditResult =
          await dependencies
            .audit_repository.appendEvent(
              transaction,
              auditEvent,
            );

        if (
          auditResult.status ===
          "conflict"
        ) {
          throw new AuditEventAppendConflictError();
        }

        return {
          status: "created",
          capa_case: capaCase,
          case_version: caseVersion,
          section_version:
            sectionVersion,
          audit_event_id:
            auditEventId,
        };
      },
    );
}