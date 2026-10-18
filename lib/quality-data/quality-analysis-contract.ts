import { z } from "zod";

export const QUALITY_ANALYSIS_REQUEST_VERSION = "quality-analysis-request-1.0.0";
export const QUALITY_ANALYSIS_RESULT_VERSION = "quality-analysis-result-1.0.0";
export const QUALITY_ANALYSIS_CALCULATION_VERSION = "quality-analysis-calculation-1.0.0";
export const QUALITY_ANALYSIS_MAX_METRICS = 20;
export const QUALITY_ANALYSIS_MAX_RESULT_BYTES = 5 * 1024 * 1024;

const code = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const qualityAnalysisRequestSchema = z.object({
  schema_version: z.literal(QUALITY_ANALYSIS_REQUEST_VERSION),
  dataset_version_id: z.string().uuid(),
  time_window: z.object({ kind: z.literal("all_records_in_dataset_version") }).strict(),
  metrics: z.array(z.discriminatedUnion("kind", [
    z.object({ metric_id: code, kind: z.literal("field_completeness"), field_key: code }).strict(),
    z.object({ metric_id: code, kind: z.literal("numeric_summary"), field_key: code }).strict(),
  ])).min(1).max(QUALITY_ANALYSIS_MAX_METRICS),
}).strict().superRefine((request, context) => {
  const ids = new Set<string>();
  for (const [index, metric] of request.metrics.entries()) {
    if (ids.has(metric.metric_id)) {
      context.addIssue({ code: "custom", path: ["metrics", index, "metric_id"], message: "DUPLICATE_METRIC_ID" });
    }
    ids.add(metric.metric_id);
  }
});

export type QualityAnalysisRequest = z.infer<typeof qualityAnalysisRequestSchema>;
export type QualityAnalysisMetricRequest = QualityAnalysisRequest["metrics"][number];

export interface QualityAnalysisSourceReference {
  readonly source_id: string;
  readonly source_version_id: string;
  readonly source_sha256: string;
  readonly original_source_version: string;
  readonly source_name: string;
}

export interface QualityAnalysisFieldReference {
  readonly dataset_id: string;
  readonly dataset_version_id: string;
  readonly record_id: string;
  readonly record_ordinal: number;
  readonly field_id: string | null;
  readonly field_key: string;
  readonly value_type: string | null;
  readonly original_value: string | number | boolean | null;
  readonly normalized_value: string | number | boolean | null;
  readonly normalized_unit: string | null;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly source_sha256: string;
  readonly source_worksheet: string;
  readonly source_row_number: number;
  readonly source_cell_reference: string | null;
}

export type QualityAnalysisExclusionReason = "missing_field" | "missing_value" | "non_numeric";

export interface QualityAnalysisMetricResult {
  readonly metric_id: string;
  readonly kind: "field_completeness" | "numeric_summary";
  readonly field_key: string;
  readonly status: "complete" | "missing_data" | "unit_mismatch";
  readonly denominator_record_count: number;
  readonly numerator_record_count: number;
  readonly exclusions: Readonly<Record<QualityAnalysisExclusionReason, number>>;
  readonly unit: string | null;
  readonly unit_status: "not_applicable" | "consistent" | "unspecified" | "mixed";
  readonly value: number | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly calculation_inputs: readonly QualityAnalysisFieldReference[];
  readonly reason_code?: "FIELD_NOT_PRESENT" | "NO_VALID_VALUES" | "MIXED_UNITS" | "EMPTY_DATASET" | "NUMERIC_OVERFLOW";
}

