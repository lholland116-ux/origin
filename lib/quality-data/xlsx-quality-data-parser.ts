import ExcelJS from "exceljs";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { z } from "zod";

import { QUALITY_DATA_MAX_BUNDLE_BYTES, QUALITY_DATA_MAX_FIELDS, QUALITY_DATA_MAX_FIELD_BYTES, QUALITY_DATA_MAX_RECORDS, QUALITY_DATA_MAX_SOURCE_BYTES, qualityDataRecordSchema } from "./quality-data-contract";

export const QUALITY_DATA_XLSX_PARSER_VERSION = "quality-data-xlsx-1.0.0";
export const QUALITY_DATA_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const QUALITY_DATA_XLSX_MAX_WORKSHEETS = 20;
export const QUALITY_DATA_XLSX_MAX_COLUMNS = 100;
export const QUALITY_DATA_XLSX_MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_CENTRAL_DIRECTORY_BYTES = 1024 * 1024;
const MAX_DIAGNOSTICS = 100;
// Reserve bounded source, dataset, and request metadata when enforcing the
// persisted Stage 2A JSON bundle limit before any object is written.
const MAX_INGESTION_ENVELOPE_BYTES = 4 * 1024;

const mappingColumnSchema = z.object({
  header: z.string().trim().min(1).max(200),
  field_key: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  value_type: z.enum(["text", "number", "date", "boolean"]),
  required: z.boolean().default(false),
  normalized_unit: z.string().trim().max(32).optional(),
}).strict();

export const qualityDataXlsxMappingSchema = z.object({
  worksheet_name: z.string().trim().min(1).max(128),
  header_row: z.number().int().min(1).max(10_000),
  columns: z.array(mappingColumnSchema).min(1).max(QUALITY_DATA_XLSX_MAX_COLUMNS),
  ignored_headers: z.array(z.string().trim().min(1).max(200)).max(QUALITY_DATA_XLSX_MAX_COLUMNS).default([]),
}).strict().superRefine((mapping, context) => {
  const headers = new Set<string>();
  const keys = new Set<string>();
  for (const [index, column] of mapping.columns.entries()) {
    if (headers.has(column.header)) {
      context.addIssue({ code: "custom", path: ["columns", index, "header"], message: "DUPLICATE_MAPPING_HEADER" });
    }
    if (keys.has(column.field_key)) {
      context.addIssue({ code: "custom", path: ["columns", index, "field_key"], message: "DUPLICATE_MAPPING_FIELD" });
    }
    headers.add(column.header);
    keys.add(column.field_key);
  }
  const ignored = new Set<string>();
  for (const [index, header] of mapping.ignored_headers.entries()) {
    if (ignored.has(header) || headers.has(header)) {
      context.addIssue({ code: "custom", path: ["ignored_headers", index], message: "DUPLICATE_OR_MAPPED_IGNORED_HEADER" });
    }
    ignored.add(header);
  }
});

export type QualityDataXlsxMapping = z.infer<typeof qualityDataXlsxMappingSchema>;
type QualityDataRecord = z.infer<typeof qualityDataRecordSchema>;

