import type {
  CapaKnowledgeCollectionVersion,
  CapaKnowledgePassage,
  CapaKnowledgeSource,
  CapaKnowledgeSourceVersion,
} from "./capa-knowledge-contract";

import type {
  CapaKnowledgeCandidateTrace,
  CapaKnowledgeCitationRelationship,
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeCandidateRankingResult,
} from "./capa-knowledge-candidate-ranking";

import {
  evaluateCapaKnowledgeRetrievalEligibility,
  validateCapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-validator";

/**
 * Deterministic duplicate control, conflict preservation and bounded context
 * expansion for governed CAPA retrieval.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * SEG-002, SEG-003
 * RET-002, RET-006 through RET-009
 * KRC-T-002, KRC-T-005, KRC-T-006 and KRC-T-012
 */

export const CAPA_KNOWLEDGE_CONTEXT_ROLES = [
  "definition",
  "scope",
  "exception",
  "warning",
  "footnote",
  "table_header",
  "adjacent",
] as const;

export type CapaKnowledgeContextRole =
  (typeof CAPA_KNOWLEDGE_CONTEXT_ROLES)[number];

export const CAPA_KNOWLEDGE_CONTEXT_SELECTION_REASON_CODES = [
  "INVALID_CONTEXT_INPUT",
  "RANKING_RESULT_MISMATCH",
  "CANDIDATE_MATERIAL_MISSING",
  "CANDIDATE_MATERIAL_MISMATCH",
  "CONTEXT_LIMIT_EXCEEDED",
  "CONTEXT_PASSAGE_MISMATCH",
  "REQUIRED_CONTEXT_INELIGIBLE",
] as const;

export type CapaKnowledgeContextSelectionReasonCode =
  (typeof CAPA_KNOWLEDGE_CONTEXT_SELECTION_REASON_CODES)[number];

export class CapaKnowledgeContextSelectionError
  extends Error {
  readonly reason_code:
    CapaKnowledgeContextSelectionReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeContextSelectionReasonCode,
  ) {
    super(
      "The governed CAPA retrieval context could not be selected.",
    );
    this.name =
      "CapaKnowledgeContextSelectionError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeRelatedContextPassage {
  readonly role:
    CapaKnowledgeContextRole;
  readonly required: boolean;
  readonly passage:
    CapaKnowledgePassage;
}

export interface CapaKnowledgeRankedCandidateMaterial {
  readonly candidate:
    CapaKnowledgeRetrievalCandidate;
  readonly relationship:
    CapaKnowledgeCitationRelationship;
  readonly collection:
    CapaKnowledgeCollectionVersion;
  readonly source:
    CapaKnowledgeSource;
  readonly source_version:
    CapaKnowledgeSourceVersion;
  readonly primary_passage:
    CapaKnowledgePassage;
  readonly related_context:
    readonly CapaKnowledgeRelatedContextPassage[];
}

export interface CapaKnowledgeSelectedCandidateContext {
  readonly candidate:
    CapaKnowledgeRetrievalCandidate;
  readonly relationship:
    CapaKnowledgeCitationRelationship;
  readonly collection:
    CapaKnowledgeCollectionVersion;
  readonly source:
    CapaKnowledgeSource;
  readonly source_version:
    CapaKnowledgeSourceVersion;
  readonly primary_passage:
    CapaKnowledgePassage;
  readonly related_context:
    readonly CapaKnowledgeRelatedContextPassage[];
}

export interface CapaKnowledgeContextSelectionResult {
  readonly selected:
    readonly CapaKnowledgeSelectedCandidateContext[];
  readonly candidate_trace:
    readonly CapaKnowledgeCandidateTrace[];
  readonly total_character_count: number;
}

export interface CapaKnowledgeContextSelectionLimits {
  readonly maximum_context_passages_per_candidate?:
    number;
}

export const DEFAULT_MAXIMUM_CONTEXT_PASSAGES_PER_CANDIDATE =
  6;

const CONTEXT_ROLES =
  new Set<string>(
    CAPA_KNOWLEDGE_CONTEXT_ROLES,
  );

function fail(
  reasonCode:
    CapaKnowledgeContextSelectionReasonCode,
): never {
  throw new CapaKnowledgeContextSelectionError(
    reasonCode,
  );
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback;

  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > 100
  ) {
    fail("INVALID_CONTEXT_INPUT");
  }

  return resolved;
}

