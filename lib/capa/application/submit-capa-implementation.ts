import { createHash } from "node:crypto";

import {
  evaluateCapaAuthorizationPreconditions,
} from "../authorization/capa-permissions";
import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";
import {
  CAPA_ACTION_PLAN_SCHEMA_VERSION,
  CAPA_ACTION_PLAN_SECTION_TYPE,
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../domain/capa-action-plan";
import {
  CAPA_STATE,
  isAllowedCapaTransition,
} from "../domain/capa-state";
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
import type {
  AuthenticationContext,
} from "../../security/auth-context";
import type {
  TenantContext,
} from "../../security/tenant-context";
import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";
import type {
  CapaRepository,
  CapaTransactionReadRepository,
} from "../../database/repositories/capa-repository";
import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
} from "../../database/repositories/capa-workflow-idempotency-repository";
import type {
  CapaImplementationWorkspaceRecord,
  CapaImplementationWorkspaceRepository,
} from "../../database/repositories/capa-implementation-workspace-repository";
import type {
  CapaActionPlanReviewDecisionRepository,
  CapaActionPlanReviewDecisionTransactionReadRepository,
} from "../../database/repositories/capa-action-plan-review-decision-repository";
import type {
  TransactionContext,
  TransactionManager,
} from "../../database/transactions";
import type {
  CreateCapaClock,
  CreateCapaIdGenerator,
} from "./create-capa";
import {
  AuditEventAppendConflictError,
} from "./create-capa";
import {
  validateCapaImplementationDraftAgainstApprovedActionSet,
  evaluateCapaImplementationSubmissionReadiness,
} from "../implementation/capa-implementation-validator";
import type {
  CapaImplementationApprovedS70BaselineReference,
  CapaImplementationWorkspaceDraft,
} from "../implementation/capa-implementation-contract";
import {
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
  createCapaImplementationReviewBaselineContent,
  validateCapaImplementationReviewBaselineAgainstApprovedActionSet,
  type CapaImplementationReviewBaselineContent,
} from "../implementation/capa-implementation-review-baseline";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE,
  validateCapaImplementationReviewReturnResponseContent,
  validateCapaImplementationReviewReturnResponseDraft,
  type CapaImplementationReviewReturnResponseContent,
  type CapaImplementationReviewReturnResponseDraft,
} from "../implementation/capa-implementation-return-response-contract";
import type {
  CapaImplementationReturnCycle,
  CapaImplementationReturnCycleResolver,
} from "./capa-implementation-return-cycle-resolver";

const SOURCE_STATE = CAPA_STATE.IMPLEMENTATION_ACTIVE;
const TARGET_STATE = CAPA_STATE.IMPLEMENTATION_REVIEW;
const AUTHORIZATION_OPERATION = "submit_for_review" as const;
const TRANSITION_MEANING = "Submit implementation evidence for review";
const OPERATION_CODE = "SUBMIT_CAPA_IMPLEMENTATION";
const FINGERPRINT_VERSION = "submit-capa-implementation-fingerprint-1";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;

const controlled = (value: string) => value as ControlledCode;
const iso = (value: Date) => value.toISOString() as IsoDateTime;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ValidatedBody {
  readonly expected_draft_revision: number;
}

interface ResolvedBaseline {
  readonly reference: CapaImplementationApprovedS70BaselineReference;
  readonly action_plan: CapaActionPlanContent;
}

interface CurrentCaseContext {
  readonly capa_case: CapaCase;
  readonly case_version: CapaCaseVersion;
}

interface CompletedSubmission {
  readonly capa_case: CapaCase;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly implementation_review_baseline_section_version: CapaSectionVersion;
  readonly implementation_review_return_response_section_version?: CapaSectionVersion;
  readonly transition_audit_event_id: AuditEventId;
}

export interface SubmitCapaImplementationConfiguration {
  readonly workflow_version: string;
  readonly audit_schema_version: string;
  readonly authorization_purpose: ControlledCode;
}

export interface SubmitCapaImplementationDependencies {
  readonly transaction_manager: TransactionManager;
  readonly capa_repository:
    CapaRepository &
    CapaTransactionReadRepository;
  readonly audit_repository: AuditRepository;
  readonly workspace_repository: CapaImplementationWorkspaceRepository;
  readonly review_decision_repository:
    CapaActionPlanReviewDecisionRepository &
    CapaActionPlanReviewDecisionTransactionReadRepository;
  readonly return_cycle_resolver: CapaImplementationReturnCycleResolver;
  readonly workflow_idempotency_repository: CapaWorkflowIdempotencyRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly id_generator: CreateCapaIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: SubmitCapaImplementationConfiguration;
}

export interface SubmitCapaImplementationCommand {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly capa_case_id: CapaCaseId;
  readonly request_trace: RequestTrace;
  readonly body: unknown;
}

export type SubmitCapaImplementationResult =
  | ({ readonly status: "submitted" | "already_submitted" } & CompletedSubmission)
  | {
      readonly status: "validation_failed";
      readonly reason_code:
        | "INVALID_IMPLEMENTATION_SUBMISSION_BODY"
        | "IMPLEMENTATION_WORKSPACE_NOT_AVAILABLE"
        | "IMPLEMENTATION_BASELINE_NOT_AUTHORITATIVE"
        | "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_REQUIRED"
        | "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_INVALID"
        | "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_CONFLICT";
      readonly detail_reason_code?: string;
    }
  | {
      readonly status: "submission_blocked";
      readonly blocker_codes: readonly string[];
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
        | "WORKSPACE_DRAFT_REVISION_CONFLICT"
        | "RECORD_VERSION_CONFLICT"
        | "CURRENT_VERSION_CONFLICT"
        | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED";
    }
  | { readonly status: "workflow_conflict"; readonly reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };

export class SubmitCapaImplementationIntegrityError extends Error {
  constructor(message = "The authoritative S80 implementation submission source is inconsistent.") {
    super(message);
    this.name = "SubmitCapaImplementationIntegrityError";
  }
}

export class SubmitCapaImplementationIdempotencyConfigurationError extends Error {
  constructor() {
    super("Implementation submission requires a valid idempotency key.");
    this.name = "SubmitCapaImplementationIdempotencyConfigurationError";
  }
}

class SubmissionConcurrencyError extends Error {
  constructor(
    readonly reason_code:
      | "WORKSPACE_DRAFT_REVISION_CONFLICT"
      | "RECORD_VERSION_CONFLICT"
      | "CURRENT_VERSION_CONFLICT"
      | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  ) {
    super("The CAPA changed before implementation submission could be committed.");
  }
}

class SubmissionWorkflowError extends Error {}
class IdempotencyReplayConflictError extends Error {}

function validateBody(value: unknown):
  | { readonly status: "valid"; readonly value: ValidatedBody }
  | Extract<SubmitCapaImplementationResult, { readonly status: "validation_failed" }> {
  if (
    !record(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.expected_draft_revision !== "number" ||
    !Number.isSafeInteger(value.expected_draft_revision) ||
    value.expected_draft_revision < 1
  ) {
    return {
      status: "validation_failed",
      reason_code: "INVALID_IMPLEMENTATION_SUBMISSION_BODY",
    };
  }
  return {
    status: "valid",
    value: { expected_draft_revision: value.expected_draft_revision },
  };
}

function requireIdempotencyKey(trace: RequestTrace): IdempotencyKey {
  const key = trace.idempotency_key;
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH ||
    key.trim() !== key
  ) {
    throw new SubmitCapaImplementationIdempotencyConfigurationError();
  }
  return key;
}

function baselineEquals(
  left: CapaImplementationApprovedS70BaselineReference,
  right: CapaImplementationApprovedS70BaselineReference,
): boolean {
  return left.source_case_version_id === right.source_case_version_id &&
    left.approved_action_plan_section_id === right.approved_action_plan_section_id &&
    left.approval_decision_reference === right.approval_decision_reference;
}

async function currentCase(
  dependencies: SubmitCapaImplementationDependencies,
  organizationId: CapaCase["organization_id"],
  capaCaseId: CapaCaseId,
): Promise<CurrentCaseContext | null> {
  const capaCase = await dependencies.capa_repository.findCaseById(
    organizationId,
    capaCaseId,
  );
  if (
    capaCase === null ||
    capaCase.organization_id !== organizationId ||
    capaCase.capa_case_id !== capaCaseId
  ) return null;
  const caseVersion = await dependencies.capa_repository.findCaseVersionById(
    organizationId,
    capaCaseId,
    capaCase.current_version_id,
  );
  if (
    caseVersion === null ||
    caseVersion.organization_id !== organizationId ||
    caseVersion.capa_case_id !== capaCaseId ||
    caseVersion.case_version_id !== capaCase.current_version_id ||
    caseVersion.status !== capaCase.status ||
    caseVersion.version_number !== capaCase.record_version
  ) {
    throw new SubmitCapaImplementationIntegrityError(
      "The current S80 case/version boundary is inconsistent.",
    );
  }
  return { capa_case: capaCase, case_version: caseVersion };
}

async function resolveApprovedBaseline(
  dependencies: SubmitCapaImplementationDependencies,
  current: CurrentCaseContext,
  transaction?: TransactionContext,
  baselineHint?: CapaImplementationApprovedS70BaselineReference,
): Promise<ResolvedBaseline | null> {
  const organizationId = current.capa_case.organization_id;
  const sourceCaseVersionId = baselineHint?.source_case_version_id ?? current.case_version.parent_version_id;
  if (sourceCaseVersionId === undefined) return null;
  const sourceVersion = transaction === undefined
    ? await dependencies.capa_repository.findCaseVersionById(
        organizationId,
        current.capa_case.capa_case_id,
        sourceCaseVersionId,
      )
    : await dependencies.capa_repository.findCaseVersionByIdInTransaction(
        transaction,
        organizationId,
        current.capa_case.capa_case_id,
        sourceCaseVersionId,
      );
  if (
    sourceVersion === null ||
    sourceVersion.organization_id !== organizationId ||
    sourceVersion.capa_case_id !== current.capa_case.capa_case_id ||
    sourceVersion.status !== CAPA_STATE.ACTION_PLAN_REVIEW
  ) return null;

  const decision = transaction === undefined
    ? await dependencies.review_decision_repository.findDecision(
        organizationId,
        current.capa_case.capa_case_id,
        sourceCaseVersionId,
      )
    : await dependencies.review_decision_repository.findDecisionInTransaction(
        transaction,
        organizationId,
        current.capa_case.capa_case_id,
        sourceCaseVersionId,
      );
  if (
    decision === null ||
    decision.organization_id !== organizationId ||
    decision.capa_case_id !== current.capa_case.capa_case_id ||
    decision.source_case_version_id !== sourceCaseVersionId ||
    decision.decision !== "approve" ||
    (baselineHint !== undefined && (
      decision.action_plan_section_version_id !== baselineHint.approved_action_plan_section_id ||
      decision.transition_audit_event_id !== baselineHint.approval_decision_reference
    )) ||
    !sourceVersion.section_version_ids.includes(decision.action_plan_section_version_id)
  ) return null;

  const section = transaction === undefined
    ? await dependencies.capa_repository.findSectionVersionById(
        organizationId,
        current.capa_case.capa_case_id,
        decision.action_plan_section_version_id,
      )
    : await dependencies.capa_repository.findSectionVersionByIdInTransaction(
        transaction,
        organizationId,
        current.capa_case.capa_case_id,
        decision.action_plan_section_version_id,
      );
  if (
    section === null ||
    section.organization_id !== organizationId ||
    section.capa_case_id !== current.capa_case.capa_case_id ||
    section.section_type !== CAPA_ACTION_PLAN_SECTION_TYPE ||
    section.schema_version !== CAPA_ACTION_PLAN_SCHEMA_VERSION
  ) return null;
  const actionPlan = validateCapaActionPlan(section.content);
  if (actionPlan.status !== "valid") return null;
  const approvedImplementationEntry =
    decision.resulting_case_version_id === current.case_version.case_version_id &&
    (baselineHint === undefined || baselineHint.source_case_version_id === current.case_version.parent_version_id)
    ? current.case_version
    : transaction === undefined
      ? await dependencies.capa_repository.findCaseVersionById(
          organizationId,
          current.capa_case.capa_case_id,
          decision.resulting_case_version_id,
        )
      : await dependencies.capa_repository.findCaseVersionByIdInTransaction(
          transaction,
          organizationId,
          current.capa_case.capa_case_id,
          decision.resulting_case_version_id,
        );
  if (
    approvedImplementationEntry === null ||
    approvedImplementationEntry.status !== CAPA_STATE.IMPLEMENTATION_ACTIVE ||
    approvedImplementationEntry.parent_version_id !== sourceVersion.case_version_id ||
    !current.case_version.section_version_ids.includes(decision.action_plan_section_version_id)
  ) return null;
  return {
    reference: Object.freeze({
      source_case_version_id: sourceCaseVersionId,
      approved_action_plan_section_id: decision.action_plan_section_version_id,
      approval_decision_reference: decision.transition_audit_event_id,
    }),
    action_plan: actionPlan.value,
  };
}

