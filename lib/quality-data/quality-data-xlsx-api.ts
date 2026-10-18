import { createHash } from "node:crypto";

import type { CapaRequestContext, SupabaseCapaSessionFacts, SupabaseCapaContextResolver } from "../security/supabase-capa-context";
import type { RequestId, CorrelationId, IdempotencyKey, RequestTrace } from "../capa/domain/capa-types";
import { QUALITY_DATA_MAX_SOURCE_BYTES } from "./quality-data-contract";
import { isQualityDataPilotOrganizationAllowed, type QualityDataPilotGate } from "./quality-data-pilot-gate";
import type { QualityDataXlsxIngestionDependencies } from "./xlsx-quality-data-ingestion";
import { QualityDataServiceError } from "./quality-data-service";
import { ingestQualityDataXlsx } from "./xlsx-quality-data-ingestion";
import { inspectQualityDataXlsx, parseQualityDataXlsx, qualityDataXlsxMappingSchema } from "./xlsx-quality-data-parser";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MULTIPART_BYTES = QUALITY_DATA_MAX_SOURCE_BYTES + 64 * 1024;
const MAX_MAPPING_JSON_BYTES = 24 * 1024;
const BODY_READ_TIMEOUT_MS = 20_000;
const RATE_WINDOW_MS = 10 * 60 * 1_000;
const MAX_RATE_ENTRIES = 4_096;

export type QualityDataXlsxApiAction = "inspect" | "preview" | "ingest" | "analysis" | "approval";
export type QualityDataXlsxApiRateLimitResult = "allowed" | "limited" | "unavailable";
export type QualityDataXlsxApiParseSlotResult =
  | { readonly release: () => void | Promise<void> }
  | "busy"
  | "unavailable";

export interface QualityDataXlsxApiRateLimiter {
  consume(userId: string, action: QualityDataXlsxApiAction, nowMs: number): QualityDataXlsxApiRateLimitResult | Promise<QualityDataXlsxApiRateLimitResult>;
  acquireParseSlot(userId: string): QualityDataXlsxApiParseSlotResult | Promise<QualityDataXlsxApiParseSlotResult>;
}

/** Local fallback and per-process resource cap; request-rate enforcement is shared by the production PostgreSQL RPC. */
export class InMemoryQualityDataXlsxApiRateLimiter implements QualityDataXlsxApiRateLimiter {
  private readonly entries = new Map<string, { startedAt: number; count: number }>();
  private activeParses = 0;

  consume(userId: string, action: QualityDataXlsxApiAction, nowMs: number): QualityDataXlsxApiRateLimitResult {
    for (const [key, value] of this.entries) {
      if (nowMs - value.startedAt >= RATE_WINDOW_MS) this.entries.delete(key);
    }
    const key = `${userId}:${action}`;
    const limits: Record<QualityDataXlsxApiAction, number> = { inspect: 12, preview: 12, ingest: 5, analysis: 12, approval: 12 };
    const current = this.entries.get(key);
    if (current && current.count >= limits[action]) return "limited";
    if (!current && this.entries.size >= MAX_RATE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, current
      ? { ...current, count: current.count + 1 }
      : { startedAt: nowMs, count: 1 });
    return "allowed";
  }

  acquireParseSlot(): QualityDataXlsxApiParseSlotResult {
    if (this.activeParses >= 2) return "busy";
    this.activeParses += 1;
    let released = false;
    return { release: () => {
        if (released) return;
        released = true;
        this.activeParses = Math.max(0, this.activeParses - 1);
      } };
  }
}

export interface QualityDataXlsxApiDependencies {
  readonly get_session_facts: () => Promise<SupabaseCapaSessionFacts | null>;
  readonly resolve_context: SupabaseCapaContextResolver;
  readonly get_ingestion_dependencies: () => QualityDataXlsxIngestionDependencies | null;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly rate_limiter: QualityDataXlsxApiRateLimiter;
  readonly pilot_gate?: QualityDataPilotGate;
  readonly configured_app_url?: string;
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
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(originHeader); } catch { return false; }
  if (parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash || parsedOrigin.username || parsedOrigin.password
    || parsedOrigin.origin !== originHeader) return false;
  let allowedOrigin: string;
  try { allowedOrigin = configuredAppUrl ? new URL(configuredAppUrl).origin : new URL(request.url).origin; } catch { return false; }
  return parsedOrigin.origin === allowedOrigin;
}

