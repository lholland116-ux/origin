import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";

import {
  CapaKnowledgeExtractionError,
  type CapaKnowledgeAdapterResult,
  type CapaKnowledgeExtractionUnit,
  type CapaKnowledgeExtractor,
} from "./capa-knowledge-extraction";

/**
 * Controlled concrete adapters for approved CAPA knowledge formats.
 *
 * Dependency versions are explicit controlled identities. Updating a parser
 * package requires a new adapter version plus regression and quality review.
 *
 * Traceability: ING-003, ING-004, ING-005; Document #10.
 */

export const CAPA_PDF_EXTRACTOR_VERSION =
  "pdf-parse-2.4.5-adapter-1.0.0";

export const CAPA_DOCX_EXTRACTOR_VERSION =
  "mammoth-1.12.0-adapter-1.0.0";

export const CAPA_XLSX_EXTRACTOR_VERSION =
  "exceljs-4.4.0-adapter-1.0.0";

export interface CapaPdfExtractionPage {
  readonly text: string;
}

export interface CapaPdfExtractionOutput {
  readonly pages:
    readonly CapaPdfExtractionPage[];
}

export interface CapaDocxExtractionOutput {
  readonly text: string;
  readonly warnings: readonly string[];
}

export interface CapaXlsxExtractionSheet {
  readonly name: string;
  readonly text: string;
}

export type CapaPdfParser = (
  artifactBytes: Uint8Array,
) => Promise<CapaPdfExtractionOutput>;

export type CapaDocxParser = (
  artifactBytes: Uint8Array,
) => Promise<CapaDocxExtractionOutput>;

export type CapaXlsxParser = (
  artifactBytes: Uint8Array,
) => Promise<readonly CapaXlsxExtractionSheet[]>;

function controlledUnits(
  units: readonly CapaKnowledgeExtractionUnit[],
): readonly CapaKnowledgeExtractionUnit[] {
  if (
    units.length === 0 ||
    units.every(
      (unit) => unit.text.trim().length === 0,
    )
  ) {
    throw new CapaKnowledgeExtractionError(
      "EXTRACTED_CONTENT_EMPTY",
    );
  }

  return Object.freeze(
    units.map(
      (unit) => Object.freeze({ ...unit }),
    ),
  );
}

function encodeLocatorValue(
  value: string,
): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+");
}

export async function parseCapaPdf(
  artifactBytes: Uint8Array,
): Promise<CapaPdfExtractionOutput> {
  const parser = new PDFParse({
    data: Buffer.from(artifactBytes),
  });

  try {
    const result = await parser.getText();

    return Object.freeze({
      pages: Object.freeze(
        result.pages.map(
          (page) => Object.freeze({
            text: page.text,
          }),
        ),
      ),
    });
  } finally {
    await parser.destroy();
  }
}

export async function parseCapaDocx(
  artifactBytes: Uint8Array,
): Promise<CapaDocxExtractionOutput> {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(artifactBytes),
  });

  return Object.freeze({
    text: result.value,
    warnings: Object.freeze(
      result.messages.map(
        (message) =>
          `${message.type.toUpperCase()}: ${message.message}`,
      ),
    ),
  });
}

export async function parseCapaXlsx(
  artifactBytes: Uint8Array,
): Promise<readonly CapaXlsxExtractionSheet[]> {
  const workbook = new ExcelJS.Workbook();

  const workbookBytes =
    Buffer.from(artifactBytes);

  // ExcelJS 4.4 declares the pre-generic Node Buffer shape. Node 25's
  // Buffer<ArrayBuffer> is runtime-compatible but not declaration-compatible.
  // Keep the compatibility cast isolated at this third-party boundary.
  await workbook.xlsx.load(
    workbookBytes as never,
  );

  const sheets: CapaXlsxExtractionSheet[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[] = [];

    worksheet.eachRow(
      { includeEmpty: false },
      (row) => {
        const cells: string[] = [];

        row.eachCell(
          { includeEmpty: true },
          (cell) => {
            cells.push(cell.text);
          },
        );

        rows.push(cells.join("\t"));
      },
    );

    sheets.push(Object.freeze({
      name: worksheet.name,
      text: rows.join("\n"),
    }));
  });

  return Object.freeze(sheets);
}

