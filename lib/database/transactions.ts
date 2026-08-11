import type {
  IsoDateTime,
  RequestTrace,
} from "../capa/domain/capa-types";

/**
 * Provider-neutral transaction contracts.
 *
 * Primary source:
 * Document #8 — LVT CAPA Data Model and Audit-Trail Specification
 *
 * Traceability:
 * DM-COM-002
 * DM-COM-009
 * VER-001 through VER-007
 * AUD-001 through AUD-004
 * CON-003 through CON-006
 *
 * These contracts do not select a physical database, ORM, event store,
 * outbox implementation or transaction-isolation mechanism. Those remain
 * open under DEC-003.
 */

type BrandedTransactionId<Name extends string> = string & {
  readonly __brand: Name;
};

export type TransactionId =
  BrandedTransactionId<"TransactionId">;

/**
 * Opaque handle supplied by the database adapter while controlled work is
 * executing inside one transaction.
 *
 * Application code must not manufacture transaction handles or manually
 * commit and roll back physical database transactions.
 */
export interface TransactionContext {
  readonly transaction_id: TransactionId;
  readonly started_at: IsoDateTime;
  readonly request_trace: RequestTrace;
}

/**
 * Work executed within a single controlled transaction.
 */
export type TransactionWork<Result> = (
  transaction: TransactionContext,
) => Promise<Result>;

/**
 * Provider-neutral transaction manager.
 *
 * The implementation must:
 *
 * - commit only when the operation completes successfully;
 * - roll back business and audit writes when the operation fails;
 * - prevent partial material state changes;
 * - preserve the request and correlation identifiers;
 * - propagate the original failure safely;
 * - prevent duplicate effects through the applicable idempotency design.
 */
export interface TransactionManager {
  runInTransaction<Result>(
    requestTrace: RequestTrace,
    work: TransactionWork<Result>,
  ): Promise<Result>;
}