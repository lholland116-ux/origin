import {
  CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
  validateCapaActionPlanReviewDecision,
  type CapaActionPlanReviewDecisionContent,
} from "../../capa/domain/capa-action-plan-review-decision";
import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";

export interface CapaActionPlanReviewDecisionRecord
  extends CapaActionPlanReviewDecisionContent {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly reviewer_user_id: UserId;
  readonly decided_at: IsoDateTime;
  readonly resulting_case_version_id: CapaCaseVersionId;
  readonly transition_audit_event_id: AuditEventId;
}

export type SaveCapaActionPlanReviewDecisionResult =
  | {
      readonly status: "saved";
      readonly decision: CapaActionPlanReviewDecisionRecord;
    }
  | {
      readonly status: "conflict";
      readonly reason_code: "DECISION_ALREADY_COMMITTED";
      readonly decision: CapaActionPlanReviewDecisionRecord;
    };

export interface CapaActionPlanReviewDecisionRepository {
  saveDecision(
    transaction: TransactionContext,
    decision: CapaActionPlanReviewDecisionRecord,
  ): Promise<SaveCapaActionPlanReviewDecisionResult>;

  findDecision(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaActionPlanReviewDecisionRecord | null>;
}

export interface CapaActionPlanReviewDecisionTransactionReadRepository {
  findDecisionInTransaction(
    transaction: TransactionContext,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaActionPlanReviewDecisionRecord | null>;
}

export class CapaActionPlanReviewDecisionRepositoryError
  extends Error {
  constructor(
    message =
      "The CAPA action-plan review decision repository operation failed.",
  ) {
    super(message);
    this.name = "CapaActionPlanReviewDecisionRepositoryError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isoDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    ISO_DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value));
}

export function normalizeCapaActionPlanReviewDecision(
  value: CapaActionPlanReviewDecisionRecord,
): CapaActionPlanReviewDecisionRecord {
  const content = {
    schema_version: value.schema_version,
    source_case_version_id: value.source_case_version_id,
    action_plan_section_version_id: value.action_plan_section_version_id,
    decision: value.decision,
    rationale: value.rationale,
  };
  const validated = validateCapaActionPlanReviewDecision(content);
  if (
    validated.status !== "valid" ||
    !uuid(value.organization_id) ||
    !uuid(value.capa_case_id) ||
    !uuid(value.reviewer_user_id) ||
    !isoDateTime(value.decided_at) ||
    !uuid(value.resulting_case_version_id) ||
    !uuid(value.transition_audit_event_id) ||
    value.source_case_version_id === value.resulting_case_version_id
  ) {
    throw new CapaActionPlanReviewDecisionRepositoryError(
      "The CAPA action-plan review decision record is invalid.",
    );
  }

  return Object.freeze({
    ...validated.value,
    organization_id: value.organization_id,
    capa_case_id: value.capa_case_id,
    reviewer_user_id: value.reviewer_user_id,
    decided_at: value.decided_at,
    resulting_case_version_id: value.resulting_case_version_id,
    transition_audit_event_id: value.transition_audit_event_id,
  });
}

export function cloneCapaActionPlanReviewDecision(
  value: CapaActionPlanReviewDecisionRecord,
): CapaActionPlanReviewDecisionRecord {
  return Object.freeze(structuredClone(value));
}
