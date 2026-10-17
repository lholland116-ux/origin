import { createHash } from "node:crypto";
import { z } from "zod";

import type { QualityDataSourceStorage } from "../database/supabase/supabase-quality-data-source-storage";
import type { RequestTrace } from "../capa/domain/capa-types";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import { QUALITY_DATA_MAX_SOURCE_BYTES } from "./quality-data-contract";
import { ingestQualityData, type QualityDataServiceDependencies, type QualityDataIngestionResult } from "./quality-data-service";
import { parseQualityDataXlsx, QUALITY_DATA_XLSX_MEDIA_TYPE, QUALITY_DATA_XLSX_PARSER_VERSION, qualityDataXlsxMappingSchema, type QualityDataXlsxDiagnostic } from "./xlsx-quality-data-parser";

const inputSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(200),
  source: z.object({
    source_key: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    source_name: z.string().trim().min(1).max(200),
    original_source_version: z.string().trim().min(1).max(128),
    bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= QUALITY_DATA_MAX_SOURCE_BYTES),
  }).strict(),
  dataset: z.object({
    dataset_key: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    dataset_name: z.string().trim().min(1).max(200),
    schema_version: z.string().trim().min(1).max(100),
  }).strict(),
  mapping: qualityDataXlsxMappingSchema,
}).strict();

export type QualityDataXlsxIngestionInput = z.input<typeof inputSchema>;
export type QualityDataXlsxIngestionDependencies = QualityDataServiceDependencies & {
  readonly source_storage: QualityDataSourceStorage;
};
export type QualityDataXlsxIngestionResult = Exclude<QualityDataIngestionResult, { readonly status: "invalid_request" }>
  | { readonly status: "invalid_request"; readonly reason_code: string; readonly diagnostics?: readonly QualityDataXlsxDiagnostic[]; readonly diagnostics_truncated?: boolean };

export class QualityDataXlsxIngestionError extends Error {
  constructor(readonly reason_code: "SOURCE_STORAGE_FAILED") {
    super("The XLSX quality-data import could not be completed.");
    this.name = "QualityDataXlsxIngestionError";
  }
}

/**
 * Deterministic XLSX ingestion. Authorization is checked before parsing or
 * Storage access, then checked again by the existing transactional service
 * and repository immediately before persistence.
 */
export async function ingestQualityDataXlsx(
  dependencies: QualityDataXlsxIngestionDependencies,
  context: CapaRequestContext,
  trace: RequestTrace,
  input: unknown,
): Promise<QualityDataXlsxIngestionResult> {
  const parsedInput = inputSchema.safeParse(input);
  if (!parsedInput.success) return { status: "invalid_request", reason_code: "INVALID_XLSX_IMPORT_REQUEST" };
  const request = parsedInput.data;
  if (trace.idempotency_key === undefined || trace.idempotency_key !== request.idempotency_key) {
    return { status: "invalid_request", reason_code: "IDEMPOTENCY_KEY_MISMATCH" };
  }

  let now: Date;
  try { now = dependencies.clock.now(); } catch { return { status: "denied", reason_code: "SESSION_INACTIVE" }; }
  if (!Number.isFinite(now.getTime())) return { status: "denied", reason_code: "SESSION_INACTIVE" };
  const authorization = await dependencies.authorizer.authorize(context, now);
  if (!authorization.allowed) return { status: "denied", reason_code: authorization.reason_code };

  const parsedWorkbook = await parseQualityDataXlsx(request.source.bytes, request.mapping);
  if (parsedWorkbook.status === "invalid") {
    return {
      status: "invalid_request",
      reason_code: "XLSX_VALIDATION_FAILED",
      diagnostics: parsedWorkbook.diagnostics,
      diagnostics_truncated: parsedWorkbook.diagnostics_truncated,
    };
  }

  const sourceSha256 = createHash("sha256").update(request.source.bytes).digest("hex");
  let stored: Awaited<ReturnType<QualityDataSourceStorage["storeOriginal"]>>;
  try {
    stored = await dependencies.source_storage.storeOriginal({
      organization_id: authorization.organization_id,
      source_key: request.source.source_key,
      original_source_version: request.source.original_source_version,
      bytes: request.source.bytes,
      sha256: sourceSha256,
      media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
    });
  } catch {
    throw new QualityDataXlsxIngestionError("SOURCE_STORAGE_FAILED");
  }
  if (stored.status === "conflict") return { status: "conflict", reason_code: "SOURCE_CONFLICT" };

  return ingestQualityData(dependencies, context, trace, {
    idempotency_key: request.idempotency_key,
    source: {
      source_key: request.source.source_key,
      source_name: request.source.source_name,
      source_type: "xlsx",
      original_source_version: request.source.original_source_version,
      source_sha256: sourceSha256,
      source_bytes: request.source.bytes,
      media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
      storage_reference: stored.storage_reference,
      parser_version: QUALITY_DATA_XLSX_PARSER_VERSION,
      schema_version: request.dataset.schema_version,
    },
    dataset: request.dataset,
    records: parsedWorkbook.records,
  });
}
