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
  CapaKnowledgeCandidateRankingResult,
} from "../../lib/capa/knowledge/capa-knowledge-candidate-ranking";

import {
  CapaKnowledgeMaterialResolutionError,
  createRepositoryBackedCapaKnowledgeCandidateMaterialResolver,
} from "../../lib/capa/knowledge/capa-knowledge-candidate-material-resolver";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";
const COLLECTION_ID =
  "20000000-0000-4000-8000-000000000002";
const COLLECTION_VERSION_ID =
  "30000000-0000-4000-8000-000000000003";
const SOURCE_ID =
  "40000000-0000-4000-8000-000000000004";
const VERSION_ID =
  "50000000-0000-4000-8000-000000000005";
const PASSAGE_ID =
  "60000000-0000-4000-8000-000000000006";
const ADJACENT_ID =
  "70000000-0000-4000-8000-000000000007";
const RUN_ID =
  "80000000-0000-4000-8000-000000000008";

function request(
  globalPermitted = false,
): CapaKnowledgeRetrievalRequest {
  return {
    retrieval_run_id: RUN_ID,
    scope: {
      organization_id: ORGANIZATION_ID,
      collection_id: COLLECTION_ID,
      collection_version_id:
        COLLECTION_VERSION_ID,
      approved_global_sources_permitted:
        globalPermitted,
    },
  } as unknown as
    CapaKnowledgeRetrievalRequest;
}

function candidate():
  CapaKnowledgeRetrievalCandidate {
  return {
    candidate_id:
      "90000000-0000-4000-8000-000000000009",
    source_id: SOURCE_ID,
    source_version_id: VERSION_ID,
    passage_id: PASSAGE_ID,
    final_score: 0.9,
  } as unknown as
    CapaKnowledgeRetrievalCandidate;
}

function ranking(
  value = candidate(),
): CapaKnowledgeCandidateRankingResult {
  return {
    retrieval_run_id: RUN_ID,
    ranked_candidates: [value],
  } as unknown as
    CapaKnowledgeCandidateRankingResult;
}

function source(
  organization: string | null =
    ORGANIZATION_ID,
) {
  return {
    source_id: SOURCE_ID,
    ...(organization === null
      ? {}
      : { organization_id: organization }),
  } as never;
}

function version(
  organization: string | null =
    ORGANIZATION_ID,
) {
  return {
    source_id: SOURCE_ID,
    source_version_id: VERSION_ID,
    ...(organization === null
      ? {}
      : { organization_id: organization }),
  } as never;
}

function passage(
  id = PASSAGE_ID,
  organization: string | null =
    ORGANIZATION_ID,
) {
  return {
    passage_id: id,
    source_version_id: VERSION_ID,
    ...(organization === null
      ? {}
      : { organization_id: organization }),
    overlap_passage_ids:
      id === PASSAGE_ID
        ? [ADJACENT_ID]
        : [],
  } as never;
}

function collection(
  organization: string | null =
    ORGANIZATION_ID,
) {
  return {
    collection_id: COLLECTION_ID,
    collection_version_id:
      COLLECTION_VERSION_ID,
    ...(organization === null
      ? {}
      : { organization_id: organization }),
    source_version_ids: [VERSION_ID],
  } as never;
}

function harness(
  options: {
    readonly source_value?: unknown;
    readonly global_source?: unknown;
    readonly version_value?: unknown;
    readonly passage_value?: unknown;
    readonly adjacent_value?: unknown;
    readonly collection_value?: unknown;
  } = {},
) {
  const findSourceById = vi.fn(async (
    scope: { readonly visibility: string },
  ) => scope.visibility === "organization"
    ? options.source_value === undefined
      ? source()
      : options.source_value
    : options.global_source ?? null,
  );
  const findPassageById = vi.fn(async (
    _scope: unknown,
    passageId: string,
  ) => passageId === PASSAGE_ID
    ? options.passage_value === undefined
      ? passage()
      : options.passage_value
    : options.adjacent_value === undefined
      ? passage(ADJACENT_ID)
      : options.adjacent_value,
  );
  const repository = {
    findSourceById,
    findSourceVersionById: vi.fn(async () =>
      options.version_value === undefined
        ? version()
        : options.version_value,
    ),
    findPassageById,
    findCollectionVersionById:
      vi.fn(async () =>
        options.collection_value === undefined
          ? collection()
          : options.collection_value,
      ),
  } as never;

  return {
    resolver:
      createRepositoryBackedCapaKnowledgeCandidateMaterialResolver(
        repository,
      ),
    findSourceById,
    findPassageById,
  };
}

