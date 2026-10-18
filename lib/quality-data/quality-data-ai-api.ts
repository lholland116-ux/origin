import type { RequestTrace } from "../capa/domain/capa-types";
import type { CapaRequestContext, SupabaseCapaContextResolver, SupabaseCapaSessionFacts } from "../security/supabase-capa-context";
import type { QualityDataXlsxApiRateLimiter } from "./quality-data-xlsx-api";
import type { QualityDataAiGate } from "./quality-data-ai-gate";
import { isQualityDataAiOrganizationAllowed } from "./quality-data-ai-gate";
import type { QualityDataAiInterpretationDependencies } from "./quality-data-ai-service";
import type { QualityDataPilotGate } from "./quality-data-pilot-gate";
import { isQualityDataPilotOrganizationAllowed } from "./quality-data-pilot-gate";
import { getQualityDataExternalAiOptIn, transitionQualityDataExternalAiOptIn } from "./quality-data-external-ai-opt-in-service";
import { interpretQualityDataAnalysis } from "./quality-data-ai-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 32 * 1024;
const BODY_TIMEOUT_MS = 5_000;

export interface QualityDataAiApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly get_ai_dependencies: () => QualityDataAiInterpretationDependencies | null;
  readonly get_control_dependencies: () => import("./quality-data-stage3a-service").QualityDataStage3AServiceDependencies | null;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly configured_app_url?: string;
  readonly quality_data_pilot_gate?: QualityDataPilotGate;
  readonly ai_gate?: QualityDataAiGate;
  readonly rate_limiter: QualityDataXlsxApiRateLimiter;
}

function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "cache-control": "no-store" } }); }
function error(code: string, message: string, status: number, correlation?: string): Response { return json({ error: { code, message, ...(correlation ? { correlation_id: correlation } : {}) } }, status); }

function sameOrigin(request: Request, appUrl?: string, read = false): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return read && request.headers.get("sec-fetch-site") === "same-origin";
  if (origin === "null" || request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (origin === "capacitor://localhost") return true;
  try {
    const parsed = new URL(origin);
    const expected = appUrl ? new URL(appUrl).origin : new URL(request.url).origin;
    return parsed.origin === origin && parsed.pathname === "/" && !parsed.search && !parsed.hash && !parsed.username && !parsed.password && parsed.origin === expected;
  } catch { return false; }
}

function requestTrace(request: Request, generate: () => string): RequestTrace {
  const requestId = request.headers.get("x-request-id")?.trim() ?? "";
  const correlation = request.headers.get("x-correlation-id")?.trim() ?? "";
  const idempotency = request.headers.get("idempotency-key")?.trim() ?? "";
  return { request_id: (UUID.test(requestId) ? requestId : generate()) as RequestTrace["request_id"],
    correlation_id: (UUID.test(correlation) ? correlation : generate()) as RequestTrace["correlation_id"],
    ...(idempotency.length > 0 && idempotency.length <= 200 ? { idempotency_key: idempotency as NonNullable<RequestTrace["idempotency_key"]> } : {}) };
}

