import type {
  IsoDateTime,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaKnowledgeArtifactId,
  CapaKnowledgeCollectionId,
  CapaKnowledgeCollectionVersion,
  CapaKnowledgeCollectionVersionId,
  CapaKnowledgeDerivative,
  CapaKnowledgeDerivativeId,
  CapaKnowledgeFingerprintRecord,
  CapaKnowledgeOriginalArtifact,
  CapaKnowledgePassage,
  CapaKnowledgePassageId,
  CapaKnowledgeSource,
  CapaKnowledgeSourceId,
  CapaKnowledgeSourceStatus,
  CapaKnowledgeSourceVersion,
  CapaKnowledgeSourceVersionId,
  CapaKnowledgeVisibility,
} from "../../capa/knowledge/capa-knowledge-contract";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Provider-neutral governed CAPA knowledge persistence contract.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Supporting sources:
 * Document #8 — Data Model and Audit-Trail Specification
 * Document #9 — Security, Privacy, and Access-Control Specification
 *
 * Traceability:
 * KBG-001 through KBG-010
 * ING-001 through ING-006
 * SEG-001 through SEG-005
 * IDX-001, IDX-002, IDX-005 through IDX-009
 *
 * This interface exposes no destructive delete operation and no unscoped
 * tenant lookup. Original artifacts, derivatives and passages are material
 * immutable records. Controlled source lifecycle changes use optimistic
 * concurrency and remain attributable through the application audit trail.
 */

export type CapaKnowledgeScope =
  | {
      readonly visibility:
        "organization";
      readonly organization_id:
        OrganizationId;
    }
  | {
      readonly visibility:
        "approved_global";
    };

export interface CapaKnowledgeSourceVersionLookup {
  readonly scope:
    CapaKnowledgeScope;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
}

export interface CapaKnowledgeFingerprintLookup {
  readonly scope:
    CapaKnowledgeScope;
  readonly fingerprint:
    CapaKnowledgeFingerprintRecord;
}

export interface CapaKnowledgePassageListQuery {
  readonly scope:
    CapaKnowledgeScope;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly derivative_id:
    CapaKnowledgeDerivativeId;
  readonly after_sequence_number?:
    number;
  readonly limit: number;
}

export interface CapaKnowledgePassageListPage {
  readonly passages:
    readonly CapaKnowledgePassage[];
  readonly next_sequence_number?:
    number;
}

export interface CapaKnowledgeCollectionVersionLookup {
  readonly scope:
    CapaKnowledgeScope;
  readonly collection_id:
    CapaKnowledgeCollectionId;
  readonly collection_version_id:
    CapaKnowledgeCollectionVersionId;
}

export interface AdvanceCapaKnowledgeLifecycleInput {
  readonly scope:
    CapaKnowledgeScope;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly expected_record_version:
    number;
  readonly expected_status:
    CapaKnowledgeSourceStatus;
  readonly next_status:
    CapaKnowledgeSourceStatus;
  readonly updated_at:
    IsoDateTime;
  readonly updated_by_actor_type:
    "human" | "service" | "system";
  readonly updated_by_actor_id:
    string;
  readonly updated_by_actor_version?:
    string;
}

export type AdvanceCapaKnowledgeLifecycleResult =
  | {
      readonly status: "updated";
      readonly source_version:
        CapaKnowledgeSourceVersion;
    }
  | {
      readonly status: "conflict";
      readonly reason_code:
        | "RECORD_VERSION_CONFLICT"
        | "SOURCE_STATUS_CONFLICT"
        | "SOURCE_NOT_FOUND_OR_NOT_AUTHORIZED";
    };

export interface CapaKnowledgeRepository {
  /**
   * Resolves a stable source identity within one explicit tenant or approved
   * global scope. Organization requests never fall through to another tenant.
   */
  findSourceById(
    scope: CapaKnowledgeScope,
    sourceId: CapaKnowledgeSourceId,
  ): Promise<CapaKnowledgeSource | null>;

  /** Resolves one exact immutable material source version. */
  findSourceVersionById(
    lookup:
      CapaKnowledgeSourceVersionLookup,
  ): Promise<CapaKnowledgeSourceVersion | null>;

