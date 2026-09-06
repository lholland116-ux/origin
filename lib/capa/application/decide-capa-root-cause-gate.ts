import { createHash } from "node:crypto";

import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
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
import type { CreateCapaClock, CreateCapaIdGenerator } from "./create-capa";
import { AuditEventAppendConflictError } from "./create-capa";

const SOURCE_STATE = CAPA_STATE.ROOT_CAUSE_REVIEW;
const APPROVAL_TARGET_STATE = CAPA_STATE.ACTION_PLANNING;
const RETURN_TARGET_STATE = CAPA_STATE.INVESTIGATION_ACTIVE;
const OPERATION_CODE = "DECIDE_CAPA_ROOT_CAUSE_GATE";
const APPROVAL_OPERATION = "approve_root_cause";
const RETURN_OPERATION = "return_root_cause_for_investigation";
const GATE_CODE = "G-04";
const APPROVAL_CONFIRMATION = "G04_ROOT_CAUSE_APPROVAL_CONFIRMED";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;
const MAXIMUM_RATIONALE_LENGTH = 4_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CAPA_ROOT_CAUSE_GATE_APPROVAL_CONFIRMATION = APPROVAL_CONFIRMATION;

export interface DecideCapaRootCauseGateConfiguration {
  readonly workflow_version: string;
  readonly audit_schema_version: string;
  readonly step_up_maximum_age_ms: number;
  readonly required_step_up_assurance: ControlledCode;
  readonly authorization_purpose: ControlledCode;
}

export interface DecideCapaRootCauseGateDependencies {
  readonly transaction_manager: TransactionManager;
  readonly capa_repository: CapaRepository;
  readonly audit_repository: AuditRepository;
  readonly workflow_idempotency_repository: CapaWorkflowIdempotencyRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly id_generator: CreateCapaIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: DecideCapaRootCauseGateConfiguration;
}

export interface DecideCapaRootCauseGateCommand {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly capa_case_id: CapaCaseId;
  readonly request_trace: RequestTrace;
  readonly body: unknown;
}

type GateDecision = "approve" | "return_for_investigation";
type GateOperation = typeof APPROVAL_OPERATION | typeof RETURN_OPERATION;
type TargetState = typeof APPROVAL_TARGET_STATE | typeof RETURN_TARGET_STATE;

interface ValidatedBody {
  readonly expected_record_version: number;
  readonly expected_current_version_id: CapaCaseVersionId;
  readonly decision: GateDecision;
  readonly operation: GateOperation;
  readonly target_state: TargetState;
  readonly rationale: string;
  readonly confirmation?: typeof APPROVAL_CONFIRMATION;
}

interface CompletedDecision {
  readonly capa_case: CapaCase;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: TargetState;
  readonly decision: GateDecision;
  readonly approval_audit_event_id: AuditEventId;
  readonly transition_audit_event_id: AuditEventId;
}

