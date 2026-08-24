import {
  describe,
  expect,
  it,
} from "vitest";

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
  InMemoryCapaKnowledgeRetrievalRepository,
} from "../../lib/database/in-memory/in-memory-capa-knowledge-retrieval-repository";

const ORGANIZATION_ID =
  "00000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID =
  "00000000-0000-4000-8000-000000000002";
const COLLECTION_ID =
  "00000000-0000-4000-8000-000000000010";
const COLLECTION_VERSION_ID =
  "00000000-0000-4000-8000-000000000011";
const SOURCE_ID =
  "00000000-0000-4000-8000-000000000020";
const SOURCE_VERSION_ID =
  "00000000-0000-4000-8000-000000000021";
const PASSAGE_ID =
  "00000000-0000-4000-8000-000000000022";
const FINGERPRINT = {
  algorithm: "sha256",
  value: "a".repeat(64) as never,
} as const;

function request(
  overrides: Record<string, unknown> = {},
): CapaKnowledgeRetrievalRequest {
  const base = {
    retrieval_run_id:
      "00000000-0000-4000-8000-000000000030",
    query_id:
      "00000000-0000-4000-8000-000000000031",
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
      permitted_site_ids: ["SITE-1"],
      permitted_product_ids: ["PRODUCT-1"],
      collection_id: COLLECTION_ID,
      collection_version_id:
        COLLECTION_VERSION_ID,
      approved_global_sources_permitted:
        false,
    },
    task_type: "CAPA_ROOT_CAUSE",
    query_text:
      "seal validation failure",
    query_fingerprint: FINGERPRINT,
    filters: {
      effective_at:
        "2026-08-24T14:00:00.000Z",
      historical_source_versions_permitted:
        false,
    },
    policy: {
      retrieval_policy_version:
        "retrieval-1.0.0",
      source_precedence_policy_version:
        "precedence-1.0.0",
      query_construction_version:
        "query-1.0.0",
      ranking_policy_version:
        "ranking-1.0.0",
      citation_policy_version:
        "citation-1.0.0",
      retrieval_method: "lexical",
      maximum_candidates: 10,
      maximum_results: 5,
      maximum_total_characters: 10_000,
      minimum_relevance_score: 0.1,
    },
    requested_at:
      "2026-08-24T14:00:00.000Z",
  };

  return {
    ...base,
    ...overrides,
  } as unknown as CapaKnowledgeRetrievalRequest;
}

function entry(
  overrides:
    Partial<CapaKnowledgeRetrievalIndexEntry> = {},
): CapaKnowledgeRetrievalIndexEntry {
  return {
    passage_id: PASSAGE_ID as never,
    source_id: SOURCE_ID as never,
    source_version_id:
      SOURCE_VERSION_ID as never,
    collection_ids: [
      COLLECTION_ID as never,
    ],
    collection_version_ids: [
      COLLECTION_VERSION_ID as never,
    ],
    organization_id:
      ORGANIZATION_ID as never,
    approved_global: false,
    source_type: "SRC-01",
    source_status: "current_effective",
    quality_status: "pass",
    effective_at:
      "2026-08-01T00:00:00.000Z" as never,
    permitted_role_ids: ["CAPA_OWNER"],
    permitted_site_ids: ["SITE-1"],
    permitted_product_ids: ["PRODUCT-1"],
    jurisdictions: ["US"],
    applicability_tags: [
      "sterile-barrier" as never,
    ],
    machine_interpretable: true,
    normalized_text:
      "Seal validation failure investigation",
    normalized_text_fingerprint:
      FINGERPRINT,
    lexical_document: {
      seal: 1,
      validation: 1,
      failure: 1,
      investigation: 1,
    },
    semantic_embedding: [1, 0],
    structured_metadata: {
      topic: "seal validation",
    },
    index_version:
      "capa-knowledge-index-1.0.0" as never,
    status: "ready",
    indexed_at:
      "2026-08-24T13:00:00.000Z" as never,
    ...overrides,
  };
}

function search(
  retrievalRequest = request(),
  overrides: Record<string, unknown> = {},
) {
  return {
    request: retrievalRequest,
    normalized_query:
      "seal validation failure",
    query_terms: [
      "seal",
      "validation",
      "failure",
    ],
    ...overrides,
  } as never;
}

const TRANSACTION = {} as never;

