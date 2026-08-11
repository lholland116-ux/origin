import type {
  ActorReference,
  CapaCase,
  CapaCaseId,
  CapaCaseStatus,
  CapaCaseVersion,
  CapaCaseVersionId,
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
 * Traceability:
 * DM-COM-001 through DM-COM-009
 * VER-001 through VER-007
 * AUD-001 through AUD-004
 * TEN-001 through TEN-003
 *
 * Every read and write is organization-scoped. This interface exposes no
 * unscoped lookup and no destructive delete operation.
 */

export interface AdvanceCapaVersionInput {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;

  /**
   * Optimistic-concurrency expectations obtained from the version the
   * authorized user actually reviewed.
   */
  readonly expected_record_version: number;
  readonly expected_current_version_id:
    CapaCaseVersionId;

  readonly next_current_version_id:
    CapaCaseVersionId;
  readonly next_status: CapaCaseStatus;

  readonly updated_at: IsoDateTime;
  readonly updated_by: ActorReference;
}

export type AdvanceCapaVersionResult =
  | {
      readonly status: "updated";
      readonly capa_case: CapaCase;
    }
  | {
      readonly status: "conflict";
      readonly reason_code:
        | "RECORD_VERSION_CONFLICT"
        | "CURRENT_VERSION_CONFLICT"
        | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED";
    };

export interface CapaRepository {
  /**
   * Tenant-scoped case lookup.
   *
   * Implementations must return null both when the case does not exist and
   * when it is outside the supplied organization boundary.
   */
  findCaseById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaCase | null>;

  /**
   * Tenant- and parent-case-scoped immutable version lookup.
   */
  findCaseVersionById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    caseVersionId: CapaCaseVersionId,
  ): Promise<CapaCaseVersion | null>;

  /**
   * Checks organization-local readable case-number uniqueness.
   */
  caseNumberExists(
    organizationId: OrganizationId,
    caseNumber: string,
  ): Promise<boolean>;

  /**
   * Inserts the stable case aggregate.
   *
   * Must execute inside the same transaction as the initial immutable
   * version and required audit event.
   */
  insertCase(
    transaction: TransactionContext,
    capaCase: CapaCase,
  ): Promise<void>;

  /**
   * Inserts an immutable material case version.
   *
   * Implementations must not overwrite an existing version identity.
   */
  insertCaseVersion(
    transaction: TransactionContext,
    caseVersion: CapaCaseVersion,
  ): Promise<void>;

  /**
   * Advances the aggregate's current-version pointer using optimistic
   * concurrency.
   *
   * The update must succeed only when both expected_record_version and
   * expected_current_version_id still match the authoritative record.
   */
  advanceCurrentVersion(
    transaction: TransactionContext,
    input: AdvanceCapaVersionInput,
  ): Promise<AdvanceCapaVersionResult>;
}