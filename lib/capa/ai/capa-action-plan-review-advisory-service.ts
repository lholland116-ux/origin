import type { CapaCaseId, CapaCaseVersionId, CorrelationId, OrganizationId, RequestId, UserId } from "../domain/capa-types";
import type { TransactionManager } from "../../database/transactions";
import type { AuthoritativeS70ActionPlanReviewContext, CapaActionPlanReviewAdvisoryContextAssembly, CapaActionPlanReviewAdvisoryContextResolution } from "./capa-action-plan-review-advisory-context";
import { CAPA_ACTION_PLAN_REVIEW_ADVISORY_AGENT, CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION, type CapaActionPlanReviewAdvisoryAgentGate } from "./capa-action-plan-review-advisory-agent-gate";
import { CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION, type CapaActionPlanReviewAdvisoryResponse } from "./capa-action-plan-review-advisory-contract";
import type { CapaActionPlanReviewAdvisoryGenerationTraceCapture } from "./capa-action-plan-review-advisory-model-generator";
import type { CapaActionPlanReviewAdvisoryOutputRepository } from "../../database/repositories/capa-action-plan-review-advisory-output-repository";

export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_SERVICE_REASON_CODES = ["CASE_NOT_FOUND_OR_NOT_AUTHORIZED", "CASE_NOT_IN_ACTION_PLAN_REVIEW", "ADVISORY_ACCESS_DENIED", "AGENT_NOT_ELIGIBLE", "ADVISORY_GENERATION_FAILED", "INVALID_ADVISORY_RESULT", "ADVISORY_PERSISTENCE_FAILED", "WORKFLOW_MUTATION_DETECTED"] as const;
export type CapaActionPlanReviewAdvisoryServiceReasonCode = typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_SERVICE_REASON_CODES[number];
export const CAPA_ACTION_PLAN_REVIEW_ADVISORY_VALIDATION_REASON_CODES = [
  "RESPONSE_OR_TRACE_MISSING",
  "STATUS_MISMATCH",
  "OUTPUT_SCHEMA_VERSION_MISMATCH",
  "SOURCE_CASE_VERSION_MISMATCH",
  "ACTION_PLAN_SECTION_VERSION_MISMATCH",
  "ADVISORY_ONLY_INVARIANT_FAILED",
  "WORKFLOW_MUTATION_INVARIANT_FAILED",
  "CONTROLLED_RECORD_MUTATION_INVARIANT_FAILED",
  "APPROVAL_CLAIM_INVARIANT_FAILED",
  "WORKFLOW_TRANSITION_INVARIANT_FAILED",
  "HUMAN_ACCEPTANCE_INVARIANT_FAILED",
  "FINDING_BINDING_SHAPE_INVALID",
  "AFFECTED_ACTION_ID_NOT_AUTHORITATIVE",
  "AFFECTED_ROOT_CAUSE_ID_NOT_AUTHORITATIVE",
  "REFERENCE_KEY_NOT_IN_MANIFEST",
  "PROMPT_PACKAGE_SCHEMA_MISMATCH",
  "WORKFLOW_SCOPE_MISMATCH",
  "ORGANIZATION_BINDING_MISMATCH",
  "CASE_BINDING_MISMATCH",
  "CASE_VERSION_BINDING_MISMATCH",
  "RECORD_VERSION_BINDING_MISMATCH",
  "TRACE_RUN_BINDING_MISMATCH",
  "TRACE_REQUEST_BINDING_MISMATCH",
  "TRACE_CORRELATION_BINDING_MISMATCH",
  "GENERATION_OPERATION_MISMATCH",
  "GENERATION_OUTPUT_SCHEMA_MISMATCH",
] as const;
export type CapaActionPlanReviewAdvisoryValidationReasonCode = typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_VALIDATION_REASON_CODES[number];
export interface CapaActionPlanReviewAdvisoryValidationDiagnostic {
  readonly reason_code: CapaActionPlanReviewAdvisoryValidationReasonCode;
  readonly path: string;
  readonly finding_count: number;
  readonly affected_action_id_count: number;
  readonly affected_root_cause_id_count: number;
  readonly reference_key_count: number;
  readonly expected_workflow_state: "S70";
}
export class CapaActionPlanReviewAdvisoryServiceError extends Error {
  readonly diagnostic_reason_code: CapaActionPlanReviewAdvisoryValidationReasonCode | null;
  readonly diagnostic_path: string | null;
  readonly diagnostic_finding_count: number | null;
  readonly diagnostic_affected_action_id_count: number | null;
  readonly diagnostic_affected_root_cause_id_count: number | null;
  readonly diagnostic_reference_key_count: number | null;
  readonly diagnostic_expected_workflow_state: "S70" | null;

