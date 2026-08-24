import { createHash } from "node:crypto";

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaKnowledgeAssembledEvidencePackage,
} from "../../lib/capa/knowledge/capa-knowledge-evidence-assembler";

import {
  CAPA_KNOWLEDGE_CITATION_VALIDATION_REASON_CODES,
  CAPA_KNOWLEDGE_CITATION_VALIDATOR_VERSION,
  CapaKnowledgeCitationValidationError,
  constructAndValidateCapaKnowledgeCitation,
} from "../../lib/capa/knowledge/capa-knowledge-citation-validator";

const RUN_ID =
  "db4e0623-3e39-4bb5-a769-178900939a30";
const EVIDENCE_ID =
  "acaf0d5b-d698-5afe-9a74-2c130ed8265c";
const CLAIM_ID =
  "064717e2-fdeb-4ccb-9503-9255c64abc32";
const QUOTE =
  "Corrective actions shall be verified for effectiveness.";

function evidencePackage(
  overrides: Record<string, unknown> = {},
): CapaKnowledgeAssembledEvidencePackage {
  return {
    evidence_assembly_version:
      "capa-knowledge-evidence-1.0.0",
    retrieval_run_id: RUN_ID,
    collection_version_id:
      "d880563f-a6f0-4cd1-a9a3-078bde6c42d4",
    outcome: "complete",
    reason_code: "RETRIEVAL_COMPLETE",
    passages: [{
      evidence_id: EVIDENCE_ID,
      source_id:
        "a2f60635-067b-4880-b9b6-b16e1f32d936",
      source_version_id:
        "82adf16f-c25c-4cca-b3a6-25d5a320733a",
      passage_id:
        "62ed4a8e-c215-4534-be9a-4a607e3c6123",
      source_type: "SRC-01",
      source_status_at_use:
        "current_effective",
      title: "Corrective Action Procedure",
      issuer: "Example Manufacturer",
      jurisdiction: "US",
      document_number: "SOP-100",
      edition: "Rev. 3",
      applicability_tags: ["CAPA"],
      segmentation_version:
        "segmenter-1.0.0",
      passage_fingerprint: {
        algorithm: "sha256",
        value: "a".repeat(64),
      },
      locators: [{
        kind: "section",
        label: "§ 7.4",
      }],
      content:
        `The procedure states: ${QUOTE}`,
      limitations: [],
      rank: 1,
      relevance_score: 0.91,
      relationship: "supports",
      related_context: [],
    }],
    candidate_trace: [],
    warnings: [],
    total_character_count:
      `The procedure states: ${QUOTE}`.length,
    completed_at:
      "2026-08-24T14:00:01.000Z",
    ...overrides,
  } as unknown as
    CapaKnowledgeAssembledEvidencePackage;
}

function assessment(
  overrides: Record<string, unknown> = {},
) {
  return {
    relationship_verified: true,
    modality_preserved: true,
    scope_preserved: true,
    negation_preserved: true,
    exceptions_preserved: true,
    source_accessible: true,
    excerpt_permitted: true,
    assessed_by: {
      actor_type: "human",
      actor_id: "quality-reviewer",
    },
    assessment_version:
      "citation-assessment-1.0.0",
    ...overrides,
  };
}

function input(
  overrides: Record<string, unknown> = {},
) {
  return {
    claim_id: CLAIM_ID,
    claim_text:
      "Corrective actions shall be verified for effectiveness.",
    evidence_id: EVIDENCE_ID,
    relationship: "supports",
    quoted_text: QUOTE,
    evidence_package: evidencePackage(),
    assessment: assessment(),
    validated_at:
      "2026-08-24T14:00:02.000Z",
    ...overrides,
  };
}

