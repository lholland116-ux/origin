import type {
  AuditEvent,
  AuditEventId,
  ControlledCode,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Append-only audit persistence contract.
 *
 * Primary source:
 * Document #8 — LVT CAPA Data Model and Audit-Trail Specification
 *
 * Traceability:
 * DM-COM-001
 * DM-COM-007 through DM-COM-009
 * AUD-001 through AUD-011
 * TEN-001 through TEN-003
 *
 * This interface intentionally exposes no update or delete operation.
 */

type BrandedAuditCursor<Name extends string> = string & {
  readonly __brand: Name;
};

export type AuditCursor =
  BrandedAuditCursor<"AuditCursor">;

export interface AuditEventQuery {
  readonly organization_id: OrganizationId;
  readonly aggregate_type: ControlledCode;
  readonly aggregate_id: string;

  /**
   * Bounded page size enforced by the implementation.
   */
  readonly limit: number;
  readonly cursor?: AuditCursor;
}

export interface AuditEventPage {
  readonly events: readonly AuditEvent[];
  readonly next_cursor?: AuditCursor;
}

export type AppendAuditEventResult =
  | {
      readonly status: "appended";
      readonly event_id: AuditEventId;
    }
  | {
      /**
       * An exact prior idempotent append was found.
       */
      readonly status: "already_recorded";
      readonly event_id: AuditEventId;
    }
  | {
      /**
       * The event identity already exists with non-equivalent controlled
       * content. The transaction must fail closed.
       */
      readonly status: "conflict";
      readonly event_id: AuditEventId;
      readonly reason_code:
        "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT";
    };

export interface AuditRepository {
  /**
   * Appends one immutable business audit event.
   *
   * For a successful material CAPA change, this append must execute inside
   * the same transaction as the business-state change.
   *
   * Implementations must treat an exact idempotent retry as
   * already_recorded and must fail closed when the same event identity is
   * reused with different content.
   */
  appendEvent(
    transaction: TransactionContext,
    event: AuditEvent,
  ): Promise<AppendAuditEventResult>;

  /**
   * Tenant-scoped audit-event lookup.
   *
   * Implementations return null for both nonexistence and unauthorized
   * organization scope.
   */
  findEventById(
    organizationId: OrganizationId,
    eventId: AuditEventId,
  ): Promise<AuditEvent | null>;

  /**
   * Returns an ordered, bounded, tenant-scoped audit page.
   *
   * Calling application code must separately authorize audit viewing or
   * export. Repository access alone is not authorization.
   */
  listEventsForAggregate(
    query: AuditEventQuery,
  ): Promise<AuditEventPage>;
}