  constructor(
    readonly reason_code: CapaActionPlanReviewAdvisoryServiceReasonCode,
    readonly diagnostic_cause_name?: string,
    diagnostic?: CapaActionPlanReviewAdvisoryValidationDiagnostic,
  ) {
    super("The governed CAPA S70 action-plan review advisory operation failed.");
    this.name = "CapaActionPlanReviewAdvisoryServiceError";
    this.diagnostic_reason_code = diagnostic?.reason_code ?? null;
    this.diagnostic_path = diagnostic?.path ?? null;
    this.diagnostic_finding_count = diagnostic?.finding_count ?? null;
    this.diagnostic_affected_action_id_count = diagnostic?.affected_action_id_count ?? null;
    this.diagnostic_affected_root_cause_id_count = diagnostic?.affected_root_cause_id_count ?? null;
    this.diagnostic_reference_key_count = diagnostic?.reference_key_count ?? null;
    this.diagnostic_expected_workflow_state = diagnostic?.expected_workflow_state ?? null;
  }
}
export interface CapaActionPlanReviewAdvisoryInvocation { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly user_id: UserId; readonly request_id: RequestId; readonly correlation_id: CorrelationId; readonly request: { readonly expected_case_version_id: CapaCaseVersionId; readonly expected_record_version: number } }
export interface CapaActionPlanReviewAdvisoryContextResolver { resolve(input: { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId }): Promise<CapaActionPlanReviewAdvisoryContextResolution>; assertCaseUnchanged(context: AuthoritativeS70ActionPlanReviewContext): Promise<boolean>; }
export interface CapaActionPlanReviewAdvisoryAuthorizer { authorize(input: { readonly context: AuthoritativeS70ActionPlanReviewContext; readonly operation: typeof CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION }): Promise<boolean>; }
export interface CapaActionPlanReviewAdvisoryGenerator { generate(input: { readonly context: CapaActionPlanReviewAdvisoryContextAssembly; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<{ readonly response: CapaActionPlanReviewAdvisoryResponse; readonly trace: CapaActionPlanReviewAdvisoryGenerationTraceCapture }>; }
export interface CapaActionPlanReviewAdvisoryServiceDependencies { readonly context_resolver: CapaActionPlanReviewAdvisoryContextResolver; readonly authorizer: CapaActionPlanReviewAdvisoryAuthorizer; readonly agent_gate: CapaActionPlanReviewAdvisoryAgentGate; readonly generator: CapaActionPlanReviewAdvisoryGenerator; readonly output_repository: CapaActionPlanReviewAdvisoryOutputRepository; readonly transaction_manager: TransactionManager; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validContext(value: unknown, invocation: CapaActionPlanReviewAdvisoryInvocation): value is AuthoritativeS70ActionPlanReviewContext { return record(value) && value.trust === "authoritative_server_context" && value.organization_id === invocation.organization_id && value.capa_case_id === invocation.capa_case_id && value.actor === invocation.user_id && value.workflow_state === "S70" && value.case_version_id === invocation.request.expected_case_version_id && value.record_version === invocation.request.expected_record_version && Array.isArray(value.active_roles); }
type GeneratedAdvisory = { readonly response: CapaActionPlanReviewAdvisoryResponse; readonly trace: CapaActionPlanReviewAdvisoryGenerationTraceCapture };
type GeneratedValidationResult =
  | { readonly valid: true; readonly value: GeneratedAdvisory }
  | { readonly valid: false; readonly diagnostic: CapaActionPlanReviewAdvisoryValidationDiagnostic };

function generatedCounts(value: unknown): Omit<CapaActionPlanReviewAdvisoryValidationDiagnostic, "reason_code" | "path" | "expected_workflow_state"> {
  const response = record(value) && record(value.response) ? value.response : null;
  const proposal = response && record(response.proposal) ? response.proposal : null;
  const findings = proposal && Array.isArray(proposal.findings) ? proposal.findings : [];
  let affected_action_id_count = 0;
  let affected_root_cause_id_count = 0;
  let reference_key_count = 0;
  for (const finding of findings) {
    if (!record(finding)) continue;
    if (Array.isArray(finding.affected_action_ids)) affected_action_id_count += finding.affected_action_ids.length;
    if (Array.isArray(finding.affected_root_cause_ids)) affected_root_cause_id_count += finding.affected_root_cause_ids.length;
    if (Array.isArray(finding.reference_keys)) reference_key_count += finding.reference_keys.length;
  }
  return { finding_count: findings.length, affected_action_id_count, affected_root_cause_id_count, reference_key_count };
}

function invalidGenerated(
  value: unknown,
  reason_code: CapaActionPlanReviewAdvisoryValidationReasonCode,
  path: string,
): GeneratedValidationResult {
  return { valid: false, diagnostic: { reason_code, path, ...generatedCounts(value), expected_workflow_state: "S70" } };
}

function validateGenerated(
  value: unknown,
  context: AuthoritativeS70ActionPlanReviewContext,
  invocation: CapaActionPlanReviewAdvisoryInvocation,
  assembly: CapaActionPlanReviewAdvisoryContextAssembly,
): GeneratedValidationResult {
  if (!record(value) || !record(value.response)) return invalidGenerated(value, "RESPONSE_OR_TRACE_MISSING", "generated.response");
  if (!record(value.trace)) return invalidGenerated(value, "RESPONSE_OR_TRACE_MISSING", "generated.trace");
  const response = value.response;
  const trace = value.trace;
  const pkg = record(trace.package) ? trace.package : null;
  const scope = pkg && record(pkg.scope) ? pkg.scope : null;
  const identity = pkg && record(pkg.trace) ? pkg.trace : null;
  const output = pkg && record(pkg.generation_contract) ? pkg.generation_contract : null;
  const actionIds = new Set(context.sections.action_plan.content.items.map((item) => item.item_id));
  const rootIds = new Set(context.sections.root_cause_package.content.hypotheses.map((item) => item.hypothesis_id));
  const referenceKeys = new Set(assembly.reference_manifest.map((item) => item.reference_key));
  const proposal = record(response.proposal) ? response.proposal : null;
  const findings = proposal && Array.isArray(proposal.findings) ? proposal.findings : [];

  if (response.status !== "completed_draft") return invalidGenerated(value, "STATUS_MISMATCH", "response.status");
  if (response.output_schema_version !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION) return invalidGenerated(value, "OUTPUT_SCHEMA_VERSION_MISMATCH", "response.output_schema_version");
  if (response.source_case_version_id !== context.case_version_id) return invalidGenerated(value, "SOURCE_CASE_VERSION_MISMATCH", "response.source_case_version_id");
  if (response.action_plan_section_version_id !== context.sections.action_plan.section_version_id) return invalidGenerated(value, "ACTION_PLAN_SECTION_VERSION_MISMATCH", "response.action_plan_section_version_id");
  if (response.advisory_only !== true) return invalidGenerated(value, "ADVISORY_ONLY_INVARIANT_FAILED", "response.advisory_only");
  if (response.workflow_mutated !== false) return invalidGenerated(value, "WORKFLOW_MUTATION_INVARIANT_FAILED", "response.workflow_mutated");
  if (response.controlled_record_mutated !== false) return invalidGenerated(value, "CONTROLLED_RECORD_MUTATION_INVARIANT_FAILED", "response.controlled_record_mutated");
  if (response.approval_claimed !== false) return invalidGenerated(value, "APPROVAL_CLAIM_INVARIANT_FAILED", "response.approval_claimed");
  if (response.workflow_transition !== null) return invalidGenerated(value, "WORKFLOW_TRANSITION_INVARIANT_FAILED", "response.workflow_transition");
  if (response.human_acceptance_required !== true) return invalidGenerated(value, "HUMAN_ACCEPTANCE_INVARIANT_FAILED", "response.human_acceptance_required");
  if (!proposal || !Array.isArray(proposal.findings)) return invalidGenerated(value, "FINDING_BINDING_SHAPE_INVALID", "response.proposal.findings");

  for (const [findingIndex, finding] of findings.entries()) {
    const path = `response.proposal.findings[${findingIndex}]`;
    if (!record(finding) || !Array.isArray(finding.affected_action_ids) || !Array.isArray(finding.affected_root_cause_ids) || !Array.isArray(finding.reference_keys)) return invalidGenerated(value, "FINDING_BINDING_SHAPE_INVALID", path);
    for (const [idIndex, id] of finding.affected_action_ids.entries()) if (!actionIds.has(id)) return invalidGenerated(value, "AFFECTED_ACTION_ID_NOT_AUTHORITATIVE", `${path}.affected_action_ids[${idIndex}]`);
    for (const [idIndex, id] of finding.affected_root_cause_ids.entries()) if (!rootIds.has(id)) return invalidGenerated(value, "AFFECTED_ROOT_CAUSE_ID_NOT_AUTHORITATIVE", `${path}.affected_root_cause_ids[${idIndex}]`);
    for (const [keyIndex, key] of finding.reference_keys.entries()) if (!referenceKeys.has(key)) return invalidGenerated(value, "REFERENCE_KEY_NOT_IN_MANIFEST", `${path}.reference_keys[${keyIndex}]`);
  }

  if (pkg?.package_schema_version !== "capa-action-plan-review-advisory-prompt-package-1.0.0") return invalidGenerated(value, "PROMPT_PACKAGE_SCHEMA_MISMATCH", "trace.package.package_schema_version");
  if (scope?.workflow_state !== "S70") return invalidGenerated(value, "WORKFLOW_SCOPE_MISMATCH", "trace.package.scope.workflow_state");
  if (scope?.organization_id !== context.organization_id) return invalidGenerated(value, "ORGANIZATION_BINDING_MISMATCH", "trace.package.scope.organization_id");
  if (scope?.capa_case_id !== context.capa_case_id) return invalidGenerated(value, "CASE_BINDING_MISMATCH", "trace.package.scope.capa_case_id");
  if (scope?.case_version_id !== context.case_version_id) return invalidGenerated(value, "CASE_VERSION_BINDING_MISMATCH", "trace.package.scope.case_version_id");
  if (scope?.record_version !== context.record_version) return invalidGenerated(value, "RECORD_VERSION_BINDING_MISMATCH", "trace.package.scope.record_version");
  if (identity?.run_id !== response.run_id) return invalidGenerated(value, "TRACE_RUN_BINDING_MISMATCH", "trace.package.trace.run_id");
  if (identity?.request_id !== invocation.request_id) return invalidGenerated(value, "TRACE_REQUEST_BINDING_MISMATCH", "trace.package.trace.request_id");
  if (identity?.correlation_id !== invocation.correlation_id) return invalidGenerated(value, "TRACE_CORRELATION_BINDING_MISMATCH", "trace.package.trace.correlation_id");
  if (output?.operation !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION) return invalidGenerated(value, "GENERATION_OPERATION_MISMATCH", "trace.package.generation_contract.operation");
  if (output?.output_schema_version !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION) return invalidGenerated(value, "GENERATION_OUTPUT_SCHEMA_MISMATCH", "trace.package.generation_contract.output_schema_version");
  return { valid: true, value: value as GeneratedAdvisory };
}
export class CapaActionPlanReviewAdvisoryService {
  constructor(private readonly dependencies: CapaActionPlanReviewAdvisoryServiceDependencies) {}
  async execute(invocation: CapaActionPlanReviewAdvisoryInvocation): Promise<{ readonly advisory: CapaActionPlanReviewAdvisoryResponse; readonly snapshot: Readonly<{ capa_case_id: CapaCaseId; case_version_id: CapaCaseVersionId; record_version: number }> }> {
    let resolution: CapaActionPlanReviewAdvisoryContextResolution; try { resolution = await this.dependencies.context_resolver.resolve({ organization_id: invocation.organization_id, capa_case_id: invocation.capa_case_id }); } catch { throw new CapaActionPlanReviewAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED"); }
    if (resolution.status === "not_found_or_not_authorized" || resolution.status === "invalid_authoritative_context") throw new CapaActionPlanReviewAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED"); if (resolution.status === "wrong_workflow_state") throw new CapaActionPlanReviewAdvisoryServiceError("CASE_NOT_IN_ACTION_PLAN_REVIEW"); const context = resolution.assembly.authoritative; if (!validContext(context, invocation)) throw new CapaActionPlanReviewAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    let authorized = false; try { authorized = await this.dependencies.authorizer.authorize({ context, operation: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION }); } catch { authorized = false; } if (!authorized) throw new CapaActionPlanReviewAdvisoryServiceError("ADVISORY_ACCESS_DENIED");
    let eligible = false; try { eligible = this.dependencies.agent_gate.evaluate({ context, agent: CAPA_ACTION_PLAN_REVIEW_ADVISORY_AGENT, operation: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION }); } catch { eligible = false; } if (!eligible) throw new CapaActionPlanReviewAdvisoryServiceError("AGENT_NOT_ELIGIBLE");
    let generated: Awaited<ReturnType<CapaActionPlanReviewAdvisoryGenerator["generate"]>>; try { generated = await this.dependencies.generator.generate({ context: resolution.assembly, request_id: invocation.request_id, correlation_id: invocation.correlation_id }); } catch (error) { throw new CapaActionPlanReviewAdvisoryServiceError("ADVISORY_GENERATION_FAILED", error instanceof Error ? error.name : "UnknownError"); }
    const generatedValidation = validateGenerated(generated, context, invocation, resolution.assembly);
    if (!generatedValidation.valid) throw new CapaActionPlanReviewAdvisoryServiceError("INVALID_ADVISORY_RESULT", undefined, generatedValidation.diagnostic);
    let unchanged = false; try { unchanged = await this.dependencies.context_resolver.assertCaseUnchanged(context); } catch { unchanged = false; } if (!unchanged) throw new CapaActionPlanReviewAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    try { const saved = await this.dependencies.transaction_manager.runInTransaction({ request_id: invocation.request_id, correlation_id: invocation.correlation_id }, (transaction) => this.dependencies.output_repository.save(transaction, { context, response: generated.response, generation_trace: generated.trace, reference_manifest: resolution.assembly.reference_manifest, request_id: invocation.request_id, correlation_id: invocation.correlation_id })); if (saved === "case_changed") throw new CapaActionPlanReviewAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED"); } catch (error) { if (error instanceof CapaActionPlanReviewAdvisoryServiceError) throw error; throw new CapaActionPlanReviewAdvisoryServiceError("ADVISORY_PERSISTENCE_FAILED", error instanceof Error ? error.name : "UnknownError"); }
    return { advisory: generated.response, snapshot: { capa_case_id: context.capa_case_id, case_version_id: context.case_version_id, record_version: context.record_version } };
  }
}
