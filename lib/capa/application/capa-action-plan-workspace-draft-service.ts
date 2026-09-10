import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaCase, CapaCaseVersion, CapaCaseId, IsoDateTime, OrganizationId, RequestTrace } from "../domain/capa-types";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { CapaActionPlanWorkspaceDraftRepository } from "../../database/repositories/capa-action-plan-workspace-draft-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaActionPlanWorkspaceDraft } from "./capa-action-plan-workspace-draft-contract";
import type { CapaActionPlanReviewReturnResponseDraft } from "../domain/capa-action-plan-review-return-response";
import type { CapaActionPlanReturnCycle, CapaActionPlanReturnCycleResolver } from "./capa-action-plan-return-cycle-resolver";
import {
  CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "./capa-action-plan-workspace-draft-contract";
import {
  validateCapaActionPlanWorkspaceDraft,
} from "./capa-action-plan-workspace-draft-validator";
import {
  validateCapaActionPlanWorkspaceDraftSaveRequest,
  type CapaActionPlanWorkspaceDraftSaveRequest,
} from "./capa-action-plan-workspace-draft-request";

const STATE = "S60" as const;
const READ_OPERATION = "read_action_plan_workspace_draft" as const;
const EDIT_OPERATION = "edit_action_plan_workspace_draft" as const;
const READ_PURPOSE = "CAPA_ACTION_PLAN_WORKSPACE_READ";
const EDIT_PURPOSE = "CAPA_ACTION_PLAN_WORKSPACE_EDIT";

export type CapaActionPlanWorkspaceDraftServiceResult =
  | { readonly status: "not_found" }
  | { readonly status: "loaded"; readonly workspace: CapaActionPlanWorkspaceDraft | null }
  | { readonly status: "saved"; readonly workspace: CapaActionPlanWorkspaceDraft }
  | { readonly status: "authorization_denied"; readonly reason_code: string; readonly policy_version: string }
  | { readonly status: "workflow_conflict"; readonly reason_code: "WORKFLOW_STATE_NOT_ALLOWED" }
  | { readonly status: "case_changed"; readonly reason_code: "WORKFLOW_MUTATION_DETECTED" }
  | { readonly status: "validation_failed"; readonly reason_code: string; readonly detail_reason_code?: string }
  | { readonly status: "concurrency_conflict" };

export interface LoadCapaActionPlanWorkspaceDraftCommand {
  readonly capa_case_id: CapaCaseId;
}

export interface SaveCapaActionPlanWorkspaceDraftCommand {
  readonly capa_case_id: CapaCaseId;
  readonly body: unknown;
  readonly request_trace: RequestTrace;
}

export interface CapaActionPlanWorkspaceDraftService {
  load(command: LoadCapaActionPlanWorkspaceDraftCommand): Promise<CapaActionPlanWorkspaceDraftServiceResult>;
  save(command: SaveCapaActionPlanWorkspaceDraftCommand): Promise<CapaActionPlanWorkspaceDraftServiceResult>;
}

export interface CapaActionPlanWorkspaceDraftServiceDependencies {
  readonly request_context: CapaRequestContext;
  readonly capa_repository: CapaRepository;
  readonly workspace_repository: CapaActionPlanWorkspaceDraftRepository;
  readonly transaction_manager: TransactionManager;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly return_cycle_resolver?: CapaActionPlanReturnCycleResolver;
  readonly now: () => Date;
}

export class CapaActionPlanWorkspaceDraftIntegrityError extends Error {
  constructor(message = "The authoritative S60 workspace context is inconsistent.") {
    super(message);
    this.name = "CapaActionPlanWorkspaceDraftIntegrityError";
  }
}

function iso(value: Date): IsoDateTime {
  if (!Number.isFinite(value.getTime())) throw new CapaActionPlanWorkspaceDraftIntegrityError("The trusted CAPA clock is invalid.");
  return value.toISOString() as IsoDateTime;
}

function controlled(value: string) {
  return value as never;
}

async function currentCase(
  dependencies: CapaActionPlanWorkspaceDraftServiceDependencies,
  capaCaseId: CapaCaseId,
): Promise<{ readonly capa_case: CapaCase; readonly case_version: CapaCaseVersion } | null> {
  const organizationId = dependencies.request_context.tenant.organization_id;
  const capaCase = await dependencies.capa_repository.findCaseById(organizationId, capaCaseId);
  if (capaCase === null) return null;
  if (capaCase.organization_id !== organizationId || capaCase.capa_case_id !== capaCaseId) throw new CapaActionPlanWorkspaceDraftIntegrityError();
  const caseVersion = await dependencies.capa_repository.findCaseVersionById(organizationId, capaCaseId, capaCase.current_version_id);
  if (caseVersion === null || caseVersion.organization_id !== organizationId || caseVersion.capa_case_id !== capaCaseId || caseVersion.case_version_id !== capaCase.current_version_id || caseVersion.status !== capaCase.status || caseVersion.version_number !== capaCase.record_version) throw new CapaActionPlanWorkspaceDraftIntegrityError();
  return { capa_case: capaCase, case_version: caseVersion };
}

async function authorize(
  dependencies: CapaActionPlanWorkspaceDraftServiceDependencies,
  operation: typeof READ_OPERATION | typeof EDIT_OPERATION,
  purpose: string,
  current: { readonly capa_case: CapaCase; readonly case_version: CapaCaseVersion },
): Promise<{ readonly status: "allowed" } | { readonly status: "denied"; readonly reason_code: string; readonly policy_version: string }> {
  const trustedNow = dependencies.now();
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    resource: { organization_id: dependencies.request_context.tenant.organization_id },
    operation,
    trusted_now: trustedNow,
  });
  if (precondition.status === "denied") return { status: "denied", reason_code: precondition.reason_code, policy_version: precondition.authorization_policy_version };
  const decision = await dependencies.authorization_policy.evaluate({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    operation,
    resource: {
      organization_id: current.capa_case.organization_id,
      resource_type: controlled("CAPA_ACTION_PLAN_WORKSPACE_DRAFT"),
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
    : { status: "denied", reason_code: decision.reason_code, policy_version: decision.policy_version };
}

function validatedWorkspace(
  value: CapaActionPlanWorkspaceDraft | null,
  organizationId: OrganizationId,
  capaCaseId: CapaCaseId,
): CapaActionPlanWorkspaceDraft | null {
  if (value === null) return null;
  const validated = validateCapaActionPlanWorkspaceDraft(value);
  if (validated.status !== "valid" || validated.value.organization_id !== organizationId || validated.value.capa_case_id !== capaCaseId) throw new CapaActionPlanWorkspaceDraftIntegrityError("The durable workspace draft is invalid or outside the request boundary.");
  return validated.value;
}

function constructDraft(
  request: CapaActionPlanWorkspaceDraftSaveRequest,
  context: CapaRequestContext,
  current: { readonly capa_case: CapaCase; readonly case_version: CapaCaseVersion },
  now: Date,
  returnResponse: CapaActionPlanReviewReturnResponseDraft | null,
): CapaActionPlanWorkspaceDraft {
  const draft = {
    schema_version: CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION,
    trust: "untrusted_human_draft",
    workflow_state: STATE,
    organization_id: context.tenant.organization_id,
    capa_case_id: current.capa_case.capa_case_id,
    case_version_id: current.case_version.case_version_id,
    record_version: current.case_version.version_number,
    draft_revision: request.expected_draft_revision === null ? 1 : request.expected_draft_revision + 1,
    action_plan: request.action_plan,
    action_plan_return_response: returnResponse,
    updated_by_user_id: context.owner_user_id,
    updated_at: iso(now),
  };
  const validated = validateCapaActionPlanWorkspaceDraft(draft);
  if (validated.status !== "valid") throw new CapaActionPlanWorkspaceDraftIntegrityError(`The constructed workspace draft is invalid: ${validated.reason_code}.`);
  return validated.value;
}

async function activeReturnCycle(
  dependencies: CapaActionPlanWorkspaceDraftServiceDependencies,
  capaCaseId: CapaCaseId,
): Promise<CapaActionPlanReturnCycle | null> {
  if (dependencies.return_cycle_resolver === undefined) return null;
  const resolution = await dependencies.return_cycle_resolver.resolve({
    organization_id: dependencies.request_context.tenant.organization_id,
    capa_case_id: capaCaseId,
  });
  if (resolution.status === "invalid") {
    throw new CapaActionPlanWorkspaceDraftIntegrityError("The action-plan return-cycle provenance is invalid.");
  }
  return resolution.status === "active" ? resolution.cycle : null;
}

function sameCycle(
  response: CapaActionPlanReviewReturnResponseDraft,
  cycle: CapaActionPlanReturnCycle,
): boolean {
  return response.return_transition_audit_event_id === cycle.return_transition_audit_event_id &&
    response.source_case_version_id === cycle.source_case_version_id &&
    response.resulting_case_version_id === cycle.resulting_case_version_id;
}

function responseForCycle(
  request: CapaActionPlanWorkspaceDraftSaveRequest,
  previous: CapaActionPlanWorkspaceDraft | null,
  cycle: CapaActionPlanReturnCycle | null,
  context: CapaRequestContext,
  now: Date,
): CapaActionPlanReviewReturnResponseDraft | null | "no_active_cycle" {
  const requested = request.action_plan_return_response;
  if (requested === undefined) return previous?.action_plan_return_response ?? null;
  if (requested === null) return null;
  if (cycle === null) return "no_active_cycle";
  const existing = previous?.action_plan_return_response;
  if (
    existing !== undefined &&
    existing !== null &&
    sameCycle(existing, cycle) &&
    existing.response_narrative === requested.response_narrative
  ) return existing;
  const principal = context.authentication.principal;
  if (principal.principal_type !== "human") {
    throw new CapaActionPlanWorkspaceDraftIntegrityError("A return response requires a trusted human actor.");
  }
  return {
    schema_version: "capa-action-plan-review-return-response-draft-1.0.0",
    response_narrative: requested.response_narrative,
    return_transition_audit_event_id: cycle.return_transition_audit_event_id,
    source_case_version_id: cycle.source_case_version_id,
    resulting_case_version_id: cycle.resulting_case_version_id,
    responded_by: { actor_type: "human", actor_id: principal.user_id },
    responded_at: iso(now),
  };
}

function responseVisibleForCycle(
  workspace: CapaActionPlanWorkspaceDraft | null,
  cycle: CapaActionPlanReturnCycle | null,
): CapaActionPlanWorkspaceDraft | null {
  if (workspace === null) return null;
  const response = workspace.action_plan_return_response;
  if (response === undefined || response === null || (cycle !== null && sameCycle(response, cycle))) return workspace;
  return { ...workspace, action_plan_return_response: null };
}

export function createCapaActionPlanWorkspaceDraftService(
  dependencies: CapaActionPlanWorkspaceDraftServiceDependencies,
): CapaActionPlanWorkspaceDraftService {
  return {
    async load(command) {
      const current = await currentCase(dependencies, command.capa_case_id);
      if (current === null) return { status: "not_found" };
      if (current.capa_case.status !== STATE) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
      const authorization = await authorize(dependencies, READ_OPERATION, READ_PURPOSE, current);
      if (authorization.status === "denied") return { status: "authorization_denied", reason_code: authorization.reason_code, policy_version: authorization.policy_version };
      const cycle = await activeReturnCycle(dependencies, command.capa_case_id);
      return {
        status: "loaded",
        workspace: responseVisibleForCycle(validatedWorkspace(
          await dependencies.workspace_repository.findDraft(dependencies.request_context.tenant.organization_id, command.capa_case_id),
          dependencies.request_context.tenant.organization_id,
          command.capa_case_id,
        ), cycle),
      };
    },
    async save(command) {
      const request = validateCapaActionPlanWorkspaceDraftSaveRequest(command.body);
      if (request.status !== "valid") return { status: "validation_failed", reason_code: request.reason_code, detail_reason_code: request.detail_reason_code };
      const current = await currentCase(dependencies, command.capa_case_id);
      if (current === null) return { status: "not_found" };
      if (current.capa_case.status !== STATE) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
      const authorization = await authorize(dependencies, EDIT_OPERATION, EDIT_PURPOSE, current);
      if (authorization.status === "denied") return { status: "authorization_denied", reason_code: authorization.reason_code, policy_version: authorization.policy_version };
      const cycle = await activeReturnCycle(dependencies, command.capa_case_id);
      const previous = validatedWorkspace(
        await dependencies.workspace_repository.findDraft(dependencies.request_context.tenant.organization_id, command.capa_case_id),
        dependencies.request_context.tenant.organization_id,
        command.capa_case_id,
      );
      const response = responseForCycle(request.value, previous, cycle, dependencies.request_context, dependencies.now());
      if (response === "no_active_cycle") {
        return { status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_RETURN_RESPONSE", detail_reason_code: "NO_ACTIVE_ACTION_PLAN_RETURN_CYCLE" };
      }
      const draft = constructDraft(request.value, dependencies.request_context, current, dependencies.now(), response);
      const result = await dependencies.transaction_manager.runInTransaction(command.request_trace, async (transaction) => dependencies.workspace_repository.saveDraft(transaction, {
        draft,
        expected_draft_revision: request.value.expected_draft_revision,
        expected_case_version_id: current.case_version.case_version_id,
        expected_record_version: current.case_version.version_number,
        expected_workflow_state: current.capa_case.status,
      }));
      if (result.status === "case_changed") return { status: "case_changed", reason_code: "WORKFLOW_MUTATION_DETECTED" };
      return result.status === "concurrency_conflict" ? result : { status: "saved", workspace: responseVisibleForCycle(validatedWorkspace(result.draft, dependencies.request_context.tenant.organization_id, command.capa_case_id), cycle)! };
    },
  };
}
