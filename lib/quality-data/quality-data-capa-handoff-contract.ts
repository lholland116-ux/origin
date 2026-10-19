import { z } from "zod";

export const QUALITY_DATA_CAPA_HANDOFF_VERSION = "quality-data-capa-handoff-1.0.0" as const;

export const QUALITY_DATA_CAPA_HANDOFF_DECISIONS = ["create_capa_draft"] as const;
export type QualityDataCapaHandoffDecision = typeof QUALITY_DATA_CAPA_HANDOFF_DECISIONS[number];

/** A human decision to create only the initial CAPA draft. */
export const qualityDataCapaHandoffCommandSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_CAPA_HANDOFF_VERSION),
  finding_key: z.string().min(1).max(40).regex(/^(signal:S[1-9][0-9]*|metric:M[1-9][0-9]*|possible_cause:[0-7]|uncertainty:[0-7]|investigation_step:[0-7])$/),
  expected_result_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.literal("create_capa_draft"),
  rationale: z.string().trim().min(3).max(1_000),
}).strict();

export type QualityDataCapaHandoffCommand = z.infer<typeof qualityDataCapaHandoffCommandSchema>;

export type QualityDataCapaFindingClassification =
  | "deterministic_signal"
  | "deterministic_calculation"
  | "advisory_hypothesis"
  | "advisory_uncertainty"
  | "advisory_investigation_step";

export interface QualityDataCapaHandoffResult {
  readonly status: "created" | "already_created" | "invalid_request" | "denied" | "not_found_or_not_authorized" | "not_approved" | "stale_evidence" | "conflict" | "step_up_required" | "persistence_failed";
  readonly handoff_id?: string;
  readonly capa_case_id?: string;
  readonly capa_case_status?: string;
  readonly finding_classification?: QualityDataCapaFindingClassification;
}