describe(
  "repository-backed CAPA knowledge candidate material resolution",
  () => {
    it(
      "resolves exact organization material and adjacent context",
      async () => {
        const test = harness();

        const result =
          await test.resolver
            .resolveCandidateMaterials(
              request(),
              ranking(),
            );

        expect(result).toMatchObject([{
          relationship: "contextualizes",
          primary_passage: {
            passage_id: PASSAGE_ID,
          },
          related_context: [{
            role: "adjacent",
            required: false,
            passage: {
              passage_id: ADJACENT_ID,
            },
          }],
        }]);
        expect(test.findSourceById)
          .toHaveBeenCalledTimes(1);
      },
    );

    it(
      "never falls through to global scope without authorization",
      async () => {
        const test = harness({
          source_value: null,
          global_source: source(null),
        });

        await expect(
          test.resolver
            .resolveCandidateMaterials(
              request(false),
              ranking(),
            ),
        ).rejects.toMatchObject({
          reason_code:
            "CANDIDATE_NOT_FOUND_OR_NOT_AUTHORIZED",
        });
        expect(test.findSourceById)
          .toHaveBeenCalledTimes(1);
      },
    );

    it(
      "permits explicitly authorized approved-global fallback",
      async () => {
        const test = harness({
          source_value: null,
          global_source: source(null),
          version_value: version(null),
          passage_value: passage(
            PASSAGE_ID,
            null,
          ),
          collection_value:
            collection(null),
        });

        const result =
          await test.resolver
            .resolveCandidateMaterials(
              request(true),
              ranking(),
            );

        expect(result).toHaveLength(1);
        expect(test.findSourceById)
          .toHaveBeenCalledTimes(2);
      },
    );

    it.each([
      [
        "missing version",
        { version_value: null },
        "CANDIDATE_NOT_FOUND_OR_NOT_AUTHORIZED",
      ],
      [
        "missing passage",
        { passage_value: null },
        "CANDIDATE_NOT_FOUND_OR_NOT_AUTHORIZED",
      ],
      [
        "missing collection",
        { collection_value: null },
        "COLLECTION_NOT_FOUND_OR_NOT_AUTHORIZED",
      ],
    ] as const)(
      "fails closed for %s",
      async (_label, options, reasonCode) => {
        await expect(
          harness(options).resolver
            .resolveCandidateMaterials(
              request(),
              ranking(),
            ),
        ).rejects.toMatchObject({
          reason_code: reasonCode,
        });
      },
    );

    it(
      "rejects a mismatched retrieval run",
      async () => {
        await expect(
          harness().resolver
            .resolveCandidateMaterials(
              request(),
              {
                ...ranking(),
                retrieval_run_id:
                  "a0000000-0000-4000-8000-00000000000a" as never,
              },
            ),
        ).rejects.toBeInstanceOf(
          CapaKnowledgeMaterialResolutionError,
        );
      },
    );


    it.each([
      {
        version_value: {
          ...version() as unknown as Record<string, unknown>,
          source_id:
            "a0000000-0000-4000-8000-000000000001",
        },
      },
      {
        version_value: {
          ...version() as unknown as Record<string, unknown>,
          source_version_id:
            "a0000000-0000-4000-8000-000000000002",
        },
      },
      {
        passage_value: {
          ...passage() as unknown as Record<string, unknown>,
          source_version_id:
            "a0000000-0000-4000-8000-000000000003",
        },
      },
      {
        passage_value: {
          ...passage() as unknown as Record<string, unknown>,
          passage_id:
            "a0000000-0000-4000-8000-000000000004",
        },
      },
      {
        collection_value: {
          ...collection() as unknown as Record<string, unknown>,
          source_version_ids: [],
        },
      },
    ])(
      "rejects internally mismatched candidate material %#",
      async (options) => {
        await expect(
          harness(options).resolver
            .resolveCandidateMaterials(
              request(),
              ranking(),
            ),
        ).rejects.toMatchObject({
          reason_code:
            "CANDIDATE_MATERIAL_MISMATCH",
        });
      },
    );


    it.each([
      null,
      {
        ...passage(ADJACENT_ID) as unknown as Record<string, unknown>,
        source_version_id:
          "a0000000-0000-4000-8000-000000000099",
      },
    ])(
      "omits unavailable or cross-version adjacent material %#",
      async (adjacentValue) => {
        const result = await harness({
          adjacent_value: adjacentValue,
        }).resolver.resolveCandidateMaterials(
          request(),
          ranking(),
        );

        expect(result[0]?.related_context).toEqual([]);
      },
    );
  },
);
