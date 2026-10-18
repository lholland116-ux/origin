import { createHash } from "node:crypto";
import type { AuditEvent, AuditEventId, ControlledCode, RequestTrace } from "../capa/domain/capa-types";
import type { AuditRepository } from "../database/repositories/audit-repository";
import type { QualityDataReadScope } from "../database/repositories/quality-data-repository";
import type { QualityDataApprovalSummary, QualityDataStage3ARepository } from "../database/repositories/quality-data-stage3a-repository";
import type { TransactionManager } from "../database/transactions";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import { isHumanPrincipal, isSessionActive } from "../security/auth-context";
import type { QualityDataReadAuthorizer, QualityDataVersionApprovalAuthorizer } from "./quality-data-authorization";
import { QUALITY_DATA_APPROVAL_SCHEMA_VERSION, qualityDataVersionApprovalCommandSchema, type QualityDataVersionApprovalCommand, type QualityDataVersionApprovalState } from "./quality-data-approval-contract";
import {
  QUALITY_ANALYSIS_CALCULATION_VERSION,
  QUALITY_ANALYSIS_MAX_RESULT_BYTES,
  QUALITY_ANALYSIS_REQUEST_VERSION,
  QUALITY_ANALYSIS_RESULT_VERSION,
  qualityAnalysisRequestSchema,
  qualityAnalysisResultSchema,
  type QualityAnalysisExclusionReason,
  type QualityAnalysisFieldReference,
  type QualityAnalysisMetricRequest,
  type QualityAnalysisMetricResult,
  type QualityAnalysisRequest,
  type QualityAnalysisResult,
  type QualityAnalysisSourceReference,
} from "./quality-analysis-contract";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

export interface QualityDataStage3AServiceDependencies {
  readonly repository: QualityDataStage3ARepository;
  readonly audit_repository: AuditRepository;
  readonly transaction_manager: TransactionManager;
  readonly authorizer: QualityDataReadAuthorizer & QualityDataVersionApprovalAuthorizer;
  readonly ids: { readonly audit_event_id: () => AuditEventId; readonly uuid: () => string };
  readonly clock: { readonly now: () => Date };
}

export type QualityDataApprovalServiceResult =
  | { readonly status: "applied" | "already_recorded"; readonly approval: QualityDataVersionApprovalState }
  | { readonly status: "invalid_request"; readonly reason_code: "INVALID_APPROVAL_COMMAND" | "IDEMPOTENCY_KEY_REQUIRED" | "CALLER_IDENTITY_INVALID" }
  | { readonly status: "denied" }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "conflict"; readonly reason_code: string };

export type QualityDataApprovalSummaryServiceResult =
  | { readonly status: "found"; readonly summary: QualityDataApprovalSummary }
  | { readonly status: "denied" }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "invalid_request" };

export type QualityAnalysisServiceResult =
  | { readonly status: "complete" | "partial" | "missing_data"; readonly result: QualityAnalysisResult }
  | { readonly status: "invalid_request"; readonly reason_code: "INVALID_ANALYSIS_REQUEST" | "RESULT_LIMIT_EXCEEDED" }
  | { readonly status: "denied" }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "not_approved"; readonly decision: "none" | "rejected" | "revoked" }
  | { readonly status: "calculation_error"; readonly reason_code: "DATASET_SNAPSHOT_INVALID" | "NUMERIC_OVERFLOW" };

export class QualityDataStage3AServiceError extends Error {
  constructor(readonly reason_code: "PERSISTENCE_FAILED" | "AUDIT_FAILED") {
    super("The quality-data operation could not be completed.");
    this.name = "QualityDataStage3AServiceError";
  }
}

