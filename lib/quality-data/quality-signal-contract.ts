import { z } from "zod";

export const QUALITY_SIGNAL_REQUEST_VERSION = "quality-signal-request-1.0.0";
export const QUALITY_SIGNAL_RESULT_VERSION = "quality-signal-result-1.0.0";
export const QUALITY_SIGNAL_CALCULATION_VERSION = "quality-signal-calculation-1.0.0";
export const QUALITY_SIGNAL_MAX_DEFINITIONS = 10;
export const QUALITY_SIGNAL_MAX_RESULT_BYTES = 5 * 1024 * 1024;

const code = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const common = { signal_id: code };
const minimumSample = z.number().int().min(3).max(10_000);

const recurringSignalRequestSchema = z.object({
  ...common,
  kind: z.literal("recurring_category"),
  semantic_role: z.enum(["defect_code", "failure_mode"]),
  field_key: code,
  minimum_occurrences: z.number().int().min(2).max(10_000),
  minimum_sample_size: minimumSample,
  time_window: z.object({ kind: z.literal("all_records_in_dataset_version") }).strict(),
}).strict();

const rateThresholdSignalRequestSchema = z.object({
  ...common,
  kind: z.literal("defect_rate_threshold"),
  defect_count_field_key: code,
  production_quantity_field_key: code,
  observation_date_field_key: code,
  production_quantity_unit: code,
  rate_per: z.number().int().min(1).max(1_000_000),
  threshold: z.number().finite().nonnegative().max(1_000_000_000),
  minimum_records_per_window: minimumSample,
  time_window: z.object({ kind: z.literal("calendar_month") }).strict(),
}).strict().superRefine((value, context) => {
  if (new Set([value.defect_count_field_key, value.production_quantity_field_key, value.observation_date_field_key]).size !== 3) {
    context.addIssue({ code: "custom", path: ["observation_date_field_key"], message: "SIGNAL_FIELDS_MUST_BE_DISTINCT" });
  }
});

const rateTrendSignalRequestSchema = z.object({
  ...common,
  kind: z.literal("defect_rate_trend"),
  defect_count_field_key: code,
  production_quantity_field_key: code,
  observation_date_field_key: code,
  production_quantity_unit: code,
  rate_per: z.number().int().min(1).max(1_000_000),
  direction: z.enum(["increase", "decrease", "either"]),
  minimum_absolute_change: z.number().finite().positive().max(1_000_000_000),
  minimum_records_per_window: minimumSample,
  time_window: z.object({ kind: z.literal("calendar_month") }).strict(),
}).strict().superRefine((value, context) => {
  if (new Set([value.defect_count_field_key, value.production_quantity_field_key, value.observation_date_field_key]).size !== 3) {
    context.addIssue({ code: "custom", path: ["observation_date_field_key"], message: "SIGNAL_FIELDS_MUST_BE_DISTINCT" });
  }
});

export const qualitySignalDetectionRequestSchema = z.object({
  schema_version: z.literal(QUALITY_SIGNAL_REQUEST_VERSION),
  dataset_version_id: z.string().uuid(),
  signals: z.array(z.discriminatedUnion("kind", [
    recurringSignalRequestSchema,
    rateThresholdSignalRequestSchema,
    rateTrendSignalRequestSchema,
  ])).min(1).max(QUALITY_SIGNAL_MAX_DEFINITIONS),
}).strict().superRefine((request, context) => {
  const ids = new Set<string>();
  for (const [index, signal] of request.signals.entries()) {
    if (ids.has(signal.signal_id)) context.addIssue({ code: "custom", path: ["signals", index, "signal_id"], message: "DUPLICATE_SIGNAL_ID" });
    ids.add(signal.signal_id);
  }
});

export type QualitySignalDetectionRequest = z.infer<typeof qualitySignalDetectionRequestSchema>;
export type QualitySignalDefinition = QualitySignalDetectionRequest["signals"][number];

export interface QualitySignalEvidenceCell {
  readonly field_key: string;
  readonly value_type: string;
  readonly original_value: string | number | boolean | null;
  readonly normalized_value: string | number | boolean | null;
  readonly normalized_unit: string | null;
  readonly source_cell_reference: string | null;
}

export interface QualitySignalEvidenceRecord {
  readonly record_id: string;
  readonly record_ordinal: number;
  readonly source_worksheet: string;
  readonly source_row_number: number;
  readonly cells: readonly QualitySignalEvidenceCell[];
}

