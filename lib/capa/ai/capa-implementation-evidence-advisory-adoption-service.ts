import type { AuditEvent, AuditEventId, CapaCaseId, CapaCaseVersionId, RequestTrace, UserId } from "../domain/capa-types";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { CapaImplementationEvidenceAdvisoryOutputRepository } from "../../database/repositories/capa-implementation-evidence-advisory-output-repository";
import type { CapaImplementationWorkspaceService } from "../application/capa-implementation-workspace-service";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_ADOPTION_POLICY_VERSION, type CapaImplementationEvidenceAdvisoryAdoptionRequest, type CapaImplementationEvidenceAdvisoryAdoptionResult } from "./capa-implementation-evidence-advisory-adoption-contract";

export type CapaImplementationEvidenceAdvisoryAdoptionReasonCode = "ADOPTION_ACCESS_DENIED" | "OUTPUT_NOT_FOUND_OR_NOT_AUTHORIZED" | "OUTPUT_NOT_ADOPTABLE" | "CASE_NOT_IN_IMPLEMENTATION" | "CASE_CHANGED" | "WORKSPACE_NOT_AVAILABLE" | "PERSISTENCE_FAILED";
export class CapaImplementationEvidenceAdvisoryAdoptionServiceError extends Error { constructor(readonly reason_code: CapaImplementationEvidenceAdvisoryAdoptionReasonCode) { super("The S80 advisory adoption operation failed."); this.name = "CapaImplementationEvidenceAdvisoryAdoptionServiceError"; } }

export interface CapaImplementationEvidenceAdvisoryAdoptionDependencies { readonly request_context: CapaRequestContext; readonly authorization_policy: CapaAuthorizationPolicy; readonly output_repository: CapaImplementationEvidenceAdvisoryOutputRepository; readonly workspace_service: CapaImplementationWorkspaceService; readonly transaction_manager: TransactionManager; readonly audit_repository?: AuditRepository; readonly audit_schema_version?: string; readonly now: () => Date; readonly generate_audit_event_id: () => AuditEventId; }

function adoptionEvent(dependencies: CapaImplementationEvidenceAdvisoryAdoptionDependencies, capaCaseId: CapaCaseId, request: CapaImplementationEvidenceAdvisoryAdoptionRequest, trace: RequestTrace, userId: UserId, auditEventId: AuditEventId): AuditEvent {
  const now = dependencies.now();
  return { organization_id: dependencies.request_context.tenant.organization_id, event_id: auditEventId, event_type: "EVT-AI-PROPOSAL-ADOPTED" as never, schema_version: dependencies.audit_schema_version ?? "audit-schema-1.0.0", aggregate_type: "CAPA_CASE" as never, aggregate_id: capaCaseId, aggregate_version: request.expected_record_version, actor: { actor_type: "human", actor_id: userId }, occurred_at: now.toISOString() as never, action: "ADOPT_CAPA_IMPLEMENTATION_EVIDENCE_SUGGESTION" as never, target: { object_type: "CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_ADOPTION" as never, object_id: request.finding_id }, outcome: "succeeded", request_id: trace.request_id, correlation_id: trace.correlation_id, ...(trace.idempotency_key === undefined ? {} : { idempotency_key: trace.idempotency_key }), configuration_versions: { adoption_policy: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_ADOPTION_POLICY_VERSION, audit_schema: dependencies.audit_schema_version ?? "audit-schema-1.0.0" }, metadata: { output_id: request.output_id, finding_id: request.finding_id, adoption_policy_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_ADOPTION_POLICY_VERSION, advisory_only_human_adoption: true, prepared_patch_only: true, workspace_saved: false, workflow_mutated: false, controlled_record_mutated: false, evidence_created: false, owner_reported_status_changed: false, approved_baseline_changed: false } };
}

