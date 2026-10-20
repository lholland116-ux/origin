import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "public/demo/synthetic-manufacturing-quality.xlsx");
const workbook = new ExcelJS.Workbook();
workbook.creator = "LVTChat Synthetic Demonstration Fixture";
workbook.subject = "Fictional, non-identifying manufacturing-quality example data";
workbook.description = "Each row is a disjoint 250-unit inspection cohort. Failure-mode values are mutually exclusive; blank means zero observed defects. Monthly defect rate is sum(defect_count) / sum(inspected_quantity) * 1,000.";
workbook.created = new Date("2026-01-01T00:00:00.000Z");
workbook.modified = new Date("2026-01-01T00:00:00.000Z");
const sheet = workbook.addWorksheet("Synthetic Inspections");
sheet.columns = [
  { header: "Inspection Date", key: "inspection_date", width: 20 },
  { header: "Failure Mode", key: "failure_mode", width: 24 },
  { header: "Defect Count", key: "defect_count", width: 16 },
  { header: "Inspected Quantity", key: "inspected_quantity", width: 22 },
];
sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const cohorts = [
  ["2025-01-06", "Seal leak", 1], ["2025-01-13", "Surface mark", 1], ["2025-01-20", null, 0], ["2025-01-27", null, 0],
  ["2025-02-03", "Seal leak", 2], ["2025-02-10", "Surface mark", 1], ["2025-02-17", "Packaging flaw", 1], ["2025-02-24", null, 0],
  ["2025-03-03", "Seal leak", 4], ["2025-03-10", "Surface mark", 2], ["2025-03-17", "Packaging flaw", 1], ["2025-03-24", "Handling mark", 1],
];
for (const [date, failureMode, defectCount] of cohorts) {
  sheet.addRow({ inspection_date: new Date(`${date}T12:00:00.000Z`), failure_mode: failureMode, defect_count: defectCount, inspected_quantity: 250 });
}
sheet.getColumn("inspection_date").numFmt = "yyyy-mm-dd";
sheet.getColumn("defect_count").numFmt = "0";
sheet.getColumn("inspected_quantity").numFmt = "0";
sheet.views = [{ state: "frozen", ySplit: 1 }];
await mkdir(dirname(output), { recursive: true });
await workbook.xlsx.writeFile(output);
console.log(`Wrote synthetic fixture: ${output}`);