  /**
   * Supports idempotent registration using the exact original content
   * fingerprint inside one explicit scope.
   */
  findSourceVersionByOriginalFingerprint(
    lookup:
      CapaKnowledgeFingerprintLookup,
  ): Promise<CapaKnowledgeSourceVersion | null>;

  findOriginalArtifactById(
    lookup:
      CapaKnowledgeSourceVersionLookup & {
        readonly artifact_id:
          CapaKnowledgeArtifactId;
      },
  ): Promise<CapaKnowledgeOriginalArtifact | null>;

  findDerivativeById(
    lookup:
      CapaKnowledgeSourceVersionLookup & {
        readonly derivative_id:
          CapaKnowledgeDerivativeId;
      },
  ): Promise<CapaKnowledgeDerivative | null>;

  listPassages(
    query:
      CapaKnowledgePassageListQuery,
  ): Promise<CapaKnowledgePassageListPage>;

  findPassageById(
    scope:
      CapaKnowledgeScope,
    passageId:
      CapaKnowledgePassageId,
  ): Promise<CapaKnowledgePassage | null>;

  findCollectionVersionById(
    lookup:
      CapaKnowledgeCollectionVersionLookup,
  ): Promise<CapaKnowledgeCollectionVersion | null>;

  /**
   * Inserts a stable source identity. The source, initial version, original
   * artifact and required audit event are committed in one transaction.
   */
  insertSource(
    transaction:
      TransactionContext,
    source:
      CapaKnowledgeSource,
  ): Promise<void>;

  /** Inserts one immutable material source version. */
  insertSourceVersion(
    transaction:
      TransactionContext,
    sourceVersion:
      CapaKnowledgeSourceVersion,
  ): Promise<void>;

  /** Inserts immutable quarantined original bytes metadata. */
  insertOriginalArtifact(
    transaction:
      TransactionContext,
    artifact:
      CapaKnowledgeOriginalArtifact,
  ): Promise<void>;

  /** Inserts an immutable extracted, OCR or normalized derivative. */
  insertDerivative(
    transaction:
      TransactionContext,
    derivative:
      CapaKnowledgeDerivative,
  ): Promise<void>;

  /**
   * Inserts a complete controlled segmentation result. Implementations must
   * reject duplicate passage identities, sequence positions and fingerprints.
   */
  insertPassages(
    transaction:
      TransactionContext,
    passages:
      readonly CapaKnowledgePassage[],
  ): Promise<void>;

  insertCollectionVersion(
    transaction:
      TransactionContext,
    collectionVersion:
      CapaKnowledgeCollectionVersion,
  ): Promise<void>;

  /**
   * Advances only controlled lifecycle metadata. Material source identity,
   * bytes, derivatives, passages, locators and fingerprints remain immutable.
   */
  advanceSourceVersionLifecycle(
    transaction:
      TransactionContext,
    input:
      AdvanceCapaKnowledgeLifecycleInput,
  ): Promise<AdvanceCapaKnowledgeLifecycleResult>;
}

/**
 * Stable persistence failures expose safe categories without leaking records
 * across tenant boundaries.
 */
export class CapaKnowledgeRepositoryError
  extends Error {
  constructor(
    message =
      "The governed CAPA knowledge repository operation failed.",
  ) {
    super(message);
    this.name =
      "CapaKnowledgeRepositoryError";
  }
}

export class CapaKnowledgeRepositoryConfigurationError
  extends CapaKnowledgeRepositoryError {
  constructor(message: string) {
    super(message);
    this.name =
      "CapaKnowledgeRepositoryConfigurationError";
  }
}

/**
 * Utility used by adapters to map the discriminated scope without accepting
 * an arbitrary nullable tenant identity from browser-controlled input.
 */
export function capaKnowledgeScopeOrganizationId(
  scope: CapaKnowledgeScope,
): OrganizationId | null {
  return scope.visibility ===
    "organization"
    ? scope.organization_id
    : null;
}

export function isCapaKnowledgeApprovedGlobalScope(
  scope: CapaKnowledgeScope,
): boolean {
  return scope.visibility ===
    "approved_global";
}
