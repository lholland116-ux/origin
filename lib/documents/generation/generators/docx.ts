import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TableLayoutType,
  TextRun,
  WidthType,
} from "docx";
import type {
  DocumentSection,
  GeneratedArtifact,
  StructuredDocumentRequest,
} from "../contracts";
import { sanitizeFilename } from "../filenames";
import { getDocumentMimeType } from "../mime";
import {
  assertValidGenerationRequest,
  DocumentGenerationValidationError,
  validateGeneratedArtifact,
} from "../validation";

const ORDERED_LIST_REFERENCE = "lvtchat-ordered-list";
const TABLE_WIDTH_TWIPS = 9_000;
const TABLE_CELL_HORIZONTAL_PADDING_TWIPS = 80;
const HEADER_CHARACTER_WIDTH_TWIPS = 100;
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "D6DEE8" } as const;

type ReportBlock =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: "table"; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };

type MarkdownRun = Readonly<{ text: string; bold: boolean; italics: boolean }>;

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of value) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim().replace(/\\\|/g, "|"));
      cell = "";
      continue;
    }
    escaped = character === "\\" && !escaped;
    if (character !== "\\" || escaped) cell += character;
    if (character !== "\\") escaped = false;
  }
  cells.push(cell.trim().replace(/\\\|/g, "|"));
  return cells;
}

function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function sameTitle(left: string, right: string): boolean {
  const normalize = (value: string): string => value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\p{P}+$/u, "")
    .trim()
    .toLowerCase();
  return normalize(left) === normalize(right);
}

/** Parse only the report Markdown emitted in generated-document body text. */
function parseReportMarkdown(
  text: string,
  titleToSuppress?: string,
): { readonly blocks: ReportBlock[]; readonly hasContent: boolean } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReportBlock[] = [];
  let paragraph: string[] = [];
  let leadingBlock = true;
  const flushParagraph = (): void => {
    const value = paragraph.join(" ").trim();
    if (value) {
      blocks.push({ type: "paragraph", text: value });
      leadingBlock = false;
    }
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const heading = /^ {0,3}(#{1,3})[\t ]+(.+?)[\t ]*#*[\t ]*$/.exec(line);
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const tableHeader = line.includes("|") && index + 1 < lines.length
      && isTableDelimiter(lines[index + 1] ?? "")
      ? splitTableRow(line)
      : null;

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (heading) {
      flushParagraph();
      const level = heading[1]!.length as 1 | 2 | 3;
      const headingText = heading[2]?.trim() ?? "";
      const isDuplicateTitle = leadingBlock && level === 1 && titleToSuppress
        && sameTitle(headingText, titleToSuppress);
      if (!isDuplicateTitle) {
        blocks.push({ type: "heading", level, text: headingText });
      }
      leadingBlock = false;
      index += 1;
      continue;
    }

    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const match = isOrdered
          ? /^\s*\d+[.)]\s+(.+)$/.exec(current)
          : /^\s*[-*+]\s+(.+)$/.exec(current);
        if (!match) break;
        items.push(match[1]!.trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      leadingBlock = false;
      continue;
    }

    if (tableHeader?.length && tableHeader.every(Boolean)) {
      const delimiter = splitTableRow(lines[index + 1] ?? "");
      const rows: string[][] = [];
      let next = index + 2;
      let validRows = true;
      while (next < lines.length && (lines[next] ?? "").includes("|")) {
        const row = splitTableRow(lines[next] ?? "");
        if (row.length !== tableHeader.length) {
          validRows = false;
          break;
        }
        rows.push(row);
        next += 1;
      }
      if (validRows && delimiter.length === tableHeader.length) {
        flushParagraph();
        blocks.push({ type: "table", columns: tableHeader, rows });
        leadingBlock = false;
        index = next;
        continue;
      }
    }

    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();
  return { blocks, hasContent: !leadingBlock };
}

