import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaKnowledgeCollectionVersion,
  CapaKnowledgePassage,
  CapaKnowledgeSource,
  CapaKnowledgeSourceVersion,
} from "../../lib/capa/knowledge/capa-knowledge-contract";

import type {
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-contract";

import {
  rankCapaKnowledgeCandidates,
} from "../../lib/capa/knowledge/capa-knowledge-candidate-ranking";

import {
  CAPA_KNOWLEDGE_CONTEXT_ROLES,
  CAPA_KNOWLEDGE_CONTEXT_SELECTION_REASON_CODES,
  CapaKnowledgeContextSelectionError,
  selectCapaKnowledgeCandidateContext,
  type CapaKnowledgeRankedCandidateMaterial,
} from "../../lib/capa/knowledge/capa-knowledge-context-selection";

const ORG =
  "d8d5bfe4-09e8-40a8-a9d9-8ce93786d6b6";
const COLLECTION =
  "3d65f099-101a-4d26-a734-02d128cb59e4";
const COLLECTION_VERSION =
  "35245746-8e35-416c-b498-b76c625487fd";

const IDS = [
  {
    candidate:
      "ae4b964c-c263-48a2-adf3-dfc390374dc1",
    source:
      "e2698acd-c690-49c0-ae9b-0fa7a6ae5de2",
    version:
      "1a3f3877-8148-4ebc-9e15-70cf07543c66",
    passage:
      "fa2ea820-62df-45c7-a361-d5779f8ca7ac",
  },
  {
    candidate:
      "999ae0b0-c656-4c73-88a9-14e1de52a490",
    source:
      "ed662d13-b0c2-403b-a08f-d7c76c0dadb2",
    version:
      "6c24b454-fe61-46a9-95bf-643ff8d5a090",
    passage:
      "03309466-a917-4977-8114-76127572d384",
  },
  {
    candidate:
      "b262a5b8-edb3-4ed2-bf4d-b3ded8c27fe1",
    source:
      "cf97982d-731a-4422-a51d-86f28baa3b72",
    version:
      "9b6eaa51-ea6f-4179-b2ef-2a186cb7ee5e",
    passage:
      "cc6c4d1a-276a-4895-8ba2-de0a79df8170",
  },
] as const;

function request():
  CapaKnowledgeRetrievalRequest {
  return {
    retrieval_run_id:
      "f694871d-2b7b-40c1-bff1-838b86612ff8",
    query_id:
      "6dd7c72a-a898-4571-81ac-b0b0c5c19e54",
    request_trace: {
      request_id: "request-1",
      correlation_id: "correlation-1",
    },
    scope: {
      organization_id: ORG,
      actor: {
        actor_type: "human",
        actor_id: "user-1",
      },
      active_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: [],
      permitted_product_ids: [],
      collection_id: COLLECTION,
      collection_version_id:
        COLLECTION_VERSION,
      approved_global_sources_permitted:
        false,
    },
    task_type: "CAPA_SUPPORT",
    query_text: "effectiveness",
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
      retrieval_policy_version: "retrieval-1.0.0",
      source_precedence_policy_version:
        "precedence-1.0.0",
      query_construction_version: "query-1.0.0",
      ranking_policy_version: "ranking-1.0.0",
      citation_policy_version: "citation-1.0.0",
      retrieval_method: "hybrid",
      maximum_candidates: 20,
      maximum_results: 8,
      maximum_total_characters: 20_000,
      minimum_relevance_score: 0.4,
    },
    requested_at:
      "2026-08-24T14:00:00.000Z",
  } as unknown as
    CapaKnowledgeRetrievalRequest;
}

function candidate(
  index: number,
  score = 0.9 - index * 0.1,
): CapaKnowledgeRetrievalCandidate {
  return {
    candidate_id: IDS[index].candidate,
    source_id: IDS[index].source,
    source_version_id: IDS[index].version,
    passage_id: IDS[index].passage,
    source_type: "SRC-01",
    source_status: "current_effective",
    quality_status: "pass",
    raw_rank: index + 1,
    lexical_score: score,
    semantic_score: score,
    metadata_score: score,
  } as unknown as
    CapaKnowledgeRetrievalCandidate;
}

