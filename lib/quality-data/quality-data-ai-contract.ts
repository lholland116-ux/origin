import { z } from "zod";

export const QUALITY_DATA_EXTERNAL_AI_OPT_IN_VERSION = "quality-data-external-ai-opt-in-1.0.0" as const;
export const QUALITY_DATA_AI_ANALYSIS_REQUEST_VERSION = "quality-data-ai-analysis-request-1.0.0" as const;
export const QUALITY_DATA_AI_ANALYSIS_RESULT_VERSION = "quality-data-ai-analysis-result-1.0.0" as const;
export const QUALITY_DATA_EVIDENCE_PACKET_VERSION = "quality-evidence-packet-1.0.0" as const;

export const qualityDataExternalAiOptInCommandSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_EXTERNAL_AI_OPT_IN_VERSION),
  decision: z.enum(["enabled", "disabled"]),
  expected_transition_number: z.number().int().min(0).max(100_000),
  rationale: z.string().trim().min(1).max(1_000),
}).strict();

export type QualityDataExternalAiOptInCommand = z.infer<typeof qualityDataExternalAiOptInCommandSchema>;

export interface QualityDataExternalAiOptInState {
  readonly organization_id: string;
  readonly decision: "enabled" | "disabled";
  readonly event_id: string;
  readonly transition_number: number;
  readonly actor_user_id: string;
  readonly actor_membership_id: string;
  readonly occurred_at: string;
  readonly rationale: string;
}

const code = z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/);
const opaqueHandle = z.string().uuid();

/** A provider-safe, aggregate-only view. It deliberately has no org, dataset, source, row, cell, or free-text fields. */
export const qualityEvidencePacketSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_EVIDENCE_PACKET_VERSION),
  packet_id: z.string().uuid(),
  calculation_versions: z.array(z.string().min(1).max(80)).min(1).max(2),
  time_windows: z.array(z.string().regex(/^(ALL_APPROVED_RECORDS|\d{4}-\d{2})$/)).max(120),
  assumptions: z.array(code).max(20),
  data_quality_limitations: z.array(code).max(40),
  calculations: z.array(z.object({
    reference: code,
    kind: z.enum(["FIELD_COMPLETENESS", "NUMERIC_SUMMARY"]),
    status: z.enum(["COMPLETE", "MISSING_DATA", "UNIT_MISMATCH"]),
    sample_size: z.number().int().nonnegative().max(10_000),
    numerator_count: z.number().int().nonnegative().max(10_000),
    denominator_count: z.number().int().nonnegative().max(10_000),
    excluded_counts: z.object({ missing_field: z.number().int().nonnegative(), missing_value: z.number().int().nonnegative(), non_numeric: z.number().int().nonnegative() }).strict(),
    unit: z.enum(["COUNT", "UNIT", "PIECE", "KG", "G", "LB", "L", "ML", "M", "CM", "MM", "PERCENT", "UNSPECIFIED"]),
    value: z.number().finite().nullable(),
    minimum: z.number().finite().nullable(),
    maximum: z.number().finite().nullable(),
    evidence_handles: z.array(opaqueHandle).max(256),
  }).strict()).max(20),
  signals: z.array(z.object({
    reference: code,
    kind: z.enum(["RECURRING_CATEGORY", "DEFECT_RATE_THRESHOLD", "DEFECT_RATE_TREND"]),
    status: z.enum(["DETECTED", "NOT_DETECTED", "PARTIAL", "INSUFFICIENT_DATA", "UNSUPPORTED_SCHEMA", "UNSUPPORTED_CONFIGURATION"]),
    sample_size: z.number().int().nonnegative().max(10_000),
    minimum_sample_size: z.number().int().nonnegative().max(10_000),
    exclusions: z.record(z.string().max(64), z.number().int().nonnegative()).refine((value) => Object.keys(value).length <= 8),
    threshold: z.number().finite().nullable(),
    rate_per: z.number().int().positive().nullable(),
    unit: z.enum(["COUNT", "UNIT", "PIECE", "KG", "G", "LB", "L", "ML", "M", "CM", "MM", "PERCENT", "UNSPECIFIED"]),
    category_groups: z.array(z.object({ alias: code, occurrence_count: z.number().int().nonnegative(), evidence_handles: z.array(opaqueHandle).min(1).max(64) }).strict()).max(100),
    monthly_buckets: z.array(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(["EVALUATED", "INSUFFICIENT_DATA"]), sample_size: z.number().int().nonnegative(), numerator_total: z.number().finite().nonnegative().nullable(), denominator_total: z.number().finite().nonnegative().nullable(), rate: z.number().finite().nonnegative().nullable(), threshold: z.number().finite().nonnegative().nullable(), triggered: z.boolean().nullable(), evidence_handles: z.array(opaqueHandle).max(256) }).strict()).max(120),
    change_comparisons: z.array(z.object({ from_period: z.string().regex(/^\d{4}-\d{2}$/), to_period: z.string().regex(/^\d{4}-\d{2}$/), change: z.number().finite().nullable(), triggered: z.boolean().nullable(), evidence_handles: z.array(opaqueHandle).max(256) }).strict()).max(120),
    evidence_handles: z.array(opaqueHandle).max(256),
  }).strict()).max(10),
}).strict();