export interface QualitySignalExcludedInput extends QualitySignalEvidenceRecord {
  readonly reason: "missing_field" | "missing_value" | "invalid_number" | "invalid_date" | "zero_denominator" | "missing_provenance";
}

export interface QualitySignalExclusionCounts {
  readonly missing_field: number;
  readonly missing_value: number;
  readonly invalid_number: number;
  readonly invalid_date: number;
  readonly zero_denominator: number;
  readonly missing_provenance: number;
}

export interface QualityRecurringCategorySignalResult {
  readonly signal_id: string;
  readonly kind: "recurring_category";
  readonly semantic_role: "defect_code" | "failure_mode";
  readonly field_key: string;
  readonly status: "detected" | "not_detected" | "partial" | "insufficient_data" | "unsupported_schema" | "unsupported_configuration";
  readonly reason_code?: "FIELD_NOT_PRESENT" | "FIELD_TYPE_MISMATCH" | "INSUFFICIENT_SAMPLE";
  readonly sample_record_count: number;
  readonly minimum_sample_size: number;
  readonly minimum_occurrences: number;
  readonly exclusions: Pick<QualitySignalExclusionCounts, "missing_field" | "missing_value" | "invalid_number" | "invalid_date" | "zero_denominator" | "missing_provenance">;
  readonly excluded_inputs: readonly QualitySignalExcludedInput[];
  readonly observed_patterns: readonly {
    readonly value: string;
    readonly occurrence_count: number;
    readonly evidence: readonly QualitySignalEvidenceRecord[];
  }[];
  readonly time_window: "all_records_in_dataset_version";
}

export interface QualitySignalRateBucket {
  readonly period: string;
  readonly status: "evaluated" | "insufficient_data";
  readonly sample_record_count: number;
  readonly minimum_records_per_window: number;
  readonly defect_count_total: number | null;
  readonly production_quantity_total: number | null;
  readonly rate: number | null;
  readonly rate_unit: string;
  readonly threshold: number | null;
  readonly triggered: boolean | null;
  readonly reason_code?: "INSUFFICIENT_SAMPLE" | "ZERO_DENOMINATOR" | "NUMERIC_OVERFLOW";
  readonly calculation_inputs: readonly QualitySignalEvidenceRecord[];
}

export interface QualitySignalRateThresholdResult {
  readonly signal_id: string;
  readonly kind: "defect_rate_threshold";
  readonly status: "detected" | "not_detected" | "partial" | "insufficient_data" | "unsupported_schema" | "unsupported_configuration";
  readonly reason_code?: "FIELD_NOT_PRESENT" | "FIELD_TYPE_MISMATCH" | "UNIT_MISMATCH" | "NO_VALID_WINDOWS" | "TIME_WINDOW_LIMIT_EXCEEDED";
  readonly rate_definition: {
    readonly defect_count_field_key: string;
    readonly defect_count_unit: "count";
    readonly production_quantity_field_key: string;
    readonly production_quantity_unit: string;
    readonly observation_date_field_key: string;
    readonly window: "calendar_month";
    readonly rate_per: number;
    readonly formula: "sum(defect_count) / sum(production_quantity) * rate_per";
    readonly comparison: "greater_than_or_equal";
    readonly threshold: number;
  };
  readonly exclusions: QualitySignalExclusionCounts;
  readonly excluded_inputs: readonly QualitySignalExcludedInput[];
  readonly buckets: readonly QualitySignalRateBucket[];
}

export interface QualitySignalRateTrendResult {
  readonly signal_id: string;
  readonly kind: "defect_rate_trend";
  readonly status: "detected" | "not_detected" | "partial" | "insufficient_data" | "unsupported_schema" | "unsupported_configuration";
  readonly reason_code?: "FIELD_NOT_PRESENT" | "FIELD_TYPE_MISMATCH" | "UNIT_MISMATCH" | "NO_ADJACENT_WINDOWS" | "INSUFFICIENT_SAMPLE" | "TIME_WINDOW_LIMIT_EXCEEDED";
  readonly rate_definition: Omit<QualitySignalRateThresholdResult["rate_definition"], "comparison" | "threshold"> & {
    readonly trend_direction: "increase" | "decrease" | "either";
    readonly minimum_absolute_change: number;
    readonly change_unit: string;
  };
  readonly exclusions: QualitySignalExclusionCounts;
  readonly excluded_inputs: readonly QualitySignalExcludedInput[];
  readonly buckets: readonly QualitySignalRateBucket[];
  readonly comparisons: readonly {
    readonly from_period: string;
    readonly to_period: string;
    readonly status: "evaluated" | "insufficient_data";
    readonly change: number | null;
    readonly absolute_change: number | null;
    readonly triggered: boolean | null;
    readonly reason_code?: "NON_ADJACENT_WINDOWS" | "INSUFFICIENT_SAMPLE";
    readonly calculation_inputs: readonly QualitySignalEvidenceRecord[];
  }[];
}

