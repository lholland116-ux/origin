import {
  validateCapaImplementationReviewDecision,
  type CapaImplementationReviewDecisionContent,
} from "../../capa/domain/capa-implementation-review-decision";
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

export interface CapaImplementationReviewDecisionRecord
  extends CapaImplementationReviewDecisionContent {
  readonly organization_id:
    OrganizationId;
  readonly capa_case_id:
    CapaCaseId;
  readonly reviewer_user_id:
    UserId;
  readonly decided_at:
    IsoDateTime;
  readonly resulting_case_version_id:
    CapaCaseVersionId;
  readonly transition_audit_event_id:
    AuditEventId;
}

export type SaveCapaImplementationReviewDecisionResult =
  | {
      readonly status: "saved";
      readonly decision:
        CapaImplementationReviewDecisionRecord;
    }
  | {
      readonly status: "conflict";
      readonly reason_code:
        "DECISION_ALREADY_COMMITTED";
      readonly decision:
        CapaImplementationReviewDecisionRecord;
    };

export interface CapaImplementationReviewDecisionRepository {
  saveDecision(
    transaction: TransactionContext,
    decision: CapaImplementationReviewDecisionRecord,
  ): Promise<SaveCapaImplementationReviewDecisionResult>;

  findDecision(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaImplementationReviewDecisionRecord | null>;
}

export interface CapaImplementationReviewDecisionTransactionReadRepository {
  findDecisionInTransaction(
    transaction: TransactionContext,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaImplementationReviewDecisionRecord | null>;
}

export class CapaImplementationReviewDecisionRepositoryError
  extends Error {
  constructor(
    message =
      "The CAPA implementation-review decision repository operation failed.",
  ) {
    super(message);
    this.name =
      "CapaImplementationReviewDecisionRepositoryError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isoDateTime(value: unknown): boolean {
  return typeof value === "string" &&
    ISO_DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value));
}

export function normalizeCapaImplementationReviewDecision(
  value: CapaImplementationReviewDecisionRecord,
): CapaImplementationReviewDecisionRecord {
  const content = {
    schema_version: value.schema_version,
    source_case_version_id:
      value.source_case_version_id,
    implementation_review_baseline_section_version_id:
      value.implementation_review_baseline_section_version_id,
    decision: value.decision,
    rationale: value.rationale,
  };
  const validated =
    validateCapaImplementationReviewDecision(content);
  if (
    validated.status !== "valid" ||
    !uuid(value.organization_id) ||
    !uuid(value.capa_case_id) ||
    !uuid(value.reviewer_user_id) ||
    !isoDateTime(value.decided_at) ||
    !uuid(value.resulting_case_version_id) ||
    !uuid(value.transition_audit_event_id) ||
    value.source_case_version_id ===
      value.resulting_case_version_id
  ) {
    throw new CapaImplementationReviewDecisionRepositoryError(
      "The CAPA implementation-review decision record is invalid.",
    );
  }

  return Object.freeze({
    ...validated.value,
    organization_id: value.organization_id,
    capa_case_id: value.capa_case_id,
    reviewer_user_id: value.reviewer_user_id,
    decided_at: value.decided_at,
    resulting_case_version_id:
      value.resulting_case_version_id,
    transition_audit_event_id:
      value.transition_audit_event_id,
  });
}

export function cloneCapaImplementationReviewDecision(
  value: CapaImplementationReviewDecisionRecord,
): CapaImplementationReviewDecisionRecord {
  return Object.freeze(structuredClone(value));
}
