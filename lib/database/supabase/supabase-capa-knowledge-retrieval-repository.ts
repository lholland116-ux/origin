import type postgres from "postgres";

import type {
  IsoDateTime,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaKnowledgeFingerprintRecord,
} from "../../capa/knowledge/capa-knowledge-contract";

import type {
  CapaKnowledgeRetrievalCandidate,
} from "../../capa/knowledge/capa-knowledge-retrieval-contract";

import {
  validateCapaKnowledgeRetrievalRequest,
} from "../../capa/knowledge/capa-knowledge-retrieval-validator";

import {
  CapaKnowledgeRetrievalRepositoryError,
  type CapaKnowledgeRetrievalIndexEntry,
  type CapaKnowledgeRetrievalIndexLookup,
  type CapaKnowledgeRetrievalIndexRepository,
  type CapaKnowledgeRetrievalIndexSearch,
  type CapaKnowledgeRetrievalIndexSearchResult,
} from "../repositories/capa-knowledge-retrieval-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

type RetrievalRow = postgres.Row &
  Readonly<Record<string, unknown>>;

function stringArray(
  value: unknown,
  label: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new CapaKnowledgeRetrievalRepositoryError(
      `The retrieval index returned invalid ${label}.`,
    );
  }

  return value;
}

function numberArray(
  value: unknown,
  label: string,
): readonly number[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        typeof item === "number" &&
        Number.isFinite(item),
    )
  ) {
    throw new CapaKnowledgeRetrievalRepositoryError(
      `The retrieval index returned invalid ${label}.`,
    );
  }

  return value;
}

function optionalObject(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new CapaKnowledgeRetrievalRepositoryError(
      `The retrieval index returned invalid ${label}.`,
    );
  }

  return value as Readonly<Record<string, unknown>>;
}

function iso(value: unknown): IsoDateTime {
  const parsed = value instanceof Date
    ? value
    : new Date(value as string);

  if (Number.isNaN(parsed.getTime())) {
    throw new CapaKnowledgeRetrievalRepositoryError(
      "The retrieval index returned an invalid timestamp.",
    );
  }

  return parsed.toISOString() as IsoDateTime;
}

function fingerprint(
  algorithm: unknown,
  value: unknown,
): CapaKnowledgeFingerprintRecord {
  if (
    algorithm !== "sha256" ||
    typeof value !== "string" ||
    !/^[0-9a-f]{64}$/.test(value)
  ) {
    throw new CapaKnowledgeRetrievalRepositoryError(
      "The retrieval index returned an invalid fingerprint.",
    );
  }

  return {
    algorithm,
    value: value as never,
  };
}

function optionalIso(
  value: unknown,
): Readonly<Record<string, IsoDateTime>> {
  return value === null || value === undefined
    ? {}
    : { value: iso(value) };
}

function toEntry(
  row: RetrievalRow,
): CapaKnowledgeRetrievalIndexEntry {
  const effective = optionalIso(row.effective_at);
  const retirement = optionalIso(row.retirement_at);
  const lexical = optionalObject(
    row.lexical_document,
    "lexical document",
  );
  const structured = optionalObject(
    row.structured_metadata,
    "structured metadata",
  );
  const embedding =
    row.semantic_embedding === null ||
    row.semantic_embedding === undefined
      ? undefined
      : numberArray(
          row.semantic_embedding,
          "semantic embedding",
        );

  return {
    passage_id: row.passage_id as never,
    source_id: row.source_id as never,
    source_version_id:
      row.source_version_id as never,
    collection_ids:
      stringArray(row.collection_ids, "collection identities") as never,
    collection_version_ids:
      stringArray(
        row.collection_version_ids,
        "collection-version identities",
      ) as never,
    ...(row.organization_id === null ||
    row.organization_id === undefined
      ? {}
      : {
          organization_id:
            row.organization_id as OrganizationId,
        }),
    approved_global: row.approved_global === true,
    source_type: row.source_type as never,
    source_status: row.source_status as never,
    quality_status: row.quality_status as never,
    ...(effective.value === undefined
      ? {}
      : { effective_at: effective.value }),
    ...(retirement.value === undefined
      ? {}
      : { retirement_at: retirement.value }),
    permitted_role_ids:
      stringArray(row.permitted_role_ids, "role access"),
    permitted_site_ids:
      stringArray(row.permitted_site_ids, "site access"),
    permitted_product_ids:
      stringArray(row.permitted_product_ids, "product access"),
    jurisdictions:
      stringArray(row.jurisdictions, "jurisdictions"),
    applicability_tags:
      stringArray(row.applicability_tags, "applicability tags") as never,
    machine_interpretable:
      row.machine_interpretable === true,
    normalized_text: row.normalized_text as string,
    normalized_text_fingerprint: fingerprint(
      row.normalized_text_fingerprint_algorithm,
      row.normalized_text_fingerprint,
    ),
    ...(lexical === undefined
      ? {}
      : { lexical_document: lexical as Readonly<Record<string, number>> }),
    ...(embedding === undefined
      ? {}
      : { semantic_embedding: embedding }),
    ...(structured === undefined
      ? {}
      : {
          structured_metadata:
            structured as Readonly<
              Record<string, string | readonly string[]>
            >,
        }),
    index_version: row.index_version as never,
    status: row.status as never,
    indexed_at: iso(row.indexed_at),
  };
}

