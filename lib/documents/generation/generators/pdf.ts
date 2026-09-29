import {
  PDFDocument,
  PageSizes,
  StandardFonts,
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

type TextStyle = {
  readonly font: PDFFont;
  readonly size: number;
  readonly lineHeight: number;
};

function unsupportedCharacter(text: string, characterSet: Set<number>): string | null {
  for (const character of text) {
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
        "PDF generation currently supports Western Unicode and typographic punctuation only.",
      ]);
    }
  }
}

function splitLongWord(word: string, style: TextStyle, maxWidth: number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of word) {
    const candidate = `${chunk}${character}`;
    if (chunk && style.font.widthOfTextAtSize(candidate, style.size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapText(text: string, style: TextStyle, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      const parts =
        style.font.widthOfTextAtSize(word, style.size) > maxWidth
          ? splitLongWord(word, style, maxWidth)
          : [word];
      for (const part of parts) {
        const candidate = line ? `${line} ${part}` : part;
        if (line && style.font.widthOfTextAtSize(candidate, style.size) > maxWidth) {
          lines.push(line);
          line = part;
        } else {
          line = candidate;
        }
      }
    }
    lines.push(line);
  }
  return lines;
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
    lines: readonly string[],
    style: TextStyle,
    x: number,
    width: number,
    color = rgb(0.12, 0.14, 0.18),
  ): void {
    for (const line of lines) {
      this.ensureSpace(style.lineHeight);
      this.page.drawText(line, {
        x,
        y: this.y - style.size,
        size: style.size,
        font: style.font,
        color,
        maxWidth: width,
      });
      this.y -= style.lineHeight;
    }
  }

  drawTitle(title: string, style: TextStyle): void {
    this.drawLines(
      wrapText(title, style, CONTENT_WIDTH),
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
      wrapText(text, style, CONTENT_WIDTH),
      style,
      MARGIN_X,
      CONTENT_WIDTH,
      rgb(0.05, 0.08, 0.14),
    );
    this.y -= 4;
  }

  drawParagraph(text: string, style: TextStyle): void {
    this.drawLines(wrapText(text, style, CONTENT_WIDTH), style, MARGIN_X, CONTENT_WIDTH);
    this.y -= SECTION_GAP;
  }

  drawList(items: readonly string[], ordered: boolean, style: TextStyle): void {
    const indent = 18;
    const textWidth = CONTENT_WIDTH - indent;
    items.forEach((item, index) => {
      const lines = wrapText(item, style, textWidth - 4);
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
      size: TABLE_SIZE,
      lineHeight: TABLE_LINE_HEIGHT,
    };
    const bodyStyle: TextStyle = {
      font: this.bodyFont,
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
    const cellLines = cells.map((cell) => wrapText(cell, style, cellWidth));
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
        this.page.drawText(line, {
          x: MARGIN_X + index * columnWidth + TABLE_PADDING_X,
          y: top - TABLE_PADDING_Y - style.size - lineIndex * TABLE_LINE_HEIGHT,
          size: style.size,
          font: style.font,
          color: rgb(0.12, 0.14, 0.18),
          maxWidth: cellWidth,
        });
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
  ): void {
    const bodyStyle: TextStyle = {
      font: fonts.body,
      size: BODY_SIZE,
      lineHeight: BODY_LINE_HEIGHT,
    };
    const headingStyles: Record<1 | 2 | 3, TextStyle> = {
      1: { font: fonts.bold, size: 17, lineHeight: 22 },
      2: { font: fonts.bold, size: 14, lineHeight: 19 },
      3: { font: fonts.bold, size: 12, lineHeight: 16 },
    };
    for (const section of sections) {
      if (section.type === "heading") {
        this.drawHeading(section.text, section.level, headingStyles[section.level]);
      } else if (section.type === "paragraph") {
        this.drawParagraph(section.text, bodyStyle);
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
  const bodyFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  validateSupportedText(request, new Set(bodyFont.getCharacterSet()));

  const layout = new PdfLayout(document, bodyFont);
  if (request.title) {
    layout.drawTitle(request.title, { font: boldFont, size: 22, lineHeight: 28 });
  }
  layout.render(request.sections, { body: bodyFont, bold: boldFont });

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
