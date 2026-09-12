import {
  evaluateCapaAuthorizationPreconditions,
  type CapaAuthorizationOperation,
} from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import {
  CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
} from "../domain/capa-action-plan-review-decision";
import {
  CAPA_ACTION_PLAN_SCHEMA_VERSION,
  CAPA_ACTION_PLAN_SECTION_TYPE,
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../domain/capa-action-plan";
import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
  type CapaImplementationReviewDecision,
} from "../domain/capa-implementation-review-decision";
import type {
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaSectionVersion,
  ControlledCode,
  UserId,
} from "../domain/capa-types";
import {
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
  validateCapaImplementationReviewBaselineAgainstApprovedActionSet,
  validateCapaImplementationReviewBaselineContent,
} from "../implementation/capa-implementation-review-baseline";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE,
  validateCapaImplementationReviewReturnResponseContent,
} from "../implementation/capa-implementation-return-response-contract";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import { getActiveRoleAssignments } from "../../security/tenant-context";
import type { AuditEvent } from "../../capa/domain/capa-types";
import type {
  AuditCursor,
  AuditRepository,
} from "../../database/repositories/audit-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { CapaActionPlanReviewDecisionRepository } from "../../database/repositories/capa-action-plan-review-decision-repository";
import type {
  CapaImplementationReviewDecisionRecord,
  CapaImplementationReviewDecisionRepository,
} from "../../database/repositories/capa-implementation-review-decision-repository";
import type {
  CapaImplementationReviewApprovedS70Authority,
  CapaImplementationReviewAuthorizationState,
  CapaImplementationReviewHistoryEntry,
  CapaImplementationReviewProjection,
  CapaImplementationReviewSectionSnapshot,
  CapaImplementationReviewSubmittedImplementation,
} from "../implementation/capa-implementation-review-projection";

const STATE = "S90" as const;
const READ_OPERATION = "view_case" as const;
const DECISION_OPERATION = "accept_implementation" as const;
const READ_PURPOSE = "CAPA_CASE_ACCESS";
const DECISION_PURPOSE = "CAPA_GATE_DECISION";
const IMPLEMENTATION_REVIEW_DECISION_ACTION =
  "DECIDE_CAPA_IMPLEMENTATION_REVIEW";
const S70_DECISION_ACTION = "DECIDE_CAPA_ACTION_PLAN_REVIEW";
const MAXIMUM_AUDIT_PAGE_SIZE = 100;

export interface CapaImplementationReviewProjectionServiceDependencies {
  readonly request_context: CapaRequestContext;
  readonly capa_repository: CapaRepository;
  readonly action_plan_review_decision_repository:
    CapaActionPlanReviewDecisionRepository;
  readonly implementation_review_decision_repository:
    CapaImplementationReviewDecisionRepository;
  readonly audit_repository: AuditRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
  readonly step_up_maximum_age_ms: number;
  readonly required_step_up_assurance: ControlledCode;
}

export interface LoadCapaImplementationReviewProjectionCommand {
  readonly capa_case_id: CapaCaseId;
}

export type CapaImplementationReviewProjectionServiceResult =
  | {
      readonly status: "resolved";
      readonly projection: CapaImplementationReviewProjection;
    }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "wrong_workflow_state" }
  | {
      readonly status: "authorization_denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
  | { readonly status: "invalid_authoritative_context" };

export interface CapaImplementationReviewProjectionService {
  load(
    command: LoadCapaImplementationReviewProjectionCommand,
  ): Promise<CapaImplementationReviewProjectionServiceResult>;
}

export class CapaImplementationReviewProjectionIntegrityError extends Error {
  constructor(
    message = "The authoritative S90 implementation-review projection is inconsistent.",
  ) {
    super(message);
    this.name = "CapaImplementationReviewProjectionIntegrityError";
  }
}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function freezeClone<T>(value: T): T {
  const clone = structuredClone(value);
  return freeze(clone);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
  }
  return value;
}

function exactIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    value.every((id) => typeof id === "string") &&
    new Set(value).size === value.length;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSuccessfulHumanTransition(
  event: AuditEvent,
  fromState: string,
): boolean {
  return event.event_type === "EVT-STATE-TRANSITION" &&
    event.action === IMPLEMENTATION_REVIEW_DECISION_ACTION &&
    event.outcome === "succeeded" &&
    event.actor.actor_type === "human" &&
    isUuid(event.actor.actor_id) &&
    event.metadata.from_state === fromState;
}

function snapshotSection<Content>(
  section: CapaSectionVersion,
  content: Content,
): CapaImplementationReviewSectionSnapshot<Content> {
  return freezeClone({
    section_version_id: section.section_version_id,
    section_type: section.section_type,
    section_version_number: section.version_number,
    schema_version: section.schema_version,
    content,
  });
}

function resource(
  capaCase: CapaCase,
  caseVersion: CapaCaseVersion,
  principalUserId: UserId,
): {
  readonly organization_id: CapaCase["organization_id"];
  readonly resource_type: ControlledCode;
  readonly resource_id: CapaCaseId;
  readonly resource_version_id: CapaCaseVersion["case_version_id"];
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersion["case_version_id"];
  readonly workflow_state: CapaCase["status"];
  readonly relationship: ControlledCode;
} {
  return {
    organization_id: capaCase.organization_id,
    resource_type: controlled("CAPA_CASE"),
    resource_id: capaCase.capa_case_id,
    resource_version_id: caseVersion.case_version_id,
    capa_case_id: capaCase.capa_case_id,
    case_version_id: caseVersion.case_version_id,
    workflow_state: caseVersion.status,
    relationship: controlled(
      principalUserId === capaCase.owner_user_id
        ? "CASE_OWNER"
        : "NOT_CASE_OWNER",
    ),
  };
}

async function authorize(
  dependencies: CapaImplementationReviewProjectionServiceDependencies,
  capaCase: CapaCase,
  caseVersion: CapaCaseVersion,
  principalUserId: UserId,
): Promise<
  | { readonly status: "allowed"; readonly value: CapaImplementationReviewAuthorizationState }
  | { readonly status: "denied"; readonly reason_code: string; readonly policy_version: string }
> {
  const trustedNow = dependencies.now();
  if (!Number.isFinite(trustedNow.getTime())) {
    return {
      status: "denied",
      reason_code: "INVALID_TRUSTED_TIME",
      policy_version: dependencies.request_context.tenant.authorization_policy_version,
    };
  }

  const readPrecondition = evaluateCapaAuthorizationPreconditions({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    resource: { organization_id: capaCase.organization_id },
    operation: READ_OPERATION,
    trusted_now: trustedNow,
  });
  if (readPrecondition.status === "denied") {
    return {
      status: "denied",
      reason_code: readPrecondition.reason_code,
      policy_version: readPrecondition.authorization_policy_version,
    };
  }

  const readPolicy = await dependencies.authorization_policy.evaluate({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    operation: READ_OPERATION,
    resource: resource(capaCase, caseVersion, principalUserId),
    purpose: controlled(READ_PURPOSE),
    trusted_now: trustedNow,
  });
  if (readPolicy.decision !== "allow") {
    return {
      status: "denied",
      reason_code: readPolicy.reason_code,
      policy_version: readPolicy.policy_version,
    };
  }

  const decisionPrecondition = evaluateCapaAuthorizationPreconditions({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    resource: { organization_id: capaCase.organization_id },
    operation: DECISION_OPERATION,
    trusted_now: trustedNow,
    step_up_maximum_age_ms: dependencies.step_up_maximum_age_ms,
  });
  const requiredAssurance = dependencies.required_step_up_assurance;
  let decisionAuthorization: CapaImplementationReviewAuthorizationState["decision"];
  if (decisionPrecondition.status === "denied") {
    decisionAuthorization = {
      operation: DECISION_OPERATION,
      status: decisionPrecondition.reason_code ===
        "STEP_UP_REAUTHENTICATION_REQUIRED"
        ? "step_up_required"
        : "denied",
      reason_code: decisionPrecondition.reason_code,
      policy_version: decisionPrecondition.authorization_policy_version,
      ...(decisionPrecondition.reason_code ===
      "STEP_UP_REAUTHENTICATION_REQUIRED"
        ? { required_assurance: requiredAssurance }
        : {}),
      human_only: true,
      step_up_required: true,
    };
  } else {
    const decisionPolicy = await dependencies.authorization_policy.evaluate({
      authentication: dependencies.request_context.authentication,
      tenant: dependencies.request_context.tenant,
      operation: DECISION_OPERATION,
      resource: resource(capaCase, caseVersion, principalUserId),
      purpose: controlled(DECISION_PURPOSE),
      trusted_now: trustedNow,
    });
    decisionAuthorization = {
      operation: DECISION_OPERATION,
      status: decisionPolicy.decision === "allow"
        ? "allowed"
        : decisionPolicy.decision === "step_up"
          ? "step_up_required"
          : "denied",
      reason_code: decisionPolicy.reason_code,
      policy_version: decisionPolicy.policy_version,
      ...(decisionPolicy.decision === "step_up"
        ? { required_assurance: decisionPolicy.required_assurance }
        : {}),
      human_only: true,
      step_up_required: true,
    };
  }

  return {
    status: "allowed",
    value: freezeClone({
      read: {
        operation: READ_OPERATION,
        status: "allowed",
        reason_code: readPolicy.reason_code,
        policy_version: readPolicy.policy_version,
        relied_on_role_assignment_ids:
          readPolicy.relied_on_role_assignment_ids,
      },
      decision: decisionAuthorization,
    }),
  };
}

