import type {
  ControlledCode,
  IsoDateTime,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  ControlledVersion,
} from "../../capa/ai/capa-prompt-contract";

import type {
  CapaKnowledgeCollectionId,
  CapaKnowledgeCollectionVersionId,
  CapaKnowledgeFingerprintRecord,
  CapaKnowledgePassageId,
  CapaKnowledgeQualityStatus,
  CapaKnowledgeSourceId,
  CapaKnowledgeSourceStatus,
  CapaKnowledgeSourceType,
  CapaKnowledgeSourceVersionId,
} from "../../capa/knowledge/capa-knowledge-contract";

import type {
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalMethod,
  CapaKnowledgeRetrievalRequest,
  CapaKnowledgeRetrievalRunId,
} from "../../capa/knowledge/capa-knowledge-retrieval-contract";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Provider-neutral persistence and search boundary for governed CAPA
 * retrieval indexes.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * IDX-001 through IDX-010
 * RET-001, RET-002, RET-004, RET-005, RET-008, RET-009 and RET-012
 *
 * Index entries contain controlled derivative text, never original artifact
 * bytes. Implementations must apply tenant, collection, access, lifecycle,
 * effectivity and quality filters before returning candidate metadata.
 */

export const CAPA_KNOWLEDGE_INDEX_STATUSES = [
  "pending",
  "ready",
  "partial",
  "blocked",
  "retired",
] as const;

export type CapaKnowledgeIndexStatus =
  (typeof CAPA_KNOWLEDGE_INDEX_STATUSES)[number];

export interface CapaKnowledgeRetrievalIndexEntry {
  readonly passage_id:
    CapaKnowledgePassageId;
  readonly source_id:
    CapaKnowledgeSourceId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly collection_ids:
    readonly CapaKnowledgeCollectionId[];
  readonly collection_version_ids:
    readonly CapaKnowledgeCollectionVersionId[];
  readonly organization_id?:
    OrganizationId;
  readonly approved_global: boolean;
  readonly source_type:
    CapaKnowledgeSourceType;
  readonly source_status:
    CapaKnowledgeSourceStatus;
  readonly quality_status:
    CapaKnowledgeQualityStatus;
  readonly effective_at?:
    IsoDateTime;
  readonly retirement_at?:
    IsoDateTime;
  readonly permitted_role_ids:
    readonly string[];
  readonly permitted_site_ids:
    readonly string[];
  readonly permitted_product_ids:
    readonly string[];
  readonly jurisdictions:
    readonly string[];
  readonly applicability_tags:
    readonly ControlledCode[];
  readonly machine_interpretable:
    boolean;
  readonly normalized_text: string;
  readonly normalized_text_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly lexical_document?:
    Readonly<Record<string, number>>;
  readonly semantic_embedding?:
    readonly number[];
  readonly structured_metadata?:
    Readonly<Record<string, string | readonly string[]>>;
  readonly index_version:
    ControlledVersion;
  readonly status:
    CapaKnowledgeIndexStatus;
  readonly indexed_at:
    IsoDateTime;
}

export interface CapaKnowledgeRetrievalIndexLookup {
  readonly organization_id:
    OrganizationId;
  readonly approved_global_sources_permitted:
    boolean;
  readonly passage_id:
    CapaKnowledgePassageId;
  readonly source_version_id:
    CapaKnowledgeSourceVersionId;
  readonly index_version:
    ControlledVersion;
}

export interface CapaKnowledgeRetrievalIndexSearch {
  readonly request:
    CapaKnowledgeRetrievalRequest;
  readonly normalized_query: string;
  readonly query_terms:
    readonly string[];
  readonly query_embedding?:
    readonly number[];
}

export interface CapaKnowledgeRetrievalIndexSearchResult {
  readonly retrieval_run_id:
    CapaKnowledgeRetrievalRunId;
  readonly retrieval_method:
    CapaKnowledgeRetrievalMethod;
  readonly index_version:
    ControlledVersion;
  readonly index_status:
    "ready" | "partial";
  readonly candidates:
    readonly CapaKnowledgeRetrievalCandidate[];
}

export interface CapaKnowledgeRetrievalIndexRepository {
  /** Resolves one exact governed index entry without cross-tenant fallback. */
  findEntry(
    lookup:
      CapaKnowledgeRetrievalIndexLookup,
  ): Promise<CapaKnowledgeRetrievalIndexEntry | null>;

  /**
   * Returns metadata-only candidates after all mandatory disclosure filters.
   * Candidate content remains unavailable until later evidence assembly.
   */
  search(
    search:
      CapaKnowledgeRetrievalIndexSearch,
  ): Promise<CapaKnowledgeRetrievalIndexSearchResult>;

  /** Inserts an immutable controlled index entry in the caller transaction. */
  insertEntry(
    transaction:
      TransactionContext,
    entry:
      CapaKnowledgeRetrievalIndexEntry,
  ): Promise<void>;

  /**
   * Replaces only derived index material for the same passage and controlled
   * index version. Original artifacts, derivatives and passages are unchanged.
   */
  replaceDerivedEntry(
    transaction:
      TransactionContext,
    expectedFingerprint:
      CapaKnowledgeFingerprintRecord,
    entry:
      CapaKnowledgeRetrievalIndexEntry,
  ): Promise<"replaced" | "conflict" | "not_found_or_not_authorized">;
}

export class CapaKnowledgeRetrievalRepositoryError
  extends Error {
  constructor(
    message =
      "The governed CAPA knowledge retrieval repository operation failed.",
  ) {
    super(message);
    this.name =
      "CapaKnowledgeRetrievalRepositoryError";
  }
}

export function isCapaKnowledgeIndexSearchable(
  status: CapaKnowledgeIndexStatus,
): status is "ready" | "partial" {
  return status === "ready" ||
    status === "partial";
}
