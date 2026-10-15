import { describe, expect, it } from "vitest";
import {
  parseWorkbookExtractionReply,
  validateWorkbookExtraction,
  WORKBOOK_EXTRACTION_RESPONSE_SCHEMA,
  WorkbookExtractionValidationError,
} from "@/lib/documents/generation/workbook-extraction-contract";

const validWorkbook = {
  sheetName: "Revenue",
  columns: ["Quarter", "Revenue", "Note", "As of"],
  rows: [["Q1", 200, null, { type: "date", value: "2026-01-31" }]],
};

describe("structured workbook extraction contract", () => {
  it("accepts bounded rectangular text, numeric, blank, and explicit ISO date cells", () => {
    expect(validateWorkbookExtraction(validWorkbook)).toEqual(validWorkbook);
    expect(parseWorkbookExtractionReply(JSON.stringify(validWorkbook))).toEqual(validWorkbook);
  });

  it("uses a strict Responses JSON schema with supported nullable cells and bounded dimensions", () => {
    expect(WORKBOOK_EXTRACTION_RESPONSE_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["sheetName", "columns", "rows"],
      properties: {
        columns: { maxItems: 100 },
        rows: { maxItems: 2_000 },
      },
    });
    const rowsSchema = WORKBOOK_EXTRACTION_RESPONSE_SCHEMA.properties.rows.items.items;
    expect(rowsSchema.anyOf[0]).toMatchObject({ type: ["string", "null"], maxLength: 32_767 });
  });

  it.each([
    "not json",
    JSON.stringify({ ...validWorkbook, unexpected: true }),
    JSON.stringify({ ...validWorkbook, rows: [["Q1", 200]] }),
    JSON.stringify({ ...validWorkbook, rows: [["Q1", 200, null, { type: "date", value: "2026-02-30" }]] }),
    JSON.stringify({ ...validWorkbook, rows: [["Q1", 200, null, { type: "formula", value: "=1+1" }]] }),
    JSON.stringify({ ...validWorkbook, rows: [["Q1", 200, null, true]] }),
    JSON.stringify({ ...validWorkbook, rows: [["Q1", 200, null, "x".repeat(32_768)]] }),
  ])("rejects malformed, ragged, invalid, unknown, or oversized data", (reply) => {
    expect(() => parseWorkbookExtractionReply(reply)).toThrow(WorkbookExtractionValidationError);
  });

  it("rejects non-finite numeric values", () => {
    expect(() => validateWorkbookExtraction({
      ...validWorkbook,
      rows: [["Q1", Number.POSITIVE_INFINITY, null, { type: "date", value: "2026-01-31" }]],
    })).toThrow(WorkbookExtractionValidationError);
  });

  it("rejects an oversized response before parsing", () => {
    expect(() => parseWorkbookExtractionReply(" ".repeat(200_001))).toThrow(WorkbookExtractionValidationError);
  });
});