export type QualityDataXlsxDiagnosticCode =
  | "INVALID_MAPPING"
  | "INVALID_XLSX_ARCHIVE"
  | "XLSX_ARCHIVE_LIMIT_EXCEEDED"
  | "XLSX_WORKBOOK_INVALID"
  | "XLSX_WORKSHEET_LIMIT_EXCEEDED"
  | "XLSX_WORKSHEET_NOT_FOUND"
  | "XLSX_WORKSHEET_NOT_VISIBLE"
  | "XLSX_ROW_LIMIT_EXCEEDED"
  | "XLSX_COLUMN_LIMIT_EXCEEDED"
  | "XLSX_MERGED_DATA_CELLS_UNSUPPORTED"
  | "XLSX_HEADER_ROW_INVALID"
  | "XLSX_HEADER_MISSING"
  | "XLSX_HEADER_DUPLICATE"
  | "XLSX_MAPPING_HEADER_NOT_FOUND"
  | "XLSX_IGNORED_HEADER_NOT_FOUND"
  | "XLSX_UNMAPPED_HEADER"
  | "XLSX_ROW_HAS_NO_MAPPED_VALUES"
  | "XLSX_FORMULA_UNSUPPORTED"
  | "XLSX_REQUIRED_VALUE_MISSING"
  | "XLSX_VALUE_TYPE_MISMATCH"
  | "XLSX_CELL_VALUE_UNSUPPORTED"
  | "XLSX_DATE_INVALID"
  | "XLSX_NO_DATA_ROWS"
  | "XLSX_RECORD_LIMIT_EXCEEDED"
  | "XLSX_FIELD_LIMIT_EXCEEDED"
  | "XLSX_FIELD_VALUE_LIMIT_EXCEEDED";

export interface QualityDataXlsxDiagnostic {
  readonly code: QualityDataXlsxDiagnosticCode;
  readonly worksheet?: string;
  readonly row_number?: number;
  readonly cell_reference?: string;
  readonly field_key?: string;
}

export interface QualityDataXlsxParseSuccess {
  readonly status: "parsed";
  readonly records: readonly QualityDataRecord[];
  readonly record_count: number;
  readonly field_count: number;
}

export interface QualityDataXlsxParseFailure {
  readonly status: "invalid";
  readonly diagnostics: readonly QualityDataXlsxDiagnostic[];
  readonly diagnostics_truncated: boolean;
}

export interface QualityDataXlsxInspection {
  readonly status: "inspected";
  readonly worksheets: readonly {
    readonly name: string;
    readonly visible: boolean;
    readonly row_count: number;
    readonly column_count: number;
  }[];
  readonly selected_worksheet?: string;
  readonly header_row?: number;
  readonly headers?: readonly {
    readonly column_reference: string;
    readonly value: string;
  }[];
}

export interface QualityDataXlsxInspectionFailure {
  readonly status: "invalid";
  readonly diagnostics: readonly QualityDataXlsxDiagnostic[];
}

export type QualityDataXlsxParseResult = QualityDataXlsxParseSuccess | QualityDataXlsxParseFailure;

export type QualityDataXlsxInspectionResult = QualityDataXlsxInspection | QualityDataXlsxInspectionFailure;

interface ArchiveEntry {
  readonly name: string;
  readonly compressed_size: number;
  readonly expanded_size: number;
}

