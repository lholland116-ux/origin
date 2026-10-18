import { createHash } from "node:crypto";
import type { QualityDataVersionApprovalState } from "./quality-data-approval-contract";
import type { QualityAnalysisSourceReference } from "./quality-analysis-contract";
import {
  QUALITY_SIGNAL_CALCULATION_VERSION,
  QUALITY_SIGNAL_MAX_RESULT_BYTES,
  QUALITY_SIGNAL_RESULT_VERSION,
  type QualitySignalDefinition,
  type QualitySignalDetectionRequest,
  type QualitySignalDetectionResult,
  type QualitySignalEvidenceCell,
  type QualitySignalEvidenceRecord,
  type QualitySignalExcludedInput,
  type QualitySignalExclusionCounts,
  type QualitySignalRateBucket,
  type QualitySignalResult,
} from "./quality-signal-contract";

export interface QualitySignalCalculationSnapshot {
  readonly dataset: { readonly organization_id: string; readonly dataset_id: string };
  readonly version: {
    readonly dataset_version_id: string;
    readonly version_number: number;
    readonly schema_version: string;
    readonly review_state: "review_required";
  };
  readonly approval: QualityDataVersionApprovalState;
  readonly sources: readonly QualityAnalysisSourceReference[];
  readonly records: readonly {
    readonly record_id: string;
    readonly record_ordinal: number;
    readonly source_worksheet: string;
    readonly source_row_number: number;
    readonly fields: readonly Record<string, unknown>[];
  }[];
}

export type QualitySignalCalculationFailure = "DUPLICATE_SOURCE_RECORD" | "TIME_WINDOW_LIMIT_EXCEEDED" | "RESULT_LIMIT_EXCEEDED";
export type QualitySignalCalculationResult =
  | { readonly status: "calculated"; readonly result: QualitySignalDetectionResult }
  | { readonly status: "invalid_snapshot"; readonly reason_code: "DUPLICATE_SOURCE_RECORD" }
  | { readonly status: "limit_exceeded"; readonly reason_code: "TIME_WINDOW_LIMIT_EXCEEDED" | "RESULT_LIMIT_EXCEEDED" };

const MAX_MONTHS = 120;
const MAX_SERIALIZED_RESULT_BYTES = QUALITY_SIGNAL_MAX_RESULT_BYTES;
type MutableExclusionCounts = { -readonly [Key in keyof QualitySignalExclusionCounts]: number };

function recordKey(record: QualitySignalCalculationSnapshot["records"][number]): string {
  return `${record.source_worksheet}\u0000${record.source_row_number}`;
}

