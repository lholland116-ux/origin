import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CAPA_DOCX_EXTRACTOR_VERSION,
  CAPA_PDF_EXTRACTOR_VERSION,
  CAPA_XLSX_EXTRACTOR_VERSION,
  createApprovedCapaKnowledgeExtractors,
  createCapaDocxExtractor,
  createCapaPdfExtractor,
  createCapaXlsxExtractor,
} from "../../lib/capa/knowledge/capa-knowledge-extractor-adapters";

const BYTES = new Uint8Array([1, 2, 3]);

describe(
  "controlled CAPA knowledge extractor adapters",
  () => {
    it(
      "creates the exact approved adapter set",
      () => {
        const extractors =
          createApprovedCapaKnowledgeExtractors();

        expect(extractors.map((extractor) => ({
          id: extractor.extractor_id,
          version: extractor.extractor_version,
          mediaType: extractor.media_type,
        }))).toEqual([
          {
            id: "CAPA-PDF",
            version: CAPA_PDF_EXTRACTOR_VERSION,
            mediaType: "application/pdf",
          },
          {
            id: "CAPA-DOCX",
            version: CAPA_DOCX_EXTRACTOR_VERSION,
            mediaType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
          {
            id: "CAPA-XLSX",
            version: CAPA_XLSX_EXTRACTOR_VERSION,
            mediaType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ]);
        expect(Object.isFrozen(extractors))
          .toBe(true);
      },
    );

    it(
      "maps PDF pages to stable ordered locators",
      async () => {
        const parser = vi.fn().mockResolvedValue({
          pages: [
            { text: "First page" },
            { text: "Second page" },
          ],
        });
        const extractor =
          createCapaPdfExtractor(parser);
        const result = await extractor.extract(BYTES);

        expect(parser).toHaveBeenCalledWith(BYTES);
        expect(result).toEqual({
          extractor_id: "CAPA-PDF",
          extractor_version:
            CAPA_PDF_EXTRACTOR_VERSION,
          units: [
            {
              sequence_number: 1,
              locator: "page:1",
              text: "First page",
            },
            {
              sequence_number: 2,
              locator: "page:2",
              text: "Second page",
            },
          ],
        });
        expect(Object.isFrozen(result.units))
          .toBe(true);
      },
    );

    it.each([
      null,
      {},
      { pages: "not-pages" },
      { pages: [{ text: 42 }] },
    ])(
      "rejects malformed PDF parser output %#",
      async (output) => {
        const extractor = createCapaPdfExtractor(
          async () => output as never,
        );

        await expect(extractor.extract(BYTES))
          .rejects.toMatchObject({
            reason_code:
              "INVALID_EXTRACTION_RESULT",
          });
      },
    );

    it(
      "rejects a PDF with no extracted content",
      async () => {
        const extractor = createCapaPdfExtractor(
          async () => ({
            pages: [{ text: "  " }],
          }),
        );

        await expect(extractor.extract(BYTES))
          .rejects.toMatchObject({
            reason_code:
              "EXTRACTED_CONTENT_EMPTY",
          });
      },
    );

    it(
      "maps DOCX text and controlled parser warnings",
      async () => {
        const extractor = createCapaDocxExtractor(
          async () => ({
            text: "Document text",
            warnings: ["WARNING: image omitted"],
          }),
        );
        const result = await extractor.extract(BYTES);

        expect(result).toEqual({
          extractor_id: "CAPA-DOCX",
          extractor_version:
            CAPA_DOCX_EXTRACTOR_VERSION,
          units: [{
            sequence_number: 1,
            locator: "document:body",
            text: "Document text",
          }],
          warnings: ["WARNING: image omitted"],
        });
        expect(Object.isFrozen(result.warnings))
          .toBe(true);
      },
    );

    it.each([
      null,
      {},
      { text: 42, warnings: [] },
      { text: "text", warnings: "warning" },
      { text: "text", warnings: [""] },
    ])(
      "rejects malformed DOCX parser output %#",
      async (output) => {
        const extractor = createCapaDocxExtractor(
          async () => output as never,
        );

        await expect(extractor.extract(BYTES))
          .rejects.toMatchObject({
            reason_code:
              "INVALID_EXTRACTION_RESULT",
          });
      },
    );

    it(
      "rejects an empty DOCX",
      async () => {
        const extractor = createCapaDocxExtractor(
          async () => ({
            text: " \n ",
            warnings: [],
          }),
        );

        await expect(extractor.extract(BYTES))
          .rejects.toMatchObject({
            reason_code:
              "EXTRACTED_CONTENT_EMPTY",
          });
      },
    );

    it(
      "maps XLSX worksheets to stable encoded locators",
      async () => {
        const extractor = createCapaXlsxExtractor(
          async () => [
            {
              name: "Risk Register",
              text: "Risk\tControl",
            },
            {
              name: "CAPA/Status",
              text: "1\tOpen",
            },
          ],
        );
        const result = await extractor.extract(BYTES);

        expect(result.units).toEqual([
          {
            sequence_number: 1,
            locator:
              "sheet:1:Risk+Register",
            text: "Risk\tControl",
          },
          {
            sequence_number: 2,
            locator:
              "sheet:2:CAPA%2FStatus",
            text: "1\tOpen",
          },
        ]);
      },
    );

    it.each([
      null,
      {},
      [{ name: "", text: "text" }],
      [{ name: "Sheet", text: 42 }],
      [
        { name: "Sheet", text: "one" },
        { name: "Sheet", text: "two" },
      ],
    ])(
      "rejects malformed XLSX parser output %#",
      async (output) => {
        const extractor = createCapaXlsxExtractor(
          async () => output as never,
        );

        await expect(extractor.extract(BYTES))
          .rejects.toMatchObject({
            reason_code:
              "INVALID_EXTRACTION_RESULT",
          });
      },
    );

    it(
      "rejects a workbook with no extracted content",
      async () => {
        const extractor = createCapaXlsxExtractor(
          async () => [{
            name: "Sheet1",
            text: "",
          }],
        );

        await expect(extractor.extract(BYTES))
          .rejects.toMatchObject({
            reason_code:
              "EXTRACTED_CONTENT_EMPTY",
          });
      },
    );
  },
);
