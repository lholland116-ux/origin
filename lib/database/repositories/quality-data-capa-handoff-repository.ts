import type { QualityDataCapaFindingClassification, QualityDataCapaHandoffDecision } from "../../quality-data/quality-data-capa-handoff-contract";
import type { TransactionContext } from "../transactions";

export interface QualityDataCapaHandoffReserveInput {
  readonly handoff_id: string;
  readonly organization_id: string;
  readonly report_id: string;
  readonly finding_key: string;
  readonly expected_result_fingerprint: string;
  readonly expected_finding_fingerprint: string;
  readonly reviewer_user_id: string;
  readonly reviewer_membership_id: string;
  readonly decision: QualityDataCapaHandoffDecision;
  readonly rationale: string;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly now: string;
}

export interface QualityDataCapaHandoffStoredRecord {
  readonly handoff_id: string;
  readonly organization_id: string;
  readonly report_id: string;
  readonly finding_key: string;
  readonly finding_classification: QualityDataCapaFindingClassification;
  readonly finding_fingerprint: string;
  readonly result_fingerprint: string;
  readonly reviewer_user_id: string;
  readonly decision: QualityDataCapaHandoffDecision;
  readonly capa_case_id: string | null;
  readonly capa_case_status: string | null;
}

export type QualityDataCapaHandoffReserveResult =
  | { readonly status: "reserved"; readonly record: QualityDataCapaHandoffStoredRecord }
  | { readonly status: "already_created"; readonly record: QualityDataCapaHandoffStoredRecord }
  | { readonly status: "conflict" }
  | { readonly status: "unauthorized" }
  | { readonly status: "not_found" }
  | { readonly status: "stale_evidence" };

export interface QualityDataCapaHandoffLinkInput {
  readonly organization_id: string;
  readonly handoff_id: string;
  readonly capa_case_id: string;
  readonly capa_case_status: string;
  readonly capa_case_version_id: string;
  readonly capa_section_version_id: string;
  readonly capa_creation_audit_event_id: string;
  readonly handoff_audit_event_id: string;
}

export interface QualityDataCapaHandoffRepository {
  reserveDecision(transaction: TransactionContext, input: QualityDataCapaHandoffReserveInput): Promise<QualityDataCapaHandoffReserveResult>;
  linkCreatedDraft(transaction: TransactionContext, input: QualityDataCapaHandoffLinkInput): Promise<void>;
}
