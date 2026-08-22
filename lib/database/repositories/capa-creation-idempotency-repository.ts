import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  IdempotencyKey,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Lowercase hexadecimal SHA-256 digest of the canonical controlled CAPA
 * creation request.
 *
 * The brand prevents accidental substitution at compile time. Repository
 * implementations must still validate the runtime value.
 */
export type CapaCreationRequestFingerprint =
  string & {
    readonly __brand:
      "CapaCreationRequestFingerprint";
  };

/**
 * Immutable identity binding retained for one organization-local creation
 * request.
 */
export interface CapaCreationIdempotencyRecord {
  readonly organization_id:
    OrganizationId;
  readonly idempotency_key:
    IdempotencyKey;
  readonly request_fingerprint:
    CapaCreationRequestFingerprint;
  readonly capa_case_id:
    CapaCaseId;
  readonly case_version_id:
    CapaCaseVersionId;
  readonly section_version_id:
    CapaSectionVersionId;
  readonly audit_event_id:
    AuditEventId;
}

export type ClaimCapaCreationResult =
  | {
      /**
       * This transaction owns the newly inserted reservation and may create
       * the referenced CAPA records.
       */
      readonly status: "claimed";
      readonly record:
        CapaCreationIdempotencyRecord;
    }
  | {
      /**
       * An earlier committed request used the same organization, key and
       * canonical request fingerprint. No new business writes may occur.
       */
      readonly status:
        "already_claimed";
      readonly record:
        CapaCreationIdempotencyRecord;
    }
  | {
      /**
       * The organization-local key is already bound to different controlled
       * request content. The request must fail closed.
       */
      readonly status: "conflict";
      readonly record:
        CapaCreationIdempotencyRecord;
      readonly reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    };

/**
 * Provider-neutral transaction-bound CAPA creation-idempotency contract.
 *
 * A claim must execute before case-number allocation and inside the same
 * transaction as the CAPA aggregate, immutable versions and audit event.
 * Rolling back any material write must therefore also roll back a newly
 * inserted claim.
 */
export interface CapaCreationIdempotencyRepository {
  claimCreation(
    transaction: TransactionContext,
    record:
      CapaCreationIdempotencyRecord,
  ): Promise<ClaimCapaCreationResult>;
}