function requestFingerprint(
  dependencies: SubmitCapaImplementationDependencies,
  command: SubmitCapaImplementationCommand,
  sourceCaseVersionId: CapaCaseVersionId,
  baseline: CapaImplementationApprovedS70BaselineReference,
  draft: CapaImplementationWorkspaceDraft,
  expectedDraftRevision: number,
): CapaWorkflowRequestFingerprint {
  return createHash("sha256")
    .update(JSON.stringify({
      fingerprint_version: FINGERPRINT_VERSION,
      organization_id: command.tenant.organization_id,
      capa_case_id: command.capa_case_id,
      operation_code: OPERATION_CODE,
      source_case_version_id: sourceCaseVersionId,
      expected_draft_revision: expectedDraftRevision,
      approved_s70_baseline: baseline,
      submitted_action_progress: draft.action_progress,
      implementation_review_return_response:
        draft.implementation_review_return_response,
      configuration: {
        workflow_version: dependencies.configuration.workflow_version,
        implementation_review_baseline_schema_version:
          CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION,
        audit_schema_version: dependencies.configuration.audit_schema_version,
      },
    }), "utf8")
    .digest("hex") as CapaWorkflowRequestFingerprint;
}

function baselineSection(
  organizationId: CapaCase["organization_id"],
  capaCaseId: CapaCaseId,
  sectionVersionId: CapaSectionVersionId,
  sourceCaseVersionId: CapaCaseVersionId,
  resultingCaseVersionId: CapaCaseVersionId,
  transitionAuditEventId: AuditEventId,
  draftRevision: number,
  draft: CapaImplementationWorkspaceDraft,
  baseline: CapaImplementationApprovedS70BaselineReference,
  userId: string,
  timestamp: IsoDateTime,
): CapaSectionVersion {
  const content: CapaImplementationReviewBaselineContent =
    createCapaImplementationReviewBaselineContent({
      approved_s70_baseline: baseline,
      source_s80_case_version_id: sourceCaseVersionId,
      source_s80_workspace_revision: draftRevision,
      resulting_s90_case_version_id: resultingCaseVersionId,
      transition_audit_event_id: transitionAuditEventId,
      submitted_by_user_id: userId as CapaImplementationReviewBaselineContent["submitted_by_user_id"],
      submitted_at: timestamp,
      action_progress: draft.action_progress,
    });
  return {
    organization_id: organizationId,
    section_version_id: sectionVersionId,
    capa_case_id: capaCaseId,
    section_type: controlled(CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE),
    version_number: 1,
    schema_version: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION,
    content: content as unknown as Readonly<Record<string, unknown>>,
    change_reason: TRANSITION_MEANING,
    effective_at: timestamp,
    created_at: timestamp,
    created_by: { actor_type: "human", actor_id: userId },
  };
}

interface PriorImplementationSections {
  readonly baseline: CapaSectionVersion | null;
  readonly return_response: CapaSectionVersion | null;
}

async function priorImplementationSections(
  dependencies: SubmitCapaImplementationDependencies,
  transaction: TransactionContext,
  current: CurrentCaseContext,
): Promise<PriorImplementationSections> {
  const sections = await Promise.all(current.case_version.section_version_ids.map((id) =>
    dependencies.capa_repository.findSectionVersionByIdInTransaction(
      transaction,
      current.capa_case.organization_id,
      current.capa_case.capa_case_id,
      id,
    ),
  ));
  if (sections.some((section) => section === null)) {
    throw new SubmitCapaImplementationIntegrityError("The S80 snapshot references a missing section.");
  }
  const baselineSections = (sections as CapaSectionVersion[]).filter((section) => section.section_type === CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE);
  const responseSections = (sections as CapaSectionVersion[]).filter((section) => section.section_type === CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE);
  if (baselineSections.length > 1 || responseSections.length > 1) {
    throw new SubmitCapaImplementationIntegrityError("The S80 snapshot has ambiguous implementation-review sections.");
  }
  if (responseSections[0] !== undefined && (responseSections[0].schema_version !== CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION || validateCapaImplementationReviewReturnResponseContent(responseSections[0].content).status !== "valid")) {
    throw new SubmitCapaImplementationIntegrityError("The prior implementation-review return response is malformed.");
  }
  return { baseline: baselineSections[0] ?? null, return_response: responseSections[0] ?? null };
}