export type QualityEvidencePacket = z.infer<typeof qualityEvidencePacketSchema>;

export const qualityDataAiAnalysisRequestSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_AI_ANALYSIS_REQUEST_VERSION),
  dataset_version_id: z.string().uuid(),
  metrics: z.array(z.discriminatedUnion("kind", [
    z.object({ metric_id: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/), kind: z.literal("field_completeness"), field_key: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/) }).strict(),
    z.object({ metric_id: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/), kind: z.literal("numeric_summary"), field_key: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/) }).strict(),
  ])).min(1).max(20),
  signals: z.array(z.unknown()).min(1).max(10),
}).strict();

export type QualityDataAiAnalysisRequest = z.infer<typeof qualityDataAiAnalysisRequestSchema>;

const modelFinding = z.object({
  text: z.string().trim().min(1).max(700),
  evidence_refs: z.array(opaqueHandle).min(1).max(8),
}).strict();

export const qualityDataAiModelOutputSchema = z.object({
  possible_causes: z.array(modelFinding).max(8),
  uncertainty: z.array(modelFinding).max(8),
  human_investigation_steps: z.array(modelFinding).max(8),
  advisory_only: z.literal(true),
  causal_proof: z.literal(false),
  capa_decision: z.literal(false),
}).strict();
export type QualityDataAiModelOutput = z.infer<typeof qualityDataAiModelOutputSchema>;

export const QUALITY_DATA_AI_OUTPUT_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["possible_causes", "uncertainty", "human_investigation_steps", "advisory_only", "causal_proof", "capa_decision"],
  properties: {
    possible_causes: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["text", "evidence_refs"], properties: { text: { type: "string" }, evidence_refs: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } } } } },
    uncertainty: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["text", "evidence_refs"], properties: { text: { type: "string" }, evidence_refs: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } } } } },
    human_investigation_steps: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["text", "evidence_refs"], properties: { text: { type: "string" }, evidence_refs: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } } } } },
    advisory_only: { type: "boolean", const: true }, causal_proof: { type: "boolean", const: false }, capa_decision: { type: "boolean", const: false },
  },
} as const;

export interface QualityEvidenceCitation {
  readonly handle: string;
  readonly record_id: string;
  readonly record_ordinal: number;
  readonly source_worksheet: string;
  readonly source_row_number: number;
  readonly source_cells: readonly string[];
  readonly source_id: string;
  readonly source_version_id: string;
  readonly source_sha256: string;
}

export interface QualityDataAiAnalysisResult {
  readonly schema_version: typeof QUALITY_DATA_AI_ANALYSIS_RESULT_VERSION;
  readonly packet_version: typeof QUALITY_DATA_EVIDENCE_PACKET_VERSION;
  readonly status: "complete";
  readonly verified_calculations: QualityEvidencePacket["calculations"];
  readonly observed_signals: QualityEvidencePacket["signals"];
  readonly time_windows: QualityEvidencePacket["time_windows"];
  readonly assumptions: QualityEvidencePacket["assumptions"];
  readonly data_quality_limitations: readonly string[];
  readonly interpretation: QualityDataAiModelOutput;
  readonly interpretation_status: "unverified_advisory_hypotheses";
  readonly source_verification: "not_asserted";
  readonly authorization_scope: "analytical_use_only";
  readonly evidence_citations: readonly QualityEvidenceCitation[];
}
