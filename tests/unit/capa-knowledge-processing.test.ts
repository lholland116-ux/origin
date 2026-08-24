import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHM,
  CAPA_KNOWLEDGE_PROCESSING_VERSION,
  CapaKnowledgeProcessingError,
  fingerprintCapaKnowledgeArtifact,
  normalizeCapaKnowledgeText,
} from "../../lib/capa/knowledge/capa-knowledge-processing";

describe(
  "controlled CAPA knowledge processing",
  () => {
    it(
      "fingerprints exact original bytes deterministically",
      () => {
        const first =
          fingerprintCapaKnowledgeArtifact(
            new TextEncoder().encode("abc"),
          );
        const retry =
          fingerprintCapaKnowledgeArtifact(
            new TextEncoder().encode("abc"),
          );

        expect(first).toEqual({
          algorithm:
            CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHM,
          digest_hex:
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          subject: "original_artifact",
          byte_length: 3,
        });
        expect(retry).toEqual(first);
        expect(Object.isFrozen(first)).toBe(true);
      },
    );

    it(
      "keeps byte-distinct artifacts distinct",
      () => {
        const crlf =
          fingerprintCapaKnowledgeArtifact(
            new TextEncoder().encode("A\r\nB"),
          );
        const lf =
          fingerprintCapaKnowledgeArtifact(
            new TextEncoder().encode("A\nB"),
          );

        expect(crlf.digest_hex)
          .not.toBe(lf.digest_hex);
      },
    );

    it.each([
      undefined,
      null,
      "not bytes",
      {},
    ])(
      "rejects invalid original artifact %p",
      (value) => {
        expect(() =>
          fingerprintCapaKnowledgeArtifact(value),
        ).toThrowError(
          expect.objectContaining({
            name:
              "CapaKnowledgeProcessingError",
            reason_code:
              "INVALID_ORIGINAL_ARTIFACT",
          }),
        );
      },
    );

    it(
      "rejects empty and oversized artifacts",
      () => {
        expect(() =>
          fingerprintCapaKnowledgeArtifact(
            new Uint8Array(),
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "ORIGINAL_ARTIFACT_EMPTY",
          }),
        );

        expect(() =>
          fingerprintCapaKnowledgeArtifact(
            new Uint8Array([1, 2]),
            { maximum_original_bytes: 1 },
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "ORIGINAL_ARTIFACT_TOO_LARGE",
          }),
        );
      },
    );

    it(
      "normalizes representation without rewriting meaning",
      () => {
        const result = normalizeCapaKnowledgeText(
          "\uFEFF\r\n  1. Do NOT exceed 5 mg.  \r\n\r\nNCR-004\t\r\n",
        );

        expect(result).toMatchObject({
          processing_version:
            CAPA_KNOWLEDGE_PROCESSING_VERSION,
          text:
            "  1. Do NOT exceed 5 mg.\n\nNCR-004",
          character_length: 33,
          utf8_byte_length: 33,
          fingerprint: {
            algorithm: "sha256",
            subject: "normalized_text",
          },
        });
        expect(result.fingerprint.digest_hex)
          .toMatch(/^[a-f0-9]{64}$/);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.fingerprint))
          .toBe(true);
      },
    );

    it(
      "normalizes canonically equivalent Unicode",
      () => {
        const decomposed =
          normalizeCapaKnowledgeText("Cafe\u0301");
        const composed =
          normalizeCapaKnowledgeText("Caf\u00e9");

        expect(decomposed.text).toBe("Caf\u00e9");
        expect(decomposed.fingerprint)
          .toEqual(composed.fingerprint);
        expect(decomposed.character_length).toBe(4);
        expect(decomposed.utf8_byte_length).toBe(5);
      },
    );

    it.each([
      undefined,
      null,
      42,
      {},
    ])(
      "rejects invalid extracted text %p",
      (value) => {
        expect(() =>
          normalizeCapaKnowledgeText(value),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_EXTRACTED_TEXT",
          }),
        );
      },
    );

    it.each([
      "",
      "   \t",
      "\r\n\t\r\n",
    ])(
      "rejects empty normalized text %p",
      (value) => {
        expect(() =>
          normalizeCapaKnowledgeText(value),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "EXTRACTED_TEXT_EMPTY",
          }),
        );
      },
    );

    it(
      "rejects oversized normalized text",
      () => {
        expect(() =>
          normalizeCapaKnowledgeText(
            "abcd",
            {
              maximum_normalized_characters:
                3,
            },
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "EXTRACTED_TEXT_TOO_LARGE",
          }),
        );
      },
    );

    it.each([
      0,
      -1,
      1.5,
      Number.POSITIVE_INFINITY,
    ])(
      "rejects unsafe processing limit %p",
      (limit) => {
        expect(() =>
          normalizeCapaKnowledgeText(
            "controlled text",
            {
              maximum_normalized_characters:
                limit,
            },
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_PROCESSING_LIMIT",
          }),
        );
      },
    );

    it(
      "provides a stable named controlled error",
      () => {
        const error =
          new CapaKnowledgeProcessingError(
            "EXTRACTED_TEXT_EMPTY",
          );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeProcessingError",
        );
        expect(error.message).toBe(
          "EXTRACTED_TEXT_EMPTY",
        );
      },
    );
  },
);