function replacedImplementationSectionIds(
  sourceVersion: CapaCaseVersion,
  priorBaseline: CapaSectionVersion | null,
  nextBaseline: CapaSectionVersionId,
  priorReturnResponse: CapaSectionVersion | null,
  nextReturnResponse: CapaSectionVersionId | null,
): readonly CapaSectionVersionId[] {
  const replacements = new Map<CapaSectionVersionId, CapaSectionVersionId>();
  if (priorBaseline !== null) replacements.set(priorBaseline.section_version_id, nextBaseline);
  if (priorReturnResponse !== null && nextReturnResponse !== null) replacements.set(priorReturnResponse.section_version_id, nextReturnResponse);
  const ids = sourceVersion.section_version_ids.map((id) => replacements.get(id) ?? id);
  if (priorBaseline === null) ids.push(nextBaseline);
  if (priorReturnResponse === null && nextReturnResponse !== null) ids.push(nextReturnResponse);
  if (new Set(ids).size !== ids.length) throw new SubmitCapaImplementationIntegrityError("The resulting implementation section identity set is invalid.");
  return Object.freeze(ids);
}

function sameReturnCycle(response: CapaImplementationReviewReturnResponseDraft, cycle: CapaImplementationReturnCycle): boolean {
  return response.return_transition_audit_event_id === cycle.return_transition_audit_event_id && response.source_case_version_id === cycle.source_case_version_id && response.resulting_case_version_id === cycle.resulting_case_version_id;
}

function resolveReturnResponse(
  cycle: CapaImplementationReturnCycle | null,
  draft: CapaImplementationWorkspaceDraft,
): { readonly status: "not_required"; readonly draft: null } | { readonly status: "valid"; readonly draft: CapaImplementationReviewReturnResponseDraft; readonly cycle: CapaImplementationReturnCycle } | { readonly status: "validation_failed"; readonly reason_code: "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_REQUIRED" | "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_INVALID" | "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_CONFLICT" } {
  if (cycle === null) return draft.implementation_review_return_response === null ? { status: "not_required", draft: null } : { status: "validation_failed", reason_code: "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_CONFLICT" };
  if (draft.implementation_review_return_response === null) return { status: "validation_failed", reason_code: "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_REQUIRED" };
  const response = validateCapaImplementationReviewReturnResponseDraft(draft.implementation_review_return_response);
  if (response.status === "invalid") return { status: "validation_failed", reason_code: "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_INVALID" };
  if (!sameReturnCycle(response.value, cycle)) return { status: "validation_failed", reason_code: "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_CYCLE_CONFLICT" };
  return { status: "valid", draft: response.value, cycle };
}

function authoritativeReturnResponseContent(
  response: CapaImplementationReviewReturnResponseDraft,
  resubmittedCaseVersionId: CapaCaseVersionId,
  actorId: string,
  timestamp: IsoDateTime,
): CapaImplementationReviewReturnResponseContent {
  return Object.freeze({
    schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
    response_narrative: response.response_narrative,
    return_transition_audit_event_id: response.return_transition_audit_event_id,
    source_case_version_id: response.source_case_version_id,
    resulting_case_version_id: response.resulting_case_version_id,
    resubmitted_case_version_id: resubmittedCaseVersionId,
    responded_by: Object.freeze({ actor_type: "human" as const, actor_id: actorId as CapaImplementationReviewReturnResponseContent["responded_by"]["actor_id"] }),
    responded_at: timestamp,
  });
}

function completion(
  status: "submitted" | "already_submitted",
  capaCase: CapaCase,
  sourceVersion: CapaCaseVersion,
  resultingVersion: CapaCaseVersion,
  section: CapaSectionVersion,
  auditEventId: AuditEventId,
  returnResponseSection?: CapaSectionVersion,
): SubmitCapaImplementationResult {
  return {
    status,
    capa_case: capaCase,
    source_case_version_id: sourceVersion.case_version_id,
    resulting_case_version_id: resultingVersion.case_version_id,
    record_version: resultingVersion.version_number,
    implementation_review_baseline_section_version: section,
    ...(returnResponseSection === undefined
      ? {}
      : { implementation_review_return_response_section_version: returnResponseSection }),
    transition_audit_event_id: auditEventId,
  };
}

