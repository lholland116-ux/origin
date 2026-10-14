import * as fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PDFDocument,
  PageSizes,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
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

const PAGE_WIDTH = PageSizes.Letter[0];
const PAGE_HEIGHT = PageSizes.Letter[1];
const MARGIN_X = 54;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const BODY_SIZE = 10.5;
const BODY_LINE_HEIGHT = 14;
const TABLE_SIZE = 9;
const TABLE_LINE_HEIGHT = 12;
const TABLE_PADDING_X = 5;
const TABLE_PADDING_Y = 5;
const SECTION_GAP = 12;
const HEADING_GAPS: Record<1 | 2 | 3, number> = { 1: 20, 2: 16, 3: 14 };
// These licensed assets ship with the application ZIP; production does not
// depend on fonts installed on the Hostinger machine.
const FONT_ASSET_DIRECTORY = join(process.cwd(), "lib/documents/generation/assets");

let embeddedFontBytes: Promise<readonly [Uint8Array, Uint8Array]> | undefined;

function loadEmbeddedFontBytes(): Promise<readonly [Uint8Array, Uint8Array]> {
  embeddedFontBytes ??= Promise.all([
    readFile(join(FONT_ASSET_DIRECTORY, "DejaVuSans.ttf")),
    readFile(join(FONT_ASSET_DIRECTORY, "DejaVuSans-Bold.ttf")),
  ]);
  return embeddedFontBytes;
}

type TextStyle = {
  readonly font: PDFFont;
  readonly boldFont: PDFFont;
  readonly size: number;
  readonly lineHeight: number;
};

type RichTextSegment = {
  readonly text: string;
  readonly bold: boolean;
};

type RichTextLine = readonly RichTextSegment[];

type MarkdownBlock =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: "table"; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };

function unsupportedCharacter(text: string, characterSet: Set<number>): string | null {
  for (const character of text) {
    // The renderer normalizes these controls into line breaks or spaces before
    // passing text to pdf-lib. Validate the characters that reach the font,
    // while allowing the bounded whitespace the renderer already handles.
    if (character === "\n" || character === "\r" || character === "\t" || character === "\f" || character === "\v") continue;
    if (!characterSet.has(character.codePointAt(0) ?? 0)) return character;
  }
  return null;
}

function validateSupportedText(
  request: StructuredDocumentRequest,
  characterSet: Set<number>,
): void {
  const values: string[] = [];
  if (request.title) values.push(request.title);

  for (const section of request.sections) {
    if (section.type === "table") values.push(...section.columns, ...section.rows.flat());
    else if (section.type === "list") values.push(...section.items);
    else values.push(section.text);
  }

  for (const value of values) {
    const unsupported = unsupportedCharacter(value, characterSet);
    if (unsupported) {
      const codePoint = `U+${(unsupported.codePointAt(0) ?? 0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")}`;
      throw new DocumentGenerationValidationError([
        `PDF text contains an unsupported character (${codePoint}).`,
        "The embedded PDF font does not support this character.",
      ]);
    }
  }
}

function fontForSegment(segment: RichTextSegment, style: TextStyle): PDFFont {
  return segment.bold ? style.boldFont : style.font;
}

function inlineSegments(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const pattern = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), bold: false });
    segments.push({ text: match[2] ?? "", bold: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), bold: false });
  return segments.length > 0 ? segments : [{ text, bold: false }];
}