function passage(
  index: number,
  overrides: Partial<CapaKnowledgePassage> = {},
): CapaKnowledgePassage {
  return {
    passage_id: IDS[index].passage,
    source_version_id: IDS[index].version,
    derivative_id:
      "eb9acc51-07ec-4a8e-a3af-7764741f5e48",
    organization_id: ORG,
    sequence_number: index + 1,
    segmentation_version: "segmenter-1.0.0",
    content: `Passage ${index + 1} content`,
    locators: [{
      kind: "section",
      label: `§ ${index + 1}`,
    }],
    overlap_passage_ids: [],
    fingerprint: {
      algorithm: "sha256",
      value: String(index + 1).repeat(64),
    },
    quality_status: "pass",
    machine_interpretable: true,
    created_at:
      "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as unknown as CapaKnowledgePassage;
}

function material(
  index: number,
  relationship:
    "supports" | "contradicts" | "alternative" =
      "supports",
  passageOverrides:
    Partial<CapaKnowledgePassage> = {},
): CapaKnowledgeRankedCandidateMaterial {
  const rankedCandidate = {
    ...candidate(index),
    final_score: 0.9 - index * 0.1,
  } as unknown as
    CapaKnowledgeRetrievalCandidate;
  const source = {
    source_id: IDS[index].source,
    visibility: "organization",
    organization_id: ORG,
  } as unknown as CapaKnowledgeSource;
  const version = {
    source_version_id: IDS[index].version,
    source_id: IDS[index].source,
    organization_id: ORG,
    source_type: "SRC-01",
    status: "current_effective",
    effective_at:
      "2026-08-01T00:00:00.000Z",
    jurisdiction: "US",
    applicability_tags: ["CAPA"],
    onboarding_stage: "active",
    processing_status: "pass",
    quality_status: "pass",
    access_policy: {
      permitted_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: [],
      permitted_product_ids: [],
      excerpt_permitted: true,
    },
  } as unknown as CapaKnowledgeSourceVersion;
  const collection = {
    collection_id: COLLECTION,
    collection_version_id: COLLECTION_VERSION,
    organization_id: ORG,
    source_version_ids:
      IDS.map((value) => value.version),
    effective_at:
      "2026-08-01T00:00:00.000Z",
  } as unknown as
    CapaKnowledgeCollectionVersion;

  return {
    candidate: rankedCandidate,
    relationship,
    collection,
    source,
    source_version: version,
    primary_passage:
      passage(index, passageOverrides),
    related_context: [],
  };
}

function ranking() {
  return rankCapaKnowledgeCandidates(
    [candidate(0), candidate(1), candidate(2)],
    request(),
  );
}

function expectReason(
  operation: () => unknown,
  reasonCode: string,
): void {
  expect(operation).toThrowError(
    expect.objectContaining({
      name:
        "CapaKnowledgeContextSelectionError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "governed CAPA context selection",
  () => {
    it(
      "selects distinct ranked passages in order",
      () => {
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            ranking(),
            [material(0), material(1), material(2)],
          );

        expect(result.selected.map(
          (value) =>
            value.candidate.candidate_id,
        )).toEqual(
          IDS.map((value) => value.candidate),
        );
      },
    );

    it(
      "removes an exact mirrored fingerprint from independent corroboration",
      () => {
        const duplicateFingerprint =
          passage(0).fingerprint;
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            ranking(),
            [
              material(0),
              material(1, "supports", {
                fingerprint:
                  duplicateFingerprint,
              }),
              material(2),
            ],
          );

        expect(result.selected).toHaveLength(2);
        expect(result.candidate_trace)
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                candidate:
                  expect.objectContaining({
                    candidate_id:
                      IDS[1].candidate,
                  }),
                disposition: {
                  disposition: "excluded",
                  reason_code:
                    "DUPLICATE_SOURCE_PASSAGE",
                },
              }),
            ]),
          );
      },
    );

    it(
      "removes overlapping chunks from independent corroboration",
      () => {
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            ranking(),
            [
              material(0, "supports", {
                overlap_passage_ids: [
                  IDS[1].passage as never,
                ],
              }),
              material(1),
              material(2),
            ],
          );

        expect(result.selected.map(
          (value) =>
            value.primary_passage.passage_id,
        )).not.toContain(IDS[1].passage);
      },
    );

    it(
      "preserves distinct contradictory and alternative evidence",
      () => {
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            ranking(),
            [
              material(0, "supports"),
              material(1, "contradicts"),
              material(2, "alternative"),
            ],
          );

        expect(result.selected.map(
          (value) => value.relationship,
        )).toEqual([
          "supports",
          "contradicts",
          "alternative",
        ]);
      },
    );

    it(
      "attaches bounded definitions exceptions footnotes and table headers",
      () => {
        const primary = material(0);
        const related = [
          ["definition", 1],
          ["exception", 2],
          ["footnote", 3],
          ["table_header", 4],
        ].map(([role, sequence]) => ({
          role,
          required: true,
          passage: passage(0, {
            passage_id:
              `00000000-0000-4000-8000-${String(
                sequence,
              ).padStart(12, "0")}` as never,
            sequence_number:
              sequence as number,
            content: `${role} context`,
            fingerprint: {
              algorithm: "sha256",
              value: String(sequence)
                .repeat(64) as never,
            },
          }),
        }));
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            rankCapaKnowledgeCandidates(
              [candidate(0)],
              request(),
            ),
            [{
              ...primary,
              related_context:
                related as never,
            }],
          );

        expect(result.selected[0]
          ?.related_context.map(
            (value) => value.role,
          )).toEqual([
            "definition",
            "exception",
            "footnote",
            "table_header",
          ]);
      },
    );

    it(
      "drops optional ineligible context but fails for required context",
      () => {
        const primary = material(0);
        const ineligible = passage(0, {
          passage_id:
            "00000000-0000-4000-8000-000000000099" as never,
          quality_status: "manual_review",
        });
        const singleRanking =
          rankCapaKnowledgeCandidates(
            [candidate(0)],
            request(),
          );

        const optionalResult =
          selectCapaKnowledgeCandidateContext(
            request(),
            singleRanking,
            [{
              ...primary,
              related_context: [{
                role: "footnote",
                required: false,
                passage: ineligible,
              }],
            }],
          );

        expect(optionalResult.selected[0]
          ?.related_context).toEqual([]);

        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              singleRanking,
              [{
                ...primary,
                related_context: [{
                  role: "exception",
                  required: true,
                  passage: ineligible,
                }],
              }],
            ),
          "REQUIRED_CONTEXT_INELIGIBLE",
        );
      },
    );

    it(
      "rejects mismatched ranking run and policy versions",
      () => {
        const ranked = ranking();

        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              {
                ...ranked,
                ranking_policy_version:
                  "ranking-2.0.0",
              },
              [material(0), material(1), material(2)],
            ),
          "RANKING_RESULT_MISMATCH",
        );
      },
    );

    it.each([
      undefined,
      null,
      {},
      "materials",
    ])(
      "rejects malformed material set %p",
      (value) => {
        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              ranking(),
              value,
            ),
          "INVALID_CONTEXT_INPUT",
        );
      },
    );

    it(
      "rejects missing or mismatched candidate material",
      () => {
        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              ranking(),
              [material(0), material(1)],
            ),
          "CANDIDATE_MATERIAL_MISSING",
        );

        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              ranking(),
              [
                {
                  ...material(0),
                  primary_passage:
                    passage(1),
                },
                material(1),
                material(2),
              ],
            ),
          "CANDIDATE_MATERIAL_MISMATCH",
        );
      },
    );

    it(
      "rejects cross-version related context",
      () => {
        const primary = material(0);

        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              rankCapaKnowledgeCandidates(
                [candidate(0)],
                request(),
              ),
              [{
                ...primary,
                related_context: [{
                  role: "adjacent",
                  required: false,
                  passage: passage(1),
                }],
              }],
            ),
          "CONTEXT_PASSAGE_MISMATCH",
        );
      },
    );

    it(
      "enforces passage-count and total-character bounds",
      () => {
        const primary = material(0);
        const related = [1, 2].map(
          (sequence) => ({
            role: "adjacent" as const,
            required: false,
            passage: passage(0, {
              passage_id:
                `00000000-0000-4000-8000-${String(
                  sequence,
                ).padStart(12, "0")}` as never,
            }),
          }),
        );

        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              rankCapaKnowledgeCandidates(
                [candidate(0)],
                request(),
              ),
              [{
                ...primary,
                related_context: related,
              }],
              {
                maximum_context_passages_per_candidate:
                  1,
              },
            ),
          "CONTEXT_LIMIT_EXCEEDED",
        );

        const original = request();
        const tiny = {
          ...original,
          policy: {
            ...original.policy,
            maximum_total_characters: 1,
          },
        } as unknown as
          CapaKnowledgeRetrievalRequest;

        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              tiny,
              rankCapaKnowledgeCandidates(
                [candidate(0)],
                tiny,
              ),
              [material(0)],
            ),
          "CONTEXT_LIMIT_EXCEEDED",
        );
      },
    );

    it(
      "freezes the selection and context arrays",
      () => {
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            ranking(),
            [material(0), material(1), material(2)],
          );

        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.selected))
          .toBe(true);
        expect(Object.isFrozen(
          result.candidate_trace,
        )).toBe(true);
      },
    );

    it(
      "defines approved context roles and stable error identity",
      () => {
        expect(CAPA_KNOWLEDGE_CONTEXT_ROLES)
          .toEqual([
            "definition",
            "scope",
            "exception",
            "warning",
            "footnote",
            "table_header",
            "adjacent",
          ]);
        expect(
          CAPA_KNOWLEDGE_CONTEXT_SELECTION_REASON_CODES,
        ).toContain(
          "REQUIRED_CONTEXT_INELIGIBLE",
        );

        const error =
          new CapaKnowledgeContextSelectionError(
            "INVALID_CONTEXT_INPUT",
          );
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeContextSelectionError",
        );
      },
    );


    it.each([
      0,
      101,
      1.5,
    ])(
      "rejects invalid context passage limit %p",
      (limit) => {
        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              ranking(),
              [material(0), material(1), material(2)],
              {
                maximum_context_passages_per_candidate:
                  limit,
              },
            ),
          "INVALID_CONTEXT_INPUT",
        );
      },
    );

    it.each([
      { role: "invalid", required: false },
      { role: "adjacent", required: "no" },
    ])(
      "rejects malformed related context %#",
      (relatedOverride) => {
        const primary = material(0);
        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              rankCapaKnowledgeCandidates(
                [candidate(0)],
                request(),
              ),
              [{
                ...primary,
                related_context: [{
                  ...relatedOverride,
                  passage: passage(0, {
                    passage_id:
                      "00000000-0000-4000-8000-000000000099" as never,
                  }),
                }],
              }] as never,
            ),
          "INVALID_CONTEXT_INPUT",
        );
      },
    );

    it(
      "rejects primary passage reused as related context",
      () => {
        const primary = material(0);
        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              rankCapaKnowledgeCandidates(
                [candidate(0)],
                request(),
              ),
              [{
                ...primary,
                related_context: [{
                  role: "adjacent",
                  required: false,
                  passage:
                    primary.primary_passage,
                }],
              }],
            ),
          "CONTEXT_PASSAGE_MISMATCH",
        );
      },
    );

    it(
      "deduplicates repeated related passage identity",
      () => {
        const primary = material(0);
        const related = {
          role: "adjacent" as const,
          required: false,
          passage: passage(0, {
            passage_id:
              "00000000-0000-4000-8000-000000000099" as never,
          }),
        };
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            rankCapaKnowledgeCandidates(
              [candidate(0)],
              request(),
            ),
            [{
              ...primary,
              related_context: [related, related],
            }],
          );

        expect(result.selected[0]
          ?.related_context).toHaveLength(1);
      },
    );

    it(
      "rejects duplicate material candidate identities",
      () => {
        expectReason(
          () =>
            selectCapaKnowledgeCandidateContext(
              request(),
              ranking(),
              [material(0), material(0), material(2)],
            ),
          "INVALID_CONTEXT_INPUT",
        );
      },
    );

    it(
      "records primary passage eligibility exclusion",
      () => {
        const primary = material(0);
        const result =
          selectCapaKnowledgeCandidateContext(
            request(),
            rankCapaKnowledgeCandidates(
              [candidate(0)],
              request(),
            ),
            [{
              ...primary,
              primary_passage: {
                ...primary.primary_passage,
                quality_status:
                  "manual_review",
              },
            }] as never,
          );

        expect(result.selected).toEqual([]);
        expect(result.candidate_trace[0]
          ?.disposition.disposition)
          .toBe("excluded");
      },
    );
  },
);