function validateUniqueSourceRows(records: QualitySignalCalculationSnapshot["records"]): boolean {
  const recordIds = new Set<string>();
  const ordinals = new Set<number>();
  const positions = new Set<string>();
  for (const record of records) {
    const position = recordKey(record);
    if (recordIds.has(record.record_id) || ordinals.has(record.record_ordinal) || positions.has(position)) return false;
    const sourceCells = new Set<string>();
    for (const rawField of record.fields) {
      const field = asObject(rawField);
      if (typeof field?.source_cell_reference !== "string") continue;
      if (sourceCells.has(field.source_cell_reference)) return false;
      sourceCells.add(field.source_cell_reference);
    }
    recordIds.add(record.record_id);
    ordinals.add(record.record_ordinal);
    positions.add(position);
  }
  return true;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function valueFor(field: Record<string, unknown> | undefined, key: "original_value" | "normalized_value"): string | number | boolean | null {
  const value = field?.[key];
  if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function cellEvidence(fieldKey: string, field: Record<string, unknown> | undefined): QualitySignalEvidenceCell | null {
  if (!field) return null;
  return {
    field_key: fieldKey,
    value_type: typeof field.value_type === "string" ? field.value_type : "unknown",
    original_value: valueFor(field, "original_value"),
    normalized_value: valueFor(field, "normalized_value"),
    normalized_unit: typeof field.normalized_unit === "string" && field.normalized_unit.trim() ? field.normalized_unit.trim() : null,
    source_cell_reference: typeof field.source_cell_reference === "string" ? field.source_cell_reference : null,
  };
}

function recordEvidence(
  record: QualitySignalCalculationSnapshot["records"][number],
  fieldKeys: readonly string[],
): QualitySignalEvidenceRecord {
  const cells = fieldKeys.flatMap((key) => {
    const field = record.fields.find((candidate) => candidate.field_key === key);
    const evidence = cellEvidence(key, field);
    return evidence ? [evidence] : [];
  });
  return {
    record_id: record.record_id,
    record_ordinal: record.record_ordinal,
    source_worksheet: record.source_worksheet,
    source_row_number: record.source_row_number,
    cells,
  };
}

function emptyExclusions(): MutableExclusionCounts {
  return { missing_field: 0, missing_value: 0, invalid_number: 0, invalid_date: 0, zero_denominator: 0, missing_provenance: 0 };
}

function excluded(
  reason: QualitySignalExcludedInput["reason"],
  record: QualitySignalCalculationSnapshot["records"][number],
  fieldKeys: readonly string[],
): QualitySignalExcludedInput {
  return { ...recordEvidence(record, fieldKeys), reason };
}

function fieldMap(record: QualitySignalCalculationSnapshot["records"][number]): Map<string, Record<string, unknown>> {
  return new Map(record.fields.flatMap((raw) => {
    const field = asObject(raw);
    return typeof field?.field_key === "string" ? [[field.field_key, field] as const] : [];
  }));
}

function hasExpectedType(
  records: QualitySignalCalculationSnapshot["records"],
  fieldKey: string,
  expectedType: "text" | "number" | "date",
): "present" | "missing" | "mismatch" {
  const values = records.flatMap((record) => {
    const field = fieldMap(record).get(fieldKey);
    return field ? [field] : [];
  });
  if (values.length === 0) return "missing";
  return values.every((field) => field.value_type === expectedType || field.value_type === "blank") ? "present" : "mismatch";
}

function hasExpectedUnit(
  records: QualitySignalCalculationSnapshot["records"],
  fieldKey: string,
  expectedUnit: string,
): boolean {
  const fields = records.flatMap((record) => {
    const field = fieldMap(record).get(fieldKey);
    return field ? [field] : [];
  });
  return fields.length > 0 && fields.every((field) => typeof field.normalized_unit === "string" && field.normalized_unit.trim() === expectedUnit);
}

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1 || year > 9999) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthIndex(period: string): number {
  const [year, month] = period.split("-").map(Number);
  return year! * 12 + month! - 1;
}

function periodFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function kahanSum(values: readonly number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const adjusted = value - compensation;
    const next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
}

function recurringCategory(
  request: Extract<QualitySignalDefinition, { kind: "recurring_category" }>,
  snapshot: QualitySignalCalculationSnapshot,
): QualitySignalResult {
  const type = hasExpectedType(snapshot.records, request.field_key, "text");
  const common = {
    signal_id: request.signal_id,
    kind: request.kind,
    semantic_role: request.semantic_role,
    field_key: request.field_key,
    minimum_sample_size: request.minimum_sample_size,
    minimum_occurrences: request.minimum_occurrences,
    time_window: "all_records_in_dataset_version" as const,
  };
  if (type !== "present") return {
    ...common,
    status: "unsupported_schema",
    reason_code: type === "missing" ? "FIELD_NOT_PRESENT" : "FIELD_TYPE_MISMATCH",
    sample_record_count: 0,
    exclusions: emptyExclusions(),
    excluded_inputs: [],
    observed_patterns: [],
  };

  const exclusions = emptyExclusions();
  const excludedInputs: QualitySignalExcludedInput[] = [];
  const grouped = new Map<string, QualitySignalEvidenceRecord[]>();
  for (const record of snapshot.records) {
    const field = fieldMap(record).get(request.field_key);
    let reason: QualitySignalExcludedInput["reason"] | undefined;
    if (!field) reason = "missing_field";
    else if (field.value_type === "blank" || typeof field.normalized_value !== "string" || field.normalized_value.trim().length === 0) reason = "missing_value";
    else if (typeof field.source_cell_reference !== "string") reason = "missing_provenance";
    if (reason) {
      exclusions[reason] += 1;
      excludedInputs.push(excluded(reason, record, [request.field_key]));
      continue;
    }
    const value = field!.normalized_value as string;
    const items = grouped.get(value) ?? [];
    items.push(recordEvidence(record, [request.field_key]));
    grouped.set(value, items);
  }
  const sampleCount = [...grouped.values()].reduce((count, records) => count + records.length, 0);
  if (sampleCount < request.minimum_sample_size) return {
    ...common, status: "insufficient_data", reason_code: "INSUFFICIENT_SAMPLE", sample_record_count: sampleCount,
    exclusions, excluded_inputs: excludedInputs, observed_patterns: [],
  };
  const patterns = [...grouped.entries()]
    .filter(([, evidence]) => evidence.length >= request.minimum_occurrences)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([value, evidence]) => ({ value, occurrence_count: evidence.length, evidence }));
  return {
    ...common,
    status: patterns.length > 0 ? "detected" : "not_detected",
    sample_record_count: sampleCount,
    exclusions,
    excluded_inputs: excludedInputs,
    observed_patterns: patterns,
  };
}

