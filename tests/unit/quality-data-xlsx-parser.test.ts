import ExcelJS from "exceljs";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { QUALITY_DATA_MAX_SOURCE_BYTES } from "../../lib/quality-data/quality-data-contract";
import { inspectQualityDataXlsx, parseQualityDataXlsx, type QualityDataXlsxMapping } from "../../lib/quality-data/xlsx-quality-data-parser";

const mapping: QualityDataXlsxMapping = {
  worksheet_name: "Inspection Data",
  header_row: 2,
  columns: [
    { header: "Part Number", field_key: "part_number", value_type: "text", required: true },
    { header: "Defect Count", field_key: "defect_count", value_type: "number", required: true, normalized_unit: "count" },
    { header: "Inspection Date", field_key: "inspection_date", value_type: "date", required: false },
    { header: "Accepted", field_key: "accepted", value_type: "boolean", required: false },
  ],
  ignored_headers: ["Operator Note"],
};

async function workbookBytes(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  const result = await workbook.xlsx.writeBuffer();
  return new Uint8Array(result);
}

async function goodWorkbook(): Promise<Uint8Array> {
  return workbookBytes((workbook) => {
    workbook.addWorksheet("Read me").addRow(["Not selected"]);
    const sheet = workbook.addWorksheet("Inspection Data");
    sheet.addRow(["Manufacturing observations"]);
    sheet.addRow(["Part Number", "Defect Count", "Inspection Date", "Accepted", "Operator Note"]);
    sheet.addRow([" P-001 ", 3, new Date("2026-10-02T00:00:00.000Z"), true, "fixture"]);
    sheet.addRow(["P-002", 0, "2026-10-03", false, "fixture"]);
  });
}

