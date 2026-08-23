import {
  createHash,
} from "node:crypto";

import type {
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  ControlledCode,
  IdempotencyKey,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";

import {
  CAPA_STATE,
} from "../domain/capa-state";

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
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
} from "../../database/repositories/capa-workflow-idempotency-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

import type {
  CreateCapaClock,
  CreateCapaIdGenerator,
} from "./create-capa";

import {
  AuditEventAppendConflictError,
} from "./create-capa";

/**
 * Controlled, retry-safe transition from Draft Intake (S00) to Triage and
 * Scope (S10).
 *
 * The human remains the accountable actor. This service performs no AI
 * approval or autonomous workflow advancement.
 */

const SOURCE_STATE =
  CAPA_STATE.DRAFT_INTAKE;

const TARGET_STATE =
  CAPA_STATE.TRIAGE_AND_SCOPE;

const OPERATION_CODE =
  "SUBMIT_CAPA_INTAKE";

const FINGERPRINT_VERSION =
  "submit-capa-intake-fingerprint-1";

const IDEMPOTENCY_KEY_MAXIMUM_LENGTH =
  128;

export interface SubmitCapaIntakeConfiguration {
  readonly workflow_version: string;
  readonly audit_schema_version: string;
  readonly authorization_purpose:
    ControlledCode;
}

export interface SubmitCapaIntakeCommand {
  readonly authentication:
    AuthenticationContext;
  readonly tenant: TenantContext;
  readonly capa_case_id:
    CapaCaseId;
  readonly expected_record_version:
    number;
  readonly expected_current_version_id:
    CapaCaseVersionId;
  readonly request_trace:
    RequestTrace;
}

export interface SubmitCapaIntakeDependencies {
  readonly transaction_manager:
    TransactionManager;
  readonly capa_repository:
    CapaRepository;
  readonly audit_repository:
    AuditRepository;
  readonly workflow_idempotency_repository:
    CapaWorkflowIdempotencyRepository;
  readonly authorization_policy:
    CapaAuthorizationPolicy;
  readonly id_generator:
    CreateCapaIdGenerator;
  readonly clock:
    CreateCapaClock;
  readonly configuration:
    SubmitCapaIntakeConfiguration;
}

interface CompletedSubmission {
  readonly capa_case:
    CapaCase;
  readonly case_version:
    CapaCaseVersion;
  readonly audit_event_id:
    AuditEventId;
}

export type SubmitCapaIntakeResult =
  | ({
      readonly status:
        "submitted";
    } & CompletedSubmission)
  | ({
      readonly status:
        "already_submitted";
    } & CompletedSubmission)
  | {
      readonly status:
        "idempotency_conflict";
      readonly reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    }
  | {
      readonly status:
        "not_found_or_not_authorized";
    }
  | {
      readonly status:
        "concurrency_conflict";
      readonly reason_code:
        | "RECORD_VERSION_CONFLICT"
        | "CURRENT_VERSION_CONFLICT"
        | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED";
    }
  | {
      readonly status:
        "workflow_conflict";
      readonly reason_code:
        "WORKFLOW_STATE_NOT_ALLOWED";
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

export class SubmitCapaIntakeIntegrityError
  extends Error {
  constructor() {
    super(
      "The authoritative CAPA draft version is incomplete or inconsistent.",
    );
    this.name =
      "SubmitCapaIntakeIntegrityError";
  }
}

export class SubmitCapaIntakeReplayIntegrityError
  extends Error {
  constructor() {
    super(
      "The authoritative CAPA intake-submission retry record is incomplete.",
    );
    this.name =
      "SubmitCapaIntakeReplayIntegrityError";
  }
}

export class SubmitCapaIntakeIdempotencyConfigurationError
  extends Error {
  constructor() {
    super(
      "CAPA intake submission requires a valid idempotency key.",
    );
    this.name =
      "SubmitCapaIntakeIdempotencyConfigurationError";
  }
}

class SubmitCapaIntakeConcurrencyError
  extends Error {
  constructor(
    readonly reason_code:
      | "RECORD_VERSION_CONFLICT"
      | "CURRENT_VERSION_CONFLICT"
      | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  ) {
    super(
      "The CAPA intake changed before submission could be committed.",
    );
    this.name =
      "SubmitCapaIntakeConcurrencyError";
  }
}

class SubmitCapaIntakeWorkflowConflictError
  extends Error {
  constructor() {
    super(
      "The CAPA intake is not in Draft Intake.",
    );
    this.name =
      "SubmitCapaIntakeWorkflowConflictError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function iso(
  value: Date,
): IsoDateTime {
  return value.toISOString() as
    IsoDateTime;
}

function requireIdempotencyKey(
  trace: RequestTrace,
): IdempotencyKey {
  const key =
    trace.idempotency_key;

  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length >
      IDEMPOTENCY_KEY_MAXIMUM_LENGTH ||
    key.trim() !== key
  ) {
    throw new SubmitCapaIntakeIdempotencyConfigurationError();
  }

  return key;
}

function requestFingerprint(
  dependencies:
    SubmitCapaIntakeDependencies,
  command:
    SubmitCapaIntakeCommand,
): CapaWorkflowRequestFingerprint {
  const canonicalRequest = {
    fingerprint_version:
      FINGERPRINT_VERSION,
    organization_id:
      command.tenant.organization_id,
    capa_case_id:
      command.capa_case_id,
    operation_code:
      OPERATION_CODE,
    expected_record_version:
      command.expected_record_version,
    expected_current_version_id:
      command.expected_current_version_id,
    configuration: {
      workflow_version:
        dependencies.configuration
          .workflow_version,
      audit_schema_version:
        dependencies.configuration
          .audit_schema_version,
    },
  };

  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalRequest,
      ),
      "utf8",
    )
    .digest("hex") as
      CapaWorkflowRequestFingerprint;
}

