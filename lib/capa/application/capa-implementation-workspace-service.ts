import {
  CAPA_ACTION_PLAN_SCHEMA_VERSION,
  CAPA_ACTION_PLAN_SECTION_TYPE,
  validateCapaActionPlan,
  type CapaActionPlanContent,
  type CapaActionPlanItem,
} from "../domain/capa-action-plan";
import type {
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  ControlledCode,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";
import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";
import {
  evaluateCapaAuthorizationPreconditions,
} from "../authorization/capa-permissions";
import type {
  CapaImplementationApprovedS70BaselineReference,
  CapaImplementationWorkspaceDraft,
} from "../implementation/capa-implementation-contract";
import {
  CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "../implementation/capa-implementation-contract";
import {
  validateCapaImplementationDraftAgainstApprovedActionSet,
  validateCapaImplementationWorkspaceDraft,
} from "../implementation/capa-implementation-validator";
import {
  validateCapaImplementationWorkspaceSaveRequest,
  type CapaImplementationWorkspaceSaveRequest,
} from "./capa-implementation-workspace-request";
import type {
  CapaActionPlanReviewDecisionRepository,
} from "../../database/repositories/capa-action-plan-review-decision-repository";
import type {
  CapaRepository,
} from "../../database/repositories/capa-repository";
import type {
  CapaImplementationWorkspaceRepository,
  CapaImplementationWorkspaceRecord,
  SaveCapaImplementationWorkspaceInput,
  SaveCapaImplementationWorkspaceResult,
} from "../../database/repositories/capa-implementation-workspace-repository";
import {
  CapaImplementationWorkspaceRepositoryError,
} from "../../database/repositories/capa-implementation-workspace-repository";
import type {
  TransactionManager,
} from "../../database/transactions";
import type {
  CapaRequestContext,
} from "../../security/supabase-capa-context";

const STATE = "S80" as const;
const READ_OPERATION = "read_implementation_workspace_draft" as const;
const EDIT_OPERATION = "edit_implementation_workspace_draft" as const;
const READ_PURPOSE = "CAPA_IMPLEMENTATION_WORKSPACE_READ";
const EDIT_PURPOSE = "CAPA_IMPLEMENTATION_WORKSPACE_EDIT";

export interface CapaImplementationApprovedActionProjection {
  readonly approved_action_reference: string;
  readonly status: CapaActionPlanItem["status"];
  readonly action_type: string | null;
  readonly description: string | null;
  readonly due_date: string | null;
  readonly deliverable: string | null;
  readonly implementation_expectation: string | null;
  readonly effectiveness_check_required: boolean;
  readonly acceptance_criteria: readonly string[];
}

export interface CapaImplementationWorkspaceProjection {
  readonly draft_revision: number | null;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly approved_s70_baseline: CapaImplementationApprovedS70BaselineReference;
  readonly approved_actions: readonly CapaImplementationApprovedActionProjection[];
  readonly draft: CapaImplementationWorkspaceDraft | null;
  readonly updated_at: IsoDateTime | null;
}

export type CapaImplementationWorkspaceServiceResult =
  | {
      readonly status: "loaded" | "saved";
      readonly workspace: CapaImplementationWorkspaceProjection;
    }
  | { readonly status: "not_found" }
  | {
      readonly status: "authorization_denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
  | {
      readonly status: "workflow_conflict";
      readonly reason_code: "WORKFLOW_STATE_NOT_ALLOWED";
    }
  | {
      readonly status: "baseline_unavailable";
      readonly reason_code: "APPROVED_S70_BASELINE_NOT_AVAILABLE";
    }
  | {
      readonly status: "case_changed";
      readonly reason_code: "WORKFLOW_MUTATION_DETECTED";
    }
  | {
      readonly status: "validation_failed";
      readonly reason_code: string;
      readonly detail_reason_code?: string;
    }
  | { readonly status: "concurrency_conflict" }
  | { readonly status: "baseline_conflict" }
  | { readonly status: "persistence_failed" };

export interface LoadCapaImplementationWorkspaceCommand {
  readonly capa_case_id: CapaCaseId;
}

export interface SaveCapaImplementationWorkspaceCommand {
  readonly capa_case_id: CapaCaseId;
  readonly body: unknown;
  readonly request_trace: RequestTrace;
}

export interface CapaImplementationWorkspaceService {
  load(
    command: LoadCapaImplementationWorkspaceCommand,
  ): Promise<CapaImplementationWorkspaceServiceResult>;
  save(
    command: SaveCapaImplementationWorkspaceCommand,
  ): Promise<CapaImplementationWorkspaceServiceResult>;
}

export interface CapaImplementationWorkspaceServiceDependencies {
  readonly request_context: CapaRequestContext;
  readonly capa_repository: CapaRepository;
  readonly review_decision_repository: CapaActionPlanReviewDecisionRepository;
  readonly workspace_repository: CapaImplementationWorkspaceRepository;
  readonly transaction_manager: TransactionManager;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
}

export class CapaImplementationWorkspaceIntegrityError extends Error {
  constructor(
    message = "The authoritative S80 implementation workspace context is inconsistent.",
  ) {
    super(message);
    this.name = "CapaImplementationWorkspaceIntegrityError";
  }
}

interface CurrentCaseContext {
  readonly capa_case: CapaCase;
  readonly case_version: CapaCaseVersion;
}

interface ResolvedImplementationBaseline {
  readonly reference: CapaImplementationApprovedS70BaselineReference;
  readonly action_plan: CapaActionPlanContent;
  readonly approved_actions: readonly CapaImplementationApprovedActionProjection[];
}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

async function currentCase(
  dependencies: CapaImplementationWorkspaceServiceDependencies,
  capaCaseId: CapaCaseId,
): Promise<CurrentCaseContext | null> {
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
    throw new CapaImplementationWorkspaceIntegrityError();
  }
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
    throw new CapaImplementationWorkspaceIntegrityError();
  }
  return { capa_case: capaCase, case_version: caseVersion };
}

async function authorize(
  dependencies: CapaImplementationWorkspaceServiceDependencies,
  operation: typeof READ_OPERATION | typeof EDIT_OPERATION,
  purpose: string,
  current: CurrentCaseContext,
): Promise<
  | { readonly status: "allowed" }
  | {
      readonly status: "denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
> {
  const trustedNow = dependencies.now();
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    resource: {
      organization_id: dependencies.request_context.tenant.organization_id,
    },
    operation,
    trusted_now: trustedNow,
  });
  if (precondition.status === "denied") {
    return {
      status: "denied",
      reason_code: precondition.reason_code,
      policy_version: precondition.authorization_policy_version,
    };
  }
  const decision = await dependencies.authorization_policy.evaluate({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    operation,
    resource: {
      organization_id: current.capa_case.organization_id,
      resource_type: controlled("CAPA_IMPLEMENTATION_WORKSPACE_DRAFT"),
      resource_id: current.capa_case.capa_case_id,
      resource_version_id: current.case_version.case_version_id,
      capa_case_id: current.capa_case.capa_case_id,
      case_version_id: current.case_version.case_version_id,
      workflow_state: current.capa_case.status,
    },
    purpose: controlled(purpose),
    trusted_now: trustedNow,
  });
  return decision.decision === "allow"
    ? { status: "allowed" }
    : {
        status: "denied",
        reason_code: decision.reason_code,
        policy_version: decision.policy_version,
      };
}

