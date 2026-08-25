import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type postgres from "postgres";

import type {
  IsoDateTime,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaKnowledgeCitationId,
} from "../../capa/knowledge/capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeCitationReviewId,
  CapaKnowledgeCitationReviewRecord,
} from "../../capa/knowledge/capa-knowledge-citation-review-contract";

import {
  CapaKnowledgeCitationReviewRepositoryError,
  type AppendCapaKnowledgeCitationResult,
  type AppendCapaKnowledgeCitationReviewResult,
  type CapaKnowledgeCitationReviewListPage,
  type CapaKnowledgeCitationReviewListQuery,
  type CapaKnowledgeCitationReviewRepository,
  type CapaKnowledgeStoredCitation,
} from "../repositories/capa-knowledge-citation-review-repository";

import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;
type QuerySql = postgres.Sql | postgres.TransactionSql;

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CapaKnowledgeCitationReviewRepositoryError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function iso(value: unknown): IsoDateTime {
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    throw new CapaKnowledgeCitationReviewRepositoryError();
  }
  return date.toISOString() as IsoDateTime;
}

function storedCitation(row: Row): CapaKnowledgeStoredCitation {
  const citation = object(row.citation_record);
  return {
    organization_id: row.organization_id as OrganizationId,
    citation: citation as unknown as CapaKnowledgeStoredCitation["citation"],
    claim_text: row.claim_text as string,
    recorded_at: iso(row.recorded_at),
    recorded_by: {
      actor_type: row.recorded_by_actor_type as never,
      actor_id: row.recorded_by_actor_id as string,
      ...(row.recorded_by_actor_version == null
        ? {}
        : { actor_version: row.recorded_by_actor_version as string }),
    },
  };
}

function review(row: Row): CapaKnowledgeCitationReviewRecord {
  return object(row.review_record) as unknown as
    CapaKnowledgeCitationReviewRecord;
}

async function findCitation(
  sql: QuerySql,
  organizationId: OrganizationId,
  citationId: CapaKnowledgeCitationId,
): Promise<CapaKnowledgeStoredCitation | null> {
  const rows = await sql<Row[]>`
    select organization_id, citation_record, claim_text, recorded_at,
           recorded_by_actor_type, recorded_by_actor_id,
           recorded_by_actor_version
    from public.capa_knowledge_citations
    where organization_id = ${organizationId}
      and citation_id = ${citationId}
    limit 1
  `;
  if (rows.length > 1) throw new CapaKnowledgeCitationReviewRepositoryError();
  return rows[0] === undefined ? null : storedCitation(rows[0]);
}

async function findReview(
  sql: QuerySql,
  organizationId: OrganizationId,
  reviewId: CapaKnowledgeCitationReviewId,
): Promise<CapaKnowledgeCitationReviewRecord | null> {
  const rows = await sql<Row[]>`
    select review_record
    from public.capa_knowledge_citation_reviews
    where organization_id = ${organizationId}
      and citation_review_id = ${reviewId}
    limit 1
  `;
  if (rows.length > 1) throw new CapaKnowledgeCitationReviewRepositoryError();
  return rows[0] === undefined ? null : review(rows[0]);
}

