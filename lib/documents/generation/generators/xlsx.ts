import ExcelJS from "exceljs";
import type {
  GeneratedArtifact,
  WorkbookDocumentRequest,
  WorkbookSheet,
} from "../contracts";
import { sanitizeFilename } from "../filenames";
import { getDocumentMimeType } from "../mime";
import {
  assertValidGenerationRequest,
  DocumentGenerationValidationError,
  MAX_ARTIFACT_BYTES,
  normalizeWorkbookCell,
  validateGeneratedArtifact,
} from "../validation";

const MAX_COLUMN_WIDTH = 40;
const MIN_COLUMN_WIDTH = 12;
const CELL_PADDING = 2;

function displayCellValue(value: WorkbookSheet["rows"][number][number]): string {
  if (value === null) return "";
  return String(normalizeWorkbookCell(value));
}

function columnWidth(sheet: WorkbookSheet, columnIndex: number): number {
  const values = [
    sheet.columns[columnIndex] ?? "",
    ...sheet.rows.map((row) => displayCellValue(row[columnIndex] ?? null)),
  ];
  const longest = Math.max(...values.map((value) => value.length), 0);
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + CELL_PADDING));
}

function addSheet(workbook: ExcelJS.Workbook, sheet: WorkbookSheet): void {
  const worksheet = workbook.addWorksheet(sheet.name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  worksheet.columns = sheet.columns.map((header, index) => ({
    header,
    key: `column_${index + 1}`,
    width: columnWidth(sheet, index),
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1F4E78" },
  };
  headerRow.alignment = { vertical: "middle" };
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFB8C7D9" } },
    };
  });

  for (const row of sheet.rows) {
    worksheet.addRow(row.map((cell) => normalizeWorkbookCell(cell)));
  }
}

export async function generateXlsxArtifact(
  request: WorkbookDocumentRequest & { readonly format: "xlsx" },
): Promise<GeneratedArtifact> {
  assertValidGenerationRequest(request);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LVTChat";
  workbook.title = request.title ?? "LVTChat workbook";
  workbook.subject = "Generated workbook";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.properties.date1904 = false;

  for (const sheet of request.sheets) addSheet(workbook, sheet);

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  const artifact: GeneratedArtifact = {
    filename: sanitizeFilename(request.filename, "xlsx"),
    mimeType: getDocumentMimeType("xlsx"),
    bytes,
    sizeBytes: bytes.byteLength,
    format: "xlsx",
  };

  const issues = validateGeneratedArtifact(artifact);
  if (issues.length > 0) {
    throw new DocumentGenerationValidationError(issues);
  }
  if (artifact.sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new DocumentGenerationValidationError([
      "Generated XLSX exceeds the maximum artifact size.",
    ]);
  }

  return artifact;
}