export interface QualityAnalysisResult {
  readonly schema_version: typeof QUALITY_ANALYSIS_RESULT_VERSION;
  readonly calculation_version: typeof QUALITY_ANALYSIS_CALCULATION_VERSION;
  readonly analysis_id: string;
  readonly status: "complete" | "partial" | "missing_data";
  readonly time_window: "all_records_in_dataset_version";
  readonly denominator_definition: "all records in the approved immutable dataset version";
  readonly authorization_scope: "analytical_use_only";
  readonly source_verification: "not_asserted";
  readonly dataset: {
    readonly organization_id: string;
    readonly dataset_id: string;
    readonly dataset_version_id: string;
    readonly version_number: number;
    readonly schema_version: string;
    readonly review_state: "review_required";
  };
  readonly approval: {
    readonly approval_event_id: string;
    readonly transition_number: number;
    readonly reviewer_user_id: string;
    readonly approved_at: string;
  };
  readonly sources: readonly QualityAnalysisSourceReference[];
  readonly record_count: number;
  readonly metrics: readonly QualityAnalysisMetricResult[];
  readonly advisory_interpretation: {
    readonly status: "not_requested";
    readonly content: null;
  };
}

const analysisFieldReferenceSchema = z.object({
  dataset_id: z.string().uuid(),
  dataset_version_id: z.string().uuid(),
  record_id: z.string().uuid(),
  record_ordinal: z.number().int().positive(),
  field_id: z.string().uuid().nullable(),
  field_key: code,
  value_type: z.string().nullable(),
  original_value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  normalized_value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  normalized_unit: z.string().nullable(),
  source_id: z.string().uuid(),
  source_version_id: z.string().uuid(),
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source_worksheet: z.string().min(1).max(128),
  source_row_number: z.number().int().positive(),
  source_cell_reference: z.string().max(32).nullable(),
}).strict();

const metricResultSchema = z.object({
  metric_id: code,
  kind: z.enum(["field_completeness", "numeric_summary"]),
  field_key: code,
  status: z.enum(["complete", "missing_data", "unit_mismatch"]),
  denominator_record_count: z.number().int().nonnegative(),
  numerator_record_count: z.number().int().nonnegative(),
  exclusions: z.object({ missing_field: z.number().int().nonnegative(), missing_value: z.number().int().nonnegative(), non_numeric: z.number().int().nonnegative() }).strict(),
  unit: z.string().nullable(),
  unit_status: z.enum(["not_applicable", "consistent", "unspecified", "mixed"]),
  value: z.number().finite().nullable(),
  minimum: z.number().finite().nullable(),
  maximum: z.number().finite().nullable(),
  calculation_inputs: z.array(analysisFieldReferenceSchema).max(10_000),
  reason_code: z.enum(["FIELD_NOT_PRESENT", "NO_VALID_VALUES", "MIXED_UNITS", "EMPTY_DATASET", "NUMERIC_OVERFLOW"]).optional(),
}).strict();

export const qualityAnalysisResultSchema = z.object({
  schema_version: z.literal(QUALITY_ANALYSIS_RESULT_VERSION),
  calculation_version: z.literal(QUALITY_ANALYSIS_CALCULATION_VERSION),
  analysis_id: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["complete", "partial", "missing_data"]),
  time_window: z.literal("all_records_in_dataset_version"),
  denominator_definition: z.literal("all records in the approved immutable dataset version"),
  authorization_scope: z.literal("analytical_use_only"),
  source_verification: z.literal("not_asserted"),
  dataset: z.object({
    organization_id: z.string().uuid(), dataset_id: z.string().uuid(), dataset_version_id: z.string().uuid(),
    version_number: z.number().int().positive(), schema_version: z.string().min(1).max(100), review_state: z.literal("review_required"),
  }).strict(),
  approval: z.object({
    approval_event_id: z.string().uuid(), transition_number: z.number().int().positive(),
    reviewer_user_id: z.string().uuid(), approved_at: z.string().datetime(),
  }).strict(),
  sources: z.array(z.object({
    source_id: z.string().uuid(), source_version_id: z.string().uuid(), source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    original_source_version: z.string().min(1).max(128), source_name: z.string().min(1).max(200),
  }).strict()).min(1).max(1),
  record_count: z.number().int().nonnegative().max(10_000),
  metrics: z.array(metricResultSchema).min(1).max(QUALITY_ANALYSIS_MAX_METRICS),
  advisory_interpretation: z.object({ status: z.literal("not_requested"), content: z.null() }).strict(),
}).strict();
