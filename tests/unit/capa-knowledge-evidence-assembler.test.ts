import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaKnowledgeRetrievalCandidate,
  CapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeContextSelectionResult,
} from "../../lib/capa/knowledge/capa-knowledge-context-selection";

import {
  CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_REASON_CODES,
  CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_VERSION,
  CapaKnowledgeEvidenceAssemblyError,
  assembleCapaKnowledgeEvidencePackage,
} from "../../lib/capa/knowledge/capa-knowledge-evidence-assembler";

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

function request():
  CapaKnowledgeRetrievalRequest {
  return {
    retrieval_run_id: RUN_ID,
    query_id:
      "075863fe-938f-454e-b5a5-3e053e925075",
    request_trace: {
      request_id: "request-1",
      correlation_id: "correlation-1",
    },
    scope: {
      organization_id:
        "9cf8ea71-39d6-43c6-b9df-7ae9ae32652a",
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
    query_text: "effectiveness evidence",
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

function selection(
  overrides:
    Partial<CapaKnowledgeContextSelectionResult> = {},
): CapaKnowledgeContextSelectionResult {
  const candidate = {
    candidate_id:
      "ef213413-0557-4ecf-98a7-b37c64085645",
    source_id: SOURCE_ID,
    source_version_id: SOURCE_VERSION_ID,
    passage_id: PASSAGE_ID,
    source_type: "SRC-01",
    source_status: "current_effective",
    quality_status: "pass",
    raw_rank: 1,
    lexical_score: 0.9,
    semantic_score: 0.9,
    final_score: 0.9,
  } as unknown as
    CapaKnowledgeRetrievalCandidate;
  const primary = {
    passage_id: PASSAGE_ID,
    source_version_id: SOURCE_VERSION_ID,
    segmentation_version: "segmenter-1.0.0",
    content:
      "Corrective actions shall be verified for effectiveness.",
    locators: [{
      kind: "section",
      label: "§ 7.4",
    }],
    fingerprint: {
      algorithm: "sha256",
      value: "b".repeat(64),
    },
  };
  const context = {
    passage_id:
      "73805627-e288-4930-8373-6406a9ec1da7",
    source_version_id: SOURCE_VERSION_ID,
    segmentation_version: "segmenter-1.0.0",
    content: "Effectiveness means the action achieved its intended result.",
    locators: [{
      kind: "section",
      label: "Definitions",
    }],
    fingerprint: {
      algorithm: "sha256",
      value: "c".repeat(64),
    },
  };

  return {
    selected: [{
      candidate,
      relationship: "supports",
      collection: {
        collection_id: COLLECTION_ID,
        collection_version_id:
          COLLECTION_VERSION_ID,
      },
      source: {
        source_id: SOURCE_ID,
      },
      source_version: {
        source_version_id:
          SOURCE_VERSION_ID,
        source_id: SOURCE_ID,
        source_type: "SRC-01",
        status: "current_effective",
        title: "Corrective Action Procedure",
        issuer: "Example Manufacturer",
        jurisdiction: "US",
        applicability_tags: ["CAPA"],
        processing_status: "pass",
        quality_status: "pass",
        quality_notes: [],
        translation_status: "original",
      },
      primary_passage: primary,
      related_context: [{
        role: "definition",
        required: true,
        passage: context,
      }],
    }],
    candidate_trace: [{
      candidate,
      disposition: {
        disposition: "included",
        final_rank: 1,
      },
    }],
    total_character_count:
      primary.content.length +
      context.content.length,
    ...overrides,
  } as unknown as
    CapaKnowledgeContextSelectionResult;
}

function assemble(
  overrides: Record<string, unknown> = {},
) {
  return assembleCapaKnowledgeEvidencePackage({
    request: request(),
    selection: selection(),
    upstream_status: "complete",
    warnings: [],
    completed_at:
      "2026-08-24T14:00:01.000Z",
    ...overrides,
  } as never);
}

function expectReason(
  operation: () => unknown,
  reasonCode: string,
): void {
  expect(operation).toThrowError(
    expect.objectContaining({
      name:
        "CapaKnowledgeEvidenceAssemblyError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "governed CAPA evidence package assembly",
  () => {
    it(
      "assembles exact attributable evidence and context",
      () => {
        const result = assemble();

        expect(result).toMatchObject({
          evidence_assembly_version:
            CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_VERSION,
          retrieval_run_id: RUN_ID,
          collection_version_id:
            COLLECTION_VERSION_ID,
          outcome: "complete",
          reason_code: "RETRIEVAL_COMPLETE",
          passages: [{
            source_id: SOURCE_ID,
            source_version_id:
              SOURCE_VERSION_ID,
            passage_id: PASSAGE_ID,
            source_status_at_use:
              "current_effective",
            title:
              "Corrective Action Procedure",
            issuer: "Example Manufacturer",
            jurisdiction: "US",
            rank: 1,
            relevance_score: 0.9,
            relationship: "supports",
            related_context: [{
              role: "definition",
              required: true,
            }],
          }],
        });
        expect(result.passages[0]
          ?.evidence_id)
          .toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
      },
    );

    it(
      "produces stable evidence identity for an exact retry",
      () => {
        expect(
          assemble().passages[0]?.evidence_id,
        ).toBe(
          assemble().passages[0]?.evidence_id,
        );
      },
    );

    it(
      "returns an explicit no-result limitation without claiming no requirement exists",
      () => {
        const empty = selection({
          selected: [],
          total_character_count: 0,
        });
        const result = assemble({
          selection: empty,
        });

        expect(result).toMatchObject({
          outcome: "no_result",
          reason_code: "NO_ELIGIBLE_RESULT",
          passages: [],
        });
        expect(result.warnings.join(" "))
          .toContain(
            "does not establish that no requirement or evidence exists",
          );
      },
    );

    it.each([
      "PARTIAL_INDEX",
      "RETRIEVAL_TIMEOUT",
      "RETRIEVAL_PROVIDER_FAILURE",
    ] as const)(
      "preserves controlled partial outcome %s",
      (partialReason) => {
        const result = assemble({
          upstream_status: "partial",
          partial_reason: partialReason,
          warnings: ["Approved fallback returned partial evidence."],
        });

        expect(result.outcome).toBe("partial");
        expect(result.reason_code)
          .toBe(partialReason);
      },
    );

    it(
      "adds visible status processing quality and translation limitations",
      () => {
        const original = selection();
        const selected = original.selected[0]!;
        const limited = selection({
          selected: [{
            ...selected,
            source_version: {
              ...selected.source_version,
              status: "superseded",
              processing_status:
                "pass_with_limitations",
              quality_status:
                "pass_with_limitations",
              translation_status:
                "unverified_translation",
              quality_notes: ["Poor OCR on page 3."],
            },
          }] as never,
        });
        const result = assemble({
          selection: limited,
        });

        expect(result.passages[0]
          ?.limitations).toEqual(
            expect.arrayContaining([
              "Poor OCR on page 3.",
              "Source status at retrieval: superseded.",
              "Source processing passed with limitations.",
              "Source quality passed with limitations.",
              "Translation status: unverified_translation.",
            ]),
          );
      },
    );

    it.each([
      ["completed_at", "now", "INVALID_COMPLETION_TIMESTAMP"],
      ["completed_at", "2026-08-24T13:59:59.000Z", "INVALID_COMPLETION_TIMESTAMP"],
      ["upstream_status", "failed", "INVALID_EVIDENCE_INPUT"],
    ])(
      "rejects invalid assembly input %s=%p",
      (field, value, reason) => {
        expectReason(
          () => assemble({
            [field]: value,
          }),
          reason,
        );
      },
    );

    it(
      "requires partial reason only for a partial result",
      () => {
        expectReason(
          () => assemble({
            upstream_status: "partial",
          }),
          "INVALID_PARTIAL_REASON",
        );
        expectReason(
          () => assemble({
            partial_reason: "PARTIAL_INDEX",
          }),
          "INVALID_PARTIAL_REASON",
        );
      },
    );

    it(
      "rejects forged selection counts and bounds",
      () => {
        expectReason(
          () => assemble({
            selection: selection({
              total_character_count: 1,
            }),
          }),
          "SELECTION_RESULT_MISMATCH",
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
          () => assemble({
            request: tiny,
          }),
          "EVIDENCE_LIMIT_EXCEEDED",
        );
      },
    );

    it.each([
      { title: "" },
      { issuer: "" },
      { jurisdiction: "" },
    ])(
      "rejects incomplete source attribution %#",
      (versionOverride) => {
        const original = selection();
        const selected = original.selected[0]!;

        expectReason(
          () => assemble({
            selection: selection({
              selected: [{
                ...selected,
                source_version: {
                  ...selected.source_version,
                  ...versionOverride,
                },
              }] as never,
            }),
          }),
          "INVALID_SELECTED_EVIDENCE",
        );
      },
    );

    it(
      "freezes package passages context locators and warnings",
      () => {
        const result = assemble();

        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.passages))
          .toBe(true);
        expect(Object.isFrozen(result.passages[0]))
          .toBe(true);
        expect(Object.isFrozen(
          result.passages[0]?.related_context,
        )).toBe(true);
        expect(Object.isFrozen(result.warnings))
          .toBe(true);
      },
    );

    it(
      "provides stable assembly reason codes and error identity",
      () => {
        expect(
          CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_REASON_CODES,
        ).toContain(
          "EVIDENCE_LIMIT_EXCEEDED",
        );
        const error =
          new CapaKnowledgeEvidenceAssemblyError(
            "INVALID_EVIDENCE_INPUT",
          );
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeEvidenceAssemblyError",
        );
      },
    );


    it.each([
      null,
      "evidence",
    ])(
      "rejects non-record evidence input %p",
      (value) => {
        expectReason(
          () =>
            assembleCapaKnowledgeEvidencePackage(
              value as never,
            ),
          "INVALID_EVIDENCE_INPUT",
        );
      },
    );

    it.each([
      null,
      [""],
      Array.from({ length: 101 }, () => "warning"),
    ])(
      "rejects malformed warnings %#",
      (warnings) => {
        expectReason(
          () => assemble({ warnings }),
          "INVALID_EVIDENCE_INPUT",
        );
      },
    );

    it.each([
      null,
      "selection",
      {
        selected: [],
        candidate_trace: [],
        total_character_count: -1,
      },
      {
        selected: "invalid",
        candidate_trace: [],
        total_character_count: 0,
      },
    ])(
      "rejects malformed selection %#",
      (value) => {
        expectReason(
          () => assemble({ selection: value }),
          "INVALID_EVIDENCE_INPUT",
        );
      },
    );

    it(
      "rejects duplicate deterministic evidence identity",
      () => {
        const original = selection();
        const selected = original.selected[0]!;
        expectReason(
          () => assemble({
            selection: selection({
              selected: [selected, selected],
              total_character_count:
                original.total_character_count * 2,
            }),
          }),
          "DUPLICATE_EVIDENCE_ID",
        );
      },
    );


    it(
      "preserves optional edition and document-number attribution",
      () => {
        const original = selection();
        const selected = original.selected[0]!;
        const result = assemble({
          selection: selection({
            selected: [{
              ...selected,
              source_version: {
                ...selected.source_version,
                edition: "Revision 7",
                document_number: "SOP-QA-007",
              },
            }] as never,
          }),
        });

        expect(result.passages[0]).toMatchObject({
          edition: "Revision 7",
          document_number: "SOP-QA-007",
        });
      },
    );
  },
);
