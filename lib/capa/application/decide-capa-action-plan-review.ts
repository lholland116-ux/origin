import { createHash } from "node:crypto";

import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import {
  CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
  validateCapaActionPlanReviewDecision,
  type CapaActionPlanReviewDecision,
  type CapaActionPlanReviewDecisionContent,
} from "../domain/capa-action-plan-review-decision";
import {
  CAPA_ACTION_PLAN_SCHEMA_VERSION,
  CAPA_ACTION_PLAN_SECTION_TYPE,
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../domain/capa-action-plan";
import { CAPA_STATE } from "../domain/capa-state";
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
import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type {
  CapaActionPlanReviewDecisionRecord,
  CapaActionPlanReviewDecisionRepository,
} from "../../database/repositories/capa-action-plan-review-decision-repository";
import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
} from "../../database/repositories/capa-workflow-idempotency-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CreateCapaClock, CreateCapaIdGenerator } from "./create-capa";
import { AuditEventAppendConflictError } from "./create-capa";

const SOURCE_STATE = CAPA_STATE.ACTION_PLAN_REVIEW;
const APPROVE_TARGET_STATE = CAPA_STATE.IMPLEMENTATION_ACTIVE;
const RETURN_TARGET_STATE = CAPA_STATE.ACTION_PLANNING;
const OPERATION_CODE = "DECIDE_CAPA_ACTION_PLAN_REVIEW";
const AUTHORIZATION_OPERATION = "approve_action_plan" as const;
const APPROVE_TRANSITION_MEANING = "Approve action plan";
const RETURN_TRANSITION_MEANING = "Return for action planning";
const FINGERPRINT_VERSION = "decide-capa-action-plan-review-fingerprint-1";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;

const controlled = (value: string) => value as ControlledCode;
const iso = (value: Date) => value.toISOString() as IsoDateTime;

export interface DecideCapaActionPlanReviewConfiguration {
  readonly workflow_version: string;
  readonly audit_schema_version: string;
  readonly step_up_maximum_age_ms: number;
  readonly required_step_up_assurance: ControlledCode;
  readonly authorization_purpose: ControlledCode;
}

export interface DecideCapaActionPlanReviewDependencies {
  readonly transaction_manager: TransactionManager;
  readonly capa_repository: CapaRepository;
  readonly audit_repository: AuditRepository;
  readonly review_decision_repository: CapaActionPlanReviewDecisionRepository;
  readonly workflow_idempotency_repository: CapaWorkflowIdempotencyRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly id_generator: CreateCapaIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: DecideCapaActionPlanReviewConfiguration;
}

export interface DecideCapaActionPlanReviewCommand {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly capa_case_id: CapaCaseId;
  readonly expected_record_version: number;
  readonly expected_current_version_id: CapaCaseVersionId;
  readonly request_trace: RequestTrace;
  readonly body: unknown;
}

interface ValidatedCommandBody extends CapaActionPlanReviewDecisionContent {}

interface ReviewedActionPlan {
  readonly section: CapaSectionVersion;
  readonly content: CapaActionPlanContent;
}

interface CompletedDecision {
  readonly capa_case: CapaCase;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: typeof APPROVE_TARGET_STATE | typeof RETURN_TARGET_STATE;
  readonly decision: CapaActionPlanReviewDecision;
  readonly action_plan_section_version: CapaSectionVersion;
  readonly review_decision: CapaActionPlanReviewDecisionRecord;
  readonly transition_audit_event_id: AuditEventId;
}

export type DecideCapaActionPlanReviewResult =
  | ({ readonly status: "decided" } & CompletedDecision)
  | ({ readonly status: "already_decided" } & CompletedDecision)
  | {
      readonly status: "validation_failed";
      readonly reason_code:
        | "INVALID_ACTION_PLAN_REVIEW_DECISION"
        | "REVIEW_BASELINE_NOT_AUTHORITATIVE";
      readonly detail_reason_code?: string;
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
      readonly reason_code:
        | "WORKFLOW_STATE_NOT_ALLOWED"
        | "DECISION_ALREADY_COMMITTED";
    };

export class DecideCapaActionPlanReviewIntegrityError extends Error {
  constructor(message = "The authoritative S70 action-plan review source is inconsistent.") {
    super(message);
    this.name = "DecideCapaActionPlanReviewIntegrityError";
  }
}

export class DecideCapaActionPlanReviewIdempotencyConfigurationError extends Error {
  constructor() {
    super("Action-plan review requires a valid idempotency key.");
    this.name = "DecideCapaActionPlanReviewIdempotencyConfigurationError";
  }
}