async function currentCase(
  dependencies: CapaImplementationReviewProjectionServiceDependencies,
  capaCaseId: CapaCaseId,
): Promise<
  | { readonly capa_case: CapaCase; readonly case_version: CapaCaseVersion }
  | null
> {
  const organizationId = dependencies.request_context.tenant.organization_id;
  const capaCase = await dependencies.capa_repository.findCaseById(
    organizationId,
    capaCaseId,
  );
  if (capaCase === null) return null;
  if (
    capaCase.organization_id !== organizationId ||
    capaCase.capa_case_id !== capaCaseId
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The CAPA case is outside the tenant and case boundary.",
    );
  }
  if (capaCase.status !== STATE) return { capa_case: capaCase, case_version: null as never };
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
    caseVersion.status !== STATE ||
    caseVersion.version_number !== capaCase.record_version ||
    !Number.isSafeInteger(caseVersion.version_number) ||
    caseVersion.version_number < 1 ||
    !exactIds(caseVersion.section_version_ids)
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The CAPA current S90 version is stale or inconsistent.",
    );
  }
  return { capa_case: capaCase, case_version: caseVersion };
}

async function resolveApprovedS70Authority(
  dependencies: CapaImplementationReviewProjectionServiceDependencies,
  current: { readonly capa_case: CapaCase; readonly case_version: CapaCaseVersion },
  baseline: ReturnType<typeof validateCapaImplementationReviewBaselineContent> & { readonly status: "valid" },
): Promise<CapaImplementationReviewApprovedS70Authority> {
  const organizationId = current.capa_case.organization_id;
  const caseId = current.capa_case.capa_case_id;
  const reference = baseline.value.approved_s70_baseline;
  const s70Version = await dependencies.capa_repository.findCaseVersionById(
    organizationId,
    caseId,
    reference.source_case_version_id,
  );
  if (
    s70Version === null ||
    s70Version.organization_id !== organizationId ||
    s70Version.capa_case_id !== caseId ||
    s70Version.case_version_id !== reference.source_case_version_id ||
    s70Version.status !== "S70" ||
    !exactIds(s70Version.section_version_ids) ||
    !s70Version.section_version_ids.includes(reference.approved_action_plan_section_id)
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The approved S70 source is not authoritative.",
    );
  }
  const s80Version = await dependencies.capa_repository.findCaseVersionById(
    organizationId,
    caseId,
    current.case_version.parent_version_id as never,
  );
  if (
    s80Version === null ||
    s80Version.organization_id !== organizationId ||
    s80Version.capa_case_id !== caseId ||
    s80Version.case_version_id !== current.case_version.parent_version_id ||
    s80Version.status !== "S80" ||
    !s80Version.section_version_ids.includes(reference.approved_action_plan_section_id)
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The S90 source does not have the expected approved S80 parent.",
    );
  }
  const [actionSection, decision] = await Promise.all([
    dependencies.capa_repository.findSectionVersionById(
      organizationId,
      caseId,
      reference.approved_action_plan_section_id,
    ),
    dependencies.action_plan_review_decision_repository.findDecision(
      organizationId,
      caseId,
      reference.source_case_version_id,
    ),
  ]);
  if (
    actionSection === null ||
    actionSection.organization_id !== organizationId ||
    actionSection.capa_case_id !== caseId ||
    actionSection.section_version_id !== reference.approved_action_plan_section_id ||
    actionSection.section_type !== CAPA_ACTION_PLAN_SECTION_TYPE ||
    actionSection.schema_version !== CAPA_ACTION_PLAN_SCHEMA_VERSION
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The approved S70 action-plan section is not authoritative.",
    );
  }
  const actionPlan = validateCapaActionPlan(actionSection.content);
  if (actionPlan.status !== "valid") {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The approved S70 action-plan content is invalid.",
    );
  }
  if (
    decision === null ||
    decision.organization_id !== organizationId ||
    decision.capa_case_id !== caseId ||
    decision.source_case_version_id !== s70Version.case_version_id ||
    decision.schema_version !== CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION ||
    decision.decision !== "approve" ||
    decision.action_plan_section_version_id !== reference.approved_action_plan_section_id ||
    decision.transition_audit_event_id !== reference.approval_decision_reference
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The approved S70 decision is not authoritative.",
    );
  }
  const approvedImplementationEntryVersion =
    await dependencies.capa_repository.findCaseVersionById(
      organizationId,
      caseId,
      decision.resulting_case_version_id,
    );
  if (
    approvedImplementationEntryVersion === null ||
    approvedImplementationEntryVersion.organization_id !== organizationId ||
    approvedImplementationEntryVersion.capa_case_id !== caseId ||
    approvedImplementationEntryVersion.case_version_id !==
      decision.resulting_case_version_id ||
    approvedImplementationEntryVersion.status !== "S80" ||
    approvedImplementationEntryVersion.parent_version_id !==
      s70Version.case_version_id ||
    !approvedImplementationEntryVersion.section_version_ids.includes(
      reference.approved_action_plan_section_id,
    )
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The approved S70 decision does not identify the original S80 implementation entry.",
    );
  }
  const approvalAudit = await dependencies.audit_repository.findEventById(
    organizationId,
    reference.approval_decision_reference,
  );
  if (
    approvalAudit === null ||
    approvalAudit.organization_id !== organizationId ||
    approvalAudit.aggregate_type !== "CAPA_CASE" ||
    approvalAudit.aggregate_id !== caseId ||
    approvalAudit.event_type !== "EVT-STATE-TRANSITION" ||
    approvalAudit.action !== S70_DECISION_ACTION ||
    approvalAudit.outcome !== "succeeded" ||
    approvalAudit.actor.actor_type !== "human" ||
    approvalAudit.actor.actor_id !== decision.reviewer_user_id ||
    approvalAudit.occurred_at !== decision.decided_at ||
    approvalAudit.reason !== decision.rationale ||
    approvalAudit.target.object_version_id !==
      approvedImplementationEntryVersion.case_version_id ||
    approvalAudit.metadata.from_state !== "S70" ||
    approvalAudit.metadata.to_state !== "S80" ||
    approvalAudit.metadata.review_decision !== "approve" ||
    approvalAudit.metadata.source_case_version_id !== s70Version.case_version_id ||
    approvalAudit.metadata.resulting_case_version_id !==
      approvedImplementationEntryVersion.case_version_id
  ) {
    throw new CapaImplementationReviewProjectionIntegrityError(
      "The approved S70 transition audit is not authoritative.",
    );
  }
  const authority: CapaImplementationReviewApprovedS70Authority = {
    reference: freezeClone(reference),
    source_case_version_id: s70Version.case_version_id,
    source_case_version: freezeClone({
      version_number: s70Version.version_number,
      status: "S70" as const,
      parent_version_id: s70Version.parent_version_id ?? null,
      change_reason: s70Version.change_reason,
    }),
    action_plan_section: snapshotSection(actionSection, actionPlan.value),
    action_plan: freezeClone(actionPlan.value),
    approval_decision: freezeClone({
      schema_version: decision.schema_version,
      decision: "approve" as const,
      rationale: decision.rationale,
      reviewer_user_id: decision.reviewer_user_id,
      decided_at: decision.decided_at,
      resulting_case_version_id: decision.resulting_case_version_id,
      transition_audit_event_id: decision.transition_audit_event_id,
    }),
  };
  return authority;
}

