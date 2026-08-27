import type {
  AuditEventId,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaAiOutputReviewId,
  CapaAiOutputReviewRecord,
} from "../../capa/ai/capa-ai-output-review-contract";

import type {
  CapaIntakeAdvisoryResponse,
} from "../../capa/ai/capa-intake-advisory-contract";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Lowercase hexadecimal SHA-256 digest of one canonical governed
 * AI-output human-review request.
 *
 * The fingerprint is deliberately separate from the idempotency key:
 *
 * - the key identifies the retry boundary;
 * - the fingerprint proves whether a retry represents the same request.
 */
export type CapaAiOutputReviewRequestFingerprint =
  string & {
    readonly __brand:
      "CapaAiOutputReviewRequestFingerprint";
  };

/**
 * Lowercase hexadecimal SHA-256 digest of the canonical immutable review
 * record persisted as durable review evidence.
 */
export type CapaAiOutputReviewRecordFingerprint =
  string & {
    readonly __brand:
      "CapaAiOutputReviewRecordFingerprint";
  };

/**
 * Persistence material supplied after trusted server-side validation.
 *
 * The repository independently validates all runtime values before issuing
 * a database write.
 */
export interface CapaAiOutputReviewPersistenceInput {
  readonly review:
    CapaAiOutputReviewRecord;

  readonly request_fingerprint:
    CapaAiOutputReviewRequestFingerprint;

  readonly audit_event_id:
    AuditEventId;

  readonly record_fingerprint:
    CapaAiOutputReviewRecordFingerprint;
}

/**
 * Durable representation returned from persistence.
 *
 * The original governed AI output remains immutable and separate from the
 * human review record.
 */
export interface PersistedCapaAiOutputReview {
  readonly review:
    CapaAiOutputReviewRecord;

  readonly request_fingerprint:
    CapaAiOutputReviewRequestFingerprint;

  readonly audit_event_id:
    AuditEventId;

  readonly record_fingerprint:
    CapaAiOutputReviewRecordFingerprint;
}

export const CAPA_AI_OUTPUT_REVIEW_PERSISTENCE_CONFLICT_REASONS = [
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  "REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
  "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_REVIEW",
] as const;

export type CapaAiOutputReviewPersistenceConflictReason =
  (typeof CAPA_AI_OUTPUT_REVIEW_PERSISTENCE_CONFLICT_REASONS)[number];

export type AppendCapaAiOutputReviewResult =
  | {
      /**
       * This transaction appended the immutable review.
       *
       * The required audit event must be appended in the same transaction
       * before the transaction is allowed to commit.
       */
      readonly status: "saved";
      readonly record:
        PersistedCapaAiOutputReview;
    }
  | {
      /**
       * A committed review already owns the organization-local idempotency
       * key with the exact canonical request fingerprint.
       *
       * No new review or audit event may be written for this retry.
       */
      readonly status:
        "already_recorded";
      readonly record:
        PersistedCapaAiOutputReview;
    }
  | {
      /**
       * The current CAPA aggregate no longer matches the exact case version
       * and record version against which the reviewed AI output was created.
       *
       * The application must reject the stale human-review submission.
       */
      readonly status:
        "case_changed";
    }
  | {
      /**
       * No AI output exists within the supplied organization scope for the
       * requested output identity.
       *
       * Nonexistence and cross-tenant access are intentionally indistinguishable.
       */
      readonly status:
        "output_not_found_or_not_authorized";
    }
  | {
      /**
       * The tenant-scoped AI output exists but is not eligible for human
       * disposition, for example because it is not a completed draft.
       */
      readonly status:
        "output_not_reviewable";
    }
  | {
      /**
       * An immutable identity or idempotency binding conflicts with the
       * attempted review. The operation must fail closed.
       */
      readonly status: "conflict";
      readonly reason_code:
        CapaAiOutputReviewPersistenceConflictReason;
      readonly record:
        PersistedCapaAiOutputReview;
    };

/**
 * Provider-neutral append-only repository for governed CAPA AI-output
 * human review.
 *
 * Implementations must:
 *
 * - require a valid active transaction;
 * - preserve request/correlation/idempotency trace identity;
 * - re-resolve the exact tenant-scoped AI output;
 * - require a completed-draft AI output;
 * - lock and revalidate the current CAPA aggregate;
 * - reject stale case-version or record-version submissions;
 * - preserve the original AI output;
 * - permit only append-only human-review persistence;
 * - treat an exact idempotent retry as already_recorded;
 * - fail closed on conflicting immutable identities;
 * - never mutate CAPA workflow or controlled CAPA content.
 *
 * The repository does not itself append the business audit event. The
 * application service must append the supplied audit_event_id through the
 * AuditRepository inside the same TransactionContext. Any failure must roll
 * back both writes.
 */
export interface CapaAiOutputReviewRepository {
  appendReview(
    transaction:
      TransactionContext,
    input:
      CapaAiOutputReviewPersistenceInput,
  ): Promise<AppendCapaAiOutputReviewResult>;

  /**
   * Tenant-scoped lookup used for controlled retry resolution and later
   * human-review history presentation.
   *
   * Returns null for both nonexistence and unauthorized organization scope.
   */
  findReviewById(
    organizationId:
      OrganizationId,
    reviewId:
      CapaAiOutputReviewId,
  ): Promise<PersistedCapaAiOutputReview | null>;

  /**
   * Returns the immutable review history for one exact governed AI output.
   *
   * Authorization remains an application-service responsibility.
   */
  listReviewsForOutput(
    organizationId:
      OrganizationId,
    outputId:
      CapaIntakeAdvisoryResponse["output_id"],
  ): Promise<readonly PersistedCapaAiOutputReview[]>;
}
