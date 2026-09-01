import { createHash } from "node:crypto";

import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
} from "../../database/repositories/capa-workflow-idempotency-repository";
import type { TransactionManager } from "../../database/transactions";
import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import {
  CAPA_INVESTIGATION_PLAN_ITEM_STATUSES,
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  validateCapaInvestigationPlan,
  type CapaInvestigationPlanContent,
  type CapaInvestigationPlanItem,
  type CapaInvestigationPlanItemStatus,
  type CapaInvestigationPlanValidationReasonCode,
} from "../domain/capa-investigation-plan";
import { CAPA_STATE } from "../domain/capa-state";
import type {
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  ControlledCode,
  IdempotencyKey,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";
import { AuditEventAppendConflictError } from "./create-capa";
import type { CreateCapaClock, CreateCapaIdGenerator } from "./create-capa";

const STATE = CAPA_STATE.INVESTIGATION_ACTIVE;
const OPERATION_CODE = "UPDATE_CAPA_INVESTIGATION_PROGRESS";
const EVENT_TYPE = "EVT-SUBSTANTIVE-CHANGE";
const CHANGE_REASON = "Update investigation progress";
const FINGERPRINT_VERSION = "update-capa-investigation-progress-fingerprint-1";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;
const ADDRESSED_STATUSES = new Set<CapaInvestigationPlanItemStatus>([
  "completed",
  "dispositioned",
  "cancelled",
]);

export interface UpdateCapaInvestigationProgressConfiguration {
  readonly workflow_version: string;
  readonly audit_schema_version: string;
  readonly authorization_purpose: ControlledCode;
}

export interface UpdateCapaInvestigationProgressDependencies {
  readonly transaction_manager: TransactionManager;
  readonly capa_repository: CapaRepository;
  readonly audit_repository: AuditRepository;
  readonly workflow_idempotency_repository: CapaWorkflowIdempotencyRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly id_generator: CreateCapaIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: UpdateCapaInvestigationProgressConfiguration;
}

export interface UpdateCapaInvestigationProgressCommand {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly capa_case_id: CapaCaseId;
  readonly expected_record_version: number;
  readonly expected_current_version_id: CapaCaseVersionId;
  readonly item_id: string;
  readonly new_status: CapaInvestigationPlanItemStatus;
  readonly disposition: string | null;
  readonly disposition_rationale: string | null;
  readonly request_trace: RequestTrace;
}

interface CompletedUpdate {
  readonly capa_case: CapaCase;
  readonly case_version: CapaCaseVersion;
  readonly investigation_plan_section_version: CapaSectionVersion;
  readonly updated_item_id: string;
  readonly previous_item_status: CapaInvestigationPlanItemStatus;
  readonly new_item_status: CapaInvestigationPlanItemStatus;
  readonly audit_event_id: AuditEventId;
}

export type CapaInvestigationProgressTransitionReasonCode =
  | "INVALID_ITEM_STATUS_TRANSITION"
  | "OPEN_INVESTIGATION_DEPENDENCY"
  | "INVESTIGATION_ITEM_NOT_FOUND";

export type UpdateCapaInvestigationProgressResult =
  | ({ readonly status: "updated" } & CompletedUpdate)
  | ({ readonly status: "already_updated" } & CompletedUpdate)
  | {
      readonly status: "validation_failed";
      readonly reason_code: "INVALID_INVESTIGATION_PROGRESS";
      readonly investigation_plan_reason_code?: CapaInvestigationPlanValidationReasonCode;
    }
  | {
      readonly status: "transition_conflict";
      readonly reason_code: CapaInvestigationProgressTransitionReasonCode;
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

export class UpdateCapaInvestigationProgressIntegrityError extends Error {
  constructor(message = "The authoritative S40 investigation progress source is inconsistent.") {
    super(message);
    this.name = "UpdateCapaInvestigationProgressIntegrityError";
  }
}

export class UpdateCapaInvestigationProgressIdempotencyConfigurationError extends Error {
  constructor() {
    super("Investigation progress requires a valid idempotency key.");
    this.name = "UpdateCapaInvestigationProgressIdempotencyConfigurationError";
  }
}

class ProgressConcurrencyError extends Error {
  constructor(readonly reason_code: "RECORD_VERSION_CONFLICT" | "CURRENT_VERSION_CONFLICT" | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED") {
    super("The CAPA changed before investigation progress could be committed.");
  }
}

class ProgressWorkflowError extends Error {}

const controlled = (value: string) => value as ControlledCode;
const iso = (value: Date) => value.toISOString() as IsoDateTime;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function requireIdempotencyKey(trace: RequestTrace): IdempotencyKey {
  const key = trace.idempotency_key;
  if (typeof key !== "string" || key.length === 0 || key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH || key.trim() !== key) {
    throw new UpdateCapaInvestigationProgressIdempotencyConfigurationError();
  }
  return key;
}

function isRecognizedStatus(value: unknown): value is CapaInvestigationPlanItemStatus {
  return CAPA_INVESTIGATION_PLAN_ITEM_STATUSES.some((status) => status === value);
}

function commandIsStructurallyValid(command: UpdateCapaInvestigationProgressCommand): boolean {
  if (!Number.isSafeInteger(command.expected_record_version) || command.expected_record_version < 1 ||
      typeof command.item_id !== "string" || command.item_id.length === 0 || command.item_id.trim() !== command.item_id ||
      !isRecognizedStatus(command.new_status)) return false;
  if (command.disposition !== null && (typeof command.disposition !== "string" || command.disposition.length === 0 || command.disposition.trim() !== command.disposition)) return false;
  if (command.disposition_rationale !== null && (typeof command.disposition_rationale !== "string" || command.disposition_rationale.length === 0 || command.disposition_rationale.trim() !== command.disposition_rationale)) return false;
  const requiresDisposition = command.new_status === "dispositioned" || command.new_status === "cancelled";
  return requiresDisposition
    ? command.disposition !== null && command.disposition_rationale !== null
    : command.disposition === null && command.disposition_rationale === null;
}

export function validateCapaInvestigationProgressTransition(
  previous: CapaInvestigationPlanItemStatus,
  next: CapaInvestigationPlanItemStatus,
): { readonly status: "allowed" } | { readonly status: "prohibited"; readonly reason_code: "INVALID_ITEM_STATUS_TRANSITION" } {
  const allowed = previous === "planned"
    ? next === "in_progress" || next === "completed" || next === "dispositioned" || next === "cancelled"
    : previous === "in_progress"
      ? next === "completed" || next === "dispositioned" || next === "cancelled"
      : false;
  return allowed ? { status: "allowed" } : { status: "prohibited", reason_code: "INVALID_ITEM_STATUS_TRANSITION" };
}

function fingerprint(
  dependencies: UpdateCapaInvestigationProgressDependencies,
  command: UpdateCapaInvestigationProgressCommand,
): CapaWorkflowRequestFingerprint {
  return createHash("sha256").update(JSON.stringify({
    fingerprint_version: FINGERPRINT_VERSION,
    organization_id: command.tenant.organization_id,
    capa_case_id: command.capa_case_id,
    operation_code: OPERATION_CODE,
    expected_record_version: command.expected_record_version,
    expected_current_version_id: command.expected_current_version_id,
    item_id: command.item_id,
    new_status: command.new_status,
    disposition: command.disposition,
    disposition_rationale: command.disposition_rationale,
    configuration: {
      workflow_version: dependencies.configuration.workflow_version,
      investigation_plan_schema_version: CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
      audit_schema_version: dependencies.configuration.audit_schema_version,
    },
  }), "utf8").digest("hex") as CapaWorkflowRequestFingerprint;
}

interface LoadedPlan {
  readonly all_sections: readonly CapaSectionVersion[];
  readonly section: CapaSectionVersion;
  readonly content: CapaInvestigationPlanContent;
}

async function loadPlan(
  dependencies: UpdateCapaInvestigationProgressDependencies,
  organizationId: CapaCase["organization_id"],
  capaCaseId: CapaCaseId,
  version: CapaCaseVersion,
): Promise<LoadedPlan> {
  if (new Set(version.section_version_ids).size !== version.section_version_ids.length) {
    throw new UpdateCapaInvestigationProgressIntegrityError("The S40 snapshot contains duplicate section references.");
  }
  const loaded = await Promise.all(version.section_version_ids.map((id) =>
    dependencies.capa_repository.findSectionVersionById(organizationId, capaCaseId, id)));
  if (loaded.some((section) => section === null)) {
    throw new UpdateCapaInvestigationProgressIntegrityError("The S40 snapshot references a missing section.");
  }
  const all = loaded as CapaSectionVersion[];
  if (all.some((section) => section.organization_id !== organizationId || section.capa_case_id !== capaCaseId)) {
    throw new UpdateCapaInvestigationProgressIntegrityError();
  }
  const plans = all.filter((section) => section.section_type === CAPA_INVESTIGATION_PLAN_SECTION_TYPE);
  if (plans.length !== 1 || plans[0]!.schema_version !== CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION ||
      !Number.isSafeInteger(plans[0]!.version_number) || plans[0]!.version_number < 1) {
    throw new UpdateCapaInvestigationProgressIntegrityError("The S40 snapshot does not contain one valid investigation plan.");
  }
  const validated = validateCapaInvestigationPlan(plans[0]!.content);
  if (validated.status === "invalid") {
    throw new UpdateCapaInvestigationProgressIntegrityError("The authoritative investigation plan is malformed.");
  }
  const itemIds = new Set(validated.value.items.map((item) => item.item_id));
  if (validated.value.items.some((item) =>
    item.dependency_item_ids.some((dependencyId) => !itemIds.has(dependencyId)))) {
    throw new UpdateCapaInvestigationProgressIntegrityError("The authoritative investigation plan has an unresolved dependency reference.");
  }
  return Object.freeze({ all_sections: Object.freeze(all), section: plans[0]!, content: validated.value });
}

function revisedPlan(
  plan: CapaInvestigationPlanContent,
  command: UpdateCapaInvestigationProgressCommand,
): { readonly status: "valid"; readonly content: CapaInvestigationPlanContent; readonly previous: CapaInvestigationPlanItem } |
   { readonly status: "transition_conflict"; readonly reason_code: CapaInvestigationProgressTransitionReasonCode } |
   { readonly status: "validation_failed"; readonly reason_code: CapaInvestigationPlanValidationReasonCode } {
  const index = plan.items.findIndex((item) => item.item_id === command.item_id);
  if (index < 0) return { status: "transition_conflict", reason_code: "INVESTIGATION_ITEM_NOT_FOUND" };
  const previous = plan.items[index]!;
  const transition = validateCapaInvestigationProgressTransition(previous.status, command.new_status);
  if (transition.status === "prohibited") return { status: "transition_conflict", reason_code: transition.reason_code };
  if (command.new_status === "in_progress" || command.new_status === "completed") {
    const byId = new Map(plan.items.map((item) => [item.item_id, item] as const));
    if (previous.dependency_item_ids.some((id) => !ADDRESSED_STATUSES.has(byId.get(id)?.status as CapaInvestigationPlanItemStatus))) {
      return { status: "transition_conflict", reason_code: "OPEN_INVESTIGATION_DEPENDENCY" };
    }
  }
  const items = plan.items.map((item, itemIndex) => itemIndex === index ? {
    ...item,
    status: command.new_status,
    disposition: command.disposition,
    disposition_rationale: command.disposition_rationale,
  } : item);
  const validated = validateCapaInvestigationPlan({ items });
  if (validated.status === "invalid") return { status: "validation_failed", reason_code: validated.reason_code };
  return { status: "valid", content: validated.value, previous };
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function unchangedExceptTarget(
  source: CapaInvestigationPlanContent,
  result: CapaInvestigationPlanContent,
  command: Pick<UpdateCapaInvestigationProgressCommand, "item_id" | "new_status" | "disposition" | "disposition_rationale">,
  previousStatus: CapaInvestigationPlanItemStatus,
): boolean {
  if (source.items.length !== result.items.length) return false;
  for (let index = 0; index < source.items.length; index += 1) {
    const before = source.items[index]!;
    const after = result.items[index]!;
    if (before.item_id !== after.item_id) return false;
    if (before.item_id !== command.item_id) {
      if (!same(before, after)) return false;
      continue;
    }
    const { status: beforeItemStatus, disposition: beforeDisposition, disposition_rationale: beforeRationale, ...beforeImmutable } = before;
    const { status: afterItemStatus, disposition: afterDisposition, disposition_rationale: afterRationale, ...afterImmutable } = after;
    void beforeDisposition; void beforeRationale;
    if (beforeItemStatus !== previousStatus || afterItemStatus !== command.new_status ||
        afterDisposition !== command.disposition || afterRationale !== command.disposition_rationale ||
        !same(beforeImmutable, afterImmutable)) return false;
  }
  return source.items.some((item) => item.item_id === command.item_id);
}

async function replay(
  dependencies: UpdateCapaInvestigationProgressDependencies,
  record: CapaWorkflowIdempotencyRecord,
  command: UpdateCapaInvestigationProgressCommand,
): Promise<UpdateCapaInvestigationProgressResult> {
  const [capaCase, sourceVersion, resultVersion, audit] = await Promise.all([
    dependencies.capa_repository.findCaseById(record.organization_id, record.capa_case_id),
    dependencies.capa_repository.findCaseVersionById(record.organization_id, record.capa_case_id, record.source_case_version_id),
    dependencies.capa_repository.findCaseVersionById(record.organization_id, record.capa_case_id, record.resulting_case_version_id),
    dependencies.audit_repository.findEventById(record.organization_id, record.audit_event_id),
  ]);
  if (record.operation_code !== OPERATION_CODE || capaCase === null || sourceVersion === null || resultVersion === null || audit === null ||
      capaCase.organization_id !== record.organization_id || capaCase.capa_case_id !== record.capa_case_id ||
      sourceVersion.organization_id !== record.organization_id || sourceVersion.capa_case_id !== record.capa_case_id || sourceVersion.status !== STATE ||
      sourceVersion.case_version_id !== record.source_case_version_id ||
      resultVersion.organization_id !== record.organization_id || resultVersion.capa_case_id !== record.capa_case_id || resultVersion.status !== STATE ||
      resultVersion.case_version_id !== record.resulting_case_version_id ||
      resultVersion.parent_version_id !== sourceVersion.case_version_id || resultVersion.version_number !== sourceVersion.version_number + 1 ||
      audit.event_id !== record.audit_event_id || audit.organization_id !== record.organization_id || audit.aggregate_type !== "CAPA_CASE" ||
      audit.aggregate_id !== record.capa_case_id || audit.aggregate_version !== resultVersion.version_number || audit.event_type !== EVENT_TYPE ||
      audit.action !== OPERATION_CODE || audit.target.object_type !== "CAPA_CASE" ||
      audit.target.object_id !== record.capa_case_id || audit.target.object_version_id !== resultVersion.case_version_id ||
      audit.change === undefined || audit.change.before_ref === undefined || audit.change.after_ref === undefined ||
      audit.change.before_ref.object_type !== "CAPA_CASE" ||
      audit.change.before_ref.object_id !== record.capa_case_id ||
      audit.change.before_ref.object_version_id !== sourceVersion.case_version_id ||
      audit.change.after_ref.object_type !== "CAPA_CASE" ||
      audit.change.after_ref.object_id !== record.capa_case_id ||
      audit.change.after_ref.object_version_id !== resultVersion.case_version_id ||
      audit.idempotency_key !== record.idempotency_key ||
      metadataString(audit.metadata.source_case_version_id) !== sourceVersion.case_version_id ||
      metadataString(audit.metadata.resulting_case_version_id) !== resultVersion.case_version_id ||
      metadataString(audit.metadata.item_id) !== command.item_id ||
      metadataString(audit.metadata.new_item_status) !== command.new_status) {
    throw new UpdateCapaInvestigationProgressIntegrityError("The investigation-progress replay record is inconsistent.");
  }
  const [source, result] = await Promise.all([
    loadPlan(dependencies, record.organization_id, record.capa_case_id, sourceVersion),
    loadPlan(dependencies, record.organization_id, record.capa_case_id, resultVersion),
  ]);
  const previousStatus = metadataString(audit.metadata.previous_item_status) as CapaInvestigationPlanItemStatus | null;
  const replayedRevision = revisedPlan(source.content, command);
  if (previousStatus === null || !isRecognizedStatus(previousStatus) ||
      replayedRevision.status !== "valid" || !same(replayedRevision.content, result.content) ||
      result.section.parent_version_id !== source.section.section_version_id ||
      result.section.version_number !== source.section.version_number + 1 ||
      metadataString(audit.metadata.previous_investigation_plan_section_version_id) !== source.section.section_version_id ||
      metadataString(audit.metadata.resulting_investigation_plan_section_version_id) !== result.section.section_version_id ||
      !unchangedExceptTarget(source.content, result.content, command, previousStatus)) {
    throw new UpdateCapaInvestigationProgressIntegrityError("The replay plan revision is inconsistent.");
  }
  const expectedSections = sourceVersion.section_version_ids.map((id) => id === source.section.section_version_id ? result.section.section_version_id : id);
  if (!same(expectedSections, resultVersion.section_version_ids) ||
      audit.metadata.disposition !== command.disposition || audit.metadata.disposition_rationale !== command.disposition_rationale) {
    throw new UpdateCapaInvestigationProgressIntegrityError("The replay preserved-section or audit metadata is inconsistent.");
  }
  return {
    status: "already_updated",
    capa_case: Object.freeze({
      ...capaCase,
      current_version_id: resultVersion.case_version_id,
      status: STATE,
      record_version: resultVersion.version_number,
      updated_at: resultVersion.effective_at,
      updated_by: resultVersion.created_by,
    }),
    case_version: resultVersion,
    investigation_plan_section_version: result.section,
    updated_item_id: command.item_id,
    previous_item_status: previousStatus,
    new_item_status: command.new_status,
    audit_event_id: record.audit_event_id,
  };
}

/** Controlled human S40 investigation execution; workflow state remains S40. */
export async function updateCapaInvestigationProgress(
  dependencies: UpdateCapaInvestigationProgressDependencies,
  command: UpdateCapaInvestigationProgressCommand,
): Promise<UpdateCapaInvestigationProgressResult> {
  if (!commandIsStructurallyValid(command)) return { status: "validation_failed", reason_code: "INVALID_INVESTIGATION_PROGRESS" };
  const trustedNow = dependencies.clock.now();
  if (!Number.isFinite(trustedNow.getTime())) throw new UpdateCapaInvestigationProgressIntegrityError("Trusted time is invalid.");
  const organizationId = command.tenant.organization_id;
  if (command.authentication.principal.principal_type !== "human") {
    return { status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED", policy_version: command.tenant.authorization_policy_version };
  }
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: command.authentication,
    tenant: command.tenant,
    resource: { organization_id: organizationId },
    operation: "edit_case",
    trusted_now: trustedNow,
  });
  if (precondition.status === "denied") return { status: "authorization_denied", reason_code: precondition.reason_code, policy_version: precondition.authorization_policy_version };
  const capaCase = await dependencies.capa_repository.findCaseById(organizationId, command.capa_case_id);
  if (capaCase === null) return { status: "not_found_or_not_authorized" };
  const sourceVersion = await dependencies.capa_repository.findCaseVersionById(organizationId, capaCase.capa_case_id, command.expected_current_version_id);
  if (sourceVersion === null) return { status: "not_found_or_not_authorized" };
  if (sourceVersion.organization_id !== organizationId || sourceVersion.capa_case_id !== capaCase.capa_case_id) throw new UpdateCapaInvestigationProgressIntegrityError();
  const policy = await dependencies.authorization_policy.evaluate({
    authentication: command.authentication,
    tenant: command.tenant,
    operation: "edit_case",
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
  if (policy.decision !== "allow") return { status: "authorization_denied", reason_code: policy.reason_code, policy_version: policy.policy_version };
  if (sourceVersion.status !== STATE) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
  const source = await loadPlan(dependencies, organizationId, capaCase.capa_case_id, sourceVersion);
  const revision = revisedPlan(source.content, command);
  if (revision.status === "transition_conflict") return revision;
  if (revision.status === "validation_failed") return { status: "validation_failed", reason_code: "INVALID_INVESTIGATION_PROGRESS", investigation_plan_reason_code: revision.reason_code };

  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  const requestFingerprint = fingerprint(dependencies, command);
  const nextVersionId = dependencies.id_generator.generateCaseVersionId();
  const nextPlanId = dependencies.id_generator.generateSectionVersionId();
  const auditEventId = dependencies.id_generator.generateAuditEventId();
  const timestamp = iso(trustedNow);
  const actor = { actor_type: "human" as const, actor_id: command.authentication.principal.user_id };
  const nextPlan: CapaSectionVersion = {
    organization_id: organizationId,
    section_version_id: nextPlanId,
    capa_case_id: capaCase.capa_case_id,
    section_type: controlled(CAPA_INVESTIGATION_PLAN_SECTION_TYPE),
    version_number: source.section.version_number + 1,
    parent_version_id: source.section.section_version_id,
    schema_version: CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
    content: revision.content as unknown as Readonly<Record<string, unknown>>,
    change_reason: CHANGE_REASON,
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };
  const replaced = sourceVersion.section_version_ids.map((id) => id === source.section.section_version_id ? nextPlanId : id);
  if (replaced.filter((id) => id === nextPlanId).length !== 1) throw new UpdateCapaInvestigationProgressIntegrityError("The investigation plan replacement is ambiguous.");
  const nextVersion: CapaCaseVersion = {
    organization_id: organizationId,
    case_version_id: nextVersionId,
    capa_case_id: capaCase.capa_case_id,
    version_number: sourceVersion.version_number + 1,
    parent_version_id: sourceVersion.case_version_id,
    change_reason: CHANGE_REASON,
    status: STATE,
    section_version_ids: Object.freeze(replaced),
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };

  try {
    const result = await dependencies.transaction_manager.runInTransaction(command.request_trace, async (transaction) => {
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
      if (capaCase.status !== STATE) throw new ProgressWorkflowError();
      if (capaCase.record_version !== command.expected_record_version) throw new ProgressConcurrencyError("RECORD_VERSION_CONFLICT");
      if (capaCase.current_version_id !== command.expected_current_version_id) throw new ProgressConcurrencyError("CURRENT_VERSION_CONFLICT");
      await dependencies.capa_repository.insertSectionVersion(transaction, nextPlan);
      await dependencies.capa_repository.insertCaseVersion(transaction, nextVersion);
      const advanced = await dependencies.capa_repository.advanceCurrentVersion(transaction, {
        organization_id: organizationId,
        capa_case_id: capaCase.capa_case_id,
        expected_record_version: command.expected_record_version,
        expected_current_version_id: command.expected_current_version_id,
        next_current_version_id: nextVersionId,
        next_status: STATE,
        updated_at: timestamp,
        updated_by: actor,
      });
      if (advanced.status === "conflict") throw new ProgressConcurrencyError(advanced.reason_code);
      if (advanced.capa_case.status !== STATE || advanced.capa_case.record_version !== capaCase.record_version + 1 || advanced.capa_case.current_version_id !== nextVersionId) {
        throw new UpdateCapaInvestigationProgressIntegrityError("The aggregate did not advance exactly once while remaining S40.");
      }
      const audit: AuditEvent = {
        organization_id: organizationId,
        event_id: auditEventId,
        event_type: controlled(EVENT_TYPE),
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
        target: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: nextVersionId },
        outcome: "succeeded",
        change: {
          before_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: sourceVersion.case_version_id },
          after_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: nextVersionId },
        },
        configuration_versions: {
          workflow: dependencies.configuration.workflow_version,
          investigation_plan_schema: CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
          authorization_policy: policy.policy_version,
          audit_schema: dependencies.configuration.audit_schema_version,
        },
        metadata: {
          source_case_version_id: sourceVersion.case_version_id,
          resulting_case_version_id: nextVersionId,
          previous_investigation_plan_section_version_id: source.section.section_version_id,
          resulting_investigation_plan_section_version_id: nextPlanId,
          item_id: command.item_id,
          previous_item_status: revision.previous.status,
          new_item_status: command.new_status,
          disposition: command.disposition,
          disposition_rationale: command.disposition_rationale,
          required_permission: "capa.case.edit",
          relied_on_role_assignment_ids: policy.relied_on_role_assignment_ids,
        },
      };
      const appended = await dependencies.audit_repository.appendEvent(transaction, audit);
      if (appended.status !== "appended" || appended.event_id !== auditEventId) throw new AuditEventAppendConflictError();
      return { kind: "updated" as const, completion: {
        capa_case: advanced.capa_case,
        case_version: nextVersion,
        investigation_plan_section_version: nextPlan,
        updated_item_id: command.item_id,
        previous_item_status: revision.previous.status,
        new_item_status: command.new_status,
        audit_event_id: auditEventId,
      } };
    });
    if (result.kind === "conflict") return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
    if (result.kind === "replay") return replay(dependencies, result.record, command);
    return { status: "updated", ...result.completion };
  } catch (error) {
    if (error instanceof ProgressConcurrencyError) return { status: "concurrency_conflict", reason_code: error.reason_code };
    if (error instanceof ProgressWorkflowError) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
    throw error;
  }
}