function splitLongWord(word: string, style: TextStyle, maxWidth: number, bold: boolean): string[] {
  const chunks: string[] = [];
  let chunk = "";
  const font = bold ? style.boldFont : style.font;
  for (const character of word) {
    const candidate = `${chunk}${character}`;
    if (chunk && font.widthOfTextAtSize(candidate, style.size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapRichText(text: string, style: TextStyle, maxWidth: number): RichTextLine[] {
  const lines: RichTextLine[] = [];
  for (const paragraph of text.replace(/\r\n/g, "\n").split("\n")) {
    const sourceSegments = inlineSegments(paragraph);
    const words: Array<{ word: string; bold: boolean; spaceBefore: boolean }> = [];
    let previousSegmentEndsWithSpace = false;
    for (const segment of sourceSegments) {
      for (const match of segment.text.matchAll(/\S+/g)) {
        const index = match.index ?? 0;
        words.push({
          word: match[0]!,
          bold: segment.bold,
          spaceBefore: index > 0
            ? /\s/.test(segment.text[index - 1] ?? "")
            : previousSegmentEndsWithSpace,
        });
      }
      previousSegmentEndsWithSpace = /\s$/.test(segment.text);
    }
    if (words.length === 0) {
      lines.push([]);
      continue;
    }

    let line: RichTextSegment[] = [];
    let lineWidth = 0;
    for (const { word, bold, spaceBefore } of words) {
      const font = bold ? style.boldFont : style.font;
      const parts =
        font.widthOfTextAtSize(word, style.size) > maxWidth
          ? splitLongWord(word, style, maxWidth, bold)
          : [word];
      for (const part of parts) {
        const partWidth = font.widthOfTextAtSize(part, style.size);
        const separatorWidth = line.length > 0 && spaceBefore
          ? style.font.widthOfTextAtSize(" ", style.size)
          : 0;
        if (line.length > 0 && lineWidth + separatorWidth + partWidth > maxWidth) {
          lines.push(line);
          line = [{ text: part, bold }];
          lineWidth = partWidth;
        } else {
          if (separatorWidth > 0) {
            line.push({ text: " ", bold: false });
            lineWidth += separatorWidth;
          }
          line.push({ text: part, bold });
          lineWidth += partWidth;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

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
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseMarkdownBlocks(text: string, titleToSuppress?: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let titleSuppressed = false;
  let inFence = false;
  const flushParagraph = (): void => {
    const value = paragraph.join("\n").trim();
    if (value) blocks.push({ type: "paragraph", text: value });
    paragraph = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (/^ {0,3}(?:```|~~~)/.test(line)) {
      if (!inFence) flushParagraph();
      paragraph.push(line);
      inFence = !inFence;
      if (!inFence) flushParagraph();
      index += 1;
      continue;
    }
    if (inFence) {
      paragraph.push(line);
      index += 1;
      continue;
    }
    const heading = /^ {0,3}(#{1,3})[\t ]+(.+?)[\t ]*#*[\t ]*$/.exec(line);
    if (heading) {
      const headingText = heading[2]?.trim() ?? "";
      if (!titleSuppressed && titleToSuppress && heading[1] === "#" && headingText === titleToSuppress.trim()) {
        flushParagraph();
        titleSuppressed = true;
        index += 1;
        continue;
      }
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3, text: headingText });
      index += 1;
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const match = orderedList ? /^\s*\d+[.)]\s+(.+)$/.exec(current) : /^\s*[-*+]\s+(.+)$/.exec(current);
        if (!match) break;
        items.push(match[1]!.trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDelimiter(lines[index + 1] ?? "")) {
      const columns = splitTableRow(line);
      if (columns.length > 0 && columns.every((column) => column.length > 0)) {
        flushParagraph();
        index += 2;
        const rows: string[][] = [];
        while (index < lines.length && (lines[index] ?? "").includes("|")) {
          rows.push(splitTableRow(lines[index] ?? ""));
          index += 1;
        }
        blocks.push({ type: "table", columns, rows: rows.filter((row) => row.length === columns.length) });
        continue;
      }
    }

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}

class PdfLayout {
  private page: PDFPage;
  private y = PAGE_HEIGHT - MARGIN_TOP;

  constructor(
    private readonly document: PDFDocument,
    private readonly bodyFont: PDFFont,
  ) {
    this.page = document.addPage(PageSizes.Letter);
  }

  private addPage(): void {
    this.page = this.document.addPage(PageSizes.Letter);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
  }

  private ensureSpace(height: number): void {
    if (this.y - height < MARGIN_BOTTOM) this.addPage();
  }

  private drawLines(
    lines: readonly RichTextLine[],
    style: TextStyle,
    x: number,
    width: number,
    color = rgb(0.12, 0.14, 0.18),
  ): void {
    for (const line of lines) {
      this.ensureSpace(style.lineHeight);
      let offset = x;
      for (const segment of line) {
        const font = fontForSegment(segment, style);
        this.page.drawText(segment.text, {
          x: offset,
          y: this.y - style.size,
          size: style.size,
          font,
          color,
          maxWidth: Math.max(1, width - (offset - x)),
        });
        offset += font.widthOfTextAtSize(segment.text, style.size);
      }
      this.y -= style.lineHeight;
    }
  }

  drawTitle(title: string, style: TextStyle): void {
    this.drawLines(
      wrapRichText(title, style, CONTENT_WIDTH),
      style,
      MARGIN_X,
      CONTENT_WIDTH,
      rgb(0.05, 0.08, 0.14),
    );
    this.y -= 10;
  }

  drawHeading(text: string, level: 1 | 2 | 3, style: TextStyle): void {
    this.y -= HEADING_GAPS[level];
    this.drawLines(
      wrapRichText(text, style, CONTENT_WIDTH),
      style,
      MARGIN_X,
      CONTENT_WIDTH,
      rgb(0.05, 0.08, 0.14),
    );
    this.y -= 4;
  }

  drawParagraph(text: string, style: TextStyle): void {
    this.drawLines(wrapRichText(text, style, CONTENT_WIDTH), style, MARGIN_X, CONTENT_WIDTH);
    this.y -= SECTION_GAP;
  }

  drawList(items: readonly string[], ordered: boolean, style: TextStyle): void {
    const indent = 18;
    const textWidth = CONTENT_WIDTH - indent;
    items.forEach((item, index) => {
      const lines = wrapRichText(item, style, textWidth - 4);
      this.ensureSpace(style.lineHeight);
      this.page.drawText(ordered ? `${index + 1}.` : "•", {
        x: MARGIN_X,
        y: this.y - style.size,
        size: style.size,
        font: style.font,
        color: rgb(0.12, 0.14, 0.18),
      });
      this.drawLines(lines, style, MARGIN_X + indent, textWidth);
      this.y -= 3;
    });
    this.y -= SECTION_GAP;
  }

  drawTable(section: Extract<DocumentSection, { type: "table" }>, style: TextStyle, headerFont: PDFFont): void {
    const columnWidth = CONTENT_WIDTH / section.columns.length;
    const headerStyle: TextStyle = {
      font: headerFont,
      boldFont: headerFont,
      size: TABLE_SIZE,
      lineHeight: TABLE_LINE_HEIGHT,
    };
    const bodyStyle: TextStyle = {
      font: this.bodyFont,
      boldFont: headerFont,
      size: TABLE_SIZE,
      lineHeight: TABLE_LINE_HEIGHT,
    };
    this.drawTableRow(section.columns, columnWidth, headerStyle, true);
    for (const row of section.rows) this.drawTableRow(row, columnWidth, bodyStyle, false);
    this.y -= SECTION_GAP;
  }

  private drawTableRow(
    cells: readonly string[],
    columnWidth: number,
    style: TextStyle,
    header: boolean,
  ): void {
    const cellWidth = Math.max(1, columnWidth - TABLE_PADDING_X * 2);
    const cellLines = cells.map((cell) => wrapRichText(cell, style, cellWidth));
    const rowLines = Math.max(...cellLines.map((lines) => lines.length), 1);
    const rowHeight = rowLines * TABLE_LINE_HEIGHT + TABLE_PADDING_Y * 2;
    this.ensureSpace(rowHeight);
    const top = this.y;
    this.page.drawRectangle({
      x: MARGIN_X,
      y: top - rowHeight,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: header ? rgb(0.9, 0.93, 0.97) : rgb(0.98, 0.98, 0.98),
      borderColor: rgb(0.72, 0.76, 0.82),
      borderWidth: 0.5,
    });
    cellLines.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        let offset = MARGIN_X + index * columnWidth + TABLE_PADDING_X;
        for (const segment of line) {
          const font = fontForSegment(segment, style);
          this.page.drawText(segment.text, {
            x: offset,
            y: top - TABLE_PADDING_Y - style.size - lineIndex * TABLE_LINE_HEIGHT,
            size: style.size,
            font,
            color: rgb(0.12, 0.14, 0.18),
            maxWidth: Math.max(1, cellWidth - (offset - (MARGIN_X + index * columnWidth + TABLE_PADDING_X))),
          });
          offset += font.widthOfTextAtSize(segment.text, style.size);
        }
      });
      if (index > 0) {
        this.page.drawLine({
          start: { x: MARGIN_X + index * columnWidth, y: top },
          end: { x: MARGIN_X + index * columnWidth, y: top - rowHeight },
          color: rgb(0.72, 0.76, 0.82),
          thickness: 0.5,
        });
      }
    });
    this.y -= rowHeight;
  }

  render(
    sections: readonly DocumentSection[],
    fonts: { readonly body: PDFFont; readonly bold: PDFFont },
    titleToSuppress?: string,
  ): void {
    const bodyStyle: TextStyle = {
      font: fonts.body,
      boldFont: fonts.bold,
      size: BODY_SIZE,
      lineHeight: BODY_LINE_HEIGHT,
    };
    const headingStyles: Record<1 | 2 | 3, TextStyle> = {
      1: { font: fonts.bold, boldFont: fonts.bold, size: 17, lineHeight: 22 },
      2: { font: fonts.bold, boldFont: fonts.bold, size: 14, lineHeight: 19 },
      3: { font: fonts.bold, boldFont: fonts.bold, size: 12, lineHeight: 16 },
    };
    let titleSuppressed = false;
    for (const section of sections) {
      if (section.type === "heading") {
        this.drawHeading(section.text, section.level, headingStyles[section.level]);
      } else if (section.type === "paragraph") {
        const blocks = parseMarkdownBlocks(
          section.text,
          !titleSuppressed ? titleToSuppress : undefined,
        );
        if (titleToSuppress && section.text.trimStart().startsWith("# ")) titleSuppressed = true;
        for (const block of blocks) {
          if (block.type === "heading") this.drawHeading(block.text, block.level, headingStyles[block.level]);
          else if (block.type === "paragraph") this.drawParagraph(block.text, bodyStyle);
          else if (block.type === "list") this.drawList(block.items, block.ordered, bodyStyle);
          else this.drawTable(block, bodyStyle, fonts.bold);
        }
      } else if (section.type === "list") {
        this.drawList(section.items, section.ordered, bodyStyle);
      } else {
        this.drawTable(section, bodyStyle, fonts.bold);
      }
    }
  }
}

export async function generatePdfArtifact(
  request: StructuredDocumentRequest & { readonly format: "pdf" },
): Promise<GeneratedArtifact> {
  assertValidGenerationRequest(request);
  const document = await PDFDocument.create({ updateMetadata: false });
  document.registerFontkit(fontkit);
  const [bodyFontBytes, boldFontBytes] = await loadEmbeddedFontBytes();
  const bodyFont = await document.embedFont(bodyFontBytes, { subset: true });
  const boldFont = await document.embedFont(boldFontBytes, { subset: true });
  validateSupportedText(request, new Set(bodyFont.getCharacterSet()));

  const layout = new PdfLayout(document, bodyFont);
  if (request.title) {
    layout.drawTitle(request.title, { font: boldFont, boldFont, size: 22, lineHeight: 28 });
  }
  layout.render(request.sections, { body: bodyFont, bold: boldFont }, request.title);

  const bytes = await document.save({ useObjectStreams: false });
  const artifact: GeneratedArtifact = {
    filename: sanitizeFilename(request.filename, "pdf"),
    mimeType: getDocumentMimeType("pdf"),
    bytes,
    sizeBytes: bytes.byteLength,
    format: "pdf",
  };
  const issues = validateGeneratedArtifact(artifact);
  if (issues.length > 0) throw new DocumentGenerationValidationError(issues);
  return artifact;
}