export async function getQualityDataDatasetVersionApproval(
  dependencies: QualityDataStage3AServiceDependencies,
  context: CapaRequestContext,
  datasetVersionId: string,
): Promise<QualityDataApprovalSummaryServiceResult> {
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime()) || !isHumanPrincipal(context.authentication)
    || !isSessionActive(context.authentication, now)
    || context.owner_user_id !== context.authentication.principal.user_id
    || !UUID_PATTERN.test(context.tenant.organization_id)
    || !UUID_PATTERN.test(context.authentication.principal.user_id)
    || !UUID_PATTERN.test(datasetVersionId)) {
    return { status: "invalid_request" };
  }
  const authorization = await dependencies.authorizer.authorizeApproval(context, now);
  if (!authorization.allowed) return { status: "denied" };
  const summary = await dependencies.repository.findVersionApprovalSummary({
    organization_id: authorization.organization_id,
    membership_id: authorization.membership_id,
    user_id: authorization.uploader_user_id,
    now: now.toISOString(),
  }, datasetVersionId);
  return summary === null ? { status: "not_found_or_not_authorized" } : { status: "found", summary };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requestFingerprint(command: QualityDataVersionApprovalCommand, organizationId: string, idempotencyKey: string): string {
  return fingerprint({ schema: QUALITY_DATA_APPROVAL_SCHEMA_VERSION, organization_id: organizationId, idempotency_key: idempotencyKey, command });
}

function buildApprovalAudit(input: {
  readonly event_id: AuditEventId;
  readonly organization_id: string;
  readonly user_id: string;
  readonly trace: RequestTrace;
  readonly state: QualityDataVersionApprovalState;
}): AuditEvent {
  return {
    event_id: input.event_id,
    organization_id: input.organization_id as AuditEvent["organization_id"],
    event_type: "QUALITY_DATA_ANALYTICAL_APPROVAL_RECORDED" as ControlledCode,
    schema_version: QUALITY_DATA_APPROVAL_SCHEMA_VERSION,
    aggregate_type: "QUALITY_DATASET_VERSION" as ControlledCode,
    aggregate_id: input.state.dataset_version_id,
    aggregate_version: input.state.transition_number,
    actor: { actor_type: "human", actor_id: input.user_id },
    occurred_at: input.state.occurred_at as AuditEvent["occurred_at"],
    request_id: input.trace.request_id,
    correlation_id: input.trace.correlation_id,
    ...(input.trace.idempotency_key === undefined ? {} : { idempotency_key: input.trace.idempotency_key }),
    action: `QUALITY_DATA_VERSION_${input.state.decision.toUpperCase()}` as ControlledCode,
    target: {
      object_type: "QUALITY_DATASET_VERSION" as ControlledCode,
      object_id: input.state.dataset_version_id,
      object_version_id: input.state.dataset_version_id,
    },
    outcome: "succeeded",
    configuration_versions: {
      quality_data_approval: QUALITY_DATA_APPROVAL_SCHEMA_VERSION,
      quality_data_contract: "quality-data-foundation-1.0.0",
    },
    metadata: {
      approval_event_id: input.state.approval_event_id,
      decision: input.state.decision,
      transition_number: input.state.transition_number,
      dataset_id: input.state.dataset_id,
      analytical_use_only: true,
      source_verification_asserted: false,
    },
  };
}