function fingerprintKey(
  passage: CapaKnowledgePassage,
): string {
  return `${passage.fingerprint.algorithm}:${passage.fingerprint.value}`;
}

function materialMatchesCandidate(
  material:
    CapaKnowledgeRankedCandidateMaterial,
): boolean {
  return material.source.source_id ===
      material.candidate.source_id &&
    material.source_version.source_id ===
      material.candidate.source_id &&
    material.source_version.source_version_id ===
      material.candidate.source_version_id &&
    material.primary_passage.source_version_id ===
      material.candidate.source_version_id &&
    material.primary_passage.passage_id ===
      material.candidate.passage_id;
}

function passagesOverlap(
  left: CapaKnowledgePassage,
  right: CapaKnowledgePassage,
): boolean {
  return left.overlap_passage_ids.includes(
    right.passage_id,
  ) ||
    right.overlap_passage_ids.includes(
      left.passage_id,
    );
}

function duplicateOfSelected(
  passage: CapaKnowledgePassage,
  selected:
    readonly CapaKnowledgeSelectedCandidateContext[],
): boolean {
  return selected.some((entry) =>
    entry.primary_passage.passage_id ===
      passage.passage_id ||
    fingerprintKey(entry.primary_passage) ===
      fingerprintKey(passage) ||
    passagesOverlap(
      entry.primary_passage,
      passage,
    ),
  );
}

function validateRelatedContext(
  material:
    CapaKnowledgeRankedCandidateMaterial,
  request:
    CapaKnowledgeRetrievalRequest,
  maximumContextPassages: number,
): readonly CapaKnowledgeRelatedContextPassage[] {
  if (
    !Array.isArray(material.related_context) ||
    material.related_context.length >
      maximumContextPassages
  ) {
    fail("CONTEXT_LIMIT_EXCEEDED");
  }

  const seenPassageIds = new Set<string>();
  const selected:
    CapaKnowledgeRelatedContextPassage[] = [];

  for (const related of material.related_context) {
    if (
      !CONTEXT_ROLES.has(related.role) ||
      typeof related.required !== "boolean"
    ) {
      fail("INVALID_CONTEXT_INPUT");
    }

    if (
      related.passage.source_version_id !==
        material.source_version
          .source_version_id ||
      related.passage.passage_id ===
        material.primary_passage.passage_id
    ) {
      fail("CONTEXT_PASSAGE_MISMATCH");
    }

    if (
      seenPassageIds.has(
        related.passage.passage_id,
      )
    ) {
      continue;
    }

    const eligibility =
      evaluateCapaKnowledgeRetrievalEligibility({
        request,
        collection: material.collection,
        source: material.source,
        source_version:
          material.source_version,
        passage: related.passage,
      });

    if (!eligibility.eligible) {
      if (related.required) {
        fail("REQUIRED_CONTEXT_INELIGIBLE");
      }
      continue;
    }

    seenPassageIds.add(
      related.passage.passage_id,
    );
    selected.push(Object.freeze({
      role: related.role,
      required: related.required,
      passage: related.passage,
    }));
  }

  return Object.freeze(selected);
}

/**
 * Selects only authorized material. Exact duplicate fingerprints and overlap
 * chunks never count as independent corroboration. Distinct contradictory and
 * alternative passages remain visible in ranked order.
 */