/** Bounds ZIP expansion before ExcelJS inflates workbook entries. ZIP64, encryption and unsafe paths are not accepted. */
function inspectXlsxArchive(bytes: Uint8Array): readonly ArchiveEntry[] | QualityDataXlsxDiagnosticCode {
  if (bytes.byteLength === 0 || bytes.byteLength > QUALITY_DATA_MAX_SOURCE_BYTES) return "XLSX_ARCHIVE_LIMIT_EXCEEDED";
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return "INVALID_XLSX_ARCHIVE";
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= minEocd; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === bytes.byteLength) { eocd = offset; break; }
    }
  }
  if (eocd < 0) return "INVALID_XLSX_ARCHIVE";

  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0
    || entryCount > MAX_ARCHIVE_ENTRIES || entryCount === 0xffff
    || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralSize > MAX_CENTRAL_DIRECTORY_BYTES
    || centralOffset + centralSize !== eocd) return "XLSX_ARCHIVE_LIMIT_EXCEEDED";

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ArchiveEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let expandedTotal = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralOffset + centralSize || view.getUint32(offset, true) !== 0x02014b50) return "INVALID_XLSX_ARCHIVE";
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > centralOffset + centralSize || nameLength === 0 || nameLength > 1024 || diskStart !== 0
      || compressed === 0xffffffff || expanded === 0xffffffff || localOffset === 0xffffffff
      || (flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (method !== 0 && method !== 8)) return "INVALID_XLSX_ARCHIVE";

    let name: string;
    try { name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch { return "INVALID_XLSX_ARCHIVE"; }
    const normalizedName = name.replace(/\/$/, "");
    if (!normalizedName || normalizedName.startsWith("/") || normalizedName.includes("\\")
      || normalizedName.split("/").some((part) => part === ".." || part === ".")
      || names.has(name)) return "INVALID_XLSX_ARCHIVE";
    names.add(name);
    if (/^(xl\/externalLinks\/|xl\/embeddings\/|xl\/activeX\/)|(^|\/)vbaProject\.bin$/i.test(name)) return "INVALID_XLSX_ARCHIVE";

    if (expanded > QUALITY_DATA_XLSX_MAX_EXPANDED_BYTES
      || expandedTotal + expanded > QUALITY_DATA_XLSX_MAX_EXPANDED_BYTES
      || (expanded > 0 && compressed === 0)) return "XLSX_ARCHIVE_LIMIT_EXCEEDED";
    expandedTotal += expanded;

    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) return "INVALID_XLSX_ARCHIVE";
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset > centralOffset || dataOffset + compressed > centralOffset) return "INVALID_XLSX_ARCHIVE";
    let localName: string;
    try { localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)); }
    catch { return "INVALID_XLSX_ARCHIVE"; }
    if (localName !== name || view.getUint16(localOffset + 8, true) !== method
      || view.getUint16(localOffset + 6, true) !== flags) return "INVALID_XLSX_ARCHIVE";

    entries.push({ name, compressed_size: compressed, expanded_size: expanded });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) return "INVALID_XLSX_ARCHIVE";
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")
    || !entries.some((entry) => /^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/i.test(entry.name))) return "INVALID_XLSX_ARCHIVE";
  return entries;
}

/** Streams every ZIP member once to enforce the real expansion bound, even if central-directory sizes lie. */
function verifyActualArchiveExpansion(
  bytes: Uint8Array,
  entries: readonly ArchiveEntry[],
): Promise<"valid" | "invalid" | "limit"> {
  return new Promise((resolve) => {
    const expected = new Map(entries.map((entry) => [entry.name, entry.expanded_size]));
    const completedNames = new Set<string>();
    let completed = 0;
    let expandedTotal = 0;
    let settled = false;
    const finish = (result: "valid" | "invalid" | "limit") => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const unzip = new Unzip((file) => {
        const expectedSize = expected.get(file.name);
        if (expectedSize === undefined || completedNames.has(file.name)) {
          void file.terminate();
          finish("invalid");
          return;
        }
        let fileBytes = 0;
        file.ondata = (error, chunk, final) => {
          if (settled) return;
          if (error) { finish("invalid"); return; }
          fileBytes += chunk.byteLength;
          expandedTotal += chunk.byteLength;
          if (fileBytes > QUALITY_DATA_XLSX_MAX_EXPANDED_BYTES || expandedTotal > QUALITY_DATA_XLSX_MAX_EXPANDED_BYTES) {
            void file.terminate();
            finish("limit");
            return;
          }
          if (final) {
            if (fileBytes !== expectedSize) { finish("invalid"); return; }
            completedNames.add(file.name);
            completed += 1;
            if (completed === entries.length) finish("valid");
          }
        };
        file.start();
      });
      unzip.register(UnzipPassThrough);
      unzip.register(UnzipInflate);
      unzip.push(bytes, true);
      if (!settled && completed !== entries.length) finish("invalid");
    } catch {
      finish("invalid");
    }
  });
}

function formulaLike(value: ExcelJS.CellValue): boolean {
  return typeof value === "object" && value !== null
    && ("formula" in value || "sharedFormula" in value || "results" in value);
}

function excelColumnName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function isNonBlank(value: ExcelJS.CellValue): boolean {
  return value !== null && value !== undefined;
}

