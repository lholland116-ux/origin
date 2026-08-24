import {
  createHash,
} from "node:crypto";

import type {
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalMethod,
} from "../../capa/knowledge/capa-knowledge-retrieval-contract";

import {
  validateCapaKnowledgeRetrievalRequest,
} from "../../capa/knowledge/capa-knowledge-retrieval-validator";

import {
  CapaKnowledgeRetrievalRepositoryError,
  isCapaKnowledgeIndexSearchable,
  type CapaKnowledgeRetrievalIndexEntry,
  type CapaKnowledgeRetrievalIndexLookup,
  type CapaKnowledgeRetrievalIndexRepository,
  type CapaKnowledgeRetrievalIndexSearch,
  type CapaKnowledgeRetrievalIndexSearchResult,
} from "../repositories/capa-knowledge-retrieval-repository";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Deterministic in-memory governed retrieval index.
 *
 * This adapter is intended for isolated development and verification. It
 * applies mandatory disclosure filters before returning metadata-only
 * candidates and never treats similarity as evidence or authority.
 */

function key(
  lookup: Pick<
    CapaKnowledgeRetrievalIndexLookup,
    "passage_id" |
    "source_version_id" |
    "index_version"
  >,
): string {
  return [
    lookup.source_version_id,
    lookup.passage_id,
    lookup.index_version,
  ].join(":");
}

function entryKey(
  entry: CapaKnowledgeRetrievalIndexEntry,
): string {
  return key(entry);
}

function intersects(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.some(
    (value) => right.includes(value),
  );
}

function permits(
  required: readonly string[],
  available: readonly string[],
): boolean {
  return required.length === 0 ||
    intersects(required, available);
}

function tokenize(
  value: string,
): readonly string[] {
  return Object.freeze(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
}

function termDocument(
  entry: CapaKnowledgeRetrievalIndexEntry,
): Readonly<Record<string, number>> {
  if (entry.lexical_document !== undefined) {
    return entry.lexical_document;
  }

  const frequencies: Record<string, number> = {};

  for (const term of tokenize(entry.normalized_text)) {
    frequencies[term] =
      (frequencies[term] ?? 0) + 1;
  }

  return frequencies;
}

function lexicalScore(
  entry: CapaKnowledgeRetrievalIndexEntry,
  queryTerms: readonly string[],
): number {
  const uniqueTerms = [...new Set(queryTerms)];

  if (uniqueTerms.length === 0) {
    return 0;
  }

  const document = termDocument(entry);
  const matched = uniqueTerms.reduce(
    (total, term) =>
      total + (document[term] === undefined ? 0 : 1),
    0,
  );

  return matched / uniqueTerms.length;
}

function cosineScore(
  left: readonly number[],
  right: readonly number[],
): number | undefined {
  if (
    left.length === 0 ||
    left.length !== right.length ||
    left.some((value) => !Number.isFinite(value)) ||
    right.some((value) => !Number.isFinite(value))
  ) {
    return undefined;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] as number;
    const rightValue = right[index] as number;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue ** 2;
    rightMagnitude += rightValue ** 2;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return undefined;
  }

  const cosine =
    dot / Math.sqrt(leftMagnitude * rightMagnitude);

  return Math.max(
    0,
    Math.min(1, (cosine + 1) / 2),
  );
}

function structuredScore(
  entry: CapaKnowledgeRetrievalIndexEntry,
  queryTerms: readonly string[],
): number {
  const metadata =
    entry.structured_metadata ?? {};
  const text = Object.values(metadata)
    .map((value) =>
      typeof value === "string"
        ? value
        : value.join(" "),
    )
    .join(" ");
  const documentTerms = new Set(tokenize(text));
  const uniqueTerms = [...new Set(queryTerms)];

  if (uniqueTerms.length === 0) {
    return 0;
  }

  return uniqueTerms.filter(
    (term) => documentTerms.has(term),
  ).length / uniqueTerms.length;
}

function effective(
  entry: CapaKnowledgeRetrievalIndexEntry,
  at: string,
): boolean {
  const instant = Date.parse(at);

  return (
    entry.effective_at === undefined ||
    Date.parse(entry.effective_at) <= instant
  ) && (
    entry.retirement_at === undefined ||
    Date.parse(entry.retirement_at) > instant
  );
}