async function readReviewHistory(
  dependencies: CapaImplementationReviewProjectionServiceDependencies,
  current: { readonly capa_case: CapaCase; readonly case_version: CapaCaseVersion },
): Promise<readonly CapaImplementationReviewHistoryEntry[]> {
  const events: AuditEvent[] = [];
  let cursor: AuditCursor | undefined;
  do {
    const page = await dependencies.audit_repository.listEventsForAggregate({
      organization_id: current.capa_case.organization_id,
      aggregate_type: controlled("CAPA_CASE"),
      aggregate_id: current.capa_case.capa_case_id,
      limit: MAXIMUM_AUDIT_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    events.push(...page.events);
    cursor = page.next_cursor;
  } while (cursor !== undefined);

  const history: CapaImplementationReviewHistoryEntry[] = [];
  for (const event of events.filter((candidate) =>
    isSuccessfulHumanTransition(candidate, STATE)
  )) {
    const metadata = event.metadata;
    const sourceCaseVersionId = metadata.source_case_version_id;
    const resultingCaseVersionId = metadata.resulting_case_version_id;
    const baselineSectionVersionId =
      metadata.implementation_review_baseline_section_version_id;
    const decisionValue = metadata.review_decision;
    if (
      !isUuid(sourceCaseVersionId) ||
      !isUuid(resultingCaseVersionId) ||
      !isUuid(baselineSectionVersionId) ||
      (decisionValue !== "accept" && decisionValue !== "return") ||
      event.metadata.to_state !==
        (decisionValue === "accept" ? "S100" : "S80") ||
      event.change?.before_ref?.object_version_id !== sourceCaseVersionId ||
      event.change?.after_ref?.object_version_id !== resultingCaseVersionId ||
      event.target.object_version_id !== resultingCaseVersionId ||
      event.reason === undefined
    ) {
      throw new CapaImplementationReviewProjectionIntegrityError(
        "The S90 review history contains an inconsistent transition.",
      );
    }
    const decision = await dependencies.implementation_review_decision_repository.findDecision(
      current.capa_case.organization_id,
      current.capa_case.capa_case_id,
      sourceCaseVersionId as never,
    );
    const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
      current.capa_case.organization_id,
      current.capa_case.capa_case_id,
      sourceCaseVersionId as never,
    );
    const resultingVersion = await dependencies.capa_repository.findCaseVersionById(
      current.capa_case.organization_id,
      current.capa_case.capa_case_id,
      resultingCaseVersionId as never,
    );
    const baselineSection = await dependencies.capa_repository.findSectionVersionById(
      current.capa_case.organization_id,
      current.capa_case.capa_case_id,
      baselineSectionVersionId as never,
    );
    const validatedBaseline = baselineSection === null
      ? null
      : validateCapaImplementationReviewBaselineContent(baselineSection.content);
    if (
      decision === null ||
      sourceVersion === null ||
      resultingVersion === null ||
      baselineSection === null ||
      validatedBaseline?.status !== "valid" ||
      decision.organization_id !== current.capa_case.organization_id ||
      decision.capa_case_id !== current.capa_case.capa_case_id ||
      decision.source_case_version_id !== sourceVersion.case_version_id ||
      decision.resulting_case_version_id !== resultingVersion.case_version_id ||
      decision.implementation_review_baseline_section_version_id !== baselineSection.section_version_id ||
      decision.decision !== decisionValue ||
      decision.rationale !== event.reason ||
      decision.decided_at !== event.occurred_at ||
      decision.transition_audit_event_id !== event.event_id ||
      event.actor.actor_id !== decision.reviewer_user_id ||
      decision.schema_version !== CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION ||
      sourceVersion.organization_id !== current.capa_case.organization_id ||
      sourceVersion.capa_case_id !== current.capa_case.capa_case_id ||
      sourceVersion.status !== STATE ||
      resultingVersion.organization_id !== current.capa_case.organization_id ||
      resultingVersion.capa_case_id !== current.capa_case.capa_case_id ||
      resultingVersion.status !== (decisionValue === "accept" ? "S100" : "S80") ||
      resultingVersion.parent_version_id !== sourceVersion.case_version_id ||
      validatedBaseline.value.resulting_s90_case_version_id !== sourceVersion.case_version_id ||
      validatedBaseline.value.source_s80_case_version_id !== sourceVersion.parent_version_id ||
      baselineSection.organization_id !== current.capa_case.organization_id ||
      baselineSection.capa_case_id !== current.capa_case.capa_case_id ||
      baselineSection.section_type !== CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE ||
      baselineSection.schema_version !== CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION
    ) {
      throw new CapaImplementationReviewProjectionIntegrityError(
        "The S90 review history contains an incomplete controlled record.",
      );
    }
    let returnResponse: CapaImplementationReviewHistoryEntry["return_response"];
    if (decisionValue === "return") {
      const resubmissions = events.filter((candidate) =>
        candidate.event_type === "EVT-STATE-TRANSITION" &&
        candidate.action === "SUBMIT_CAPA_IMPLEMENTATION" &&
        candidate.outcome === "succeeded" &&
        candidate.actor.actor_type === "human" &&
        candidate.metadata.from_state === "S80" &&
        candidate.metadata.to_state === "S90" &&
        candidate.metadata.source_case_version_id === resultingCaseVersionId,
      );
      if (resubmissions.length !== 1) {
        throw new CapaImplementationReviewProjectionIntegrityError(
          "The S90 return cycle has no unique successful owner resubmission.",
        );
      }
      const resubmission = resubmissions[0]!;
      const resubmittedVersionId = resubmission.metadata.resulting_case_version_id;
      const responseSectionId = resubmission.metadata.implementation_review_return_response_section_version_id;
      if (!isUuid(resubmittedVersionId) || !isUuid(responseSectionId)) {
        throw new CapaImplementationReviewProjectionIntegrityError(
          "The S90 return cycle resubmission is missing its immutable response binding.",
        );
      }
      const resubmittedVersion = await dependencies.capa_repository.findCaseVersionById(
        current.capa_case.organization_id,
        current.capa_case.capa_case_id,
        resubmittedVersionId as never,
      );
      const responseSection = await dependencies.capa_repository.findSectionVersionById(
        current.capa_case.organization_id,
        current.capa_case.capa_case_id,
        responseSectionId as never,
      );
      const validatedResponse = responseSection === null
        ? null
        : validateCapaImplementationReviewReturnResponseContent(responseSection.content);
      const resubmittedBaselineIds = resubmittedVersion === null
        ? []
        : resubmittedVersion.section_version_ids.filter((sectionId) =>
            sectionId === resubmission.metadata.implementation_review_baseline_section_version_id,
          );
      const resubmittedBaseline = resubmittedBaselineIds.length !== 1
        ? null
        : await dependencies.capa_repository.findSectionVersionById(
            current.capa_case.organization_id,
            current.capa_case.capa_case_id,
            resubmittedBaselineIds[0] as never,
          );
      const validatedResubmittedBaseline = resubmittedBaseline === null
        ? null
        : validateCapaImplementationReviewBaselineContent(resubmittedBaseline.content);
      if (
        resubmittedVersion === null ||
        resubmittedVersion.organization_id !== current.capa_case.organization_id ||
        resubmittedVersion.capa_case_id !== current.capa_case.capa_case_id ||
        resubmittedVersion.status !== "S90" ||
        resubmittedVersion.parent_version_id !== resultingVersion.case_version_id ||
        !resubmittedVersion.section_version_ids.includes(responseSectionId as never) ||
        resubmission.metadata.implementation_review_baseline_section_version_id === undefined ||
        resubmittedBaseline === null ||
        resubmittedBaseline.section_type !== CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE ||
        resubmittedBaseline.schema_version !== CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION ||
        validatedResubmittedBaseline?.status !== "valid" ||
        validatedResubmittedBaseline.value.source_s80_case_version_id !== resultingVersion.case_version_id ||
        validatedResubmittedBaseline.value.resulting_s90_case_version_id !== resubmittedVersion.case_version_id ||
        validatedResubmittedBaseline.value.transition_audit_event_id !== resubmission.event_id ||
        validatedResubmittedBaseline.value.submitted_by_user_id !== resubmission.actor.actor_id ||
        validatedResubmittedBaseline.value.submitted_at !== resubmission.occurred_at ||
        responseSection === null ||
        responseSection.organization_id !== current.capa_case.organization_id ||
        responseSection.capa_case_id !== current.capa_case.capa_case_id ||
        responseSection.section_type !== CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SECTION_TYPE ||
        responseSection.schema_version !== CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION ||
        validatedResponse?.status !== "valid" ||
        validatedResponse.value.return_transition_audit_event_id !== event.event_id ||
        validatedResponse.value.source_case_version_id !== sourceCaseVersionId ||
        validatedResponse.value.resulting_case_version_id !== resultingCaseVersionId ||
        validatedResponse.value.resubmitted_case_version_id !== resubmittedVersion.case_version_id ||
        resubmission.metadata.workspace_draft_revision === undefined ||
        resubmission.actor.actor_id !== validatedResponse.value.responded_by.actor_id ||
        resubmission.occurred_at !== validatedResponse.value.responded_at
      ) {
        throw new CapaImplementationReviewProjectionIntegrityError(
          "The S90 return-cycle response is not authoritatively linked.",
        );
      }
      returnResponse = freezeClone({
        section_version_id: responseSection.section_version_id,
        content: validatedResponse.value,
      });
    }
    history.push(freezeClone({
      source_case_version_id: decision.source_case_version_id,
      implementation_review_baseline_section_version_id:
        decision.implementation_review_baseline_section_version_id,
      decision: decision.decision,
      rationale: decision.rationale,
      reviewer_user_id: decision.reviewer_user_id,
      decided_at: decision.decided_at,
      resulting_case_version_id: decision.resulting_case_version_id,
      transition_audit_event_id: decision.transition_audit_event_id,
      ...(returnResponse === undefined ? {} : { return_response: returnResponse }),
    }));
  }
  return Object.freeze(history);
}

function submittedImplementation(
  baseline: ReturnType<typeof validateCapaImplementationReviewBaselineContent> & { readonly status: "valid" },
): CapaImplementationReviewSubmittedImplementation {
  return freezeClone({
    source_s80_case_version_id: baseline.value.source_s80_case_version_id,
    source_s80_workspace_revision: baseline.value.source_s80_workspace_revision,
    resulting_s90_case_version_id: baseline.value.resulting_s90_case_version_id,
    submitted_by_user_id: baseline.value.submitted_by_user_id,
    submitted_at: baseline.value.submitted_at,
    action_progress: baseline.value.action_progress,
  });
}

export function createCapaImplementationReviewProjectionService(
  dependencies: CapaImplementationReviewProjectionServiceDependencies,
): CapaImplementationReviewProjectionService {
  return {
    async load(command) {
      const principal = dependencies.request_context.authentication.principal;
      if (
        principal.principal_type !== "human" ||
        dependencies.request_context.tenant.organization_id.length === 0
      ) {
        return { status: "not_found_or_not_authorized" };
      }
      const trustedNow = dependencies.now();
      if (!Number.isFinite(trustedNow.getTime())) {
        return { status: "invalid_authoritative_context" };
      }
      const activeRoles = getActiveRoleAssignments(
        dependencies.request_context.tenant,
        trustedNow,
      );
      if (activeRoles.length === 0) {
        return { status: "not_found_or_not_authorized" };
      }

      let current: Awaited<ReturnType<typeof currentCase>>;
      try {
        current = await currentCase(dependencies, command.capa_case_id);
      } catch {
        return { status: "invalid_authoritative_context" };
      }
      if (current === null) return { status: "not_found_or_not_authorized" };
      if (current.case_version === null) {
        return { status: "wrong_workflow_state" };
      }

      let authorization: Awaited<ReturnType<typeof authorize>>;
      try {
        authorization = await authorize(
          dependencies,
          current.capa_case,
          current.case_version,
          principal.user_id,
        );
      } catch {
        return {
          status: "authorization_denied",
          reason_code: "AUTHORIZATION_EVALUATION_FAILED",
          policy_version:
            dependencies.request_context.tenant.authorization_policy_version,
        };
      }
      if (authorization.status === "denied") {
        return {
          status: "authorization_denied",
          reason_code: authorization.reason_code,
          policy_version: authorization.policy_version,
        };
      }

      try {
        const sectionIds = current.case_version.section_version_ids;
        const sections = await Promise.all(sectionIds.map((sectionId) =>
          dependencies.capa_repository.findSectionVersionById(
            current!.capa_case.organization_id,
            current!.capa_case.capa_case_id,
            sectionId as never,
          )
        ));
        if (
          sections.some((section, index) =>
            section === null ||
            section.section_version_id !== sectionIds[index] ||
            section.organization_id !== current!.capa_case.organization_id ||
            section.capa_case_id !== current!.capa_case.capa_case_id
          )
        ) {
          throw new CapaImplementationReviewProjectionIntegrityError(
            "The S90 snapshot references a missing or cross-tenant section.",
          );
        }
        const baselineSections = (sections as CapaSectionVersion[]).filter(
          (section) => section.section_type === CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
        );
        if (baselineSections.length !== 1) {
          throw new CapaImplementationReviewProjectionIntegrityError(
            "The S90 snapshot does not contain exactly one implementation-review baseline.",
          );
        }
        const baselineSection = baselineSections[0]!;
        if (
          baselineSection.schema_version !== CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION ||
          current.case_version.parent_version_id === undefined
        ) {
          throw new CapaImplementationReviewProjectionIntegrityError(
            "The S90 implementation-review baseline envelope is invalid.",
          );
        }
        const baseline = validateCapaImplementationReviewBaselineContent(
          baselineSection.content,
        );
        if (
          baseline.status !== "valid" ||
          baseline.value.resulting_s90_case_version_id !== current.case_version.case_version_id ||
          baseline.value.source_s80_case_version_id !== current.case_version.parent_version_id
        ) {
          throw new CapaImplementationReviewProjectionIntegrityError(
            "The S90 implementation-review baseline linkage is invalid.",
          );
        }
        const approvedS70 = await resolveApprovedS70Authority(
          dependencies,
          current,
          baseline,
        );
        const contextualBaseline = validateCapaImplementationReviewBaselineAgainstApprovedActionSet(
          baseline.value,
          approvedS70.action_plan.items.map((item) => item.item_id),
        );
        if (contextualBaseline.status !== "valid") {
          throw new CapaImplementationReviewProjectionIntegrityError(
            "The submitted implementation references a non-authoritative S70 action.",
          );
        }
        const history = await readReviewHistory(dependencies, current);
        const projection: CapaImplementationReviewProjection = {
          trust: "authoritative_server_projection",
          organization_id: current.capa_case.organization_id,
          capa_case_id: current.capa_case.capa_case_id,
          record_version: current.capa_case.record_version,
          current_case_version_id: current.case_version.case_version_id,
          workflow_state: STATE,
          case_version: freezeClone({
            version_number: current.case_version.version_number,
            parent_version_id: current.case_version.parent_version_id,
            change_reason: current.case_version.change_reason,
          }),
          implementation_review_baseline_section_version_id:
            baselineSection.section_version_id,
          implementation_review_baseline: snapshotSection(
            baselineSection,
            contextualBaseline.value,
          ),
          approved_s70_baseline: approvedS70,
          submitted_implementation: submittedImplementation(contextualBaseline),
          reviewer: freezeClone({
            user_id: principal.user_id,
            active_roles: activeRoles,
            authorization: authorization.value,
          }),
          prior_review_history: history,
        };
        return { status: "resolved", projection: freezeClone(projection) };
      } catch {
        return { status: "invalid_authoritative_context" };
      }
    },
  };
}

export type {
  CapaAuthorizationOperation,
};
