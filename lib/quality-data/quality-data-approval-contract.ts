import { z } from "zod";

export const QUALITY_DATA_APPROVAL_SCHEMA_VERSION = "quality-data-analytical-approval-1.0.0";
export const QUALITY_DATA_APPROVAL_DECISIONS = ["approved", "rejected", "revoked"] as const;

export const qualityDataVersionApprovalCommandSchema = z.object({
  schema_version: z.literal(QUALITY_DATA_APPROVAL_SCHEMA_VERSION),
  dataset_version_id: z.string().uuid(),
  decision: z.enum(QUALITY_DATA_APPROVAL_DECISIONS),
  expected_transition_number: z.number().int().min(0).max(100_000),
  rationale: z.string().trim().min(1).max(1_000),
}).strict();

export type QualityDataVersionApprovalCommand = z.infer<typeof qualityDataVersionApprovalCommandSchema>;

export interface QualityDataVersionApprovalState {
  readonly organization_id: string;
  readonly dataset_id: string;
  readonly dataset_version_id: string;
  readonly decision: typeof QUALITY_DATA_APPROVAL_DECISIONS[number];
  readonly approval_event_id: string;
  readonly transition_number: number;
  readonly reviewer_user_id: string;
  readonly reviewer_membership_id: string;
  readonly occurred_at: string;
  readonly rationale: string;
}
