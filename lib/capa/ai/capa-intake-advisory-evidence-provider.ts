import type {
  CorrelationId,
  RequestId,
} from "../domain/capa-types";

import type {
  CapaIntakeAdvisoryCaseContext,
  CapaIntakeAdvisoryEvidence,
  CapaIntakeAdvisoryEvidenceProvider,
} from "./capa-intake-advisory-service";

import type {
  CapaIntakeAdvisoryRequest,
} from "./capa-intake-advisory-contract";

import type {
  CapaKnowledgeRetrievalService,
  CapaKnowledgeRetrievalServiceInput,
} from "../knowledge/capa-knowledge-retrieval-service";

import {
  isCapaKnowledgeRetrievalUsable,
} from "../knowledge/capa-knowledge-retrieval-contract";

/**
 * Governed evidence retrieval boundary for the CAPA intake advisory.
 *
 * The provider deliberately does not construct retrieval authorization,
 * collection scope, policy, filters or identifiers from browser-controlled
 * input. Those values are supplied by the server-controlled request factory.
 *
 * User focus and authorized case context may influence the governed query,
 * but cannot broaden authorization or select retrieval policy.
 *
 * M5G Change Set 5A.
 */
export interface CapaIntakeAdvisoryRetrievalRequestFactory {
  create(input: {
    readonly context:
      CapaIntakeAdvisoryCaseContext;
    readonly request:
      CapaIntakeAdvisoryRequest;
    readonly request_id: RequestId;
    readonly correlation_id:
      CorrelationId;
  }): CapaKnowledgeRetrievalServiceInput;
}

export class GovernedCapaIntakeAdvisoryEvidenceProvider
  implements CapaIntakeAdvisoryEvidenceProvider {
  constructor(
    private readonly retrieval_service:
      CapaKnowledgeRetrievalService,
    private readonly request_factory:
      CapaIntakeAdvisoryRetrievalRequestFactory,
  ) {}

  async retrieve(input: {
    readonly context:
      CapaIntakeAdvisoryCaseContext;
    readonly request:
      CapaIntakeAdvisoryRequest;
    readonly request_id: RequestId;
    readonly correlation_id:
      CorrelationId;
  }): Promise<CapaIntakeAdvisoryEvidence> {
    const retrievalInput =
      this.request_factory.create(input);

    /*
     * Defense in depth: the governed retrieval request must remain in the
     * organization already resolved and authorized by the advisory service.
     */
    if (
      retrievalInput.request.scope.organization_id !==
        input.context.organization_id
    ) {
      throw new Error(
        "CAPA intake advisory retrieval scope does not match the authorized organization.",
      );
    }

    const result =
      await this.retrieval_service.retrieve(
        retrievalInput,
      );

    const evidence =
      result.evidence_package;

    if (
      !isCapaKnowledgeRetrievalUsable(
        evidence.outcome,
      )
    ) {
      return Object.freeze({
        prompt_context: Object.freeze([]),
        citations: Object.freeze([]),
        warnings: Object.freeze([
          ...evidence.warnings,
          `Governed retrieval returned ${evidence.outcome}: ${evidence.reason_code}.`,
        ]),
      });
    }

    /*
     * These are evidence inputs, not claim-specific citations.
     *
     * Retrieval relevance alone does not prove that a passage supports a
     * generated claim. Claim-specific citations therefore remain empty here
     * and must be constructed and validated after a claim relationship has
     * been assessed.
     */
    const promptContext =
      evidence.passages.map(
        (passage) =>
          Object.freeze({
            evidence_id:
              passage.evidence_id,
            organization_id:
              input.context.organization_id,
            collection_id:
              result.request.scope.collection_id,
            collection_version_id:
              evidence.collection_version_id,
            retrieval_run_id:
              evidence.retrieval_run_id,
            source_id:
              passage.source_id,
            source_version_id:
              passage.source_version_id,
            passage_id:
              passage.passage_id,
            source_type:
              passage.source_type,
            source_status_at_use:
              passage.source_status_at_use,
            title:
              passage.title,
            issuer:
              passage.issuer,
            jurisdiction:
              passage.jurisdiction,
            locators:
              passage.locators,
            rank:
              passage.rank,
            relevance_score:
              passage.relevance_score,
            limitations:
              passage.limitations,
            relationship:
              passage.relationship,
            related_context:
              passage.related_context,
            text: Object.freeze({
              trust:
                "untrusted_data" as const,
              provenance_type:
                "retrieved_passage" as const,
              content:
                passage.content,
            }),
          }),
      );

    return Object.freeze({
      prompt_context:
        Object.freeze(promptContext),
      citations:
        Object.freeze([]),
      warnings:
        Object.freeze([
          ...evidence.warnings,
        ]),
    });
  }
}

export function createGovernedCapaIntakeAdvisoryEvidenceProvider(
  retrievalService:
    CapaKnowledgeRetrievalService,
  requestFactory:
    CapaIntakeAdvisoryRetrievalRequestFactory,
): CapaIntakeAdvisoryEvidenceProvider {
  return new GovernedCapaIntakeAdvisoryEvidenceProvider(
    retrievalService,
    requestFactory,
  );
}
