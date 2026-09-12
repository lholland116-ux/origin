import type { CapaImplementationReviewDecisionRepository } from "../../database/repositories/capa-implementation-review-decision-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../domain/capa-types";

export interface CapaImplementationReturnCycle {
  readonly return_transition_audit_event_id: AuditEventId;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
  readonly returned_by_user_id: UserId;
  readonly returned_at: IsoDateTime;
  readonly rationale: string;
}

export type CapaImplementationReturnCycleResolutionResult =
  | { readonly status: "no_active_return_cycle" }
  | { readonly status: "active"; readonly cycle: CapaImplementationReturnCycle }
  | {
      readonly status: "invalid";
      readonly reason_code: "INVALID_IMPLEMENTATION_RETURN_CYCLE_PROVENANCE";
    };

export interface CapaImplementationReturnCycleResolver {
  resolve(input: {
    readonly organization_id: OrganizationId;
    readonly capa_case_id: CapaCaseId;
  }): Promise<CapaImplementationReturnCycleResolutionResult>;
}

export interface CapaImplementationReturnCycleResolverDependencies {
  readonly capa_repository: CapaRepository;
  readonly implementation_review_decision_repository:
    CapaImplementationReviewDecisionRepository;
}

export function createCapaImplementationReturnCycleResolver(
  dependencies: CapaImplementationReturnCycleResolverDependencies,
): CapaImplementationReturnCycleResolver {
  return {
    async resolve(input) {
      const capaCase = await dependencies.capa_repository.findCaseById(
        input.organization_id,
        input.capa_case_id,
      );
      if (capaCase === null) return { status: "no_active_return_cycle" };
      if (
        capaCase.organization_id !== input.organization_id ||
        capaCase.capa_case_id !== input.capa_case_id ||
        capaCase.status !== "S80"
      ) return { status: "no_active_return_cycle" };

      const resultingVersion = await dependencies.capa_repository.findCaseVersionById(
        input.organization_id,
        input.capa_case_id,
        capaCase.current_version_id,
      );
      if (
        resultingVersion === null ||
        resultingVersion.organization_id !== input.organization_id ||
        resultingVersion.capa_case_id !== input.capa_case_id ||
        resultingVersion.case_version_id !== capaCase.current_version_id ||
        resultingVersion.status !== "S80" ||
        resultingVersion.version_number !== capaCase.record_version
      ) return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_RETURN_CYCLE_PROVENANCE" };

      const sourceVersionId = resultingVersion.parent_version_id;
      if (sourceVersionId === undefined) return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_RETURN_CYCLE_PROVENANCE" };
      const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
        input.organization_id,
        input.capa_case_id,
        sourceVersionId,
      );
      if (
        sourceVersion === null ||
        sourceVersion.organization_id !== input.organization_id ||
        sourceVersion.capa_case_id !== input.capa_case_id ||
        sourceVersion.case_version_id !== sourceVersionId ||
        sourceVersion.version_number + 1 !== resultingVersion.version_number
      ) return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_RETURN_CYCLE_PROVENANCE" };

      if (sourceVersion.status === "S70") return { status: "no_active_return_cycle" };
      if (sourceVersion.status !== "S90") return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_RETURN_CYCLE_PROVENANCE" };

      const decision = await dependencies.implementation_review_decision_repository.findDecision(
        input.organization_id,
        input.capa_case_id,
        sourceVersionId,
      );
      if (
        decision === null ||
        decision.organization_id !== input.organization_id ||
        decision.capa_case_id !== input.capa_case_id ||
        decision.source_case_version_id !== sourceVersionId ||
        decision.decision !== "return" ||
        decision.resulting_case_version_id !== resultingVersion.case_version_id ||
        decision.rationale.trim() !== decision.rationale ||
        decision.rationale.length === 0
      ) return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_RETURN_CYCLE_PROVENANCE" };

      return {
        status: "active",
        cycle: Object.freeze({
          return_transition_audit_event_id: decision.transition_audit_event_id,
          source_case_version_id: decision.source_case_version_id,
          resulting_case_version_id: decision.resulting_case_version_id,
          returned_by_user_id: decision.reviewer_user_id,
          returned_at: decision.decided_at,
          rationale: decision.rationale,
        }),
      };
    },
  };
}
