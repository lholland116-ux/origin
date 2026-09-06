import type { CapaCaseId, CorrelationId, RequestId, RequestTrace } from "../domain/capa-types";
import type { CapaApiLogger } from "./capa-route-handler";
import type { CapaRequestContext, SupabaseCapaContextResolver, SupabaseCapaSessionFacts } from "../../security/supabase-capa-context";
import { SupabaseCapaContextError } from "../../security/supabase-capa-context";
import { SupabaseCapaTenantAccessError } from "../../security/supabase-capa-durable-context";
import type { ReconcileCapaInvestigationActiveWorkspaceAdoptionsResult } from "../application/reconcile-capa-investigation-active-workspace-adoptions";

export interface CapaInvestigationActiveWorkspaceReconciliationApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly create_reconciliation_service: (context: CapaRequestContext) => { reconcile(command: { readonly capa_case_id: CapaCaseId; readonly request_trace: RequestTrace }): Promise<ReconcileCapaInvestigationActiveWorkspaceAdoptionsResult> };
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const trace = (request: Request, generateUuid: () => string): RequestTrace => ({ request_id: (UUID.test(request.headers.get("x-request-id") ?? "") ? request.headers.get("x-request-id")! : generateUuid()) as RequestId, correlation_id: (UUID.test(request.headers.get("x-correlation-id") ?? "") ? request.headers.get("x-correlation-id")! : generateUuid()) as CorrelationId });
const error = (t: RequestTrace, status: number, code: string, message: string) => response({ error: { code, message, correlation_id: t.correlation_id } }, status);
const projection = (workspace: Extract<ReconcileCapaInvestigationActiveWorkspaceAdoptionsResult, { readonly status: "reconciled" }>['workspace']) => workspace === null ? null : { draft_revision: workspace.draft_revision, case_version_id: workspace.case_version_id, record_version: workspace.record_version, evidence_assumption_ledger: workspace.evidence_assumption_ledger, root_cause_package: workspace.root_cause_package, updated_at: workspace.updated_at };

function resultResponse(t: RequestTrace, result: ReconcileCapaInvestigationActiveWorkspaceAdoptionsResult): Response {
  if (result.status === "reconciled") return response({ status: "reconciled", workspace: projection(result.workspace), correlation_id: t.correlation_id }, 200);
  switch (result.status) {
    case "not_found": return error(t, 404, "CAPA_WORKSPACE_CASE_NOT_FOUND", "The CAPA case was not found.");
    case "workflow_conflict": return error(t, 409, "CAPA_WORKSPACE_CASE_STATE_CONFLICT", "The CAPA case is not in the required state for S40 reconciliation.");
    case "authorization_denied": return error(t, 403, "CAPA_WORKSPACE_ACCESS_DENIED", "The S40 workspace operation is not authorized.");
    case "case_changed": return error(t, 409, "WORKFLOW_MUTATION_DETECTED", "The CAPA case changed before reconciliation could be completed.");
    case "concurrency_conflict": return error(t, 409, "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", "The workspace changed before reconciliation could be completed.");
    case "legacy_causal_role_not_recorded": return error(t, 409, "LEGACY_CAUSAL_ROLE_NOT_RECORDED", "A historical causal adoption requires human role information before reconciliation.");
    case "failed": return error(t, 500, "CAPA_INTERNAL_ERROR", "The S40 workspace could not be reconciled.");
  }
}

export async function handleCapaInvestigationActiveWorkspaceReconciliationPost(request: Request, caseId: string, dependencies: CapaInvestigationActiveWorkspaceReconciliationApiDependencies): Promise<Response> {
  const t = trace(request, dependencies.generate_uuid);
  try {
    const facts = await dependencies.get_session_facts();
    if (facts === null) return error(t, 401, "UNAUTHORIZED", "Authentication is required.");
    const context = await dependencies.resolve_context(facts, dependencies.now());
    if (context instanceof Response) return context;
    if (!UUID.test(caseId)) return error(t, 400, "INVALID_CAPA_CASE_ID", "A valid CAPA case identifier is required.");
    return resultResponse(t, await dependencies.create_reconciliation_service(context).reconcile({ capa_case_id: caseId as CapaCaseId, request_trace: t }));
  } catch (e) {
    if (e instanceof SupabaseCapaContextError) return error(t, 401, "INVALID_SESSION_CONTEXT", "The authenticated session is not valid for this request.");
    if (e instanceof SupabaseCapaTenantAccessError) return error(t, 403, "CAPA_TENANT_ACCESS_DENIED", "The authenticated user is not authorized to access a CAPA organization.");
    dependencies.logger.error("CAPA API investigation-active workspace reconciliation failed.", { correlation_id: t.correlation_id, error_name: e instanceof Error ? e.name : "UnknownError" });
    return error(t, 500, "CAPA_INTERNAL_ERROR", "The CAPA request could not be completed.");
  }
}