class ReviewConcurrencyError extends Error {
  constructor(
    readonly reason_code:
      | "RECORD_VERSION_CONFLICT"
      | "CURRENT_VERSION_CONFLICT"
      | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  ) {
    super("The CAPA changed before action-plan review could be committed.");
  }
}

class ReviewWorkflowError extends Error {}
class ReviewDecisionConflictError extends Error {}

function requireIdempotencyKey(trace: RequestTrace): IdempotencyKey {
  const key = trace.idempotency_key;
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH ||
    key.trim() !== key
  ) {
    throw new DecideCapaActionPlanReviewIdempotencyConfigurationError();
  }
  return key;
}

function targetState(decision: CapaActionPlanReviewDecision):
  | typeof APPROVE_TARGET_STATE
  | typeof RETURN_TARGET_STATE {
  return decision === "approve" ? APPROVE_TARGET_STATE : RETURN_TARGET_STATE;
}

function transitionMeaning(decision: CapaActionPlanReviewDecision): string {
  return decision === "approve"
    ? APPROVE_TRANSITION_MEANING
    : RETURN_TRANSITION_MEANING;
}

function validateBody(value: unknown):
  | { readonly status: "valid"; readonly value: ValidatedCommandBody }
  | Extract<
      DecideCapaActionPlanReviewResult,
      { readonly status: "validation_failed" }
    > {
  const validated = validateCapaActionPlanReviewDecision(value);
  if (validated.status === "invalid") {
    return {
      status: "validation_failed",
      reason_code: "INVALID_ACTION_PLAN_REVIEW_DECISION",
      detail_reason_code: validated.reason_code,
    };
  }
  return { status: "valid", value: validated.value };
}

function requestFingerprint(
  dependencies: DecideCapaActionPlanReviewDependencies,
  command: DecideCapaActionPlanReviewCommand,
  body: ValidatedCommandBody,
): CapaWorkflowRequestFingerprint {
  return createHash("sha256")
    .update(
      JSON.stringify({
        fingerprint_version: FINGERPRINT_VERSION,
        organization_id: command.tenant.organization_id,
        capa_case_id: command.capa_case_id,
        operation_code: OPERATION_CODE,
        expected_record_version: command.expected_record_version,
        expected_current_version_id: command.expected_current_version_id,
        decision: body,
        configuration: {
          workflow_version: dependencies.configuration.workflow_version,
          audit_schema_version: dependencies.configuration.audit_schema_version,
        },
      }),
      "utf8",
    )
    .digest("hex") as CapaWorkflowRequestFingerprint;
}

async function loadReviewedActionPlan(
  dependencies: DecideCapaActionPlanReviewDependencies,
  capaCase: CapaCase,
  sourceVersion: CapaCaseVersion,
  actionPlanSectionVersionId: CapaSectionVersionId,
): Promise<ReviewedActionPlan | null> {
  if (
    new Set(sourceVersion.section_version_ids).size !==
    sourceVersion.section_version_ids.length
  ) {
    throw new DecideCapaActionPlanReviewIntegrityError(
      "The S70 snapshot contains duplicate section references.",
    );
  }
  if (!sourceVersion.section_version_ids.includes(actionPlanSectionVersionId)) {
    return null;
  }
  const sections = await Promise.all(
    sourceVersion.section_version_ids.map((id) =>
      dependencies.capa_repository.findSectionVersionById(
        capaCase.organization_id,
        capaCase.capa_case_id,
        id,
      ),
    ),
  );
  if (sections.some((section) => section === null)) {
    throw new DecideCapaActionPlanReviewIntegrityError(
      "The S70 snapshot references a missing section.",
    );
  }
  const verified = sections as CapaSectionVersion[];
  if (
    verified.some(
      (section) =>
        section.organization_id !== capaCase.organization_id ||
        section.capa_case_id !== capaCase.capa_case_id,
    )
  ) {
    throw new DecideCapaActionPlanReviewIntegrityError(
      "The S70 snapshot references an unauthorized section.",
    );
  }
  const actionPlans = verified.filter(
    (section) => section.section_type === CAPA_ACTION_PLAN_SECTION_TYPE,
  );
  if (
    actionPlans.length !== 1 ||
    actionPlans[0]!.section_version_id !== actionPlanSectionVersionId
  ) {
    return null;
  }
  const section = actionPlans[0]!;
  if (section.schema_version !== CAPA_ACTION_PLAN_SCHEMA_VERSION) return null;
  const validated = validateCapaActionPlan(section.content);
  if (validated.status !== "valid") return null;
  return { section, content: validated.value };
}

