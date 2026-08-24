import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  CapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeRetrievalIndexEntry,
} from "../../lib/database/repositories/capa-knowledge-retrieval-repository";

import {
  CapaKnowledgeRetrievalRepositoryError,
} from "../../lib/database/repositories/capa-knowledge-retrieval-repository";

import {
  SupabaseCapaKnowledgeRetrievalRepository,
} from "../../lib/database/supabase/supabase-capa-knowledge-retrieval-repository";

import {
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

import type {
  TransactionContext,
} from "../../lib/database/transactions";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";
const SOURCE_ID =
  "20000000-0000-4000-8000-000000000002";
const VERSION_ID =
  "30000000-0000-4000-8000-000000000003";
const PASSAGE_ID =
  "40000000-0000-4000-8000-000000000004";
const COLLECTION_ID =
  "50000000-0000-4000-8000-000000000005";
const COLLECTION_VERSION_ID =
  "60000000-0000-4000-8000-000000000006";
const RUN_ID =
  "70000000-0000-4000-8000-000000000007";
const HASH = "a".repeat(64);
const NOW = "2026-08-24T14:00:00.000Z";

interface Call {
  readonly query: string;
  readonly values: readonly unknown[];
}

function harness() {
  const calls: Call[] = [];
  const responses: unknown[] = [];
  const tagged = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({
      query: strings.join("?").replace(/\s+/g, " ").trim(),
      values,
    });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response ?? [];
  });
  const transaction = Object.assign(tagged, {
    json: (value: unknown) => value,
  });
  const sql = Object.assign(tagged, {
    json: (value: unknown) => value,
    begin: vi.fn(async (
      _options: string,
      work: (value: postgres.TransactionSql) => Promise<unknown>,
    ) => work(transaction as unknown as postgres.TransactionSql)),
  }) as unknown as postgres.Sql;

  return {
    sql,
    calls,
    enqueue(...values: readonly unknown[]) {
      responses.push(...values);
    },
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id:
      "80000000-0000-4000-8000-000000000008",
    source_id: SOURCE_ID,
    source_version_id: VERSION_ID,
    passage_id: PASSAGE_ID,
    collection_ids: [COLLECTION_ID],
    collection_version_ids: [COLLECTION_VERSION_ID],
    organization_id: ORGANIZATION_ID,
    approved_global: false,
    source_type: "SRC-01",
    source_status: "current_effective",
    quality_status: "pass",
    effective_at: NOW,
    retirement_at: null,
    permitted_role_ids: ["CAPA_OWNER"],
    permitted_site_ids: [],
    permitted_product_ids: [],
    jurisdictions: ["US"],
    applicability_tags: ["CAPA"],
    machine_interpretable: true,
    normalized_text: "seal validation failure",
    normalized_text_fingerprint_algorithm: "sha256",
    normalized_text_fingerprint: HASH,
    lexical_document: { seal: 1 },
    semantic_embedding: [1, 0],
    structured_metadata: { topic: "seal" },
    index_version: "capa-knowledge-index-1.0.0",
    index_status: "ready",
    status: "ready",
    indexed_at: NOW,
    raw_rank: "1",
    lexical_score: 0.9,
    semantic_score: null,
    metadata_score: null,
    ...overrides,
  };
}

