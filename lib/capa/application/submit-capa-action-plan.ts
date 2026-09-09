import { createHash } from "node:crypto";
import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import { CAPA_ACTION_PLAN_SCHEMA_VERSION, CAPA_ACTION_PLAN_SECTION_TYPE, evaluateCapaActionPlanReadiness, validateCapaActionPlan, type CapaActionPlanContent, type CapaActionPlanReadinessBlockerCode } from "../domain/capa-action-plan";
import { CAPA_STATE } from "../domain/capa-state";
import type { AuditEvent, AuditEventId, CapaCase, CapaCaseId, CapaCaseVersion, CapaCaseVersionId, CapaSectionVersion, CapaSectionVersionId, ControlledCode, IdempotencyKey, IsoDateTime, RequestTrace } from "../domain/capa-types";
import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { CapaWorkflowIdempotencyRecord, CapaWorkflowIdempotencyRepository, CapaWorkflowRequestFingerprint } from "../../database/repositories/capa-workflow-idempotency-repository";
import type { CapaActionPlanWorkspaceDraftRepository } from "../../database/repositories/capa-action-plan-workspace-draft-repository";
import type { TransactionContext, TransactionManager } from "../../database/transactions";
import type { CreateCapaClock, CreateCapaIdGenerator } from "./create-capa";
import { AuditEventAppendConflictError } from "./create-capa";
import { validateCapaActionPlanWorkspaceDraft } from "./capa-action-plan-workspace-draft-validator";
import { canonicalJson } from "../ai/capa-ai-generation-trace";

const SOURCE_STATE = CAPA_STATE.ACTION_PLANNING;
const TARGET_STATE = CAPA_STATE.ACTION_PLAN_REVIEW;
const OPERATION_CODE = "SUBMIT_CAPA_ACTION_PLAN";
const TRANSITION_MEANING = "Submit action plan for review";
const FINGERPRINT_VERSION = "submit-capa-action-plan-fingerprint-1";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;
const controlled = (value: string) => value as ControlledCode;
const iso = (value: Date) => value.toISOString() as IsoDateTime;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export interface SubmitCapaActionPlanConfiguration { readonly workflow_version: string; readonly audit_schema_version: string; readonly authorization_purpose: ControlledCode; }
export interface SubmitCapaActionPlanDependencies { readonly transaction_manager: TransactionManager; readonly capa_repository: CapaRepository; readonly audit_repository: AuditRepository; readonly workspace_repository: CapaActionPlanWorkspaceDraftRepository; readonly workflow_idempotency_repository: CapaWorkflowIdempotencyRepository; readonly authorization_policy: CapaAuthorizationPolicy; readonly id_generator: CreateCapaIdGenerator; readonly clock: CreateCapaClock; readonly configuration: SubmitCapaActionPlanConfiguration; }
export interface SubmitCapaActionPlanCommand { readonly authentication: AuthenticationContext; readonly tenant: TenantContext; readonly capa_case_id: CapaCaseId; readonly expected_record_version: number; readonly expected_current_version_id: CapaCaseVersionId; readonly request_trace: RequestTrace; readonly body: unknown; }

