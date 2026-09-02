import type {
  CapaCaseId,
  CorrelationId,
  RequestId,
} from "../domain/capa-types";

import {
  CapaContainmentRiskAdvisoryServiceError,
  type CapaContainmentRiskAdvisoryService,
} from "../ai/capa-containment-risk-advisory-service";

import {
  CapaContainmentRiskAdvisoryValidationError,
  validateCapaContainmentRiskAdvisoryBrowserRequest,
} from "../ai/capa-containment-risk-advisory-validator";

import type { CapaApiLogger } from "./capa-route-handler";

import {
  SupabaseCapaContextError,
  type CapaRequestContext,
  type SupabaseCapaContextResolver,
  type SupabaseCapaSessionFacts,
} from "../../security/supabase-capa-context";

import { SupabaseCapaTenantAccessError } from "../../security/supabase-capa-durable-context";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CapaContainmentRiskAdvisoryApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly create_advisory_service: (
    context: CapaRequestContext,
  ) => CapaContainmentRiskAdvisoryService;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function normalizedUuid(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function traceIdentifier(value: string | null, generateUuid: () => string): string {
  return normalizedUuid(value) ?? generateUuid();
}

function requestTrace(
  request: Request,
  generateUuid: () => string,
): { readonly request_id: RequestId; readonly correlation_id: CorrelationId } {
  return {
    request_id: traceIdentifier(request.headers.get("x-request-id"), generateUuid) as RequestId,
    correlation_id: traceIdentifier(request.headers.get("x-correlation-id"), generateUuid) as CorrelationId,
  };
}

function errorResponse(
  trace: { readonly correlation_id: CorrelationId },
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse({ error: { code, message, correlation_id: trace.correlation_id } }, status);
}

async function parsedBody(request: Request): Promise<
  | { readonly valid: true; readonly value: unknown }
  | { readonly valid: false }
> {
  try {
    return { valid: true, value: await request.json() };
  } catch {
    return { valid: false };
  }
}

function serviceErrorResponse(
  trace: { readonly correlation_id: CorrelationId },
  error: CapaContainmentRiskAdvisoryServiceError,
): Response | null {
  switch (error.reason_code) {
    case "CASE_NOT_FOUND_OR_NOT_AUTHORIZED":
      return errorResponse(trace, 404, "CAPA_ADVISORY_CASE_NOT_FOUND", "The CAPA case was not found.");
    case "CASE_NOT_IN_CONTAINMENT_RISK":
      return errorResponse(trace, 409, "CAPA_ADVISORY_CASE_STATE_CONFLICT", "The CAPA case is not in the required state for containment/risk advisory.");
    case "ADVISORY_ACCESS_DENIED":
      return errorResponse(trace, 403, "CAPA_ADVISORY_ACCESS_DENIED", "The CAPA containment/risk advisory operation is not authorized.");
    case "AGENT_NOT_ELIGIBLE":
      return errorResponse(trace, 409, "CAPA_ADVISORY_AGENT_NOT_ELIGIBLE", "The governed containment/risk advisory is not available for the current CAPA state.");
    case "WORKFLOW_MUTATION_DETECTED":
      return errorResponse(trace, 409, "CAPA_ADVISORY_CASE_CHANGED", "The CAPA case changed while the advisory was being generated.");
    case "ADVISORY_GENERATION_FAILED":
    case "INVALID_ADVISORY_RESULT":
    case "ADVISORY_PERSISTENCE_FAILED":
      return null;
  }
}

export async function handleCapaContainmentRiskAdvisoryPost(
  request: Request,
  caseId: string,
  dependencies: CapaContainmentRiskAdvisoryApiDependencies,
): Promise<Response> {
  const trace = requestTrace(request, dependencies.generate_uuid);

  try {
    const sessionFacts = await dependencies.get_session_facts();
    if (sessionFacts === null) {
      return errorResponse(trace, 401, "UNAUTHORIZED", "Authentication is required.");
    }

    const context = await dependencies.resolve_context(sessionFacts, dependencies.now());

    const normalizedCaseId = normalizedUuid(caseId);
    if (normalizedCaseId === null || normalizedCaseId !== caseId) {
      return errorResponse(trace, 400, "INVALID_CAPA_CASE_ID", "A valid CAPA case identifier is required.");
    }

    const body = await parsedBody(request);
    if (!body.valid) {
      return errorResponse(trace, 400, "INVALID_CAPA_ADVISORY_REQUEST", "The CAPA containment/risk advisory request is invalid.");
    }

    const advisoryRequest = validateCapaContainmentRiskAdvisoryBrowserRequest(body.value);
    const advisoryService = dependencies.create_advisory_service(context);
    const result = await advisoryService.execute({
      organization_id: context.tenant.organization_id,
      capa_case_id: normalizedCaseId as CapaCaseId,
      user_id: context.owner_user_id,
      request_id: trace.request_id,
      correlation_id: trace.correlation_id,
      request: advisoryRequest,
    });

    return jsonResponse({ advisory: result.advisory, snapshot: result.snapshot, correlation_id: trace.correlation_id }, 201);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) {
      return errorResponse(trace, 401, "INVALID_SESSION_CONTEXT", "The authenticated session is not valid for this request.");
    }
    if (error instanceof SupabaseCapaTenantAccessError) {
      return errorResponse(trace, 403, "CAPA_TENANT_ACCESS_DENIED", "The authenticated user is not authorized to access a CAPA organization.");
    }
    if (error instanceof CapaContainmentRiskAdvisoryValidationError) {
      return errorResponse(trace, 400, "INVALID_CAPA_ADVISORY_REQUEST", "The CAPA containment/risk advisory request is invalid.");
    }
    if (error instanceof CapaContainmentRiskAdvisoryServiceError) {
      const mapped = serviceErrorResponse(trace, error);
      if (mapped !== null) return mapped;
    }

    dependencies.logger.error("CAPA API containment/risk advisory failed.", {
      correlation_id: trace.correlation_id,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(trace, 500, "CAPA_INTERNAL_ERROR", "The CAPA request could not be completed.");
  }
}