function request(): CapaKnowledgeRetrievalRequest {
  return {
    retrieval_run_id: RUN_ID,
    query_id:
      "90000000-0000-4000-8000-000000000009",
    request_trace: {
      request_id: "request-1",
      correlation_id: "correlation-1",
    },
    scope: {
      organization_id: ORGANIZATION_ID,
      actor: {
        actor_type: "human",
        actor_id: "user-1",
      },
      active_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: [],
      permitted_product_ids: [],
      collection_id: COLLECTION_ID,
      collection_version_id: COLLECTION_VERSION_ID,
      approved_global_sources_permitted: false,
    },
    task_type: "CAPA_ROOT_CAUSE",
    query_text: "seal validation failure",
    query_fingerprint: {
      algorithm: "sha256",
      value: HASH,
    },
    filters: {
      effective_at: NOW,
      historical_source_versions_permitted: false,
    },
    policy: {
      retrieval_policy_version: "retrieval-1.0.0",
      source_precedence_policy_version: "precedence-1.0.0",
      query_construction_version: "query-1.0.0",
      ranking_policy_version: "ranking-1.0.0",
      citation_policy_version: "citation-1.0.0",
      retrieval_method: "lexical",
      maximum_candidates: 10,
      maximum_results: 5,
      maximum_total_characters: 10_000,
      minimum_relevance_score: 0.1,
    },
    requested_at: NOW,
  } as unknown as CapaKnowledgeRetrievalRequest;
}

function entry(): CapaKnowledgeRetrievalIndexEntry {
  return {
    ...row(),
    passage_id: PASSAGE_ID,
    source_id: SOURCE_ID,
    source_version_id: VERSION_ID,
    normalized_text_fingerprint: {
      algorithm: "sha256",
      value: HASH,
    },
  } as unknown as CapaKnowledgeRetrievalIndexEntry;
}

async function inTransaction<Result>(
  sql: postgres.Sql,
  work: (transaction: TransactionContext) => Promise<Result>,
): Promise<Result> {
  return new SupabaseTransactionManager(sql)
    .runInTransaction(
      {
        request_id: "request-1",
        correlation_id: "correlation-1",
      } as never,
      work,
    );
}

