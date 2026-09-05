import type { CapaCaseId, CapaCaseVersionId, CorrelationId, OrganizationId, RequestId, UserId } from "../domain/capa-types";
import type { TransactionManager } from "../../database/transactions";
import type { CapaInvestigationActiveAdvisoryContextAssembly, AuthoritativeS40InvestigationActiveContext, CapaInvestigationActiveAdvisoryContextResolution } from "./capa-investigation-active-advisory-context";
import { CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT, CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION, type CapaInvestigationActiveAdvisoryAgentGate } from "./capa-investigation-active-advisory-agent-gate";
import { CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION, type CapaInvestigationActiveAdvisoryResponse } from "./capa-investigation-active-advisory-contract";
import { CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION } from "./capa-ai-generation-trace";
import type { CapaInvestigationActiveAdvisoryGenerationInput } from "./capa-investigation-active-advisory-model-generator";
import type { CapaInvestigationActiveAdvisoryOutputRepository } from "../../database/repositories/capa-investigation-active-advisory-output-repository";

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_SERVICE_REASON_CODES = [
  "CASE_NOT_FOUND_OR_NOT_AUTHORIZED", "CASE_NOT_IN_INVESTIGATION_ACTIVE", "ADVISORY_ACCESS_DENIED", "AGENT_NOT_ELIGIBLE", "ADVISORY_GENERATION_FAILED", "INVALID_ADVISORY_RESULT", "ADVISORY_PERSISTENCE_FAILED", "WORKFLOW_MUTATION_DETECTED",
] as const;
export type CapaInvestigationActiveAdvisoryServiceReasonCode = typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_SERVICE_REASON_CODES[number];
export class CapaInvestigationActiveAdvisoryServiceError extends Error {
  readonly reason_code: CapaInvestigationActiveAdvisoryServiceReasonCode;
  constructor(reason_code: CapaInvestigationActiveAdvisoryServiceReasonCode) { super("The governed CAPA investigation-active advisory operation failed."); this.name = "CapaInvestigationActiveAdvisoryServiceError"; this.reason_code = reason_code; }
}

