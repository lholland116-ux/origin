import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  normalizeCapaKnowledgeText,
} from "../../lib/capa/knowledge/capa-knowledge-processing";

import {
  CAPA_KNOWLEDGE_SEGMENTATION_VERSION,
  CapaKnowledgeSegmentationError,
  segmentCapaKnowledgeText,
} from "../../lib/capa/knowledge/capa-knowledge-segmentation";

const SOURCE_VERSION_ID =
  "source-version-001";

describe(
  "controlled CAPA knowledge segmentation",
  () => {
    it(
      "returns one exact passage for bounded content",
      () => {
        const normalized =
          normalizeCapaKnowledgeText(
            "Section 1\nDo NOT exceed 5 mg.",
          );
        const result = segmentCapaKnowledgeText(
          SOURCE_VERSION_ID,
          normalized,
        );

        expect(result).toMatchObject({
          source_version_id:
            SOURCE_VERSION_ID,
          segmentation_version:
            CAPA_KNOWLEDGE_SEGMENTATION_VERSION,
          normalized_text_fingerprint:
            normalized.fingerprint.digest_hex,
          passage_count: 1,
          character_count:
            normalized.text.length,
          passages: [{
            sequence_number: 1,
            locator:
              "char:0000000000-0000000029",
            start_character_offset: 0,
            end_character_offset: 29,
            character_length: 29,
            text: normalized.text,
            fingerprint: {
              algorithm: "sha256",
            },
          }],
        });
        expect(result.passages[0]
          ?.fingerprint.digest_hex)
          .toMatch(/^[a-f0-9]{64}$/);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.passages))
          .toBe(true);
        expect(Object.isFrozen(
          result.passages[0],
        )).toBe(true);
      },
    );

    it(
      "prefers a newline boundary and reconstructs exact text",
      () => {
        const normalized =
          normalizeCapaKnowledgeText(
            "Alpha line\nBeta line\nGamma line",
          );
        const result = segmentCapaKnowledgeText(
          SOURCE_VERSION_ID,
          normalized,
          {
            minimum_characters: 6,
            maximum_characters: 15,
          },
        );

        expect(result.passages.map(
          (passage) => passage.text,
        )).toEqual([
          "Alpha line\n",
          "Beta line\n",
          "Gamma line",
        ]);
        expect(result.passages.map(
          (passage) => passage.locator,
        )).toEqual([
          "char:0000000000-0000000011",
          "char:0000000011-0000000021",
          "char:0000000021-0000000031",
        ]);
        expect(result.passages.map(
          (passage) => passage.text,
        ).join(""))
          .toBe(normalized.text);
      },
    );

    it(
      "prefers whitespace when no newline is available",
      () => {
        const normalized =
          normalizeCapaKnowledgeText(
            "alpha beta gamma delta",
          );
        const result = segmentCapaKnowledgeText(
          SOURCE_VERSION_ID,
          normalized,
          {
            minimum_characters: 5,
            maximum_characters: 12,
          },
        );

        expect(result.passages[0]?.text)
          .toBe("alpha beta ");
        expect(result.passages.map(
          (passage) => passage.text,
        ).join(""))
          .toBe(normalized.text);
      },
    );

    it(
      "uses the maximum boundary for an unbroken token",
      () => {
        const normalized =
          normalizeCapaKnowledgeText(
            "abcdefghijklmnop",
          );
        const result = segmentCapaKnowledgeText(
          SOURCE_VERSION_ID,
          normalized,
          {
            minimum_characters: 4,
            maximum_characters: 8,
          },
        );

        expect(result.passages.map(
          (passage) => passage.text,
        )).toEqual([
          "abcdefgh",
          "ijklmnop",
        ]);
      },
    );

    it(
      "produces stable identity for an exact retry",
      () => {
        const normalized =
          normalizeCapaKnowledgeText(
            "Controlled source text",
          );
        const first = segmentCapaKnowledgeText(
          SOURCE_VERSION_ID,
          normalized,
          {
            segmentation_version:
              "segmenter-2.1.0",
            minimum_characters: 5,
            maximum_characters: 10,
          },
        );
        const retry = segmentCapaKnowledgeText(
          SOURCE_VERSION_ID,
          normalized,
          {
            segmentation_version:
              "segmenter-2.1.0",
            minimum_characters: 5,
            maximum_characters: 10,
          },
        );

        expect(retry).toEqual(first);
      },
    );

    it.each([
      undefined,
      null,
      "",
      "bad source id",
      "x".repeat(257),
    ])(
      "rejects invalid source version id %p",
      (value) => {
        expect(() =>
          segmentCapaKnowledgeText(
            value,
            normalizeCapaKnowledgeText("text"),
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_SOURCE_VERSION_ID",
          }),
        );
      },
    );

    it.each([
      undefined,
      null,
      "text",
      {},
      {
        text: "text",
        character_length: 3,
        fingerprint: {
          algorithm: "sha256",
          digest_hex: "a".repeat(64),
        },
      },
      {
        text: "text",
        character_length: 4,
        fingerprint: {
          algorithm: "md5",
          digest_hex: "a".repeat(64),
        },
      },
      {
        text: "text",
        character_length: 4,
        fingerprint: {
          algorithm: "sha256",
          digest_hex: "invalid",
        },
      },
    ])(
      "rejects malformed normalized text %#",
      (value) => {
        expect(() =>
          segmentCapaKnowledgeText(
            SOURCE_VERSION_ID,
            value,
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_NORMALIZED_TEXT",
          }),
        );
      },
    );

    it.each([
      { segmentation_version: "" },
      { segmentation_version: "latest version" },
      { maximum_characters: 0 },
      { maximum_characters: 1.5 },
      { minimum_characters: -1 },
      {
        minimum_characters: 11,
        maximum_characters: 10,
      },
    ])(
      "rejects unsafe segmentation configuration %#",
      (configuration) => {
        expect(() =>
          segmentCapaKnowledgeText(
            SOURCE_VERSION_ID,
            normalizeCapaKnowledgeText("text"),
            configuration,
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_SEGMENTATION_CONFIGURATION",
          }),
        );
      },
    );

    it(
      "fails closed if post-segmentation integrity is violated",
      () => {
        const normalized =
          normalizeCapaKnowledgeText("abcdef");
        const slice = vi.spyOn(
          String.prototype,
          "slice",
        ).mockReturnValueOnce("forged");

        try {
          expect(() =>
            segmentCapaKnowledgeText(
              SOURCE_VERSION_ID,
              normalized,
              {
                minimum_characters: 3,
                maximum_characters: 3,
              },
            ),
          ).toThrowError(
            expect.objectContaining({
              reason_code:
                "SEGMENTATION_INTEGRITY_FAILURE",
            }),
          );
        } finally {
          slice.mockRestore();
        }
      },
    );

    it(
      "provides a stable controlled error",
      () => {
        const error =
          new CapaKnowledgeSegmentationError(
            "INVALID_NORMALIZED_TEXT",
          );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeSegmentationError",
        );
        expect(error.message).toBe(
          "INVALID_NORMALIZED_TEXT",
        );
      },
    );
  },
);
