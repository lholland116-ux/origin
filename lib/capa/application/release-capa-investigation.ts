import { createHash } from "node:crypto";

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
  IdempotencyKey,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";
import { CAPA_STATE } from "../domain/capa-state";
import {
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  evaluateCapaInvestigationPlanGateReadiness,
  validateCapaInvestigationPlan,
  type CapaInvestigationPlanContent,
  type CapaInvestigationPlanGateBlockerCode,
  type CapaInvestigationPlanValidationReasonCode,
} from "../domain/capa-investigation-plan";
import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
} from "../../database/repositories/capa-workflow-idempotency-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaParticipantEligibilityRepository } from "../../database/repositories/capa-participant-eligibility-repository";
import type { CreateCapaClock, CreateCapaIdGenerator } from "./create-capa";
import { AuditEventAppendConflictError } from "./create-capa";

const SOURCE_STATE = CAPA_STATE.INVESTIGATION_PLANNING;
const TARGET_STATE = CAPA_STATE.INVESTIGATION_ACTIVE;
const OPERATION_CODE = "RELEASE_CAPA_INVESTIGATION";
const FINGERPRINT_VERSION = "release-capa-investigation-fingerprint-1";
const GATE = "G-03";
const TRANSITION_MEANING = "Authorize investigation execution";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;
const MAXIMUM_COMMENT_LENGTH = 4_000;

export const CAPA_INVESTIGATION_RELEASE_CONFIRMATION =
  "G03_INVESTIGATION_RELEASE_CONFIRMED" as const;

export interface ReleaseCapaInvestigationConfiguration {
  readonly workflow_version: string;
  readonly audit_schema_version: string;
  readonly authorization_purpose: ControlledCode;
}

export interface ReleaseCapaInvestigationDependencies {
  readonly transaction_manager: TransactionManager;
  readonly capa_repository: CapaRepository;
  readonly audit_repository: AuditRepository;
  readonly workflow_idempotency_repository: CapaWorkflowIdempotencyRepository;
  readonly participant_eligibility_repository: CapaParticipantEligibilityRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly id_generator: CreateCapaIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: ReleaseCapaInvestigationConfiguration;
}

export interface ReleaseCapaInvestigationCommand {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly capa_case_id: CapaCaseId;
  readonly expected_record_version: number;
  readonly expected_current_version_id: CapaCaseVersionId;
  readonly request_trace: RequestTrace;
  readonly body: unknown;
}

interface ValidatedReleaseBody {
  readonly investigation_plan: CapaInvestigationPlanContent;
  readonly release: {
    readonly confirmation: typeof CAPA_INVESTIGATION_RELEASE_CONFIRMATION;
    readonly comment: string | null;
  };
}

interface CompletedRelease {
  readonly capa_case: CapaCase;
  readonly case_version: CapaCaseVersion;
  readonly investigation_plan_section_version: CapaSectionVersion;
  readonly transition_audit_event_id: AuditEventId;
}

