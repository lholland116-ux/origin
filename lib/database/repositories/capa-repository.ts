import type {
  ActorReference,
  CapaCase,
  CapaCaseId,
  CapaCaseStatus,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  IsoDateTime,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Provider-neutral CAPA persistence contract.
 *
 * Primary source:
 * Document #8 — LVT CAPA Data Model and Audit-Trail Specification
 *
 * Supporting sources:
 * Document #4 — LVT CAPA Workflow and State Specification
 * Document #5 — LVT CAPA Human Review UI Specification
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * URS-CASE-002
 * DM-COM-001 through DM-COM-009
 * VER-001 through VER-007
 * AUD-001 through AUD-004
 * TEN-001 through TEN-003
 *
 * Every read and write is organization-scoped. This interface exposes no
 * unscoped lookup and no destructive delete operation.
 *
 * The interface does not select a database, ORM, event store, outbox or
 * physical transaction implementation. Those remain open under DEC-003.
 */

/**
 * Controlled input for advancing a CAPA aggregate to a new immutable
 * current version.
 */
export interface AdvanceCapaVersionInput {
  readonly organization_id:
    OrganizationId;

  readonly capa_case_id:
    CapaCaseId;

  /**
   * Optimistic-concurrency expectations obtained from the exact version
   * the authorized actor reviewed.
   */
  readonly expected_record_version:
    number;

  readonly expected_current_version_id:
    CapaCaseVersionId;

  readonly next_current_version_id:
    CapaCaseVersionId;

  readonly next_status:
    CapaCaseStatus;

  readonly updated_at:
    IsoDateTime;

  readonly updated_by:
    ActorReference;
}

/**
 * Result of an optimistic current-version update.
 *
 * Conflict responses deliberately avoid revealing whether a case exists
 * outside the authorized organization boundary.
 */
export type AdvanceCapaVersionResult =
  | {
      readonly status: "updated";
      readonly capa_case:
        CapaCase;
    }
  | {
      readonly status: "conflict";
      readonly reason_code:
        | "RECORD_VERSION_CONFLICT"
        | "CURRENT_VERSION_CONFLICT"
        | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED";
    };

/**
 * Stable keyset cursor for organization-scoped CAPA case lists.
 *
 * Cases are ordered by created_at descending and then capa_case_id
 * descending. Both values are required to continue from an exact
 * position without offset-pagination drift.
 */
export interface CapaCaseListCursor {
  readonly created_at:
    IsoDateTime;

  readonly capa_case_id:
    CapaCaseId;
}

export interface CapaCaseListQuery {
  readonly organization_id:
    OrganizationId;

  /**
   * Maximum number of cases returned in this page.
   *
   * Application and adapter implementations must reject values outside
   * their controlled supported range.
   */
  readonly limit:
    number;

  readonly cursor?:
    CapaCaseListCursor;
}

export interface CapaCaseListPage {
  readonly cases:
    readonly CapaCase[];

  /**
   * Present only when at least one additional case exists after this page.
   */
  readonly next_cursor?:
    CapaCaseListCursor;
}

export interface CapaRepository {
  /**
   * Lists cases inside one authoritative organization boundary.
   *
   * Implementations must:
   *
   * - order by created_at descending and capa_case_id descending;
   * - use keyset rather than offset pagination;
   * - return no case outside organization_id;
   * - reject invalid limits or cursors;
   * - set next_cursor only when another page exists.
   */
  listCases(
    query:
      CapaCaseListQuery,
  ): Promise<CapaCaseListPage>;

  /**
   * Tenant-scoped case lookup.
   *
   * Implementations must return null both when the case does not exist and
   * when it is outside the supplied organization boundary.
   */
  findCaseById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,
  ): Promise<CapaCase | null>;

  /**
   * Tenant- and parent-case-scoped immutable case-version lookup.
   */
  findCaseVersionById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,

    caseVersionId:
      CapaCaseVersionId,
  ): Promise<CapaCaseVersion | null>;

  /**
   * Tenant- and parent-case-scoped immutable section-version lookup.
   */
  findSectionVersionById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,

    sectionVersionId:
      CapaSectionVersionId,
  ): Promise<CapaSectionVersion | null>;

  /**
   * Checks organization-local case-number availability.
   *
   * This method supports user feedback and case-number generation, but it
   * is not sufficient to guarantee uniqueness because another transaction
   * may insert the same value afterward.
   *
   * The physical data model must also enforce a unique organization_id
   * plus case_number constraint or equivalent atomic guarantee.
   */
  caseNumberExists(
    organizationId:
      OrganizationId,

    caseNumber:
      string,
  ): Promise<boolean>;

  /**
   * Inserts the stable CAPA aggregate.
   *
   * Initial creation must execute inside the same transaction as the
   * initial section version, case version and required audit event.
   */
  insertCase(
    transaction:
      TransactionContext,

    capaCase:
      CapaCase,
  ): Promise<void>;

  /**
   * Inserts an immutable controlled CAPA section version.
   *
   * Implementations must not overwrite an existing section-version
   * identity. A material section change creates a new version.
   */
  insertSectionVersion(
    transaction:
      TransactionContext,

    sectionVersion:
      CapaSectionVersion,
  ): Promise<void>;

  /**
   * Inserts an immutable material CAPA case version.
   *
   * Implementations must not overwrite an existing case-version identity.
   * Referenced section-version identities must belong to the same
   * organization and CAPA case.
   */
  insertCaseVersion(
    transaction:
      TransactionContext,

    caseVersion:
      CapaCaseVersion,
  ): Promise<void>;

  /**
   * Advances the aggregate's current-version pointer using optimistic
   * concurrency.
   *
   * The update succeeds only when:
   *
   * - organization_id and capa_case_id match an authorized record;
   * - expected_record_version matches the authoritative record;
   * - expected_current_version_id matches the authoritative pointer;
   * - next_current_version_id identifies a valid immutable version for
   *   the same organization and CAPA case.
   *
   * The update and its required audit event must commit atomically.
   */
  advanceCurrentVersion(
    transaction:
      TransactionContext,

    input:
      AdvanceCapaVersionInput,
  ): Promise<AdvanceCapaVersionResult>;
}