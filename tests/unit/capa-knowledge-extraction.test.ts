import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CAPA_KNOWLEDGE_EXTRACTION_VERSION,
  CapaKnowledgeExtractionError,
  CapaKnowledgeExtractionService,
  createCapaPlainTextExtractor,
  type CapaKnowledgeExtractionRequest,
  type CapaKnowledgeExtractor,
} from "../../lib/capa/knowledge/capa-knowledge-extraction";

function textRequest(
  overrides: Partial<
    CapaKnowledgeExtractionRequest
  > = {},
): CapaKnowledgeExtractionRequest {
  return {
    artifact_bytes:
      new TextEncoder().encode(
        "Controlled CAPA source",
      ),
    declared_media_type: "text/plain",
    detected_media_type: "text/plain",
    extractor_id: "CAPA-TXT",
    extractor_version: "plain-text-1.0.0",
    ...overrides,
  };
}

function adapter(
  overrides: Partial<CapaKnowledgeExtractor> = {},
): CapaKnowledgeExtractor {
  return {
    extractor_id: "CAPA-PDF",
    extractor_version: "pdf-parser-1.0.0",
    media_type: "application/pdf",
    async extract() {
      return {
        extractor_id: "CAPA-PDF",
        extractor_version:
          "pdf-parser-1.0.0",
        units: [
          {
            sequence_number: 1,
            locator: "page:1",
            text: "Page one",
          },
          {
            sequence_number: 2,
            locator: "page:2",
            text: "Page two",
          },
        ],
        warnings: ["OCR_NOT_REQUIRED"],
      };
    },
    ...overrides,
  };
}

