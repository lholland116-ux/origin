import type { CapaActionPlanReviewDecisionRepository } from "../../database/repositories/capa-action-plan-review-decision-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  OrganizationId,
} from "../domain/capa-types";

export interface CapaActionPlanReturnCycle {
  readonly return_transition_audit_event_id: AuditEventId;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
}

export type CapaActionPlanReturnCycleResolutionResult =
  | { readonly status: "no_active_return_cycle" }
  | { readonly status: "active"; readonly cycle: CapaActionPlanReturnCycle }
  | {
      readonly status: "invalid";
      readonly reason_code: "INVALID_ACTION_PLAN_RETURN_CYCLE_PROVENANCE";
    };

export interface CapaActionPlanReturnCycleResolver {
  resolve(input: {
    readonly organization_id: OrganizationId;
    readonly capa_case_id: CapaCaseId;
  }): Promise<CapaActionPlanReturnCycleResolutionResult>;
}

export interface CapaActionPlanReturnCycleResolverDependencies {
  readonly capa_repository: CapaRepository;
  readonly review_decision_repository: CapaActionPlanReviewDecisionRepository;
}

export function createCapaActionPlanReturnCycleResolver(
  dependencies: CapaActionPlanReturnCycleResolverDependencies,
): CapaActionPlanReturnCycleResolver {
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
        capaCase.status !== "S60"
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
        resultingVersion.status !== "S60" ||
        resultingVersion.version_number !== capaCase.record_version
      ) return { status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_CYCLE_PROVENANCE" };

      const sourceVersionId = resultingVersion.parent_version_id;
      if (sourceVersionId === undefined) return { status: "no_active_return_cycle" };
      const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
        input.organization_id,
        input.capa_case_id,
        sourceVersionId,
      );
      if (sourceVersion === null) return { status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_CYCLE_PROVENANCE" };
      if (
        sourceVersion.organization_id !== input.organization_id ||
        sourceVersion.capa_case_id !== input.capa_case_id ||
        sourceVersion.case_version_id !== sourceVersionId ||
        sourceVersion.status !== "S70" ||
        sourceVersion.version_number + 1 !== resultingVersion.version_number
      ) return { status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_CYCLE_PROVENANCE" };

      const decision = await dependencies.review_decision_repository.findDecision(
        input.organization_id,
        input.capa_case_id,
        sourceVersionId,
      );
      if (decision === null) return { status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_CYCLE_PROVENANCE" };
      if (
        decision.organization_id !== input.organization_id ||
        decision.capa_case_id !== input.capa_case_id ||
        decision.source_case_version_id !== sourceVersion.case_version_id ||
        decision.decision !== "return" ||
        decision.resulting_case_version_id !== resultingVersion.case_version_id
      ) return { status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_CYCLE_PROVENANCE" };

      return {
        status: "active",
        cycle: Object.freeze({
          return_transition_audit_event_id: decision.transition_audit_event_id,
          source_case_version_id: decision.source_case_version_id,
          resulting_case_version_id: decision.resulting_case_version_id,
        }),
      };
    },
  };
}