function lifecycleEligible(
  entry: CapaKnowledgeRetrievalIndexEntry,
  historicalPermitted: boolean,
): boolean {
  return entry.source_status === "current_effective" ||
    (
      historicalPermitted &&
      (
        entry.source_status === "superseded" ||
        entry.source_status === "archived"
      )
    );
}

function eligible(
  entry: CapaKnowledgeRetrievalIndexEntry,
  search: CapaKnowledgeRetrievalIndexSearch,
): boolean {
  const { request } = search;
  const { scope, filters } = request;
  const tenantEligible =
    entry.organization_id === scope.organization_id ||
    (
      entry.approved_global &&
      scope.approved_global_sources_permitted
    );

  return tenantEligible &&
    entry.collection_ids.includes(scope.collection_id) &&
    entry.collection_version_ids.includes(
      scope.collection_version_id,
    ) &&
    isCapaKnowledgeIndexSearchable(entry.status) &&
    entry.machine_interpretable &&
    (
      entry.quality_status === "pass" ||
      entry.quality_status === "pass_with_limitations"
    ) &&
    lifecycleEligible(
      entry,
      filters.historical_source_versions_permitted,
    ) &&
    effective(entry, filters.effective_at) &&
    permits(
      entry.permitted_role_ids,
      scope.active_role_ids,
    ) &&
    permits(
      entry.permitted_site_ids,
      scope.permitted_site_ids,
    ) &&
    permits(
      entry.permitted_product_ids,
      scope.permitted_product_ids,
    ) &&
    (
      filters.source_types === undefined ||
      filters.source_types.includes(entry.source_type)
    ) &&
    (
      filters.jurisdictions === undefined ||
      intersects(
        entry.jurisdictions,
        filters.jurisdictions,
      )
    ) &&
    (
      filters.applicability_tags === undefined ||
      intersects(
        entry.applicability_tags,
        filters.applicability_tags,
      )
    );
}