describe(
  "Supabase CAPA knowledge retrieval repository",
  () => {
    it(
      "performs an explicitly scoped exact lookup",
      async () => {
        const test = harness();
        test.enqueue([row()]);

        const result = await new SupabaseCapaKnowledgeRetrievalRepository(
          test.sql,
        ).findEntry({
          organization_id: ORGANIZATION_ID,
          approved_global_sources_permitted: false,
          passage_id: PASSAGE_ID,
          source_version_id: VERSION_ID,
          index_version: "capa-knowledge-index-1.0.0",
        } as never);

        expect(result?.passage_id).toBe(PASSAGE_ID);
        expect(test.calls[0]?.query)
          .toContain("organization_id = ?");
        expect(test.calls[0]?.values)
          .toContain(ORGANIZATION_ID);
      },
    );

    it(
      "returns null without cross-scope fallback",
      async () => {
        const test = harness();
        test.enqueue([]);

        await expect(
          new SupabaseCapaKnowledgeRetrievalRepository(test.sql)
            .findEntry({
              organization_id: ORGANIZATION_ID,
              approved_global_sources_permitted: false,
              passage_id: PASSAGE_ID,
              source_version_id: VERSION_ID,
              index_version: "capa-knowledge-index-1.0.0",
            } as never),
        ).resolves.toBeNull();
      },
    );

    it(
      "calls the governed search boundary and maps metadata-only candidates",
      async () => {
        const test = harness();
        test.enqueue([row()]);

        const result = await new SupabaseCapaKnowledgeRetrievalRepository(
          test.sql,
        ).search({
          request: request(),
          normalized_query: "seal validation failure",
          query_terms: ["seal", "validation", "failure"],
        });

        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0])
          .toMatchObject({
            passage_id: PASSAGE_ID,
            raw_rank: 1,
            lexical_score: 0.9,
          });
        expect(result.candidates[0])
          .not.toHaveProperty("content");
        expect(test.calls[0]?.query)
          .toContain("private.search_capa_knowledge_retrieval_index");
      },
    );

    it(
      "preserves a partial-index warning state",
      async () => {
        const test = harness();
        test.enqueue([row({ index_status: "partial" })]);

        const result = await new SupabaseCapaKnowledgeRetrievalRepository(
          test.sql,
        ).search({
          request: request(),
          normalized_query: "seal",
          query_terms: ["seal"],
        });

        expect(result.index_status).toBe("partial");
      },
    );

    it(
      "rejects malformed candidate scores",
      async () => {
        const test = harness();
        test.enqueue([row({ lexical_score: 2 })]);

        await expect(
          new SupabaseCapaKnowledgeRetrievalRepository(test.sql)
            .search({
              request: request(),
              normalized_query: "seal",
              query_terms: ["seal"],
            }),
        ).rejects.toBeInstanceOf(
          CapaKnowledgeRetrievalRepositoryError,
        );
      },
    );

    it(
      "inserts derived index material only inside a transaction",
      async () => {
        const test = harness();
        test.enqueue([]);

        await inTransaction(
          test.sql,
          (transaction) =>
            new SupabaseCapaKnowledgeRetrievalRepository(test.sql)
              .insertEntry(transaction, entry()),
        );

        expect(test.calls.some(
          (call) => call.query.includes(
            "insert into public.capa_knowledge_retrieval_index_entries",
          ),
        )).toBe(true);
      },
    );

    it.each([
      ["replaced", [[{ source_version_id: VERSION_ID }]]],
      ["conflict", [[], [row()]]],
      ["not_found_or_not_authorized", [[], []]],
    ] as const)(
      "returns fingerprint-guarded replacement outcome %s",
      async (expected, responses) => {
        const test = harness();
        test.enqueue(...responses);

        const result = await inTransaction(
          test.sql,
          (transaction) =>
            new SupabaseCapaKnowledgeRetrievalRepository(test.sql)
              .replaceDerivedEntry(
                transaction,
                {
                  algorithm: "sha256",
                  value: HASH,
                } as never,
                entry(),
              ),
        );

        expect(result).toBe(expected);
      },
    );


    it.each([
      ["collection identities", { collection_ids: null }],
      ["semantic embedding", { semantic_embedding: [Number.NaN] }],
      ["lexical document", { lexical_document: "invalid" }],
      ["timestamp", { indexed_at: "invalid" }],
      ["fingerprint", { normalized_text_fingerprint: "invalid" }],
    ])(
      "rejects malformed persisted %s",
      async (_label, override) => {
        const test = harness();
        test.enqueue([row(override)]);

        await expect(
          new SupabaseCapaKnowledgeRetrievalRepository(
            test.sql,
          ).findEntry({
            organization_id: ORGANIZATION_ID,
            approved_global_sources_permitted: false,
            passage_id: PASSAGE_ID,
            source_version_id: VERSION_ID,
            index_version:
              "capa-knowledge-index-1.0.0",
          } as never),
        ).rejects.toBeInstanceOf(
          CapaKnowledgeRetrievalRepositoryError,
        );
      },
    );

    it.each([
      "0",
      "1.5",
      "invalid",
    ])(
      "rejects invalid persisted raw rank %s",
      async (rawRank) => {
        const test = harness();
        test.enqueue([row({ raw_rank: rawRank })]);

        await expect(
          new SupabaseCapaKnowledgeRetrievalRepository(
            test.sql,
          ).search({
            request: request(),
            normalized_query: "seal",
            query_terms: ["seal"],
          }),
        ).rejects.toBeInstanceOf(
          CapaKnowledgeRetrievalRepositoryError,
        );
      },
    );

    it(
      "maps optional persisted values when absent",
      async () => {
        const test = harness();
        test.enqueue([row({
          organization_id: null,
          effective_at: null,
          retirement_at: null,
          lexical_document: null,
          semantic_embedding: null,
          structured_metadata: null,
        })]);

        const result =
          await new SupabaseCapaKnowledgeRetrievalRepository(
            test.sql,
          ).findEntry({
            organization_id: ORGANIZATION_ID,
            approved_global_sources_permitted: true,
            passage_id: PASSAGE_ID,
            source_version_id: VERSION_ID,
            index_version:
              "capa-knowledge-index-1.0.0",
          } as never);

        expect(result).not.toHaveProperty(
          "organization_id",
        );
        expect(result).not.toHaveProperty(
          "lexical_document",
        );
      },
    );

    it(
      "maps every optional candidate score",
      async () => {
        const test = harness();
        test.enqueue([row({
          lexical_score: null,
          semantic_score: 0.8,
          metadata_score: 0.7,
        })]);

        const result =
          await new SupabaseCapaKnowledgeRetrievalRepository(
            test.sql,
          ).search({
            request: request(),
            normalized_query: "seal",
            query_terms: ["seal"],
          });

        expect(result.candidates[0])
          .toMatchObject({
            semantic_score: 0.8,
            metadata_score: 0.7,
          });
        expect(result.candidates[0])
          .not.toHaveProperty("lexical_score");
      },
    );

    it(
      "rejects a non-unique guarded replacement",
      async () => {
        const test = harness();
        test.enqueue([row(), row()]);

        await expect(
          inTransaction(
            test.sql,
            (transaction) =>
              new SupabaseCapaKnowledgeRetrievalRepository(
                test.sql,
              ).replaceDerivedEntry(
                transaction,
                {
                  algorithm: "sha256",
                  value: HASH,
                } as never,
                entry(),
              ),
          ),
        ).rejects.toBeInstanceOf(
          CapaKnowledgeRetrievalRepositoryError,
        );
      },
    );


    it(
      "uses the controlled index version for an empty search",
      async () => {
        const test = harness();
        test.enqueue([]);

        const result = await new SupabaseCapaKnowledgeRetrievalRepository(
          test.sql,
        ).search({
          request: request(),
          normalized_query: "unmatched",
          query_terms: ["unmatched"],
        });

        expect(result).toMatchObject({
          index_version: "capa-knowledge-index-1.0.0",
          index_status: "ready",
          candidates: [],
        });
      },
    );

    it(
      "maps Date timestamps and a present retirement boundary",
      async () => {
        const test = harness();
        test.enqueue([row({
          indexed_at: new Date(NOW),
          retirement_at: "2027-08-24T14:00:00.000Z",
        })]);

        const result = await new SupabaseCapaKnowledgeRetrievalRepository(
          test.sql,
        ).findEntry({
          organization_id: ORGANIZATION_ID,
          approved_global_sources_permitted: false,
          passage_id: PASSAGE_ID,
          source_version_id: VERSION_ID,
          index_version: "capa-knowledge-index-1.0.0",
        } as never);

        expect(result).toMatchObject({
          indexed_at: NOW,
          retirement_at: "2027-08-24T14:00:00.000Z",
        });
      },
    );

    it(
      "writes absent optional derived material as null",
      async () => {
        const test = harness();
        test.enqueue([]);
        const value = {
          ...entry(),
          organization_id: undefined,
          effective_at: undefined,
          retirement_at: undefined,
          lexical_document: undefined,
          semantic_embedding: undefined,
          structured_metadata: undefined,
        } as unknown as CapaKnowledgeRetrievalIndexEntry;

        await inTransaction(
          test.sql,
          (transaction) =>
            new SupabaseCapaKnowledgeRetrievalRepository(test.sql)
              .insertEntry(transaction, value),
        );

        const insert = test.calls.find((call) =>
          call.query.includes(
            "insert into public.capa_knowledge_retrieval_index_entries",
          ),
        );
        expect(insert?.values.filter((value) => value === null).length)
          .toBeGreaterThanOrEqual(6);
      },
    );

    it(
      "replaces absent optional derived material as null",
      async () => {
        const test = harness();
        test.enqueue([{ source_version_id: VERSION_ID }]);
        const value = {
          ...entry(),
          lexical_document: undefined,
          semantic_embedding: undefined,
          structured_metadata: undefined,
        } as unknown as CapaKnowledgeRetrievalIndexEntry;

        const result = await inTransaction(
          test.sql,
          (transaction) =>
            new SupabaseCapaKnowledgeRetrievalRepository(test.sql)
              .replaceDerivedEntry(
                transaction,
                { algorithm: "sha256", value: HASH } as never,
                value,
              ),
        );

        expect(result).toBe("replaced");
      },
    );
  },
);