export async function transitionQualityDataDatasetVersionApproval(
  dependencies: QualityDataStage3AServiceDependencies,
  context: CapaRequestContext,
  trace: RequestTrace,
  input: unknown,
): Promise<QualityDataApprovalServiceResult> {
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) throw new QualityDataStage3AServiceError("PERSISTENCE_FAILED");
  if (!isHumanPrincipal(context.authentication) || !isSessionActive(context.authentication, now)
    || context.owner_user_id !== context.authentication.principal.user_id
    || !UUID_PATTERN.test(context.tenant.organization_id)
    || !UUID_PATTERN.test(context.authentication.principal.user_id)) {
    return { status: "invalid_request", reason_code: "CALLER_IDENTITY_INVALID" };
  }
  const authorization = await dependencies.authorizer.authorizeApproval(context, now);
  if (!authorization.allowed) return { status: "denied" };
  const parsed = qualityDataVersionApprovalCommandSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid_request", reason_code: "INVALID_APPROVAL_COMMAND" };
  const command = parsed.data;
  if (trace.idempotency_key === undefined || trace.idempotency_key.length < 1 || trace.idempotency_key.length > 200) {
    return { status: "invalid_request", reason_code: "IDEMPOTENCY_KEY_REQUIRED" };
  }
  const occurredAt = now.toISOString();
  try {
    return await dependencies.transaction_manager.runInTransaction(trace, async (transaction) => {
      const appended = await dependencies.repository.appendVersionApproval(transaction, {
        organization_id: authorization.organization_id,
        dataset_version_id: command.dataset_version_id,
        reviewer_user_id: authorization.uploader_user_id,
        reviewer_membership_id: authorization.membership_id,
        request_trace: { ...trace, idempotency_key: trace.idempotency_key! },
        command,
        approval_event_id: dependencies.ids.uuid(),
        request_fingerprint: requestFingerprint(command, authorization.organization_id, trace.idempotency_key!),
        now: occurredAt,
      });
      if (appended.status === "unauthorized") return { status: "denied" } as const;
      if (appended.status === "not_found") return { status: "not_found_or_not_authorized" } as const;
      if (appended.status === "conflict") return { status: "conflict", reason_code: appended.reason_code } as const;
      if (appended.status === "applied") {
        const audit = await dependencies.audit_repository.appendEvent(transaction, buildApprovalAudit({
          event_id: dependencies.ids.audit_event_id(),
          organization_id: authorization.organization_id,
          user_id: authorization.uploader_user_id,
          trace,
          state: appended.state,
        }));
        if (audit.status === "conflict") throw new QualityDataStage3AServiceError("AUDIT_FAILED");
        return { status: "applied", approval: appended.state } as const;
      }
      if (appended.status === "already_recorded") {
        return { status: "already_recorded", approval: appended.state } as const;
      }
      throw new QualityDataStage3AServiceError("PERSISTENCE_FAILED");
    });
  } catch (error) {
    if (error instanceof QualityDataStage3AServiceError) throw error;
    throw new QualityDataStage3AServiceError("PERSISTENCE_FAILED");
  }
}

