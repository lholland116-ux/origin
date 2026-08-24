import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeRankedCandidateMaterial,
} from "../../lib/capa/knowledge/capa-knowledge-context-selection";

import {
  CapaKnowledgeRetrievalServiceError,
  createCapaKnowledgeRetrievalService,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-service";

const ORGANIZATION_ID =
  "9cf8ea71-39d6-43c6-b9df-7ae9ae32652a";
const RUN_ID =
  "55d23b7e-13e5-4a89-b25a-b7d8a977d48f";
const COLLECTION_ID =
  "7d974143-2bdc-4178-b529-9571a4f25a4a";
const COLLECTION_VERSION_ID =
  "62baea6e-f42c-424d-bdc8-01fce5921fb0";
const SOURCE_ID =
  "875e032a-cd84-4be7-a526-348467472e5c";
const SOURCE_VERSION_ID =
  "3435183d-12b1-4e43-8b68-a52f2c94f5cc";
const PASSAGE_ID =
  "50c475ad-b030-40fd-a1a2-b53402534213";
const NOW =
  new Date("2026-08-24T14:00:01.000Z");

function request(
  method: "lexical" | "vector" | "structured" | "hybrid" =
    "lexical",
) {
  return {
    retrieval_run_id: RUN_ID,
    query_id:
      "075863fe-938f-454e-b5a5-3e053e925075",
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
      collection_version_id:
        COLLECTION_VERSION_ID,
      approved_global_sources_permitted:
        false,
    },
    task_type: "CAPA_SUPPORT",
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
        "capa-knowledge-query-1.0.0",
      ranking_policy_version:
        "ranking-1.0.0",
      citation_policy_version:
        "citation-1.0.0",
      retrieval_method: method,
      maximum_candidates: 20,
      maximum_results: 8,
      maximum_total_characters: 20_000,
      minimum_relevance_score: 0.4,
    },
    requested_at:
      "2026-08-24T14:00:00.000Z",
  } as unknown as Omit<
    CapaKnowledgeRetrievalRequest,
    "query_text" |
    "query_fingerprint"
  >;
}

function query() {
  return {
    user_query:
      "effectiveness evidence",
    task_type: "CAPA_SUPPORT",
    workflow_state: "S10",
    authorized_context: [],
  } as never;
}

function candidate():
  CapaKnowledgeRetrievalCandidate {
  return {
    candidate_id:
      "ef213413-0557-4ecf-98a7-b37c64085645",
    source_id: SOURCE_ID,
    source_version_id:
      SOURCE_VERSION_ID,
    passage_id: PASSAGE_ID,
    source_type: "SRC-01",
    source_status:
      "current_effective",
    quality_status: "pass",
    raw_rank: 1,
    lexical_score: 0.9,
  } as unknown as
    CapaKnowledgeRetrievalCandidate;
}

