import type { CorrelationId, IdempotencyKey, RequestId, RequestTrace } from "../capa/domain/capa-types";
import type { CapaRequestContext, SupabaseCapaContextResolver, SupabaseCapaSessionFacts } from "../security/supabase-capa-context";
import type { QualityDataXlsxApiRateLimiter } from "./quality-data-xlsx-api";
import type { QualityDataPilotGate } from "./quality-data-pilot-gate";
import { isQualityDataPilotOrganizationAllowed } from "./quality-data-pilot-gate";
import type { QualityDataStage3AServiceDependencies } from "./quality-data-stage3a-service";
import { analyzeQualityDatasetVersion, getQualityDataDatasetVersionApproval, QualityDataStage3AServiceError, transitionQualityDataDatasetVersionApproval } from "./quality-data-stage3a-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JSON_BYTES = 32 * 1024;
const JSON_READ_TIMEOUT_MS = 5_000;

export interface QualityDataStage3AApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly get_service_dependencies: () => QualityDataStage3AServiceDependencies | null;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly configured_app_url?: string;
  readonly pilot_gate?: QualityDataPilotGate;
  readonly rate_limiter: QualityDataXlsxApiRateLimiter;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function error(code: string, message: string, status: number, correlationId?: string): Response {
  return json({ error: { code, message, ...(correlationId ? { correlation_id: correlationId } : {}) } }, status);
}

function sameOrigin(request: Request, configuredAppUrl?: string): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader === "null" || request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (originHeader === "capacitor://localhost") return true;
  let origin: URL;
  try { origin = new URL(originHeader); } catch { return false; }
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password || origin.origin !== originHeader) return false;
  try {
    const expected = configuredAppUrl ? new URL(configuredAppUrl).origin : new URL(request.url).origin;
    return origin.origin === expected;
  } catch { return false; }
}

function sameOriginRead(request: Request, configuredAppUrl?: string): boolean {
  const originHeader = request.headers.get("origin");
  if (originHeader !== null) return sameOrigin(request, configuredAppUrl);
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function trace(request: Request, generateUuid: () => string): RequestTrace {
  const requestId = request.headers.get("x-request-id")?.trim() ?? "";
  const correlationId = request.headers.get("x-correlation-id")?.trim() ?? "";
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  return {
    request_id: (UUID_PATTERN.test(requestId) ? requestId : generateUuid()) as RequestId,
    correlation_id: (UUID_PATTERN.test(correlationId) ? correlationId : generateUuid()) as CorrelationId,
    ...(key.length > 0 && key.length <= 200 ? { idempotency_key: key as IdempotencyKey } : {}),
  };
}

async function boundedJson(request: Request): Promise<unknown | "invalid" | "too_large" | "timeout"> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_JSON_BYTES)) return "too_large";
  if (!request.body) return "invalid";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async (): Promise<Uint8Array | "too_large" | "invalid"> => {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_JSON_BYTES) return "too_large";
        chunks.push(part.value);
      }
      if (total === 0) return "invalid";
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    };
    const timed = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), JSON_READ_TIMEOUT_MS); });
    const value = await Promise.race([read(), timed]);
    if (typeof value === "string") return value;
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)) as unknown; } catch { return "invalid"; }
  } catch { return "invalid"; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function authenticated(dependencies: QualityDataStage3AApiDependencies): Promise<{ context: CapaRequestContext; user_id: string } | Response> {
  let facts: SupabaseCapaSessionFacts | null;
  try { facts = await dependencies.get_session_facts(); } catch { return error("unauthorized", "Sign in to continue.", 401); }
  if (!facts) return error("unauthorized", "Sign in to continue.", 401);
  try { return { context: await dependencies.resolve_context(facts, dependencies.now()), user_id: facts.verified_user_id }; }
  catch { return error("quality_data_forbidden", "You are not authorized for this quality-data operation.", 403); }
}

async function allowedDependencies(
  dependencies: QualityDataStage3AApiDependencies,
  userId: string,
  context: CapaRequestContext,
  action: "approval" | "analysis",
  correlationId: string,
): Promise<QualityDataStage3AServiceDependencies | Response> {
  if (!isQualityDataPilotOrganizationAllowed(dependencies.pilot_gate, context.tenant.organization_id)) {
    return error("quality_data_unavailable", "Quality-data analysis is not available for this organization.", 404, correlationId);
  }
  let service: QualityDataStage3AServiceDependencies | null;
  try { service = dependencies.get_service_dependencies(); } catch { return error("service_unavailable", "Quality-data analysis is not available.", 503, correlationId); }
  if (!service) return error("service_unavailable", "Quality-data analysis is not available.", 503, correlationId);
  try {
    const authorization = action === "approval"
      ? await service.authorizer.authorizeApproval(context, dependencies.now())
      : await service.authorizer.authorizeRead(context, dependencies.now());
    if (!authorization.allowed) return error("quality_data_forbidden", "You are not authorized for this quality-data operation.", 403, correlationId);
  } catch {
    return error("quality_data_forbidden", "You are not authorized for this quality-data operation.", 403, correlationId);
  }
  let limit: Awaited<ReturnType<QualityDataXlsxApiRateLimiter["consume"]>>;
  try { limit = await dependencies.rate_limiter.consume(userId, action, dependencies.now().getTime()); }
  catch { limit = "unavailable"; }
  if (limit === "unavailable") return error("service_unavailable", "Quality-data analysis is not available.", 503, correlationId);
  if (limit === "limited") return error("rate_limited", "Please wait before making another quality-data request.", 429, correlationId);
  return service;
}

export async function handleQualityDataVersionApprovalPost(
  request: Request,
  datasetVersionId: string,
  dependencies: QualityDataStage3AApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);
  const correlationId = requestTrace.correlation_id;
  if (!UUID_PATTERN.test(datasetVersionId)) return error("invalid_request", "The dataset version identifier is invalid.", 400, correlationId);
  if (!sameOrigin(request, dependencies.configured_app_url)) return error("origin_denied", "The request origin is not allowed.", 403, correlationId);
  const auth = await authenticated(dependencies);
  if (auth instanceof Response) return auth;
  const service = await allowedDependencies(dependencies, auth.user_id, auth.context, "approval", correlationId);
  if (service instanceof Response) return service;
  const body = await boundedJson(request);
  if (body === "too_large") return error("request_too_large", "The approval request is too large.", 413, correlationId);
  if (body === "timeout") return error("request_timeout", "The approval request took too long.", 408, correlationId);
  if (body === "invalid" || typeof body !== "object" || body === null || Array.isArray(body)
    || (body as Record<string, unknown>).dataset_version_id !== datasetVersionId) {
    return error("invalid_request", "The approval request is invalid.", 400, correlationId);
  }
  try {
    const result = await transitionQualityDataDatasetVersionApproval(service, auth.context, requestTrace, body);
    if (result.status === "denied") return error("quality_data_forbidden", "You are not authorized to approve this dataset version.", 403, correlationId);
    if (result.status === "not_found_or_not_authorized") return error("not_found", "The dataset version was not found.", 404, correlationId);
    if (result.status === "invalid_request") return error("invalid_request", "The approval request is invalid.", 400, correlationId);
    if (result.status === "conflict") return error("approval_conflict", "The approval state changed. Refresh the version history before continuing.", 409, correlationId);
    return json({ status: result.status, approval: result.approval }, result.status === "applied" ? 201 : 200);
  } catch (cause) {
    if (cause instanceof QualityDataStage3AServiceError) return error("approval_failed", "The dataset approval could not be recorded.", 500, correlationId);
    return error("approval_failed", "The dataset approval could not be recorded.", 500, correlationId);
  }
}