describe(
  "controlled CAPA knowledge extraction",
  () => {
    it(
      "extracts strict UTF-8 text through an approved exact version",
      async () => {
        const service =
          new CapaKnowledgeExtractionService([
            createCapaPlainTextExtractor(),
          ]);
        const result = await service.extract(
          textRequest(),
        );

        expect(result).toEqual({
          extraction_version:
            CAPA_KNOWLEDGE_EXTRACTION_VERSION,
          media_type: "text/plain",
          extractor_id: "CAPA-TXT",
          extractor_version:
            "plain-text-1.0.0",
          units: [{
            sequence_number: 1,
            locator: "text:body",
            text: "Controlled CAPA source",
          }],
          combined_text:
            "Controlled CAPA source",
          warnings: [],
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.units))
          .toBe(true);
        expect(Object.isFrozen(result.units[0]))
          .toBe(true);
        expect(Object.isFrozen(result.warnings))
          .toBe(true);
      },
    );

    it(
      "preserves ordered structured units from an injected adapter",
      async () => {
        const extractor = adapter();
        const service =
          new CapaKnowledgeExtractionService([
            extractor,
          ]);
        const result = await service.extract({
          artifact_bytes:
            new Uint8Array([0x25, 0x50]),
          declared_media_type:
            "application/pdf",
          detected_media_type:
            "application/pdf",
          extractor_id: "CAPA-PDF",
          extractor_version:
            "pdf-parser-1.0.0",
        });

        expect(result.units.map(
          (unit) => unit.locator,
        )).toEqual(["page:1", "page:2"]);
        expect(result.combined_text)
          .toBe("Page one\nPage two");
        expect(result.warnings)
          .toEqual(["OCR_NOT_REQUIRED"]);
      },
    );

    it.each([
      undefined,
      null,
      {},
      textRequest({
        artifact_bytes: new Uint8Array(),
      }),
      textRequest({ extractor_id: "bad id" }),
      textRequest({ extractor_version: "" }),
    ])(
      "rejects malformed request %#",
      async (request) => {
        const service =
          new CapaKnowledgeExtractionService([
            createCapaPlainTextExtractor(),
          ]);

        await expect(service.extract(request))
          .rejects.toMatchObject({
            reason_code:
              "INVALID_EXTRACTION_REQUEST",
          });
      },
    );

    it(
      "rejects unsupported media types",
      async () => {
        const service =
          new CapaKnowledgeExtractionService([]);

        await expect(service.extract(
          textRequest({
            declared_media_type: "image/png",
            detected_media_type: "image/png",
          }),
        )).rejects.toMatchObject({
          reason_code: "UNSUPPORTED_MEDIA_TYPE",
        });
      },
    );

    it(
      "rejects a declared and detected type mismatch before parsing",
      async () => {
        const extract = vi.fn();
        const service =
          new CapaKnowledgeExtractionService([
            adapter({ extract }),
          ]);

        await expect(service.extract({
          artifact_bytes: new Uint8Array([1]),
          declared_media_type: "text/plain",
          detected_media_type:
            "application/pdf",
          extractor_id: "CAPA-PDF",
          extractor_version:
            "pdf-parser-1.0.0",
        })).rejects.toMatchObject({
          reason_code:
            "DECLARED_MEDIA_TYPE_MISMATCH",
        });
        expect(extract).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an extractor that is not exactly approved",
      async () => {
        const service =
          new CapaKnowledgeExtractionService([
            createCapaPlainTextExtractor(),
          ]);

        await expect(service.extract(
          textRequest({
            extractor_version:
              "plain-text-2.0.0",
          }),
        )).rejects.toMatchObject({
          reason_code:
            "EXTRACTOR_NOT_APPROVED",
        });
      },
    );

    it.each([
      adapter({ media_type: "image/png" as never }),
      adapter({ extractor_id: "bad id" }),
      adapter({ extractor_version: "" }),
      adapter(),
    ])(
      "rejects invalid or duplicate registry entry %#",
      (extractor) => {
        const entries =
          extractor === undefined
            ? []
            : extractor.extractor_id ===
                "CAPA-PDF" &&
              extractor.media_type ===
                "application/pdf" &&
              extractor.extractor_version ===
                "pdf-parser-1.0.0"
              ? [extractor, extractor]
              : [extractor];

        expect(() =>
          new CapaKnowledgeExtractionService(
            entries,
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_EXTRACTION_REQUEST",
          }),
        );
      },
    );

    it(
      "converts an unexpected adapter failure to a controlled error",
      async () => {
        const service =
          new CapaKnowledgeExtractionService([
            adapter({
              async extract() {
                throw new Error("parser details");
              },
            }),
          ]);

        await expect(service.extract({
          artifact_bytes: new Uint8Array([1]),
          declared_media_type: "application/pdf",
          detected_media_type: "application/pdf",
          extractor_id: "CAPA-PDF",
          extractor_version:
            "pdf-parser-1.0.0",
        })).rejects.toMatchObject({
          reason_code: "EXTRACTION_FAILED",
        });
      },
    );

    it(
      "preserves a controlled adapter failure",
      async () => {
        const controlled =
          new CapaKnowledgeExtractionError(
            "EXTRACTION_FAILED",
          );
        const service =
          new CapaKnowledgeExtractionService([
            adapter({
              async extract() {
                throw controlled;
              },
            }),
          ]);

        await expect(service.extract({
          artifact_bytes: new Uint8Array([1]),
          declared_media_type: "application/pdf",
          detected_media_type: "application/pdf",
          extractor_id: "CAPA-PDF",
          extractor_version:
            "pdf-parser-1.0.0",
        })).rejects.toBe(controlled);
      },
    );

    it.each([
      null,
      {},
      {
        extractor_id: "CAPA-PDF",
        extractor_version: "pdf-parser-1.0.0",
        units: [],
      },
      {
        extractor_id: "CAPA-PDF",
        extractor_version: "pdf-parser-1.0.0",
        units: [{
          sequence_number: 2,
          locator: "page:1",
          text: "text",
        }],
      },
      {
        extractor_id: "CAPA-PDF",
        extractor_version: "pdf-parser-1.0.0",
        units: [{
          sequence_number: 1,
          locator: "",
          text: "text",
        }],
      },
      {
        extractor_id: "CAPA-PDF",
        extractor_version: "pdf-parser-1.0.0",
        units: [{
          sequence_number: 1,
          locator: "page:1",
          text: 42,
        }],
      },
      {
        extractor_id: "CAPA-PDF",
        extractor_version: "pdf-parser-1.0.0",
        units: [{
          sequence_number: 1,
          locator: "page:1",
          text: "text",
        }],
        warnings: [""],
      },
    ])(
      "rejects malformed adapter result %#",
      async (result) => {
        const service =
          new CapaKnowledgeExtractionService([
            adapter({
              async extract() {
                return result as never;
              },
            }),
          ]);

        await expect(service.extract({
          artifact_bytes: new Uint8Array([1]),
          declared_media_type: "application/pdf",
          detected_media_type: "application/pdf",
          extractor_id: "CAPA-PDF",
          extractor_version:
            "pdf-parser-1.0.0",
        })).rejects.toMatchObject({
          reason_code:
            "INVALID_EXTRACTION_RESULT",
        });
      },
    );

    it(
      "rejects a forged adapter identity",
      async () => {
        const service =
          new CapaKnowledgeExtractionService([
            adapter({
              async extract() {
                return {
                  extractor_id: "FORGED",
                  extractor_version:
                    "pdf-parser-1.0.0",
                  units: [{
                    sequence_number: 1,
                    locator: "page:1",
                    text: "text",
                  }],
                };
              },
            }),
          ]);

        await expect(service.extract({
          artifact_bytes: new Uint8Array([1]),
          declared_media_type: "application/pdf",
          detected_media_type: "application/pdf",
          extractor_id: "CAPA-PDF",
          extractor_version:
            "pdf-parser-1.0.0",
        })).rejects.toMatchObject({
          reason_code:
            "EXTRACTOR_IDENTITY_MISMATCH",
        });
      },
    );

    it(
      "rejects extracted content containing only whitespace",
      async () => {
        const service =
          new CapaKnowledgeExtractionService([
            adapter({
              async extract() {
                return {
                  extractor_id: "CAPA-PDF",
                  extractor_version:
                    "pdf-parser-1.0.0",
                  units: [{
                    sequence_number: 1,
                    locator: "page:1",
                    text: "  \n",
                  }],
                };
              },
            }),
          ]);

        await expect(service.extract({
          artifact_bytes: new Uint8Array([1]),
          declared_media_type: "application/pdf",
          detected_media_type: "application/pdf",
          extractor_id: "CAPA-PDF",
          extractor_version:
            "pdf-parser-1.0.0",
        })).rejects.toMatchObject({
          reason_code:
            "EXTRACTED_CONTENT_EMPTY",
        });
      },
    );

    it(
      "fails closed on malformed UTF-8",
      async () => {
        const service =
          new CapaKnowledgeExtractionService([
            createCapaPlainTextExtractor(),
          ]);

        await expect(service.extract(
          textRequest({
            artifact_bytes:
              new Uint8Array([0xc3, 0x28]),
          }),
        )).rejects.toMatchObject({
          reason_code: "EXTRACTION_FAILED",
        });
      },
    );

    it(
      "rejects an invalid plain-text extractor version",
      () => {
        expect(() =>
          createCapaPlainTextExtractor(
            "bad version",
          ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_EXTRACTION_REQUEST",
          }),
        );
      },
    );

    it(
      "provides a stable named controlled error",
      () => {
        const error =
          new CapaKnowledgeExtractionError(
            "EXTRACTION_FAILED",
          );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeExtractionError",
        );
        expect(error.message).toBe(
          "EXTRACTION_FAILED",
        );
      },
    );
  },
);
