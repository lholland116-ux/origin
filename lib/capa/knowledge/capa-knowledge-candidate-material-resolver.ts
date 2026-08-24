import type {
  CapaKnowledgePassage,
} from "./capa-knowledge-contract";

import type {
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeCandidateRankingResult,
} from "./capa-knowledge-candidate-ranking";

import type {
  CapaKnowledgeRankedCandidateMaterial,
} from "./capa-knowledge-context-selection";

import type {
  CapaKnowledgeCandidateMaterialResolver,
} from "./capa-knowledge-retrieval-service";

import type {
  CapaKnowledgeRepository,
  CapaKnowledgeScope,
} from "../../database/repositories/capa-knowledge-repository";

/**
 * Resolves metadata-only retrieval candidates into exact governed material.
 * Organization scope is attempted first. Approved-global scope is considered
 * only when the already-authorized request explicitly permits it.
 */

export const CAPA_KNOWLEDGE_MATERIAL_RESOLUTION_REASON_CODES = [
  "CANDIDATE_NOT_FOUND_OR_NOT_AUTHORIZED",
  "CANDIDATE_MATERIAL_MISMATCH",
  "COLLECTION_NOT_FOUND_OR_NOT_AUTHORIZED",
] as const;

export type CapaKnowledgeMaterialResolutionReasonCode =
  (typeof CAPA_KNOWLEDGE_MATERIAL_RESOLUTION_REASON_CODES)[number];

export class CapaKnowledgeMaterialResolutionError
  extends Error {
  readonly reason_code:
    CapaKnowledgeMaterialResolutionReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeMaterialResolutionReasonCode,
  ) {
    super(
      "The governed CAPA knowledge candidate material could not be resolved.",
    );
    this.name =
      "CapaKnowledgeMaterialResolutionError";
    this.reason_code = reasonCode;
  }
}

function fail(
  reasonCode:
    CapaKnowledgeMaterialResolutionReasonCode,
): never {
  throw new CapaKnowledgeMaterialResolutionError(
    reasonCode,
  );
}

function scopes(
  request:
    CapaKnowledgeRetrievalRequest,
): readonly CapaKnowledgeScope[] {
  return Object.freeze([
    Object.freeze({
      visibility: "organization" as const,
      organization_id:
        request.scope.organization_id,
    }),
    ...(request.scope
      .approved_global_sources_permitted
      ? [
          Object.freeze({
            visibility:
              "approved_global" as const,
          }),
        ]
      : []),
  ]);
}

async function findInAuthorizedScopes<Value>(
  authorizedScopes:
    readonly CapaKnowledgeScope[],
  finder: (
    scope: CapaKnowledgeScope,
  ) => Promise<Value | null>,
): Promise<{
  readonly scope: CapaKnowledgeScope;
  readonly value: Value;
} | null> {
  for (const scope of authorizedScopes) {
    const value = await finder(scope);

    if (value !== null) {
      return { scope, value };
    }
  }

  return null;
}

async function adjacentContext(
  repository: CapaKnowledgeRepository,
  scope: CapaKnowledgeScope,
  passage: CapaKnowledgePassage,
): Promise<CapaKnowledgeRankedCandidateMaterial["related_context"]> {
  const related: Array<{
    readonly role: "adjacent";
    readonly required: false;
    readonly passage: CapaKnowledgePassage;
  }> = [];

  for (
    const passageId
    of passage.overlap_passage_ids
  ) {
    const resolved =
      await repository.findPassageById(
        scope,
        passageId,
      );

    if (
      resolved !== null &&
      resolved.source_version_id ===
        passage.source_version_id
    ) {
      related.push(Object.freeze({
        role: "adjacent" as const,
        required: false as const,
        passage: resolved,
      }));
    }
  }

  return Object.freeze(related);
}

export class RepositoryBackedCapaKnowledgeCandidateMaterialResolver
implements CapaKnowledgeCandidateMaterialResolver {
  constructor(
    private readonly repository:
      CapaKnowledgeRepository,
  ) {}

  async resolveCandidateMaterials(
    request:
      CapaKnowledgeRetrievalRequest,
    ranking:
      CapaKnowledgeCandidateRankingResult,
  ): Promise<readonly CapaKnowledgeRankedCandidateMaterial[]> {
    if (
      ranking.retrieval_run_id !==
        request.retrieval_run_id
    ) {
      fail("CANDIDATE_MATERIAL_MISMATCH");
    }

    const authorizedScopes = scopes(request);
    const materials:
      CapaKnowledgeRankedCandidateMaterial[] = [];

    for (
      const candidate
      of ranking.ranked_candidates
    ) {
      materials.push(
        await this.resolveOne(
          request,
          authorizedScopes,
          candidate,
        ),
      );
    }

    return Object.freeze(materials);
  }

  private async resolveOne(
    request:
      CapaKnowledgeRetrievalRequest,
    authorizedScopes:
      readonly CapaKnowledgeScope[],
    candidate:
      CapaKnowledgeRetrievalCandidate,
  ): Promise<CapaKnowledgeRankedCandidateMaterial> {
    const resolvedSource =
      await findInAuthorizedScopes(
        authorizedScopes,
        (scope) =>
          this.repository.findSourceById(
            scope,
            candidate.source_id,
          ),
      );

    if (resolvedSource === null) {
      fail("CANDIDATE_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    const scope = resolvedSource.scope;
    const sourceVersion =
      await this.repository
        .findSourceVersionById({
          scope,
          source_id: candidate.source_id,
          source_version_id:
            candidate.source_version_id,
        });
    const passage =
      await this.repository.findPassageById(
        scope,
        candidate.passage_id,
      );
    const collection =
      await this.repository
        .findCollectionVersionById({
          scope,
          collection_id:
            request.scope.collection_id,
          collection_version_id:
            request.scope
              .collection_version_id,
        });

    if (collection === null) {
      fail("COLLECTION_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    if (
      sourceVersion === null ||
      passage === null
    ) {
      fail("CANDIDATE_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    if (
      sourceVersion.source_id !==
        candidate.source_id ||
      sourceVersion.source_version_id !==
        candidate.source_version_id ||
      passage.source_version_id !==
        candidate.source_version_id ||
      passage.passage_id !==
        candidate.passage_id ||
      !collection.source_version_ids.includes(
        candidate.source_version_id,
      )
    ) {
      fail("CANDIDATE_MATERIAL_MISMATCH");
    }

    return Object.freeze({
      candidate,
      relationship:
        "contextualizes" as const,
      collection,
      source: resolvedSource.value,
      source_version: sourceVersion,
      primary_passage: passage,
      related_context:
        await adjacentContext(
          this.repository,
          scope,
          passage,
        ),
    });
  }
}

export function createRepositoryBackedCapaKnowledgeCandidateMaterialResolver(
  repository:
    CapaKnowledgeRepository,
): RepositoryBackedCapaKnowledgeCandidateMaterialResolver {
  return new RepositoryBackedCapaKnowledgeCandidateMaterialResolver(
    repository,
  );
}