async function resolveApprovedBaseline(
  dependencies: CapaImplementationWorkspaceServiceDependencies,
  current: CurrentCaseContext,
): Promise<ResolvedImplementationBaseline | null> {
  const organizationId = dependencies.request_context.tenant.organization_id;
  const sourceCaseVersionId = current.case_version.parent_version_id;
  if (sourceCaseVersionId === undefined) return null;

  const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
    organizationId,
    current.capa_case.capa_case_id,
    sourceCaseVersionId,
  );
  if (
    sourceVersion === null ||
    sourceVersion.organization_id !== organizationId ||
    sourceVersion.capa_case_id !== current.capa_case.capa_case_id ||
    sourceVersion.case_version_id !== sourceCaseVersionId ||
    sourceVersion.status !== "S70"
  ) {
    return null;
  }

  const decision = await dependencies.review_decision_repository.findDecision(
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
    decision.resulting_case_version_id !== current.case_version.case_version_id ||
    !sourceVersion.section_version_ids.includes(
      decision.action_plan_section_version_id,
    )
  ) {
    return null;
  }

  const section = await dependencies.capa_repository.findSectionVersionById(
    organizationId,
    current.capa_case.capa_case_id,
    decision.action_plan_section_version_id,
  );
  if (
    section === null ||
    section.organization_id !== organizationId ||
    section.capa_case_id !== current.capa_case.capa_case_id ||
    section.section_version_id !== decision.action_plan_section_version_id ||
    section.section_type !== CAPA_ACTION_PLAN_SECTION_TYPE ||
    section.schema_version !== CAPA_ACTION_PLAN_SCHEMA_VERSION
  ) {
    return null;
  }
  const actionPlan = validateCapaActionPlan(section.content);
  if (actionPlan.status !== "valid") return null;

  const reference: CapaImplementationApprovedS70BaselineReference = {
    source_case_version_id: sourceCaseVersionId,
    approved_action_plan_section_id: decision.action_plan_section_version_id,
    approval_decision_reference: decision.transition_audit_event_id,
  };
  return {
    reference: Object.freeze(reference),
    action_plan: actionPlan.value,
    approved_actions: projectApprovedActions(actionPlan.value),
  };
}

