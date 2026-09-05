import type { CapaCaseId, CorrelationId, IdempotencyKey, RequestId, RequestTrace } from "../domain/capa-types";
import {
  CapaInvestigationActiveAdoptionIdempotencyConfigurationError,
  CapaInvestigationActiveAdoptionIntegrityError,
  type AdoptCapaInvestigationActiveAiProposalsResult,
} from "../application/adopt-capa-investigation-active-ai-proposals";
import type { CapaInvestigationActiveAdoptionService } from "../application/capa-investigation-active-adoption-runtime-factory";
import {
  CapaInvestigationActiveAdoptionValidationError,
  validateCapaInvestigationActiveAdoptionIntent,
} from "../ai/capa-investigation-active-adoption-validator";
import type { CapaApiLogger } from "./capa-route-handler";
import { SupabaseCapaContextError, type CapaRequestContext, type SupabaseCapaContextResolver, type SupabaseCapaSessionFacts } from "../../security/supabase-capa-context";
import { SupabaseCapaTenantAccessError } from "../../security/supabase-capa-durable-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export interface CapaInvestigationActiveAdoptionApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly create_adoption_service: (context: CapaRequestContext) => CapaInvestigationActiveAdoptionService;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly logger: CapaApiLogger;
}
function response(body: unknown, status: number): Response { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
function uuid(value: string | null): string | null { return value !== null && UUID_PATTERN.test(value) ? value : null; }
function requestTrace(request: Request, generateUuid: () => string): Pick<RequestTrace, "request_id" | "correlation_id"> { return { request_id: (uuid(request.headers.get("x-request-id")) ?? generateUuid()) as RequestId, correlation_id: (uuid(request.headers.get("x-correlation-id")) ?? generateUuid()) as CorrelationId }; }
function idempotencyKey(request: Request): IdempotencyKey | null {
  const value = request.headers.get("idempotency-key");
  return value !== null && value.length >= 1 && value.length <= MAX_IDEMPOTENCY_KEY_LENGTH && value.trim() === value ? value as IdempotencyKey : null;
}
function errorResponse(trace: { readonly correlation_id: CorrelationId }, status: number, code: string, message: string): Response { return response({ error: { code, message, correlation_id: trace.correlation_id } }, status); }
function resultResponse(trace: { readonly correlation_id: CorrelationId }, result: AdoptCapaInvestigationActiveAiProposalsResult): Response {
  if (result.status === "adopted" || result.status === "already_adopted") {
    const records = result.records.map(({ adoption }) => ({ adoption_id: adoption.adoption_id, proposal_key: adoption.proposal_key, proposal_category: adoption.proposal_category, adopted_item: adoption.adopted_item, adopted_at: adoption.adopted_at, adopted_by_user_id: adoption.adopted_by.actor_id }));
    return response({ status: result.status, records, correlation_id: trace.correlation_id }, result.status === "adopted" ? 201 : 200);
  }
  switch (result.status) {
    case "authorization_denied": return errorResponse(trace, 403, "CAPA_ADOPTION_ACCESS_DENIED", "The CAPA proposal-adoption operation is not authorized.");
    case "output_not_found_or_not_authorized": return errorResponse(trace, 404, "CAPA_ADOPTION_OUTPUT_NOT_FOUND", "The CAPA advisory output was not found.");
    case "output_not_adoptable": return errorResponse(trace, 409, "CAPA_ADOPTION_OUTPUT_NOT_ADOPTABLE", "The CAPA advisory output cannot be adopted.");
    case "concurrency_conflict": return errorResponse(trace, 409, "CAPA_ADOPTION_CASE_CHANGED", "The CAPA case changed before adoption could be completed.");
    case "idempotency_conflict": return errorResponse(trace, 409, "CAPA_ADOPTION_IDEMPOTENCY_CONFLICT", "The idempotency key was used for a different logical adoption request.");
  }
}

export async function handleCapaInvestigationActiveAdoptionPost(request: Request, caseId: string, outputId: string, dependencies: CapaInvestigationActiveAdoptionApiDependencies): Promise<Response> {
  const baseTrace = requestTrace(request, dependencies.generate_uuid);
  const key = idempotencyKey(request);
  const trace: RequestTrace = { ...baseTrace, idempotency_key: key ?? "invalid" as never };
  try {
    if (key === null) return errorResponse(trace, 400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required.");
    const session = await dependencies.get_session_facts();
    if (session === null) return errorResponse(trace, 401, "UNAUTHORIZED", "Authentication is required.");
    const context = await dependencies.resolve_context(session, dependencies.now());
    if (uuid(caseId) !== caseId) return errorResponse(trace, 400, "INVALID_CAPA_CASE_ID", "A valid CAPA case identifier is required.");
    if (uuid(outputId) !== outputId) return errorResponse(trace, 400, "INVALID_CAPA_OUTPUT_ID", "A valid CAPA output identifier is required.");
    let body: unknown;
    try { body = await request.json(); } catch { return errorResponse(trace, 400, "INVALID_CAPA_ADOPTION_REQUEST", "The CAPA proposal-adoption request is invalid."); }
    const intent = validateCapaInvestigationActiveAdoptionIntent(body);
    if (intent.output_id !== outputId) return errorResponse(trace, 400, "CAPA_ADOPTION_OUTPUT_MISMATCH", "The request output does not match the route output.");
    const result = await dependencies.create_adoption_service(context).adopt({ capa_case_id: caseId as CapaCaseId, adoption_intent: intent, request_trace: trace });
    return resultResponse(trace, result);
  } catch (error) {
    if (error instanceof SupabaseCapaContextError) return errorResponse(trace, 401, "INVALID_SESSION_CONTEXT", "The authenticated session is not valid for this request.");
    if (error instanceof SupabaseCapaTenantAccessError) return errorResponse(trace, 403, "CAPA_TENANT_ACCESS_DENIED", "The authenticated user is not authorized to access a CAPA organization.");
    if (error instanceof CapaInvestigationActiveAdoptionValidationError) return errorResponse(trace, 400, "INVALID_CAPA_ADOPTION_REQUEST", "The CAPA proposal-adoption request is invalid.");
    if (error instanceof CapaInvestigationActiveAdoptionIdempotencyConfigurationError) return errorResponse(trace, 400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required.");
    if (error instanceof CapaInvestigationActiveAdoptionIntegrityError) dependencies.logger.error("CAPA investigation-active adoption integrity failure.", { correlation_id: trace.correlation_id, error_name: error.name });
    else dependencies.logger.error("CAPA investigation-active adoption failed.", { correlation_id: trace.correlation_id, error_name: error instanceof Error ? error.name : "UnknownError" });
    return errorResponse(trace, 500, "CAPA_INTERNAL_ERROR", "The CAPA request could not be completed.");
  }
}