export type ReleaseCapaInvestigationResult =
  | ({ readonly status: "released" } & CompletedRelease)
  | ({ readonly status: "already_released" } & CompletedRelease)
  | {
      readonly status: "validation_failed";
      readonly reason_code:
        | "INVALID_INVESTIGATION_RELEASE_BODY"
        | "INVALID_INVESTIGATION_RELEASE_CONFIRMATION"
        | "INVALID_INVESTIGATION_RELEASE_COMMENT";
      readonly investigation_plan_reason_code?:
        CapaInvestigationPlanValidationReasonCode;
    }
  | {
      readonly status: "gate_blocked";
      readonly blocker_codes: readonly CapaInvestigationPlanGateBlockerCode[];
    }
  | {
      readonly status: "owner_eligibility_failed";
      readonly reason_code: "INELIGIBLE_INVESTIGATION_PLAN_OWNER";
    }
  | { readonly status: "not_found_or_not_authorized" }
  | {
      readonly status: "authorization_denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
  | {
      readonly status: "idempotency_conflict";
      readonly reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    }
  | {
      readonly status: "concurrency_conflict";
      readonly reason_code:
        | "RECORD_VERSION_CONFLICT"
        | "CURRENT_VERSION_CONFLICT"
        | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED";
    }
  | {
      readonly status: "workflow_conflict";
      readonly reason_code: "WORKFLOW_STATE_NOT_ALLOWED";
    };

export class ReleaseCapaInvestigationIdempotencyConfigurationError extends Error {
  constructor() {
    super("G-03 investigation release requires a valid idempotency key.");
    this.name = "ReleaseCapaInvestigationIdempotencyConfigurationError";
  }
}

export class ReleaseCapaInvestigationIntegrityError extends Error {
  constructor(message = "The authoritative S30 investigation plan is inconsistent.") {
    super(message);
    this.name = "ReleaseCapaInvestigationIntegrityError";
  }
}

class ReleaseConcurrencyError extends Error {
  constructor(readonly reason_code:
    | "RECORD_VERSION_CONFLICT"
    | "CURRENT_VERSION_CONFLICT"
    | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED") {
    super("The CAPA changed before G-03 release could be committed.");
  }
}

class ReleaseWorkflowError extends Error {}
class ReleaseOwnerEligibilityError extends Error {}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function iso(value: Date): IsoDateTime {
  return value.toISOString() as IsoDateTime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBody(value: unknown):
  | { readonly status: "valid"; readonly value: ValidatedReleaseBody }
  | Extract<ReleaseCapaInvestigationResult, { readonly status: "validation_failed" }> {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, "investigation_plan") ||
    !Object.prototype.hasOwnProperty.call(value, "release") ||
    !isRecord(value.release) || Object.keys(value.release).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value.release, "confirmation") ||
    !Object.prototype.hasOwnProperty.call(value.release, "comment")) {
    return { status: "validation_failed", reason_code: "INVALID_INVESTIGATION_RELEASE_BODY" };
  }
  if (value.release.confirmation !== CAPA_INVESTIGATION_RELEASE_CONFIRMATION) {
    return { status: "validation_failed", reason_code: "INVALID_INVESTIGATION_RELEASE_CONFIRMATION" };
  }
  const comment = value.release.comment;
  if (comment !== null && (typeof comment !== "string" || comment.length === 0 ||
    comment.trim() !== comment || comment.length > MAXIMUM_COMMENT_LENGTH)) {
    return { status: "validation_failed", reason_code: "INVALID_INVESTIGATION_RELEASE_COMMENT" };
  }
  const plan = validateCapaInvestigationPlan(value.investigation_plan);
  if (plan.status === "invalid") {
    return {
      status: "validation_failed",
      reason_code: "INVALID_INVESTIGATION_RELEASE_BODY",
      investigation_plan_reason_code: plan.reason_code,
    };
  }
  return {
    status: "valid",
    value: Object.freeze({
      investigation_plan: plan.value,
      release: Object.freeze({
        confirmation: CAPA_INVESTIGATION_RELEASE_CONFIRMATION,
        comment: comment as string | null,
      }),
    }),
  };
}

function requireIdempotencyKey(trace: RequestTrace): IdempotencyKey {
  const key = trace.idempotency_key;
  if (typeof key !== "string" || key.length === 0 ||
    key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH || key.trim() !== key) {
    throw new ReleaseCapaInvestigationIdempotencyConfigurationError();
  }
  return key;
}

function fingerprint(
  dependencies: ReleaseCapaInvestigationDependencies,
  command: ReleaseCapaInvestigationCommand,
  body: ValidatedReleaseBody,
): CapaWorkflowRequestFingerprint {
  return createHash("sha256").update(JSON.stringify({
    fingerprint_version: FINGERPRINT_VERSION,
    organization_id: command.tenant.organization_id,
    capa_case_id: command.capa_case_id,
    operation_code: OPERATION_CODE,
    expected_record_version: command.expected_record_version,
    expected_current_version_id: command.expected_current_version_id,
    investigation_plan: body.investigation_plan,
    release: body.release,
    configuration: {
      workflow_version: dependencies.configuration.workflow_version,
      investigation_plan_schema_version: CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
      audit_schema_version: dependencies.configuration.audit_schema_version,
    },
  }), "utf8").digest("hex") as CapaWorkflowRequestFingerprint;
}