async function replay(
  dependencies: SubmitCapaImplementationDependencies,
  command: SubmitCapaImplementationCommand,
  body: ValidatedBody,
  idempotencyRecord: CapaWorkflowIdempotencyRecord,
): Promise<SubmitCapaImplementationResult> {
  const [capaCase, sourceVersion, resultingVersion, audit] =
    await Promise.all([
      dependencies.capa_repository.findCaseById(
        idempotencyRecord.organization_id,
        idempotencyRecord.capa_case_id,
      ),
      dependencies.capa_repository.findCaseVersionById(
        idempotencyRecord.organization_id,
        idempotencyRecord.capa_case_id,
        idempotencyRecord.source_case_version_id,
      ),
      dependencies.capa_repository.findCaseVersionById(
        idempotencyRecord.organization_id,
        idempotencyRecord.capa_case_id,
        idempotencyRecord.resulting_case_version_id,
      ),
      dependencies.audit_repository.findEventById(
        idempotencyRecord.organization_id,
        idempotencyRecord.audit_event_id,
      ),
    ]);
  if (
    idempotencyRecord.operation_code !== controlled(OPERATION_CODE) ||
    capaCase === null ||
    capaCase.organization_id !== idempotencyRecord.organization_id ||
    capaCase.capa_case_id !== idempotencyRecord.capa_case_id ||
    sourceVersion === null ||
    sourceVersion.organization_id !== idempotencyRecord.organization_id ||
    sourceVersion.capa_case_id !== idempotencyRecord.capa_case_id ||
    sourceVersion.case_version_id !== idempotencyRecord.source_case_version_id ||
    resultingVersion === null ||
    resultingVersion.organization_id !== idempotencyRecord.organization_id ||
    resultingVersion.capa_case_id !== idempotencyRecord.capa_case_id ||
    resultingVersion.case_version_id !== idempotencyRecord.resulting_case_version_id ||
    audit === null ||
    audit.organization_id !== idempotencyRecord.organization_id ||
    audit.event_type !== controlled("EVT-STATE-TRANSITION") ||
    audit.aggregate_type !== controlled("CAPA_CASE") ||
    audit.aggregate_id !== idempotencyRecord.capa_case_id ||
    audit.aggregate_version !== resultingVersion.version_number ||
    audit.outcome !== "succeeded" ||
    sourceVersion.status !== SOURCE_STATE ||
    resultingVersion.status !== TARGET_STATE ||
    resultingVersion.parent_version_id !== sourceVersion.case_version_id ||
    audit.event_id !== idempotencyRecord.audit_event_id ||
    audit.action !== controlled(OPERATION_CODE) ||
    audit.idempotency_key !== idempotencyRecord.idempotency_key ||
    audit.target.object_type !== controlled("CAPA_CASE") ||
    audit.target.object_id !== idempotencyRecord.capa_case_id ||
    audit.target.object_version_id !== resultingVersion.case_version_id ||
    audit.change?.before_ref?.object_type !== controlled("CAPA_CASE") ||
    audit.change?.before_ref?.object_id !== idempotencyRecord.capa_case_id ||
    audit.change?.before_ref?.object_version_id !== sourceVersion.case_version_id ||
    audit.change?.after_ref?.object_type !== controlled("CAPA_CASE") ||
    audit.change?.after_ref?.object_id !== idempotencyRecord.capa_case_id ||
    audit.change?.after_ref?.object_version_id !== resultingVersion.case_version_id ||
    audit.metadata.transition_event !== TRANSITION_MEANING ||
    audit.metadata.from_state !== SOURCE_STATE ||
    audit.metadata.to_state !== TARGET_STATE ||
    audit.metadata.source_case_version_id !== sourceVersion.case_version_id ||
    audit.metadata.resulting_case_version_id !== resultingVersion.case_version_id ||
    audit.metadata.implementation_review_baseline_section_version_id === undefined ||
    audit.metadata.workspace_draft_revision !== body.expected_draft_revision ||
    audit.actor.actor_type !== "human" ||
    audit.actor.actor_id === undefined
  ) {
    throw new SubmitCapaImplementationIntegrityError(
      "The implementation submission replay record is incomplete.",
    );
  }
  const sections = await Promise.all(resultingVersion.section_version_ids.map((id) =>
    dependencies.capa_repository.findSectionVersionById(
      idempotencyRecord.organization_id,
      idempotencyRecord.capa_case_id,
      id,
    ),
  ));
  const priorSections = await Promise.all(sourceVersion.section_version_ids.map((id) =>
    dependencies.capa_repository.findSectionVersionById(
      idempotencyRecord.organization_id,
      idempotencyRecord.capa_case_id,
      id,
    ),
  ));
  const priorBaseline = priorSections.find((section) => section?.section_type === CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE) ?? null;
  const priorReturnResponse = priorSections.find((section) => section?.section_type === CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE) ?? null;
  const returnResponseId = typeof audit?.metadata.implementation_review_return_response_section_version_id === "string"
    ? audit.metadata.implementation_review_return_response_section_version_id as CapaSectionVersionId
    : null;
  const expectedSectionIds = replacedImplementationSectionIds(sourceVersion, priorBaseline, audit.metadata.implementation_review_baseline_section_version_id as CapaSectionVersionId, priorReturnResponse, returnResponseId);
  if (
    sections.some((section) =>
      section === null ||
      section.organization_id !== idempotencyRecord.organization_id ||
      section.capa_case_id !== idempotencyRecord.capa_case_id,
    ) ||
    new Set(resultingVersion.section_version_ids).size !==
      resultingVersion.section_version_ids.length ||
    JSON.stringify(resultingVersion.section_version_ids) !== JSON.stringify(expectedSectionIds)
  ) {
    throw new SubmitCapaImplementationIntegrityError(
      "The implementation submission case-version lineage is inconsistent.",
    );
  }
  const submittedSection = sections.find((candidate) =>
    candidate?.section_type === CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
  );
  const submittedSections = sections.filter((candidate) =>
    candidate?.section_type === CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
  );
  if (
    submittedSections.length !== 1 ||
    submittedSection === undefined ||
    submittedSection === null ||
    audit.metadata.implementation_review_baseline_section_version_id !== submittedSection.section_version_id ||
    submittedSection.schema_version !== CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION ||
    submittedSection.version_number !== 1 ||
    submittedSection.created_by.actor_type !== "human" ||
    submittedSection.created_by.actor_id === undefined
  ) throw new SubmitCapaImplementationIntegrityError("The implementation submission baseline is missing.");
  const content = validateCapaImplementationReviewBaselineAgainstApprovedActionSet(
    submittedSection.content,
    (record(submittedSection.content) && Array.isArray(submittedSection.content.action_progress)
      ? submittedSection.content.action_progress.map((item) =>
          record(item) && typeof item.approved_action_reference === "string"
            ? item.approved_action_reference
            : "",
        )
      : []),
  );
  if (content.status !== "valid") {
    throw new SubmitCapaImplementationIntegrityError("The implementation submission baseline replay is invalid.");
  }
  const auditBaseline = audit.metadata.approved_s70_baseline;
  if (
    content.value.transition_audit_event_id !== audit.event_id ||
    content.value.submitted_by_user_id !== submittedSection.created_by.actor_id ||
    content.value.submitted_by_user_id !== audit.actor.actor_id ||
    content.value.submitted_at !== submittedSection.created_at ||
    !record(auditBaseline) ||
    !baselineEquals(content.value.approved_s70_baseline, auditBaseline as unknown as CapaImplementationApprovedS70BaselineReference)
  ) {
    throw new SubmitCapaImplementationIntegrityError("The implementation submission attribution is inconsistent.");
  }
  if (content.value.source_s80_workspace_revision !== body.expected_draft_revision) {
    throw new IdempotencyReplayConflictError();
  }
  if (content.value.source_s80_case_version_id !== sourceVersion.case_version_id || content.value.resulting_s90_case_version_id !== resultingVersion.case_version_id) {
    throw new SubmitCapaImplementationIntegrityError("The implementation submission baseline replay is misbound.");
  }
  const responseSections = sections.filter((section): section is CapaSectionVersion => section?.section_type === CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE);
  let responseSection: CapaSectionVersion | undefined;
  let replayResponse: CapaImplementationReviewReturnResponseDraft | null = null;
  if (returnResponseId === null) {
    if (responseSections.length !== 0) throw new SubmitCapaImplementationIntegrityError("The implementation submission replay has an unexpected return response.");
  } else {
    responseSection = responseSections.find((section) => section.section_version_id === returnResponseId);
    if (responseSections.length !== 1 || responseSection === undefined || responseSection.schema_version !== CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION) throw new SubmitCapaImplementationIntegrityError("The implementation submission replay return response is missing.");
    const validatedResponse = validateCapaImplementationReviewReturnResponseContent(responseSection.content);
    if (validatedResponse.status !== "valid" || validatedResponse.value.resubmitted_case_version_id !== resultingVersion.case_version_id) throw new SubmitCapaImplementationIntegrityError("The implementation submission replay return response is invalid.");
    replayResponse = {
      schema_version: "capa-implementation-review-return-response-draft-1.0.0",
      return_transition_audit_event_id: validatedResponse.value.return_transition_audit_event_id,
      source_case_version_id: validatedResponse.value.source_case_version_id,
      resulting_case_version_id: validatedResponse.value.resulting_case_version_id,
      response_narrative: validatedResponse.value.response_narrative,
    };
  }
  const sourceContext: CurrentCaseContext = {
    capa_case: {
      ...capaCase,
      current_version_id: sourceVersion.case_version_id,
      status: SOURCE_STATE,
      record_version: sourceVersion.version_number,
    },
    case_version: sourceVersion,
  };
  const authoritativeBaseline = await resolveApprovedBaseline(
    dependencies,
    sourceContext,
    undefined,
    content.value.approved_s70_baseline,
  );
  if (authoritativeBaseline === null || !baselineEquals(content.value.approved_s70_baseline, authoritativeBaseline.reference)) {
    throw new SubmitCapaImplementationIntegrityError("The implementation submission replay baseline is no longer authoritative.");
  }
  const replayDraft: CapaImplementationWorkspaceDraft = {
    schema_version: "capa-implementation-workspace-draft-1.0.0",
    action_progress: content.value.action_progress,
    implementation_review_return_response: replayResponse,
  };
  if (requestFingerprint(dependencies, command, sourceVersion.case_version_id, authoritativeBaseline.reference, replayDraft, body.expected_draft_revision) !== idempotencyRecord.request_fingerprint) {
    throw new IdempotencyReplayConflictError();
  }
  const historicalCase: CapaCase = {
    ...capaCase,
    current_version_id: resultingVersion.case_version_id,
    status: resultingVersion.status,
    record_version: resultingVersion.version_number,
  };
  return completion("already_submitted", historicalCase, sourceVersion, resultingVersion, submittedSection, audit.event_id, responseSection);
}

