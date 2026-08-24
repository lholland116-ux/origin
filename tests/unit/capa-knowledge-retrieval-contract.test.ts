import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_KNOWLEDGE_CANDIDATE_EXCLUSION_REASONS,
  CAPA_KNOWLEDGE_CITATION_RELATIONSHIPS,
  CAPA_KNOWLEDGE_CITATION_VALIDATION_STATUSES,
  CAPA_KNOWLEDGE_RETRIEVAL_METHODS,
  CAPA_KNOWLEDGE_RETRIEVAL_OUTCOMES,
  CAPA_KNOWLEDGE_RETRIEVAL_REASON_CODES,
  isCapaKnowledgeRetrievalUsable,
  type CapaKnowledgeCitationRecord,
  type CapaKnowledgeEvidencePackage,
  type CapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-contract";

describe(
  "governed CAPA knowledge retrieval contract",
  () => {
    it(
      "defines distinct retrieval outcomes",
      () => {
        expect(
          CAPA_KNOWLEDGE_RETRIEVAL_OUTCOMES,
        ).toEqual([
          "complete",
          "no_result",
          "partial",
          "failure",
        ]);
      },
    );

    it(
      "distinguishes material fail-closed outcomes",
      () => {
        expect(
          CAPA_KNOWLEDGE_RETRIEVAL_REASON_CODES,
        ).toEqual(
          expect.arrayContaining([
            "FILTER_EXHAUSTED",
            "TENANT_SCOPE_DENIED",
            "PARTIAL_INDEX",
            "RETRIEVAL_TIMEOUT",
            "RETRIEVAL_PROVIDER_FAILURE",
            "RIGHTS_RESTRICTED",
          ]),
        );
        expect(
          CAPA_KNOWLEDGE_RETRIEVAL_REASON_CODES,
        ).not.toContain(
          "USE_MODEL_MEMORY",
        );
      },
    );

    it(
      "permits only approved retrieval methods",
      () => {
        expect(
          CAPA_KNOWLEDGE_RETRIEVAL_METHODS,
        ).toEqual([
          "lexical",
          "vector",
          "structured",
          "hybrid",
        ]);
        expect(
          CAPA_KNOWLEDGE_RETRIEVAL_METHODS,
        ).not.toContain(
          "open_web",
        );
      },
    );

    it(
      "preserves conflicts and limitations as citation relationships",
      () => {
        expect(
          CAPA_KNOWLEDGE_CITATION_RELATIONSHIPS,
        ).toEqual([
          "supports",
          "contradicts",
          "defines",
          "contextualizes",
          "limits",
          "alternative",
        ]);
      },
    );

    it(
      "defines controlled citation validation states",
      () => {
        expect(
          CAPA_KNOWLEDGE_CITATION_VALIDATION_STATUSES,
        ).toEqual([
          "valid",
          "invalid",
          "unresolved",
          "inaccessible",
          "superseded_impact",
          "rights_restricted",
        ]);
      },
    );

    it(
      "records exclusion instead of disclosing ineligible candidates",
      () => {
        expect(
          CAPA_KNOWLEDGE_CANDIDATE_EXCLUSION_REASONS,
        ).toEqual(
          expect.arrayContaining([
            "TENANT_SCOPE_MISMATCH",
            "ROLE_ACCESS_DENIED",
            "SOURCE_STATUS_INELIGIBLE",
            "COLLECTION_VERSION_MISMATCH",
            "DUPLICATE_SOURCE_PASSAGE",
            "LOCATOR_VALIDATION_FAILED",
          ]),
        );
      },
    );

    it(
      "requires an exact collection version and bounded policy",
      () => {
        const request = {
          scope: {
            collection_version_id:
              "collection-version-001",
          },
          policy: {
            maximum_candidates: 40,
            maximum_results: 8,
            maximum_total_characters:
              24_000,
          },
        } as unknown as
          CapaKnowledgeRetrievalRequest;

        expect(request.scope)
          .toHaveProperty(
            "collection_version_id",
            "collection-version-001",
          );
        expect(request.scope)
          .not.toHaveProperty(
            "latest_collection",
          );
        expect(request.policy)
          .toMatchObject({
            maximum_candidates: 40,
            maximum_results: 8,
            maximum_total_characters:
              24_000,
          });
      },
    );

    it(
      "keeps evidence attributable to exact source and passage versions",
      () => {
        const evidencePackage = {
          outcome: "complete",
          passages: [{
            source_id: "source-001",
            source_version_id:
              "source-version-003",
            passage_id: "passage-009",
            segmentation_version:
              "segmenter-1.0.0",
            locators: [{
              kind: "section",
              label: "§ 8.5.2",
            }],
          }],
        } as unknown as
          CapaKnowledgeEvidencePackage;

        expect(
          evidencePackage.passages[0],
        ).toMatchObject({
          source_id: "source-001",
          source_version_id:
            "source-version-003",
          passage_id: "passage-009",
          segmentation_version:
            "segmenter-1.0.0",
        });
      },
    );

    it(
      "binds each citation to one claim and retrieval run",
      () => {
        const citation = {
          citation_id: "citation-001",
          claim_id: "claim-004",
          retrieval_run_id:
            "retrieval-run-007",
          source_version_id:
            "source-version-003",
          passage_id: "passage-009",
          relationship: "supports",
          validation_status: "valid",
        } as unknown as
          CapaKnowledgeCitationRecord;

        expect(citation).toMatchObject({
          claim_id: "claim-004",
          retrieval_run_id:
            "retrieval-run-007",
          relationship: "supports",
          validation_status: "valid",
        });
        expect(citation)
          .not.toHaveProperty(
            "whole_document_only",
          );
      },
    );

    it.each([
      ["complete", true],
      ["partial", true],
      ["no_result", false],
      ["failure", false],
    ] as const)(
      "classifies retrieval outcome %s as usable=%s",
      (outcome, usable) => {
        expect(
          isCapaKnowledgeRetrievalUsable(
            outcome,
          ),
        ).toBe(usable);
      },
    );
  },
);
