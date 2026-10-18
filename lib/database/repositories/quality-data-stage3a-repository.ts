import type { RequestTrace } from "../../capa/domain/capa-types";
import type { QualityDataDatasetSnapshot, QualityDataReadScope } from "./quality-data-repository";
import type { TransactionContext } from "../transactions";
import type { QualityDataVersionApprovalCommand, QualityDataVersionApprovalState } from "../../quality-data/quality-data-approval-contract";
import type { QualityDataExternalAiOptInCommand, QualityDataExternalAiOptInState } from "../../quality-data/quality-data-ai-contract";

export interface QualityDataApprovalAppendInput {
  readonly organization_id: string;
  readonly dataset_version_id: string;
  readonly reviewer_user_id: string;
  readonly reviewer_membership_id: string;
  readonly request_trace: RequestTrace & { readonly idempotency_key: string };
  readonly command: QualityDataVersionApprovalCommand;
  readonly approval_event_id: string;
  readonly request_fingerprint: string;
  readonly now: string;
}

export type QualityDataApprovalAppendResult =
  | { readonly status: "applied" | "already_recorded"; readonly state: QualityDataVersionApprovalState }
  | { readonly status: "unauthorized" | "not_found" }
  | { readonly status: "conflict"; readonly reason_code: "IDEMPOTENCY_KEY_REUSED" | "STALE_TRANSITION" | "INVALID_TRANSITION" };

export type QualityDataApprovedSnapshotResult =
  | { readonly status: "approved"; readonly snapshot: QualityDataDatasetSnapshot; readonly approval: QualityDataVersionApprovalState }
  | { readonly status: "not_approved"; readonly decision: "none" | "rejected" | "revoked" };

export interface QualityDataApprovalSummary {
  readonly dataset_id: string;
  readonly dataset_version_id: string;
  readonly current_decision: "approved" | "rejected" | "revoked" | null;
  readonly transition_number: number;
  readonly current_event: QualityDataVersionApprovalState | null;
}

export interface QualityDataExternalAiOptInAppendInput {
  readonly organization_id: string;
  readonly actor_user_id: string;
  readonly actor_membership_id: string;
  readonly request_trace: RequestTrace & { readonly idempotency_key: string };
  readonly command: QualityDataExternalAiOptInCommand;
  readonly event_id: string;
  readonly request_fingerprint: string;
  readonly now: string;
}

export type QualityDataExternalAiOptInAppendResult =
  | { readonly status: "applied" | "already_recorded"; readonly state: QualityDataExternalAiOptInState }
  | { readonly status: "unauthorized" }
  | { readonly status: "conflict"; readonly reason_code: "IDEMPOTENCY_KEY_REUSED" | "STALE_TRANSITION" };

export interface QualityDataStage3ARepository {
  appendVersionApproval(
    transaction: TransactionContext,
    input: QualityDataApprovalAppendInput,
  ): Promise<QualityDataApprovalAppendResult>;

  findApprovedDatasetVersion(
    scope: QualityDataReadScope,
    datasetVersionId: string,
  ): Promise<QualityDataApprovedSnapshotResult | null>;

  findVersionApprovalSummary(
    scope: QualityDataReadScope,
    datasetVersionId: string,
  ): Promise<QualityDataApprovalSummary | null>;

  /** Optional until the external-AI opt-in migration is applied; callers fail closed when absent. */
  appendExternalAiOptInEvent?(
    transaction: TransactionContext,
    input: QualityDataExternalAiOptInAppendInput,
  ): Promise<QualityDataExternalAiOptInAppendResult>;

  /** Returns only the latest organization opt-in event; no event means deny. */
  findExternalAiOptInState?(organizationId: string): Promise<QualityDataExternalAiOptInState | null>;
}