function requestTrace(request: Request, generateUuid: () => string): RequestTrace {
  const requestId = request.headers.get("x-request-id")?.trim() ?? "";
  const correlationId = request.headers.get("x-correlation-id")?.trim() ?? "";
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  return {
    request_id: (UUID_PATTERN.test(requestId) ? requestId : generateUuid()) as RequestId,
    correlation_id: (UUID_PATTERN.test(correlationId) ? correlationId : generateUuid()) as CorrelationId,
    ...(idempotencyKey.length === 0 ? {} : { idempotency_key: idempotencyKey as IdempotencyKey }),
  };
}

async function readBoundedBody(request: Request): Promise<Uint8Array | "too_large" | "invalid" | "timeout"> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MULTIPART_BYTES)) return "too_large";
  if (!request.body) return "invalid";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const consume = async (): Promise<Uint8Array | "too_large" | "invalid"> => {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        total += item.value.byteLength;
        if (total > MAX_MULTIPART_BYTES) return "too_large";
        chunks.push(item.value);
      }
      if (total === 0) return "invalid";
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return body;
    };
    const timed = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), BODY_READ_TIMEOUT_MS);
    });
    return await Promise.race([consume(), timed]);
  } catch {
    return "invalid";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function parseMultipart(request: Request): Promise<FormData | null | "too_large" | "timeout"> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) return null;
  const body = await readBoundedBody(request);
  if (body === "too_large" || body === "timeout") return body;
  if (body === "invalid") return null;
  try {
    const buffered = new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    });
    return await buffered.formData();
  } catch {
    return null;
  }
}

function formFields(form: FormData, expected: readonly string[]): boolean {
  const names = [...form.keys()].sort();
  const sortedExpected = [...expected].sort();
  return names.length === expected.length && names.every((name, index) => name === sortedExpected[index]);
}

function formString(form: FormData, name: string, maxBytes: number): string | null {
  const value = form.get(name);
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) return null;
  return value;
}

