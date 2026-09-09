import type {
  CapaCaseId,
  CapaCaseVersionId,
  OrganizationId,
} from "../../capa/domain/capa-types";
import {
  CapaActionPlanReviewDecisionRepositoryError,
  cloneCapaActionPlanReviewDecision,
  normalizeCapaActionPlanReviewDecision,
  type CapaActionPlanReviewDecisionRecord,
  type CapaActionPlanReviewDecisionRepository,
  type SaveCapaActionPlanReviewDecisionResult,
} from "../repositories/capa-action-plan-review-decision-repository";
import type { TransactionContext } from "../transactions";

export class InMemoryCapaActionPlanReviewDecisionRepository
  implements CapaActionPlanReviewDecisionRepository {
  private readonly decisions =
    new Map<string, CapaActionPlanReviewDecisionRecord>();

  constructor(
    decisions: readonly CapaActionPlanReviewDecisionRecord[] = [],
  ) {
    for (const decision of decisions) {
      const normalized = normalizeCapaActionPlanReviewDecision(decision);
      const key = this.key(
        normalized.organization_id,
        normalized.capa_case_id,
        normalized.source_case_version_id,
      );
      if (this.decisions.has(key)) {
        throw new CapaActionPlanReviewDecisionRepositoryError(
          "Duplicate CAPA action-plan review decision baseline.",
        );
      }
      this.decisions.set(key, normalized);
    }
  }

  async saveDecision(
    _transaction: TransactionContext,
    value: CapaActionPlanReviewDecisionRecord,
  ): Promise<SaveCapaActionPlanReviewDecisionResult> {
    const decision = normalizeCapaActionPlanReviewDecision(value);
    const key = this.key(
      decision.organization_id,
      decision.capa_case_id,
      decision.source_case_version_id,
    );
    const existing = this.decisions.get(key);
    if (existing !== undefined) {
      return {
        status: "conflict",
        reason_code: "DECISION_ALREADY_COMMITTED",
        decision: cloneCapaActionPlanReviewDecision(existing),
      };
    }

    this.decisions.set(key, decision);
    return {
      status: "saved",
      decision: cloneCapaActionPlanReviewDecision(decision),
    };
  }

  async findDecision(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaActionPlanReviewDecisionRecord | null> {
    const decision = this.decisions.get(
      this.key(organizationId, capaCaseId, sourceCaseVersionId),
    );
    return decision === undefined
      ? null
      : cloneCapaActionPlanReviewDecision(decision);
  }

  private key(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): string {
    return `${organizationId}:${capaCaseId}:${sourceCaseVersionId}`;
  }
}
