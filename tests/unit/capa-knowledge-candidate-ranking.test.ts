import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalMethod,
  CapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-contract";

import {
  CAPA_KNOWLEDGE_CANDIDATE_RANKING_REASON_CODES,
  CapaKnowledgeCandidateRankingError,
  rankCapaKnowledgeCandidates,
  retrieveAndRankCapaKnowledgeCandidates,
} from "../../lib/capa/knowledge/capa-knowledge-candidate-ranking";

const CANDIDATE_IDS = [
  "949f593c-8f11-4e37-8d9e-81482cb4338a",
  "d74f378f-5f58-487c-a3ba-ec91cdaf2ba5",
  "6ab3d914-e5a0-46f5-a3b0-1d551bb8c9e4",
] as const;

const SOURCE_IDS = [
  "f8f17b16-c11c-4388-9ddb-78f2449bd764",
  "796d39d1-761b-4231-956b-b88e516a088f",
  "092ee964-cdf8-44dd-808f-6c8cf30b6b12",
] as const;

const SOURCE_VERSION_IDS = [
  "72446663-b767-4ded-ab8e-bb3d8100fd88",
  "d3bd2187-250d-4ca2-913d-e6c5a0b9c800",
  "8b632002-c0f7-4604-b9d7-9b77036463d6",
] as const;

const PASSAGE_IDS = [
  "9efc65ea-3aab-489d-b834-d68c147a1301",
  "f9af0b5e-582a-4ff3-a9b4-77cf58fa0c26",
  "38246711-f2b1-4646-a16f-a46e32789923",
] as const;

function request(
  method:
    CapaKnowledgeRetrievalMethod =
      "hybrid",
): CapaKnowledgeRetrievalRequest {
  return {
    retrieval_run_id:
      "d875e0d0-bca9-42f6-b79b-103f09fb2ea6",
    query_id:
      "18553145-b6af-4b1e-b16f-c49b23f7122b",
    request_trace: {
      request_id: "request-001",
      correlation_id: "correlation-001",
    },
    scope: {
      organization_id:
        "6cd1b724-cdac-4ea8-886f-19c5e913b73b",
      actor: {
        actor_type: "human",
        actor_id: "user-001",
      },
      active_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: [],
      permitted_product_ids: [],
      collection_id:
        "ae07c56d-1dc3-4dcb-81d2-c81d338790f1",
      collection_version_id:
        "6fd1be8b-182b-4676-a96a-7f6a8a9bc04a",
      approved_global_sources_permitted:
        true,
    },
    task_type: "CAPA_INVESTIGATION_SUPPORT",
    query_text:
      "corrective action effectiveness",
    query_fingerprint: {
      algorithm: "sha256",
      value: "a".repeat(64),
    },
    filters: {
      effective_at:
        "2026-08-24T14:00:00.000Z",
      historical_source_versions_permitted:
        false,
    },
    policy: {
      retrieval_policy_version:
        "retrieval-policy-1.0.0",
      source_precedence_policy_version:
        "precedence-policy-1.0.0",
      query_construction_version:
        "query-policy-1.0.0",
      ranking_policy_version:
        "ranking-policy-1.0.0",
      citation_policy_version:
        "citation-policy-1.0.0",
      retrieval_method: method,
      maximum_candidates: 40,
      maximum_results: 8,
      maximum_total_characters: 24_000,
      minimum_relevance_score: 0.5,
    },
    requested_at:
      "2026-08-24T14:00:00.000Z",
  } as unknown as
    CapaKnowledgeRetrievalRequest;
}

function candidate(
  index: number,
  overrides:
    Partial<CapaKnowledgeRetrievalCandidate> = {},
): CapaKnowledgeRetrievalCandidate {
  return {
    candidate_id: CANDIDATE_IDS[index],
    source_id: SOURCE_IDS[index],
    source_version_id:
      SOURCE_VERSION_IDS[index],
    passage_id: PASSAGE_IDS[index],
    source_type: "SRC-01",
    source_status: "current_effective",
    quality_status: "pass",
    raw_rank: index + 1,
    lexical_score: 0.7 - index * 0.1,
    semantic_score: 0.7 - index * 0.1,
    metadata_score: 0.7 - index * 0.1,
    ...overrides,
  } as unknown as
    CapaKnowledgeRetrievalCandidate;
}

