import type { CapaCaseId, CapaCaseVersionId, CorrelationId, OrganizationId, RequestId, UserId } from "../domain/capa-types";
import type { TransactionManager } from "../../database/transactions";
import type { AuthoritativeS50RootCauseReviewContext, CapaRootCauseReviewAdvisoryContextAssembly, CapaRootCauseReviewAdvisoryContextResolution } from "./capa-root-cause-review-advisory-context";
import { CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT, CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION, type CapaRootCauseReviewAdvisoryAgentGate } from "./capa-root-cause-review-advisory-agent-gate";
import { CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION, type CapaRootCauseReviewAdvisoryResponse } from "./capa-root-cause-review-advisory-contract";
import { CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION } from "./capa-ai-generation-trace";
import type { CapaRootCauseReviewAdvisoryGenerationInput } from "./capa-root-cause-review-advisory-model-generator";
import type { CapaRootCauseReviewAdvisoryOutputRepository } from "../../database/repositories/capa-root-cause-review-advisory-output-repository";

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SERVICE_REASON_CODES = [
  "CASE_NOT_FOUND_OR_NOT_AUTHORIZED", "CASE_NOT_IN_ROOT_CAUSE_REVIEW", "ADVISORY_ACCESS_DENIED", "AGENT_NOT_ELIGIBLE", "ADVISORY_GENERATION_FAILED", "INVALID_ADVISORY_RESULT", "ADVISORY_PERSISTENCE_FAILED", "WORKFLOW_MUTATION_DETECTED",
] as const;
export type CapaRootCauseReviewAdvisoryServiceReasonCode = typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SERVICE_REASON_CODES[number];
export class CapaRootCauseReviewAdvisoryServiceError extends Error {
  readonly reason_code: CapaRootCauseReviewAdvisoryServiceReasonCode;
  constructor(reason_code: CapaRootCauseReviewAdvisoryServiceReasonCode) { super("The governed CAPA S50 root-cause review advisory operation failed."); this.name = "CapaRootCauseReviewAdvisoryServiceError"; this.reason_code = reason_code; }
}