export function selectCapaKnowledgeCandidateContext(
  requestInput: unknown,
  rankingResult:
    CapaKnowledgeCandidateRankingResult,
  materialInput: unknown,
  limits: CapaKnowledgeContextSelectionLimits = {},
): CapaKnowledgeContextSelectionResult {
  const request =
    validateCapaKnowledgeRetrievalRequest(
      requestInput,
    );
  const maximumContextPassages =
    positiveInteger(
      limits.maximum_context_passages_per_candidate,
      DEFAULT_MAXIMUM_CONTEXT_PASSAGES_PER_CANDIDATE,
    );

  if (
    rankingResult.retrieval_run_id !==
      request.retrieval_run_id ||
    rankingResult.ranking_policy_version !==
      request.policy.ranking_policy_version
  ) {
    fail("RANKING_RESULT_MISMATCH");
  }

  if (!Array.isArray(materialInput)) {
    fail("INVALID_CONTEXT_INPUT");
  }

  const materials = materialInput as
    readonly CapaKnowledgeRankedCandidateMaterial[];
  const materialByCandidateId =
    new Map(
      materials.map((material) => [
        material.candidate.candidate_id,
        material,
      ]),
    );

  if (
    materialByCandidateId.size !==
      materials.length
  ) {
    fail("INVALID_CONTEXT_INPUT");
  }

  const selected:
    CapaKnowledgeSelectedCandidateContext[] = [];
  const traceByCandidateId = new Map(
    rankingResult.candidate_trace.map(
      (trace) => [
        trace.candidate.candidate_id,
        trace,
      ],
    ),
  );

  for (
    const rankedCandidate
    of rankingResult.ranked_candidates.slice(
      0,
      request.policy.maximum_results,
    )
  ) {
    const material =
      materialByCandidateId.get(
        rankedCandidate.candidate_id,
      );

    if (material === undefined) {
      fail("CANDIDATE_MATERIAL_MISSING");
    }

    if (
      material.candidate.final_score !==
        rankedCandidate.final_score ||
      !materialMatchesCandidate(material)
    ) {
      fail("CANDIDATE_MATERIAL_MISMATCH");
    }

    const eligibility =
      evaluateCapaKnowledgeRetrievalEligibility({
        request,
        collection: material.collection,
        source: material.source,
        source_version:
          material.source_version,
        passage: material.primary_passage,
      });

    if (!eligibility.eligible) {
      traceByCandidateId.set(
        rankedCandidate.candidate_id,
        Object.freeze({
          candidate: rankedCandidate,
          disposition: Object.freeze({
            disposition: "excluded" as const,
            reason_code:
              eligibility.reason_code,
          }),
        }),
      );
      continue;
    }

    if (
      duplicateOfSelected(
        material.primary_passage,
        selected,
      )
    ) {
      traceByCandidateId.set(
        rankedCandidate.candidate_id,
        Object.freeze({
          candidate: rankedCandidate,
          disposition: Object.freeze({
            disposition: "excluded" as const,
            reason_code:
              "DUPLICATE_SOURCE_PASSAGE" as const,
          }),
        }),
      );
      continue;
    }

    const relatedContext =
      validateRelatedContext(
        material,
        request,
        maximumContextPassages,
      );

    selected.push(Object.freeze({
      candidate: rankedCandidate,
      relationship: material.relationship,
      collection: material.collection,
      source: material.source,
      source_version:
        material.source_version,
      primary_passage:
        material.primary_passage,
      related_context: relatedContext,
    }));
  }

  const candidateTrace =
    rankingResult.candidate_trace.map(
      (trace) =>
        traceByCandidateId.get(
          trace.candidate.candidate_id,
        ) as typeof trace,
    );
  const totalCharacterCount =
    selected.reduce(
      (total, entry) =>
        total +
        entry.primary_passage.content.length +
        entry.related_context.reduce(
          (contextTotal, related) =>
            contextTotal +
            related.passage.content.length,
          0,
        ),
      0,
    );

  if (
    totalCharacterCount >
      request.policy.maximum_total_characters
  ) {
    fail("CONTEXT_LIMIT_EXCEEDED");
  }

  return Object.freeze({
    selected: Object.freeze(selected),
    candidate_trace:
      Object.freeze(candidateTrace),
    total_character_count:
      totalCharacterCount,
  });
}