function material(
  ranked:
    CapaKnowledgeRetrievalCandidate,
): CapaKnowledgeRankedCandidateMaterial {
  return {
    candidate: ranked,
    relationship: "supports",
    collection: {
      collection_id: COLLECTION_ID,
      collection_version_id:
        COLLECTION_VERSION_ID,
      organization_id:
        ORGANIZATION_ID,
      version_number: 1,
      purpose: "CAPA retrieval",
      audience: [],
      access_policy: {
        policy_version: "policy-1.0.0",
        permitted_role_ids: ["CAPA_OWNER"],
        permitted_site_ids: [],
        permitted_product_ids: [],
        sensitivity: "internal",
        export_permitted: false,
        excerpt_permitted: true,
        redistribution_permitted:
          false,
      },
      source_version_ids: [
        SOURCE_VERSION_ID,
      ],
      effective_at:
        "2026-08-01T00:00:00.000Z",
      approved_by: [{
        actor_type: "human",
        actor_id: "approver-1",
      }],
      created_at:
        "2026-08-01T00:00:00.000Z",
    },
    source: {
      source_id: SOURCE_ID,
      visibility: "organization",
      organization_id:
        ORGANIZATION_ID,
      owner: {
        actor_type: "human",
        actor_id: "owner-1",
      },
      created_at:
        "2026-08-01T00:00:00.000Z",
      created_by: {
        actor_type: "human",
        actor_id: "owner-1",
      },
    },
    source_version: {
      source_version_id:
        SOURCE_VERSION_ID,
      source_id: SOURCE_ID,
      organization_id:
        ORGANIZATION_ID,
      version_number: 1,
      source_type: "SRC-01",
      authority_class: "controlled",
      title:
        "Corrective Action Procedure",
      issuer: "Example Manufacturer",
      jurisdiction: "US",
      language: "en",
      translation_status: "original",
      status: "current_effective",
      applicability_tags: ["CAPA"],
      origin: "approved",
      canonical_locator:
        "document://procedure",
      content_fingerprint: {
        algorithm: "sha256",
        value: "a".repeat(64),
      },
      rights: {
        rights_classification: "owned",
        retention_policy: "controlled",
        legal_hold: false,
      },
      access_policy: {
        policy_version: "policy-1.0.0",
        permitted_role_ids: ["CAPA_OWNER"],
        permitted_site_ids: [],
        permitted_product_ids: [],
        sensitivity: "internal",
        export_permitted: false,
        excerpt_permitted: true,
        redistribution_permitted:
          false,
      },
      onboarding_stage: "active",
      processing_status: "pass",
      processing_version:
        "processing-1.0.0",
      quality_status: "pass",
      quality_notes: [],
      effective_at:
        "2026-08-01T00:00:00.000Z",
      approved_at:
        "2026-08-01T00:00:00.000Z",
      approved_by: {
        actor_type: "human",
        actor_id: "approver-1",
      },
      activated_at:
        "2026-08-01T00:00:00.000Z",
      created_at:
        "2026-08-01T00:00:00.000Z",
      created_by: {
        actor_type: "human",
        actor_id: "owner-1",
      },
    },
    primary_passage: {
      passage_id: PASSAGE_ID,
      source_version_id:
        SOURCE_VERSION_ID,
      derivative_id:
        "e50132e2-e28a-4b68-9fa9-a51bb178df95",
      organization_id:
        ORGANIZATION_ID,
      sequence_number: 1,
      segmentation_version:
        "segmenter-1.0.0",
      content:
        "Corrective actions shall be verified for effectiveness.",
      locators: [{
        kind: "section",
        label: "§ 7.4",
      }],
      overlap_passage_ids: [],
      fingerprint: {
        algorithm: "sha256",
        value: "b".repeat(64),
      },
      quality_status: "pass",
      machine_interpretable: true,
      created_at:
        "2026-08-01T00:00:00.000Z",
    },
    related_context: [],
  } as unknown as
    CapaKnowledgeRankedCandidateMaterial;
}

function harness(
  options: {
    readonly candidates?:
      readonly CapaKnowledgeRetrievalCandidate[];
    readonly partial?: boolean;
    readonly search_error?: boolean;
    readonly material_error?: boolean;
    readonly embedding?:
      readonly number[];
  } = {},
) {
  const search = vi.fn(async (
    input: {
      request:
        CapaKnowledgeRetrievalRequest;
    },
  ) => {
    if (options.search_error) {
      throw new Error("provider");
    }
    return {
      retrieval_run_id:
        input.request.retrieval_run_id,
      retrieval_method:
        input.request.policy.retrieval_method,
      index_version:
        "capa-knowledge-index-1.0.0" as never,
      index_status:
        options.partial
          ? "partial" as const
          : "ready" as const,
      candidates:
        options.candidates ?? [],
    };
  });
  const resolve = vi.fn(async (
    _request:
      CapaKnowledgeRetrievalRequest,
    ranking: {
      readonly ranked_candidates:
        readonly CapaKnowledgeRetrievalCandidate[];
    },
  ) => {
    if (options.material_error) {
      throw new Error("material");
    }
    return ranking.ranked_candidates.map(
      material,
    );
  });
  const embed = vi.fn(async () =>
    options.embedding ?? [1, 0],
  );
  const indexRepository = {
    findEntry: vi.fn(),
    search,
    insertEntry: vi.fn(),
    replaceDerivedEntry: vi.fn(),
  };
  const materialResolver = {
    resolveCandidateMaterials:
      resolve as never,
  };
  const service =
    createCapaKnowledgeRetrievalService({
      index_repository:
        indexRepository,
      material_resolver:
        materialResolver,
      query_embedding_provider: {
        embedQuery: embed,
      },
      now: () => NOW,
    });

  return {
    service,
    search,
    resolve,
    embed,
    indexRepository,
    materialResolver,
  };
}

