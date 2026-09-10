import type { CapaCaseId, CapaCaseVersionId, CorrelationId, OrganizationId, RequestId, UserId } from "../domain/capa-types";
import type { TransactionManager } from "../../database/transactions";
import type { CapaActionPlanAdvisoryContextAssembly, AuthoritativeS60ActionPlanContext, CapaActionPlanAdvisoryContextResolution } from "./capa-action-plan-advisory-context";
import { CAPA_ACTION_PLAN_ADVISORY_AGENT, type CapaActionPlanAdvisoryAgentGate } from "./capa-action-plan-advisory-agent-gate";
import { CAPA_ACTION_PLAN_ADVISORY_OPERATION } from "./capa-action-plan-advisory-model-generator";
import { CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION, type CapaActionPlanAdvisoryResponse } from "./capa-action-plan-advisory-contract";
import type { CapaActionPlanAdvisoryGenerationTraceCapture } from "./capa-ai-generation-trace";
import { CAPA_ACTION_TYPES } from "../domain/capa-action-plan";
import { CapaActionPlanAdvisoryOutputValidationError, type CapaActionPlanAdvisoryValidationLocation } from "./capa-action-plan-advisory-validator";
import type { CapaActionPlanAdvisoryOutputRepository } from "../../database/repositories/capa-action-plan-advisory-output-repository";