function expectReason(
  operation: () => unknown,
  reasonCode: string,
): void {
  expect(operation).toThrowError(
    expect.objectContaining({
      name:
        "CapaKnowledgeCandidateRankingError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "governed CAPA candidate retrieval and ranking",
  () => {
    it(
      "ranks candidates by deterministic hybrid relevance",
      () => {
        const result =
          rankCapaKnowledgeCandidates(
            [
              candidate(0, {
                lexical_score: 0.6,
                semantic_score: 0.6,
                metadata_score: 0.6,
              }),
              candidate(1, {
                lexical_score: 0.9,
                semantic_score: 0.9,
                metadata_score: 0.9,
              }),
              candidate(2, {
                lexical_score: 0.3,
                semantic_score: 0.3,
                metadata_score: 0.3,
              }),
            ],
            request(),
          );

        expect(
          result.ranked_candidates.map(
            (value) => value.candidate_id,
          ),
        ).toEqual([
          CANDIDATE_IDS[1],
          CANDIDATE_IDS[0],
        ]);
        expect(
          result.ranked_candidates.map(
            (value) => value.final_score,
          ),
        ).toEqual([0.9, 0.6]);
        expect(result.candidate_trace)
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                candidate:
                  expect.objectContaining({
                    candidate_id:
                      CANDIDATE_IDS[2],
                  }),
                disposition: {
                  disposition: "excluded",
                  reason_code:
                    "BELOW_MINIMUM_SCORE",
                },
              }),
            ]),
          );
      },
    );

    it.each([
      ["lexical", "lexical_score"],
      ["vector", "semantic_score"],
      ["structured", "metadata_score"],
    ] as const)(
      "uses only the required %s ranking signal",
      (method, signal) => {
        const value = candidate(0, {
          lexical_score: 0.1,
          semantic_score: 0.1,
          metadata_score: 0.1,
          [signal]: 0.8,
        });
        const result =
          rankCapaKnowledgeCandidates(
            [value],
            request(method),
          );

        expect(
          result.ranked_candidates[0]
            ?.final_score,
        ).toBe(0.8);
      },
    );

    it(
      "averages available hybrid signals without inventing a missing metadata score",
      () => {
        const result =
          rankCapaKnowledgeCandidates(
            [candidate(0, {
              lexical_score: 0.8,
              semantic_score: 0.6,
              metadata_score: undefined,
            })],
            request("hybrid"),
          );

        expect(
          result.ranked_candidates[0]
            ?.final_score,
        ).toBe(0.7);
      },
    );

    it(
      "uses raw rank as the first stable tie breaker",
      () => {
        const result =
          rankCapaKnowledgeCandidates(
            [
              candidate(0, {
                raw_rank: 2,
                lexical_score: 0.8,
                semantic_score: 0.8,
                metadata_score: 0.8,
              }),
              candidate(1, {
                raw_rank: 1,
                lexical_score: 0.8,
                semantic_score: 0.8,
                metadata_score: 0.8,
              }),
            ],
            request(),
          );

        expect(
          result.ranked_candidates.map(
            (value) => value.raw_rank,
          ),
        ).toEqual([1, 2]);
      },
    );

    it(
      "produces reproducible output for an exact retry",
      () => {
        const candidates = [
          candidate(0),
          candidate(1),
          candidate(2),
        ];

        expect(
          rankCapaKnowledgeCandidates(
            candidates,
            request(),
          ),
        ).toEqual(
          rankCapaKnowledgeCandidates(
            candidates,
            request(),
          ),
        );
      },
    );

    it.each([
      undefined,
      null,
      {},
      "candidates",
    ])(
      "rejects malformed candidate set %p",
      (value) => {
        expectReason(
          () =>
            rankCapaKnowledgeCandidates(
              value,
              request(),
            ),
          "INVALID_CANDIDATE_SET",
        );
      },
    );

    it(
      "rejects a provider result beyond the authorized candidate bound",
      () => {
        const original = request();
        const bounded = {
          ...original,
          policy: {
            ...original.policy,
            maximum_candidates: 1,
            maximum_results: 1,
          },
        } as unknown as
          CapaKnowledgeRetrievalRequest;

        expectReason(
          () =>
            rankCapaKnowledgeCandidates(
              [candidate(0), candidate(1)],
              bounded,
            ),
          "TOO_MANY_CANDIDATES",
        );
      },
    );

    it.each([
      { candidate_id: "invalid" },
      { source_id: "invalid" },
      { source_type: "SRC-99" },
      { source_status: "unknown" },
      { quality_status: "unknown" },
      { raw_rank: 0 },
      { lexical_score: Number.NaN },
      { semantic_score: 1.1 },
      { final_score: 0.8 },
    ])(
      "rejects malformed candidate %#",
      (override) => {
        expectReason(
          () =>
            rankCapaKnowledgeCandidates(
              [candidate(0, override as never)],
              request(),
            ),
          "INVALID_CANDIDATE",
        );
      },
    );

    it(
      "rejects duplicate candidate identities",
      () => {
        expectReason(
          () =>
            rankCapaKnowledgeCandidates(
              [
                candidate(0),
                candidate(1, {
                  candidate_id:
                    CANDIDATE_IDS[0] as never,
                }),
              ],
              request(),
            ),
          "DUPLICATE_CANDIDATE_ID",
        );
      },
    );

    it(
      "rejects duplicate raw ranks",
      () => {
        expectReason(
          () =>
            rankCapaKnowledgeCandidates(
              [
                candidate(0),
                candidate(1, {
                  raw_rank: 1,
                }),
              ],
              request(),
            ),
          "DUPLICATE_RAW_RANK",
        );
      },
    );

    it.each([
      ["lexical", {
        lexical_score: undefined,
      }],
      ["vector", {
        semantic_score: undefined,
      }],
      ["structured", {
        metadata_score: undefined,
      }],
      ["hybrid", {
        semantic_score: undefined,
      }],
    ] as const)(
      "requires the controlled %s score inputs",
      (method, override) => {
        expectReason(
          () =>
            rankCapaKnowledgeCandidates(
              [candidate(0, override)],
              request(method),
            ),
          "MISSING_REQUIRED_SCORE",
        );
      },
    );

    it(
      "executes the approved retriever with the validated request",
      async () => {
        const retrieveCandidates = vi.fn(
          async () => [candidate(0)],
        );
        const result =
          await retrieveAndRankCapaKnowledgeCandidates(
            { retrieveCandidates },
            request(),
          );

        expect(retrieveCandidates)
          .toHaveBeenCalledOnce();
        expect(retrieveCandidates)
          .toHaveBeenCalledWith(
            expect.objectContaining({
              query_text:
                "corrective action effectiveness",
            }),
          );
        expect(result.ranked_candidates)
          .toHaveLength(1);
      },
    );

    it(
      "maps retrieval-provider failure to a controlled error",
      async () => {
        const retrieveCandidates = vi.fn(
          async () => {
            throw new Error(
              "provider secret detail",
            );
          },
        );

        await expect(
          retrieveAndRankCapaKnowledgeCandidates(
            { retrieveCandidates },
            request(),
          ),
        ).rejects.toMatchObject({
          name:
            "CapaKnowledgeCandidateRankingError",
          reason_code:
            "RETRIEVAL_PROVIDER_FAILURE",
          message:
            "The governed CAPA knowledge candidates could not be ranked.",
        });
      },
    );

    it(
      "freezes ranking results and trace",
      () => {
        const result =
          rankCapaKnowledgeCandidates(
            [candidate(0)],
            request(),
          );

        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(
          result.ranked_candidates,
        )).toBe(true);
        expect(Object.isFrozen(
          result.ranked_candidates[0],
        )).toBe(true);
        expect(Object.isFrozen(
          result.candidate_trace,
        )).toBe(true);
      },
    );

    it(
      "provides stable ranking reason codes and error identity",
      () => {
        expect(
          CAPA_KNOWLEDGE_CANDIDATE_RANKING_REASON_CODES,
        ).toContain(
          "RETRIEVAL_PROVIDER_FAILURE",
        );

        const error =
          new CapaKnowledgeCandidateRankingError(
            "INVALID_CANDIDATE",
          );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeCandidateRankingError",
        );
        expect(error.reason_code).toBe(
          "INVALID_CANDIDATE",
        );
      },
    );


    it.each([
      null,
      [],
      "candidate",
    ])(
      "rejects non-record candidate %p",
      (value) => {
        expectReason(
          () =>
            rankCapaKnowledgeCandidates(
              [value],
              request(),
            ),
          "INVALID_CANDIDATE",
        );
      },
    );
  },
);