function requireSourceVersion(
  capaCase: CapaCase,
  sourceVersion:
    CapaCaseVersion | null,
  command:
    SubmitCapaIntakeCommand,
): CapaCaseVersion {
  if (
    sourceVersion === null ||
    sourceVersion.capa_case_id !==
      capaCase.capa_case_id ||
    sourceVersion.case_version_id !==
      command
        .expected_current_version_id ||
    sourceVersion.status !==
      SOURCE_STATE ||
    sourceVersion.version_number !==
      command.expected_record_version
  ) {
    throw new SubmitCapaIntakeIntegrityError();
  }

  return sourceVersion;
}

async function replaySubmission(
  dependencies:
    SubmitCapaIntakeDependencies,
  record:
    CapaWorkflowIdempotencyRecord,
): Promise<SubmitCapaIntakeResult> {
  const capaCase =
    await dependencies
      .capa_repository
      .findCaseById(
        record.organization_id,
        record.capa_case_id,
      );

  const resultingVersion =
    await dependencies
      .capa_repository
      .findCaseVersionById(
        record.organization_id,
        record.capa_case_id,
        record.resulting_case_version_id,
      );

  if (
    capaCase === null ||
    resultingVersion === null ||
    resultingVersion.capa_case_id !==
      record.capa_case_id ||
    resultingVersion.case_version_id !==
      record.resulting_case_version_id ||
    resultingVersion.parent_version_id !==
      record.source_case_version_id ||
    resultingVersion.status !==
      TARGET_STATE
  ) {
    throw new SubmitCapaIntakeReplayIntegrityError();
  }

  return {
    status:
      "already_submitted",
    capa_case:
      capaCase,
    case_version:
      resultingVersion,
    audit_event_id:
      record.audit_event_id,
  };
}

