import { CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT, type RawCapaContainmentRiskAdvisoryModelOutput } from "./capa-containment-risk-advisory-contract";
import { validateCapaContainmentRiskAdvisoryModelOutput } from "./capa-containment-risk-advisory-output-validator";
import type { CapaContainmentRiskAdvisoryContextAssembly, AuthoritativeS20ContainmentRiskContext } from "./capa-containment-risk-advisory-context";
import type { OrganizationId, CapaCaseId, CapaCaseVersionId, UserId } from "../domain/capa-types";

export const CAPA_CONTAINMENT_RISK_ADVISORY_OPERATION = "analyze_containment_impact_risk" as const;
export const CAPA_CONTAINMENT_RISK_ADVISORY_AGENT = Object.freeze({ agent_id: "AG-INTAKE" as const, agent_version: "ag-intake-1.0.0" as const, output_schema_version: "capa-containment-risk-advisory-1.0.0" as const, requested_tool_ids: Object.freeze(["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"] as const) });
export const CAPA_CONTAINMENT_RISK_ADVISORY_SERVICE_REASON_CODES = ["CASE_NOT_FOUND_OR_NOT_AUTHORIZED", "CASE_NOT_IN_CONTAINMENT_RISK", "ADVISORY_ACCESS_DENIED", "AGENT_NOT_ELIGIBLE", "ADVISORY_GENERATION_FAILED", "INVALID_ADVISORY_RESULT", "WORKFLOW_MUTATION_DETECTED"] as const;
export class CapaContainmentRiskAdvisoryServiceError extends Error { readonly reason_code: typeof CAPA_CONTAINMENT_RISK_ADVISORY_SERVICE_REASON_CODES[number]; constructor(code: typeof CAPA_CONTAINMENT_RISK_ADVISORY_SERVICE_REASON_CODES[number]) { super("The governed CAPA containment/risk advisory operation failed."); this.name = "CapaContainmentRiskAdvisoryServiceError"; this.reason_code = code; } }
export interface CapaContainmentRiskAdvisoryInvocation { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly user_id: UserId; readonly request: import("./capa-containment-risk-advisory-contract").CapaContainmentRiskAdvisoryRequest; }
export interface CapaContainmentRiskAdvisoryContextResolver { resolve(input: { readonly organization_id: string; readonly capa_case_id: string; readonly untrusted_human_draft: unknown }): Promise<CapaContainmentRiskAdvisoryContextAssembly | null>; assertCaseUnchanged(context: AuthoritativeS20ContainmentRiskContext): Promise<boolean>; }
export interface CapaContainmentRiskAdvisoryAuthorizer { authorize(input: { readonly context: AuthoritativeS20ContainmentRiskContext; readonly operation: typeof CAPA_CONTAINMENT_RISK_ADVISORY_OPERATION }): Promise<boolean>; }
export interface CapaContainmentRiskAdvisoryAgentGate { evaluate(input: { readonly context: AuthoritativeS20ContainmentRiskContext; readonly agent: typeof CAPA_CONTAINMENT_RISK_ADVISORY_AGENT; readonly operation: typeof CAPA_CONTAINMENT_RISK_ADVISORY_OPERATION }): boolean; }
export interface CapaContainmentRiskAdvisoryGenerator { generate(input: { readonly context: CapaContainmentRiskAdvisoryContextAssembly; readonly focus: string | null }): Promise<RawCapaContainmentRiskAdvisoryModelOutput>; }
export interface CapaContainmentRiskAdvisoryServiceDependencies { readonly context_resolver: CapaContainmentRiskAdvisoryContextResolver; readonly authorizer: CapaContainmentRiskAdvisoryAuthorizer; readonly agent_gate: CapaContainmentRiskAdvisoryAgentGate; readonly generator: CapaContainmentRiskAdvisoryGenerator; }
export class CapaContainmentRiskAdvisoryService {
  constructor(private readonly dependencies: CapaContainmentRiskAdvisoryServiceDependencies) {}
  async execute(invocation: CapaContainmentRiskAdvisoryInvocation): Promise<{ readonly advisory: RawCapaContainmentRiskAdvisoryModelOutput; readonly snapshot: Readonly<{ capa_case_id: CapaCaseId; case_version_id: CapaCaseVersionId; record_version: number }> }> {
    if (invocation.request.requested_output !== CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT) throw new CapaContainmentRiskAdvisoryServiceError("INVALID_ADVISORY_RESULT");
    let assembly: CapaContainmentRiskAdvisoryContextAssembly | null;
    try { assembly = await this.dependencies.context_resolver.resolve({ organization_id: invocation.organization_id, capa_case_id: invocation.capa_case_id, untrusted_human_draft: invocation.request.untrusted_human_draft }); } catch { throw new CapaContainmentRiskAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED"); }
    const context = assembly?.authoritative;
    if (!assembly || !context) throw new CapaContainmentRiskAdvisoryServiceError("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    if (context.trust !== "authoritative_server_context" || context.organization_id !== invocation.organization_id || context.capa_case_id !== invocation.capa_case_id || context.actor !== invocation.user_id || context.workflow_state !== "S20" || !Number.isSafeInteger(context.record_version) || context.record_version <= 0 || typeof context.case_version_id !== "string" || context.case_version_id.length === 0 || !Array.isArray(context.active_roles) || context.active_roles.length === 0) throw new CapaContainmentRiskAdvisoryServiceError("CASE_NOT_IN_CONTAINMENT_RISK");
    if (!await this.dependencies.authorizer.authorize({ context, operation: CAPA_CONTAINMENT_RISK_ADVISORY_OPERATION })) throw new CapaContainmentRiskAdvisoryServiceError("ADVISORY_ACCESS_DENIED");
    if (!this.dependencies.agent_gate.evaluate({ context, agent: CAPA_CONTAINMENT_RISK_ADVISORY_AGENT, operation: CAPA_CONTAINMENT_RISK_ADVISORY_OPERATION })) throw new CapaContainmentRiskAdvisoryServiceError("AGENT_NOT_ELIGIBLE");
    let advisory: RawCapaContainmentRiskAdvisoryModelOutput;
    try { advisory = await this.dependencies.generator.generate({ context: assembly, focus: invocation.request.focus }); } catch { throw new CapaContainmentRiskAdvisoryServiceError("ADVISORY_GENERATION_FAILED"); }
    let validated: RawCapaContainmentRiskAdvisoryModelOutput;
    try { validated = validateCapaContainmentRiskAdvisoryModelOutput(JSON.stringify(advisory)); } catch { throw new CapaContainmentRiskAdvisoryServiceError("INVALID_ADVISORY_RESULT"); }
    let unchanged = false; try { unchanged = await this.dependencies.context_resolver.assertCaseUnchanged(context); } catch { unchanged = false; }
    if (!unchanged) throw new CapaContainmentRiskAdvisoryServiceError("WORKFLOW_MUTATION_DETECTED");
    return Object.freeze({ advisory: Object.freeze(validated), snapshot: Object.freeze({ capa_case_id: context.capa_case_id, case_version_id: context.case_version_id, record_version: context.record_version }) });
  }
}