function completion(
  status: "decided" | "already_decided",
  capaCase: CapaCase,
  sourceVersion: CapaCaseVersion,
  resultingVersion: CapaCaseVersion,
  decision: CapaActionPlanReviewDecision,
  actionPlanSectionVersion: CapaSectionVersion,
  reviewDecision: CapaActionPlanReviewDecisionRecord,
  transitionAuditEventId: AuditEventId,
): DecideCapaActionPlanReviewResult {
  return {
    status,
    capa_case: capaCase,
    source_case_version_id: sourceVersion.case_version_id,
    resulting_case_version_id: resultingVersion.case_version_id,
    record_version: capaCase.record_version,
    workflow_state: resultingVersion.status as
      | typeof APPROVE_TARGET_STATE
      | typeof RETURN_TARGET_STATE,
    decision,
    action_plan_section_version: actionPlanSectionVersion,
    review_decision: reviewDecision,
    transition_audit_event_id: transitionAuditEventId,
  };
}

async function replay(
  dependencies: DecideCapaActionPlanReviewDependencies,
  record: CapaWorkflowIdempotencyRecord,
  command: DecideCapaActionPlanReviewCommand,
  body: ValidatedCommandBody,
): Promise<DecideCapaActionPlanReviewResult> {
  const [capaCase, sourceVersion, resultingVersion, audit, reviewDecision] =
    await Promise.all([
      dependencies.capa_repository.findCaseById(
        record.organization_id,
        record.capa_case_id,
      ),
      dependencies.capa_repository.findCaseVersionById(
        record.organization_id,
        record.capa_case_id,
        record.source_case_version_id,
      ),
      dependencies.capa_repository.findCaseVersionById(
        record.organization_id,
        record.capa_case_id,
        record.resulting_case_version_id,
      ),
      dependencies.audit_repository.findEventById(
        record.organization_id,
        record.audit_event_id,
      ),
      dependencies.review_decision_repository.findDecision(
        record.organization_id,
        record.capa_case_id,
        record.source_case_version_id,
      ),
    ]);

  if (
    record.operation_code !== OPERATION_CODE ||
    capaCase === null ||
    capaCase.organization_id !== record.organization_id ||
    capaCase.capa_case_id !== record.capa_case_id ||
    sourceVersion === null ||
    sourceVersion.organization_id !== record.organization_id ||
    sourceVersion.capa_case_id !== record.capa_case_id ||
    sourceVersion.case_version_id !== record.source_case_version_id ||
    resultingVersion === null ||
    resultingVersion.organization_id !== record.organization_id ||
    resultingVersion.capa_case_id !== record.capa_case_id ||
    resultingVersion.case_version_id !== record.resulting_case_version_id ||
    audit === null ||
    reviewDecision === null ||
    reviewDecision.organization_id !== record.organization_id ||
    reviewDecision.capa_case_id !== record.capa_case_id ||
    reviewDecision.source_case_version_id !== sourceVersion.case_version_id ||
    reviewDecision.resulting_case_version_id !== resultingVersion.case_version_id ||
    reviewDecision.transition_audit_event_id !== audit.event_id ||
    reviewDecision.decided_at !== audit.occurred_at ||
    reviewDecision.schema_version !== CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION ||
    reviewDecision.decision !== body.decision ||
    reviewDecision.rationale !== body.rationale ||
    reviewDecision.action_plan_section_version_id !== body.action_plan_section_version_id ||
    body.source_case_version_id !== sourceVersion.case_version_id ||
    sourceVersion.status !== SOURCE_STATE ||
    resultingVersion.status !== targetState(body.decision) ||
    resultingVersion.parent_version_id !== sourceVersion.case_version_id ||
    audit.event_id !== record.audit_event_id ||
    audit.organization_id !== record.organization_id ||
    audit.event_type !== "EVT-STATE-TRANSITION" ||
    audit.action !== OPERATION_CODE ||
    audit.aggregate_type !== "CAPA_CASE" ||
    audit.aggregate_id !== record.capa_case_id ||
    audit.idempotency_key !== record.idempotency_key ||
    audit.metadata.from_state !== SOURCE_STATE ||
    audit.metadata.to_state !== resultingVersion.status ||
    audit.metadata.transition_event !== transitionMeaning(body.decision) ||
    audit.metadata.source_case_version_id !== sourceVersion.case_version_id ||
    audit.metadata.resulting_case_version_id !== resultingVersion.case_version_id ||
    audit.metadata.action_plan_section_version_id !== body.action_plan_section_version_id ||
    audit.metadata.review_decision !== body.decision ||
    audit.metadata.review_decision_schema_version !==
      CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION ||
    audit.aggregate_version !== resultingVersion.version_number ||
    audit.target.object_id !== record.capa_case_id ||
    audit.target.object_version_id !== resultingVersion.case_version_id ||
    resultingVersion.version_number !== sourceVersion.version_number + 1 ||
    requestFingerprint(dependencies, command, body) !== record.request_fingerprint
  ) {
    throw new DecideCapaActionPlanReviewIntegrityError(
      "The action-plan review replay record is incomplete.",
    );
  }

  const reviewedActionPlan = await loadReviewedActionPlan(
    dependencies,
    capaCase,
    sourceVersion,
    body.action_plan_section_version_id,
  );
  if (reviewedActionPlan === null) {
    throw new DecideCapaActionPlanReviewIntegrityError(
      "The action-plan review replay baseline is incomplete.",
    );
  }
  if (
    resultingVersion.section_version_ids.length !==
      sourceVersion.section_version_ids.length ||
    resultingVersion.section_version_ids.some(
      (id, index) => id !== sourceVersion.section_version_ids[index],
    ) ||
    !resultingVersion.section_version_ids.includes(
      reviewedActionPlan.section.section_version_id,
    )
  ) {
    throw new DecideCapaActionPlanReviewIntegrityError(
      "The action-plan review replay version does not preserve the submitted baseline.",
    );
  }

  const historicalCase: CapaCase = {
    ...capaCase,
    current_version_id: resultingVersion.case_version_id,
    status: resultingVersion.status,
    record_version: resultingVersion.version_number,
  };
  return completion(
    "already_decided",
    historicalCase,
    sourceVersion,
    resultingVersion,
    body.decision,
    reviewedActionPlan.section,
    reviewDecision,
    audit.event_id,
  );
}