function fileFrom(form: FormData): File | null {
  const value = form.get("file");
  if (!(value instanceof File) || !value.name.toLowerCase().endsWith(".xlsx")
    || value.size === 0 || value.size > QUALITY_DATA_MAX_SOURCE_BYTES) return null;
  return value;
}

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function mappingFrom(form: FormData): unknown | null {
  const raw = formString(form, "mapping", MAX_MAPPING_JSON_BYTES);
  if (raw === null) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

function diagnosticsResponse(result: { readonly diagnostics: readonly unknown[]; readonly diagnostics_truncated?: boolean }): Response {
  return json({ status: "invalid", diagnostics: result.diagnostics, diagnostics_truncated: result.diagnostics_truncated ?? false }, 422);
}

async function authenticated(
  dependencies: QualityDataXlsxApiDependencies,
): Promise<{ readonly context: CapaRequestContext; readonly userId: string } | Response> {
  let facts: SupabaseCapaSessionFacts | null;
  try { facts = await dependencies.get_session_facts(); } catch { return error("unauthorized", "Sign in to continue.", 401); }
  if (!facts) return error("unauthorized", "Sign in to continue.", 401);
  try {
    const context = await dependencies.resolve_context(facts, dependencies.now());
    return { context, userId: facts.verified_user_id };
  } catch {
    return error("quality_data_forbidden", "You are not authorized to ingest quality data for an organization.", 403);
  }
}

/** Authenticated and tenant-scoped boundary for inspect, preview, and explicit XLSX ingestion. */
export async function handleQualityDataXlsxPost(
  request: Request,
  dependencies: QualityDataXlsxApiDependencies,
): Promise<Response> {
  const trace = requestTrace(request, dependencies.generate_uuid);
  const correlationId = trace.correlation_id;
  const action = new URL(request.url).searchParams.get("action") as QualityDataXlsxApiAction | null;
  if (action !== "inspect" && action !== "preview" && action !== "ingest") {
    return error("invalid_request", "Choose a supported workbook action.", 400, correlationId);
  }
  if (!sameOrigin(request, dependencies.configured_app_url)) return error("origin_denied", "The request origin is not allowed.", 403, correlationId);

  const authentication = await authenticated(dependencies);
  if (authentication instanceof Response) return authentication;

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (action === "ingest" && (idempotencyKey.length < 1 || idempotencyKey.length > 200)) {
    return error("invalid_request", "A valid Idempotency-Key is required.", 400, correlationId);
  }

  let ingestionDependencies: QualityDataXlsxIngestionDependencies | null;
  try { ingestionDependencies = dependencies.get_ingestion_dependencies(); } catch { return error("service_unavailable", "Quality-data ingestion is not available.", 503, correlationId); }
  if (!ingestionDependencies) return error("service_unavailable", "Quality-data ingestion is not available.", 503, correlationId);

  const now = dependencies.now();
  let authorization;
  try {
    authorization = await ingestionDependencies.authorizer.authorize(authentication.context, now);
  } catch {
    return error("quality_data_forbidden", "You are not authorized to ingest quality data for an organization.", 403, correlationId);
  }
  if (!authorization.allowed) return error("quality_data_forbidden", "You are not authorized to ingest quality data for an organization.", 403, correlationId);
  if (!isQualityDataPilotOrganizationAllowed(dependencies.pilot_gate, authentication.context.tenant.organization_id)) {
    return error("quality_data_unavailable", "Quality-data ingestion is not available for this organization.", 404, correlationId);
  }

  let rateLimit: QualityDataXlsxApiRateLimitResult;
  try {
    rateLimit = await dependencies.rate_limiter.consume(authentication.userId, action, now.getTime());
  } catch {
    rateLimit = "unavailable";
  }
  if (rateLimit === "unavailable") return error("service_unavailable", "Quality-data ingestion is not available.", 503, correlationId);
  if (rateLimit === "limited") return error("rate_limited", "Please wait before processing another workbook.", 429, correlationId);
  let parseSlot: QualityDataXlsxApiParseSlotResult = "unavailable";
  try {
    parseSlot = await dependencies.rate_limiter.acquireParseSlot(authentication.userId);
  } catch {
    parseSlot = "unavailable";
  }
  if (parseSlot === "unavailable") return error("service_unavailable", "Quality-data ingestion is not available.", 503, correlationId);
  if (parseSlot === "busy") return error("processing_busy", "Workbook processing is busy. Please try again shortly.", 429, correlationId);

  try {
    const form = await parseMultipart(request);
    if (form === "too_large") return error("file_too_large", "The workbook exceeds the 10 MiB upload limit.", 413, correlationId);
    if (form === "timeout") return error("request_timeout", "The upload took too long.", 408, correlationId);
    if (form === null) return error("invalid_request", "Send one .xlsx workbook using multipart form data.", 400, correlationId);
    const file = fileFrom(form);
    if (!file) return error("invalid_request", "Choose one non-empty .xlsx file within the 10 MiB limit.", 400, correlationId);
    const bytes = await fileBytes(file);

    if (action === "inspect") {
      if (!formFields(form, ["file"]) && !formFields(form, ["file", "worksheet", "header_row"])) {
        return error("invalid_request", "The workbook inspection request has unexpected fields.", 400, correlationId);
      }
      const worksheet = formString(form, "worksheet", 128);
      const headerText = formString(form, "header_row", 8);
      if ((worksheet === null) !== (headerText === null)) return error("invalid_request", "Select a worksheet and header row together.", 400, correlationId);
      const headerRow = headerText === null ? undefined : Number(headerText);
      if (headerText !== null && (!/^[1-9][0-9]*$/.test(headerText) || !Number.isSafeInteger(headerRow))) {
        return error("invalid_request", "The header row is invalid.", 400, correlationId);
      }
      const result = await inspectQualityDataXlsx(bytes, worksheet ?? undefined, headerRow);
      return result.status === "invalid" ? diagnosticsResponse(result) : json(result);
    }

    const mapping = mappingFrom(form);
    if (mapping === null) return error("invalid_request", "Provide an explicit worksheet and field mapping.", 400, correlationId);
    if (action === "preview") {
      if (!formFields(form, ["file", "mapping"])) return error("invalid_request", "The validation request has unexpected fields.", 400, correlationId);
      const validation = qualityDataXlsxMappingSchema.safeParse(mapping);
      if (!validation.success) return diagnosticsResponse({ diagnostics: [{ code: "INVALID_MAPPING" }] });
      const result = await parseQualityDataXlsx(bytes, validation.data);
      if (result.status === "invalid") return diagnosticsResponse(result);
      return json({
        status: "valid",
        record_count: result.record_count,
        field_count: result.field_count,
        source_sha256: createHash("sha256").update(bytes).digest("hex"),
        review_state: "review_required",
      });
    }

    if (!formFields(form, ["file", "mapping", "dataset_key", "dataset_name", "source_key"])) {
      return error("invalid_request", "The ingestion request has unexpected fields.", 400, correlationId);
    }
    const datasetKey = formString(form, "dataset_key", 128);
    const datasetName = formString(form, "dataset_name", 200);
    const sourceKey = formString(form, "source_key", 128);
    if (!datasetKey || !datasetName || !sourceKey) return error("invalid_request", "Complete the dataset identity fields.", 400, correlationId);
    const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
    const result = await ingestQualityDataXlsx(ingestionDependencies, authentication.context, {
      ...trace,
      idempotency_key: idempotencyKey as IdempotencyKey,
    }, {
      idempotency_key: idempotencyKey,
      source: {
        source_key: sourceKey,
        source_name: file.name,
        original_source_version: sourceSha256,
        bytes,
      },
      dataset: { dataset_key: datasetKey, dataset_name: datasetName, schema_version: "manufacturing-inspection-1.0.0" },
      mapping,
    });
    if (result.status === "invalid_request") return diagnosticsResponse({ diagnostics: result.diagnostics ?? [], diagnostics_truncated: result.diagnostics_truncated });
    if (result.status === "denied") return error("quality_data_forbidden", "You are not authorized to ingest quality data for an organization.", 403, correlationId);
    if (result.status === "conflict") return error("ingestion_conflict", "This source or idempotency key conflicts with an existing import.", 409, correlationId);
    return json({
      status: result.status,
      receipt: result.receipt,
      source: { source_name: file.name, sha256: sourceSha256, original_source_version: sourceSha256 },
      review_state: "review_required",
    }, result.status === "accepted" ? 201 : 200);
  } catch (cause) {
    if (cause instanceof QualityDataServiceError) {
      return error("ingestion_failed", "The quality-data import could not be completed.", 500, correlationId);
    }
    return error("ingestion_failed", "The quality-data import could not be completed.", 500, correlationId);
  } finally {
    try { await parseSlot.release(); } catch { /* The shared lease expires automatically. */ }
  }
}

/** Returns only whether the current session may ingest; tenant identifiers are never sent to the browser. */
export async function handleQualityDataXlsxEligibilityGet(
  dependencies: QualityDataXlsxApiDependencies,
): Promise<Response> {
  const authentication = await authenticated(dependencies);
  if (authentication instanceof Response) return authentication;
  let ingestionDependencies: QualityDataXlsxIngestionDependencies | null;
  try { ingestionDependencies = dependencies.get_ingestion_dependencies(); } catch { return error("service_unavailable", "Quality-data ingestion is not available.", 503); }
  if (!ingestionDependencies) return error("service_unavailable", "Quality-data ingestion is not available.", 503);
  try {
    const authorization = await ingestionDependencies.authorizer.authorize(authentication.context, dependencies.now());
    if (!authorization.allowed) return error("quality_data_forbidden", "You are not authorized to ingest quality data for an organization.", 403);
    if (!isQualityDataPilotOrganizationAllowed(dependencies.pilot_gate, authentication.context.tenant.organization_id)) {
      return error("quality_data_unavailable", "Quality-data ingestion is not available for this organization.", 404);
    }
    return json({ can_ingest: true });
  } catch {
    return error("quality_data_forbidden", "You are not authorized to ingest quality data for an organization.", 403);
  }
}