export async function submitCapaIntake(
  dependencies:
    SubmitCapaIntakeDependencies,
  command:
    SubmitCapaIntakeCommand,
): Promise<SubmitCapaIntakeResult> {
  const trustedNow =
    dependencies.clock.now();

  const organizationId =
    command.tenant.organization_id;

  const precondition =
    evaluateCapaAuthorizationPreconditions({
      authentication:
        command.authentication,
      tenant:
        command.tenant,
      resource: {
        organization_id:
          organizationId,
      },
      operation:
        "submit_intake",
      trusted_now:
        trustedNow,
    });

  if (precondition.status === "denied") {
    return {
      status:
        "authorization_denied",
      reason_code:
        precondition.reason_code,
      policy_version:
        precondition
          .authorization_policy_version,
    };
  }

  const capaCase =
    await dependencies
      .capa_repository
      .findCaseById(
        organizationId,
        command.capa_case_id,
      );

  if (capaCase === null) {
    return {
      status:
        "not_found_or_not_authorized",
    };
  }

  const sourceVersion =
    requireSourceVersion(
      capaCase,
      await dependencies
        .capa_repository
        .findCaseVersionById(
          organizationId,
          capaCase.capa_case_id,
          command
            .expected_current_version_id,
        ),
      command,
    );

  const policyDecision =
    await dependencies
      .authorization_policy
      .evaluate({
        authentication:
          command.authentication,
        tenant:
          command.tenant,
        operation:
          "submit_intake",
        resource: {
          organization_id:
            organizationId,
          resource_type:
            controlled("CAPA_CASE"),
          resource_id:
            capaCase.capa_case_id,
          resource_version_id:
            sourceVersion.case_version_id,
          capa_case_id:
            capaCase.capa_case_id,
          case_version_id:
            sourceVersion.case_version_id,
          workflow_state:
            sourceVersion.status,
        },
        purpose:
          dependencies.configuration
            .authorization_purpose,
        trusted_now:
          trustedNow,
      });

  if (policyDecision.decision === "deny") {
    return {
      status:
        "authorization_denied",
      reason_code:
        policyDecision.reason_code,
      policy_version:
        policyDecision.policy_version,
    };
  }

  if (policyDecision.decision === "step_up") {
    return {
      status:
        "step_up_required",
      reason_code:
        policyDecision.reason_code,
      policy_version:
        policyDecision.policy_version,
      required_assurance:
        policyDecision
          .required_assurance,
    };
  }

  const idempotencyKey =
    requireIdempotencyKey(
      command.request_trace,
    );

  const fingerprint =
    requestFingerprint(
      dependencies,
      command,
    );

  const nextVersionId =
    dependencies.id_generator
      .generateCaseVersionId();

  const auditEventId =
    dependencies.id_generator
      .generateAuditEventId();

  const timestamp =
    iso(trustedNow);

  const humanPrincipal =
    command.authentication
      .principal as Extract<
        AuthenticationContext["principal"],
        {
          readonly principal_type:
            "human";
        }
      >;

  const actor = {
    actor_type:
      "human" as const,
    actor_id:
      humanPrincipal.user_id,
  };

  const nextVersion:
    CapaCaseVersion = {
    organization_id:
      organizationId,
    case_version_id:
      nextVersionId,
    capa_case_id:
      capaCase.capa_case_id,
    version_number:
      sourceVersion.version_number + 1,
    parent_version_id:
      sourceVersion.case_version_id,
    change_reason:
      "Submit CAPA intake for triage and scope",
    status:
      TARGET_STATE,
    section_version_ids: [
      ...sourceVersion
        .section_version_ids,
    ],
    effective_at:
      timestamp,
    created_at:
      timestamp,
    created_by:
      actor,
  };

  try {
    const transactionResult =
      await dependencies
        .transaction_manager
        .runInTransaction(
          command.request_trace,
          async (transaction) => {
            const claimRecord:
              CapaWorkflowIdempotencyRecord = {
              organization_id:
                organizationId,
              idempotency_key:
                idempotencyKey,
              operation_code:
                controlled(
                  OPERATION_CODE,
                ),
              request_fingerprint:
                fingerprint,
              capa_case_id:
                capaCase.capa_case_id,
              source_case_version_id:
                sourceVersion
                  .case_version_id,
              resulting_case_version_id:
                nextVersionId,
              audit_event_id:
                auditEventId,
            };

            const claim =
              await dependencies
                .workflow_idempotency_repository
                .claimWorkflowOperation(
                  transaction,
                  claimRecord,
                );

            if (claim.status === "conflict") {
              return {
                kind:
                  "idempotency_conflict" as const,
              };
            }

            if (
              claim.status ===
              "already_claimed"
            ) {
              return {
                kind:
                  "replay" as const,
                record:
                  claim.record,
              };
            }

            if (capaCase.status !== SOURCE_STATE) {
              throw new SubmitCapaIntakeWorkflowConflictError();
            }

            if (
              capaCase.record_version !==
              command.expected_record_version
            ) {
              throw new SubmitCapaIntakeConcurrencyError(
                "RECORD_VERSION_CONFLICT",
              );
            }

            if (
              capaCase.current_version_id !==
              command
                .expected_current_version_id
            ) {
              throw new SubmitCapaIntakeConcurrencyError(
                "CURRENT_VERSION_CONFLICT",
              );
            }

            await dependencies
              .capa_repository
              .insertCaseVersion(
                transaction,
                nextVersion,
              );

            const advanceResult =
              await dependencies
                .capa_repository
                .advanceCurrentVersion(
                  transaction,
                  {
                    organization_id:
                      organizationId,
                    capa_case_id:
                      capaCase.capa_case_id,
                    expected_record_version:
                      command
                        .expected_record_version,
                    expected_current_version_id:
                      command
                        .expected_current_version_id,
                    next_current_version_id:
                      nextVersionId,
                    next_status:
                      TARGET_STATE,
                    updated_at:
                      timestamp,
                    updated_by:
                      actor,
                  },
                );

            if (advanceResult.status === "conflict") {
              throw new SubmitCapaIntakeConcurrencyError(
                advanceResult.reason_code,
              );
            }

            const auditEvent:
              AuditEvent = {
              organization_id:
                organizationId,
              event_id:
                auditEventId,
              event_type:
                controlled(
                  "EVT-CASE-STATE-CHANGED",
                ),
              schema_version:
                dependencies.configuration
                  .audit_schema_version,
              aggregate_type:
                controlled("CAPA_CASE"),
              aggregate_id:
                capaCase.capa_case_id,
              aggregate_version:
                advanceResult.capa_case
                  .record_version,
              actor,
              occurred_at:
                timestamp,
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
                  OPERATION_CODE,
                ),
              target: {
                object_type:
                  controlled("CAPA_CASE"),
                object_id:
                  capaCase.capa_case_id,
                object_version_id:
                  nextVersionId,
              },
              outcome:
                "succeeded",
              change: {
                before_ref: {
                  object_type:
                    controlled("CAPA_CASE"),
                  object_id:
                    capaCase.capa_case_id,
                  object_version_id:
                    sourceVersion
                      .case_version_id,
                },
                after_ref: {
                  object_type:
                    controlled("CAPA_CASE"),
                  object_id:
                    capaCase.capa_case_id,
                  object_version_id:
                    nextVersionId,
                },
              },
              configuration_versions: {
                workflow:
                  dependencies.configuration
                    .workflow_version,
                authorization_policy:
                  policyDecision
                    .policy_version,
                audit_schema:
                  dependencies.configuration
                    .audit_schema_version,
              },
              metadata: {
                case_number:
                  capaCase.case_number,
                transition_event:
                  "Submit intake",
                from_state:
                  SOURCE_STATE,
                to_state:
                  TARGET_STATE,
                relied_on_role_assignment_ids:
                  policyDecision
                    .relied_on_role_assignment_ids,
              },
            };

            const auditResult =
              await dependencies
                .audit_repository
                .appendEvent(
                  transaction,
                  auditEvent,
                );

            if (auditResult.status === "conflict") {
              throw new AuditEventAppendConflictError();
            }

            return {
              kind:
                "submitted" as const,
              completion: {
                capa_case:
                  advanceResult.capa_case,
                case_version:
                  nextVersion,
                audit_event_id:
                  auditEventId,
              },
            };
          },
        );

    if (
      transactionResult.kind ===
      "idempotency_conflict"
    ) {
      return {
        status:
          "idempotency_conflict",
        reason_code:
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      };
    }

    if (transactionResult.kind === "replay") {
      return replaySubmission(
        dependencies,
        transactionResult.record,
      );
    }

    return {
      status:
        "submitted",
      ...transactionResult.completion,
    };
  } catch (error) {
    if (
      error instanceof
      SubmitCapaIntakeConcurrencyError
    ) {
      return {
        status:
          "concurrency_conflict",
        reason_code:
          error.reason_code,
      };
    }

    if (
      error instanceof
      SubmitCapaIntakeWorkflowConflictError
    ) {
      return {
        status:
          "workflow_conflict",
        reason_code:
          "WORKFLOW_STATE_NOT_ALLOWED",
      };
    }

    throw error;
  }
}
