import {
  CAPA_KNOWLEDGE_QUALITY_STATUSES,
  CAPA_KNOWLEDGE_SOURCE_STATUSES,
  CAPA_KNOWLEDGE_SOURCE_TYPES,
} from "./capa-knowledge-contract";

import {
  type CapaKnowledgeCandidateTrace,
  type CapaKnowledgeRetrievalCandidate,
  type CapaKnowledgeRetrievalMethod,
  type CapaKnowledgeRetrievalRequest,
  type CapaKnowledgeRetrievalRunId,
} from "./capa-knowledge-retrieval-contract";

import {
  validateCapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-validator";

/**
 * Provider-neutral metadata-only candidate retrieval and deterministic
 * ranking. Similarity scores are ranking signals, not probabilities of truth,
 * compliance, applicability or citation support.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * IDX-002, IDX-005, IDX-010
 * RET-002, RET-004, RET-005, RET-008, RET-009 and RET-012
 */

export const CAPA_KNOWLEDGE_CANDIDATE_RANKING_REASON_CODES = [
  "INVALID_CANDIDATE_SET",
  "TOO_MANY_CANDIDATES",
  "INVALID_CANDIDATE",
  "DUPLICATE_CANDIDATE_ID",
  "DUPLICATE_RAW_RANK",
  "MISSING_REQUIRED_SCORE",
  "RETRIEVAL_PROVIDER_FAILURE",
] as const;

export type CapaKnowledgeCandidateRankingReasonCode =
  (typeof CAPA_KNOWLEDGE_CANDIDATE_RANKING_REASON_CODES)[number];

export class CapaKnowledgeCandidateRankingError
  extends Error {
  readonly reason_code:
    CapaKnowledgeCandidateRankingReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeCandidateRankingReasonCode,
  ) {
    super(
      "The governed CAPA knowledge candidates could not be ranked.",
    );
    this.name =
      "CapaKnowledgeCandidateRankingError";
    this.reason_code = reasonCode;
  }
}

/**
 * Adapter boundary for an approved lexical, vector, structured or hybrid
 * index. Candidate content is intentionally absent at this stage.
 */
export interface CapaKnowledgeCandidateRetriever {
  retrieveCandidates(
    request:
      CapaKnowledgeRetrievalRequest,
  ): Promise<readonly CapaKnowledgeRetrievalCandidate[]>;
}

