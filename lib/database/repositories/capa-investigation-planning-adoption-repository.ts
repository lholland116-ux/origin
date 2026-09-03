import type {
  AuditEventId,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaInvestigationPlanningAdoptionId,
  CapaInvestigationPlanningAdoptionRecord,
} from "../../capa/ai/capa-investigation-planning-adoption-contract";

import type {
  TransactionContext,
} from "../transactions";

export type CapaInvestigationPlanningAdoptionRequestFingerprint =
  string & {
    readonly __brand: "CapaInvestigationPlanningAdoptionRequestFingerprint";
  };

export type CapaInvestigationPlanningAdoptionRecordFingerprint =
  string & {
    readonly __brand: "CapaInvestigationPlanningAdoptionRecordFingerprint";
  };

export interface CapaInvestigationPlanningAdoptionPersistenceInput {
  readonly adoption: CapaInvestigationPlanningAdoptionRecord;
  /**
   * Stable logical/batch request identity used for idempotent replay. It is
   * shared by the per-proposal records in one adoption batch and excludes
   * generated record identities and timestamps.
   */
  readonly request_fingerprint:
    CapaInvestigationPlanningAdoptionRequestFingerprint;
  /** Fingerprint of this specific persisted immutable adoption record. */
  readonly record_fingerprint:
    CapaInvestigationPlanningAdoptionRecordFingerprint;
  readonly audit_event_id: AuditEventId;
}

export interface PersistedCapaInvestigationPlanningAdoption {
  readonly adoption: CapaInvestigationPlanningAdoptionRecord;
  readonly request_fingerprint:
    CapaInvestigationPlanningAdoptionRequestFingerprint;
  readonly record_fingerprint:
    CapaInvestigationPlanningAdoptionRecordFingerprint;
  readonly audit_event_id: AuditEventId;
}

export const CAPA_INVESTIGATION_PLANNING_ADOPTION_PERSISTENCE_CONFLICT_REASONS = [
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  "ADOPTION_ID_REUSED_WITH_DIFFERENT_CONTENT",
  "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_ADOPTION",
] as const;

export type CapaInvestigationPlanningAdoptionPersistenceConflictReason =
  (typeof CAPA_INVESTIGATION_PLANNING_ADOPTION_PERSISTENCE_CONFLICT_REASONS)[number];

export type AppendCapaInvestigationPlanningAdoptionResult =
  | {
      readonly status: "saved";
      readonly record: PersistedCapaInvestigationPlanningAdoption;
    }
  | {
      readonly status: "already_recorded";
      readonly record: PersistedCapaInvestigationPlanningAdoption;
    }
  | {
      readonly status: "case_changed";
    }
  | {
      readonly status: "output_not_found_or_not_authorized";
    }
  | {
      readonly status: "output_not_adoptable";
    }
  | {
      readonly status: "conflict";
      readonly reason_code:
        CapaInvestigationPlanningAdoptionPersistenceConflictReason;
      readonly record: PersistedCapaInvestigationPlanningAdoption;
    };

/**
 * Append-only persistence boundary for S30 selective AI-proposal adoption.
 *
 * Implementations validate the canonical server-owned record, bind it to a
 * completed immutable AG-PLAN output, enforce the exact CAPA snapshot, and
 * preserve tenant, idempotency, audit, and immutable-record identities.
 */
export interface CapaInvestigationPlanningAdoptionRepository {
  appendAdoption(
    transaction: TransactionContext,
    input: CapaInvestigationPlanningAdoptionPersistenceInput,
  ): Promise<AppendCapaInvestigationPlanningAdoptionResult>;

  findAdoptionById(
    organizationId: OrganizationId,
    adoptionId: CapaInvestigationPlanningAdoptionId,
  ): Promise<PersistedCapaInvestigationPlanningAdoption | null>;

  listAdoptionsForOutput(
    organizationId: OrganizationId,
    outputId: string,
  ): Promise<readonly PersistedCapaInvestigationPlanningAdoption[]>;
}
