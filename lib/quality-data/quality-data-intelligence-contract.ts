import { z } from "zod";
import {
  QUALITY_DATA_AI_ANALYSIS_REQUEST_VERSION,
  qualityDataAiAnalysisRequestSchema,
  qualityDataAiAnalysisResultSchema,
  type QualityDataAiAnalysisResult,
} from "./quality-data-ai-contract";
import { qualityDataDeterministicAnalysisRequestSchema, qualityDataDeterministicAnalysisResultSchema, type QualityDataDeterministicAnalysisRequest, type QualityDataDeterministicAnalysisResult } from "./quality-data-deterministic-contract";

export const QUALITY_DATA_INTELLIGENCE_REPORT_VERSION = "quality-data-intelligence-report-1.0.0" as const;
export const QUALITY_DATA_INTELLIGENCE_REVIEW_VERSION = "quality-data-intelligence-review-1.0.0" as const;

export const qualityDataIntelligenceRequestSchema = qualityDataAiAnalysisRequestSchema.extend({
  schema_version: z.literal(QUALITY_DATA_AI_ANALYSIS_REQUEST_VERSION),
}).strict();
export type QualityDataIntelligenceRequest = z.infer<typeof qualityDataIntelligenceRequestSchema>;

export const QUALITY_DATA_INTELLIGENCE_REVIEW_DECISIONS = [
  "acknowledged",
  "follow_up_requested",
  "deferred",
] as const;

// Decisions record reviewer triage only. They do not affirm truth, verify
// source evidence, express regulatory disposition, or mutate a CAPA case.
export const qualityDataIntelligenceReviewCommandSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_INTELLIGENCE_REVIEW_VERSION),
  report_id: z.string().uuid(),
  finding_key: z.string().min(1).max(40).regex(/^(signal:S[1-9][0-9]*|metric:M[1-9][0-9]*|possible_cause:[0-7]|uncertainty:[0-7]|investigation_step:[0-7])$/),
  expected_transition_number: z.number().int().min(0).max(100_000),
  decision: z.enum(QUALITY_DATA_INTELLIGENCE_REVIEW_DECISIONS),
  rationale: z.string().trim().min(3).max(1_000),
}).strict();
export type QualityDataIntelligenceReviewCommand = z.infer<typeof qualityDataIntelligenceReviewCommandSchema>;

export interface QualityDataIntelligenceReport {
  readonly report_id: string;
  readonly organization_id: string;
  readonly dataset_id: string;
  readonly dataset_version_id: string;
  readonly approval_event_id: string;
  readonly requested_by_user_id: string;
  readonly requested_by_membership_id: string;
  readonly request_payload: QualityDataIntelligenceRequest | QualityDataDeterministicAnalysisRequest;
  readonly request_fingerprint: string;
  readonly status: "processing" | "complete" | "failed";
  readonly result: QualityDataIntelligenceResult | null;
  readonly result_fingerprint: string | null;
  readonly failure_code: string | null;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly created_at: string;
  readonly finalized_at: string | null;
}

export const qualityDataIntelligenceResultSchema = z.union([
  qualityDataAiAnalysisResultSchema,
  qualityDataDeterministicAnalysisResultSchema,
]);
export type QualityDataIntelligenceResult = QualityDataAiAnalysisResult | QualityDataDeterministicAnalysisResult;

export const qualityDataIntelligenceReportRequestSchema = z.union([
  qualityDataIntelligenceRequestSchema,
  qualityDataDeterministicAnalysisRequestSchema,
]);
export type QualityDataIntelligenceReportRequest = z.infer<typeof qualityDataIntelligenceReportRequestSchema>;

export interface QualityDataIntelligenceReviewEvent {
  readonly event_id: string;
  readonly organization_id: string;
  readonly report_id: string;
  readonly dataset_id: string;
  readonly dataset_version_id: string;
  readonly approval_event_id: string;
  readonly finding_key: string;
  readonly finding_fingerprint: string;
  readonly transition_number: number;
  readonly decision: typeof QUALITY_DATA_INTELLIGENCE_REVIEW_DECISIONS[number];
  readonly reviewer_user_id: string;
  readonly reviewer_membership_id: string;
  readonly occurred_at: string;
  readonly rationale: string;
  readonly previous_event_id: string | null;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
}

export const qualityDataAiAnalysisResultPersistenceSchema = qualityDataAiAnalysisResultSchema;