export interface CapaInvestigationActiveAdvisoryRequest {
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
  readonly untrusted_human_draft: unknown;
}
export interface CapaInvestigationActiveAdvisoryInvocation {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly user_id: UserId;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly request: CapaInvestigationActiveAdvisoryRequest;
}
export interface CapaInvestigationActiveAdvisoryContextResolver {
  resolve(input: { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly untrusted_human_draft?: unknown }): Promise<CapaInvestigationActiveAdvisoryContextResolution>;
  assertCaseUnchanged(context: AuthoritativeS40InvestigationActiveContext): Promise<boolean>;
}
export interface CapaInvestigationActiveAdvisoryAuthorizer {
  authorize(input: { readonly context: AuthoritativeS40InvestigationActiveContext; readonly operation: typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION }): Promise<boolean>;
}
export interface CapaInvestigationActiveAdvisoryGenerator {
  generate(input: CapaInvestigationActiveAdvisoryGenerationInput): Promise<{ readonly response: CapaInvestigationActiveAdvisoryResponse; readonly trace: Awaited<ReturnType<import("./capa-investigation-active-advisory-model-generator").CapaInvestigationActiveAdvisoryModelGenerator["generate"]>>["trace"] }>;
}
export interface CapaInvestigationActiveAdvisoryServiceDependencies {
  readonly context_resolver: CapaInvestigationActiveAdvisoryContextResolver;
  readonly authorizer: CapaInvestigationActiveAdvisoryAuthorizer;
  readonly agent_gate: CapaInvestigationActiveAdvisoryAgentGate;
  readonly generator: CapaInvestigationActiveAdvisoryGenerator;
  readonly output_repository: CapaInvestigationActiveAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validContext(value: unknown, invocation: CapaInvestigationActiveAdvisoryInvocation): value is AuthoritativeS40InvestigationActiveContext {
  return record(value) && value.trust === "authoritative_server_context" && value.organization_id === invocation.organization_id && value.capa_case_id === invocation.capa_case_id && value.actor === invocation.user_id && value.workflow_state === "S40" && value.case_version_id === invocation.request.expected_case_version_id && value.record_version === invocation.request.expected_record_version && Array.isArray(value.active_roles) && value.active_roles.length > 0 && record(value.investigation_plan);
}
function validGenerated(value: unknown, invocation: CapaInvestigationActiveAdvisoryInvocation, context: AuthoritativeS40InvestigationActiveContext): value is { response: CapaInvestigationActiveAdvisoryResponse; trace: Awaited<ReturnType<import("./capa-investigation-active-advisory-model-generator").CapaInvestigationActiveAdvisoryModelGenerator["generate"]>>["trace"] } {
  if (!record(value) || !record(value.response) || !record(value.trace)) return false;
  const response = value.response;
  const trace = value.trace;
  const packageValue = trace.package;
  if (!record(packageValue) || !record(packageValue.trace) || !record(packageValue.scope) || !record(packageValue.agent) || !record(packageValue.generation_contract)) return false;
  return response.status === "completed_draft" && response.output_schema_version === CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION && response.advisory_only === true && response.workflow_mutated === false && response.human_acceptance_required === true && response.run_id === packageValue.trace.run_id && trace.trace_schema_version === CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION && packageValue.agent.agent_id === CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_id && packageValue.agent.agent_version === CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_version && packageValue.generation_contract.operation === CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION && packageValue.generation_contract.output_schema_version === CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION && packageValue.scope.organization_id === context.organization_id && packageValue.scope.capa_case_id === context.capa_case_id && packageValue.scope.case_version_id === context.case_version_id && packageValue.scope.record_version === context.record_version && packageValue.scope.workflow_state === "S40" && packageValue.trace.request_id === invocation.request_id && packageValue.trace.correlation_id === invocation.correlation_id;
}

export class CapaInvestigationActiveAdvisoryService {
  constructor(private readonly dependencies: CapaInvestigationActiveAdvisoryServiceDependencies) {}
  async execute(invocation: CapaInvestigationActiveAdvisoryInvocation): Promise<{ readonly advisory: CapaInvestigationActiveAdvisoryResponse; readonly snapshot: Readonly<{ readonly capa_case_id: CapaCaseId; readonly case_version_id: CapaCaseVersionId; readonly record_version: number }> }> {
    let resolution: CapaInvestigationActiveAdvisoryContextResolution;
    try { resolution = await this.dependencies.context_resolver.resolve({ organization_id: invocation.organization_id, capa_case_id: invocation.capa_case_id, untrusted_human_draft: invocation.request.untrusted_human_draft }); } catch { throw new CapaInvestigationActiveAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED"); }
    if (resolution.status === "not_found_or_not_authorized" || resolution.status === "invalid_authoritative_context") throw new CapaInvestigationActiveAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    if (resolution.status === "wrong_workflow_state") throw new CapaInvestigationActiveAdvisoryServiceError("CASE_NOT_IN_INVESTIGATION_ACTIVE");
    const assembly = resolution.assembly;
    const context = assembly.authoritative;
    if (!validContext(context, invocation)) throw new CapaInvestigationActiveAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    let allowed = false; try { allowed = await this.dependencies.authorizer.authorize({ context, operation: CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION }); } catch { allowed = false; }
    if (!allowed) throw new CapaInvestigationActiveAdvisoryServiceError("ADVISORY_ACCESS_DENIED");
    let eligible = false; try { eligible = this.dependencies.agent_gate.evaluate({ context, agent: CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT, operation: CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION }); } catch { eligible = false; }
    if (!eligible) throw new CapaInvestigationActiveAdvisoryServiceError("AGENT_NOT_ELIGIBLE");
    let generated: Awaited<ReturnType<CapaInvestigationActiveAdvisoryGenerator["generate"]>>;
    try { generated = await this.dependencies.generator.generate({ context: assembly, request_id: invocation.request_id, correlation_id: invocation.correlation_id }); } catch { throw new CapaInvestigationActiveAdvisoryServiceError("ADVISORY_GENERATION_FAILED"); }
    if (!validGenerated(generated, invocation, context)) throw new CapaInvestigationActiveAdvisoryServiceError("INVALID_ADVISORY_RESULT");
    let unchanged = false; try { unchanged = await this.dependencies.context_resolver.assertCaseUnchanged(context); } catch { unchanged = false; }
    if (!unchanged) throw new CapaInvestigationActiveAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    try {
      const saved = await this.dependencies.transaction_manager.runInTransaction({ request_id: invocation.request_id, correlation_id: invocation.correlation_id }, (transaction) => this.dependencies.output_repository.save(transaction, { context, response: generated.response, generation_trace: generated.trace, reference_manifest: assembly.reference_manifest, request_id: invocation.request_id, correlation_id: invocation.correlation_id }));
      if (saved === "case_changed") throw new CapaInvestigationActiveAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    } catch (error) { if (error instanceof CapaInvestigationActiveAdvisoryServiceError) throw error; throw new CapaInvestigationActiveAdvisoryServiceError("ADVISORY_PERSISTENCE_FAILED"); }
    return Object.freeze({ advisory: generated.response, snapshot: Object.freeze({ capa_case_id: context.capa_case_id, case_version_id: context.case_version_id, record_version: context.record_version }) });
  }
}