async function sourceSections(
  dependencies: ReleaseCapaInvestigationDependencies,
  capaCase: CapaCase,
  sourceVersion: CapaCaseVersion,
): Promise<{ readonly all: readonly CapaSectionVersion[]; readonly prior: CapaSectionVersion | null }> {
  const all = await Promise.all(sourceVersion.section_version_ids.map((id) =>
    dependencies.capa_repository.findSectionVersionById(
      capaCase.organization_id, capaCase.capa_case_id, id,
    ),
  ));
  if (all.some((section) => section === null)) {
    throw new ReleaseCapaInvestigationIntegrityError("The S30 snapshot references a missing section.");
  }
  const verified = all as CapaSectionVersion[];
  if (verified.some((section) => section.organization_id !== capaCase.organization_id ||
    section.capa_case_id !== capaCase.capa_case_id)) {
    throw new ReleaseCapaInvestigationIntegrityError();
  }
  const plans = verified.filter((section) => section.section_type === CAPA_INVESTIGATION_PLAN_SECTION_TYPE);
  if (plans.length > 1) {
    throw new ReleaseCapaInvestigationIntegrityError("The S30 snapshot references multiple investigation plans.");
  }
  return { all: Object.freeze(verified), prior: plans[0] ?? null };
}

function nextSectionIds(
  sourceVersion: CapaCaseVersion,
  prior: CapaSectionVersion | null,
  nextId: CapaSectionVersionId,
): readonly CapaSectionVersionId[] {
  if (prior === null) return Object.freeze([...sourceVersion.section_version_ids, nextId]);
  let replacements = 0;
  const ids = sourceVersion.section_version_ids.map((id) => {
    if (id === prior.section_version_id) {
      replacements += 1;
      return nextId;
    }
    return id;
  });
  if (replacements !== 1) throw new ReleaseCapaInvestigationIntegrityError();
  return Object.freeze(ids);
}

async function replay(
  dependencies: ReleaseCapaInvestigationDependencies,
  record: CapaWorkflowIdempotencyRecord,
): Promise<ReleaseCapaInvestigationResult> {
  const capaCase = await dependencies.capa_repository.findCaseById(
    record.organization_id, record.capa_case_id,
  );
  const version = await dependencies.capa_repository.findCaseVersionById(
    record.organization_id, record.capa_case_id, record.resulting_case_version_id,
  );
  const audit = await dependencies.audit_repository.findEventById(
    record.organization_id, record.audit_event_id,
  );
  if (capaCase === null || version === null || audit === null ||
    version.status !== TARGET_STATE || version.parent_version_id !== record.source_case_version_id ||
    audit.event_type !== "EVT-STATE-TRANSITION") {
    throw new ReleaseCapaInvestigationIntegrityError("The G-03 replay record is incomplete.");
  }
  const sections = await Promise.all(version.section_version_ids.map((id) =>
    dependencies.capa_repository.findSectionVersionById(
      record.organization_id, record.capa_case_id, id,
    ),
  ));
  const plan = sections.filter((section): section is CapaSectionVersion =>
    section !== null && section.section_type === CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  );
  if (plan.length !== 1) throw new ReleaseCapaInvestigationIntegrityError("The G-03 replay plan is missing.");
  return {
    status: "already_released",
    capa_case: capaCase,
    case_version: version,
    investigation_plan_section_version: plan[0] as CapaSectionVersion,
    transition_audit_event_id: record.audit_event_id,
  };
}

