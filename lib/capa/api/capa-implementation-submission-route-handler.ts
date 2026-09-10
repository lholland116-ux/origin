import type {
  CapaCaseId,
  CorrelationId,
  IdempotencyKey,
  RequestId,
  RequestTrace,
} from "../domain/capa-types";
import {
  submitCapaImplementation,
  type SubmitCapaImplementationResult,
} from "../application/submit-capa-implementation";
import type {
  CapaRuntime,
} from "../application/capa-runtime";
import {
  SupabaseCapaContextError,
  type CapaRequestContext,
  type SupabaseCapaContextResolver,
  type SupabaseCapaSessionFacts,
} from "../../security/supabase-capa-context";
import {
  SupabaseCapaTenantAccessError,
} from "../../security/supabase-capa-durable-context";
import type {
  CapaApiLogger,
} from "./capa-route-handler";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;

export interface CapaImplementationSubmissionApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly get_runtime: () => CapaRuntime;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

function normalizedUuid(value: string | null): string | null {
  if (value === null || value.trim() !== value || !UUID.test(value)) return null;
  return value;
}

function validSubmissionBody(value: unknown): value is { readonly expected_draft_revision: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 &&
    typeof candidate.expected_draft_revision === "number" &&
    Number.isSafeInteger(candidate.expected_draft_revision) &&
    candidate.expected_draft_revision >= 1;
}

function requestTrace(
  request: Request,
  generateUuid: () => string,
): RequestTrace {
  return {
    request_id: (normalizedUuid(request.headers.get("x-request-id")) ?? generateUuid()) as RequestId,
    correlation_id: (normalizedUuid(request.headers.get("x-correlation-id")) ?? generateUuid()) as CorrelationId,
  };
}

function response(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function errorResponse(
  trace: RequestTrace,
  status: number,
  code: string,
  message: string,
  issues?: readonly { readonly path: string; readonly message: string }[],
): Response {
  return response({
    error: {
      code,
      message,
      correlation_id: trace.correlation_id,
      ...(issues === undefined ? {} : { issues }),
    },
  }, status);
}

function serviceError(
  trace: RequestTrace,
  result: SubmitCapaImplementationResult,
): Response {
  if (result.status === "submitted" || result.status === "already_submitted") {
    throw new Error("A successful implementation submission cannot be mapped as an error.");
  }
  switch (result.status) {
    case "validation_failed":
      return errorResponse(trace, 400, "CAPA_IMPLEMENTATION_SUBMISSION_VALIDATION_FAILED", "The implementation package is not valid for submission.", [{ path: "submission", message: result.detail_reason_code ?? result.reason_code }]);
    case "submission_blocked":
      return errorResponse(trace, 422, "CAPA_IMPLEMENTATION_SUBMISSION_NOT_READY", "The implementation package is not ready for Implementation Review.", result.blocker_codes.map((code) => ({ path: "readiness.blocker_codes", message: code })));
    case "authorization_denied":
      return errorResponse(trace, 403, "CAPA_IMPLEMENTATION_SUBMISSION_ACCESS_DENIED", "The S80 implementation submission operation is not authorized.");
    case "not_found_or_not_authorized":
      return errorResponse(trace, 404, "CAPA_NOT_FOUND", "The CAPA case was not found.");
    case "idempotency_conflict":
      return errorResponse(trace, 409, "CAPA_IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different CAPA request.");
    case "concurrency_conflict":
      return errorResponse(trace, 409, result.reason_code === "WORKSPACE_DRAFT_REVISION_CONFLICT" ? "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" : "CAPA_CONCURRENCY_CONFLICT", "The S80 implementation workspace or CAPA changed before submission could be completed.");
    case "workflow_conflict":
      return errorResponse(trace, 409, "CAPA_WORKFLOW_CONFLICT", "The CAPA case is not in S80 Implementation.");
  }
}

async function sessionContext(
  dependencies: CapaImplementationSubmissionApiDependencies,
  trace: RequestTrace,
): Promise<CapaRequestContext | Response> {
  const facts = await dependencies.get_session_facts();
  if (facts === null) return errorResponse(trace, 401, "UNAUTHORIZED", "Authentication is required.");
  return dependencies.resolve_context(facts, dependencies.now());
}

export async function handleCapaImplementationSubmissionPost(
  request: Request,
  caseId: string,
  dependencies: CapaImplementationSubmissionApiDependencies,
): Promise<Response> {
  const trace = requestTrace(request, dependencies.generate_uuid);
  try {
    const context = await sessionContext(dependencies, trace);
    if (context instanceof Response) return context;
    const normalizedCaseId = normalizedUuid(caseId);
    if (normalizedCaseId === null || normalizedCaseId !== caseId) return errorResponse(trace, 400, "INVALID_CAPA_CASE_ID", "A valid CAPA case identifier is required.");
    const key = request.headers.get("idempotency-key");
    if (key === null || key.length === 0 || key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH || key.trim() !== key) return errorResponse(trace, 400, "INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required.");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(trace, 400, "INVALID_CAPA_IMPLEMENTATION_SUBMISSION", "The implementation submission request is invalid.");
    }
    if (!validSubmissionBody(body)) return errorResponse(trace, 400, "INVALID_CAPA_IMPLEMENTATION_SUBMISSION", "The implementation submission request is invalid.");
    const result = await submitCapaImplementation(
      dependencies.get_runtime().submit_implementation_dependencies,
      {
        authentication: context.authentication,
        tenant: context.tenant,
        capa_case_id: normalizedCaseId as CapaCaseId,
        request_trace: { ...trace, idempotency_key: key as IdempotencyKey },
        body,
      },
    );
    if (result.status !== "submitted" && result.status !== "already_submitted") return serviceError(trace, result);
    return response({
      status: "submitted",
      capa: {
        capa_case_id: result.capa_case.capa_case_id,
        case_number: result.capa_case.case_number,
        status: result.capa_case.status,
        workflow_state: result.capa_case.status,
        record_version: result.record_version,
        current_version_id: result.resulting_case_version_id,
        source_case_version_id: result.source_case_version_id,
        resulting_case_version_id: result.resulting_case_version_id,
        implementation_review_baseline_section_version_id: result.implementation_review_baseline_section_version.section_version_id,
        submitted_at: result.implementation_review_baseline_section_version.created_at,
      },
      transition_audit_event_id: result.transition_audit_event_id,
      replayed: result.status === "already_submitted",
      correlation_id: trace.correlation_id,
    }, 200);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) return errorResponse(trace, 401, "INVALID_SESSION_CONTEXT", "The authenticated session is not valid for this request.");
    if (error instanceof SupabaseCapaTenantAccessError) return errorResponse(trace, 403, "CAPA_TENANT_ACCESS_DENIED", "The authenticated user is not authorized to access a CAPA organization.");
    dependencies.logger.error("CAPA implementation submission failed.", { correlation_id: trace.correlation_id, error_name: error instanceof Error ? error.name : "UnknownError" });
    return errorResponse(trace, 500, "CAPA_INTERNAL_ERROR", "The implementation submission could not be completed.");
  }
}