describe(
  "governed CAPA knowledge retrieval service",
  () => {
    it(
      "orchestrates deterministic retrieval into bounded evidence",
      async () => {
        const test = harness({
          candidates: [candidate()],
        });

        const result = await test.service.retrieve({
          request: request(),
          query: query(),
        });

        expect(result).toMatchObject({
          evidence_package: {
            outcome: "complete",
            reason_code:
              "RETRIEVAL_COMPLETE",
            passages: [{
              passage_id: PASSAGE_ID,
              relevance_score: 0.9,
            }],
          },
        });
        expect(test.search).toHaveBeenCalledOnce();
        expect(test.resolve).toHaveBeenCalledOnce();
        expect(result).not.toHaveProperty(
          "model_response",
        );
        expect(result).not.toHaveProperty(
          "workflow_transition",
        );
      },
    );

    it(
      "returns an explicit no-result evidence package",
      async () => {
        const result = await harness()
          .service.retrieve({
            request: request(),
            query: query(),
          });

        expect(result.evidence_package)
          .toMatchObject({
            outcome: "no_result",
            reason_code:
              "NO_ELIGIBLE_RESULT",
            passages: [],
          });
      },
    );

    it(
      "preserves partial-index limitations",
      async () => {
        const result = await harness({
          candidates: [candidate()],
          partial: true,
        }).service.retrieve({
          request: request(),
          query: query(),
        });

        expect(result.evidence_package)
          .toMatchObject({
            outcome: "partial",
            reason_code: "PARTIAL_INDEX",
          });
        expect(
          result.evidence_package.warnings
            .join(" "),
        ).toContain("partial coverage");
      },
    );

    it(
      "constructs the governed query instead of trusting supplied query text",
      async () => {
        const test = harness();

        const result = await test.service.retrieve({
          request: request(),
          query: {
            ...query() as unknown as Record<string, unknown>,
            user_query:
              "  effectiveness\t evidence  ",
          } as never,
        });

        expect(result.request.query_text)
          .toBe("effectiveness evidence");
        expect(result.request.query_fingerprint.value)
          .toMatch(/^[0-9a-f]{64}$/);
      },
    );

    it(
      "requires an embedding for vector retrieval",
      async () => {
        const test = harness();
        const service =
          createCapaKnowledgeRetrievalService({
            index_repository:
              test.indexRepository,
            material_resolver:
              test.materialResolver,
            now: () => NOW,
          });

        await expect(
          service.retrieve({
            request: request("vector"),
            query: query(),
          }),
        ).rejects.toMatchObject({
          reason_code:
            "QUERY_EMBEDDING_REQUIRED",
        });
      },
    );

    it(
      "passes a controlled embedding for hybrid retrieval",
      async () => {
        const hybridCandidate = {
          ...candidate(),
          semantic_score: 0.9,
          metadata_score: 0.9,
        } as CapaKnowledgeRetrievalCandidate;
        const test = harness({
          candidates: [hybridCandidate],
        });

        await test.service.retrieve({
          request: request("hybrid"),
          query: query(),
        });

        expect(test.embed).toHaveBeenCalledOnce();
        expect(test.search.mock.calls[0]?.[0])
          .toMatchObject({
            query_embedding: [1, 0],
          });
      },
    );

    it.each([
      [
        "retrieval provider",
        { search_error: true },
        "RETRIEVAL_PROVIDER_FAILURE",
      ],
      [
        "material resolver",
        {
          candidates: [candidate()],
          material_error: true,
        },
        "MATERIAL_RESOLUTION_FAILURE",
      ],
    ] as const)(
      "fails closed for a %s failure",
      async (_label, options, reasonCode) => {
        await expect(
          harness(options).service.retrieve({
            request: request(),
            query: query(),
          }),
        ).rejects.toMatchObject({
          reason_code: reasonCode,
        });
      },
    );

    it(
      "provides a stable controlled service error",
      () => {
        const error =
          new CapaKnowledgeRetrievalServiceError(
            "RETRIEVAL_PROVIDER_FAILURE",
          );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeRetrievalServiceError",
        );
      },
    );


    it.each([
      { embedding: [] },
      { embedding: [Number.NaN] },
      {
        embedding:
          Array.from({ length: 16_385 }, () => 0),
      },
    ])(
      "rejects an uncontrolled query embedding %#",
      async ({ embedding }) => {
        await expect(
          harness({ embedding }).service.retrieve({
            request: request("vector"),
            query: query(),
          }),
        ).rejects.toMatchObject({
          reason_code:
            "QUERY_EMBEDDING_FAILURE",
        });
      },
    );

    it(
      "maps a query embedding provider failure safely",
      async () => {
        const test = harness();
        test.embed.mockRejectedValueOnce(
          new Error("provider"),
        );

        await expect(
          test.service.retrieve({
            request: request("vector"),
            query: query(),
          }),
        ).rejects.toMatchObject({
          reason_code:
            "QUERY_EMBEDDING_FAILURE",
        });
      },
    );

    it.each([
      {
        query: {
          ...query() as unknown as Record<string, unknown>,
          task_type: "CAPA_EFFECTIVENESS",
        } as never,
        request: request(),
      },
      {
        query: query(),
        request: {
          ...request(),
          policy: {
            ...request().policy,
            query_construction_version:
              "wrong-query-version",
          },
        } as never,
      },
    ])(
      "rejects a query-policy mismatch %#",
      async (input) => {
        await expect(
          harness().service.retrieve(input),
        ).rejects.toMatchObject({
          reason_code: "QUERY_POLICY_MISMATCH",
        });
      },
    );

    it.each([
      {
        retrieval_run_id:
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        retrieval_method: "structured",
      },
    ])(
      "rejects mismatched retrieval metadata %#",
      async (override) => {
        const test = harness();
        test.search.mockResolvedValueOnce({
          retrieval_run_id: RUN_ID,
          retrieval_method: "lexical",
          index_version:
            "capa-knowledge-index-1.0.0" as never,
          index_status: "ready",
          candidates: [],
          ...override,
        } as never);

        await expect(
          test.service.retrieve({
            request: request(),
            query: query(),
          }),
        ).rejects.toMatchObject({
          reason_code:
            "RETRIEVAL_RESULT_MISMATCH",
        });
      },
    );

    it(
      "rejects incomplete candidate material resolution",
      async () => {
        const test = harness({
          candidates: [candidate()],
        });
        test.resolve.mockResolvedValueOnce([]);

        await expect(
          test.service.retrieve({
            request: request(),
            query: query(),
          }),
        ).rejects.toMatchObject({
          reason_code:
            "MATERIAL_RESULT_MISMATCH",
        });
      },
    );

    it.each([
      new Date("invalid"),
      new Date("2026-08-24T13:59:59.000Z"),
    ])(
      "rejects invalid completion time %s",
      async (completion) => {
        const test = harness();
        const service =
          createCapaKnowledgeRetrievalService({
            index_repository:
              test.indexRepository,
            material_resolver:
              test.materialResolver,
            now: () => completion,
          });

        await expect(
          service.retrieve({
            request: request(),
            query: query(),
          }),
        ).rejects.toMatchObject({
          reason_code:
            "INVALID_COMPLETION_TIMESTAMP",
        });
      },
    );

    it(
      "exposes citation validation through the service boundary",
      () => {
        expect(() =>
          harness().service.validateCitation(
            {} as never,
          ),
        ).toThrow();
      },
    );
  },
);
