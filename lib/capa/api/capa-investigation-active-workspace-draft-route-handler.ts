import type { CapaCaseId, CorrelationId, RequestId, RequestTrace } from "../domain/capa-types";
import type {
  CapaInvestigationActiveWorkspaceDraftService,
  CapaInvestigationActiveWorkspaceDraftServiceResult,
} from "../application/capa-investigation-active-workspace-draft-service";
import type { CapaApiLogger } from "./capa-route-handler";
import {
  SupabaseCapaContextError,
  type CapaRequestContext,
  type SupabaseCapaContextResolver,
  type SupabaseCapaSessionFacts,
} from "../../security/supabase-capa-context";
import { SupabaseCapaTenantAccessError } from "../../security/supabase-capa-durable-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CapaInvestigationActiveWorkspaceDraftApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly create_workspace_service: (context: CapaRequestContext) => CapaInvestigationActiveWorkspaceDraftService;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function normalizedUuid(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function trace(request: Request, generateUuid: () => string): RequestTrace {
  return {
    request_id: (normalizedUuid(request.headers.get("x-request-id")) ?? generateUuid()) as RequestId,
    correlation_id: (normalizedUuid(request.headers.get("x-correlation-id")) ?? generateUuid()) as CorrelationId,
  };
}

function errorResponse(traceValue: RequestTrace, status: number, code: string, message: string): Response {
  return response({ error: { code, message, correlation_id: traceValue.correlation_id } }, status);
}

function projection(workspace: NonNullable<Extract<CapaInvestigationActiveWorkspaceDraftServiceResult, { readonly workspace: unknown }>['workspace']>) {
  return {
    draft_revision: workspace.draft_revision,
    case_version_id: workspace.case_version_id,
    record_version: workspace.record_version,
    evidence_assumption_ledger: workspace.evidence_assumption_ledger,
    root_cause_package: workspace.root_cause_package,
    updated_at: workspace.updated_at,
  };
}

function serviceError(traceValue: RequestTrace, result: CapaInvestigationActiveWorkspaceDraftServiceResult): Response {
  if (result.status === "loaded" || result.status === "saved") {
    throw new Error("A successful workspace result cannot be mapped as an error.");
  }
  switch (result.status) {
    case "not_found":
      return errorResponse(traceValue, 404, "CAPA_WORKSPACE_CASE_NOT_FOUND", "The CAPA case was not found.");
    case "workflow_conflict":
      return errorResponse(traceValue, 409, "CAPA_WORKSPACE_CASE_STATE_CONFLICT", "The CAPA case is not in the required state for the S40 workspace.");
    case "case_changed":
      return errorResponse(traceValue, 409, "WORKFLOW_MUTATION_DETECTED", "The CAPA case changed before this workspace save could be completed.");
    case "authorization_denied":
      return errorResponse(traceValue, 403, "CAPA_WORKSPACE_ACCESS_DENIED", "The CAPA investigation-active workspace operation is not authorized.");
    case "validation_failed":
      return errorResponse(traceValue, 400, "INVALID_CAPA_INVESTIGATION_ACTIVE_WORKSPACE_REQUEST", "The CAPA investigation-active workspace request is invalid.");
    case "concurrency_conflict":
      return errorResponse(traceValue, 409, "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", "The workspace changed before this save could be completed.");
  }
}

async function sessionContext(
  request: Request,
  dependencies: CapaInvestigationActiveWorkspaceDraftApiDependencies,
  requestTrace: RequestTrace,
): Promise<CapaRequestContext | Response> {
  const facts = await dependencies.get_session_facts();
  if (facts === null) return errorResponse(requestTrace, 401, "UNAUTHORIZED", "Authentication is required.");
  return dependencies.resolve_context(facts, dependencies.now());
}

export async function handleCapaInvestigationActiveWorkspaceDraftGet(
  request: Request,
  caseId: string,
  dependencies: CapaInvestigationActiveWorkspaceDraftApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);
  try {
    const context = await sessionContext(request, dependencies, requestTrace);
    if (context instanceof Response) return context;
    const normalizedCaseId = normalizedUuid(caseId);
    if (normalizedCaseId === null || normalizedCaseId !== caseId) return errorResponse(requestTrace, 400, "INVALID_CAPA_CASE_ID", "A valid CAPA case identifier is required.");
    const result = await dependencies.create_workspace_service(context).load({ capa_case_id: normalizedCaseId as CapaCaseId });
    if (result.status === "loaded") return response({ workspace: result.workspace === null ? null : projection(result.workspace), correlation_id: requestTrace.correlation_id }, 200);
    return serviceError(requestTrace, result);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) return errorResponse(requestTrace, 401, "INVALID_SESSION_CONTEXT", "The authenticated session is not valid for this request.");
    if (error instanceof SupabaseCapaTenantAccessError) return errorResponse(requestTrace, 403, "CAPA_TENANT_ACCESS_DENIED", "The authenticated user is not authorized to access a CAPA organization.");
    dependencies.logger.error("CAPA API investigation-active workspace load failed.", { correlation_id: requestTrace.correlation_id, error_name: error instanceof Error ? error.name : "UnknownError" });
    return errorResponse(requestTrace, 500, "CAPA_INTERNAL_ERROR", "The CAPA request could not be completed.");
  }
}

export async function handleCapaInvestigationActiveWorkspaceDraftPut(
  request: Request,
  caseId: string,
  dependencies: CapaInvestigationActiveWorkspaceDraftApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);
  try {
    const context = await sessionContext(request, dependencies, requestTrace);
    if (context instanceof Response) return context;
    const normalizedCaseId = normalizedUuid(caseId);
    if (normalizedCaseId === null || normalizedCaseId !== caseId) return errorResponse(requestTrace, 400, "INVALID_CAPA_CASE_ID", "A valid CAPA case identifier is required.");
    let body: unknown;
    try { body = await request.json(); } catch { return errorResponse(requestTrace, 400, "INVALID_CAPA_INVESTIGATION_ACTIVE_WORKSPACE_REQUEST", "The CAPA investigation-active workspace request is invalid."); }
    const result = await dependencies.create_workspace_service(context).save({ capa_case_id: normalizedCaseId as CapaCaseId, body, request_trace: requestTrace });
    if (result.status === "saved") return response({ workspace: projection(result.workspace), correlation_id: requestTrace.correlation_id }, 200);
    return serviceError(requestTrace, result);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) return errorResponse(requestTrace, 401, "INVALID_SESSION_CONTEXT", "The authenticated session is not valid for this request.");
    if (error instanceof SupabaseCapaTenantAccessError) return errorResponse(requestTrace, 403, "CAPA_TENANT_ACCESS_DENIED", "The authenticated user is not authorized to access a CAPA organization.");
    dependencies.logger.error("CAPA API investigation-active workspace save failed.", { correlation_id: requestTrace.correlation_id, error_name: error instanceof Error ? error.name : "UnknownError" });
    return errorResponse(requestTrace, 500, "CAPA_INTERNAL_ERROR", "The CAPA request could not be completed.");
  }
}