interface EligibleRateRow {
  readonly period: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly evidence: QualitySignalEvidenceRecord;
}

type RateRequest = Extract<QualitySignalDefinition, { kind: "defect_rate_threshold" | "defect_rate_trend" }>;

function unsupportedRate(
  request: RateRequest,
  reason: "FIELD_NOT_PRESENT" | "FIELD_TYPE_MISMATCH" | "UNIT_MISMATCH" | "TIME_WINDOW_LIMIT_EXCEEDED",
): QualitySignalResult {
  const status = reason === "TIME_WINDOW_LIMIT_EXCEEDED" ? "unsupported_configuration" as const : "unsupported_schema" as const;
  const base = {
    signal_id: request.signal_id,
    kind: request.kind,
    status,
    reason_code: reason,
    rate_definition: {
      defect_count_field_key: request.defect_count_field_key,
      defect_count_unit: "count" as const,
      production_quantity_field_key: request.production_quantity_field_key,
      production_quantity_unit: request.production_quantity_unit,
      observation_date_field_key: request.observation_date_field_key,
      window: "calendar_month" as const,
      rate_per: request.rate_per,
      formula: "sum(defect_count) / sum(production_quantity) * rate_per" as const,
    },
    exclusions: emptyExclusions(),
    excluded_inputs: [] as QualitySignalExcludedInput[],
    buckets: [] as QualitySignalRateBucket[],
  };
  return request.kind === "defect_rate_threshold"
    ? { ...base, kind: request.kind, rate_definition: { ...base.rate_definition, comparison: "greater_than_or_equal", threshold: request.threshold } }
    : { ...base, kind: request.kind, rate_definition: { ...base.rate_definition, trend_direction: request.direction, minimum_absolute_change: request.minimum_absolute_change, change_unit: `count per ${request.production_quantity_unit} (per ${request.rate_per})` }, comparisons: [] };
}

