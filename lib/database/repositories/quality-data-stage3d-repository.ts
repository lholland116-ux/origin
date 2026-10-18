import type { RequestTrace } from "../../capa/domain/capa-types";
import type { QualityDataIntelligenceRequest, QualityDataIntelligenceReport, QualityDataIntelligenceReviewCommand, QualityDataIntelligenceReviewEvent } from "../../quality-data/quality-data-intelligence-contract";
import type { TransactionContext } from "../transactions";

export interface QualityDataIntelligenceReportReservation {
  readonly report_id: string;
  readonly organization_id: string;
  readonly dataset_id: string;
  readonly dataset_version_id: string;
  readonly approval_event_id: string;
  readonly requested_by_user_id: string;
  readonly requested_by_membership_id: string;
  readonly request_payload: QualityDataIntelligenceRequest;
  readonly request_fingerprint: string;
  readonly idempotency_key: string;
  readonly request_trace: RequestTrace & { readonly idempotency_key: string };
  readonly now: string;
}

export type QualityDataIntelligenceReservationResult =
  | { readonly status: "reserved"; readonly report: QualityDataIntelligenceReport }
  | { readonly status: "existing"; readonly report: QualityDataIntelligenceReport }
  | { readonly status: "in_progress"; readonly report_id: string }
  | { readonly status: "conflict" }
  | { readonly status: "unauthorized" };

export interface QualityDataIntelligenceReviewAppendInput {
  readonly organization_id: string;
  readonly reviewer_user_id: string;
  readonly reviewer_membership_id: string;
  readonly request_trace: RequestTrace & { readonly idempotency_key: string };
  readonly command: QualityDataIntelligenceReviewCommand;
  readonly event_id: string;
  readonly finding_fingerprint: string;
  readonly request_fingerprint: string;
  readonly now: string;
}

export type QualityDataIntelligenceReviewAppendResult =
  | { readonly status: "applied"; readonly event: QualityDataIntelligenceReviewEvent }
  | { readonly status: "already_recorded"; readonly event: QualityDataIntelligenceReviewEvent }
  | { readonly status: "unauthorized" }
  | { readonly status: "not_found" }
  | { readonly status: "conflict"; readonly reason_code: "IDEMPOTENCY_KEY_REUSED" | "STALE_TRANSITION" | "INVALID_TRANSITION" };

export interface QualityDataIntelligenceReviewHistory {
  readonly current_transition_number: number;
  readonly events: readonly QualityDataIntelligenceReviewEvent[];
}

export interface QualityDataStage3DRepository {
  reserveReport(transaction: TransactionContext, input: QualityDataIntelligenceReportReservation): Promise<QualityDataIntelligenceReservationResult>;
  completeReport(transaction: TransactionContext, organizationId: string, reportId: string, result: unknown, resultFingerprint: string, finalizedAt: string): Promise<QualityDataIntelligenceReport>;
  failReport(transaction: TransactionContext, organizationId: string, reportId: string, failureCode: string, finalizedAt: string): Promise<void>;
  findReport(organizationId: string, reportId: string): Promise<QualityDataIntelligenceReport | null>;
  listReviewHistory(organizationId: string, reportId: string, findingKey?: string): Promise<QualityDataIntelligenceReviewHistory>;
  appendReview(transaction: TransactionContext, input: QualityDataIntelligenceReviewAppendInput): Promise<QualityDataIntelligenceReviewAppendResult>;
}