export function createCapaPdfExtractor(
  parser: CapaPdfParser = parseCapaPdf,
): CapaKnowledgeExtractor {
  const extractorId = "CAPA-PDF";

  return Object.freeze({
    extractor_id: extractorId,
    extractor_version:
      CAPA_PDF_EXTRACTOR_VERSION,
    media_type: "application/pdf" as const,

    async extract(
      artifactBytes: Uint8Array,
    ): Promise<CapaKnowledgeAdapterResult> {
      const result = await parser(artifactBytes);

      if (
        typeof result !== "object" ||
        result === null ||
        !Array.isArray(result.pages)
      ) {
        throw new CapaKnowledgeExtractionError(
          "INVALID_EXTRACTION_RESULT",
        );
      }

      const units = result.pages.map(
        (page, index) => {
          if (
            typeof page !== "object" ||
            page === null ||
            typeof page.text !== "string"
          ) {
            throw new CapaKnowledgeExtractionError(
              "INVALID_EXTRACTION_RESULT",
            );
          }

          return {
            sequence_number: index + 1,
            locator: `page:${index + 1}`,
            text: page.text,
          };
        },
      );

      return Object.freeze({
        extractor_id: extractorId,
        extractor_version:
          CAPA_PDF_EXTRACTOR_VERSION,
        units: controlledUnits(units),
      });
    },
  });
}

export function createCapaDocxExtractor(
  parser: CapaDocxParser = parseCapaDocx,
): CapaKnowledgeExtractor {
  const extractorId = "CAPA-DOCX";

  return Object.freeze({
    extractor_id: extractorId,
    extractor_version:
      CAPA_DOCX_EXTRACTOR_VERSION,
    media_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,

    async extract(
      artifactBytes: Uint8Array,
    ): Promise<CapaKnowledgeAdapterResult> {
      const result = await parser(artifactBytes);

      if (
        typeof result !== "object" ||
        result === null ||
        typeof result.text !== "string" ||
        !Array.isArray(result.warnings) ||
        result.warnings.some(
          (warning) =>
            typeof warning !== "string" ||
            warning.trim().length === 0,
        )
      ) {
        throw new CapaKnowledgeExtractionError(
          "INVALID_EXTRACTION_RESULT",
        );
      }

      return Object.freeze({
        extractor_id: extractorId,
        extractor_version:
          CAPA_DOCX_EXTRACTOR_VERSION,
        units: controlledUnits([{
          sequence_number: 1,
          locator: "document:body",
          text: result.text,
        }]),
        warnings: Object.freeze([
          ...result.warnings,
        ]),
      });
    },
  });
}

export function createCapaXlsxExtractor(
  parser: CapaXlsxParser = parseCapaXlsx,
): CapaKnowledgeExtractor {
  const extractorId = "CAPA-XLSX";

  return Object.freeze({
    extractor_id: extractorId,
    extractor_version:
      CAPA_XLSX_EXTRACTOR_VERSION,
    media_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,

    async extract(
      artifactBytes: Uint8Array,
    ): Promise<CapaKnowledgeAdapterResult> {
      const result = await parser(artifactBytes);

      if (!Array.isArray(result)) {
        throw new CapaKnowledgeExtractionError(
          "INVALID_EXTRACTION_RESULT",
        );
      }

      const names = new Set<string>();
      const units = result.map(
        (sheet, index) => {
          if (
            typeof sheet !== "object" ||
            sheet === null ||
            typeof sheet.name !== "string" ||
            sheet.name.trim().length === 0 ||
            names.has(sheet.name) ||
            typeof sheet.text !== "string"
          ) {
            throw new CapaKnowledgeExtractionError(
              "INVALID_EXTRACTION_RESULT",
            );
          }

          names.add(sheet.name);

          return {
            sequence_number: index + 1,
            locator:
              `sheet:${index + 1}:${encodeLocatorValue(sheet.name)}`,
            text: sheet.text,
          };
        },
      );

      return Object.freeze({
        extractor_id: extractorId,
        extractor_version:
          CAPA_XLSX_EXTRACTOR_VERSION,
        units: controlledUnits(units),
      });
    },
  });
}

export function createApprovedCapaKnowledgeExtractors():
  readonly CapaKnowledgeExtractor[] {
  return Object.freeze([
    createCapaPdfExtractor(),
    createCapaDocxExtractor(),
    createCapaXlsxExtractor(),
  ]);
}