function optionalScore(
  row: RetrievalRow,
  name: "lexical_score" | "semantic_score" | "metadata_score",
): Readonly<Record<string, number>> {
  const value = row[name];

  if (value === null || value === undefined) {
    return {};
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new CapaKnowledgeRetrievalRepositoryError(
      "The retrieval index returned an invalid score.",
    );
  }

  return { [name]: parsed };
}

function toCandidate(
  row: RetrievalRow,
): CapaKnowledgeRetrievalCandidate {
  const rawRank = Number(row.raw_rank);

  if (!Number.isSafeInteger(rawRank) || rawRank < 1) {
    throw new CapaKnowledgeRetrievalRepositoryError(
      "The retrieval index returned an invalid raw rank.",
    );
  }

  return Object.freeze({
    candidate_id: row.candidate_id as never,
    source_id: row.source_id as never,
    source_version_id:
      row.source_version_id as never,
    passage_id: row.passage_id as never,
    source_type: row.source_type as never,
    source_status: row.source_status as never,
    quality_status: row.quality_status as never,
    raw_rank: rawRank,
    ...optionalScore(row, "lexical_score"),
    ...optionalScore(row, "semantic_score"),
    ...optionalScore(row, "metadata_score"),
  }) as CapaKnowledgeRetrievalCandidate;
}

function json(
  sql: postgres.Sql | postgres.TransactionSql,
  value: unknown,
) {
  return sql.json(
    value as postgres.JSONValue,
  );
}