function candidateId(
  retrievalRunId: string,
  passageId: string,
): string {
  const digest = createHash("sha256")
    .update(`${retrievalRunId}:${passageId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");

  digest[12] = "4";
  digest[16] = "8";
  const value = digest.join("");

  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

interface ScoredEntry {
  readonly entry: CapaKnowledgeRetrievalIndexEntry;
  readonly lexical_score?: number;
  readonly semantic_score?: number;
  readonly metadata_score?: number;
  readonly provider_score: number;
}

function scoreEntry(
  entry: CapaKnowledgeRetrievalIndexEntry,
  search: CapaKnowledgeRetrievalIndexSearch,
  method: CapaKnowledgeRetrievalMethod,
): ScoredEntry | null {
  const lexical = lexicalScore(
    entry,
    search.query_terms,
  );
  const semantic =
    search.query_embedding === undefined ||
    entry.semantic_embedding === undefined
      ? undefined
      : cosineScore(
          entry.semantic_embedding,
          search.query_embedding,
        );
  const metadata = structuredScore(
    entry,
    search.query_terms,
  );

  if (
    (method === "vector" && semantic === undefined) ||
    (method === "hybrid" && semantic === undefined)
  ) {
    return null;
  }

  const providerScore = method === "lexical"
    ? lexical
    : method === "vector"
      ? semantic as number
      : method === "structured"
        ? metadata
        : (lexical + (semantic as number) + metadata) / 3;

  return {
    entry,
    lexical_score:
      method === "lexical" || method === "hybrid"
        ? lexical
        : undefined,
    semantic_score:
      method === "vector" || method === "hybrid"
        ? semantic
        : undefined,
    metadata_score:
      method === "structured" || method === "hybrid"
        ? metadata
        : undefined,
    provider_score: providerScore,
  };
}

function candidate(
  scored: ScoredEntry,
  retrievalRunId: string,
  rawRank: number,
): CapaKnowledgeRetrievalCandidate {
  return Object.freeze({
    candidate_id: candidateId(
      retrievalRunId,
      scored.entry.passage_id,
    ) as never,
    source_id: scored.entry.source_id,
    source_version_id:
      scored.entry.source_version_id,
    passage_id: scored.entry.passage_id,
    source_type: scored.entry.source_type,
    source_status: scored.entry.source_status,
    quality_status: scored.entry.quality_status,
    raw_rank: rawRank,
    ...(scored.lexical_score === undefined
      ? {}
      : { lexical_score: scored.lexical_score }),
    ...(scored.semantic_score === undefined
      ? {}
      : { semantic_score: scored.semantic_score }),
    ...(scored.metadata_score === undefined
      ? {}
      : { metadata_score: scored.metadata_score }),
  });
}

export class InMemoryCapaKnowledgeRetrievalRepository
implements CapaKnowledgeRetrievalIndexRepository {
  private readonly entries =
    new Map<string, CapaKnowledgeRetrievalIndexEntry>();

  constructor(
    initialEntries:
      readonly CapaKnowledgeRetrievalIndexEntry[] = [],
  ) {
    for (const entry of initialEntries) {
      const identity = entryKey(entry);

      if (this.entries.has(identity)) {
        throw new CapaKnowledgeRetrievalRepositoryError();
      }

      this.entries.set(identity, entry);
    }
  }

  async findEntry(
    lookup: CapaKnowledgeRetrievalIndexLookup,
  ): Promise<CapaKnowledgeRetrievalIndexEntry | null> {
    const entry = this.entries.get(key(lookup));

    if (entry === undefined) {
      return null;
    }

    return entry.organization_id ===
      lookup.organization_id ||
      (
        entry.approved_global &&
        lookup.approved_global_sources_permitted
      )
      ? entry
      : null;
  }

  async search(
    search: CapaKnowledgeRetrievalIndexSearch,
  ): Promise<CapaKnowledgeRetrievalIndexSearchResult> {
    const request =
      validateCapaKnowledgeRetrievalRequest(
        search.request,
      );
    const queryTerms = Object.freeze(
      [...new Set(
        search.query_terms.map(
          (term) => term.toLocaleLowerCase("en-US"),
        ),
      )],
    );
    const controlledSearch = {
      ...search,
      request,
      query_terms: queryTerms,
    };
    const method = request.policy.retrieval_method;
    const scored = [...this.entries.values()]
      .filter((entry) =>
        eligible(entry, controlledSearch),
      )
      .map((entry) =>
        scoreEntry(entry, controlledSearch, method),
      )
      .filter(
        (entry): entry is ScoredEntry => entry !== null,
      )
      .sort((left, right) =>
        right.provider_score - left.provider_score ||
        [
          left.entry.source_version_id,
          left.entry.passage_id,
        ].join("\u0000").localeCompare(
          [
            right.entry.source_version_id,
            right.entry.passage_id,
          ].join("\u0000"),
        ),
      )
      .slice(0, request.policy.maximum_candidates);
    const candidates = Object.freeze(
      scored.map((entry, index) =>
        candidate(
          entry,
          request.retrieval_run_id,
          index + 1,
        ),
      ),
    );
    const partial = [...this.entries.values()].some(
      (entry) =>
        eligible(entry, controlledSearch) &&
        entry.status === "partial",
    );

    return Object.freeze({
      retrieval_run_id: request.retrieval_run_id,
      retrieval_method: method,
      index_version:
        scored[0]?.entry.index_version ??
        "capa-knowledge-index-1.0.0" as never,
      index_status:
        partial ? "partial" as const : "ready" as const,
      candidates,
    });
  }

  async insertEntry(
    _transaction: TransactionContext,
    entry: CapaKnowledgeRetrievalIndexEntry,
  ): Promise<void> {
    const identity = entryKey(entry);

    if (this.entries.has(identity)) {
      throw new CapaKnowledgeRetrievalRepositoryError();
    }

    this.entries.set(identity, entry);
  }

  async replaceDerivedEntry(
    _transaction: TransactionContext,
    expectedFingerprint:
      CapaKnowledgeRetrievalIndexEntry["normalized_text_fingerprint"],
    entry: CapaKnowledgeRetrievalIndexEntry,
  ): Promise<"replaced" | "conflict" | "not_found_or_not_authorized"> {
    const identity = entryKey(entry);
    const current = this.entries.get(identity);

    if (current === undefined) {
      return "not_found_or_not_authorized";
    }

    if (
      current.normalized_text_fingerprint.algorithm !==
        expectedFingerprint.algorithm ||
      current.normalized_text_fingerprint.value !==
        expectedFingerprint.value
    ) {
      return "conflict";
    }

    this.entries.set(identity, entry);
    return "replaced";
  }
}