function markdownRuns(text: string, forceBold = false): TextRun[] {
  const runs: MarkdownRun[] = [];
  const pattern = /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(?<![\w\\*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) runs.push({ text: text.slice(cursor, index), bold: false, italics: false });
    const isBold = match[2] !== undefined;
    runs.push({
      text: match[2] ?? match[3] ?? "",
      bold: isBold,
      italics: !isBold,
    });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), bold: false, italics: false });
  return (runs.length ? runs : [{ text, bold: false, italics: false }])
    .filter((run) => run.text.length > 0)
    .map((run) => new TextRun({
      text: run.text,
      bold: forceBold || run.bold,
      italics: run.italics,
    }));
}

function titleMatches(left: string | undefined, right: string): boolean {
  return Boolean(left?.trim()) && sameTitle(left!, right);
}

function isNumericCell(value: string): boolean {
  const normalized = value.trim().replace(/[,$€£¥\s]/g, "").replace(/−/g, "-");
  return /^\(?[+-]?\d+(?:\.\d+)?%?\)?$/.test(normalized);
}

function tableColumnWidths(columns: readonly string[], rows: readonly (readonly string[])[]): number[] {
  // Header phrases should wrap between words instead of taking width away
  // from neighboring columns. Reserve enough room for each header's longest
  // word, then distribute the remaining page width based on cell content.
  const weights = columns.map((_, index) => Math.min(36, Math.max(
    8,
    ...rows.map((row) => row[index] ?? "").map((value) => value.length),
  )));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const minimums = columns.map((column) => {
    const longestWord = column.trim().split(/\s+/).reduce((longest, word) => Math.max(longest, word.length), 0);
    return longestWord * HEADER_CHARACTER_WIDTH_TWIPS + TABLE_CELL_HORIZONTAL_PADDING_TWIPS * 2;
  });
  const minimumTotal = minimums.reduce((sum, width) => sum + width, 0);
  const minimumScale = minimumTotal > TABLE_WIDTH_TWIPS ? TABLE_WIDTH_TWIPS / minimumTotal : 1;
  const scaledMinimums = minimums.map((width) => Math.floor(width * minimumScale));
  const distributableWidth = TABLE_WIDTH_TWIPS - scaledMinimums.reduce((sum, width) => sum + width, 0);
  let assigned = 0;
  return weights.map((weight, index) => {
    const width = index === weights.length - 1
      ? TABLE_WIDTH_TWIPS - assigned
      : scaledMinimums[index]! + Math.floor(distributableWidth * weight / totalWeight);
    assigned += width;
    return width;
  });
}

function headingLevel(level: 1 | 2 | 3): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function listParagraphs(
  section: Extract<DocumentSection, { type: "list" }>,
): Paragraph[] {
  return section.items.map((item) => new Paragraph({
    children: markdownRuns(item),
    ...(section.ordered
      ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: 0 } }
      : { bullet: { level: 0 } }),
    spacing: { after: 70, line: 260 },
  }));
}

function tableCell(
  text: string,
  options: { readonly bold?: boolean; readonly numeric?: boolean; readonly width: number; readonly header?: boolean },
): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: markdownRuns(text, options.bold),
        alignment: options.numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { after: 0, line: 240 },
      }),
    ],
    width: { size: options.width, type: WidthType.DXA },
    margins: { top: 90, bottom: 90, left: TABLE_CELL_HORIZONTAL_PADDING_TWIPS, right: TABLE_CELL_HORIZONTAL_PADDING_TWIPS },
    verticalAlign: "center",
    ...(options.header ? { shading: { fill: "EAF1F8" } } : {}),
    borders: { top: TABLE_BORDER, bottom: TABLE_BORDER, left: TABLE_BORDER, right: TABLE_BORDER },
  });
}