export interface CapaKnowledgeCandidateRankingResult {
  readonly retrieval_run_id:
    CapaKnowledgeRetrievalRunId;
  readonly retrieval_method:
    CapaKnowledgeRetrievalMethod;
  readonly ranking_policy_version: string;
  readonly ranked_candidates:
    readonly CapaKnowledgeRetrievalCandidate[];
  readonly candidate_trace:
    readonly CapaKnowledgeCandidateTrace[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOURCE_TYPES =
  new Set<string>(
    CAPA_KNOWLEDGE_SOURCE_TYPES,
  );
const SOURCE_STATUSES =
  new Set<string>(
    CAPA_KNOWLEDGE_SOURCE_STATUSES,
  );
const QUALITY_STATUSES =
  new Set<string>(
    CAPA_KNOWLEDGE_QUALITY_STATUSES,
  );

function record(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function score(
  value: unknown,
): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
}

function optionalScore(
  value: unknown,
): boolean {
  return value === undefined || score(value);
}

function fail(
  reasonCode:
    CapaKnowledgeCandidateRankingReasonCode,
): never {
  throw new CapaKnowledgeCandidateRankingError(
    reasonCode,
  );
}

function validateCandidate(
  value: unknown,
): CapaKnowledgeRetrievalCandidate {
  const candidate = record(value);

  if (
    candidate === null ||
    !UUID_PATTERN.test(
      candidate.candidate_id as string,
    ) ||
    !UUID_PATTERN.test(
      candidate.source_id as string,
    ) ||
    !UUID_PATTERN.test(
      candidate.source_version_id as string,
    ) ||
    !UUID_PATTERN.test(
      candidate.passage_id as string,
    ) ||
    !SOURCE_TYPES.has(
      candidate.source_type as string,
    ) ||
    !SOURCE_STATUSES.has(
      candidate.source_status as string,
    ) ||
    !QUALITY_STATUSES.has(
      candidate.quality_status as string,
    ) ||
    !Number.isSafeInteger(candidate.raw_rank) ||
    (candidate.raw_rank as number) < 1 ||
    !optionalScore(candidate.lexical_score) ||
    !optionalScore(candidate.semantic_score) ||
    !optionalScore(candidate.metadata_score) ||
    candidate.final_score !== undefined
  ) {
    fail("INVALID_CANDIDATE");
  }

  return value as CapaKnowledgeRetrievalCandidate;
}

function requiredRelevanceScore(
  candidate:
    CapaKnowledgeRetrievalCandidate,
  method:
    CapaKnowledgeRetrievalMethod,
): number {
  switch (method) {
    case "lexical":
      if (candidate.lexical_score === undefined) {
        fail("MISSING_REQUIRED_SCORE");
      }
      return candidate.lexical_score;

    case "vector":
      if (candidate.semantic_score === undefined) {
        fail("MISSING_REQUIRED_SCORE");
      }
      return candidate.semantic_score;

    case "structured":
      if (candidate.metadata_score === undefined) {
        fail("MISSING_REQUIRED_SCORE");
      }
      return candidate.metadata_score;

    case "hybrid": {
      if (
        candidate.lexical_score === undefined ||
        candidate.semantic_score === undefined
      ) {
        fail("MISSING_REQUIRED_SCORE");
      }

      const signals = [
        candidate.lexical_score,
        candidate.semantic_score,
        ...(candidate.metadata_score === undefined
          ? []
          : [candidate.metadata_score]),
      ];

      return signals.reduce(
        (total, signal) => total + signal,
        0,
      ) / signals.length;
    }
  }
}

function stableScore(
  value: number,
): number {
  return Number(value.toFixed(12));
}

interface ScoredCandidate {
  readonly candidate:
    CapaKnowledgeRetrievalCandidate;
  readonly relevance_score: number;
}

function rankValidatedCandidates(
  candidates:
    readonly CapaKnowledgeRetrievalCandidate[],
  request:
    CapaKnowledgeRetrievalRequest,
): CapaKnowledgeCandidateRankingResult {
  const method =
    request.policy.retrieval_method;
  const scored: ScoredCandidate[] =
    candidates.map((candidate) => ({
      candidate,
      relevance_score: stableScore(
        requiredRelevanceScore(
          candidate,
          method,
        ),
      ),
    }));

  const included = scored
    .filter(
      (entry) =>
        entry.relevance_score >=
          request.policy.minimum_relevance_score,
    )
    .sort((left, right) =>
      right.relevance_score -
        left.relevance_score ||
      left.candidate.raw_rank -
        right.candidate.raw_rank,
    );

  const finalRankByCandidateId =
    new Map<string, number>(
      included.map(
        (entry, index) => [
          entry.candidate.candidate_id,
          index + 1,
        ],
      ),
    );

  const rankedCandidates = included.map(
    (entry) => Object.freeze({
      ...entry.candidate,
      final_score: entry.relevance_score,
    }),
  );

  const candidateTrace = scored.map(
    (entry): CapaKnowledgeCandidateTrace => {
      const finalRank =
        finalRankByCandidateId.get(
          entry.candidate.candidate_id,
        );

      return Object.freeze({
        candidate: Object.freeze({
          ...entry.candidate,
          final_score:
            entry.relevance_score,
        }),
        disposition: finalRank === undefined
          ? Object.freeze({
              disposition:
                "excluded" as const,
              reason_code:
                "BELOW_MINIMUM_SCORE" as const,
            })
          : Object.freeze({
              disposition:
                "included" as const,
              final_rank: finalRank,
            }),
      });
    },
  );

  return Object.freeze({
    retrieval_run_id:
      request.retrieval_run_id,
    retrieval_method: method,
    ranking_policy_version:
      request.policy.ranking_policy_version,
    ranked_candidates:
      Object.freeze(rankedCandidates),
    candidate_trace:
      Object.freeze(candidateTrace),
  });
}

/**
 * Validates a complete metadata-only candidate set and returns a stable order.
 */
export function rankCapaKnowledgeCandidates(
  candidateInput: unknown,
  requestInput: unknown,
): CapaKnowledgeCandidateRankingResult {
  const request =
    validateCapaKnowledgeRetrievalRequest(
      requestInput,
    );

  if (!Array.isArray(candidateInput)) {
    fail("INVALID_CANDIDATE_SET");
  }

  if (
    candidateInput.length >
      request.policy.maximum_candidates
  ) {
    fail("TOO_MANY_CANDIDATES");
  }

  const candidates = candidateInput.map(
    validateCandidate,
  );
  const candidateIds = candidates.map(
    (candidate) => candidate.candidate_id,
  );
  const rawRanks = candidates.map(
    (candidate) => candidate.raw_rank,
  );

  if (
    new Set(candidateIds).size !==
      candidateIds.length
  ) {
    fail("DUPLICATE_CANDIDATE_ID");
  }

  if (
    new Set(rawRanks).size !== rawRanks.length
  ) {
    fail("DUPLICATE_RAW_RANK");
  }

  return rankValidatedCandidates(
    candidates,
    request,
  );
}

/** Executes the approved adapter and maps every provider failure safely. */
export async function retrieveAndRankCapaKnowledgeCandidates(
  retriever:
    CapaKnowledgeCandidateRetriever,
  requestInput: unknown,
): Promise<CapaKnowledgeCandidateRankingResult> {
  const request =
    validateCapaKnowledgeRetrievalRequest(
      requestInput,
    );
  let candidates:
    readonly CapaKnowledgeRetrievalCandidate[];

  try {
    candidates =
      await retriever.retrieveCandidates(
        request,
      );
  } catch {
    fail("RETRIEVAL_PROVIDER_FAILURE");
  }

  return rankCapaKnowledgeCandidates(
    candidates,
    request,
  );
}