export type DecideCapaRootCauseGateResult =
  | ({ readonly status: "decided" } & CompletedDecision)
  | ({ readonly status: "already_decided" } & CompletedDecision)
  | {
      readonly status: "validation_failed";
      readonly reason_code:
        | "INVALID_ROOT_CAUSE_GATE_BODY"
        | "INVALID_EXPECTED_RECORD_VERSION"
        | "INVALID_EXPECTED_CURRENT_VERSION_ID"
        | "INVALID_DECISION"
        | "INVALID_RATIONALE"
        | "INVALID_APPROVAL_CONFIRMATION";
    }
  | { readonly status: "not_found_or_not_authorized" }
  | {
      readonly status: "authorization_denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
  | {
      readonly status: "step_up_required";
      readonly reason_code: string;
      readonly policy_version: string;
      readonly required_assurance: ControlledCode;
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

export class DecideCapaRootCauseGateConfigurationError extends Error {}
export class DecideCapaRootCauseGateIntegrityError extends Error {}
export class DecideCapaRootCauseGateIdempotencyConfigurationError extends Error {}

class GateConcurrencyError extends Error {
  constructor(
    readonly reason_code:
      | "RECORD_VERSION_CONFLICT"
      | "CURRENT_VERSION_CONFLICT"
      | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  ) {
    super("The CAPA changed before the root-cause gate could be completed.");
  }
}

class GateWorkflowError extends Error {}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function iso(value: Date): IsoDateTime {
  return value.toISOString() as IsoDateTime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isTrimmedRationale(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAXIMUM_RATIONALE_LENGTH && value.trim() === value;
}

function validateBody(value: unknown):
  | { readonly status: "valid"; readonly value: ValidatedBody }
  | Extract<DecideCapaRootCauseGateResult, { readonly status: "validation_failed" }> {
  if (!isRecord(value) || typeof value.expected_record_version !== "number" ||
    !Number.isSafeInteger(value.expected_record_version) || value.expected_record_version < 1) {
    return { status: "validation_failed", reason_code: "INVALID_EXPECTED_RECORD_VERSION" };
  }
  if (typeof value.expected_current_version_id !== "string" ||
    !UUID_PATTERN.test(value.expected_current_version_id)) {
    return { status: "validation_failed", reason_code: "INVALID_EXPECTED_CURRENT_VERSION_ID" };
  }
  if (value.decision === "approve") {
    if (!hasExactKeys(value, ["expected_record_version", "expected_current_version_id", "decision", "rationale", "confirmation"])) {
      return { status: "validation_failed", reason_code: "INVALID_ROOT_CAUSE_GATE_BODY" };
    }
    if (!isTrimmedRationale(value.rationale)) {
      return { status: "validation_failed", reason_code: "INVALID_RATIONALE" };
    }
    if (value.confirmation !== APPROVAL_CONFIRMATION) {
      return { status: "validation_failed", reason_code: "INVALID_APPROVAL_CONFIRMATION" };
    }
    return { status: "valid", value: Object.freeze({
      expected_record_version: value.expected_record_version,
      expected_current_version_id: value.expected_current_version_id as CapaCaseVersionId,
      decision: "approve",
      operation: APPROVAL_OPERATION,
      target_state: APPROVAL_TARGET_STATE,
      rationale: value.rationale,
      confirmation: APPROVAL_CONFIRMATION,
    }) };
  }
  if (value.decision === "return_for_investigation") {
    if (!hasExactKeys(value, ["expected_record_version", "expected_current_version_id", "decision", "rationale"])) {
      return { status: "validation_failed", reason_code: "INVALID_ROOT_CAUSE_GATE_BODY" };
    }
    if (!isTrimmedRationale(value.rationale)) {
      return { status: "validation_failed", reason_code: "INVALID_RATIONALE" };
    }
    return { status: "valid", value: Object.freeze({
      expected_record_version: value.expected_record_version,
      expected_current_version_id: value.expected_current_version_id as CapaCaseVersionId,
      decision: "return_for_investigation",
      operation: RETURN_OPERATION,
      target_state: RETURN_TARGET_STATE,
      rationale: value.rationale,
    }) };
  }
  return { status: "validation_failed", reason_code: "INVALID_DECISION" };
}

function requireIdempotencyKey(trace: RequestTrace): IdempotencyKey {
  const key = trace.idempotency_key;
  if (typeof key !== "string" || key.length === 0 ||
    key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH || key.trim() !== key) {
    throw new DecideCapaRootCauseGateIdempotencyConfigurationError(
      "The root-cause gate requires a valid idempotency key.",
    );
  }
  return key;
}

function requestFingerprint(
  dependencies: DecideCapaRootCauseGateDependencies,
  command: DecideCapaRootCauseGateCommand,
  body: ValidatedBody,
): CapaWorkflowRequestFingerprint {
  return createHash("sha256").update(JSON.stringify({
    fingerprint_version: "decide-capa-root-cause-gate-fingerprint-1",
    organization_id: command.tenant.organization_id,
    capa_case_id: command.capa_case_id,
    operation_code: OPERATION_CODE,
    body,
    configuration: dependencies.configuration,
  }), "utf8").digest("hex") as CapaWorkflowRequestFingerprint;
}

async function loadSourceSections(
  dependencies: DecideCapaRootCauseGateDependencies,
  capaCase: CapaCase,
  sourceVersion: CapaCaseVersion,
): Promise<readonly CapaSectionVersion[]> {
  if (new Set(sourceVersion.section_version_ids).size !== sourceVersion.section_version_ids.length) {
    throw new DecideCapaRootCauseGateIntegrityError("The S50 snapshot contains duplicate section references.");
  }
  const sections = await Promise.all(sourceVersion.section_version_ids.map((id) =>
    dependencies.capa_repository.findSectionVersionById(capaCase.organization_id, capaCase.capa_case_id, id),
  ));
  if (sections.some((section) => section === null)) {
    throw new DecideCapaRootCauseGateIntegrityError("The S50 snapshot references a missing section.");
  }
  const verified = sections as CapaSectionVersion[];
  if (verified.some((section) => section.organization_id !== capaCase.organization_id ||
    section.capa_case_id !== capaCase.capa_case_id)) {
    throw new DecideCapaRootCauseGateIntegrityError("The S50 snapshot references an unauthorized section.");
  }
  return Object.freeze(verified);
}

function completionFrom(
  status: "decided" | "already_decided",
  capaCase: CapaCase,
  sourceVersion: CapaCaseVersion,
  resultingVersion: CapaCaseVersion,
  decision: GateDecision,
  approvalAuditEventId: AuditEventId,
  transitionAuditEventId: AuditEventId,
): DecideCapaRootCauseGateResult {
  return {
    status,
    capa_case: capaCase,
    source_case_version_id: sourceVersion.case_version_id,
    resulting_case_version_id: resultingVersion.case_version_id,
    record_version: capaCase.record_version,
    workflow_state: resultingVersion.status as TargetState,
    decision,
    approval_audit_event_id: approvalAuditEventId,
    transition_audit_event_id: transitionAuditEventId,
  };
}

async function replay(
  dependencies: DecideCapaRootCauseGateDependencies,
  record: CapaWorkflowIdempotencyRecord,
): Promise<DecideCapaRootCauseGateResult> {
  const [capaCase, sourceVersion, resultingVersion, approvalEvent] = await Promise.all([
    dependencies.capa_repository.findCaseById(record.organization_id, record.capa_case_id),
    dependencies.capa_repository.findCaseVersionById(record.organization_id, record.capa_case_id, record.source_case_version_id),
    dependencies.capa_repository.findCaseVersionById(record.organization_id, record.capa_case_id, record.resulting_case_version_id),
    dependencies.audit_repository.findEventById(record.organization_id, record.audit_event_id),
  ]);
  if (capaCase === null || sourceVersion === null || resultingVersion === null || approvalEvent === null ||
    record.operation_code !== controlled(OPERATION_CODE) ||
    record.organization_id !== capaCase.organization_id || record.capa_case_id !== capaCase.capa_case_id ||
    sourceVersion.organization_id !== record.organization_id || sourceVersion.capa_case_id !== record.capa_case_id ||
    sourceVersion.case_version_id !== record.source_case_version_id || sourceVersion.status !== SOURCE_STATE ||
    resultingVersion.organization_id !== record.organization_id || resultingVersion.capa_case_id !== record.capa_case_id ||
    resultingVersion.case_version_id !== record.resulting_case_version_id ||
    resultingVersion.parent_version_id !== sourceVersion.case_version_id ||
    approvalEvent.organization_id !== record.organization_id || approvalEvent.event_id !== record.audit_event_id ||
    approvalEvent.event_type !== controlled("EVT-APPROVAL") || approvalEvent.action !== controlled(OPERATION_CODE) ||
    approvalEvent.aggregate_type !== controlled("CAPA_CASE") || approvalEvent.aggregate_id !== record.capa_case_id ||
    approvalEvent.target.object_id !== record.capa_case_id || approvalEvent.target.object_version_id !== resultingVersion.case_version_id ||
    approvalEvent.idempotency_key !== record.idempotency_key || approvalEvent.metadata.gate !== GATE_CODE) {
    throw new DecideCapaRootCauseGateIntegrityError("The root-cause gate replay record is incomplete.");
  }
  const decision = approvalEvent.metadata.decision === "approved"
    ? "approve"
    : approvalEvent.metadata.decision === "returned_for_investigation"
      ? "return_for_investigation"
      : null;
  const transitionEventId = approvalEvent.metadata.state_transition_event_id;
  if (decision === null || typeof transitionEventId !== "string" || !UUID_PATTERN.test(transitionEventId)) {
    throw new DecideCapaRootCauseGateIntegrityError("The root-cause gate replay decision is incomplete.");
  }
  const expectedOperation = decision === "approve" ? APPROVAL_OPERATION : RETURN_OPERATION;
  if (approvalEvent.metadata.operation !== expectedOperation) {
    throw new DecideCapaRootCauseGateIntegrityError("The root-cause gate replay operation is inconsistent with its decision.");
  }
  if ((decision === "approve" && resultingVersion.status !== APPROVAL_TARGET_STATE) ||
    (decision === "return_for_investigation" && resultingVersion.status !== RETURN_TARGET_STATE)) {
    throw new DecideCapaRootCauseGateIntegrityError("The root-cause gate replay target is inconsistent with its decision.");
  }
  const gateRecordVersion = approvalEvent.aggregate_version;
  if (!Number.isSafeInteger(gateRecordVersion) || (gateRecordVersion as number) < 1) {
    throw new DecideCapaRootCauseGateIntegrityError("The root-cause gate replay record version is incomplete.");
  }
  const transitionEvent = await dependencies.audit_repository.findEventById(
    record.organization_id,
    transitionEventId as AuditEventId,
  );
  if (transitionEvent === null || transitionEvent.organization_id !== record.organization_id ||
    transitionEvent.event_id !== transitionEventId || transitionEvent.event_type !== controlled("EVT-STATE-TRANSITION") ||
    transitionEvent.action !== controlled(OPERATION_CODE) || transitionEvent.aggregate_type !== controlled("CAPA_CASE") ||
    transitionEvent.aggregate_id !== record.capa_case_id || transitionEvent.target.object_id !== record.capa_case_id ||
    transitionEvent.target.object_version_id !== resultingVersion.case_version_id ||
    transitionEvent.idempotency_key !== record.idempotency_key || transitionEvent.aggregate_version !== gateRecordVersion ||
    transitionEvent.metadata.approval_event_id !== record.audit_event_id ||
    transitionEvent.metadata.from_state !== SOURCE_STATE || transitionEvent.metadata.to_state !== resultingVersion.status) {
    throw new DecideCapaRootCauseGateIntegrityError("The root-cause gate replay transition is incomplete.");
  }
  await loadSourceSections(dependencies, capaCase, sourceVersion);
  await loadSourceSections(dependencies, capaCase, resultingVersion);
  const historicalCase: CapaCase = {
    ...capaCase,
    current_version_id: resultingVersion.case_version_id,
    status: resultingVersion.status,
    record_version: gateRecordVersion as number,
  };
  return completionFrom(
    "already_decided",
    historicalCase,
    sourceVersion,
    resultingVersion,
    decision,
    record.audit_event_id,
    transitionEventId as AuditEventId,
  );
}

export async function decideCapaRootCauseGate(
  dependencies: DecideCapaRootCauseGateDependencies,
  command: DecideCapaRootCauseGateCommand,
): Promise<DecideCapaRootCauseGateResult> {
  const validated = validateBody(command.body);
  if (validated.status === "validation_failed") return validated;
  const trustedNow = dependencies.clock.now();
  if (!Number.isFinite(trustedNow.getTime())) {
    throw new DecideCapaRootCauseGateConfigurationError("Trusted server time is invalid.");
  }
  const organizationId = command.tenant.organization_id;
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: command.authentication,
    tenant: command.tenant,
    resource: { organization_id: organizationId },
    operation: validated.value.operation,
    trusted_now: trustedNow,
    step_up_maximum_age_ms: dependencies.configuration.step_up_maximum_age_ms,
  });
  if (precondition.status === "denied") {
    if (precondition.reason_code === "STEP_UP_REAUTHENTICATION_REQUIRED") {
      return { status: "step_up_required", reason_code: precondition.reason_code,
        policy_version: precondition.authorization_policy_version,
        required_assurance: dependencies.configuration.required_step_up_assurance };
    }
    return { status: "authorization_denied", reason_code: precondition.reason_code,
      policy_version: precondition.authorization_policy_version };
  }
  if (command.authentication.principal.principal_type !== "human") {
    return { status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED",
      policy_version: command.tenant.authorization_policy_version };
  }
  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  const capaCase = await dependencies.capa_repository.findCaseById(organizationId, command.capa_case_id);
  if (capaCase === null) return { status: "not_found_or_not_authorized" };
  const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
    organizationId, capaCase.capa_case_id, validated.value.expected_current_version_id,
  );
  if (sourceVersion === null) return { status: "not_found_or_not_authorized" };
  if (sourceVersion.organization_id !== organizationId || sourceVersion.capa_case_id !== capaCase.capa_case_id) {
    throw new DecideCapaRootCauseGateIntegrityError();
  }
  const policy = await dependencies.authorization_policy.evaluate({
    authentication: command.authentication,
    tenant: command.tenant,
    operation: validated.value.operation,
    resource: {
      organization_id: organizationId,
      resource_type: controlled("CAPA_CASE"),
      resource_id: capaCase.capa_case_id,
      resource_version_id: sourceVersion.case_version_id,
      capa_case_id: capaCase.capa_case_id,
      case_version_id: sourceVersion.case_version_id,
      workflow_state: sourceVersion.status,
      relationship: controlled(
        command.authentication.principal.user_id === capaCase.owner_user_id
          ? "CASE_OWNER"
          : "NOT_CASE_OWNER",
      ),
    },
    purpose: dependencies.configuration.authorization_purpose,
    trusted_now: trustedNow,
  });
  if (policy.decision === "deny") return { status: "authorization_denied", reason_code: policy.reason_code, policy_version: policy.policy_version };
  if (policy.decision === "step_up") return { status: "step_up_required", reason_code: policy.reason_code,
    policy_version: policy.policy_version, required_assurance: policy.required_assurance };
  if (sourceVersion.status !== SOURCE_STATE) {
    return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
  }
  const sourceSections = await loadSourceSections(dependencies, capaCase, sourceVersion);
  const requestFingerprintValue = requestFingerprint(dependencies, command, validated.value);
  const nextVersionId = dependencies.id_generator.generateCaseVersionId();
  const approvalAuditEventId = dependencies.id_generator.generateAuditEventId();
  const transitionAuditEventId = dependencies.id_generator.generateAuditEventId();
  const timestamp = iso(trustedNow);
  const actor = { actor_type: "human" as const, actor_id: command.authentication.principal.user_id };
  const nextVersion: CapaCaseVersion = {
    organization_id: organizationId,
    case_version_id: nextVersionId,
    capa_case_id: capaCase.capa_case_id,
    version_number: sourceVersion.version_number + 1,
    parent_version_id: sourceVersion.case_version_id,
    change_reason: "Decide CAPA root-cause gate",
    status: validated.value.target_state,
    section_version_ids: Object.freeze([...sourceVersion.section_version_ids]),
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };
  try {
    const transactionResult = await dependencies.transaction_manager.runInTransaction(
      command.request_trace,
      async (transaction) => {
        const claim = await dependencies.workflow_idempotency_repository.claimWorkflowOperation(transaction, {
          organization_id: organizationId,
          idempotency_key: idempotencyKey,
          operation_code: controlled(OPERATION_CODE),
          request_fingerprint: requestFingerprintValue,
          capa_case_id: capaCase.capa_case_id,
          source_case_version_id: sourceVersion.case_version_id,
          resulting_case_version_id: nextVersionId,
          audit_event_id: approvalAuditEventId,
        });
        if (claim.status === "conflict") return { kind: "conflict" as const };
        if (claim.status === "already_claimed") return { kind: "replay" as const, record: claim.record };
        if (capaCase.status !== SOURCE_STATE) throw new GateWorkflowError();
        if (capaCase.record_version !== validated.value.expected_record_version) throw new GateConcurrencyError("RECORD_VERSION_CONFLICT");
        if (capaCase.current_version_id !== validated.value.expected_current_version_id) throw new GateConcurrencyError("CURRENT_VERSION_CONFLICT");
        if (sourceSections.some((section) => section.organization_id !== organizationId || section.capa_case_id !== capaCase.capa_case_id)) {
          throw new DecideCapaRootCauseGateIntegrityError();
        }
        await dependencies.capa_repository.insertCaseVersion(transaction, nextVersion);
        const advanced = await dependencies.capa_repository.advanceCurrentVersion(transaction, {
          organization_id: organizationId,
          capa_case_id: capaCase.capa_case_id,
          expected_record_version: validated.value.expected_record_version,
          expected_current_version_id: validated.value.expected_current_version_id,
          next_current_version_id: nextVersionId,
          next_status: validated.value.target_state,
          updated_at: timestamp,
          updated_by: actor,
        });
        if (advanced.status === "conflict") throw new GateConcurrencyError(advanced.reason_code);
        if (advanced.capa_case.record_version !== capaCase.record_version + 1) {
          throw new DecideCapaRootCauseGateIntegrityError("The CAPA record version did not advance exactly once.");
        }
        const common = {
          workflow: dependencies.configuration.workflow_version,
          authorization_policy: policy.policy_version,
          audit_schema: dependencies.configuration.audit_schema_version,
        };
        const approvalEvent: AuditEvent = {
          organization_id: organizationId,
          event_id: approvalAuditEventId,
          event_type: controlled("EVT-APPROVAL"),
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
          reason: validated.value.rationale,
          change: { before_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: sourceVersion.case_version_id }, after_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: nextVersionId } },
          configuration_versions: common,
          metadata: {
            gate: GATE_CODE,
            operation: validated.value.operation,
            decision: validated.value.decision === "approve" ? "approved" : "returned_for_investigation",
            decision_meaning: validated.value.decision === "approve" ? "Root cause conclusion approved." : "Root cause returned for investigation.",
            rationale: validated.value.rationale,
            from_state: SOURCE_STATE,
            to_state: validated.value.target_state,
            state_transition_event_id: transitionAuditEventId,
            submitted_root_cause_package_preserved: true,
            relied_on_role_assignment_ids: policy.relied_on_role_assignment_ids,
          },
        };
        const transitionEvent: AuditEvent = {
          organization_id: organizationId,
          event_id: transitionAuditEventId,
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
          target: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: nextVersionId },
          outcome: "succeeded",
          reason: validated.value.rationale,
          change: { before_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: sourceVersion.case_version_id }, after_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: nextVersionId } },
          configuration_versions: common,
          metadata: {
            gate: GATE_CODE,
            transition_event: validated.value.decision === "approve" ? "Approve root cause conclusion" : "Return root cause for investigation",
            from_state: SOURCE_STATE,
            to_state: validated.value.target_state,
            approval_event_id: approvalAuditEventId,
            rationale: validated.value.rationale,
          },
        };
        const approvalAppend = await dependencies.audit_repository.appendEvent(transaction, approvalEvent);
        if (approvalAppend.status !== "appended" || approvalAppend.event_id !== approvalAuditEventId) throw new AuditEventAppendConflictError();
        const transitionAppend = await dependencies.audit_repository.appendEvent(transaction, transitionEvent);
        if (transitionAppend.status !== "appended" || transitionAppend.event_id !== transitionAuditEventId) throw new AuditEventAppendConflictError();
        return { kind: "decided" as const, capaCase: advanced.capa_case, nextVersion };
      },
    );
    if (transactionResult.kind === "conflict") return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
    if (transactionResult.kind === "replay") return replay(dependencies, transactionResult.record);
    return completionFrom("decided", transactionResult.capaCase, sourceVersion, transactionResult.nextVersion,
      validated.value.decision, approvalAuditEventId, transitionAuditEventId);
  } catch (error) {
    if (error instanceof GateConcurrencyError) return { status: "concurrency_conflict", reason_code: error.reason_code };
    if (error instanceof GateWorkflowError) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
    throw error;
  }
}