export class SupabaseCapaKnowledgeRetrievalRepository
implements CapaKnowledgeRetrievalIndexRepository {
  constructor(
    private readonly sql: postgres.Sql,
  ) {}

  async findEntry(
    lookup: CapaKnowledgeRetrievalIndexLookup,
  ): Promise<CapaKnowledgeRetrievalIndexEntry | null> {
    const rows = await this.sql<RetrievalRow[]>`
      select *
      from public.capa_knowledge_retrieval_index_entries
      where source_version_id = ${lookup.source_version_id}
        and passage_id = ${lookup.passage_id}
        and index_version = ${lookup.index_version}
        and (
          organization_id = ${lookup.organization_id}
          or (
            approved_global = true
            and ${lookup.approved_global_sources_permitted}
          )
        )
      limit 1
    `;

    return rows[0] === undefined
      ? null
      : toEntry(rows[0]);
  }

  async search(
    search: CapaKnowledgeRetrievalIndexSearch,
  ): Promise<CapaKnowledgeRetrievalIndexSearchResult> {
    const request =
      validateCapaKnowledgeRetrievalRequest(
        search.request,
      );
    const rows = await this.sql<RetrievalRow[]>`
      select *
      from private.search_capa_knowledge_retrieval_index(
        ${request.retrieval_run_id},
        ${request.scope.organization_id},
        ${request.scope.collection_id},
        ${request.scope.collection_version_id},
        ${request.scope.approved_global_sources_permitted},
        ${request.scope.active_role_ids},
        ${request.scope.permitted_site_ids},
        ${request.scope.permitted_product_ids},
        ${request.filters.source_types ?? null},
        ${request.filters.jurisdictions ?? null},
        ${request.filters.applicability_tags ?? null},
        ${request.filters.effective_at},
        ${request.filters.historical_source_versions_permitted},
        ${request.policy.retrieval_method},
        ${search.normalized_query},
        ${search.query_embedding ?? null},
        ${request.policy.maximum_candidates}
      )
    `;
    const candidates = Object.freeze(
      rows.map(toCandidate),
    );
    const partial = rows.some(
      (row) => row.index_status === "partial",
    );

    return Object.freeze({
      retrieval_run_id:
        request.retrieval_run_id,
      retrieval_method:
        request.policy.retrieval_method,
      index_version:
        (rows[0]?.index_version ??
          "capa-knowledge-index-1.0.0") as never,
      index_status:
        partial ? "partial" as const : "ready" as const,
      candidates,
    });
  }

  async insertEntry(
    transaction: TransactionContext,
    value: CapaKnowledgeRetrievalIndexEntry,
  ): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);

    await sql`
      insert into public.capa_knowledge_retrieval_index_entries (
        passage_id, source_id, source_version_id, organization_id,
        approved_global, collection_ids, collection_version_ids, source_type,
        source_status, quality_status, effective_at, retirement_at,
        permitted_role_ids, permitted_site_ids, permitted_product_ids,
        jurisdictions, applicability_tags, machine_interpretable,
        normalized_text, normalized_text_fingerprint_algorithm,
        normalized_text_fingerprint, lexical_document, semantic_embedding,
        structured_metadata, index_version, status, indexed_at
      ) values (
        ${value.passage_id}, ${value.source_id}, ${value.source_version_id},
        ${value.organization_id ?? null}, ${value.approved_global},
        ${value.collection_ids}, ${value.collection_version_ids},
        ${value.source_type}, ${value.source_status}, ${value.quality_status},
        ${value.effective_at ?? null}, ${value.retirement_at ?? null},
        ${value.permitted_role_ids}, ${value.permitted_site_ids},
        ${value.permitted_product_ids}, ${value.jurisdictions},
        ${value.applicability_tags}, ${value.machine_interpretable},
        ${value.normalized_text}, ${value.normalized_text_fingerprint.algorithm},
        ${value.normalized_text_fingerprint.value},
        ${value.lexical_document === undefined
          ? null
          : json(sql, value.lexical_document)},
        ${value.semantic_embedding ?? null},
        ${value.structured_metadata === undefined
          ? null
          : json(sql, value.structured_metadata)},
        ${value.index_version}, ${value.status}, ${value.indexed_at}
      )
    `;
  }

  async replaceDerivedEntry(
    transaction: TransactionContext,
    expectedFingerprint: CapaKnowledgeFingerprintRecord,
    value: CapaKnowledgeRetrievalIndexEntry,
  ): Promise<"replaced" | "conflict" | "not_found_or_not_authorized"> {
    const sql = requireSupabaseTransaction(transaction);
    const rows = await sql<RetrievalRow[]>`
      update public.capa_knowledge_retrieval_index_entries
      set normalized_text = ${value.normalized_text},
          normalized_text_fingerprint_algorithm =
            ${value.normalized_text_fingerprint.algorithm},
          normalized_text_fingerprint =
            ${value.normalized_text_fingerprint.value},
          lexical_document = ${value.lexical_document === undefined
            ? null
            : json(sql, value.lexical_document)},
          semantic_embedding = ${value.semantic_embedding ?? null},
          structured_metadata = ${value.structured_metadata === undefined
            ? null
            : json(sql, value.structured_metadata)},
          status = ${value.status},
          indexed_at = ${value.indexed_at}
      where source_version_id = ${value.source_version_id}
        and passage_id = ${value.passage_id}
        and index_version = ${value.index_version}
        and normalized_text_fingerprint_algorithm =
          ${expectedFingerprint.algorithm}
        and normalized_text_fingerprint = ${expectedFingerprint.value}
      returning source_version_id
    `;

    if (rows.length === 1) {
      return "replaced";
    }
    if (rows.length > 1) {
      throw new CapaKnowledgeRetrievalRepositoryError();
    }

    const current = await sql<RetrievalRow[]>`
      select normalized_text_fingerprint_algorithm,
             normalized_text_fingerprint
      from public.capa_knowledge_retrieval_index_entries
      where source_version_id = ${value.source_version_id}
        and passage_id = ${value.passage_id}
        and index_version = ${value.index_version}
      limit 1
    `;

    return current[0] === undefined
      ? "not_found_or_not_authorized"
      : "conflict";
  }
}