function projectApprovedActions(
  actionPlan: CapaActionPlanContent,
): readonly CapaImplementationApprovedActionProjection[] {
  return Object.freeze(actionPlan.items.map((item) => {
    const acceptanceCriteria = actionPlan.effectiveness_checks
      .filter((check) => check.action_item_ids.includes(item.item_id))
      .map((check) => check.acceptance_criteria)
      .filter((criteria): criteria is string => criteria !== null);
    return Object.freeze({
      approved_action_reference: item.item_id,
      status: item.status,
      action_type: item.action_type,
      description: item.description,
      due_date: item.due_date,
      deliverable: item.deliverable,
      implementation_expectation: item.implementation_evidence,
      effectiveness_check_required: item.effectiveness_check_required,
      acceptance_criteria: Object.freeze(acceptanceCriteria),
    });
  }));
}

function projectWorkspace(
  current: CurrentCaseContext,
  baseline: ResolvedImplementationBaseline,
  record: CapaImplementationWorkspaceRecord | null,
): CapaImplementationWorkspaceProjection {
  if (record !== null) {
    if (
      record.organization_id !== current.capa_case.organization_id ||
      record.capa_case_id !== current.capa_case.capa_case_id ||
      record.case_version_id !== current.case_version.case_version_id ||
      record.record_version !== current.case_version.version_number ||
      record.workflow_state !== STATE ||
      record.approved_s70_baseline.source_case_version_id !==
        baseline.reference.source_case_version_id ||
      record.approved_s70_baseline.approved_action_plan_section_id !==
        baseline.reference.approved_action_plan_section_id ||
      record.approved_s70_baseline.approval_decision_reference !==
        baseline.reference.approval_decision_reference
    ) {
      throw new CapaImplementationWorkspaceIntegrityError(
        "The durable S80 workspace is outside the authoritative case and baseline boundary.",
      );
    }
  }
  return Object.freeze({
    draft_revision: record?.draft_revision ?? null,
    case_version_id: current.case_version.case_version_id,
    record_version: current.case_version.version_number,
    approved_s70_baseline: baseline.reference,
    approved_actions: baseline.approved_actions,
    draft: record?.draft ?? null,
    updated_at: record?.updated_at ?? null,
  });
}

function requestDraft(
  request: CapaImplementationWorkspaceSaveRequest,
  previous: CapaImplementationWorkspaceRecord | null,
): CapaImplementationWorkspaceDraft {
  const returnResponse = request.implementation_review_return_response === undefined
    ? previous?.draft.implementation_review_return_response ?? null
    : request.implementation_review_return_response;
  const draft = validateCapaImplementationWorkspaceDraft({
    schema_version: CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
    action_progress: request.action_progress,
    implementation_review_return_response: returnResponse,
  });
  if (draft.status !== "valid") {
    throw new CapaImplementationWorkspaceIntegrityError(
      `The constructed S80 workspace draft is invalid: ${draft.reason_code}.`,
    );
  }
  return draft.value;
}

function toValidationFailure(
  reasonCode: string,
  detailReasonCode?: string,
): CapaImplementationWorkspaceServiceResult {
  return {
    status: "validation_failed",
    reason_code: reasonCode,
    ...(detailReasonCode === undefined
      ? {}
      : { detail_reason_code: detailReasonCode }),
  };
}

function mapAuthorization(
  result: Awaited<ReturnType<typeof authorize>>,
): CapaImplementationWorkspaceServiceResult | null {
  return result.status === "allowed"
    ? null
    : {
        status: "authorization_denied",
        reason_code: result.reason_code,
        policy_version: result.policy_version,
      };
}

function mapRepositoryResult(
  result: SaveCapaImplementationWorkspaceResult,
  current: CurrentCaseContext,
  baseline: ResolvedImplementationBaseline,
): CapaImplementationWorkspaceServiceResult {
  switch (result.status) {
    case "concurrency_conflict":
      return result;
    case "case_changed":
      return { status: "case_changed", reason_code: "WORKFLOW_MUTATION_DETECTED" };
    case "baseline_conflict":
      return result;
    case "saved":
      return {
        status: "saved",
        workspace: projectWorkspace(current, baseline, result.workspace),
      };
  }
}