interface ValidatedBody { readonly expected_record_version: number; readonly expected_current_version_id: CapaCaseVersionId; }
interface SourceMaterial { readonly all: readonly CapaSectionVersion[]; readonly prior_action_plan: CapaSectionVersion | null; }
interface WorkspaceMaterial { readonly action_plan: CapaActionPlanContent; readonly draft_revision: number; }
interface CompletedSubmission { readonly capa_case: CapaCase; readonly case_version: CapaCaseVersion; readonly action_plan_section_version: CapaSectionVersion; readonly transition_audit_event_id: AuditEventId; }
export type SubmitCapaActionPlanResult =
  | ({ readonly status: "submitted" } & CompletedSubmission)
  | ({ readonly status: "already_submitted" } & CompletedSubmission)
  | { readonly status: "validation_failed"; readonly reason_code: "INVALID_ACTION_PLAN_SUBMISSION_BODY" | "INVALID_ACTION_PLAN_WORKSPACE"; readonly detail_reason_code?: string }
  | { readonly status: "submission_blocked"; readonly blocker_codes: readonly CapaActionPlanReadinessBlockerCode[] }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "authorization_denied"; readonly reason_code: string; readonly policy_version: string }
  | { readonly status: "idempotency_conflict"; readonly reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" }
  | { readonly status: "concurrency_conflict"; readonly reason_code: "RECORD_VERSION_CONFLICT" | "CURRENT_VERSION_CONFLICT" | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED" }
  | { readonly status: "workflow_conflict"; readonly reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };

export class SubmitCapaActionPlanIntegrityError extends Error { constructor(message = "The authoritative S60 action-plan submission source is inconsistent.") { super(message); this.name = "SubmitCapaActionPlanIntegrityError"; } }
export class SubmitCapaActionPlanIdempotencyConfigurationError extends Error { constructor() { super("Action-plan submission requires a valid idempotency key."); this.name = "SubmitCapaActionPlanIdempotencyConfigurationError"; } }
class SubmissionConcurrencyError extends Error { constructor(readonly reason_code: "RECORD_VERSION_CONFLICT" | "CURRENT_VERSION_CONFLICT" | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED") { super("The CAPA changed before action-plan submission could be committed."); } }
class SubmissionWorkflowError extends Error {}

function validateBody(value: unknown): { readonly status: "valid"; readonly value: ValidatedBody } | Extract<SubmitCapaActionPlanResult, { readonly status: "validation_failed" }> {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.expected_record_version !== "number" || !Number.isSafeInteger(value.expected_record_version) || value.expected_record_version < 1 || typeof value.expected_current_version_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.expected_current_version_id)) return { status: "validation_failed", reason_code: "INVALID_ACTION_PLAN_SUBMISSION_BODY" };
  return { status: "valid", value: { expected_record_version: value.expected_record_version, expected_current_version_id: value.expected_current_version_id as CapaCaseVersionId } };
}
function requireIdempotencyKey(trace: RequestTrace): IdempotencyKey { const key = trace.idempotency_key; if (typeof key !== "string" || key.length === 0 || key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH || key.trim() !== key) throw new SubmitCapaActionPlanIdempotencyConfigurationError(); return key; }
function fingerprint(dependencies: SubmitCapaActionPlanDependencies, command: SubmitCapaActionPlanCommand, workspace: WorkspaceMaterial): CapaWorkflowRequestFingerprint { return createHash("sha256").update(canonicalJson({ fingerprint_version: FINGERPRINT_VERSION, organization_id: command.tenant.organization_id, capa_case_id: command.capa_case_id, operation_code: OPERATION_CODE, expected_record_version: command.expected_record_version, expected_current_version_id: command.expected_current_version_id, action_plan: workspace.action_plan, workspace_draft_revision: workspace.draft_revision, configuration: { workflow_version: dependencies.configuration.workflow_version, action_plan_schema_version: CAPA_ACTION_PLAN_SCHEMA_VERSION, audit_schema_version: dependencies.configuration.audit_schema_version } }), "utf8").digest("hex") as CapaWorkflowRequestFingerprint; }

async function loadSourceMaterial(dependencies: SubmitCapaActionPlanDependencies, capaCase: CapaCase, sourceVersion: CapaCaseVersion): Promise<SourceMaterial> {
  if (new Set(sourceVersion.section_version_ids).size !== sourceVersion.section_version_ids.length) throw new SubmitCapaActionPlanIntegrityError("The S60 snapshot contains duplicate section references.");
  const loaded = await Promise.all(sourceVersion.section_version_ids.map((id) => dependencies.capa_repository.findSectionVersionById(capaCase.organization_id, capaCase.capa_case_id, id)));
  if (loaded.some((section) => section === null)) throw new SubmitCapaActionPlanIntegrityError("The S60 snapshot references a missing section.");
  const all = loaded as CapaSectionVersion[];
  if (all.some((section) => section.organization_id !== capaCase.organization_id || section.capa_case_id !== capaCase.capa_case_id || !Number.isSafeInteger(section.version_number) || section.version_number < 1)) throw new SubmitCapaActionPlanIntegrityError();
  const actionPlans = all.filter((section) => section.section_type === CAPA_ACTION_PLAN_SECTION_TYPE);
  if (actionPlans.length > 1) throw new SubmitCapaActionPlanIntegrityError("The S60 snapshot has ambiguous action-plan sections.");
  if (actionPlans[0] !== undefined && actionPlans[0].schema_version !== CAPA_ACTION_PLAN_SCHEMA_VERSION) throw new SubmitCapaActionPlanIntegrityError("The prior action-plan schema metadata is invalid.");
  if (actionPlans[0] !== undefined && validateCapaActionPlan(actionPlans[0].content).status !== "valid") throw new SubmitCapaActionPlanIntegrityError("The prior action-plan section is malformed.");
  return { all: Object.freeze(all), prior_action_plan: actionPlans[0] ?? null };
}
function replacedSectionIds(sourceVersion: CapaCaseVersion, prior: CapaSectionVersion | null, next: CapaSectionVersionId): readonly CapaSectionVersionId[] { const ids = sourceVersion.section_version_ids.map((id) => prior !== null && id === prior.section_version_id ? next : id); if (prior === null) ids.push(next); if (new Set(ids).size !== ids.length) throw new SubmitCapaActionPlanIntegrityError("The resulting section identity set is invalid."); if (prior !== null && !ids.includes(next)) throw new SubmitCapaActionPlanIntegrityError("The action-plan section replacement is ambiguous."); return Object.freeze(ids); }
async function loadWorkspace(dependencies: SubmitCapaActionPlanDependencies, transaction: TransactionContext, capaCase: CapaCase, sourceVersion: CapaCaseVersion): Promise<{ readonly status: "valid"; readonly value: WorkspaceMaterial } | { readonly status: "invalid"; readonly detail_reason_code: string }> {
  const workspace = await dependencies.workspace_repository.findDraftForUpdate(transaction, capaCase.organization_id, capaCase.capa_case_id);
  if (workspace === null) return { status: "invalid", detail_reason_code: "MISSING_ACTION_PLAN_WORKSPACE" };
  const validated = validateCapaActionPlanWorkspaceDraft(workspace);
  if (validated.status !== "valid") return { status: "invalid", detail_reason_code: validated.reason_code };
  if (validated.value.organization_id !== capaCase.organization_id || validated.value.capa_case_id !== capaCase.capa_case_id || validated.value.case_version_id !== sourceVersion.case_version_id || validated.value.record_version !== sourceVersion.version_number || validated.value.workflow_state !== SOURCE_STATE) return { status: "invalid", detail_reason_code: "ACTION_PLAN_WORKSPACE_BINDING_MISMATCH" };
  return { status: "valid", value: { action_plan: validated.value.action_plan, draft_revision: validated.value.draft_revision } };
}
function metadataId(value: unknown): string | null { return typeof value === "string" ? value : null; }

async function replay(dependencies: SubmitCapaActionPlanDependencies, record: CapaWorkflowIdempotencyRecord, command: SubmitCapaActionPlanCommand, workspace: WorkspaceMaterial): Promise<SubmitCapaActionPlanResult> {
  const [capaCase, sourceVersion, version, audit] = await Promise.all([dependencies.capa_repository.findCaseById(record.organization_id, record.capa_case_id), dependencies.capa_repository.findCaseVersionById(record.organization_id, record.capa_case_id, record.source_case_version_id), dependencies.capa_repository.findCaseVersionById(record.organization_id, record.capa_case_id, record.resulting_case_version_id), dependencies.audit_repository.findEventById(record.organization_id, record.audit_event_id)]);
  if (record.operation_code !== OPERATION_CODE || capaCase === null || capaCase.organization_id !== record.organization_id || capaCase.capa_case_id !== record.capa_case_id || sourceVersion === null || sourceVersion.organization_id !== record.organization_id || sourceVersion.capa_case_id !== record.capa_case_id || sourceVersion.case_version_id !== record.source_case_version_id || version === null || version.organization_id !== record.organization_id || version.capa_case_id !== record.capa_case_id || audit === null || audit.event_id !== record.audit_event_id || audit.organization_id !== record.organization_id || audit.aggregate_type !== "CAPA_CASE" || audit.aggregate_id !== record.capa_case_id || sourceVersion.status !== SOURCE_STATE || version.status !== TARGET_STATE || version.parent_version_id !== sourceVersion.case_version_id || audit.event_type !== "EVT-STATE-TRANSITION" || audit.action !== OPERATION_CODE || audit.metadata.from_state !== SOURCE_STATE || audit.metadata.to_state !== TARGET_STATE || audit.metadata.transition_event !== TRANSITION_MEANING || audit.metadata.source_case_version_id !== sourceVersion.case_version_id || audit.metadata.resulting_case_version_id !== version.case_version_id || audit.aggregate_version !== version.version_number || audit.target.object_version_id !== version.case_version_id || audit.metadata.workspace_draft_revision !== workspace.draft_revision || fingerprint(dependencies, command, workspace) !== record.request_fingerprint) throw new SubmitCapaActionPlanIntegrityError("The action-plan submission replay record is incomplete.");
  const source = await loadSourceMaterial(dependencies, capaCase, sourceVersion);
  const sections = await Promise.all(version.section_version_ids.map((id) => dependencies.capa_repository.findSectionVersionById(record.organization_id, record.capa_case_id, id)));
  const plans = sections.filter((section): section is CapaSectionVersion => section?.section_type === CAPA_ACTION_PLAN_SECTION_TYPE);
  const actionPlanId = metadataId(audit.metadata.action_plan_section_version_id);
  if (sections.some((section) => section === null) || new Set(version.section_version_ids).size !== version.section_version_ids.length || sections.some((section) => section!.organization_id !== record.organization_id || section!.capa_case_id !== record.capa_case_id) || plans.length !== 1 || actionPlanId === null || plans[0]!.section_version_id !== actionPlanId || plans[0]!.schema_version !== CAPA_ACTION_PLAN_SCHEMA_VERSION || validateCapaActionPlan(plans[0]!.content).status !== "valid" || canonicalJson(version.section_version_ids) !== canonicalJson(replacedSectionIds(sourceVersion, source.prior_action_plan, actionPlanId as CapaSectionVersionId)) || canonicalJson(plans[0]!.content) !== canonicalJson(workspace.action_plan)) throw new SubmitCapaActionPlanIntegrityError("The action-plan replay section is inconsistent.");
  return { status: "already_submitted", capa_case: { ...capaCase, current_version_id: version.case_version_id, status: version.status, record_version: version.version_number }, case_version: version, action_plan_section_version: plans[0]!, transition_audit_event_id: audit.event_id };
}

export async function submitCapaActionPlan(dependencies: SubmitCapaActionPlanDependencies, command: SubmitCapaActionPlanCommand): Promise<SubmitCapaActionPlanResult> {
  const validatedBody = validateBody(command.body);
  if (validatedBody.status === "validation_failed") return validatedBody;
  if (validatedBody.value.expected_record_version !== command.expected_record_version || validatedBody.value.expected_current_version_id !== command.expected_current_version_id) return { status: "validation_failed", reason_code: "INVALID_ACTION_PLAN_SUBMISSION_BODY" };
  const trustedNow = dependencies.clock.now(); if (!Number.isFinite(trustedNow.getTime())) throw new SubmitCapaActionPlanIntegrityError("Trusted time is invalid.");
  const organizationId = command.tenant.organization_id;
  const precondition = evaluateCapaAuthorizationPreconditions({ authentication: command.authentication, tenant: command.tenant, resource: { organization_id: organizationId }, operation: "submit_action_plan", trusted_now: trustedNow });
  if (precondition.status === "denied") return { status: "authorization_denied", reason_code: precondition.reason_code, policy_version: precondition.authorization_policy_version };
  if (command.authentication.principal.principal_type !== "human") return { status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED", policy_version: command.tenant.authorization_policy_version };
  const humanActorId = command.authentication.principal.user_id;
  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  const capaCase = await dependencies.capa_repository.findCaseById(organizationId, command.capa_case_id); if (capaCase === null) return { status: "not_found_or_not_authorized" };
  const sourceVersion = await dependencies.capa_repository.findCaseVersionById(organizationId, capaCase.capa_case_id, command.expected_current_version_id); if (sourceVersion === null || sourceVersion.organization_id !== organizationId || sourceVersion.capa_case_id !== capaCase.capa_case_id) return { status: "not_found_or_not_authorized" };
  const policy = await dependencies.authorization_policy.evaluate({ authentication: command.authentication, tenant: command.tenant, operation: "submit_action_plan", resource: { organization_id: organizationId, resource_type: controlled("CAPA_CASE"), resource_id: capaCase.capa_case_id, resource_version_id: sourceVersion.case_version_id, capa_case_id: capaCase.capa_case_id, case_version_id: sourceVersion.case_version_id, workflow_state: sourceVersion.status }, purpose: dependencies.configuration.authorization_purpose, trusted_now: trustedNow });
  if (policy.decision !== "allow") return { status: "authorization_denied", reason_code: policy.reason_code, policy_version: policy.policy_version };
  const source = await loadSourceMaterial(dependencies, capaCase, sourceVersion);
  const existingOperation = await dependencies.transaction_manager.runInTransaction(command.request_trace, (transaction) => dependencies.workflow_idempotency_repository.findWorkflowOperation(transaction, { organization_id: organizationId, capa_case_id: command.capa_case_id, operation_code: controlled(OPERATION_CODE), idempotency_key: idempotencyKey }));
  if (existingOperation !== null) {
    const replayOutcome = await dependencies.transaction_manager.runInTransaction(command.request_trace, async (transaction) => {
      const workspaceResult = await loadWorkspace(dependencies, transaction, capaCase, sourceVersion);
      if (workspaceResult.status === "invalid") return { kind: "validation" as const, detail_reason_code: workspaceResult.detail_reason_code };
      if (fingerprint(dependencies, command, workspaceResult.value) !== existingOperation.request_fingerprint) return { kind: "conflict" as const };
      return { kind: "replay" as const, result: await replay(dependencies, existingOperation, command, workspaceResult.value) };
    });
    if (replayOutcome.kind === "validation") return { status: "validation_failed", reason_code: "INVALID_ACTION_PLAN_WORKSPACE", detail_reason_code: replayOutcome.detail_reason_code };
    if (replayOutcome.kind === "conflict") return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
    return replayOutcome.result;
  }
  if (sourceVersion.status !== SOURCE_STATE || capaCase.status !== SOURCE_STATE) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" };
  try {
    const result = await dependencies.transaction_manager.runInTransaction(command.request_trace, async (transaction) => {
      const workspaceResult = await loadWorkspace(dependencies, transaction, capaCase, sourceVersion);
      if (workspaceResult.status === "invalid") return { kind: "validation" as const, detail_reason_code: workspaceResult.detail_reason_code };
      const workspace = workspaceResult.value;
      const actionPlanValidation = validateCapaActionPlan(workspace.action_plan);
      if (actionPlanValidation.status !== "valid") return { kind: "validation" as const, detail_reason_code: actionPlanValidation.reason_code };
      const readiness = evaluateCapaActionPlanReadiness(actionPlanValidation.value);
      if (readiness.status === "blocked") return { kind: "blocked" as const, blocker_codes: readiness.blocker_codes };
      const requestFingerprint = fingerprint(dependencies, command, workspace);
      const nextVersionId = dependencies.id_generator.generateCaseVersionId();
      const actionPlanSectionId = dependencies.id_generator.generateSectionVersionId();
      const auditEventId = dependencies.id_generator.generateAuditEventId();
      const timestamp = iso(trustedNow);
      const actor = { actor_type: "human" as const, actor_id: humanActorId };
      const actionPlanSection: CapaSectionVersion = { organization_id: organizationId, section_version_id: actionPlanSectionId, capa_case_id: capaCase.capa_case_id, section_type: controlled(CAPA_ACTION_PLAN_SECTION_TYPE), version_number: (source.prior_action_plan?.version_number ?? 0) + 1, ...(source.prior_action_plan === null ? {} : { parent_version_id: source.prior_action_plan.section_version_id }), schema_version: CAPA_ACTION_PLAN_SCHEMA_VERSION, content: actionPlanValidation.value as unknown as Readonly<Record<string, unknown>>, change_reason: TRANSITION_MEANING, effective_at: timestamp, created_at: timestamp, created_by: actor };
      const nextVersion: CapaCaseVersion = { organization_id: organizationId, case_version_id: nextVersionId, capa_case_id: capaCase.capa_case_id, version_number: sourceVersion.version_number + 1, parent_version_id: sourceVersion.case_version_id, change_reason: TRANSITION_MEANING, status: TARGET_STATE, section_version_ids: replacedSectionIds(sourceVersion, source.prior_action_plan, actionPlanSectionId), effective_at: timestamp, created_at: timestamp, created_by: actor };
      const claim = await dependencies.workflow_idempotency_repository.claimWorkflowOperation(transaction, { organization_id: organizationId, idempotency_key: idempotencyKey, operation_code: controlled(OPERATION_CODE), request_fingerprint: requestFingerprint, capa_case_id: capaCase.capa_case_id, source_case_version_id: sourceVersion.case_version_id, resulting_case_version_id: nextVersionId, audit_event_id: auditEventId });
      if (claim.status === "conflict") return { kind: "conflict" as const };
      if (claim.status === "already_claimed") return { kind: "replay" as const, record: claim.record, workspace };
      if (capaCase.status !== SOURCE_STATE) throw new SubmissionWorkflowError();
      if (capaCase.record_version !== command.expected_record_version) throw new SubmissionConcurrencyError("RECORD_VERSION_CONFLICT");
      if (capaCase.current_version_id !== command.expected_current_version_id) throw new SubmissionConcurrencyError("CURRENT_VERSION_CONFLICT");
      await dependencies.capa_repository.insertSectionVersion(transaction, actionPlanSection);
      await dependencies.capa_repository.insertCaseVersion(transaction, nextVersion);
      const advanced = await dependencies.capa_repository.advanceCurrentVersion(transaction, { organization_id: organizationId, capa_case_id: capaCase.capa_case_id, expected_record_version: command.expected_record_version, expected_current_version_id: command.expected_current_version_id, next_current_version_id: nextVersionId, next_status: TARGET_STATE, updated_at: timestamp, updated_by: actor });
      if (advanced.status === "conflict") throw new SubmissionConcurrencyError(advanced.reason_code);
      if (advanced.capa_case.record_version !== capaCase.record_version + 1) throw new SubmitCapaActionPlanIntegrityError("The aggregate record version did not advance exactly once.");
      const audit: AuditEvent = { organization_id: organizationId, event_id: auditEventId, event_type: controlled("EVT-STATE-TRANSITION"), schema_version: dependencies.configuration.audit_schema_version, aggregate_type: controlled("CAPA_CASE"), aggregate_id: capaCase.capa_case_id, aggregate_version: advanced.capa_case.record_version, actor, occurred_at: timestamp, request_id: command.request_trace.request_id, correlation_id: command.request_trace.correlation_id, idempotency_key: idempotencyKey, action: controlled(OPERATION_CODE), target: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: nextVersionId }, outcome: "succeeded", change: { before_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: sourceVersion.case_version_id }, after_ref: { object_type: controlled("CAPA_CASE"), object_id: capaCase.capa_case_id, object_version_id: nextVersionId } }, configuration_versions: { workflow: dependencies.configuration.workflow_version, action_plan_schema: CAPA_ACTION_PLAN_SCHEMA_VERSION, authorization_policy: policy.policy_version, audit_schema: dependencies.configuration.audit_schema_version }, metadata: { transition_event: TRANSITION_MEANING, from_state: SOURCE_STATE, to_state: TARGET_STATE, source_case_version_id: sourceVersion.case_version_id, resulting_case_version_id: nextVersionId, action_plan_section_version_id: actionPlanSectionId, workspace_draft_revision: workspace.draft_revision, required_permission: "capa.case.edit", relied_on_role_assignment_ids: policy.relied_on_role_assignment_ids } };
      const appended = await dependencies.audit_repository.appendEvent(transaction, audit); if (appended.status !== "appended" || appended.event_id !== auditEventId) throw new AuditEventAppendConflictError();
      return { kind: "submitted" as const, completion: { capa_case: advanced.capa_case, case_version: nextVersion, action_plan_section_version: actionPlanSection, transition_audit_event_id: auditEventId } };
    });
    if (result.kind === "validation") return { status: "validation_failed", reason_code: "INVALID_ACTION_PLAN_WORKSPACE", detail_reason_code: result.detail_reason_code };
    if (result.kind === "blocked") return { status: "submission_blocked", blocker_codes: result.blocker_codes };
    if (result.kind === "conflict") return { status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
    if (result.kind === "replay") return replay(dependencies, result.record, command, result.workspace);
    return { status: "submitted", ...result.completion };
  } catch (error) { if (error instanceof SubmissionConcurrencyError) return { status: "concurrency_conflict", reason_code: error.reason_code }; if (error instanceof SubmissionWorkflowError) return { status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" }; throw error; }
}
