import type { CapaCaseId, CapaCaseVersionId, CorrelationId, OrganizationId, RequestId, UserId } from "../domain/capa-types";
import type { TransactionManager } from "../../database/transactions";
import type { CapaImplementationEvidenceAdvisoryContextAssembly, AuthoritativeS80ImplementationEvidenceContext, CapaImplementationEvidenceAdvisoryContextResolution } from "./capa-implementation-evidence-advisory-context";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION, type CapaImplementationEvidenceAdvisoryAgentGate } from "./capa-implementation-evidence-advisory-agent-gate";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, type CapaImplementationEvidenceAdvisoryResponse } from "./capa-implementation-evidence-advisory-contract";
import { CapaImplementationEvidenceAdvisoryOutputValidationError } from "./capa-implementation-evidence-advisory-validator";
import { validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings } from "./capa-implementation-evidence-advisory-authoritative-validator";
import type { CapaImplementationEvidenceAdvisoryGenerationTraceCapture } from "./capa-implementation-evidence-advisory-model-generator";
import type { CapaImplementationEvidenceAdvisoryOutputRepository } from "../../database/repositories/capa-implementation-evidence-advisory-output-repository";

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SERVICE_REASON_CODES = ["CASE_NOT_FOUND_OR_NOT_AUTHORIZED", "CASE_NOT_IN_IMPLEMENTATION", "WORKSPACE_NOT_FOUND", "APPROVED_S70_BASELINE_UNAVAILABLE", "GOVERNED_KNOWLEDGE_UNAVAILABLE", "ADVISORY_ACCESS_DENIED", "AGENT_NOT_ELIGIBLE", "ADVISORY_GENERATION_FAILED", "OUTPUT_SCHEMA_MISMATCH", "INVALID_ACTION_REFERENCE", "INVALID_EVIDENCE_REFERENCE", "INVALID_CITATION", "CONTEXT_RESOLUTION_FAILED", "ADVISORY_PERSISTENCE_FAILED", "WORKFLOW_MUTATION_DETECTED"] as const;
export type CapaImplementationEvidenceAdvisoryServiceReasonCode = typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SERVICE_REASON_CODES[number];

export class CapaImplementationEvidenceAdvisoryServiceError extends Error {
  constructor(readonly reason_code: CapaImplementationEvidenceAdvisoryServiceReasonCode, readonly diagnostic_cause_name?: string) { super("The governed S80 implementation-evidence advisory operation failed."); this.name = "CapaImplementationEvidenceAdvisoryServiceError"; }
}