export const CAPA_ACTION_PLAN_ADVISORY_SERVICE_REASON_CODES = ["CASE_NOT_FOUND_OR_NOT_AUTHORIZED", "CASE_NOT_IN_ACTION_PLANNING", "ADVISORY_ACCESS_DENIED", "AGENT_NOT_ELIGIBLE", "ADVISORY_GENERATION_FAILED", "INVALID_ADVISORY_RESULT", "ADVISORY_PERSISTENCE_FAILED", "WORKFLOW_MUTATION_DETECTED"] as const;
export type CapaActionPlanAdvisoryServiceReasonCode = typeof CAPA_ACTION_PLAN_ADVISORY_SERVICE_REASON_CODES[number];
export const CAPA_ACTION_PLAN_ADVISORY_VALIDATION_REASON_CODES = [
  "RESPONSE_OR_TRACE_MISSING",
  "INVALID_ADVISORY_SHAPE",
  "INVALID_ACTION_CANDIDATE",
  "INVALID_ACTION_TYPE",
  "INVALID_TARGET_BINDING",
  "INVALID_EFFECTIVENESS_CANDIDATE",
  "INVALID_PROVENANCE",
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
export type CapaActionPlanAdvisoryValidationReasonCode = typeof CAPA_ACTION_PLAN_ADVISORY_VALIDATION_REASON_CODES[number];
export interface CapaActionPlanAdvisoryValidationDiagnostic {
  readonly reason_code: CapaActionPlanAdvisoryValidationReasonCode;
  readonly path: string;
  readonly action_candidate_count: number;
  readonly finding_count: number;
  readonly affected_action_id_count: number;
  readonly affected_root_cause_id_count: number;
  readonly reference_key_count: number;
  readonly expected_workflow_state: "S60";
}
export class CapaActionPlanAdvisoryServiceError extends Error {
  readonly diagnostic_reason_code: CapaActionPlanAdvisoryValidationReasonCode | null;
  readonly diagnostic_path: string | null;
  readonly diagnostic_action_candidate_count: number | null;
  readonly diagnostic_finding_count: number | null;
  readonly diagnostic_affected_action_id_count: number | null;
  readonly diagnostic_affected_root_cause_id_count: number | null;
  readonly diagnostic_reference_key_count: number | null;
  readonly diagnostic_expected_workflow_state: "S60" | null;

  constructor(readonly reason_code: CapaActionPlanAdvisoryServiceReasonCode, readonly diagnostic_cause_name?: string, diagnostic?: CapaActionPlanAdvisoryValidationDiagnostic) {
    super("The governed S60 action-plan advisory operation failed.");
    this.name = "CapaActionPlanAdvisoryServiceError";
    this.diagnostic_reason_code = diagnostic?.reason_code ?? null;
    this.diagnostic_path = diagnostic?.path ?? null;
    this.diagnostic_action_candidate_count = diagnostic?.action_candidate_count ?? null;
    this.diagnostic_finding_count = diagnostic?.finding_count ?? null;
    this.diagnostic_affected_action_id_count = diagnostic?.affected_action_id_count ?? null;
    this.diagnostic_affected_root_cause_id_count = diagnostic?.affected_root_cause_id_count ?? null;
    this.diagnostic_reference_key_count = diagnostic?.reference_key_count ?? null;
    this.diagnostic_expected_workflow_state = diagnostic?.expected_workflow_state ?? null;
  }
}
export interface CapaActionPlanAdvisoryInvocation { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly user_id: UserId; readonly request_id: RequestId; readonly correlation_id: CorrelationId; readonly request: { readonly expected_case_version_id: CapaCaseVersionId; readonly expected_record_version: number } }
export interface CapaActionPlanAdvisoryContextResolver { resolve(input: { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId }): Promise<CapaActionPlanAdvisoryContextResolution>; assertCaseUnchanged(context: AuthoritativeS60ActionPlanContext): Promise<boolean>; }
export interface CapaActionPlanAdvisoryAuthorizer { authorize(input: { readonly context: AuthoritativeS60ActionPlanContext; readonly operation: typeof CAPA_ACTION_PLAN_ADVISORY_OPERATION }): Promise<boolean>; }
export interface CapaActionPlanAdvisoryGenerator { generate(input: { readonly context: CapaActionPlanAdvisoryContextAssembly; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<{ readonly response: CapaActionPlanAdvisoryResponse; readonly trace: CapaActionPlanAdvisoryGenerationTraceCapture }>; }
export interface CapaActionPlanAdvisoryServiceDependencies { readonly context_resolver: CapaActionPlanAdvisoryContextResolver; readonly authorizer: CapaActionPlanAdvisoryAuthorizer; readonly agent_gate: CapaActionPlanAdvisoryAgentGate; readonly generator: CapaActionPlanAdvisoryGenerator; readonly output_repository: CapaActionPlanAdvisoryOutputRepository; readonly transaction_manager: TransactionManager; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validContext(value: unknown, invocation: CapaActionPlanAdvisoryInvocation): value is AuthoritativeS60ActionPlanContext { return record(value) && value.trust === "authoritative_server_context" && value.organization_id === invocation.organization_id && value.capa_case_id === invocation.capa_case_id && value.actor === invocation.user_id && value.workflow_state === "S60" && value.case_version_id === invocation.request.expected_case_version_id && value.record_version === invocation.request.expected_record_version && Array.isArray(value.active_roles); }
function validGenerated(value: unknown, context: AuthoritativeS60ActionPlanContext, invocation: CapaActionPlanAdvisoryInvocation): value is { response: CapaActionPlanAdvisoryResponse; trace: CapaActionPlanAdvisoryGenerationTraceCapture } { if (!record(value) || !record(value.response) || !record(value.trace)) return false; const response = value.response; const trace = value.trace; const pkg = record(trace.package) ? trace.package : null; const scope = pkg && record(pkg.scope) ? pkg.scope : null; const identity = pkg && record(pkg.trace) ? pkg.trace : null; return response.status === "completed_draft" && response.output_schema_version === CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION && response.advisory_only === true && response.workflow_mutated === false && response.controlled_record_mutated === false && response.approval_claimed === false && response.workflow_transition === null && response.human_acceptance_required === true && trace.trace_schema_version === "capa-ai-generation-trace-1.0.0" && pkg?.package_schema_version === "capa-action-plan-advisory-prompt-package-1.0.0" && scope?.organization_id === context.organization_id && scope?.capa_case_id === context.capa_case_id && scope?.case_version_id === context.case_version_id && scope?.record_version === context.record_version && scope?.workflow_state === "S60" && identity?.run_id === response.run_id && identity?.request_id === invocation.request_id && identity?.correlation_id === invocation.correlation_id; }

type GeneratedAdvisory = { readonly response: CapaActionPlanAdvisoryResponse; readonly trace: CapaActionPlanAdvisoryGenerationTraceCapture };
type GeneratedValidationResult =
  | { readonly valid: true; readonly value: GeneratedAdvisory }
  | { readonly valid: false; readonly diagnostic: CapaActionPlanAdvisoryValidationDiagnostic };

function generatedCounts(value: unknown): Omit<CapaActionPlanAdvisoryValidationDiagnostic, "reason_code" | "path" | "expected_workflow_state"> {
  const response = record(value) && record(value.response) ? value.response : null;
  const proposal = response && record(response.proposal) ? response.proposal : null;
  const candidates = proposal && Array.isArray(proposal.action_candidates) ? proposal.action_candidates : [];
  const improvements = proposal && Array.isArray(proposal.action_improvements) ? proposal.action_improvements : [];
  const effectiveness = proposal && Array.isArray(proposal.effectiveness_planning_improvements) ? proposal.effectiveness_planning_improvements : [];
  let reference_key_count = 0;
  let affected_action_id_count = 0;
  for (const item of [...improvements, ...effectiveness, ...candidates]) {
    if (!record(item)) continue;
    if (typeof item.action_item_id === "string") affected_action_id_count += 1;
    if (Array.isArray(item.reference_keys)) reference_key_count += item.reference_keys.length;
  }
  if (proposal && Array.isArray(proposal.completeness_linkage_concerns)) for (const item of proposal.completeness_linkage_concerns) if (record(item) && Array.isArray(item.reference_keys)) reference_key_count += item.reference_keys.length;
  return { action_candidate_count: candidates.length, finding_count: 0, affected_action_id_count, affected_root_cause_id_count: 0, reference_key_count };
}

function invalidGenerated(value: unknown, reason_code: CapaActionPlanAdvisoryValidationReasonCode, path: string): GeneratedValidationResult {
  return { valid: false, diagnostic: { reason_code, path, ...generatedCounts(value), expected_workflow_state: "S60" } };
}

function validationDiagnostic(error: CapaActionPlanAdvisoryOutputValidationError): CapaActionPlanAdvisoryValidationDiagnostic {
  const reason_code: CapaActionPlanAdvisoryValidationReasonCode = error.reason_code === "INVALID_ACTION_TYPE"
    ? "INVALID_ACTION_TYPE"
    : error.reason_code === "INVALID_TARGET_BINDING"
      ? "INVALID_TARGET_BINDING"
      : error.reason_code === "INVALID_EFFECTIVENESS_CANDIDATE"
        ? "INVALID_EFFECTIVENESS_CANDIDATE"
        : error.reason_code === "INVALID_REFERENCE"
    ? "REFERENCE_KEY_NOT_IN_MANIFEST"
    : error.reason_code === "INVALID_PROVENANCE"
      ? "INVALID_PROVENANCE"
      : error.reason_code === "INVALID_ACTION_CANDIDATE" || error.diagnostic_location === "action_candidate"
        ? "INVALID_ACTION_CANDIDATE"
        : error.diagnostic_location === "effectiveness_suggestion"
          ? "INVALID_EFFECTIVENESS_CANDIDATE"
          : "INVALID_ADVISORY_SHAPE";
  return { reason_code, path: `model_output.proposal.${error.diagnostic_location}`, action_candidate_count: 0, finding_count: 0, affected_action_id_count: 0, affected_root_cause_id_count: 0, reference_key_count: 0, expected_workflow_state: "S60" };
}

function authoritativeDiagnostic(response: CapaActionPlanAdvisoryResponse, context: AuthoritativeS60ActionPlanContext, referenceManifest: CapaActionPlanAdvisoryContextAssembly["reference_manifest"]): CapaActionPlanAdvisoryValidationDiagnostic | null {
  const allowedReferenceKeys = new Set(referenceManifest.map((entry) => entry.reference_key));
  const allowedActionIds = new Set(context.workspace?.action_plan.items.map((item) => item.item_id) ?? []);
  const rootHypotheses = new Map(context.sections.root_cause_package.content.hypotheses.map((item) => [item.hypothesis_id, item]));
  const missingInformationItems = new Set(context.sections.investigation_ledger.content.items.filter((item) => item.information_class === "missing_information").map((item) => item.item_id));
  const references = [
    ...response.proposal.completeness_linkage_concerns.flatMap((item) => item.reference_keys),
    ...response.proposal.action_improvements.flatMap((item) => item.reference_keys),
    ...response.proposal.action_candidates.flatMap((item) => item.reference_keys),
    ...response.proposal.effectiveness_planning_improvements.flatMap((item) => item.reference_keys),
  ];
  const base = generatedCounts({ response });
  const diagnostic = (reason_code: CapaActionPlanAdvisoryValidationReasonCode, path: string): CapaActionPlanAdvisoryValidationDiagnostic => ({ reason_code, path, ...base, reference_key_count: references.length, expected_workflow_state: "S60" });
  const referenceIndex = references.findIndex((key) => !allowedReferenceKeys.has(key));
  if (referenceIndex >= 0) return diagnostic("REFERENCE_KEY_NOT_IN_MANIFEST", "response.proposal.reference_keys");
  for (const [index, item] of [...response.proposal.action_improvements, ...response.proposal.effectiveness_planning_improvements].entries()) {
    if (item.action_item_id !== null && !allowedActionIds.has(item.action_item_id)) return diagnostic("INVALID_ACTION_CANDIDATE", `response.proposal.action_item_id[${index}]`);
  }
  for (const [index, candidate] of response.proposal.action_candidates.entries()) {
    if (!(CAPA_ACTION_TYPES as readonly string[]).includes(candidate.action_type)) return diagnostic("INVALID_ACTION_TYPE", `response.proposal.action_candidates[${index}].action_type`);
    if (!Array.isArray(candidate.linked_targets) || candidate.linked_targets.length === 0) return diagnostic("INVALID_TARGET_BINDING", `response.proposal.action_candidates[${index}].linked_targets`);
    for (const [targetIndex, target] of candidate.linked_targets.entries()) {
      const targetPath = `response.proposal.action_candidates[${index}].linked_targets[${targetIndex}]`;
      if (target.target_type === "cause" && rootHypotheses.get(target.target_id)?.causal_role !== "proposed_root_cause") return diagnostic("INVALID_TARGET_BINDING", `${targetPath}.target_id`);
      if (target.target_type === "contributing_factor" && rootHypotheses.get(target.target_id)?.causal_role !== "contributing_factor") return diagnostic("INVALID_TARGET_BINDING", `${targetPath}.target_id`);
      if (target.target_type === "gap" && !missingInformationItems.has(target.target_id)) return diagnostic("INVALID_TARGET_BINDING", `${targetPath}.target_id`);
    }
    if (candidate.effectiveness_planning !== null && (!record(candidate.effectiveness_planning) || Object.values(candidate.effectiveness_planning).some((value) => typeof value !== "string" || value.trim() === ""))) return diagnostic("INVALID_EFFECTIVENESS_CANDIDATE", `response.proposal.action_candidates[${index}].effectiveness_planning`);
  }
  return null;
}

function validateGenerated(value: unknown, context: AuthoritativeS60ActionPlanContext, invocation: CapaActionPlanAdvisoryInvocation, assembly: CapaActionPlanAdvisoryContextAssembly): GeneratedValidationResult {
  if (!record(value) || !record(value.response)) return invalidGenerated(value, "RESPONSE_OR_TRACE_MISSING", "generated.response");
  if (!record(value.trace)) return invalidGenerated(value, "RESPONSE_OR_TRACE_MISSING", "generated.trace");
  const response = value.response;
  const trace = value.trace;
  const pkg = record(trace.package) ? trace.package : null;
  const scope = pkg && record(pkg.scope) ? pkg.scope : null;
  const identity = pkg && record(pkg.trace) ? pkg.trace : null;
  const generation = pkg && record(pkg.generation_contract) ? pkg.generation_contract : null;
  if (response.status !== "completed_draft") return invalidGenerated(value, "INVALID_ADVISORY_SHAPE", "response.status");
  if (response.output_schema_version !== CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION) return invalidGenerated(value, "GENERATION_OUTPUT_SCHEMA_MISMATCH", "response.output_schema_version");
  if (response.advisory_only !== true || response.workflow_mutated !== false || response.controlled_record_mutated !== false || response.approval_claimed !== false || response.workflow_transition !== null || response.human_acceptance_required !== true) return invalidGenerated(value, "INVALID_ADVISORY_SHAPE", "response.governance");
  if (pkg?.package_schema_version !== "capa-action-plan-advisory-prompt-package-1.0.0") return invalidGenerated(value, "PROMPT_PACKAGE_SCHEMA_MISMATCH", "trace.package.package_schema_version");
  if (scope?.workflow_state !== "S60") return invalidGenerated(value, "WORKFLOW_SCOPE_MISMATCH", "trace.package.scope.workflow_state");
  if (scope?.organization_id !== context.organization_id) return invalidGenerated(value, "ORGANIZATION_BINDING_MISMATCH", "trace.package.scope.organization_id");
  if (scope?.capa_case_id !== context.capa_case_id) return invalidGenerated(value, "CASE_BINDING_MISMATCH", "trace.package.scope.capa_case_id");
  if (scope?.case_version_id !== context.case_version_id) return invalidGenerated(value, "CASE_VERSION_BINDING_MISMATCH", "trace.package.scope.case_version_id");
  if (scope?.record_version !== context.record_version) return invalidGenerated(value, "RECORD_VERSION_BINDING_MISMATCH", "trace.package.scope.record_version");
  if (identity?.run_id !== response.run_id) return invalidGenerated(value, "TRACE_RUN_BINDING_MISMATCH", "trace.package.trace.run_id");
  if (identity?.request_id !== invocation.request_id) return invalidGenerated(value, "TRACE_REQUEST_BINDING_MISMATCH", "trace.package.trace.request_id");
  if (identity?.correlation_id !== invocation.correlation_id) return invalidGenerated(value, "TRACE_CORRELATION_BINDING_MISMATCH", "trace.package.trace.correlation_id");
  if (generation?.operation !== CAPA_ACTION_PLAN_ADVISORY_OPERATION) return invalidGenerated(value, "GENERATION_OPERATION_MISMATCH", "trace.package.generation_contract.operation");
  if (generation?.output_schema_version !== CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION) return invalidGenerated(value, "GENERATION_OUTPUT_SCHEMA_MISMATCH", "trace.package.generation_contract.output_schema_version");
  if (!record(response.proposal) || !Array.isArray(response.proposal.completeness_linkage_concerns) || !Array.isArray(response.proposal.action_improvements) || !Array.isArray(response.proposal.action_candidates) || !Array.isArray(response.proposal.effectiveness_planning_improvements)) return invalidGenerated(value, "INVALID_ADVISORY_SHAPE", "response.proposal");
  const authoritative = authoritativeDiagnostic(response as unknown as CapaActionPlanAdvisoryResponse, context, assembly.reference_manifest);
  return authoritative === null ? { valid: true, value: value as GeneratedAdvisory } : { valid: false, diagnostic: authoritative };
}

export function validateCapaActionPlanAdvisoryAuthoritativeBindings(
  response: CapaActionPlanAdvisoryResponse,
  context: AuthoritativeS60ActionPlanContext,
  referenceManifest: CapaActionPlanAdvisoryContextAssembly["reference_manifest"],
): boolean {
  const allowedReferenceKeys = new Set(referenceManifest.map((entry) => entry.reference_key));
  const allowedActionIds = new Set(context.workspace?.action_plan.items.map((item) => item.item_id) ?? []);
  const rootHypotheses = new Map(context.sections.root_cause_package.content.hypotheses.map((item) => [item.hypothesis_id, item]));
  const missingInformationItems = new Set(context.sections.investigation_ledger.content.items.filter((item) => item.information_class === "missing_information").map((item) => item.item_id));
  const usedReferences = [
    ...response.proposal.completeness_linkage_concerns.flatMap((item) => item.reference_keys),
    ...response.proposal.action_improvements.flatMap((item) => item.reference_keys),
    ...response.proposal.action_candidates.flatMap((item) => item.reference_keys),
    ...response.proposal.effectiveness_planning_improvements.flatMap((item) => item.reference_keys),
  ];
  if (usedReferences.some((key) => !allowedReferenceKeys.has(key))) return false;
  if ([...response.proposal.action_improvements, ...response.proposal.effectiveness_planning_improvements].some((item) => item.action_item_id !== null && !allowedActionIds.has(item.action_item_id))) return false;
  return response.proposal.action_candidates.every((candidate) => candidate.linked_targets.every((target) => {
    if (target.target_type === "cause") return rootHypotheses.get(target.target_id)?.causal_role === "proposed_root_cause";
    if (target.target_type === "contributing_factor") return rootHypotheses.get(target.target_id)?.causal_role === "contributing_factor";
    return missingInformationItems.has(target.target_id);
  }));
}

export class CapaActionPlanAdvisoryService {
  constructor(private readonly dependencies: CapaActionPlanAdvisoryServiceDependencies) {}
  async execute(invocation: CapaActionPlanAdvisoryInvocation): Promise<{ readonly advisory: CapaActionPlanAdvisoryResponse; readonly snapshot: Readonly<{ capa_case_id: CapaCaseId; case_version_id: CapaCaseVersionId; record_version: number }> }> {
    let resolution: CapaActionPlanAdvisoryContextResolution; try { resolution = await this.dependencies.context_resolver.resolve({ organization_id: invocation.organization_id, capa_case_id: invocation.capa_case_id }); } catch { throw new CapaActionPlanAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED"); }
    if (resolution.status === "not_found_or_not_authorized" || resolution.status === "invalid_authoritative_context") throw new CapaActionPlanAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    if (resolution.status === "wrong_workflow_state") throw new CapaActionPlanAdvisoryServiceError("CASE_NOT_IN_ACTION_PLANNING");
    const context = resolution.assembly.authoritative; if (!validContext(context, invocation)) throw new CapaActionPlanAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    let authorized = false; try { authorized = await this.dependencies.authorizer.authorize({ context, operation: CAPA_ACTION_PLAN_ADVISORY_OPERATION }); } catch { authorized = false; } if (!authorized) throw new CapaActionPlanAdvisoryServiceError("ADVISORY_ACCESS_DENIED");
    let eligible = false; try { eligible = this.dependencies.agent_gate.evaluate({ context, agent: CAPA_ACTION_PLAN_ADVISORY_AGENT, operation: CAPA_ACTION_PLAN_ADVISORY_OPERATION }); } catch { eligible = false; } if (!eligible) throw new CapaActionPlanAdvisoryServiceError("AGENT_NOT_ELIGIBLE");
    let generated: Awaited<ReturnType<CapaActionPlanAdvisoryGenerator["generate"]>>; try { generated = await this.dependencies.generator.generate({ context: resolution.assembly, request_id: invocation.request_id, correlation_id: invocation.correlation_id }); } catch (error) { if (error instanceof CapaActionPlanAdvisoryOutputValidationError) throw new CapaActionPlanAdvisoryServiceError("INVALID_ADVISORY_RESULT", error.name, validationDiagnostic(error)); throw new CapaActionPlanAdvisoryServiceError("ADVISORY_GENERATION_FAILED", error instanceof Error ? error.name : "UnknownError"); }
    const generatedValidation = validateGenerated(generated, context, invocation, resolution.assembly);
    if (!generatedValidation.valid) throw new CapaActionPlanAdvisoryServiceError("INVALID_ADVISORY_RESULT", undefined, generatedValidation.diagnostic);
    let unchanged = false; try { unchanged = await this.dependencies.context_resolver.assertCaseUnchanged(context); } catch { unchanged = false; } if (!unchanged) throw new CapaActionPlanAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    try { const saved = await this.dependencies.transaction_manager.runInTransaction({ request_id: invocation.request_id, correlation_id: invocation.correlation_id }, (transaction) => this.dependencies.output_repository.save(transaction, { context, response: generated.response, generation_trace: generated.trace, reference_manifest: resolution.assembly.reference_manifest, request_id: invocation.request_id, correlation_id: invocation.correlation_id })); if (saved === "case_changed") throw new CapaActionPlanAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED"); } catch (error) { if (error instanceof CapaActionPlanAdvisoryServiceError) throw error; throw new CapaActionPlanAdvisoryServiceError("ADVISORY_PERSISTENCE_FAILED", error instanceof Error ? error.name : "UnknownError"); }
    return { advisory: generated.response, snapshot: { capa_case_id: context.capa_case_id, case_version_id: context.case_version_id, record_version: context.record_version } };
  }
}
