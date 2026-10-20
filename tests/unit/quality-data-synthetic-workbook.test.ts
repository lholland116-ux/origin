import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

describe("synthetic manufacturing demonstration workbook", () => {
  it("contains fictional disjoint cohorts with an unfavorable three-month defect-rate trend", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await readFile(resolve("public/demo/synthetic-manufacturing-quality.xlsx"))) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
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
  });
});