function object(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function primitive(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

interface SafeQualityDataSnapshot {
  readonly dataset: { organization_id: string; dataset_id: string; dataset_key: string; dataset_name: string };
  readonly version: { dataset_version_id: string; version_number: number; schema_version: string; review_state: "review_required" };
  readonly approval: QualityDataVersionApprovalState;
  readonly sources: readonly QualityAnalysisSourceReference[];
  readonly records: readonly { record_id: string; record_ordinal: number; source_worksheet: string; source_row_number: number; fields: readonly Record<string, unknown>[] }[];
}

function safeSnapshot(snapshot: Awaited<ReturnType<QualityDataStage3ARepository["findApprovedDatasetVersion"]>>): SafeQualityDataSnapshot | null {
  if (snapshot === null || snapshot.status !== "approved") return null;
  if (snapshot.approval.decision !== "approved"
    || snapshot.snapshot.version.review_state !== "review_required"
    || snapshot.snapshot.records.length > 10_000) return null;
  const rawSources = snapshot.snapshot.source_versions;
  if (rawSources.length !== 1) return null;
  const source = object(rawSources[0]);
  if (source === null || typeof source.source_id !== "string" || !UUID_PATTERN.test(source.source_id)
    || typeof source.source_version_id !== "string" || !UUID_PATTERN.test(source.source_version_id)
    || typeof source.source_sha256 !== "string" || !HEX_SHA256.test(source.source_sha256)
    || typeof source.original_source_version !== "string" || typeof source.source_name !== "string") return null;
  const sourceRef: QualityAnalysisSourceReference = {
    source_id: source.source_id,
    source_version_id: source.source_version_id,
    source_sha256: source.source_sha256,
    original_source_version: source.original_source_version,
    source_name: source.source_name,
  };
  const records: { record_id: string; record_ordinal: number; source_worksheet: string; source_row_number: number; fields: readonly Record<string, unknown>[] }[] = [];
  for (const rawRecord of snapshot.snapshot.records) {
    const row = object(rawRecord);
    if (row === null || typeof row.record_id !== "string" || !UUID_PATTERN.test(row.record_id)
      || !Number.isSafeInteger(row.record_ordinal) || (row.record_ordinal as number) < 1
      || typeof row.source_worksheet !== "string" || !Number.isSafeInteger(row.source_row_number)
      || (row.source_row_number as number) < 1 || !Array.isArray(row.fields) || row.fields.length > 100) return null;
    const fields: Record<string, unknown>[] = [];
    const keys = new Set<string>();
    for (const rawField of row.fields) {
      const field = object(rawField);
      if (field === null || typeof field.field_id !== "string" || !UUID_PATTERN.test(field.field_id)
        || typeof field.field_key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(field.field_key)
        || keys.has(field.field_key) || typeof field.value_type !== "string"
        || !["text", "number", "date", "boolean", "blank"].includes(field.value_type)
        || field.source_worksheet !== row.source_worksheet || field.source_row_number !== row.source_row_number
        || (field.source_cell_reference !== null && (typeof field.source_cell_reference !== "string"
          || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(field.source_cell_reference)))
        || (field.normalized_unit !== null && (typeof field.normalized_unit !== "string" || field.normalized_unit.length > 32))) return null;
      const original = field.original_value;
      const normalized = field.normalized_value;
      if (field.value_type === "text" && (typeof original !== "string" || (normalized !== null && typeof normalized !== "string"))) return null;
      if (field.value_type === "number" && (
        typeof original !== "number" || !Number.isFinite(original)
        || (normalized !== null && (typeof normalized !== "number" || !Number.isFinite(normalized)))
      )) return null;
      if (field.value_type === "date" && (typeof original !== "string" || (normalized !== null && (typeof normalized !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(normalized))))) return null;
      if (field.value_type === "boolean" && (typeof original !== "boolean" || (normalized !== null && typeof normalized !== "boolean"))) return null;
      if (field.value_type === "blank" && (original !== null || (normalized !== undefined && normalized !== null))) return null;
      keys.add(field.field_key);
      fields.push(field);
    }
    records.push({
      record_id: row.record_id,
      record_ordinal: row.record_ordinal as number,
      source_worksheet: row.source_worksheet,
      source_row_number: row.source_row_number as number,
      fields,
    });
  }
  return {
    dataset: snapshot.snapshot.dataset,
    version: snapshot.snapshot.version,
    approval: snapshot.approval,
    sources: [sourceRef],
    records,
  };
}

function fieldReference(
  datasetId: string,
  versionId: string,
  record: { record_id: string; record_ordinal: number; source_worksheet: string; source_row_number: number },
  field: Record<string, unknown> | undefined,
  requestedFieldKey: string,
  source: QualityAnalysisSourceReference,
): QualityAnalysisFieldReference {
  return {
    dataset_id: datasetId,
    dataset_version_id: versionId,
    record_id: record.record_id,
    record_ordinal: record.record_ordinal,
    field_id: typeof field?.field_id === "string" ? field.field_id : null,
    field_key: requestedFieldKey,
    value_type: typeof field?.value_type === "string" ? field.value_type : null,
    original_value: primitive(field?.original_value),
    normalized_value: primitive(field?.normalized_value),
    normalized_unit: typeof field?.normalized_unit === "string" && field.normalized_unit.trim().length > 0 ? field.normalized_unit.trim() : null,
    source_id: source.source_id,
    source_version_id: source.source_version_id,
    source_sha256: source.source_sha256,
    source_worksheet: typeof field?.source_worksheet === "string" ? field.source_worksheet : record.source_worksheet,
    source_row_number: Number.isSafeInteger(field?.source_row_number) ? field!.source_row_number as number : record.source_row_number,
    source_cell_reference: typeof field?.source_cell_reference === "string" ? field.source_cell_reference : null,
  };
}

function emptyExclusions(): Record<QualityAnalysisExclusionReason, number> {
  return { missing_field: 0, missing_value: 0, non_numeric: 0 };
}

function calculateMetric(
  request: QualityAnalysisMetricRequest,
  datasetId: string,
  versionId: string,
  records: SafeQualityDataSnapshot["records"],
  source: QualityAnalysisSourceReference,
): QualityAnalysisMetricResult {
  const denominator = records.length;
  const exclusions = emptyExclusions();
  const inputs: QualityAnalysisFieldReference[] = [];
  const selected: { value: number; unit: string | null }[] = [];
  let numerator = 0;

  for (const record of records) {
    const field = record.fields.find((item) => item.field_key === request.field_key);
    const reference = fieldReference(datasetId, versionId, record, field, request.field_key, source);
    inputs.push(reference);
    if (field === undefined) {
      exclusions.missing_field += 1;
      continue;
    }
    if (request.kind === "field_completeness") {
      if (field.value_type === "blank" || field.normalized_value === null || field.normalized_value === undefined) {
        exclusions.missing_value += 1;
      } else {
        numerator += 1;
      }
      continue;
    }
    if (field.value_type === "blank") {
      exclusions.missing_value += 1;
      continue;
    }
    if (field.value_type !== "number") {
      exclusions.non_numeric += 1;
      continue;
    }
    if (typeof field.normalized_value !== "number" || !Number.isFinite(field.normalized_value)) {
      exclusions.missing_value += 1;
      continue;
    }
    selected.push({
      value: field.normalized_value,
      unit: typeof field.normalized_unit === "string" && field.normalized_unit.trim().length > 0 ? field.normalized_unit.trim() : null,
    });
    numerator += 1;
  }

  if (request.kind === "field_completeness") {
    const empty = denominator === 0;
    return {
      metric_id: request.metric_id, kind: request.kind, field_key: request.field_key,
      status: empty || exclusions.missing_field === denominator ? "missing_data" : "complete",
      denominator_record_count: denominator, numerator_record_count: numerator,
      exclusions, unit: "%", unit_status: "not_applicable",
      value: denominator === 0 ? null : (numerator / denominator) * 100,
      minimum: null, maximum: null, calculation_inputs: inputs,
      ...(empty ? { reason_code: "EMPTY_DATASET" as const } : exclusions.missing_field === denominator ? { reason_code: "FIELD_NOT_PRESENT" as const } : {}),
    };
  }

  const units = new Set(selected.map((item) => item.unit === null ? "\u0000unspecified" : item.unit));
  const mixedUnits = units.size > 1;
  const unitStatus = mixedUnits ? "mixed" : selected.length === 0 || selected[0]?.unit === null ? "unspecified" : "consistent";
  if (mixedUnits) {
    return {
      metric_id: request.metric_id, kind: request.kind, field_key: request.field_key,
      status: "unit_mismatch", denominator_record_count: denominator, numerator_record_count: numerator,
      exclusions, unit: null, unit_status: "mixed", value: null, minimum: null, maximum: null,
      calculation_inputs: inputs, reason_code: "MIXED_UNITS",
    };
  }
  if (selected.length === 0) {
    return {
      metric_id: request.metric_id, kind: request.kind, field_key: request.field_key,
      status: "missing_data", denominator_record_count: denominator, numerator_record_count: 0,
      exclusions, unit: null, unit_status: "unspecified", value: null, minimum: null, maximum: null,
      calculation_inputs: inputs, reason_code: denominator === 0 ? "EMPTY_DATASET" : exclusions.missing_field === denominator ? "FIELD_NOT_PRESENT" : "NO_VALID_VALUES",
    };
  }
  // Record order is stable. Kahan summation fixes the accumulation order and
  // reduces deterministic floating-point error without rounding source data.
  let sum = 0;
  let compensation = 0;
  for (const item of selected) {
    const adjusted = item.value - compensation;
    const next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  }
  const mean = sum / selected.length;
  if (!Number.isFinite(mean)) {
    return {
      metric_id: request.metric_id, kind: request.kind, field_key: request.field_key,
      status: "missing_data", denominator_record_count: denominator, numerator_record_count: numerator,
      exclusions, unit: null, unit_status: unitStatus, value: null, minimum: null, maximum: null,
      calculation_inputs: inputs, reason_code: "NUMERIC_OVERFLOW",
    };
  }
  const values = selected.map((item) => item.value);
  return {
    metric_id: request.metric_id, kind: request.kind, field_key: request.field_key,
    status: "complete", denominator_record_count: denominator, numerator_record_count: numerator,
    exclusions, unit: selected[0]?.unit ?? null, unit_status: unitStatus,
    value: mean, minimum: Math.min(...values), maximum: Math.max(...values), calculation_inputs: inputs,
  };
}

export async function analyzeQualityDatasetVersion(
  dependencies: QualityDataStage3AServiceDependencies,
  context: CapaRequestContext,
  input: unknown,
): Promise<QualityAnalysisServiceResult> {
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime()) || !isHumanPrincipal(context.authentication) || !isSessionActive(context.authentication, now)
    || context.owner_user_id !== context.authentication.principal.user_id || !UUID_PATTERN.test(context.tenant.organization_id)
    || !UUID_PATTERN.test(context.authentication.principal.user_id)) return { status: "denied" };
  const authorization = await dependencies.authorizer.authorizeRead(context, now);
  if (!authorization.allowed) return { status: "denied" };
  const parsed = qualityAnalysisRequestSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid_request", reason_code: "INVALID_ANALYSIS_REQUEST" };
  const request: QualityAnalysisRequest = parsed.data;
  const scope: QualityDataReadScope = {
    organization_id: authorization.organization_id,
    user_id: authorization.uploader_user_id,
    membership_id: authorization.membership_id,
    now: now.toISOString(),
  };
  const approved = await dependencies.repository.findApprovedDatasetVersion(scope, request.dataset_version_id);
  if (approved === null) return { status: "not_found_or_not_authorized" };
  if (approved.status === "not_approved") return { status: "not_approved", decision: approved.decision };
  const safe = safeSnapshot(approved);
  if (safe === null) return { status: "calculation_error", reason_code: "DATASET_SNAPSHOT_INVALID" };

  const metrics = request.metrics.map((metric) => calculateMetric(
    metric,
    safe.dataset.dataset_id,
    safe.version.dataset_version_id,
    safe.records,
    safe.sources[0]!,
  ));
  const completed = metrics.filter((metric) => metric.status === "complete").length;
  const status: QualityAnalysisResult["status"] = completed === metrics.length
    ? "complete"
    : completed === 0 && metrics.every((metric) => metric.status === "missing_data")
      ? "missing_data"
      : "partial";
  const resultBase: Omit<QualityAnalysisResult, "analysis_id"> = {
    schema_version: QUALITY_ANALYSIS_RESULT_VERSION,
    calculation_version: QUALITY_ANALYSIS_CALCULATION_VERSION,
    status,
    time_window: "all_records_in_dataset_version",
    denominator_definition: "all records in the approved immutable dataset version",
    authorization_scope: "analytical_use_only",
    source_verification: "not_asserted",
    dataset: {
      organization_id: safe.dataset.organization_id,
      dataset_id: safe.dataset.dataset_id,
      dataset_version_id: safe.version.dataset_version_id,
      version_number: safe.version.version_number,
      schema_version: safe.version.schema_version,
      review_state: "review_required",
    },
    approval: {
      approval_event_id: safe.approval.approval_event_id,
      transition_number: safe.approval.transition_number,
      reviewer_user_id: safe.approval.reviewer_user_id,
      approved_at: safe.approval.occurred_at,
    },
    sources: safe.sources,
    record_count: safe.records.length,
    metrics,
    advisory_interpretation: { status: "not_requested", content: null },
  };
  const analysisId = fingerprint({ request, approval_event_id: safe.approval.approval_event_id, calculation_version: QUALITY_ANALYSIS_CALCULATION_VERSION, metrics });
  const result: QualityAnalysisResult = { ...resultBase, analysis_id: analysisId };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > QUALITY_ANALYSIS_MAX_RESULT_BYTES) {
    return { status: "invalid_request", reason_code: "RESULT_LIMIT_EXCEEDED" };
  }
  // The result schema version remains explicit even though a fixed typed
  // constructor is used here; unknown database shapes fail before emission.
  if (request.schema_version !== QUALITY_ANALYSIS_REQUEST_VERSION || !qualityAnalysisResultSchema.safeParse(result).success) {
    return { status: "calculation_error", reason_code: "DATASET_SNAPSHOT_INVALID" };
  }
  return { status: result.status, result };
}