export async function submitCapaImplementation(
  dependencies: SubmitCapaImplementationDependencies,
  command: SubmitCapaImplementationCommand,
): Promise<SubmitCapaImplementationResult> {
  const validated = validateBody(command.body);
  if (validated.status === "validation_failed") return validated;
  const body = validated.value;
  const trustedNow = dependencies.clock.now();
  if (!Number.isFinite(trustedNow.getTime())) throw new SubmitCapaImplementationIntegrityError("Trusted time is invalid.");
  const organizationId = command.tenant.organization_id;
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: command.authentication,
    tenant: command.tenant,
    resource: { organization_id: organizationId },
    operation: AUTHORIZATION_OPERATION,
    trusted_now: trustedNow,
  });
  if (precondition.status === "denied") return { status: "authorization_denied", reason_code: precondition.reason_code, policy_version: precondition.authorization_policy_version };
  if (command.authentication.principal.principal_type !== "human") return { status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED", policy_version: command.tenant.authorization_policy_version };
  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  const initialCase = await dependencies.capa_repository.findCaseById(organizationId, command.capa_case_id);
  if (initialCase === null) return { status: "not_found_or_not_authorized" };

  const existingOperation = await dependencies.transaction_manager.runInTransaction(
    command.request_trace,
    (transaction) => dependencies.workflow_idempotency_repository.findWorkflowOperation(
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
    const replaySource = await dependencies.capa_repository.findCaseVersionById(organizationId, command.capa_case_id, existingOperation.source_case_version_id);
    if (replaySource === null) return { status: "not_found_or_not_authorized" };
    const replayPolicy = await dependencies.authorization_policy.evaluate({
      authentication: command.authentication,
      tenant: command.tenant,
      operation: AUTHORIZATION_OPERATION,
      resource: { organization_id: organizationId, resource_type: controlled("CAPA_CASE"), resource_id: command.capa_case_id, resource_version_id: replaySource.case_version_id, capa_case_id: command.capa_case_id, case_version_id: replaySource.case_version_id, workflow_state: replaySource.status },
      purpose: dependencies.configuration.authorization_purpose,
      trusted_now: trustedNow,
    });
    if (replayPolicy.decision !== "allow") return { status: "authorization_denied", reason_code: replayPolicy.reason_code, policy_version: replayPolicy.policy_version };
    try {
      return await replay(dependencies, command, body, existingOperation);
    } catch (error) {
      if (error instanceof IdempotencyReplayConflictError) return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
      throw error;
    }
  }

  const current = await currentCase(dependencies, organizationId, command.capa_case_id);
  if (current === null) return { status: "not_found_or_not_authorized" };
  if (current.capa_case.status !== SOURCE_STATE || current.case_version.status !== SOURCE_STATE || !isAllowedCapaTransition(SOURCE_STATE, TARGET_STATE)) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
  const cycleResolution = await dependencies.return_cycle_resolver.resolve({ organization_id: organizationId, capa_case_id: command.capa_case_id });
  if (cycleResolution.status === "invalid") throw new SubmitCapaImplementationIntegrityError("The implementation return-cycle provenance is invalid.");
  const activeCycle = cycleResolution.status === "active" ? cycleResolution.cycle : null;
  const policy = await dependencies.authorization_policy.evaluate({
    authentication: command.authentication,
    tenant: command.tenant,
    operation: AUTHORIZATION_OPERATION,
    resource: { organization_id: organizationId, resource_type: controlled("CAPA_CASE"), resource_id: current.capa_case.capa_case_id, resource_version_id: current.case_version.case_version_id, capa_case_id: current.capa_case.capa_case_id, case_version_id: current.case_version.case_version_id, workflow_state: current.case_version.status },
    purpose: dependencies.configuration.authorization_purpose,
    trusted_now: trustedNow,
  });
  if (policy.decision !== "allow") return { status: "authorization_denied", reason_code: policy.reason_code, policy_version: policy.policy_version };
  const principal = command.authentication.principal;
  const timestamp = iso(trustedNow);

  try {
    const result = await dependencies.transaction_manager.runInTransaction(command.request_trace, async (transaction) => {
      const workspace = await dependencies.workspace_repository.findWorkspaceForUpdate(transaction, organizationId, command.capa_case_id);
      if (workspace === null) return { kind: "validation" as const, reason_code: "IMPLEMENTATION_WORKSPACE_NOT_AVAILABLE" as const };
      if (workspace.draft_revision !== body.expected_draft_revision) return { kind: "workspace_conflict" as const };
      if (workspace.organization_id !== organizationId || workspace.capa_case_id !== command.capa_case_id || workspace.case_version_id !== current.case_version.case_version_id || workspace.record_version !== current.case_version.version_number || workspace.workflow_state !== SOURCE_STATE) return { kind: "workspace_conflict" as const };
      const baseline = await resolveApprovedBaseline(
        dependencies,
        current,
        transaction,
        workspace.approved_s70_baseline,
      );
      if (baseline === null || !baselineEquals(workspace.approved_s70_baseline, baseline.reference)) return { kind: "validation" as const, reason_code: "IMPLEMENTATION_BASELINE_NOT_AUTHORITATIVE" as const };
      const contextual = validateCapaImplementationDraftAgainstApprovedActionSet(workspace.draft, baseline.action_plan.items.map((item) => item.item_id));
      if (contextual.status !== "valid") return { kind: "validation" as const, reason_code: "IMPLEMENTATION_BASELINE_NOT_AUTHORITATIVE" as const, detail_reason_code: contextual.reason_code };
      const returnResponse = resolveReturnResponse(activeCycle, contextual.value);
      if (returnResponse.status === "validation_failed") return { kind: "validation" as const, reason_code: returnResponse.reason_code };
      const readiness = evaluateCapaImplementationSubmissionReadiness(contextual.value, baseline.action_plan.items.map((item) => item.item_id));
      if (readiness.status !== "ready_for_s90_review") return { kind: "blocked" as const, blocker_codes: readiness.blocker_codes };
      const priorSections = activeCycle === null
        ? { baseline: null, return_response: null }
        : await priorImplementationSections(dependencies, transaction, current);
      const nextVersionId = dependencies.id_generator.generateCaseVersionId();
      const sectionId = dependencies.id_generator.generateSectionVersionId();
      const returnResponseSectionId = returnResponse.status === "valid" ? dependencies.id_generator.generateSectionVersionId() : null;
      const auditEventId = dependencies.id_generator.generateAuditEventId();
      const section = baselineSection(organizationId, command.capa_case_id, sectionId, current.case_version.case_version_id, nextVersionId, auditEventId, workspace.draft_revision, contextual.value, baseline.reference, principal.user_id, timestamp);
      const responseContent = returnResponse.status === "valid" ? authoritativeReturnResponseContent(returnResponse.draft, nextVersionId, principal.user_id, timestamp) : null;
      const responseSection: CapaSectionVersion | null = responseContent === null ? null : { organization_id: organizationId, section_version_id: returnResponseSectionId!, capa_case_id: command.capa_case_id, section_type: controlled(CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE), version_number: (priorSections.return_response?.version_number ?? 0) + 1, ...(priorSections.return_response === null ? {} : { parent_version_id: priorSections.return_response.section_version_id }), schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION, content: responseContent as unknown as Readonly<Record<string, unknown>>, change_reason: TRANSITION_MEANING, effective_at: timestamp, created_at: timestamp, created_by: { actor_type: "human", actor_id: principal.user_id } };
      const nextVersion: CapaCaseVersion = { organization_id: organizationId, case_version_id: nextVersionId, capa_case_id: command.capa_case_id, version_number: current.case_version.version_number + 1, parent_version_id: current.case_version.case_version_id, change_reason: TRANSITION_MEANING, status: TARGET_STATE, section_version_ids: replacedImplementationSectionIds(current.case_version, priorSections.baseline, sectionId, priorSections.return_response, responseSection?.section_version_id ?? null), effective_at: timestamp, created_at: timestamp, created_by: { actor_type: "human", actor_id: principal.user_id } };
      const fingerprint = requestFingerprint(dependencies, command, current.case_version.case_version_id, baseline.reference, contextual.value, workspace.draft_revision);
      const claim = await dependencies.workflow_idempotency_repository.claimWorkflowOperation(transaction, { organization_id: organizationId, idempotency_key: idempotencyKey, operation_code: controlled(OPERATION_CODE), request_fingerprint: fingerprint, capa_case_id: command.capa_case_id, source_case_version_id: current.case_version.case_version_id, resulting_case_version_id: nextVersionId, audit_event_id: auditEventId });
      if (claim.status === "conflict") return { kind: "idempotency_conflict" as const };
      if (claim.status === "already_claimed") return { kind: "replay_in_transaction" as const, record: claim.record };
      if (current.capa_case.status !== SOURCE_STATE) throw new SubmissionWorkflowError();
      if (current.capa_case.record_version !== current.case_version.version_number || current.capa_case.current_version_id !== current.case_version.case_version_id) throw new SubmissionConcurrencyError("RECORD_VERSION_CONFLICT");
      await dependencies.capa_repository.insertSectionVersion(transaction, section);
      if (responseSection !== null) await dependencies.capa_repository.insertSectionVersion(transaction, responseSection);
      await dependencies.capa_repository.insertCaseVersion(transaction, nextVersion);
      const advanced = await dependencies.capa_repository.advanceCurrentVersion(transaction, { organization_id: organizationId, capa_case_id: command.capa_case_id, expected_record_version: current.capa_case.record_version, expected_current_version_id: current.case_version.case_version_id, next_current_version_id: nextVersionId, next_status: TARGET_STATE, updated_at: timestamp, updated_by: { actor_type: "human", actor_id: principal.user_id } });
      if (advanced.status === "conflict") throw new SubmissionConcurrencyError(advanced.reason_code);
      const audit: AuditEvent = { organization_id: organizationId, event_id: auditEventId, event_type: controlled("EVT-STATE-TRANSITION"), schema_version: dependencies.configuration.audit_schema_version, aggregate_type: controlled("CAPA_CASE"), aggregate_id: command.capa_case_id, aggregate_version: advanced.capa_case.record_version, actor: { actor_type: "human", actor_id: principal.user_id }, occurred_at: timestamp, request_id: command.request_trace.request_id, correlation_id: command.request_trace.correlation_id, idempotency_key: idempotencyKey, action: controlled(OPERATION_CODE), target: { object_type: controlled("CAPA_CASE"), object_id: command.capa_case_id, object_version_id: nextVersionId }, outcome: "succeeded", change: { before_ref: { object_type: controlled("CAPA_CASE"), object_id: command.capa_case_id, object_version_id: current.case_version.case_version_id }, after_ref: { object_type: controlled("CAPA_CASE"), object_id: command.capa_case_id, object_version_id: nextVersionId } }, configuration_versions: { workflow: dependencies.configuration.workflow_version, implementation_review_baseline_schema: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION, implementation_review_return_response_schema: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION, authorization_policy: policy.policy_version, audit_schema: dependencies.configuration.audit_schema_version }, metadata: { transition_event: TRANSITION_MEANING, from_state: SOURCE_STATE, to_state: TARGET_STATE, source_case_version_id: current.case_version.case_version_id, resulting_case_version_id: nextVersionId, implementation_review_baseline_section_version_id: sectionId, ...(responseSection === null ? {} : { implementation_review_return_response_section_version_id: responseSection.section_version_id }), approved_s70_baseline: baseline.reference, workspace_draft_revision: workspace.draft_revision, required_permission: "capa.case.submit", relied_on_role_assignment_ids: policy.relied_on_role_assignment_ids } };
      const appended = await dependencies.audit_repository.appendEvent(transaction, audit);
      if (appended.status !== "appended" || appended.event_id !== auditEventId) throw new AuditEventAppendConflictError();
      return { kind: "submitted" as const, capa_case: advanced.capa_case, source_version: current.case_version, resulting_version: nextVersion, section, responseSection, audit_event_id: auditEventId };
    });
    if (result.kind === "validation") return { status: "validation_failed", reason_code: result.reason_code, ...(result.detail_reason_code === undefined ? {} : { detail_reason_code: result.detail_reason_code }) };
    if (result.kind === "workspace_conflict") return { status: "concurrency_conflict", reason_code: "WORKSPACE_DRAFT_REVISION_CONFLICT" };
    if (result.kind === "blocked") return { status: "submission_blocked", blocker_codes: result.blocker_codes };
    if (result.kind === "idempotency_conflict") return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
    if (result.kind === "replay_in_transaction") {
      try {
        return await replay(dependencies, command, body, result.record);
      } catch (error) {
        if (error instanceof IdempotencyReplayConflictError) return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
        throw error;
      }
    }
    return completion("submitted", result.capa_case, result.source_version, result.resulting_version, result.section, result.audit_event_id, result.responseSection ?? undefined);
  } catch (error) {
    if (error instanceof SubmissionConcurrencyError) return { status: "concurrency_conflict", reason_code: error.reason_code };
    if (error instanceof SubmissionWorkflowError) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
    throw error;
  }
}