async function readJson(request: Request): Promise<unknown | "invalid" | "too_large" | "timeout"> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return "too_large";
  if (!request.body) return "invalid";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const consume = async (): Promise<Uint8Array | "invalid" | "too_large"> => {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > MAX_BODY_BYTES) return "too_large";
        chunks.push(item.value);
      }
      if (size === 0) return "invalid";
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    };
    const outcome = await Promise.race([consume(), new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), BODY_TIMEOUT_MS); })]);
    if (typeof outcome === "string") return outcome;
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(outcome)) as unknown; } catch { return "invalid"; }
  } catch { return "invalid"; }
  finally { if (timer !== undefined) clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

async function auth(dependencies: QualityDataAiApiDependencies): Promise<{ readonly context: CapaRequestContext; readonly user_id: string } | Response> {
  let facts: SupabaseCapaSessionFacts | null;
  try { facts = await dependencies.get_session_facts(); } catch { return error("unauthorized", "Sign in to continue.", 401); }
  if (!facts) return error("unauthorized", "Sign in to continue.", 401);
  try { return { context: await dependencies.resolve_context(facts, dependencies.now()), user_id: facts.verified_user_id }; }
  catch { return error("quality_data_forbidden", "You are not authorized for this operation.", 403); }
}

function pilotAllowed(context: CapaRequestContext, dependencies: QualityDataAiApiDependencies, correlation: string): Response | null {
  if (!isQualityDataPilotOrganizationAllowed(dependencies.quality_data_pilot_gate, context.tenant.organization_id)) return error("quality_data_unavailable", "Quality-data analysis is not available for this organization.", 404, correlation);
  return null;
}

function mapOptInResult(result: Awaited<ReturnType<typeof getQualityDataExternalAiOptIn>>, correlation: string): Response {
  if (result.status === "denied") return error("quality_data_forbidden", "You are not authorized to manage external AI transfer for this organization.", 403, correlation);
  if (result.status === "invalid_request") return error("invalid_request", "The request is invalid.", 400, correlation);
  if (result.status === "conflict") return error("opt_in_conflict", "The transfer authorization changed. Refresh its history before continuing.", 409, correlation);
  if (result.status === "unavailable") return error("service_unavailable", "External AI transfer controls are unavailable.", 503, correlation);
  return json({ status: result.status, opt_in: result.state });
}

export async function handleQualityDataExternalAiOptInGet(request: Request, dependencies: QualityDataAiApiDependencies): Promise<Response> {
  const trace = requestTrace(request, dependencies.generate_uuid);
  if (!sameOrigin(request, dependencies.configured_app_url, true)) return error("origin_denied", "The request origin is not allowed.", 403, trace.correlation_id);
  const authenticated = await auth(dependencies);
  if (authenticated instanceof Response) return authenticated;
  const blocked = pilotAllowed(authenticated.context, dependencies, trace.correlation_id);
  if (blocked) return blocked;
  let service;
  try { service = dependencies.get_control_dependencies(); } catch { return error("service_unavailable", "External AI transfer controls are unavailable.", 503, trace.correlation_id); }
  if (!service) return error("service_unavailable", "External AI transfer controls are unavailable.", 503, trace.correlation_id);
  const limit = await Promise.resolve(dependencies.rate_limiter.consume(authenticated.user_id, "external_ai_opt_in", dependencies.now().getTime())).catch(() => "unavailable" as const);
  if (limit === "unavailable") return error("service_unavailable", "External AI transfer controls are unavailable.", 503, trace.correlation_id);
  if (limit === "limited") return error("rate_limited", "Please wait before changing transfer controls.", 429, trace.correlation_id);
  return mapOptInResult(await getQualityDataExternalAiOptIn(service, authenticated.context), trace.correlation_id);
}

export async function handleQualityDataExternalAiOptInPost(request: Request, dependencies: QualityDataAiApiDependencies): Promise<Response> {
  const trace = requestTrace(request, dependencies.generate_uuid);
  if (!sameOrigin(request, dependencies.configured_app_url)) return error("origin_denied", "The request origin is not allowed.", 403, trace.correlation_id);
  const authenticated = await auth(dependencies);
  if (authenticated instanceof Response) return authenticated;
  const blocked = pilotAllowed(authenticated.context, dependencies, trace.correlation_id);
  if (blocked) return blocked;
  let service;
  try { service = dependencies.get_control_dependencies(); } catch { return error("service_unavailable", "External AI transfer controls are unavailable.", 503, trace.correlation_id); }
  if (!service) return error("service_unavailable", "External AI transfer controls are unavailable.", 503, trace.correlation_id);
  const limit = await Promise.resolve(dependencies.rate_limiter.consume(authenticated.user_id, "external_ai_opt_in", dependencies.now().getTime())).catch(() => "unavailable" as const);
  if (limit === "unavailable") return error("service_unavailable", "External AI transfer controls are unavailable.", 503, trace.correlation_id);
  if (limit === "limited") return error("rate_limited", "Please wait before changing transfer controls.", 429, trace.correlation_id);
  const body = await readJson(request);
  if (body === "too_large") return error("request_too_large", "The request is too large.", 413, trace.correlation_id);
  if (body === "timeout") return error("request_timeout", "The request took too long.", 408, trace.correlation_id);
  if (body === "invalid") return error("invalid_request", "The request is invalid.", 400, trace.correlation_id);
  const result = await transitionQualityDataExternalAiOptIn(service, authenticated.context, trace, body);
  if (result.status === "conflict") return error("opt_in_conflict", "The transfer authorization changed. Refresh its history before continuing.", 409, trace.correlation_id);
  if (result.status === "applied" || result.status === "already_recorded") return json({ status: result.status, opt_in: result.state }, result.status === "applied" ? 201 : 200);
  return mapOptInResult(result, trace.correlation_id);
}

export async function handleQualityDataAiInterpretationPost(request: Request, dependencies: QualityDataAiApiDependencies): Promise<Response> {
  const trace = requestTrace(request, dependencies.generate_uuid);
  if (!sameOrigin(request, dependencies.configured_app_url)) return error("origin_denied", "The request origin is not allowed.", 403, trace.correlation_id);
  const authenticated = await auth(dependencies);
  if (authenticated instanceof Response) return authenticated;
  const blocked = pilotAllowed(authenticated.context, dependencies, trace.correlation_id);
  if (blocked) return blocked;
  if (!isQualityDataAiOrganizationAllowed(dependencies.ai_gate, authenticated.context.tenant.organization_id)) return error("quality_data_ai_unavailable", "External AI analysis is not enabled for this organization.", 404, trace.correlation_id);
  const limit = await Promise.resolve(dependencies.rate_limiter.consume(authenticated.user_id, "ai_interpretation", dependencies.now().getTime())).catch(() => "unavailable" as const);
  if (limit === "unavailable") return error("service_unavailable", "Quality-data AI analysis is unavailable.", 503, trace.correlation_id);
  if (limit === "limited") return error("rate_limited", "Please wait before requesting another interpretation.", 429, trace.correlation_id);
  const body = await readJson(request);
  if (body === "too_large") return error("request_too_large", "The analysis request is too large.", 413, trace.correlation_id);
  if (body === "timeout") return error("request_timeout", "The analysis request took too long.", 408, trace.correlation_id);
  if (body === "invalid") return error("invalid_request", "The analysis request is invalid.", 400, trace.correlation_id);
  let service: QualityDataAiInterpretationDependencies | null;
  try { service = dependencies.get_ai_dependencies(); } catch { return error("service_unavailable", "Quality-data AI analysis is unavailable.", 503, trace.correlation_id); }
  if (!service) return error("service_unavailable", "Quality-data AI analysis is unavailable.", 503, trace.correlation_id);
  const result = await interpretQualityDataAnalysis(service, authenticated.context, trace, body);
  switch (result.status) {
    case "complete": return json(result);
    case "denied": return error("quality_data_forbidden", "You are not authorized for external AI analysis.", 403, trace.correlation_id);
    case "not_found_or_not_authorized": return error("not_found", "The approved dataset version was not found.", 404, trace.correlation_id);
    case "not_approved": return error("dataset_not_approved", "The dataset version is not currently approved for analytical use.", 409, trace.correlation_id);
    case "invalid_request": return error("invalid_request", "The analysis request is invalid.", 400, trace.correlation_id);
    case "evidence_invalid": return error("evidence_unavailable", "Evidence could not be prepared safely.", 422, trace.correlation_id);
    case "provider_error": return error("provider_unavailable", "The interpretation could not be generated.", 503, trace.correlation_id);
    case "invalid_model_output": return error("provider_output_rejected", "The interpretation could not be validated.", 502, trace.correlation_id);
    case "cost_unavailable": return error("cost_limit_unavailable", "A safe provider cost estimate is unavailable.", 503, trace.correlation_id);
    case "rate_limit_required": return error("rate_limited", "Please wait before requesting another interpretation.", 429, trace.correlation_id);
    default: return error("service_unavailable", "Quality-data AI analysis is unavailable.", 503, trace.correlation_id);
  }
}
