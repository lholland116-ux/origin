import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseQualityDataXlsx } from "../../lib/quality-data/xlsx-quality-data-parser";

describe("synthetic manufacturing demonstration workbook", () => {
  it("contains fictional disjoint cohorts with an unfavorable three-month defect-rate trend", async () => {
    const bytes = new Uint8Array(await readFile(resolve("public/demo/synthetic-manufacturing-quality.xlsx")));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Synthetic Inspections");
    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(13);
    expect(sheet!.getRow(1).values).toEqual([undefined, "Inspection Date", "Failure Mode", "Defect Count", "Inspected Quantity"]);
    const monthly = new Map<string, { defects: number; quantity: number; rows: number }>();
    const categories = new Map<string, number>();
    for (let rowNumber = 2; rowNumber <= sheet!.rowCount; rowNumber += 1) {
      const row = sheet!.getRow(rowNumber);
      const date = row.getCell(1).value as Date;
      const mode = row.getCell(2).value;
      const defects = Number(row.getCell(3).value);
      const quantity = Number(row.getCell(4).value);
      const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const aggregate = monthly.get(period) ?? { defects: 0, quantity: 0, rows: 0 };
      aggregate.defects += defects; aggregate.quantity += quantity; aggregate.rows += 1;
      monthly.set(period, aggregate);
      if (typeof mode === "string" && mode.trim()) categories.set(mode, (categories.get(mode) ?? 0) + 1);
    }
    const rates = [...monthly.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => {
      expect(value.rows).toBe(4);
      expect(value.quantity).toBe(1_000);
      return value.defects / value.quantity * 1_000;
    });
    expect(rates).toEqual([2, 4, 8]);
    expect(categories.get("Seal leak")).toBe(3);
    expect([...monthly.values()].reduce((sum, value) => sum + value.quantity, 0)).toBe(3_000);
    expect(workbook.description).toContain("disjoint 250-unit inspection cohort");

    const parsed = await parseQualityDataXlsx(bytes, {
      worksheet_name: "Synthetic Inspections",
      header_row: 1,
      columns: [
        { header: "Inspection Date", field_key: "inspection_date", value_type: "date", required: true },
        { header: "Failure Mode", field_key: "failure_mode", value_type: "text" },
        { header: "Defect Count", field_key: "reject_count", value_type: "number", required: true, normalized_unit: "count" },
        { header: "Inspected Quantity", field_key: "inspected_quantity", value_type: "number", required: true, normalized_unit: "units" },
      ],
      ignored_headers: [],
    });
    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") return;
    expect(parsed).toMatchObject({ record_count: 12, field_count: 48 });
    expect(parsed.records[0]).toMatchObject({
      source_worksheet: "Synthetic Inspections",
      source_row_number: 2,
      fields: [
        { field_key: "inspection_date", value_type: "date", normalized_value: "2025-01-06", source_cell_reference: "A2" },
        { field_key: "failure_mode", value_type: "text", normalized_value: "Seal leak", source_cell_reference: "B2" },
        { field_key: "reject_count", value_type: "number", normalized_value: 1, normalized_unit: "count", source_cell_reference: "C2" },
        { field_key: "inspected_quantity", value_type: "number", normalized_value: 250, normalized_unit: "units", source_cell_reference: "D2" },
      ],
    });
    expect(parsed.records[2]?.fields[1]).toMatchObject({
      field_key: "failure_mode", value_type: "blank", original_value: null,
      normalized_value: null, source_cell_reference: "B4",
    });
  });
});