export interface CapaRootCauseReviewAdvisoryRequest {
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
}
export interface CapaRootCauseReviewAdvisoryInvocation {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly user_id: UserId;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly request: CapaRootCauseReviewAdvisoryRequest;
}
export interface CapaRootCauseReviewAdvisoryContextResolver {
  resolve(input: { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId }): Promise<CapaRootCauseReviewAdvisoryContextResolution>;
  assertCaseUnchanged(context: AuthoritativeS50RootCauseReviewContext): Promise<boolean>;
}
export interface CapaRootCauseReviewAdvisoryAuthorizer {
  authorize(input: { readonly context: AuthoritativeS50RootCauseReviewContext; readonly operation: typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION }): Promise<boolean>;
}
export interface CapaRootCauseReviewAdvisoryGenerator {
  generate(input: CapaRootCauseReviewAdvisoryGenerationInput): Promise<{ readonly response: CapaRootCauseReviewAdvisoryResponse; readonly trace: Awaited<ReturnType<import("./capa-root-cause-review-advisory-model-generator").CapaRootCauseReviewAdvisoryModelGenerator["generate"]>>["trace"] }>;
}
export interface CapaRootCauseReviewAdvisoryServiceDependencies {
  readonly context_resolver: CapaRootCauseReviewAdvisoryContextResolver;
  readonly authorizer: CapaRootCauseReviewAdvisoryAuthorizer;
  readonly agent_gate: CapaRootCauseReviewAdvisoryAgentGate;
  readonly generator: CapaRootCauseReviewAdvisoryGenerator;
  readonly output_repository: CapaRootCauseReviewAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validContext(value: unknown, invocation: CapaRootCauseReviewAdvisoryInvocation): value is AuthoritativeS50RootCauseReviewContext {
  return record(value) && value.trust === "authoritative_server_context" && value.organization_id === invocation.organization_id && value.capa_case_id === invocation.capa_case_id && value.actor === invocation.user_id && value.workflow_state === "S50" && value.case_version_id === invocation.request.expected_case_version_id && value.record_version === invocation.request.expected_record_version && Array.isArray(value.active_roles) && value.active_roles.length > 0 && record(value.sections);
}
function validGenerated(value: unknown, invocation: CapaRootCauseReviewAdvisoryInvocation, context: AuthoritativeS50RootCauseReviewContext): value is { response: CapaRootCauseReviewAdvisoryResponse; trace: Awaited<ReturnType<import("./capa-root-cause-review-advisory-model-generator").CapaRootCauseReviewAdvisoryModelGenerator["generate"]>>["trace"] } {
  if (!record(value) || !record(value.response) || !record(value.trace)) return false;
  const response = value.response;
  const trace = value.trace;
  const pkg = record(trace.package) ? trace.package : null;
  const scope = pkg && record(pkg.scope) ? pkg.scope : null;
  const identity = pkg && record(pkg.trace) ? pkg.trace : null;
  const generation = pkg && record(pkg.generation_contract) ? pkg.generation_contract : null;
  const governance = pkg && record(pkg.governance) ? pkg.governance : null;
  const agent = pkg && record(pkg.agent) ? pkg.agent : null;
  const policy = record(trace.policy_manifest) ? trace.policy_manifest : null;
  return response.status === "completed_draft" && response.output_schema_version === CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION && response.advisory_only === true && response.workflow_mutated === false && response.controlled_record_mutated === false && response.review_disposition === null && response.workflow_transition === null && response.human_acceptance_required === true && pkg !== null && pkg.package_schema_version === "capa-root-cause-review-prompt-package-1.0.0" && scope !== null && scope.organization_id === context.organization_id && scope.capa_case_id === context.capa_case_id && scope.case_version_id === context.case_version_id && scope.record_version === context.record_version && scope.workflow_state === "S50" && identity !== null && identity.run_id === response.run_id && identity.request_id === invocation.request_id && identity.correlation_id === invocation.correlation_id && agent !== null && agent.agent_id === CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT.agent_id && agent.agent_version === CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT.agent_version && generation !== null && generation.operation === CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION && generation.output_schema_version === CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION && governance !== null && governance.advisory_only === true && governance.workflow_mutated === false && governance.controlled_record_mutated === false && governance.human_acceptance_required === true && trace.trace_schema_version === CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION && policy !== null && policy.policy_manifest_schema_version === "capa-root-cause-review-policy-manifest-1.0.0" && policy.workflow_state === "S50" && policy.operation === CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION;
}

export class CapaRootCauseReviewAdvisoryService {
  constructor(private readonly dependencies: CapaRootCauseReviewAdvisoryServiceDependencies) {}
  async execute(invocation: CapaRootCauseReviewAdvisoryInvocation): Promise<{ readonly advisory: CapaRootCauseReviewAdvisoryResponse; readonly snapshot: Readonly<{ readonly capa_case_id: CapaCaseId; readonly case_version_id: CapaCaseVersionId; readonly record_version: number }> }> {
    let resolution: CapaRootCauseReviewAdvisoryContextResolution;
    try { resolution = await this.dependencies.context_resolver.resolve({ organization_id: invocation.organization_id, capa_case_id: invocation.capa_case_id }); } catch { throw new CapaRootCauseReviewAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED"); }
    if (resolution.status === "not_found_or_not_authorized" || resolution.status === "invalid_authoritative_context") throw new CapaRootCauseReviewAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    if (resolution.status === "wrong_workflow_state") throw new CapaRootCauseReviewAdvisoryServiceError("CASE_NOT_IN_ROOT_CAUSE_REVIEW");
    const assembly = resolution.assembly;
    const context = assembly.authoritative;
    if (!validContext(context, invocation)) throw new CapaRootCauseReviewAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    let allowed = false; try { allowed = await this.dependencies.authorizer.authorize({ context, operation: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION }); } catch { allowed = false; }
    if (!allowed) throw new CapaRootCauseReviewAdvisoryServiceError("ADVISORY_ACCESS_DENIED");
    let eligible = false; try { eligible = this.dependencies.agent_gate.evaluate({ context, agent: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT, operation: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION }); } catch { eligible = false; }
    if (!eligible) throw new CapaRootCauseReviewAdvisoryServiceError("AGENT_NOT_ELIGIBLE");
    let generated: Awaited<ReturnType<CapaRootCauseReviewAdvisoryGenerator["generate"]>>;
    try { generated = await this.dependencies.generator.generate({ context: assembly, request_id: invocation.request_id, correlation_id: invocation.correlation_id }); } catch { throw new CapaRootCauseReviewAdvisoryServiceError("ADVISORY_GENERATION_FAILED"); }
    if (!validGenerated(generated, invocation, context)) throw new CapaRootCauseReviewAdvisoryServiceError("INVALID_ADVISORY_RESULT");
    let unchanged = false; try { unchanged = await this.dependencies.context_resolver.assertCaseUnchanged(context); } catch { unchanged = false; }
    if (!unchanged) throw new CapaRootCauseReviewAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    try {
      const saved = await this.dependencies.transaction_manager.runInTransaction({ request_id: invocation.request_id, correlation_id: invocation.correlation_id }, (transaction) => this.dependencies.output_repository.save(transaction, { context, response: generated.response, generation_trace: generated.trace, reference_manifest: assembly.reference_manifest, request_id: invocation.request_id, correlation_id: invocation.correlation_id }));
      if (saved === "case_changed") throw new CapaRootCauseReviewAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    } catch (error) { if (error instanceof CapaRootCauseReviewAdvisoryServiceError) throw error; throw new CapaRootCauseReviewAdvisoryServiceError("ADVISORY_PERSISTENCE_FAILED"); }
    return Object.freeze({ advisory: generated.response, snapshot: Object.freeze({ capa_case_id: context.capa_case_id, case_version_id: context.case_version_id, record_version: context.record_version }) });
  }
}