export async function releaseCapaInvestigation(
  dependencies: ReleaseCapaInvestigationDependencies,
  command: ReleaseCapaInvestigationCommand,
): Promise<ReleaseCapaInvestigationResult> {
  const validated = validateBody(command.body);
  if (validated.status === "validation_failed") return validated;
  const readiness = evaluateCapaInvestigationPlanGateReadiness(validated.value.investigation_plan);
  if (readiness.status === "blocked") {
    return { status: "gate_blocked", blocker_codes: readiness.blocker_codes };
  }

  const trustedNow = dependencies.clock.now();
  if (!Number.isFinite(trustedNow.getTime())) throw new ReleaseCapaInvestigationIntegrityError("Trusted time is invalid.");
  const organizationId = command.tenant.organization_id;
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: command.authentication,
    tenant: command.tenant,
    resource: { organization_id: organizationId },
    operation: "release_investigation",
    trusted_now: trustedNow,
  });
  if (precondition.status === "denied") {
    return {
      status: "authorization_denied",
      reason_code: precondition.reason_code,
      policy_version: precondition.authorization_policy_version,
    };
  }
  if (command.authentication.principal.principal_type !== "human") {
    return {
      status: "authorization_denied",
      reason_code: "AUTHORIZED_HUMAN_REQUIRED",
      policy_version: command.tenant.authorization_policy_version,
    };
  }

  const capaCase = await dependencies.capa_repository.findCaseById(organizationId, command.capa_case_id);
  if (capaCase === null) return { status: "not_found_or_not_authorized" };
  const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
    organizationId, capaCase.capa_case_id, command.expected_current_version_id,
  );
  if (sourceVersion === null) return { status: "not_found_or_not_authorized" };
  if (sourceVersion.organization_id !== organizationId || sourceVersion.capa_case_id !== capaCase.capa_case_id) {
    throw new ReleaseCapaInvestigationIntegrityError();
  }

  const policy = await dependencies.authorization_policy.evaluate({
    authentication: command.authentication,
    tenant: command.tenant,
    operation: "release_investigation",
    resource: {
      organization_id: organizationId,
      resource_type: controlled("CAPA_CASE"),
      resource_id: capaCase.capa_case_id,
      resource_version_id: sourceVersion.case_version_id,
      capa_case_id: capaCase.capa_case_id,
      case_version_id: sourceVersion.case_version_id,
      workflow_state: sourceVersion.status,
    },
    purpose: dependencies.configuration.authorization_purpose,
    trusted_now: trustedNow,
  });
  if (policy.decision !== "allow") {
    return {
      status: "authorization_denied",
      reason_code: policy.reason_code,
      policy_version: policy.policy_version,
    };
  }
  if (sourceVersion.status !== SOURCE_STATE) {
    return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
  }

  const sections = await sourceSections(dependencies, capaCase, sourceVersion);
  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  const requestFingerprint = fingerprint(dependencies, command, validated.value);
  const nextVersionId = dependencies.id_generator.generateCaseVersionId();
  const planSectionId = dependencies.id_generator.generateSectionVersionId();
  const auditEventId = dependencies.id_generator.generateAuditEventId();
  const timestamp = iso(trustedNow);
  const actor = { actor_type: "human" as const, actor_id: command.authentication.principal.user_id };

  const planSection: CapaSectionVersion = {
    organization_id: organizationId,
    section_version_id: planSectionId,
    capa_case_id: capaCase.capa_case_id,
    section_type: controlled(CAPA_INVESTIGATION_PLAN_SECTION_TYPE),
    version_number: sections.prior === null ? 1 : sections.prior.version_number + 1,
    ...(sections.prior === null ? {} : { parent_version_id: sections.prior.section_version_id }),
    schema_version: CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
    content: validated.value.investigation_plan as unknown as Readonly<Record<string, unknown>>,
    change_reason: "Release actionable investigation plan at G-03",
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };
  const nextVersion: CapaCaseVersion = {
    organization_id: organizationId,
    case_version_id: nextVersionId,
    capa_case_id: capaCase.capa_case_id,
    version_number: sourceVersion.version_number + 1,
    parent_version_id: sourceVersion.case_version_id,
    change_reason: TRANSITION_MEANING,
    status: TARGET_STATE,
    section_version_ids: nextSectionIds(sourceVersion, sections.prior, planSectionId),
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };

  try {
    const result = await dependencies.transaction_manager.runInTransaction(
      command.request_trace,
      async (transaction) => {
        const claim = await dependencies.workflow_idempotency_repository.claimWorkflowOperation(transaction, {
          organization_id: organizationId,
          idempotency_key: idempotencyKey,
          operation_code: controlled(OPERATION_CODE),
          request_fingerprint: requestFingerprint,
          capa_case_id: capaCase.capa_case_id,
          source_case_version_id: sourceVersion.case_version_id,
          resulting_case_version_id: nextVersionId,
          audit_event_id: auditEventId,
        });
        if (claim.status === "conflict") return { kind: "conflict" as const };
        if (claim.status === "already_claimed") return { kind: "replay" as const, record: claim.record };
        const ownerUserIds = Object.freeze([...new Set(
          validated.value.investigation_plan.items
            .map((item) => item.owner_user_id)
            .filter((id): id is import("../domain/capa-types").UserId => id !== null),
        )]);
        const ineligibleOwnerIds = await dependencies.participant_eligibility_repository
          .findIneligibleInvestigationOwnerIds(
            transaction,
            organizationId,
            ownerUserIds,
            trustedNow,
          );
        if (ineligibleOwnerIds.length > 0) throw new ReleaseOwnerEligibilityError();
        if (capaCase.status !== SOURCE_STATE) throw new ReleaseWorkflowError();
        if (capaCase.record_version !== command.expected_record_version) {
          throw new ReleaseConcurrencyError("RECORD_VERSION_CONFLICT");
        }
        if (capaCase.current_version_id !== command.expected_current_version_id) {
          throw new ReleaseConcurrencyError("CURRENT_VERSION_CONFLICT");
        }
        await dependencies.capa_repository.insertSectionVersion(transaction, planSection);
        await dependencies.capa_repository.insertCaseVersion(transaction, nextVersion);
        const advanced = await dependencies.capa_repository.advanceCurrentVersion(transaction, {
          organization_id: organizationId,
          capa_case_id: capaCase.capa_case_id,
          expected_record_version: command.expected_record_version,
          expected_current_version_id: command.expected_current_version_id,
          next_current_version_id: nextVersionId,
          next_status: TARGET_STATE,
          updated_at: timestamp,
          updated_by: actor,
        });
        if (advanced.status === "conflict") throw new ReleaseConcurrencyError(advanced.reason_code);

        const audit: AuditEvent = {
          organization_id: organizationId,
          event_id: auditEventId,
          event_type: controlled("EVT-STATE-TRANSITION"),
          schema_version: dependencies.configuration.audit_schema_version,
          aggregate_type: controlled("CAPA_CASE"),
          aggregate_id: capaCase.capa_case_id,
          aggregate_version: advanced.capa_case.record_version,
          actor,
          occurred_at: timestamp,
          request_id: command.request_trace.request_id,
          correlation_id: command.request_trace.correlation_id,
          idempotency_key: idempotencyKey,
          action: controlled(OPERATION_CODE),
          target: {
            object_type: controlled("CAPA_CASE"),
            object_id: capaCase.capa_case_id,
            object_version_id: nextVersionId,
          },
          outcome: "succeeded",
          ...(validated.value.release.comment === null ? {} : { reason: validated.value.release.comment }),
          change: {
            before_ref: {
              object_type: controlled("CAPA_CASE"),
              object_id: capaCase.capa_case_id,
              object_version_id: sourceVersion.case_version_id,
            },
            after_ref: {
              object_type: controlled("CAPA_CASE"),
              object_id: capaCase.capa_case_id,
              object_version_id: nextVersionId,
            },
          },
          configuration_versions: {
            workflow: dependencies.configuration.workflow_version,
            investigation_plan_schema: CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
            authorization_policy: policy.policy_version,
            audit_schema: dependencies.configuration.audit_schema_version,
          },
          metadata: {
            gate: GATE,
            transition_event: TRANSITION_MEANING,
            from_state: SOURCE_STATE,
            to_state: TARGET_STATE,
            confirmation: validated.value.release.confirmation,
            release_comment: validated.value.release.comment,
            source_case_version_id: sourceVersion.case_version_id,
            resulting_case_version_id: nextVersionId,
            investigation_plan_section_version_id: planSectionId,
            required_permission: "capa.case.submit",
            relied_on_role_assignment_ids: policy.relied_on_role_assignment_ids,
          },
        };
        const appended = await dependencies.audit_repository.appendEvent(transaction, audit);
        if (appended.status === "conflict") throw new AuditEventAppendConflictError();
        return {
          kind: "released" as const,
          completion: {
            capa_case: advanced.capa_case,
            case_version: nextVersion,
            investigation_plan_section_version: planSection,
            transition_audit_event_id: auditEventId,
          },
        };
      },
    );
    if (result.kind === "conflict") {
      return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
    }
    if (result.kind === "replay") return replay(dependencies, result.record);
    return { status: "released", ...result.completion };
  } catch (error) {
    if (error instanceof ReleaseConcurrencyError) {
      return { status: "concurrency_conflict", reason_code: error.reason_code };
    }
    if (error instanceof ReleaseWorkflowError) {
      return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
    }
    if (error instanceof ReleaseOwnerEligibilityError) {
      return { status: "owner_eligibility_failed", reason_code: "INELIGIBLE_INVESTIGATION_PLAN_OWNER" };
    }
    throw error;
  }
}
