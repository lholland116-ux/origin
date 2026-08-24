import type {
  IsoDateTime,
} from "../domain/capa-types";

import type {
  CapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-contract";

import {
  constructCapaKnowledgeQuery,
  type CapaKnowledgeConstructedQuery,
  type CapaKnowledgeQueryConstructionInput,
  type CapaKnowledgeQueryConstructionLimits,
} from "./capa-knowledge-query-construction";

import {
  rankCapaKnowledgeCandidates,
  type CapaKnowledgeCandidateRankingResult,
} from "./capa-knowledge-candidate-ranking";

import {
  selectCapaKnowledgeCandidateContext,
  type CapaKnowledgeContextSelectionLimits,
  type CapaKnowledgeRankedCandidateMaterial,
} from "./capa-knowledge-context-selection";

import {
  assembleCapaKnowledgeEvidencePackage,
  type CapaKnowledgeAssembledEvidencePackage,
} from "./capa-knowledge-evidence-assembler";

import {
  constructAndValidateCapaKnowledgeCitation,
  type CapaKnowledgeCitationValidationInput,
  type CapaKnowledgeValidatedCitation,
} from "./capa-knowledge-citation-validator";

import type {
  CapaKnowledgeRetrievalIndexRepository,
} from "../../database/repositories/capa-knowledge-retrieval-repository";

/**
 * Provider-neutral governed retrieval orchestration.
 *
 * This boundary constructs queries, retrieves metadata-only candidates,
 * ranks them deterministically, resolves authorized material, selects bounded
 * context and assembles evidence. It does not invoke a model, mutate a CAPA
 * case, determine compliance, approve work or infer citation support.
 *
 * Traceability:
 * RET-001 through RET-012
 * CIT-001 through CIT-012
 * KRC-AC-002 through KRC-AC-007
 */

export const CAPA_KNOWLEDGE_RETRIEVAL_SERVICE_REASON_CODES = [
  "QUERY_POLICY_MISMATCH",
  "RETRIEVAL_PROVIDER_FAILURE",
  "RETRIEVAL_RESULT_MISMATCH",
  "QUERY_EMBEDDING_REQUIRED",
  "QUERY_EMBEDDING_FAILURE",
  "MATERIAL_RESOLUTION_FAILURE",
  "MATERIAL_RESULT_MISMATCH",
  "INVALID_COMPLETION_TIMESTAMP",
] as const;

export type CapaKnowledgeRetrievalServiceReasonCode =
  (typeof CAPA_KNOWLEDGE_RETRIEVAL_SERVICE_REASON_CODES)[number];

export class CapaKnowledgeRetrievalServiceError
  extends Error {
  readonly reason_code:
    CapaKnowledgeRetrievalServiceReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeRetrievalServiceReasonCode,
  ) {
    super(
      "The governed CAPA knowledge retrieval operation failed.",
    );
    this.name =
      "CapaKnowledgeRetrievalServiceError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeQueryEmbeddingProvider {
  embedQuery(
    normalizedQuery: string,
  ): Promise<readonly number[]>;
}

export interface CapaKnowledgeCandidateMaterialResolver {
  resolveCandidateMaterials(
    request:
      CapaKnowledgeRetrievalRequest,
    ranking:
      CapaKnowledgeCandidateRankingResult,
  ): Promise<readonly CapaKnowledgeRankedCandidateMaterial[]>;
}

export interface CapaKnowledgeRetrievalServiceDependencies {
  readonly index_repository:
    CapaKnowledgeRetrievalIndexRepository;
  readonly material_resolver:
    CapaKnowledgeCandidateMaterialResolver;
  readonly query_embedding_provider?:
    CapaKnowledgeQueryEmbeddingProvider;
  readonly now: () => Date;
}

export interface CapaKnowledgeRetrievalServiceInput {
  readonly request:
    Omit<
      CapaKnowledgeRetrievalRequest,
      "query_text" |
      "query_fingerprint"
    >;
  readonly query:
    CapaKnowledgeQueryConstructionInput;
  readonly query_limits?:
    CapaKnowledgeQueryConstructionLimits;
  readonly context_limits?:
    CapaKnowledgeContextSelectionLimits;
}

export interface CapaKnowledgeRetrievalServiceResult {
  readonly request:
    CapaKnowledgeRetrievalRequest;
  readonly constructed_query:
    CapaKnowledgeConstructedQuery;
  readonly ranking:
    CapaKnowledgeCandidateRankingResult;
  readonly evidence_package:
    CapaKnowledgeAssembledEvidencePackage;
}

function fail(
  reasonCode:
    CapaKnowledgeRetrievalServiceReasonCode,
): never {
  throw new CapaKnowledgeRetrievalServiceError(
    reasonCode,
  );
}

function queryTerms(
  query: string,
): readonly string[] {
  return Object.freeze(
    Array.from(new Set(
      Array.from(
        query
          .normalize("NFKC")
          .toLocaleLowerCase("en-US")
          .matchAll(/[\p{L}\p{N}]+/gu),
        (match) => match[0],
      ),
    )),
  );
}

function controlledEmbedding(
  value: readonly number[],
): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 16_384 ||
    value.some(
      (component) =>
        typeof component !== "number" ||
        !Number.isFinite(component),
    )
  ) {
    fail("QUERY_EMBEDDING_FAILURE");
  }

  return Object.freeze([...value]);
}