describe(
  "in-memory governed CAPA knowledge retrieval repository",
  () => {
    it(
      "returns deterministic metadata-only lexical candidates",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry(),
          ]);

        const first = await repository.search(
          search(),
        );
        const retry = await repository.search(
          search(),
        );

        expect(retry).toEqual(first);
        expect(first).toMatchObject({
          retrieval_method: "lexical",
          index_status: "ready",
          candidates: [{
            passage_id: PASSAGE_ID,
            raw_rank: 1,
            lexical_score: 1,
          }],
        });
        expect(first.candidates[0])
          .not.toHaveProperty("content");
      },
    );

    it.each([
      [
        "other tenant",
        { organization_id: OTHER_ORGANIZATION_ID as never },
      ],
      [
        "blocked index",
        { status: "blocked" as const },
      ],
      [
        "failed quality",
        { quality_status: "failed" as const },
      ],
      [
        "non-machine-interpretable passage",
        { machine_interpretable: false },
      ],
      [
        "future effectivity",
        {
          effective_at:
            "2026-09-01T00:00:00.000Z" as never,
        },
      ],
      [
        "retired material",
        {
          retirement_at:
            "2026-08-20T00:00:00.000Z" as never,
        },
      ],
      [
        "unauthorized role",
        { permitted_role_ids: ["CAPA_AUDITOR"] },
      ],
      [
        "wrong collection",
        {
          collection_version_ids: [
            "00000000-0000-4000-8000-000000000099" as never,
          ],
        },
      ],
    ])(
      "filters %s before disclosure",
      async (_label, override) => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry(override),
          ]);

        const result = await repository.search(
          search(),
        );

        expect(result.candidates).toEqual([]);
      },
    );

    it(
      "permits approved-global material only when explicitly allowed",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({
              organization_id: undefined,
              approved_global: true,
            }),
          ]);
        const denied = await repository.search(
          search(),
        );
        const permittedRequest = request({
          scope: {
            ...request().scope,
            approved_global_sources_permitted:
              true,
          },
        });
        const permitted = await repository.search(
          search(permittedRequest),
        );

        expect(denied.candidates).toEqual([]);
        expect(permitted.candidates)
          .toHaveLength(1);
      },
    );

    it(
      "supports vector, structured and hybrid signals",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry(),
          ]);

        for (const method of [
          "vector",
          "structured",
          "hybrid",
        ] as const) {
          const methodRequest = request({
            policy: {
              ...request().policy,
              retrieval_method: method,
            },
          });
          const result = await repository.search(
            search(methodRequest, {
              query_embedding: [1, 0],
            }),
          );

          expect(result.candidates)
            .toHaveLength(1);
        }
      },
    );

    it(
      "marks a search partial when eligible index material is partial",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({ status: "partial" }),
          ]);

        const result = await repository.search(
          search(),
        );

        expect(result.index_status).toBe(
          "partial",
        );
      },
    );

    it(
      "inserts and resolves one exact entry",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository();
        const value = entry();

        await repository.insertEntry(
          TRANSACTION,
          value,
        );

        await expect(
          repository.findEntry({
            ...value,
            organization_id:
              ORGANIZATION_ID as never,
            approved_global_sources_permitted:
              false,
          }),
        ).resolves.toBe(value);
      },
    );

    it(
      "rejects duplicate index identities",
      async () => {
        const value = entry();
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            value,
          ]);

        await expect(
          repository.insertEntry(
            TRANSACTION,
            value,
          ),
        ).rejects.toBeInstanceOf(
          CapaKnowledgeRetrievalRepositoryError,
        );
      },
    );

    it(
      "replaces derived material only with the expected fingerprint",
      async () => {
        const original = entry();
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            original,
          ]);
        const replacement = entry({
          normalized_text: "replacement text",
          normalized_text_fingerprint: {
            algorithm: "sha256",
            value: "b".repeat(64) as never,
          },
        });

        await expect(
          repository.replaceDerivedEntry(
            TRANSACTION,
            {
              algorithm: "sha256",
              value: "f".repeat(64) as never,
            },
            replacement,
          ),
        ).resolves.toBe("conflict");
        await expect(
          repository.replaceDerivedEntry(
            TRANSACTION,
            FINGERPRINT,
            replacement,
          ),
        ).resolves.toBe("replaced");
        await expect(
          repository.findEntry({
            ...replacement,
            organization_id:
              ORGANIZATION_ID as never,
            approved_global_sources_permitted:
              false,
          }),
        ).resolves.toBe(replacement);
      },
    );

    it(
      "does not disclose whether a missing replacement target exists",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository();

        await expect(
          repository.replaceDerivedEntry(
            TRANSACTION,
            FINGERPRINT,
            entry(),
          ),
        ).resolves.toBe(
          "not_found_or_not_authorized",
        );
      },
    );


    it(
      "derives lexical terms when a precomputed document is absent",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({ lexical_document: undefined }),
          ]);

        const result = await repository.search(
          search(),
        );

        expect(result.candidates[0])
          .toMatchObject({ lexical_score: 1 });
      },
    );

    it.each([
      ["lexical", {}],
      ["structured", {}],
    ] as const)(
      "returns zero relevance for an empty %s query",
      async (method, extra) => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry(),
          ]);
        const controlledRequest = request({
          policy: {
            ...request().policy,
            retrieval_method: method,
          },
        });
        const result = await repository.search(
          search(controlledRequest, {
            query_terms: [],
            normalized_query: "",
            ...extra,
          }),
        );

        expect(result.candidates[0])
          .toMatchObject({ raw_rank: 1 });
      },
    );

    it.each([
      [undefined, [1, 0]],
      [[1, 0], undefined],
      [[1, 0], [1]],
      [[Number.NaN, 0], [1, 0]],
      [[1, 0], [Number.POSITIVE_INFINITY, 0]],
      [[0, 0], [1, 0]],
      [[1, 0], [0, 0]],
    ])(
      "omits vector candidates for incompatible vectors %# %#",
      async (stored, supplied) => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({
              semantic_embedding:
                stored as never,
            }),
          ]);
        const vectorRequest = request({
          policy: {
            ...request().policy,
            retrieval_method: "vector",
          },
        });
        const result = await repository.search(
          search(vectorRequest, {
            query_embedding: supplied,
          }),
        );

        expect(result.candidates).toEqual([]);
      },
    );

    it.each([
      "superseded",
      "archived",
    ] as const)(
      "permits explicitly authorized historical %s material",
      async (sourceStatus) => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({ source_status: sourceStatus }),
          ]);
        const historicalRequest = request({
          filters: {
            ...request().filters,
            historical_source_versions_permitted:
              true,
          },
        });

        const result = await repository.search(
          search(historicalRequest),
        );

        expect(result.candidates).toHaveLength(1);
      },
    );

    it.each([
      [
        "site",
        { permitted_site_ids: ["SITE-2"] },
      ],
      [
        "product",
        { permitted_product_ids: ["PRODUCT-2"] },
      ],
      [
        "source type",
        {},
        { source_types: ["SRC-02"] },
      ],
      [
        "jurisdiction",
        {},
        { jurisdictions: ["EU"] },
      ],
      [
        "applicability",
        {},
        { applicability_tags: ["other"] },
      ],
    ] as const)(
      "filters an unauthorized %s constraint",
      async (
        _label: string,
        entryOverride:
          Partial<CapaKnowledgeRetrievalIndexEntry>,
        filterOverride:
          Record<string, unknown> = {},
      ) => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry(entryOverride),
          ]);
        const filteredRequest = request({
          filters: {
            ...request().filters,
            ...filterOverride,
          },
        });

        const result = await repository.search(
          search(filteredRequest),
        );

        expect(result.candidates).toEqual([]);
      },
    );

    it(
      "handles exact lookup misses and denied scopes without disclosure",
      async () => {
        const value = entry();
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            value,
          ]);

        await expect(
          repository.findEntry({
            ...value,
            passage_id:
              "00000000-0000-4000-8000-000000000099" as never,
            organization_id:
              ORGANIZATION_ID as never,
            approved_global_sources_permitted:
              false,
          }),
        ).resolves.toBeNull();
        await expect(
          repository.findEntry({
            ...value,
            organization_id:
              OTHER_ORGANIZATION_ID as never,
            approved_global_sources_permitted:
              false,
          }),
        ).resolves.toBeNull();
      },
    );

    it(
      "rejects duplicate constructor identities",
      () => {
        const value = entry();

        expect(() =>
          new InMemoryCapaKnowledgeRetrievalRepository([
            value,
            value,
          ]),
        ).toThrow(
          CapaKnowledgeRetrievalRepositoryError,
        );
      },
    );


    it(
      "sorts multiple eligible entries deterministically",
      async () => {
        const secondPassage =
          "00000000-0000-4000-8000-000000000098" as never;
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({
              passage_id: secondPassage,
            }),
            entry(),
          ]);

        const result = await repository.search(search());

        expect(result.candidates).toHaveLength(2);
        expect(result.candidates.map((value) => value.raw_rank))
          .toEqual([1, 2]);
      },
    );

    it(
      "handles punctuation-only derived text and array metadata",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({
              normalized_text: "---",
              lexical_document: undefined,
              structured_metadata: {
                topics: ["seal", "validation"],
              },
            }),
          ]);
        const structuredRequest = request({
          policy: {
            ...request().policy,
            retrieval_method: "structured",
          },
        });

        const result = await repository.search(
          search(structuredRequest),
        );

        expect(result.candidates).toHaveLength(1);
      },
    );

    it(
      "scores a missing lexical term as unmatched",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry(),
          ]);
        const result = await repository.search(
          search(request(), {
            normalized_query: "seal absent",
            query_terms: ["seal", "absent"],
          }),
        );

        expect(result.candidates[0]?.lexical_score).toBe(0.5);
      },
    );

    it(
      "resolves an approved-global exact lookup when expressly permitted",
      async () => {
        const value = entry({
          organization_id: undefined,
          approved_global: true,
        });
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([value]);

        await expect(repository.findEntry({
          organization_id: ORGANIZATION_ID as never,
          approved_global_sources_permitted: true,
          passage_id: value.passage_id,
          source_version_id: value.source_version_id,
          index_version: value.index_version,
        })).resolves.toBe(value);
      },
    );


    it(
      "treats missing structured metadata as an empty document",
      async () => {
        const repository =
          new InMemoryCapaKnowledgeRetrievalRepository([
            entry({ structured_metadata: undefined }),
          ]);
        const structuredRequest = request({
          policy: {
            ...request().policy,
            retrieval_method: "structured",
            minimum_relevance_score: 0,
          },
        });

        const result = await repository.search(
          search(structuredRequest),
        );

        expect(result.candidates[0])
          .toMatchObject({
            metadata_score: 0,
            raw_rank: 1,
          });
      },
    );
  },
);
