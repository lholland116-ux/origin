import type { CapaCaseId, CapaCaseVersionId, CorrelationId, RequestId } from "../domain/capa-types";
import {
  CapaRootCauseReviewAdvisoryServiceError,
  type CapaRootCauseReviewAdvisoryService,
} from "../ai/capa-root-cause-review-advisory-service";
import type { CapaApiLogger } from "./capa-route-handler";
import {
  SupabaseCapaContextError,
  type CapaRequestContext,
  type SupabaseCapaContextResolver,
  type SupabaseCapaSessionFacts,
} from "../../security/supabase-capa-context";
import { SupabaseCapaTenantAccessError } from "../../security/supabase-capa-durable-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CapaRootCauseReviewAdvisoryRequestValidationError extends Error {
  readonly reason_code:
    | "INVALID_ADVISORY_INPUT"
    | "UNSUPPORTED_ADVISORY_INPUT_FIELD";

  constructor(
    reason_code: CapaRootCauseReviewAdvisoryRequestValidationError["reason_code"],
  ) {
    super("The governed CAPA S50 root-cause review advisory request is invalid.");
    this.name = "CapaRootCauseReviewAdvisoryRequestValidationError";
    this.reason_code = reason_code;
  }
}

export interface CapaRootCauseReviewAdvisoryApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly create_advisory_service: (context: CapaRequestContext) => CapaRootCauseReviewAdvisoryService;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function uuid(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function trace(
  request: Request,
  generateUuid: () => string,
): { readonly request_id: RequestId; readonly correlation_id: CorrelationId } {
  return {
    request_id: (uuid(request.headers.get("x-request-id")) ?? generateUuid()) as RequestId,
    correlation_id: (uuid(request.headers.get("x-correlation-id")) ?? generateUuid()) as CorrelationId,
  };
}

function errorResponse(
  traceValue: { readonly correlation_id: CorrelationId },
  status: number,
  code: string,
  message: string,
): Response {
  return response({ error: { code, message, correlation_id: traceValue.correlation_id } }, status);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRequest(value: unknown): {
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
} {
  if (!record(value)) {
    throw new CapaRootCauseReviewAdvisoryRequestValidationError("INVALID_ADVISORY_INPUT");
  }

  const allowed = ["expected_case_version_id", "expected_record_version"] as const;
  if (Object.keys(value).some((key) => !allowed.includes(key as never))) {
    throw new CapaRootCauseReviewAdvisoryRequestValidationError("UNSUPPORTED_ADVISORY_INPUT_FIELD");
  }

  if (
    Object.keys(value).length !== allowed.length ||
    typeof value.expected_case_version_id !== "string" ||
    !UUID_PATTERN.test(value.expected_case_version_id) ||
    typeof value.expected_record_version !== "number" ||
    !Number.isSafeInteger(value.expected_record_version) ||
    value.expected_record_version < 1
  ) {
    throw new CapaRootCauseReviewAdvisoryRequestValidationError("INVALID_ADVISORY_INPUT");
  }

  return Object.freeze({
    expected_case_version_id: value.expected_case_version_id as CapaCaseVersionId,
    expected_record_version: value.expected_record_version,
  });
}

function serviceError(
  traceValue: { readonly correlation_id: CorrelationId },
  error: CapaRootCauseReviewAdvisoryServiceError,
): Response | null {
  switch (error.reason_code) {
    case "CASE_NOT_FOUND_OR_NOT_AUTHORIZED":
      return errorResponse(traceValue, 404, "CAPA_ADVISORY_CASE_NOT_FOUND", "The CAPA case was not found.");
    case "CASE_NOT_IN_ROOT_CAUSE_REVIEW":
      return errorResponse(traceValue, 409, "CAPA_ADVISORY_CASE_STATE_CONFLICT", "The CAPA case is not in the required state for root-cause review advisory.");
    case "ADVISORY_ACCESS_DENIED":
      return errorResponse(traceValue, 403, "CAPA_ADVISORY_ACCESS_DENIED", "The CAPA root-cause review advisory operation is not authorized.");
    case "AGENT_NOT_ELIGIBLE":
      return errorResponse(traceValue, 409, "CAPA_ADVISORY_AGENT_NOT_ELIGIBLE", "The governed root-cause review advisory is not available for the current CAPA state.");
    case "WORKFLOW_MUTATION_DETECTED":
      return errorResponse(traceValue, 409, "CAPA_ADVISORY_CASE_CHANGED", "The CAPA case changed while the advisory was being generated.");
    case "ADVISORY_GENERATION_FAILED":
    case "INVALID_ADVISORY_RESULT":
    case "ADVISORY_PERSISTENCE_FAILED":
      return null;
  }
}

export async function handleCapaRootCauseReviewAdvisoryPost(
  request: Request,
  caseId: string,
  dependencies: CapaRootCauseReviewAdvisoryApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);

  try {
    const session = await dependencies.get_session_facts();
    if (session === null) return errorResponse(requestTrace, 401, "UNAUTHORIZED", "Authentication is required.");

    const context = await dependencies.resolve_context(session, dependencies.now());
    const normalizedCaseId = uuid(caseId);
    if (normalizedCaseId === null || normalizedCaseId !== caseId) {
      return errorResponse(requestTrace, 400, "INVALID_CAPA_CASE_ID", "A valid CAPA case identifier is required.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(requestTrace, 400, "INVALID_CAPA_ADVISORY_REQUEST", "The CAPA root-cause review advisory request is invalid.");
    }

    const advisoryRequest = validateRequest(body);
    const result = await dependencies.create_advisory_service(context).execute({
      organization_id: context.tenant.organization_id,
      capa_case_id: normalizedCaseId as CapaCaseId,
      user_id: context.owner_user_id,
      request_id: requestTrace.request_id,
      correlation_id: requestTrace.correlation_id,
      request: advisoryRequest,
    });

    return response({ advisory: result.advisory, snapshot: result.snapshot, correlation_id: requestTrace.correlation_id }, 201);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) return errorResponse(requestTrace, 401, "INVALID_SESSION_CONTEXT", "The authenticated session is not valid for this request.");
    if (error instanceof SupabaseCapaTenantAccessError) return errorResponse(requestTrace, 403, "CAPA_TENANT_ACCESS_DENIED", "The authenticated user is not authorized to access a CAPA organization.");
    if (error instanceof CapaRootCauseReviewAdvisoryRequestValidationError) return errorResponse(requestTrace, 400, "INVALID_CAPA_ADVISORY_REQUEST", "The CAPA root-cause review advisory request is invalid.");
    if (error instanceof CapaRootCauseReviewAdvisoryServiceError) {
      const mapped = serviceError(requestTrace, error);
      if (mapped !== null) return mapped;
    }

    dependencies.logger.error("CAPA API root-cause review advisory failed.", {
      correlation_id: requestTrace.correlation_id,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(requestTrace, 500, "CAPA_INTERNAL_ERROR", "The CAPA request could not be completed.");
  }
}
