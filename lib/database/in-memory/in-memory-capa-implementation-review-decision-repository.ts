import type {
  CapaCaseId,
  CapaCaseVersionId,
  OrganizationId,
} from "../../capa/domain/capa-types";
import {
  CapaImplementationReviewDecisionRepositoryError,
  cloneCapaImplementationReviewDecision,
  normalizeCapaImplementationReviewDecision,
  type CapaImplementationReviewDecisionRecord,
  type CapaImplementationReviewDecisionRepository,
  type CapaImplementationReviewDecisionTransactionReadRepository,
  type SaveCapaImplementationReviewDecisionResult,
} from "../repositories/capa-implementation-review-decision-repository";
import type { TransactionContext } from "../transactions";

export class InMemoryCapaImplementationReviewDecisionRepository
  implements
    CapaImplementationReviewDecisionRepository,
    CapaImplementationReviewDecisionTransactionReadRepository {
  private readonly decisions =
    new Map<string, CapaImplementationReviewDecisionRecord>();

  constructor(
    decisions:
      readonly CapaImplementationReviewDecisionRecord[] = [],
  ) {
    for (const decision of decisions) {
      const normalized =
        normalizeCapaImplementationReviewDecision(decision);
      const key = this.key(
        normalized.organization_id,
        normalized.capa_case_id,
        normalized.source_case_version_id,
      );
      if (this.decisions.has(key)) {
        throw new CapaImplementationReviewDecisionRepositoryError(
          "Duplicate CAPA implementation-review decision baseline.",
        );
      }
      this.decisions.set(key, normalized);
    }
  }

  async saveDecision(
    _transaction: TransactionContext,
    value: CapaImplementationReviewDecisionRecord,
  ): Promise<SaveCapaImplementationReviewDecisionResult> {
    const decision =
      normalizeCapaImplementationReviewDecision(value);
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
        decision:
          cloneCapaImplementationReviewDecision(existing),
      };
    }

    this.decisions.set(key, decision);
    return {
      status: "saved",
      decision:
        cloneCapaImplementationReviewDecision(decision),
    };
  }

  async findDecision(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaImplementationReviewDecisionRecord | null> {
    const decision = this.decisions.get(
      this.key(
        organizationId,
        capaCaseId,
        sourceCaseVersionId,
      ),
    );
    return decision === undefined
      ? null
      : cloneCapaImplementationReviewDecision(decision);
  }

  async findDecisionInTransaction(
    _transaction: TransactionContext,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): Promise<CapaImplementationReviewDecisionRecord | null> {
    return this.findDecision(
      organizationId,
      capaCaseId,
      sourceCaseVersionId,
    );
  }

  private key(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sourceCaseVersionId: CapaCaseVersionId,
  ): string {
    return `${organizationId}:${capaCaseId}:${sourceCaseVersionId}`;
  }
}