function tableFromData(columns: readonly string[], rows: readonly (readonly string[])[]): Table {
  const widths = tableColumnWidths(columns, rows);
  const numericColumns = columns.map((_, columnIndex) => {
    const values = rows.map((row) => row[columnIndex] ?? "").filter((value) => value.trim().length > 0);
    return values.length > 0 && values.every(isNumericCell);
  });
  const allRows = [columns, ...rows].map((row, rowIndex) => new TableRow({
    tableHeader: rowIndex === 0,
    cantSplit: true,
    children: row.map((value, columnIndex) => tableCell(value, {
      bold: rowIndex === 0,
      numeric: numericColumns[columnIndex],
      width: widths[columnIndex]!,
      header: rowIndex === 0,
    })),
  }));

  return new Table({
    rows: allRows,
    width: { size: TABLE_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
  });
}

function sectionChildren(sections: readonly DocumentSection[], title?: string): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [];
  let firstBodyBlock = true;

  for (const section of sections) {
    if (section.type === "heading") {
      if (firstBodyBlock && section.level === 1 && titleMatches(title, section.text)) {
        firstBodyBlock = false;
        continue;
      }
      children.push(new Paragraph({
        children: markdownRuns(section.text),
        heading: headingLevel(section.level),
        spacing: { before: section.level === 1 ? 300 : 220, after: 120 },
        keepNext: true,
      }));
      firstBodyBlock = false;
    } else if (section.type === "paragraph") {
      const parsed = parseReportMarkdown(section.text, firstBodyBlock ? title : undefined);
      for (const block of parsed.blocks) children.push(...blockParagraphs(block));
      firstBodyBlock = firstBodyBlock && !parsed.hasContent ? firstBodyBlock : false;
    } else if (section.type === "list") {
      children.push(...listParagraphs(section));
      firstBodyBlock = false;
    } else {
      children.push(tableFromData(section.columns, section.rows));
      firstBodyBlock = false;
    }
  }

  return children;
}

function blockParagraphs(block: ReportBlock): Array<Paragraph | Table> {
  if (block.type === "heading") {
    return [new Paragraph({
      children: markdownRuns(block.text),
      heading: headingLevel(block.level),
      spacing: { before: block.level === 1 ? 300 : 220, after: 120 },
      keepNext: true,
    })];
  }
  if (block.type === "paragraph") {
    return [new Paragraph({ children: markdownRuns(block.text), spacing: { after: 160, line: 276 } })];
  }
  if (block.type === "list") {
    return block.items.map((item) => new Paragraph({
      children: markdownRuns(item),
      ...(block.ordered
        ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: 0 } }
        : { bullet: { level: 0 } }),
      spacing: { after: 70, line: 260 },
    }));
  }
  return [tableFromData(block.columns, block.rows)];
}

export async function generateDocxArtifact(
  request: StructuredDocumentRequest & { readonly format: "docx" },
): Promise<GeneratedArtifact> {
  assertValidGenerationRequest(request);

  const children: Array<Paragraph | Table> = [];
  if (request.title !== undefined && request.title.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({
          text: request.title,
          font: "Aptos Display",
          size: 38,
          bold: true,
          color: "17365D",
        })],
        heading: HeadingLevel.TITLE,
        spacing: { after: 260 },
      }),
    );
  }
  children.push(...sectionChildren(request.sections, request.title));

  const document = new Document({
    title: request.title,
    creator: "LVTChat",
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: "Aptos", size: 22, color: "243447" },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
        title: {
          run: { font: "Aptos Display", size: 38, bold: true, color: "17365D" },
          paragraph: { spacing: { after: 260 } },
        },
        heading1: {
          run: { font: "Aptos Display", size: 30, bold: true, color: "1F4E79" },
          paragraph: { spacing: { before: 300, after: 120 }, keepNext: true },
        },
        heading2: {
          run: { font: "Aptos Display", size: 26, bold: true, color: "365F91" },
          paragraph: { spacing: { before: 240, after: 100 }, keepNext: true },
        },
        heading3: {
          run: { font: "Aptos", size: 23, bold: true, color: "365F91" },
          paragraph: { spacing: { before: 180, after: 80 }, keepNext: true },
        },
      },
    },
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(document);
  const artifact: GeneratedArtifact = {
    filename: sanitizeFilename(request.filename, "docx"),
    mimeType: getDocumentMimeType("docx"),
    bytes: new Uint8Array(buffer),
    sizeBytes: buffer.byteLength,
    format: "docx",
  };
  const issues = validateGeneratedArtifact(artifact);

  if (issues.length > 0) {
    throw new DocumentGenerationValidationError(issues);
  }

  return artifact;
}