export interface CapaImplementationEvidenceAdvisoryInvocation { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly user_id: UserId; readonly request_id: RequestId; readonly correlation_id: CorrelationId; readonly request: { readonly expected_case_version_id: CapaCaseVersionId; readonly expected_record_version: number } }
export interface CapaImplementationEvidenceAdvisoryContextResolver { resolve(input: { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly user_id: UserId; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<CapaImplementationEvidenceAdvisoryContextResolution>; assertCaseUnchanged(context: AuthoritativeS80ImplementationEvidenceContext): Promise<boolean>; }
export interface CapaImplementationEvidenceAdvisoryAuthorizer { authorize(input: { readonly context: AuthoritativeS80ImplementationEvidenceContext; readonly operation: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION }): Promise<boolean>; }
export interface CapaImplementationEvidenceAdvisoryGenerator { generate(input: { readonly context: CapaImplementationEvidenceAdvisoryContextAssembly; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<{ readonly response: CapaImplementationEvidenceAdvisoryResponse; readonly trace: CapaImplementationEvidenceAdvisoryGenerationTraceCapture }>; }
export interface CapaImplementationEvidenceAdvisoryServiceDependencies { readonly context_resolver: CapaImplementationEvidenceAdvisoryContextResolver; readonly authorizer: CapaImplementationEvidenceAdvisoryAuthorizer; readonly agent_gate: CapaImplementationEvidenceAdvisoryAgentGate; readonly generator: CapaImplementationEvidenceAdvisoryGenerator; readonly output_repository: CapaImplementationEvidenceAdvisoryOutputRepository; readonly transaction_manager: TransactionManager; }

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validContext(context: AuthoritativeS80ImplementationEvidenceContext, invocation: CapaImplementationEvidenceAdvisoryInvocation): boolean { return context.trust === "authoritative_server_context" && context.organization_id === invocation.organization_id && context.capa_case_id === invocation.capa_case_id && context.actor === invocation.user_id && context.workflow_state === "S80" && context.case_version_id === invocation.request.expected_case_version_id && context.record_version === invocation.request.expected_record_version; }

function validTrace(trace: CapaImplementationEvidenceAdvisoryGenerationTraceCapture, context: AuthoritativeS80ImplementationEvidenceContext, invocation: CapaImplementationEvidenceAdvisoryInvocation, response: CapaImplementationEvidenceAdvisoryResponse): boolean {
  const pkg = record(trace.package) ? trace.package : null;
  const scope = pkg && record(pkg.scope) ? pkg.scope : null;
  const identity = pkg && record(pkg.trace) ? pkg.trace : null;
  const generation = pkg && record(pkg.generation_contract) ? pkg.generation_contract : null;
  const agent = pkg && record(pkg.agent) ? pkg.agent : null;
  return trace.trace_schema_version === "capa-ai-generation-trace-1.0.0" && trace.store === false && pkg?.package_schema_version === "capa-implementation-evidence-advisory-prompt-package-1.0.0" && scope?.organization_id === context.organization_id && scope?.capa_case_id === context.capa_case_id && scope?.case_version_id === context.case_version_id && scope?.record_version === context.record_version && scope?.workflow_state === "S80" && agent?.agent_id === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id && agent.agent_version === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version && identity?.run_id === response.run_id && identity?.request_id === invocation.request_id && identity?.correlation_id === invocation.correlation_id && generation?.operation === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION && generation?.output_schema_version === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION;
}

function validResponse(response: CapaImplementationEvidenceAdvisoryResponse): boolean { return response.status === "completed_draft" && response.output_schema_version === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION && response.advisory_only === true && response.workflow_mutated === false && response.controlled_record_mutated === false && response.approval_claimed === false && response.workflow_transition === null && response.human_acceptance_required === true; }

export class CapaImplementationEvidenceAdvisoryService {
  constructor(private readonly dependencies: CapaImplementationEvidenceAdvisoryServiceDependencies) {}

  async execute(invocation: CapaImplementationEvidenceAdvisoryInvocation): Promise<{ readonly advisory: CapaImplementationEvidenceAdvisoryResponse; readonly snapshot: Readonly<{ capa_case_id: CapaCaseId; case_version_id: CapaCaseVersionId; record_version: number }> }> {
    let resolution: CapaImplementationEvidenceAdvisoryContextResolution;
    try { resolution = await this.dependencies.context_resolver.resolve({ organization_id: invocation.organization_id, capa_case_id: invocation.capa_case_id, user_id: invocation.user_id, request_id: invocation.request_id, correlation_id: invocation.correlation_id }); } catch (error) { throw new CapaImplementationEvidenceAdvisoryServiceError("CONTEXT_RESOLUTION_FAILED", error instanceof Error ? error.name : "UnknownError"); }
    if (resolution.status === "not_found_or_not_authorized") throw new CapaImplementationEvidenceAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    if (resolution.status === "wrong_workflow_state") throw new CapaImplementationEvidenceAdvisoryServiceError("CASE_NOT_IN_IMPLEMENTATION");
    if (resolution.status === "workspace_not_found") throw new CapaImplementationEvidenceAdvisoryServiceError("WORKSPACE_NOT_FOUND");
    if (resolution.status === "baseline_unavailable") throw new CapaImplementationEvidenceAdvisoryServiceError("APPROVED_S70_BASELINE_UNAVAILABLE");
    if (resolution.status === "knowledge_unavailable") throw new CapaImplementationEvidenceAdvisoryServiceError("GOVERNED_KNOWLEDGE_UNAVAILABLE");
    if (resolution.status !== "resolved" || !validContext(resolution.assembly.authoritative, invocation)) throw new CapaImplementationEvidenceAdvisoryServiceError("CONTEXT_RESOLUTION_FAILED");
    const context = resolution.assembly.authoritative;
    let authorized = false;
    try { authorized = await this.dependencies.authorizer.authorize({ context, operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION }); } catch { authorized = false; }
    if (!authorized) throw new CapaImplementationEvidenceAdvisoryServiceError("ADVISORY_ACCESS_DENIED");
    let eligible = false;
    try { eligible = this.dependencies.agent_gate.evaluate({ context, agent: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT, operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION }); } catch { eligible = false; }
    if (!eligible) throw new CapaImplementationEvidenceAdvisoryServiceError("AGENT_NOT_ELIGIBLE");
    let generated: Awaited<ReturnType<CapaImplementationEvidenceAdvisoryGenerator["generate"]>>;
    try { generated = await this.dependencies.generator.generate({ context: resolution.assembly, request_id: invocation.request_id, correlation_id: invocation.correlation_id }); } catch (error) { if (error instanceof CapaImplementationEvidenceAdvisoryOutputValidationError) throw new CapaImplementationEvidenceAdvisoryServiceError("OUTPUT_SCHEMA_MISMATCH", error.name); throw new CapaImplementationEvidenceAdvisoryServiceError("ADVISORY_GENERATION_FAILED", error instanceof Error ? error.name : "UnknownError"); }
    if (!validResponse(generated.response) || !validTrace(generated.trace, context, invocation, generated.response)) throw new CapaImplementationEvidenceAdvisoryServiceError("OUTPUT_SCHEMA_MISMATCH");
    if (!validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(generated.response, context, resolution.assembly.reference_manifest)) {
      const response = generated.response;
      const actionIds = new Set(context.approved_actions.map((action) => action.approved_action_reference));
      const evidenceIds = new Set((context.workspace?.action_progress ?? []).flatMap((progress) => progress.evidence.map((evidence) => evidence.evidence_id)));
      if (response.findings.some((finding) => !actionIds.has(finding.approved_action_reference))) throw new CapaImplementationEvidenceAdvisoryServiceError("INVALID_ACTION_REFERENCE");
      if (response.findings.some((finding) => finding.evidence_reference_ids.some((evidenceId) => !evidenceIds.has(evidenceId)))) throw new CapaImplementationEvidenceAdvisoryServiceError("INVALID_EVIDENCE_REFERENCE");
      throw new CapaImplementationEvidenceAdvisoryServiceError("INVALID_CITATION");
    }
    const allowedCitations = new Map(resolution.assembly.reference_manifest.map((entry) => [entry.reference_key, entry]));
    if (generated.response.citations.some((citation) => { const entry = allowedCitations.get(citation.reference_key); return entry === undefined || entry.source_kind !== citation.source_kind || entry.source_reference !== citation.source_reference || entry.source_status !== citation.source_status || entry.locator !== citation.locator; })) throw new CapaImplementationEvidenceAdvisoryServiceError("INVALID_CITATION");
    let unchanged = false;
    try { unchanged = await this.dependencies.context_resolver.assertCaseUnchanged(context); } catch { unchanged = false; }
    if (!unchanged) throw new CapaImplementationEvidenceAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    try { const saved = await this.dependencies.transaction_manager.runInTransaction({ request_id: invocation.request_id, correlation_id: invocation.correlation_id }, (transaction) => this.dependencies.output_repository.save(transaction, { context, response: generated.response, generation_trace: generated.trace, reference_manifest: resolution.assembly.reference_manifest, request_id: invocation.request_id, correlation_id: invocation.correlation_id })); if (saved === "case_changed") throw new CapaImplementationEvidenceAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED"); } catch (error) { if (error instanceof CapaImplementationEvidenceAdvisoryServiceError) throw error; throw new CapaImplementationEvidenceAdvisoryServiceError("ADVISORY_PERSISTENCE_FAILED", error instanceof Error ? error.name : "UnknownError"); }
    return { advisory: generated.response, snapshot: { capa_case_id: context.capa_case_id, case_version_id: context.case_version_id, record_version: context.record_version } };
  }
}
