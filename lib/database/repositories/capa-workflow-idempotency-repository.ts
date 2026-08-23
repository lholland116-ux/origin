import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  ControlledCode,
  IdempotencyKey,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Lowercase hexadecimal SHA-256 digest of one canonical controlled CAPA
 * workflow-operation request.
 *
 * The brand prevents accidental compile-time substitution. Repository
 * adapters must independently validate every runtime value.
 */
export type CapaWorkflowRequestFingerprint =
  string & {
    readonly __brand:
      "CapaWorkflowRequestFingerprint";
  };

/**
 * Immutable identity binding for one organization-local CAPA workflow
 * operation.
 *
 * operation_code is stored independently from the fingerprint so the
 * authoritative business action remains inspectable without interpreting
 * opaque request content. The idempotency key is organization-global within
 * this workflow ledger; reusing it for another operation therefore produces
 * a controlled conflict.
 */
export interface CapaWorkflowIdempotencyRecord {
  readonly organization_id:
    OrganizationId;
  readonly idempotency_key:
    IdempotencyKey;
  readonly operation_code:
    ControlledCode;
  readonly request_fingerprint:
    CapaWorkflowRequestFingerprint;
  readonly capa_case_id:
    CapaCaseId;
  readonly source_case_version_id:
    CapaCaseVersionId;
  readonly resulting_case_version_id:
    CapaCaseVersionId;
  readonly audit_event_id:
    AuditEventId;
}

export type ClaimCapaWorkflowOperationResult =
  | {
      /**
       * This transaction inserted the reservation and may perform the bound
       * workflow transition and audit write.
       */
      readonly status: "claimed";
      readonly record:
        CapaWorkflowIdempotencyRecord;
    }
  | {
      /**
       * A committed operation already owns this organization-local key with
       * the exact operation and canonical request fingerprint. No new
       * business write may occur.
       */
      readonly status:
        "already_claimed";
      readonly record:
        CapaWorkflowIdempotencyRecord;
    }
  | {
      /**
       * The key is already bound to a different operation or canonical
       * request. The application must fail closed.
       */
      readonly status: "conflict";
      readonly record:
        CapaWorkflowIdempotencyRecord;
      readonly reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    };

/**
 * Provider-neutral, transaction-bound workflow-idempotency contract.
 *
 * A claim must execute before a new immutable case version is inserted and
 * inside the same transaction as aggregate advancement and the required
 * audit event. Any thrown material failure must therefore roll back a newly
 * inserted claim with every related business write.
 */
export interface CapaWorkflowIdempotencyRepository {
  claimWorkflowOperation(
    transaction: TransactionContext,
    record:
      CapaWorkflowIdempotencyRecord,
  ): Promise<ClaimCapaWorkflowOperationResult>;
}