function rateBuckets(
  request: RateRequest,
  snapshot: QualitySignalCalculationSnapshot,
): { readonly rows: readonly EligibleRateRow[]; readonly exclusions: QualitySignalExclusionCounts; readonly excludedInputs: readonly QualitySignalExcludedInput[]; readonly buckets: readonly QualitySignalRateBucket[] } | QualitySignalResult {
  const keys = [request.defect_count_field_key, request.production_quantity_field_key, request.observation_date_field_key] as const;
  const types = [hasExpectedType(snapshot.records, keys[0], "number"), hasExpectedType(snapshot.records, keys[1], "number"), hasExpectedType(snapshot.records, keys[2], "date")];
  if (types.includes("missing")) return unsupportedRate(request, "FIELD_NOT_PRESENT");
  if (types.includes("mismatch")) return unsupportedRate(request, "FIELD_TYPE_MISMATCH");
  if (!hasExpectedUnit(snapshot.records, keys[0], "count") || !hasExpectedUnit(snapshot.records, keys[1], request.production_quantity_unit)) {
    return unsupportedRate(request, "UNIT_MISMATCH");
  }

  const exclusions = emptyExclusions();
  const excludedInputs: QualitySignalExcludedInput[] = [];
  const rows: EligibleRateRow[] = [];
  for (const record of snapshot.records) {
    const fields = fieldMap(record);
    const numeratorField = fields.get(keys[0]);
    const denominatorField = fields.get(keys[1]);
    const dateField = fields.get(keys[2]);
    let reason: QualitySignalExcludedInput["reason"] | undefined;
    if (!numeratorField || !denominatorField || !dateField) reason = "missing_field";
    else if ([numeratorField, denominatorField, dateField].some((field) => field.value_type === "blank" || field.normalized_value === null || field.normalized_value === undefined)) reason = "missing_value";
    else if (!validCalendarDate(dateField!.normalized_value)) reason = "invalid_date";
    else if (typeof numeratorField!.normalized_value !== "number" || !Number.isSafeInteger(numeratorField!.normalized_value)
      || numeratorField!.normalized_value < 0 || typeof denominatorField!.normalized_value !== "number"
      || !Number.isFinite(denominatorField!.normalized_value) || denominatorField!.normalized_value < 0) reason = "invalid_number";
    else if (denominatorField!.normalized_value === 0) reason = "zero_denominator";
    else if ([numeratorField, denominatorField, dateField].some((field) => typeof field!.source_cell_reference !== "string")) reason = "missing_provenance";
    if (reason) {
      exclusions[reason] += 1;
      excludedInputs.push(excluded(reason, record, keys));
      continue;
    }
    const date = dateField!.normalized_value as string;
    rows.push({
      period: date.slice(0, 7),
      numerator: numeratorField!.normalized_value as number,
      denominator: denominatorField!.normalized_value as number,
      evidence: recordEvidence(record, keys),
    });
  }

  const periods = rows.map((row) => monthIndex(row.period));
  if (periods.length === 0) return { rows, exclusions, excludedInputs, buckets: [] };
  const first = Math.min(...periods);
  const last = Math.max(...periods);
  if (last - first + 1 > MAX_MONTHS) return unsupportedRate(request, "TIME_WINDOW_LIMIT_EXCEEDED");
  const periodIndexes = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const buckets = periodIndexes.map((index): QualitySignalRateBucket => {
    const period = periodFromIndex(index);
    const inputs = rows.filter((row) => row.period === period);
    const sampleCount = inputs.length;
    const rateUnit = `count per ${request.production_quantity_unit} (per ${request.rate_per})`;
    if (sampleCount < request.minimum_records_per_window) return {
      period, status: "insufficient_data", sample_record_count: sampleCount,
      minimum_records_per_window: request.minimum_records_per_window,
      defect_count_total: null, production_quantity_total: null, rate: null, rate_unit: rateUnit,
      threshold: request.kind === "defect_rate_threshold" ? request.threshold : null,
      triggered: null, reason_code: "INSUFFICIENT_SAMPLE", calculation_inputs: inputs.map((row) => row.evidence),
    };
    const defectTotal = kahanSum(inputs.map((row) => row.numerator));
    const quantityTotal = kahanSum(inputs.map((row) => row.denominator));
    const rate = defectTotal / quantityTotal * request.rate_per;
    if (!Number.isFinite(defectTotal) || !Number.isFinite(quantityTotal) || quantityTotal <= 0 || !Number.isFinite(rate)) return {
      period, status: "insufficient_data", sample_record_count: sampleCount,
      minimum_records_per_window: request.minimum_records_per_window,
      defect_count_total: null, production_quantity_total: null, rate: null, rate_unit: rateUnit,
      threshold: request.kind === "defect_rate_threshold" ? request.threshold : null,
      triggered: null, reason_code: quantityTotal === 0 ? "ZERO_DENOMINATOR" : "NUMERIC_OVERFLOW", calculation_inputs: inputs.map((row) => row.evidence),
    };
    return {
      period, status: "evaluated", sample_record_count: sampleCount,
      minimum_records_per_window: request.minimum_records_per_window,
      defect_count_total: defectTotal, production_quantity_total: quantityTotal, rate, rate_unit: rateUnit,
      threshold: request.kind === "defect_rate_threshold" ? request.threshold : null,
      triggered: request.kind === "defect_rate_threshold" ? rate >= request.threshold : null,
      calculation_inputs: inputs.map((row) => row.evidence),
    };
  });
  return { rows, exclusions, excludedInputs, buckets };
}

