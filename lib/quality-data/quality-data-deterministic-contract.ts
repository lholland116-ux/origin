import { z } from "zod";
import { qualityDataAiAnalysisRequestSchema, qualityEvidencePacketSchema } from "./quality-data-ai-contract";
import { qualitySignalDetectionRequestSchema } from "./quality-signal-contract";

export const QUALITY_DATA_DETERMINISTIC_REQUEST_VERSION = "quality-data-deterministic-analysis-request-1.0.0" as const;
export const QUALITY_DATA_DETERMINISTIC_RESULT_VERSION = "quality-data-deterministic-analysis-result-1.0.0" as const;

export const qualityDataDeterministicAnalysisRequestSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_DETERMINISTIC_REQUEST_VERSION),
  mode: z.literal("deterministic_only"),
  dataset_version_id: z.string().uuid(),
  metrics: qualityDataAiAnalysisRequestSchema.shape.metrics,
  signals: qualitySignalDetectionRequestSchema.shape.signals,
}).strict().superRefine((value, context) => {
  if (value.metrics.length === 0 && value.signals.length === 0) {
    context.addIssue({ code: "custom", path: ["metrics"], message: "ANALYSIS_CONFIGURATION_REQUIRED" });
  }
  const signalIds = new Set<string>();
  for (const [index, signal] of value.signals.entries()) {
    if (signalIds.has(signal.signal_id)) context.addIssue({ code: "custom", path: ["signals", index, "signal_id"], message: "DUPLICATE_SIGNAL_ID" });
    signalIds.add(signal.signal_id);
  }
  const metricIds = new Set<string>();
  for (const [index, metric] of value.metrics.entries()) {
    if (metricIds.has(metric.metric_id)) context.addIssue({ code: "custom", path: ["metrics", index, "metric_id"], message: "DUPLICATE_METRIC_ID" });
    metricIds.add(metric.metric_id);
  }
});

export type QualityDataDeterministicAnalysisRequest = z.infer<typeof qualityDataDeterministicAnalysisRequestSchema>;

const citationSchema = z.object({
  handle: z.string().uuid(),
  record_id: z.string().uuid(),
  record_ordinal: z.number().int().positive().max(10_000),
  source_worksheet: z.string().min(1).max(128),
  source_row_number: z.number().int().positive().max(1_000_000),
  source_cells: z.array(z.string().min(1).max(32)).max(8),
  source_id: z.string().uuid(),
  source_version_id: z.string().uuid(),
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

/** Persisted deterministic-only report contract. It contains no AI interpretation field or advisory text. */
export const qualityDataDeterministicAnalysisResultSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_DETERMINISTIC_RESULT_VERSION),
  mode: z.literal("deterministic_only"),
  packet_version: z.literal("quality-evidence-packet-1.0.0"),
  status: z.literal("complete"),
  verified_calculations: qualityEvidencePacketSchema.shape.calculations,
  observed_signals: qualityEvidencePacketSchema.shape.signals,
  time_windows: qualityEvidencePacketSchema.shape.time_windows,
  assumptions: z.array(z.string().min(1).max(64)).max(20),
  data_quality_limitations: z.array(z.string().min(1).max(64)).max(40),
  interpretation: z.null(),
  interpretation_status: z.literal("not_requested"),
  source_verification: z.literal("not_asserted"),
  authorization_scope: z.literal("analytical_use_only"),
  evidence_citations: z.array(citationSchema).min(1).max(128),
}).strict();

export type QualityDataDeterministicAnalysisResult = z.infer<typeof qualityDataDeterministicAnalysisResultSchema>;