function completionTimestamp(
  now: Date,
  requestedAt: IsoDateTime,
): IsoDateTime {
  if (
    Number.isNaN(now.getTime()) ||
    now.getTime() < Date.parse(requestedAt)
  ) {
    fail("INVALID_COMPLETION_TIMESTAMP");
  }

  return now.toISOString() as IsoDateTime;
}

export class CapaKnowledgeRetrievalService {
  constructor(
    private readonly dependencies:
      CapaKnowledgeRetrievalServiceDependencies,
  ) {}

  async retrieve(
    input:
      CapaKnowledgeRetrievalServiceInput,
  ): Promise<CapaKnowledgeRetrievalServiceResult> {
    const constructedQuery =
      constructCapaKnowledgeQuery(
        input.query,
        input.query_limits,
      );

    if (
      constructedQuery.task_type !==
        input.request.task_type ||
      constructedQuery.query_construction_version !==
        input.request.policy
          .query_construction_version
    ) {
      fail("QUERY_POLICY_MISMATCH");
    }

    const request = Object.freeze({
      ...input.request,
      query_text:
        constructedQuery.query_text,
      query_fingerprint:
        constructedQuery.query_fingerprint,
    }) as CapaKnowledgeRetrievalRequest;
    const method =
      request.policy.retrieval_method;
    let embedding:
      readonly number[] | undefined;

    if (
      method === "vector" ||
      method === "hybrid"
    ) {
      const provider =
        this.dependencies
          .query_embedding_provider;

      if (provider === undefined) {
        fail("QUERY_EMBEDDING_REQUIRED");
      }

      try {
        embedding = controlledEmbedding(
          await provider.embedQuery(
            constructedQuery.query_text,
          ),
        );
      } catch (error) {
        if (
          error instanceof
            CapaKnowledgeRetrievalServiceError
        ) {
          throw error;
        }
        fail("QUERY_EMBEDDING_FAILURE");
      }
    }

    let indexResult;

    try {
      indexResult =
        await this.dependencies
          .index_repository.search({
            request,
            normalized_query:
              constructedQuery.query_text,
            query_terms:
              queryTerms(
                constructedQuery.query_text,
              ),
            ...(embedding === undefined
              ? {}
              : {
                  query_embedding:
                    embedding,
                }),
          });
    } catch {
      fail("RETRIEVAL_PROVIDER_FAILURE");
    }

    if (
      indexResult.retrieval_run_id !==
        request.retrieval_run_id ||
      indexResult.retrieval_method !==
        method
    ) {
      fail("RETRIEVAL_RESULT_MISMATCH");
    }

    const ranking =
      rankCapaKnowledgeCandidates(
        indexResult.candidates,
        request,
      );
    let materials:
      readonly CapaKnowledgeRankedCandidateMaterial[];

    try {
      materials =
        await this.dependencies
          .material_resolver
          .resolveCandidateMaterials(
            request,
            ranking,
          );
    } catch {
      fail("MATERIAL_RESOLUTION_FAILURE");
    }

    if (
      materials.length !==
        ranking.ranked_candidates.length
    ) {
      fail("MATERIAL_RESULT_MISMATCH");
    }

    const selection =
      selectCapaKnowledgeCandidateContext(
        request,
        ranking,
        materials,
        input.context_limits,
      );
    const partial =
      indexResult.index_status ===
        "partial";
    const evidencePackage =
      assembleCapaKnowledgeEvidencePackage({
        request,
        selection,
        upstream_status:
          partial ? "partial" : "complete",
        ...(partial
          ? {
              partial_reason:
                "PARTIAL_INDEX" as const,
            }
          : {}),
        warnings: partial
          ? [
              "The governed retrieval index reported partial coverage.",
            ]
          : [],
        completed_at:
          completionTimestamp(
            this.dependencies.now(),
            request.requested_at,
          ),
      });

    return Object.freeze({
      request,
      constructed_query:
        constructedQuery,
      ranking,
      evidence_package:
        evidencePackage,
    });
  }

  validateCitation(
    input:
      CapaKnowledgeCitationValidationInput,
  ): CapaKnowledgeValidatedCitation {
    return constructAndValidateCapaKnowledgeCitation(
      input,
    );
  }
}

export function createCapaKnowledgeRetrievalService(
  dependencies:
    CapaKnowledgeRetrievalServiceDependencies,
): CapaKnowledgeRetrievalService {
  return new CapaKnowledgeRetrievalService(
    dependencies,
  );
}