function rateSignal(
  request: RateRequest,
  snapshot: QualitySignalCalculationSnapshot,
): QualitySignalResult {
  const calculated = rateBuckets(request, snapshot);
  if ("kind" in calculated) return calculated;
  const evaluated = calculated.buckets.filter((bucket) => bucket.status === "evaluated");
  const hasInsufficient = calculated.buckets.some((bucket) => bucket.status === "insufficient_data");
  const baseDefinition = {
    defect_count_field_key: request.defect_count_field_key,
    defect_count_unit: "count" as const,
    production_quantity_field_key: request.production_quantity_field_key,
    production_quantity_unit: request.production_quantity_unit,
    observation_date_field_key: request.observation_date_field_key,
    window: "calendar_month" as const,
    rate_per: request.rate_per,
    formula: "sum(defect_count) / sum(production_quantity) * rate_per" as const,
  };
  if (request.kind === "defect_rate_threshold") {
    const triggered = evaluated.some((bucket) => bucket.triggered === true);
    return {
      signal_id: request.signal_id, kind: request.kind,
      status: evaluated.length === 0 ? "insufficient_data" : hasInsufficient ? "partial" : triggered ? "detected" : "not_detected",
      ...(evaluated.length === 0 ? { reason_code: "NO_VALID_WINDOWS" as const } : {}),
      rate_definition: { ...baseDefinition, comparison: "greater_than_or_equal", threshold: request.threshold },
      exclusions: calculated.exclusions, excluded_inputs: calculated.excludedInputs, buckets: calculated.buckets,
    };
  }
  const comparisons: Extract<QualitySignalResult, { kind: "defect_rate_trend" }> ["comparisons"][number][] = [];
  for (let index = 1; index < calculated.buckets.length; index += 1) {
    const before = calculated.buckets[index - 1]!;
    const after = calculated.buckets[index]!;
    if (before.status !== "evaluated" || after.status !== "evaluated") {
      comparisons.push({
        from_period: before.period, to_period: after.period, status: "insufficient_data", change: null, absolute_change: null,
        triggered: null, reason_code: "INSUFFICIENT_SAMPLE",
        calculation_inputs: [...before.calculation_inputs, ...after.calculation_inputs],
      });
      continue;
    }
    const delta = after.rate! - before.rate!;
    const matchesDirection = request.direction === "either" || (request.direction === "increase" ? delta > 0 : delta < 0);
    comparisons.push({
      from_period: before.period, to_period: after.period, status: "evaluated", change: delta, absolute_change: Math.abs(delta),
      triggered: matchesDirection && Math.abs(delta) >= request.minimum_absolute_change,
      calculation_inputs: [...before.calculation_inputs, ...after.calculation_inputs],
    });
  }
  const evaluatedComparisons = comparisons.filter((comparison) => comparison.status === "evaluated");
  const hasInsufficientComparison = comparisons.some((comparison) => comparison.status === "insufficient_data");
  const trendStatus: Extract<QualitySignalResult, { kind: "defect_rate_trend" }> ["status"] = evaluatedComparisons.length === 0
    ? "insufficient_data"
    : hasInsufficientComparison ? "partial" : evaluatedComparisons.some((comparison) => comparison.triggered) ? "detected" : "not_detected";
  return {
    signal_id: request.signal_id, kind: request.kind, status: trendStatus,
    ...(calculated.buckets.length < 2
      ? { reason_code: "NO_ADJACENT_WINDOWS" as const }
      : evaluatedComparisons.length === 0
        ? { reason_code: "INSUFFICIENT_SAMPLE" as const }
        : {}),
    rate_definition: {
      ...baseDefinition, trend_direction: request.direction,
      minimum_absolute_change: request.minimum_absolute_change,
      change_unit: `count per ${request.production_quantity_unit} (per ${request.rate_per})`,
    },
    exclusions: calculated.exclusions, excluded_inputs: calculated.excludedInputs,
    buckets: calculated.buckets, comparisons,
  };
}