export function createCapaImplementationWorkspaceService(
  dependencies: CapaImplementationWorkspaceServiceDependencies,
): CapaImplementationWorkspaceService {
  return {
    async load(command) {
      const current = await currentCase(dependencies, command.capa_case_id);
      if (current === null) return { status: "not_found" };
      if (current.capa_case.status !== STATE) {
        return {
          status: "workflow_conflict",
          reason_code: "WORKFLOW_STATE_NOT_ALLOWED",
        };
      }
      const authorization = await authorize(
        dependencies,
        READ_OPERATION,
        READ_PURPOSE,
        current,
      );
      const authorizationResult = mapAuthorization(authorization);
      if (authorizationResult !== null) return authorizationResult;
      const baseline = await resolveApprovedBaseline(dependencies, current);
      if (baseline === null) {
        return {
          status: "baseline_unavailable",
          reason_code: "APPROVED_S70_BASELINE_NOT_AVAILABLE",
        };
      }
      const record = await dependencies.workspace_repository.findWorkspace(
        dependencies.request_context.tenant.organization_id,
        command.capa_case_id,
      );
      return {
        status: "loaded",
        workspace: projectWorkspace(current, baseline, record),
      };
    },

    async save(command) {
      const request = validateCapaImplementationWorkspaceSaveRequest(command.body);
      if (request.status !== "valid") {
        return toValidationFailure(
          request.reason_code,
          request.detail_reason_code,
        );
      }
      const current = await currentCase(dependencies, command.capa_case_id);
      if (current === null) return { status: "not_found" };
      if (current.capa_case.status !== STATE) {
        return {
          status: "workflow_conflict",
          reason_code: "WORKFLOW_STATE_NOT_ALLOWED",
        };
      }
      const authorization = await authorize(
        dependencies,
        EDIT_OPERATION,
        EDIT_PURPOSE,
        current,
      );
      const authorizationResult = mapAuthorization(authorization);
      if (authorizationResult !== null) return authorizationResult;
      const baseline = await resolveApprovedBaseline(dependencies, current);
      if (baseline === null) {
        return {
          status: "baseline_unavailable",
          reason_code: "APPROVED_S70_BASELINE_NOT_AVAILABLE",
        };
      }
      const previous = await dependencies.workspace_repository.findWorkspace(
        dependencies.request_context.tenant.organization_id,
        command.capa_case_id,
      );
      const draft = requestDraft(request.value, previous);
      const contextual = validateCapaImplementationDraftAgainstApprovedActionSet(
        draft,
        baseline.action_plan.items.map((item) => item.item_id),
      );
      if (contextual.status !== "valid") {
        return toValidationFailure(
          "APPROVED_ACTION_REFERENCE_NOT_AUTHORITATIVE",
          contextual.reason_code,
        );
      }
      const principal = dependencies.request_context.authentication.principal;
      if (principal.principal_type !== "human") {
        return {
          status: "authorization_denied",
          reason_code: "AUTHORIZED_HUMAN_REQUIRED",
          policy_version: dependencies.request_context.tenant.authorization_policy_version,
        };
      }
      const input: SaveCapaImplementationWorkspaceInput = {
        organization_id: dependencies.request_context.tenant.organization_id,
        capa_case_id: current.capa_case.capa_case_id,
        case_version_id: current.case_version.case_version_id,
        record_version: current.case_version.version_number,
        draft: contextual.value,
        draft_revision: request.value.expected_draft_revision === null
          ? 1
          : request.value.expected_draft_revision + 1,
        expected_draft_revision: request.value.expected_draft_revision,
        actor_user_id: principal.user_id,
        approved_s70_baseline: baseline.reference,
      };
      let result: SaveCapaImplementationWorkspaceResult;
      try {
        result = await dependencies.transaction_manager.runInTransaction(
          command.request_trace,
          (transaction) => request.value.expected_draft_revision === null
            ? dependencies.workspace_repository.initializeWorkspace(
                transaction,
                input,
              )
            : dependencies.workspace_repository.saveWorkspace(
                transaction,
                input,
              ),
        );
      } catch (error) {
        if (error instanceof CapaImplementationWorkspaceRepositoryError) {
          return { status: "persistence_failed" };
        }
        throw error;
      }
      return mapRepositoryResult(result, current, baseline);
    },
  };
}
