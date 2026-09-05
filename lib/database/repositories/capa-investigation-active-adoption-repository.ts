import type { AuditEventId, OrganizationId } from "../../capa/domain/capa-types";
import type {
  CapaInvestigationActiveAdoptionId,
  CapaInvestigationActiveAdoptionRecord,
} from "../../capa/ai/capa-investigation-active-adoption-contract";
import type { TransactionContext } from "../transactions";

export type CapaInvestigationActiveAdoptionRequestFingerprint = string & { readonly __brand: "CapaInvestigationActiveAdoptionRequestFingerprint" };
export type CapaInvestigationActiveAdoptionRecordFingerprint = string & { readonly __brand: "CapaInvestigationActiveAdoptionRecordFingerprint" };
export interface CapaInvestigationActiveAdoptionPersistenceInput {
  readonly adoption: CapaInvestigationActiveAdoptionRecord;
  readonly request_fingerprint: CapaInvestigationActiveAdoptionRequestFingerprint;
  readonly record_fingerprint: CapaInvestigationActiveAdoptionRecordFingerprint;
  readonly audit_event_id: AuditEventId;
}
export interface PersistedCapaInvestigationActiveAdoption {
  readonly adoption: CapaInvestigationActiveAdoptionRecord;
  readonly request_fingerprint: CapaInvestigationActiveAdoptionRequestFingerprint;
  readonly record_fingerprint: CapaInvestigationActiveAdoptionRecordFingerprint;
  readonly audit_event_id: AuditEventId;
}
export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_PERSISTENCE_CONFLICT_REASONS = [
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  "ADOPTION_ID_REUSED_WITH_DIFFERENT_CONTENT",
  "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_ADOPTION",
] as const;
export type CapaInvestigationActiveAdoptionPersistenceConflictReason = typeof CAPA_INVESTIGATION_ACTIVE_ADOPTION_PERSISTENCE_CONFLICT_REASONS[number];
export type AppendCapaInvestigationActiveAdoptionResult =
  | { readonly status: "saved"; readonly record: PersistedCapaInvestigationActiveAdoption }
  | { readonly status: "already_recorded"; readonly record: PersistedCapaInvestigationActiveAdoption }
  | { readonly status: "case_changed" }
  | { readonly status: "output_not_found_or_not_authorized" }
  | { readonly status: "output_not_adoptable" }
  | { readonly status: "conflict"; readonly reason_code: CapaInvestigationActiveAdoptionPersistenceConflictReason; readonly record: PersistedCapaInvestigationActiveAdoption };
export interface CapaInvestigationActiveAdoptionRepository {
  appendAdoption(transaction: TransactionContext, input: CapaInvestigationActiveAdoptionPersistenceInput): Promise<AppendCapaInvestigationActiveAdoptionResult>;
  findAdoptionById(organizationId: OrganizationId, adoptionId: CapaInvestigationActiveAdoptionId): Promise<PersistedCapaInvestigationActiveAdoption | null>;
}