export class CapaImplementationEvidenceAdvisoryAdoptionService {
  constructor(private readonly dependencies: CapaImplementationEvidenceAdvisoryAdoptionDependencies) {}
  async prepare(input: { readonly capa_case_id: CapaCaseId; readonly request: CapaImplementationEvidenceAdvisoryAdoptionRequest; readonly request_trace: RequestTrace; readonly user_id: UserId }): Promise<CapaImplementationEvidenceAdvisoryAdoptionResult> {
    const context = this.dependencies.request_context;
    if (context.authentication.principal.principal_type !== "human" || context.authentication.principal.user_id !== input.user_id) throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("ADOPTION_ACCESS_DENIED");
    const precondition = evaluateCapaAuthorizationPreconditions({ authentication: context.authentication, tenant: context.tenant, resource: { organization_id: context.tenant.organization_id }, operation: "adopt_ai_implementation_evidence_suggestion", trusted_now: this.dependencies.now() });
    if (precondition.status === "denied") throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("ADOPTION_ACCESS_DENIED");
    const current = await this.dependencies.workspace_service.load({ capa_case_id: input.capa_case_id });
    if (current.status === "workflow_conflict") throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("CASE_NOT_IN_IMPLEMENTATION");
    if (current.status !== "loaded") throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("WORKSPACE_NOT_AVAILABLE");
    if (current.workspace.case_version_id !== input.request.expected_case_version_id || current.workspace.record_version !== input.request.expected_record_version) throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("CASE_CHANGED");
    const decision = await this.dependencies.authorization_policy.evaluate({ authentication: context.authentication, tenant: context.tenant, operation: "adopt_ai_implementation_evidence_suggestion", resource: { organization_id: context.tenant.organization_id, resource_type: "CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY" as never, resource_id: input.capa_case_id, resource_version_id: input.request.expected_case_version_id, capa_case_id: input.capa_case_id, case_version_id: input.request.expected_case_version_id, workflow_state: "S80" }, purpose: "CAPA_AI_IMPLEMENTATION_EVIDENCE_ADVISORY_ADOPTION" as never, trusted_now: this.dependencies.now() });
    if (decision.decision !== "allow") throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("ADOPTION_ACCESS_DENIED");
    const output = await this.dependencies.output_repository.findById(context.tenant.organization_id, input.request.output_id);
    if (output === null || output.organization_id !== context.tenant.organization_id || output.capa_case_id !== input.capa_case_id || output.case_version_id !== input.request.expected_case_version_id || output.record_version !== input.request.expected_record_version) throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("OUTPUT_NOT_FOUND_OR_NOT_AUTHORIZED");
    const finding = output.response.findings.find((candidate) => candidate.finding_id === input.request.finding_id);
    if (finding === undefined || !finding.adoption.eligible || finding.adoption.field !== "implementation_narrative" || finding.adoption.suggested_value === null) throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("OUTPUT_NOT_ADOPTABLE");
    let auditEventId: AuditEventId | null = null;
    if (this.dependencies.audit_repository !== undefined) {
      auditEventId = this.dependencies.generate_audit_event_id();
      try { await this.dependencies.transaction_manager.runInTransaction(input.request_trace, async (transaction) => { const appended = await this.dependencies.audit_repository!.appendEvent(transaction, adoptionEvent(this.dependencies, input.capa_case_id, input.request, input.request_trace, input.user_id, auditEventId!)); if (appended.status === "conflict") throw new Error("AUDIT_EVENT_CONFLICT"); }); } catch { throw new CapaImplementationEvidenceAdvisoryAdoptionServiceError("PERSISTENCE_FAILED"); }
    }
    return { status: "prepared", patch: { output_id: input.request.output_id, finding_id: finding.finding_id, capa_case_id: input.capa_case_id, case_version_id: input.request.expected_case_version_id, record_version: input.request.expected_record_version, approved_action_reference: finding.approved_action_reference, field: "implementation_narrative", value: finding.adoption.suggested_value, requires_human_review: true, auto_saved: false, auto_submitted: false, evidence_created: false, owner_reported_status_changed: false, approved_baseline_changed: false, audit_event_id: auditEventId }, request_trace: { request_id: input.request_trace.request_id, correlation_id: input.request_trace.correlation_id } };
  }
}