describe("deterministic quality-data XLSX parser", () => {
  it("exposes bounded worksheet metadata and only the explicitly selected header row", async () => {
    const bytes = await goodWorkbook();
    const inventory = await inspectQualityDataXlsx(bytes);
    expect(inventory).toMatchObject({ status: "inspected", worksheets: [
      { name: "Read me", visible: true },
      { name: "Inspection Data", visible: true },
    ] });
    expect(inventory).not.toHaveProperty("headers");
    const selected = await inspectQualityDataXlsx(bytes, "Inspection Data", 2);
    expect(selected).toMatchObject({
      status: "inspected",
      selected_worksheet: "Inspection Data",
      header_row: 2,
      headers: [
        { column_reference: "A2", value: "Part Number" },
        { column_reference: "B2", value: "Defect Count" },
        { column_reference: "C2", value: "Inspection Date" },
        { column_reference: "D2", value: "Accepted" },
        { column_reference: "E2", value: "Operator Note" },
      ],
    });
    expect(JSON.stringify(selected)).not.toContain("P-001");
  });

  it("uses only the explicitly selected worksheet and mapping, preserving typed values and exact cell lineage", async () => {
    const result = await parseQualityDataXlsx(await goodWorkbook(), mapping);
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({
      source_worksheet: "Inspection Data",
      source_row_number: 3,
      fields: [
        { field_key: "part_number", value_type: "text", original_value: " P-001 ", normalized_value: "P-001", source_cell_reference: "A3" },
        { field_key: "defect_count", value_type: "number", original_value: 3, normalized_value: 3, normalized_unit: "count", source_cell_reference: "B3" },
        { field_key: "inspection_date", value_type: "date", original_value: "2026-10-02T00:00:00.000Z", normalized_value: "2026-10-02", source_cell_reference: "C3" },
        { field_key: "accepted", value_type: "boolean", original_value: true, normalized_value: true, source_cell_reference: "D3" },
      ],
    });
    expect(result.records[1]?.fields[2]).toMatchObject({ original_value: "2026-10-03", normalized_value: "2026-10-03", source_cell_reference: "C4" });
    expect(result.record_count).toBe(2);
    expect(result.field_count).toBe(8);
  });

  it("rejects a missing worksheet and never infers column meanings", async () => {
    const bytes = await goodWorkbook();
    const missingSheet = await parseQualityDataXlsx(bytes, { ...mapping, worksheet_name: "Wrong" });
    expect(missingSheet).toMatchObject({ status: "invalid", diagnostics: [{ code: "XLSX_WORKSHEET_NOT_FOUND" }] });

    const noExplicitMap = await parseQualityDataXlsx(bytes, {
      worksheet_name: "Inspection Data", header_row: 2,
      columns: [{ header: "Defect Count", field_key: "defect_count", value_type: "number" }],
      ignored_headers: [],
    });
    expect(noExplicitMap.status).toBe("invalid");
    if (noExplicitMap.status === "invalid") expect(noExplicitMap.diagnostics.map(({ code }) => code)).toContain("XLSX_UNMAPPED_HEADER");
  });

  it("reports missing required data and inconsistent cell types without coercion", async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Inspection Data");
      sheet.addRow(["Part Number", "Defect Count", "Inspection Date", "Accepted", "Operator Note"]);
      sheet.addRow(["P-001", "3", null, true, "fixture"]);
    });
    const result = await parseQualityDataXlsx(bytes, {
      ...mapping,
      header_row: 1,
      columns: mapping.columns.map((column) => column.field_key === "inspection_date" ? { ...column, required: true } : column),
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "XLSX_VALUE_TYPE_MISMATCH", cell_reference: "B2", field_key: "defect_count" }),
        expect.objectContaining({ code: "XLSX_REQUIRED_VALUE_MISSING", cell_reference: "C2", field_key: "inspection_date" }),
      ]));
    }
  });

  it("rejects formulas rather than using cached or calculated values", async () => {
    const bytes = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Inspection Data");
      sheet.addRow(["Part Number", "Defect Count", "Inspection Date", "Accepted", "Operator Note"]);
      sheet.addRow(["P-001", { formula: "1+2", result: 3 }, null, true, "fixture"]);
    });
    const result = await parseQualityDataXlsx(bytes, { ...mapping, header_row: 1 });
    expect(result).toMatchObject({ status: "invalid" });
    if (result.status === "invalid") expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "XLSX_FORMULA_UNSUPPORTED", cell_reference: "B2" }));
  });

  it("reports duplicate or unmapped headers and invalid calendar dates", async () => {
    const duplicate = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Inspection Data");
      sheet.addRow(["Part Number", "Part Number", "Inspection Date", "Accepted", "Operator Note"]);
      sheet.addRow(["P-001", "P-002", "2026-02-30", true, "fixture"]);
    });
    const result = await parseQualityDataXlsx(duplicate, { ...mapping, header_row: 1, columns: [
      mapping.columns[0]!, mapping.columns[2]!, mapping.columns[3]!,
    ], ignored_headers: ["Operator Note"] });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["XLSX_HEADER_DUPLICATE", "XLSX_DATE_INVALID"]));
  });

  it("rejects malformed and oversized workbooks before parsing", async () => {
    expect(await parseQualityDataXlsx(new Uint8Array([1, 2, 3]), mapping)).toMatchObject({ status: "invalid", diagnostics: [{ code: "INVALID_XLSX_ARCHIVE" }] });
    expect(await parseQualityDataXlsx(new Uint8Array(QUALITY_DATA_MAX_SOURCE_BYTES + 1), mapping)).toMatchObject({ status: "invalid", diagnostics: [{ code: "XLSX_ARCHIVE_LIMIT_EXCEEDED" }] });
  });

  it("rejects external-link package entries and archive expansion metadata mismatches", async () => {
    const externalLink = zipSync({
      "[Content_Types].xml": new TextEncoder().encode("types"),
      "xl/workbook.xml": new TextEncoder().encode("workbook"),
      "xl/worksheets/sheet1.xml": new TextEncoder().encode("sheet"),
      "xl/externalLinks/externalLink1.xml": new TextEncoder().encode("external"),
    });
    expect(await parseQualityDataXlsx(externalLink, mapping)).toMatchObject({ status: "invalid", diagnostics: [{ code: "INVALID_XLSX_ARCHIVE" }] });

    const mismatched = zipSync({
      "[Content_Types].xml": new TextEncoder().encode("types"),
      "xl/workbook.xml": new TextEncoder().encode("workbook"),
      "xl/worksheets/sheet1.xml": new TextEncoder().encode("sheet data"),
    });
    const view = new DataView(mismatched.buffer, mismatched.byteOffset, mismatched.byteLength);
    for (let offset = 0; offset < mismatched.length - 46; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 1, true);
        break;
      }
    }
    expect(await parseQualityDataXlsx(mismatched, mapping)).toMatchObject({ status: "invalid", diagnostics: [{ code: "INVALID_XLSX_ARCHIVE" }] });
  });

  it("rejects sparse workbooks beyond bounded row and column limits", async () => {
    const tooManyRows = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Inspection Data");
      sheet.addRow(["Part Number", "Defect Count", "Inspection Date", "Accepted", "Operator Note"]);
      sheet.getCell("A10002").value = "P-001";
    });
    expect(await parseQualityDataXlsx(tooManyRows, { ...mapping, header_row: 1 })).toMatchObject({ status: "invalid", diagnostics: [{ code: "XLSX_ROW_LIMIT_EXCEEDED" }] });

    const tooManyColumns = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Inspection Data");
      sheet.addRow(["Part Number", "Defect Count", "Inspection Date", "Accepted", "Operator Note"]);
      sheet.getCell("CW1").value = "Extra";
    });
    expect(await parseQualityDataXlsx(tooManyColumns, { ...mapping, header_row: 1 })).toMatchObject({ status: "invalid", diagnostics: [{ code: "XLSX_COLUMN_LIMIT_EXCEEDED" }] });
  });

  it("includes record and ingestion-envelope overhead in the persisted bundle limit", async () => {
    const oversized = await workbookBytes((workbook) => {
      const sheet = workbook.addWorksheet("Inspection Data");
      sheet.addRow(["Value"]);
      const value = "x".repeat(16_000);
      for (let row = 0; row < 163; row += 1) sheet.addRow([value]);
    });
    const result = await parseQualityDataXlsx(oversized, {
      worksheet_name: "Inspection Data",
      header_row: 1,
      columns: [{ header: "Value", field_key: "value", value_type: "text", required: true }],
      ignored_headers: [],
    });
    expect(result).toMatchObject({ status: "invalid", diagnostics: [expect.objectContaining({ code: "XLSX_FIELD_VALUE_LIMIT_EXCEEDED" })] });
  });
});