export type QualitySignalResult = QualityRecurringCategorySignalResult | QualitySignalRateThresholdResult | QualitySignalRateTrendResult;

export interface QualitySignalDetectionResult {
  readonly schema_version: typeof QUALITY_SIGNAL_RESULT_VERSION;
  readonly calculation_version: typeof QUALITY_SIGNAL_CALCULATION_VERSION;
  readonly detection_id: string;
  readonly status: "complete" | "partial" | "insufficient_data";
  readonly authorization_scope: "analytical_use_only";
  readonly source_verification: "not_asserted";
  readonly causal_explanation: "not_assessed";
  readonly regulatory_conclusion: "not_assessed";
  readonly dataset: {
    readonly organization_id: string;
    readonly dataset_id: string;
    readonly dataset_version_id: string;
    readonly version_number: number;
    readonly schema_version: string;
    readonly review_state: "review_required";
    readonly approval_event_id: string;
    readonly approval_transition_number: number;
  };
  readonly sources: readonly { readonly source_id: string; readonly source_version_id: string; readonly source_sha256: string }[];
  readonly record_count: number;
  readonly signals: readonly QualitySignalResult[];
}

const signalEvidenceCellSchema = z.object({
  field_key: code,
  value_type: z.string().min(1).max(32),
  original_value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  normalized_value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  normalized_unit: z.string().max(32).nullable(),
  source_cell_reference: z.string().max(32).nullable(),
}).strict();
const signalEvidenceRecordSchema = z.object({
  record_id: z.string().uuid(), record_ordinal: z.number().int().positive(),
  source_worksheet: z.string().min(1).max(128), source_row_number: z.number().int().positive(),
  cells: z.array(signalEvidenceCellSchema).max(3),
}).strict();
const excludedInputSchema = signalEvidenceRecordSchema.extend({
  reason: z.enum(["missing_field", "missing_value", "invalid_number", "invalid_date", "zero_denominator", "missing_provenance"]),
});
const exclusionsSchema = z.object({
  missing_field: z.number().int().nonnegative(), missing_value: z.number().int().nonnegative(),
  invalid_number: z.number().int().nonnegative(), invalid_date: z.number().int().nonnegative(),
  zero_denominator: z.number().int().nonnegative(), missing_provenance: z.number().int().nonnegative(),
}).strict();

const recurringSignalResultSchema = z.object({
  signal_id: code, kind: z.literal("recurring_category"), semantic_role: z.enum(["defect_code", "failure_mode"]), field_key: code,
  status: z.enum(["detected", "not_detected", "partial", "insufficient_data", "unsupported_schema", "unsupported_configuration"]),
  reason_code: z.enum(["FIELD_NOT_PRESENT", "FIELD_TYPE_MISMATCH", "INSUFFICIENT_SAMPLE"]).optional(),
  sample_record_count: z.number().int().nonnegative(), minimum_sample_size: minimumSample,
  minimum_occurrences: z.number().int().min(2).max(10_000), exclusions: exclusionsSchema, excluded_inputs: z.array(excludedInputSchema).max(10_000),
  observed_patterns: z.array(z.object({
    value: z.string().max(QUALITY_SIGNAL_MAX_RESULT_BYTES), occurrence_count: z.number().int().min(2).max(10_000),
    evidence: z.array(signalEvidenceRecordSchema).min(2).max(10_000),
  }).strict()).max(10_000), time_window: z.literal("all_records_in_dataset_version"),
}).strict();

const rateBucketSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(["evaluated", "insufficient_data"]),
  sample_record_count: z.number().int().nonnegative(), minimum_records_per_window: minimumSample,
  defect_count_total: z.number().finite().nonnegative().nullable(), production_quantity_total: z.number().finite().nonnegative().nullable(),
  rate: z.number().finite().nonnegative().nullable(), rate_unit: z.string().min(1).max(300), threshold: z.number().finite().nonnegative().nullable(),
  triggered: z.boolean().nullable(), reason_code: z.enum(["INSUFFICIENT_SAMPLE", "ZERO_DENOMINATOR", "NUMERIC_OVERFLOW"]).optional(),
  calculation_inputs: z.array(signalEvidenceRecordSchema).max(10_000),
}).strict();
const rateDefinitionBaseSchema = z.object({
  defect_count_field_key: code, defect_count_unit: z.literal("count"), production_quantity_field_key: code,
  production_quantity_unit: code, observation_date_field_key: code, window: z.literal("calendar_month"),
  rate_per: z.number().int().min(1).max(1_000_000),
  formula: z.literal("sum(defect_count) / sum(production_quantity) * rate_per"),
}).strict();
const rateThresholdResultSchema = z.object({
  signal_id: code, kind: z.literal("defect_rate_threshold"), status: z.enum(["detected", "not_detected", "partial", "insufficient_data", "unsupported_schema", "unsupported_configuration"]),
  reason_code: z.enum(["FIELD_NOT_PRESENT", "FIELD_TYPE_MISMATCH", "UNIT_MISMATCH", "NO_VALID_WINDOWS", "TIME_WINDOW_LIMIT_EXCEEDED"]).optional(),
  rate_definition: rateDefinitionBaseSchema.extend({ comparison: z.literal("greater_than_or_equal"), threshold: z.number().finite().nonnegative() }),
  exclusions: exclusionsSchema, excluded_inputs: z.array(excludedInputSchema).max(10_000), buckets: z.array(rateBucketSchema).max(120),
}).strict();
const rateTrendResultSchema = z.object({
  signal_id: code, kind: z.literal("defect_rate_trend"), status: z.enum(["detected", "not_detected", "partial", "insufficient_data", "unsupported_schema", "unsupported_configuration"]),
  reason_code: z.enum(["FIELD_NOT_PRESENT", "FIELD_TYPE_MISMATCH", "UNIT_MISMATCH", "NO_ADJACENT_WINDOWS", "INSUFFICIENT_SAMPLE", "TIME_WINDOW_LIMIT_EXCEEDED"]).optional(),
  rate_definition: rateDefinitionBaseSchema.extend({
    trend_direction: z.enum(["increase", "decrease", "either"]), minimum_absolute_change: z.number().finite().positive(), change_unit: z.string().min(1).max(300),
  }),
  exclusions: exclusionsSchema, excluded_inputs: z.array(excludedInputSchema).max(10_000), buckets: z.array(rateBucketSchema).max(120),
  comparisons: z.array(z.object({
    from_period: z.string().regex(/^\d{4}-\d{2}$/), to_period: z.string().regex(/^\d{4}-\d{2}$/),
    status: z.enum(["evaluated", "insufficient_data"]), change: z.number().finite().nullable(), absolute_change: z.number().finite().nonnegative().nullable(),
    triggered: z.boolean().nullable(), reason_code: z.enum(["NON_ADJACENT_WINDOWS", "INSUFFICIENT_SAMPLE"]).optional(),
    calculation_inputs: z.array(signalEvidenceRecordSchema).max(10_000),
  }).strict()).max(120),
}).strict();

export const qualitySignalDetectionResultSchema = z.object({
  schema_version: z.literal(QUALITY_SIGNAL_RESULT_VERSION), calculation_version: z.literal(QUALITY_SIGNAL_CALCULATION_VERSION),
  detection_id: z.string().regex(/^[0-9a-f]{64}$/), status: z.enum(["complete", "partial", "insufficient_data"]),
  authorization_scope: z.literal("analytical_use_only"), source_verification: z.literal("not_asserted"),
  causal_explanation: z.literal("not_assessed"), regulatory_conclusion: z.literal("not_assessed"),
  dataset: z.object({ organization_id: z.string().uuid(), dataset_id: z.string().uuid(), dataset_version_id: z.string().uuid(),
    version_number: z.number().int().positive(), schema_version: z.string().min(1).max(100), review_state: z.literal("review_required"),
    approval_event_id: z.string().uuid(), approval_transition_number: z.number().int().positive() }).strict(),
  sources: z.array(z.object({ source_id: z.string().uuid(), source_version_id: z.string().uuid(), source_sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).length(1),
  record_count: z.number().int().nonnegative().max(10_000),
  signals: z.array(z.discriminatedUnion("kind", [recurringSignalResultSchema, rateThresholdResultSchema, rateTrendResultSchema])).min(1).max(QUALITY_SIGNAL_MAX_DEFINITIONS),
}).strict();