function expectReason(
  operation: () => unknown,
  reasonCode: string,
): void {
  expect(operation).toThrowError(
    expect.objectContaining({
      name:
        "CapaKnowledgeCitationValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "exact CAPA knowledge citation validation",
  () => {
    it(
      "constructs a valid claim-specific citation",
      () => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input() as never,
          );

        expect(result).toMatchObject({
          claim_text:
            "Corrective actions shall be verified for effectiveness.",
          quoted_text: QUOTE,
          citation: {
            claim_id: CLAIM_ID,
            evidence_id: EVIDENCE_ID,
            retrieval_run_id: RUN_ID,
            relationship: "supports",
            validation_status: "valid",
            validator_version:
              CAPA_KNOWLEDGE_CITATION_VALIDATOR_VERSION,
            rendered_label:
              "Corrective Action Procedure — Example Manufacturer — SOP-100 — Rev. 3; § 7.4",
          },
        });
        expect(result.citation.citation_id)
          .toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
      },
    );

    it(
      "fingerprints the exact quoted excerpt",
      () => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input() as never,
          );

        expect(
          result.citation
            .quoted_text_fingerprint,
        ).toEqual({
          algorithm: "sha256",
          value: createHash("sha256")
            .update(QUOTE, "utf8")
            .digest("hex"),
        });
      },
    );

    it(
      "produces stable citation identity for an exact retry",
      () => {
        const first =
          constructAndValidateCapaKnowledgeCitation(
            input() as never,
          );
        const retry =
          constructAndValidateCapaKnowledgeCitation(
            input() as never,
          );

        expect(retry.citation.citation_id)
          .toBe(first.citation.citation_id);
      },
    );

    it.each([
      "relationship_verified",
      "modality_preserved",
      "scope_preserved",
      "negation_preserved",
      "exceptions_preserved",
    ])(
      "invalidates a failed %s check",
      (field) => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input({
              assessment: assessment({
                [field]: false,
              }),
            }) as never,
          );

        expect(result.citation.validation_status)
          .toBe("invalid");
        expect(result.validation_findings)
          .not.toHaveLength(0);
      },
    );

    it(
      "keeps an incomplete assessment unresolved",
      () => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input({
              assessment: assessment({
                relationship_verified: null,
              }),
            }) as never,
          );

        expect(result.citation.validation_status)
          .toBe("unresolved");
      },
    );

    it(
      "prevents excerpt rendering when rights restrict it",
      () => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input({
              assessment: assessment({
                excerpt_permitted: false,
              }),
            }) as never,
          );

        expect(result.citation.validation_status)
          .toBe("rights_restricted");
        expect(result).not.toHaveProperty(
          "quoted_text",
        );
      },
    );

    it(
      "prevents excerpt rendering when source access is revoked",
      () => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input({
              assessment: assessment({
                source_accessible: false,
              }),
            }) as never,
          );

        expect(result.citation.validation_status)
          .toBe("inaccessible");
        expect(result).not.toHaveProperty(
          "quoted_text",
        );
      },
    );

    it.each([
      "superseded",
      "withdrawn",
    ] as const)(
      "flags %s source impact visibly",
      (status) => {
        const original = evidencePackage();
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input({
              evidence_package:
                evidencePackage({
                  passages: [{
                    ...original.passages[0],
                    source_status_at_use:
                      status,
                  }],
                }),
            }) as never,
          );

        expect(result.citation.validation_status)
          .toBe("superseded_impact");
        expect(result.citation.rendered_label)
          .toContain(`[${status}]`);
      },
    );

    it.each([
      ["claim_id", "invalid", "INVALID_CLAIM"],
      ["claim_text", "", "INVALID_CLAIM"],
      ["evidence_id", "invalid", "INVALID_CITATION_INPUT"],
      ["relationship", "agrees", "INVALID_CITATION_INPUT"],
    ])(
      "rejects invalid input %s=%p",
      (field, value, reason) => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                [field]: value,
              }) as never,
            ),
          reason,
        );
      },
    );

    it(
      "rejects missing evidence and relationship mismatch",
      () => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                evidence_id:
                  "34d50456-f2ab-4a9c-96fc-544e05258b2e",
              }) as never,
            ),
          "EVIDENCE_NOT_FOUND",
        );
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                relationship: "contradicts",
              }) as never,
            ),
          "RELATIONSHIP_MISMATCH",
        );
      },
    );

    it.each([
      "",
      "Corrective actions may be verified",
      "x".repeat(4_001),
    ])(
      "rejects non-exact quoted text %#",
      (quotedText) => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                quoted_text: quotedText,
              }) as never,
            ),
          "QUOTED_TEXT_NOT_EXACT",
        );
      },
    );

    it(
      "rejects malformed assessment and timestamp",
      () => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                assessment: assessment({
                  modality_preserved:
                    "yes",
                }),
              }) as never,
            ),
          "INVALID_ASSESSMENT",
        );
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                validated_at:
                  "2026-08-24T14:00:00.000Z",
              }) as never,
            ),
          "INVALID_VALIDATION_TIMESTAMP",
        );
      },
    );

    it(
      "freezes citation fingerprint and findings",
      () => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input() as never,
          );

        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.citation))
          .toBe(true);
        expect(Object.isFrozen(
          result.citation.quoted_text_fingerprint,
        )).toBe(true);
        expect(Object.isFrozen(
          result.validation_findings,
        )).toBe(true);
      },
    );

    it(
      "provides stable reason codes and error identity",
      () => {
        expect(
          CAPA_KNOWLEDGE_CITATION_VALIDATION_REASON_CODES,
        ).toContain(
          "QUOTED_TEXT_NOT_EXACT",
        );
        const error =
          new CapaKnowledgeCitationValidationError(
            "INVALID_CLAIM",
          );
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeCitationValidationError",
        );
      },
    );


    it.each([
      null,
      "citation",
    ])(
      "rejects non-record citation input %p",
      (value) => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              value as never,
            ),
          "INVALID_CITATION_INPUT",
        );
      },
    );

    it.each([
      null,
      [],
      "actor",
    ])(
      "rejects invalid assessment actor %p",
      (assessedBy) => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                assessment: assessment({
                  assessed_by: assessedBy,
                }),
              }) as never,
            ),
          "INVALID_ASSESSMENT",
        );
      },
    );

    it.each([
      null,
      "assessment",
    ])(
      "rejects non-record assessment %p",
      (value) => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({ assessment: value }) as never,
            ),
          "INVALID_ASSESSMENT",
        );
      },
    );

    it.each([
      null,
      "package",
      { passages: [], completed_at: "invalid" },
      {
        passages: "invalid",
        completed_at:
          "2026-08-24T14:00:01.000Z",
      },
    ])(
      "rejects malformed evidence package %#",
      (evidence) => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                evidence_package: evidence,
              }) as never,
            ),
          "INVALID_CITATION_INPUT",
        );
      },
    );

    it.each([
      { content: 1 },
      { locators: null },
      { locators: [] },
    ])(
      "rejects malformed selected evidence %#",
      (passageOverride) => {
        const original = evidencePackage();
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                evidence_package:
                  evidencePackage({
                    passages: [{
                      ...original.passages[0],
                      ...passageOverride,
                    }],
                  }),
              }) as never,
            ),
          "INVALID_CITATION_INPUT",
        );
      },
    );

    it(
      "rejects an oversized claim",
      () => {
        expectReason(
          () =>
            constructAndValidateCapaKnowledgeCitation(
              input({
                claim_text: "x".repeat(8_001),
              }) as never,
            ),
          "INVALID_CLAIM",
        );
      },
    );


    it.each([
      "service",
      "agent",
      "system",
    ] as const)(
      "accepts controlled assessment actor type %s",
      (actorType) => {
        const result =
          constructAndValidateCapaKnowledgeCitation(
            input({
              assessment: assessment({
                assessed_by: {
                  actor_type: actorType,
                  actor_id: actorType + "-001",
                  actor_version: "actor-1.0.0",
                },
              }),
            }) as never,
          );

        expect(result.citation.validated_by.actor_type)
          .toBe(actorType);
      },
    );
  },
);