function detectOne(request: QualitySignalDefinition, snapshot: QualitySignalCalculationSnapshot): QualitySignalResult {
  return request.kind === "recurring_category" ? recurringCategory(request, snapshot) : rateSignal(request, snapshot);
}

export function calculateQualitySignals(
  request: QualitySignalDetectionRequest,
  snapshot: QualitySignalCalculationSnapshot,
): QualitySignalCalculationResult {
  if (!validateUniqueSourceRows(snapshot.records)) return { status: "invalid_snapshot", reason_code: "DUPLICATE_SOURCE_RECORD" };
  const signals: QualitySignalResult[] = [];
  for (const signal of request.signals) {
    signals.push(detectOne(signal, snapshot));
    if (Buffer.byteLength(JSON.stringify(signals), "utf8") > MAX_SERIALIZED_RESULT_BYTES) {
      return { status: "limit_exceeded", reason_code: "RESULT_LIMIT_EXCEEDED" };
    }
  }
  const definitive = signals.filter((signal) => signal.status === "detected" || signal.status === "not_detected").length;
  const partialSignal = signals.some((signal) => signal.status === "partial");
  const status: QualitySignalDetectionResult["status"] = definitive === signals.length
    ? "complete"
    : definitive > 0 || partialSignal ? "partial" : "insufficient_data";
  const resultWithoutId: Omit<QualitySignalDetectionResult, "detection_id"> = {
    schema_version: QUALITY_SIGNAL_RESULT_VERSION,
    calculation_version: QUALITY_SIGNAL_CALCULATION_VERSION,
    status,
    authorization_scope: "analytical_use_only",
    source_verification: "not_asserted",
    causal_explanation: "not_assessed",
    regulatory_conclusion: "not_assessed",
    dataset: {
      organization_id: snapshot.dataset.organization_id,
      dataset_id: snapshot.dataset.dataset_id,
      dataset_version_id: snapshot.version.dataset_version_id,
      version_number: snapshot.version.version_number,
      schema_version: snapshot.version.schema_version,
      review_state: snapshot.version.review_state,
      approval_event_id: snapshot.approval.approval_event_id,
      approval_transition_number: snapshot.approval.transition_number,
    },
    sources: snapshot.sources.map((source) => ({ source_id: source.source_id, source_version_id: source.source_version_id, source_sha256: source.source_sha256 })),
    record_count: snapshot.records.length,
    signals,
  };
  const detectionId = createHash("sha256").update(JSON.stringify({ request, approval_event_id: snapshot.approval.approval_event_id, calculation_version: QUALITY_SIGNAL_CALCULATION_VERSION })).digest("hex");
  const result: QualitySignalDetectionResult = { ...resultWithoutId, detection_id: detectionId };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_SERIALIZED_RESULT_BYTES) return { status: "limit_exceeded", reason_code: "RESULT_LIMIT_EXCEEDED" };
  return { status: "calculated", result };
}