export async function handleQualityDataVersionApprovalGet(
  request: Request,
  datasetVersionId: string,
  dependencies: QualityDataStage3AApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);
  const correlationId = requestTrace.correlation_id;
  if (!UUID_PATTERN.test(datasetVersionId)) return error("invalid_request", "The dataset version identifier is invalid.", 400, correlationId);
  if (!sameOriginRead(request, dependencies.configured_app_url)) return error("origin_denied", "The request origin is not allowed.", 403, correlationId);
  const auth = await authenticated(dependencies);
  if (auth instanceof Response) return auth;
  const service = await allowedDependencies(dependencies, auth.user_id, auth.context, "approval", correlationId);
  if (service instanceof Response) return service;
  try {
    const result = await getQualityDataDatasetVersionApproval(service, auth.context, datasetVersionId);
    if (result.status === "denied") return error("quality_data_forbidden", "You are not authorized to view this dataset version's approval state.", 403, correlationId);
    if (result.status === "not_found_or_not_authorized") return error("not_found", "The dataset version was not found.", 404, correlationId);
    if (result.status === "invalid_request") return error("invalid_request", "The approval request is invalid.", 400, correlationId);
    return json({ status: "found", approval: result.summary });
  } catch {
    return error("approval_unavailable", "The dataset approval state is unavailable.", 503, correlationId);
  }
}

export async function handleQualityDataAnalysisPost(
  request: Request,
  dependencies: QualityDataStage3AApiDependencies,
): Promise<Response> {
  const requestTrace = trace(request, dependencies.generate_uuid);
  const correlationId = requestTrace.correlation_id;
  if (!sameOrigin(request, dependencies.configured_app_url)) return error("origin_denied", "The request origin is not allowed.", 403, correlationId);
  const auth = await authenticated(dependencies);
  if (auth instanceof Response) return auth;
  const service = await allowedDependencies(dependencies, auth.user_id, auth.context, "analysis", correlationId);
  if (service instanceof Response) return service;
  const body = await boundedJson(request);
  if (body === "too_large") return error("request_too_large", "The analysis request is too large.", 413, correlationId);
  if (body === "timeout") return error("request_timeout", "The analysis request took too long.", 408, correlationId);
  if (body === "invalid") return error("invalid_request", "The analysis request is invalid.", 400, correlationId);
  try {
    const result = await analyzeQualityDatasetVersion(service, auth.context, body);
    if (result.status === "denied") return error("quality_data_forbidden", "You are not authorized to analyze this dataset version.", 403, correlationId);
    if (result.status === "not_found_or_not_authorized") return error("not_found", "The dataset version was not found.", 404, correlationId);
    if (result.status === "not_approved") return error("dataset_not_approved", "This dataset version is not approved for analytical use.", 409, correlationId);
    if (result.status === "invalid_request") return error(result.reason_code === "RESULT_LIMIT_EXCEEDED" ? "result_too_large" : "invalid_request", "The analysis request could not be completed.", result.reason_code === "RESULT_LIMIT_EXCEEDED" ? 413 : 400, correlationId);
    if (result.status === "calculation_error") return error("analysis_failed", "The approved dataset could not be analyzed safely.", 422, correlationId);
    return json({ status: result.status, result: result.result });
  } catch {
    return error("analysis_failed", "The approved dataset could not be analyzed safely.", 500, correlationId);
  }
}