function toMappedField(
  value: ExcelJS.CellValue,
  mapping: z.infer<typeof mappingColumnSchema>,
): { readonly value_type: "text" | "number" | "date" | "boolean" | "blank"; readonly original_value: string | number | boolean | null; readonly normalized_value?: string | number | boolean | null } | "missing" | "mismatch" | "invalid_date" | "unsupported" {
  if (formulaLike(value)) return "unsupported";
  if (value === null || value === undefined) return mapping.required ? "missing" : { value_type: "blank", original_value: null, normalized_value: null };

  switch (mapping.value_type) {
    case "text": {
      if (typeof value !== "string") return "mismatch";
      if (mapping.required && value.trim().length === 0) return "missing";
      if (Buffer.byteLength(value, "utf8") > QUALITY_DATA_MAX_FIELD_BYTES) return "unsupported";
      return { value_type: "text", original_value: value, normalized_value: value.trim() };
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { value_type: "number", original_value: value, normalized_value: value }
        : "mismatch";
    case "boolean":
      return typeof value === "boolean"
        ? { value_type: "boolean", original_value: value, normalized_value: value }
        : "mismatch";
    case "date": {
      let original: string;
      let normalized: string;
      if (value instanceof Date && Number.isFinite(value.getTime())) {
        original = value.toISOString();
        normalized = original.slice(0, 10);
      } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(`${value}T00:00:00.000Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "invalid_date";
        original = value;
        normalized = value;
      } else {
        return "mismatch";
      }
      if (mapping.required && !normalized) return "missing";
      return { value_type: "date", original_value: original, normalized_value: normalized };
    }
  }
}

function rangeIntersectsData(merge: string, firstRow: number, lastRow: number, lastColumn: number): boolean {
  const [start, end = start] = merge.split(":");
  const parse = (address: string): { row: number; column: number } | null => {
    const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(address);
    if (!match) return null;
    let column = 0;
    for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
    return { column, row: Number(match[2]) };
  };
  const a = parse(start!);
  const b = parse(end);
  if (!a || !b) return true;
  return Math.max(a.row, b.row) >= firstRow && Math.min(a.row, b.row) <= lastRow
    && Math.max(a.column, b.column) >= 1 && Math.min(a.column, b.column) <= lastColumn;
}

/**
 * Returns bounded worksheet metadata and, when requested, only one selected
 * header row. Cell values outside that row are never returned to the client.
 */
export async function inspectQualityDataXlsx(
  bytes: Uint8Array,
  worksheetName?: string,
  headerRow?: number,
): Promise<QualityDataXlsxInspectionResult> {
  const fail = (code: QualityDataXlsxDiagnosticCode): QualityDataXlsxInspectionFailure => ({
    status: "invalid",
    diagnostics: [{ code }],
  });
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > QUALITY_DATA_MAX_SOURCE_BYTES) {
    return fail("XLSX_ARCHIVE_LIMIT_EXCEEDED");
  }
  const archive = inspectXlsxArchive(bytes);
  if (typeof archive === "string") return fail(archive);
  const expansion = await verifyActualArchiveExpansion(bytes, archive);
  if (expansion === "limit") return fail("XLSX_ARCHIVE_LIMIT_EXCEEDED");
  if (expansion !== "valid") return fail("INVALID_XLSX_ARCHIVE");

  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    return fail("XLSX_WORKBOOK_INVALID");
  }
  if (workbook.worksheets.length > QUALITY_DATA_XLSX_MAX_WORKSHEETS) return fail("XLSX_WORKSHEET_LIMIT_EXCEEDED");
  const worksheets = workbook.worksheets.map((worksheet) => ({
    name: worksheet.name,
    visible: worksheet.state === "visible",
    row_count: worksheet.rowCount,
    column_count: worksheet.columnCount,
  }));
  if (worksheetName === undefined && headerRow === undefined) {
    return { status: "inspected", worksheets: worksheets.filter((worksheet) => worksheet.visible) };
  }
  if (worksheetName === undefined || headerRow === undefined || !Number.isSafeInteger(headerRow) || headerRow < 1 || headerRow > 10_000) {
    return fail("XLSX_HEADER_ROW_INVALID");
  }
  const worksheet = workbook.getWorksheet(worksheetName);
  if (!worksheet) return fail("XLSX_WORKSHEET_NOT_FOUND");
  if (worksheet.state !== "visible") return fail("XLSX_WORKSHEET_NOT_VISIBLE");
  if (worksheet.rowCount > QUALITY_DATA_MAX_RECORDS + headerRow || worksheet.rowCount > 1_048_576) return fail("XLSX_ROW_LIMIT_EXCEEDED");
  if (worksheet.columnCount > QUALITY_DATA_XLSX_MAX_COLUMNS || worksheet.columnCount > 16_384) return fail("XLSX_COLUMN_LIMIT_EXCEEDED");
  if (headerRow > worksheet.rowCount || worksheet.columnCount === 0) return fail("XLSX_HEADER_ROW_INVALID");

  const header = worksheet.getRow(headerRow);
  const headers: { column_reference: string; value: string }[] = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const value = header.getCell(column).value;
    if (value === null || value === undefined) continue;
    if (formulaLike(value) || typeof value !== "string" || value.trim().length === 0 || value.trim().length > 200) {
      return fail(formulaLike(value) ? "XLSX_FORMULA_UNSUPPORTED" : "XLSX_HEADER_ROW_INVALID");
    }
    headers.push({ column_reference: `${excelColumnName(column)}${headerRow}`, value: value.trim() });
  }
  if (headers.length === 0) return fail("XLSX_HEADER_MISSING");
  return { status: "inspected", worksheets, selected_worksheet: worksheet.name, header_row: headerRow, headers };
}

export async function parseQualityDataXlsx(
  bytes: Uint8Array,
  mappingInput: unknown,
): Promise<QualityDataXlsxParseResult> {
  const diagnostics: QualityDataXlsxDiagnostic[] = [];
  let diagnosticsTruncated = false;
  const add = (diagnostic: QualityDataXlsxDiagnostic) => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
    else diagnosticsTruncated = true;
  };
  const fail = (code: QualityDataXlsxDiagnosticCode): QualityDataXlsxParseFailure => ({ status: "invalid", diagnostics: [{ code }], diagnostics_truncated: false });

  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > QUALITY_DATA_MAX_SOURCE_BYTES) {
    return fail("XLSX_ARCHIVE_LIMIT_EXCEEDED");
  }
  const mapping = qualityDataXlsxMappingSchema.safeParse(mappingInput);
  if (!mapping.success) return fail("INVALID_MAPPING");
  const archive = inspectXlsxArchive(bytes);
  if (typeof archive === "string") return fail(archive);
  const expansion = await verifyActualArchiveExpansion(bytes, archive);
  if (expansion === "limit") return fail("XLSX_ARCHIVE_LIMIT_EXCEEDED");
  if (expansion !== "valid") return fail("INVALID_XLSX_ARCHIVE");

  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    return fail("XLSX_WORKBOOK_INVALID");
  }

  if (workbook.worksheets.length > QUALITY_DATA_XLSX_MAX_WORKSHEETS) return fail("XLSX_WORKSHEET_LIMIT_EXCEEDED");
  const worksheet = workbook.getWorksheet(mapping.data.worksheet_name);
  if (!worksheet) return fail("XLSX_WORKSHEET_NOT_FOUND");
  if (worksheet.state !== "visible") return fail("XLSX_WORKSHEET_NOT_VISIBLE");
  if (worksheet.rowCount > QUALITY_DATA_MAX_RECORDS + mapping.data.header_row
    || worksheet.rowCount > 1_048_576) return fail("XLSX_ROW_LIMIT_EXCEEDED");
  if (worksheet.columnCount > QUALITY_DATA_XLSX_MAX_COLUMNS || worksheet.columnCount > 16_384) return fail("XLSX_COLUMN_LIMIT_EXCEEDED");

  const headerRow = worksheet.getRow(mapping.data.header_row);
  const lastColumn = Math.max(worksheet.columnCount, mapping.data.columns.length);
  if (mapping.data.header_row > worksheet.rowCount || lastColumn === 0) return fail("XLSX_HEADER_ROW_INVALID");
  const dataLastRow = worksheet.rowCount;
  const merges = worksheet.model.merges ?? [];
  if (merges.some((merge) => rangeIntersectsData(merge, mapping.data.header_row, dataLastRow, lastColumn))) {
    return fail("XLSX_MERGED_DATA_CELLS_UNSUPPORTED");
  }

  const headerToColumn = new Map<string, number>();
  const columnToHeader = new Map<number, string>();
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = headerRow.getCell(column);
    const value = cell.value;
    if (formulaLike(value)) {
      add({ code: "XLSX_FORMULA_UNSUPPORTED", worksheet: worksheet.name, row_number: mapping.data.header_row, cell_reference: `${excelColumnName(column)}${mapping.data.header_row}` });
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      add({ code: "XLSX_HEADER_ROW_INVALID", worksheet: worksheet.name, row_number: mapping.data.header_row, cell_reference: cell.address });
      continue;
    }
    const header = value.trim();
    if (headerToColumn.has(header)) {
      add({ code: "XLSX_HEADER_DUPLICATE", worksheet: worksheet.name, row_number: mapping.data.header_row, cell_reference: cell.address });
    } else {
      headerToColumn.set(header, column);
      columnToHeader.set(column, header);
    }
  }
  for (const column of mapping.data.columns) {
    if (!headerToColumn.has(column.header)) add({ code: "XLSX_MAPPING_HEADER_NOT_FOUND", worksheet: worksheet.name, row_number: mapping.data.header_row, field_key: column.field_key });
  }
  const mappedHeaders = new Set(mapping.data.columns.map((column) => column.header));
  const ignoredHeaders = new Set(mapping.data.ignored_headers);
  for (const header of ignoredHeaders) {
    if (!headerToColumn.has(header)) add({ code: "XLSX_IGNORED_HEADER_NOT_FOUND", worksheet: worksheet.name, row_number: mapping.data.header_row });
  }
  for (const [header, column] of headerToColumn) {
    if (!mappedHeaders.has(header) && !ignoredHeaders.has(header)) {
      add({ code: "XLSX_UNMAPPED_HEADER", worksheet: worksheet.name, row_number: mapping.data.header_row, cell_reference: `${excelColumnName(column)}${mapping.data.header_row}` });
    }
  }

  const records: QualityDataRecord[] = [];
  let fieldCount = 0;
  let estimatedFieldBytes = 0;
  let estimatedRecordBytes = 0;
  let fieldLimitReached = false;
  for (let rowNumber = mapping.data.header_row + 1; rowNumber <= dataLastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let rowHasAnyValue = false;
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = row.getCell(column);
      if (isNonBlank(cell.value)) rowHasAnyValue = true;
      if (formulaLike(cell.value)) {
        add({ code: "XLSX_FORMULA_UNSUPPORTED", worksheet: worksheet.name, row_number: rowNumber, cell_reference: cell.address });
      }
      if (!columnToHeader.has(column) && isNonBlank(cell.value)) {
        add({ code: "XLSX_HEADER_MISSING", worksheet: worksheet.name, row_number: rowNumber, cell_reference: cell.address });
      }
    }
    if (!rowHasAnyValue) continue;

    const fields: QualityDataRecord["fields"][number][] = [];
    let rowHasMappedValue = false;
    for (const columnMapping of mapping.data.columns) {
      const column = headerToColumn.get(columnMapping.header);
      if (column === undefined) continue;
      const cell = row.getCell(column);
      if (cell.value !== null && cell.value !== undefined) rowHasMappedValue = true;
      if (formulaLike(cell.value)) continue; // The formula diagnostic was recorded by the bounded row scan above.
      const value = toMappedField(cell.value, columnMapping);
      if (value === "missing") {
        add({ code: "XLSX_REQUIRED_VALUE_MISSING", worksheet: worksheet.name, row_number: rowNumber, cell_reference: cell.address, field_key: columnMapping.field_key });
      } else if (value === "mismatch") {
        add({ code: "XLSX_VALUE_TYPE_MISMATCH", worksheet: worksheet.name, row_number: rowNumber, cell_reference: cell.address, field_key: columnMapping.field_key });
      } else if (value === "invalid_date") {
        add({ code: "XLSX_DATE_INVALID", worksheet: worksheet.name, row_number: rowNumber, cell_reference: cell.address, field_key: columnMapping.field_key });
      } else if (value === "unsupported") {
        add({ code: formulaLike(cell.value) ? "XLSX_FORMULA_UNSUPPORTED" : "XLSX_CELL_VALUE_UNSUPPORTED", worksheet: worksheet.name, row_number: rowNumber, cell_reference: cell.address, field_key: columnMapping.field_key });
      } else {
        const field = {
          field_key: columnMapping.field_key,
          value_type: value.value_type,
          original_value: value.original_value,
          normalized_value: value.normalized_value ?? null,
          ...(columnMapping.normalized_unit === undefined ? {} : { normalized_unit: columnMapping.normalized_unit }),
          source_cell_reference: cell.address,
        } as QualityDataRecord["fields"][number];
        const serializedFieldBytes = Buffer.byteLength(JSON.stringify(field), "utf8");
        if (fieldCount >= QUALITY_DATA_MAX_FIELDS) {
          add({ code: "XLSX_FIELD_LIMIT_EXCEEDED", worksheet: worksheet.name, row_number: rowNumber });
          fieldLimitReached = true;
          break;
        }
        if (estimatedFieldBytes + serializedFieldBytes > QUALITY_DATA_MAX_BUNDLE_BYTES) {
          add({ code: "XLSX_FIELD_VALUE_LIMIT_EXCEEDED", worksheet: worksheet.name, row_number: rowNumber, cell_reference: cell.address, field_key: columnMapping.field_key });
          fieldLimitReached = true;
          break;
        }
        fields.push(field);
        estimatedFieldBytes += serializedFieldBytes;
        fieldCount += 1;
      }
    }
    if (!rowHasMappedValue) {
      add({ code: "XLSX_ROW_HAS_NO_MAPPED_VALUES", worksheet: worksheet.name, row_number: rowNumber });
    }
    if (fields.length > 0) {
      const record = { source_worksheet: worksheet.name, source_row_number: rowNumber, fields };
      const serializedRecordBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
      const nextRecordBytes = estimatedRecordBytes + serializedRecordBytes + (records.length > 0 ? 1 : 0);
      if (nextRecordBytes + MAX_INGESTION_ENVELOPE_BYTES > QUALITY_DATA_MAX_BUNDLE_BYTES) {
        add({ code: "XLSX_FIELD_VALUE_LIMIT_EXCEEDED", worksheet: worksheet.name, row_number: rowNumber });
        fieldLimitReached = true;
        break;
      }
      records.push(record);
      estimatedRecordBytes = nextRecordBytes;
    }
    if (records.length > QUALITY_DATA_MAX_RECORDS) add({ code: "XLSX_RECORD_LIMIT_EXCEEDED", worksheet: worksheet.name, row_number: rowNumber });
    if (fieldLimitReached) break;
  }
  if (records.length === 0 && diagnostics.length === 0) add({ code: "XLSX_NO_DATA_ROWS", worksheet: worksheet.name });
  if (diagnostics.length > 0) return { status: "invalid", diagnostics, diagnostics_truncated: diagnosticsTruncated };
  return { status: "parsed", records, record_count: records.length, field_count: fieldCount };
}

export function xlsxArchiveSizeFailure(bytes: Uint8Array): boolean {
  return bytes.byteLength > QUALITY_DATA_MAX_SOURCE_BYTES;
}