export async function decideCapaActionPlanReview(
  dependencies: DecideCapaActionPlanReviewDependencies,
  command: DecideCapaActionPlanReviewCommand,
): Promise<DecideCapaActionPlanReviewResult> {
  const validated = validateBody(command.body);
  if (validated.status === "validation_failed") return validated;
  const body = validated.value;
  if (
    body.source_case_version_id !== command.expected_current_version_id
  ) {
    return {
      status: "validation_failed",
      reason_code: "REVIEW_BASELINE_NOT_AUTHORITATIVE",
      detail_reason_code: "SOURCE_CASE_VERSION_MISMATCH",
    };
  }

  const trustedNow = dependencies.clock.now();
  if (!Number.isFinite(trustedNow.getTime())) {
    throw new DecideCapaActionPlanReviewIntegrityError("Trusted time is invalid.");
  }
  const organizationId = command.tenant.organization_id;
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: command.authentication,
    tenant: command.tenant,
    resource: { organization_id: organizationId },
    operation: AUTHORIZATION_OPERATION,
    trusted_now: trustedNow,
    step_up_maximum_age_ms: dependencies.configuration.step_up_maximum_age_ms,
  });
  if (precondition.status === "denied") {
    if (precondition.reason_code === "STEP_UP_REAUTHENTICATION_REQUIRED") {
      return {
        status: "step_up_required",
        reason_code: precondition.reason_code,
        policy_version: precondition.authorization_policy_version,
        required_assurance: dependencies.configuration.required_step_up_assurance,
      };
    }
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
  const reviewerUserId = command.authentication.principal.user_id;

  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  const capaCase = await dependencies.capa_repository.findCaseById(
    organizationId,
    command.capa_case_id,
  );
  if (capaCase === null) return { status: "not_found_or_not_authorized" };
  const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
    organizationId,
    capaCase.capa_case_id,
    command.expected_current_version_id,
  );
  if (
    sourceVersion === null ||
    sourceVersion.organization_id !== organizationId ||
    sourceVersion.capa_case_id !== capaCase.capa_case_id
  ) {
    return { status: "not_found_or_not_authorized" };
  }
  const policy = await dependencies.authorization_policy.evaluate({
    authentication: command.authentication,
    tenant: command.tenant,
    operation: AUTHORIZATION_OPERATION,
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
  if (policy.decision === "deny") {
    return {
      status: "authorization_denied",
      reason_code: policy.reason_code,
      policy_version: policy.policy_version,
    };
  }
  if (policy.decision === "step_up") {
    return {
      status: "step_up_required",
      reason_code: policy.reason_code,
      policy_version: policy.policy_version,
      required_assurance: policy.required_assurance,
    };
  }

  const existingOperation = await dependencies.transaction_manager.runInTransaction(
    command.request_trace,
    (transaction) =>
      dependencies.workflow_idempotency_repository.findWorkflowOperation(
        transaction,
        {
          organization_id: organizationId,
          capa_case_id: command.capa_case_id,
          operation_code: controlled(OPERATION_CODE),
          idempotency_key: idempotencyKey,
        },
      ),
  );
  if (existingOperation !== null) {
    if (requestFingerprint(dependencies, command, body) !== existingOperation.request_fingerprint) {
      return {
        status: "idempotency_conflict",
        reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      };
    }
    return replay(dependencies, existingOperation, command, body);
  }

  if (sourceVersion.status !== SOURCE_STATE || capaCase.status !== SOURCE_STATE) {
    return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
  }
  if (capaCase.record_version !== command.expected_record_version) {
    return { status: "concurrency_conflict", reason_code: "RECORD_VERSION_CONFLICT" };
  }
  if (capaCase.current_version_id !== command.expected_current_version_id) {
    return { status: "concurrency_conflict", reason_code: "CURRENT_VERSION_CONFLICT" };
  }

  const reviewedActionPlan = await loadReviewedActionPlan(
    dependencies,
    capaCase,
    sourceVersion,
    body.action_plan_section_version_id,
  );
  if (reviewedActionPlan === null) {
    return {
      status: "validation_failed",
      reason_code: "REVIEW_BASELINE_NOT_AUTHORITATIVE",
    };
  }

  const resultingCaseVersionId = dependencies.id_generator.generateCaseVersionId();
  const transitionAuditEventId = dependencies.id_generator.generateAuditEventId();
  const fingerprint = requestFingerprint(dependencies, command, body);
  const timestamp = iso(trustedNow);
  const actor = {
    actor_type: "human" as const,
    actor_id: reviewerUserId,
  };
  const resultingVersion: CapaCaseVersion = {
    organization_id: organizationId,
    case_version_id: resultingCaseVersionId,
    capa_case_id: capaCase.capa_case_id,
    version_number: sourceVersion.version_number + 1,
    parent_version_id: sourceVersion.case_version_id,
    change_reason: transitionMeaning(body.decision),
    status: targetState(body.decision),
    section_version_ids: Object.freeze([...sourceVersion.section_version_ids]),
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };
  const transitionAudit: AuditEvent = {
    organization_id: organizationId,
    event_id: transitionAuditEventId,
    event_type: controlled("EVT-STATE-TRANSITION"),
    schema_version: dependencies.configuration.audit_schema_version,
    aggregate_type: controlled("CAPA_CASE"),
    aggregate_id: capaCase.capa_case_id,
    aggregate_version: command.expected_record_version + 1,
    actor,
    occurred_at: timestamp,
    request_id: command.request_trace.request_id,
    correlation_id: command.request_trace.correlation_id,
    idempotency_key: idempotencyKey,
    action: controlled(OPERATION_CODE),
    target: {
      object_type: controlled("CAPA_CASE"),
      object_id: capaCase.capa_case_id,
      object_version_id: resultingCaseVersionId,
    },
    outcome: "succeeded",
    reason: body.rationale,
    change: {
      before_ref: {
        object_type: controlled("CAPA_CASE"),
        object_id: capaCase.capa_case_id,
        object_version_id: sourceVersion.case_version_id,
      },
      after_ref: {
        object_type: controlled("CAPA_CASE"),
        object_id: capaCase.capa_case_id,
        object_version_id: resultingCaseVersionId,
      },
    },
    configuration_versions: {
      workflow: dependencies.configuration.workflow_version,
      authorization_policy: policy.policy_version,
      audit_schema: dependencies.configuration.audit_schema_version,
      review_decision_schema: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
    },
    metadata: {
      transition_event: transitionMeaning(body.decision),
      from_state: SOURCE_STATE,
      to_state: targetState(body.decision),
      source_case_version_id: sourceVersion.case_version_id,
      resulting_case_version_id: resultingCaseVersionId,
      action_plan_section_version_id: body.action_plan_section_version_id,
      review_decision: body.decision,
      review_decision_schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
      required_permission: "capa.gate.approve",
      rationale: body.rationale,
      relied_on_role_assignment_ids: policy.relied_on_role_assignment_ids,
    },
  };

  try {
    const result = await dependencies.transaction_manager.runInTransaction(
      command.request_trace,
      async (transaction) => {
        const claim = await dependencies.workflow_idempotency_repository.claimWorkflowOperation(
          transaction,
          {
            organization_id: organizationId,
            idempotency_key: idempotencyKey,
            operation_code: controlled(OPERATION_CODE),
            request_fingerprint: fingerprint,
            capa_case_id: capaCase.capa_case_id,
            source_case_version_id: sourceVersion.case_version_id,
            resulting_case_version_id: resultingCaseVersionId,
            audit_event_id: transitionAuditEventId,
          },
        );
        if (claim.status === "conflict") return { kind: "idempotency_conflict" as const };
        if (claim.status === "already_claimed") {
          return { kind: "replay" as const, record: claim.record };
        }
        if (capaCase.status !== SOURCE_STATE) throw new ReviewWorkflowError();
        if (capaCase.record_version !== command.expected_record_version) {
          throw new ReviewConcurrencyError("RECORD_VERSION_CONFLICT");
        }
        if (capaCase.current_version_id !== command.expected_current_version_id) {
          throw new ReviewConcurrencyError("CURRENT_VERSION_CONFLICT");
        }

        await dependencies.capa_repository.insertCaseVersion(
          transaction,
          resultingVersion,
        );
        const advanced = await dependencies.capa_repository.advanceCurrentVersion(
          transaction,
          {
            organization_id: organizationId,
            capa_case_id: capaCase.capa_case_id,
            expected_record_version: command.expected_record_version,
            expected_current_version_id: command.expected_current_version_id,
            next_current_version_id: resultingCaseVersionId,
            next_status: targetState(body.decision),
            updated_at: timestamp,
            updated_by: actor,
          },
        );
        if (advanced.status === "conflict") {
          throw new ReviewConcurrencyError(advanced.reason_code);
        }
        if (advanced.capa_case.record_version !== capaCase.record_version + 1) {
          throw new DecideCapaActionPlanReviewIntegrityError(
            "The CAPA record version did not advance exactly once.",
          );
        }
        const appended = await dependencies.audit_repository.appendEvent(
          transaction,
          transitionAudit,
        );
        if (
          appended.status !== "appended" ||
          appended.event_id !== transitionAuditEventId
        ) {
          throw new AuditEventAppendConflictError();
        }
        const decisionRecord: CapaActionPlanReviewDecisionRecord = {
          organization_id: organizationId,
          capa_case_id: capaCase.capa_case_id,
          source_case_version_id: sourceVersion.case_version_id,
          action_plan_section_version_id: body.action_plan_section_version_id,
          schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
          decision: body.decision,
          rationale: body.rationale,
          reviewer_user_id: reviewerUserId,
          decided_at: timestamp,
          resulting_case_version_id: resultingCaseVersionId,
          transition_audit_event_id: transitionAuditEventId,
        };
        const saved = await dependencies.review_decision_repository.saveDecision(
          transaction,
          decisionRecord,
        );
        if (saved.status === "conflict") {
          throw new ReviewDecisionConflictError();
        }
        return {
          kind: "decided" as const,
          capa_case: advanced.capa_case,
          case_version: resultingVersion,
          action_plan_section_version: reviewedActionPlan.section,
          review_decision: saved.decision,
        };
      },
    );
    if (result.kind === "idempotency_conflict") {
      return {
        status: "idempotency_conflict",
        reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      };
    }
    if (result.kind === "replay") {
      return replay(dependencies, result.record, command, body);
    }
    return completion(
      "decided",
      result.capa_case,
      sourceVersion,
      result.case_version,
      body.decision,
      result.action_plan_section_version,
      result.review_decision,
      transitionAuditEventId,
    );
  } catch (error) {
    if (error instanceof ReviewConcurrencyError) {
      return { status: "concurrency_conflict", reason_code: error.reason_code };
    }
    if (error instanceof ReviewWorkflowError) {
      return {
        status: "workflow_conflict",
        reason_code: "WORKFLOW_STATE_NOT_ALLOWED",
      };
    }
    if (error instanceof ReviewDecisionConflictError) {
      return {
        status: "workflow_conflict",
        reason_code: "DECISION_ALREADY_COMMITTED",
      };
    }
    throw error;
  }
}
