import { OfficeParser, type OfficeContentNode } from "officeparser";
import { MAX_EXTRACTED_TEXT_LENGTH } from "@/lib/documents/extract-limits";
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_WORKBOOK_CELL_TEXT_LENGTH,
} from "@/lib/documents/generation/validation";

const MAX_DOCX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_ZIP_ENTRIES = 1_000;
const MAX_DOCX_TABLE_CELLS = MAX_TABLE_COLUMNS * MAX_TABLE_ROWS;

type DocxCellMetadata = Readonly<{
  style?: unknown;
  colSpan?: unknown;
  rowSpan?: unknown;
}>;

function cellMetadata(cell: OfficeContentNode): DocxCellMetadata {
  const metadata: unknown = cell.metadata;
  return metadata && typeof metadata === "object" ? metadata as DocxCellMetadata : {};
}

export class UnsupportedDocxTableError extends Error {
  constructor() {
    super("The Word document contains a table structure that cannot be safely extracted.");
    this.name = "UnsupportedDocxTableError";
  }
}

function textOfCell(cell: OfficeContentNode): string {
  const children = cell.children ?? [];
  if (children.some((child) => ["table", "image", "chart", "drawing", "embed"].includes(child.type))) {
    throw new UnsupportedDocxTableError();
  }

  const value = cell.text ?? children.map((child) => child.text ?? "").join("\n");
  if (value.length > MAX_WORKBOOK_CELL_TEXT_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new UnsupportedDocxTableError();
  }
  return value;
}

function tableRows(table: OfficeContentNode): readonly { readonly header: boolean; readonly cells: readonly string[] }[] {
  const rows = table.children ?? [];
  if (rows.length === 0 || rows.length > MAX_TABLE_ROWS || rows.some((row) => row.type !== "row")) {
    throw new UnsupportedDocxTableError();
  }

  const parsed = rows.map((row) => {
    const cells = row.children ?? [];
    if (cells.length === 0 || cells.length > MAX_TABLE_COLUMNS || cells.some((cell) => cell.type !== "cell")) {
      throw new UnsupportedDocxTableError();
    }

    const headers = cells.map((cell) => cellMetadata(cell).style === "header");
    if (headers.some(Boolean) && !headers.every(Boolean)) throw new UnsupportedDocxTableError();

    const unsupportedSpan = cells.some((cell) => {
      const metadata = cellMetadata(cell);
      return (metadata.colSpan !== undefined && metadata.colSpan !== 1)
        || (metadata.rowSpan !== undefined && metadata.rowSpan !== 1);
    });
    if (unsupportedSpan) throw new UnsupportedDocxTableError();

    return { header: headers.every(Boolean), cells: cells.map(textOfCell) };
  });

  const columnCount = parsed[0]?.cells.length ?? 0;
  if (columnCount < 1 || parsed.some((row) => row.cells.length !== columnCount)) {
    throw new UnsupportedDocxTableError();
  }
  if (parsed.slice(1).some((row) => row.header)) throw new UnsupportedDocxTableError();
  return parsed;
}

/**
 * Returns null when the DOCX has no tables so the existing Mammoth raw-text
 * path can preserve its established non-table extraction behavior.
 */
export async function extractDocxTableContext(buffer: Buffer): Promise<string | null> {
  const ast = await OfficeParser.parseOffice(buffer, {
    fileType: "docx",
    includeRawContent: false,
    ignoreHeadersAndFooters: true,
    decompressionLimits: {
      maxUncompressedBytes: MAX_DOCX_UNCOMPRESSED_BYTES,
      maxZipEntries: MAX_DOCX_ZIP_ENTRIES,
      maxTableCells: MAX_DOCX_TABLE_CELLS,
    },
  });
  const tables = ast.content.filter((node) => node.type === "table");
  if (tables.length === 0) return null;
  if (tables.length !== 1 || ast.warnings.some((warning) => warning.code === "TABLE_CELL_LIMIT_EXCEEDED")) {
    throw new UnsupportedDocxTableError();
  }

  const table = tables[0]!;
  const rows = tableRows(table);
  const sections: string[] = [];
  for (const node of ast.content) {
    if (node === table) {
      sections.push(`DOCX_TABLE_JSON ${JSON.stringify({ rows })}`);
      continue;
    }
    if (["image", "chart", "drawing", "embed"].includes(node.type)) {
      throw new UnsupportedDocxTableError();
    }
    const text = node.text?.replace(/\u0000/g, "").trim();
    if (text) sections.push(text);
  }

  const result = sections.join("\n\n");
  if (!result || result.length > MAX_EXTRACTED_TEXT_LENGTH) throw new UnsupportedDocxTableError();
  return result;
}