export class SupabaseCapaKnowledgeCitationReviewRepository
  implements CapaKnowledgeCitationReviewRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async appendCitation(
    transaction: TransactionContext,
    value: CapaKnowledgeStoredCitation,
  ): Promise<AppendCapaKnowledgeCitationResult> {
    const sql = requireSupabaseTransaction(transaction);
    const digest = fingerprint(value);
    const rows = await sql<Row[]>`
      insert into public.capa_knowledge_citations (
        citation_id, organization_id, claim_id, source_id, source_version_id,
        passage_id, retrieval_run_id, citation_record, claim_text,
        record_fingerprint_algorithm, record_fingerprint, recorded_at,
        recorded_by_actor_type, recorded_by_actor_id, recorded_by_actor_version
      ) values (
        ${value.citation.citation_id}, ${value.organization_id},
        ${value.citation.claim_id}, ${value.citation.source_id},
        ${value.citation.source_version_id}, ${value.citation.passage_id},
        ${value.citation.retrieval_run_id},
        ${sql.json(value.citation as never)}, ${value.claim_text},
        'sha256', ${digest}, ${value.recorded_at},
        ${value.recorded_by.actor_type}, ${value.recorded_by.actor_id},
        ${value.recorded_by.actor_version ?? null}
      ) on conflict (citation_id) do nothing
      returning citation_id
    `;
    if (rows.length === 1) return { status: "appended" };
    if (rows.length > 1) throw new CapaKnowledgeCitationReviewRepositoryError();
    const current = await findCitation(
      sql,
      value.organization_id,
      value.citation.citation_id,
    );
    return current !== null && isDeepStrictEqual(current, value)
      ? { status: "already_recorded" }
      : {
          status: "conflict",
          reason_code: "CITATION_ID_REUSED_WITH_DIFFERENT_CONTENT",
        };
  }

  async findCitationById(
    organizationId: OrganizationId,
    citationId: CapaKnowledgeCitationId,
  ): Promise<CapaKnowledgeStoredCitation | null> {
    return findCitation(this.sql, organizationId, citationId);
  }

  async appendReview(
    transaction: TransactionContext,
    value: CapaKnowledgeCitationReviewRecord,
  ): Promise<AppendCapaKnowledgeCitationReviewResult> {
    const sql = requireSupabaseTransaction(transaction);
    const digest = fingerprint(value);
    const rows = await sql<Row[]>`
      insert into public.capa_knowledge_citation_reviews (
        citation_review_id, organization_id, citation_id, claim_id, source_id,
        source_version_id, passage_id, retrieval_run_id, review_record,
        record_fingerprint_algorithm, record_fingerprint, reviewed_at,
        reviewed_by_actor_type, reviewed_by_actor_id, reviewed_by_actor_version
      ) values (
        ${value.citation_review_id}, ${value.organization_id},
        ${value.citation_id}, ${value.claim_id}, ${value.source_id},
        ${value.source_version_id}, ${value.passage_id},
        ${value.retrieval_run_id}, ${sql.json(value as never)},
        'sha256', ${digest}, ${value.reviewed_at},
        ${value.reviewed_by.actor_type}, ${value.reviewed_by.actor_id},
        ${value.reviewed_by.actor_version ?? null}
      ) on conflict (citation_review_id) do nothing
      returning citation_review_id
    `;
    if (rows.length === 1) return { status: "appended" };
    if (rows.length > 1) throw new CapaKnowledgeCitationReviewRepositoryError();
    const current = await findReview(
      sql,
      value.organization_id,
      value.citation_review_id,
    );
    if (current !== null) {
      return isDeepStrictEqual(current, value)
        ? { status: "already_recorded" }
        : {
            status: "conflict",
            reason_code:
              "CITATION_REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
          };
    }
    const citation = await findCitation(
      sql,
      value.organization_id,
      value.citation_id,
    );
    return citation === null
      ? { status: "citation_not_found_or_not_authorized" }
      : {
          status: "conflict",
          reason_code:
            "CITATION_REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
        };
  }

  async findReviewById(
    organizationId: OrganizationId,
    reviewId: CapaKnowledgeCitationReviewId,
  ): Promise<CapaKnowledgeCitationReviewRecord | null> {
    return findReview(this.sql, organizationId, reviewId);
  }

  async listReviewsForCitation(
    query: CapaKnowledgeCitationReviewListQuery,
  ): Promise<CapaKnowledgeCitationReviewListPage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new CapaKnowledgeCitationReviewRepositoryError();
    }
    const rows = await this.sql<Row[]>`
      select review_record
      from public.capa_knowledge_citation_reviews
      where organization_id = ${query.organization_id}
        and citation_id = ${query.citation_id}
        and (${query.after_review_id ?? null}::uuid is null
          or citation_review_id > ${query.after_review_id ?? null})
      order by citation_review_id
      limit ${query.limit + 1}
    `;
    const values = rows.slice(0, query.limit).map(review);
    return Object.freeze({
      reviews: Object.freeze(values),
      ...(rows.length > query.limit && values.length > 0
        ? { next_review_id: values[values.length - 1]!.citation_review_id }
        : {}),
    });
  }
}
