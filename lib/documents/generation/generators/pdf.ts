import * as fontkit from "fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import type { Font as FontkitFont } from "fontkit";
import type { DocumentSection, GeneratedArtifact, StructuredDocumentRequest } from "../contracts";
import { sanitizeFilename } from "../filenames";
import { getDocumentMimeType } from "../mime";
import {
  assertValidGenerationRequest,
  DocumentGenerationValidationError,
  MAX_ARTIFACT_BYTES,
  validateGeneratedArtifact,
} from "../validation";

const REGULAR_FONT = "LVTChatDejaVuSans";
const BOLD_FONT = "LVTChatDejaVuSansBold";
// Hostinger runs the source ZIP from its package root; both licensed font files ship there.
const FONT_ASSETS = [
  join(process.cwd(), "lib/documents/generation/assets/DejaVuSans.ttf"),
  join(process.cwd(), "lib/documents/generation/assets/DejaVuSans-Bold.ttf"),
] as const;
const PAGE_MARGINS = { top: 54, bottom: 54, left: 54, right: 54 } as const;
const BODY_SIZE = 10.5;
const TABLE_SIZE = 9;

type EmbeddedFonts = Readonly<{
  regular: Buffer;
  bold: Buffer;
  regularGlyphs: FontkitFont;
  boldGlyphs: FontkitFont;
}>;

let embeddedFonts: Promise<EmbeddedFonts> | undefined;

function loadFonts(): Promise<EmbeddedFonts> {
  embeddedFonts ??= Promise.all(FONT_ASSETS.map((asset) => readFile(asset))).then(([regular, bold]) => ({
    regular,
    bold,
    regularGlyphs: trueTypeFont(regular),
    boldGlyphs: trueTypeFont(bold),
  }));
  return embeddedFonts;
}

function trueTypeFont(bytes: Buffer): FontkitFont {
  const parsed = fontkit.create(bytes);
  if (!("hasGlyphForCodePoint" in parsed)) {
    throw new Error("Bundled PDF font is not a single TrueType font.");
  }
  return parsed;
}

type MarkdownBlock =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: "table"; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };

type InlineSegment = Readonly<{ text: string; bold: boolean }>;

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

/** Parse the limited Markdown blocks used in generated reports; PDFKit owns layout and pagination. */
function parseMarkdownBlocks(text: string, titleToSuppress?: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
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
      flushParagraph();
      if (!(heading[1] === "#" && titleToSuppress && headingText === titleToSuppress.trim())) {
        blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3, text: headingText });
      }
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
        const match = orderedList
          ? /^\s*\d+[.)]\s+(.+)$/.exec(current)
          : /^\s*[-*+]\s+(.+)$/.exec(current);
        if (!match) break;
        items.push(match[1]!.trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDelimiter(lines[index + 1] ?? "")) {
      const columns = splitTableRow(line);
      if (columns.length > 0 && columns.every(Boolean)) {
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

function inlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
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

function requestText(request: StructuredDocumentRequest): string[] {
  const values = request.title ? [request.title] : [];
  for (const section of request.sections) {
    if (section.type === "table") values.push(...section.columns, ...section.rows.flat());
    else if (section.type === "list") values.push(...section.items);
    else values.push(section.text);
  }
  return values;
}

function validateFontCoverage(request: StructuredDocumentRequest, fonts: EmbeddedFonts): void {
  const values = requestText(request);
  if (request.sections.some((section) => section.type === "list")) values.push("•");
  for (const value of values) {
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (/^[\t\n\r\f\v]$/.test(character)) continue;
      if (!fonts.regularGlyphs.hasGlyphForCodePoint(codePoint)
        || !fonts.boldGlyphs.hasGlyphForCodePoint(codePoint)) {
        const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
        throw new DocumentGenerationValidationError([
          `PDF text contains an unsupported character (${label}).`,
          "The bundled PDF fonts do not support this character.",
        ]);
      }
    }
  }
}

function hasContent(request: StructuredDocumentRequest): boolean {
  if (request.title?.trim()) return true;
  return request.sections.some((section) => {
    if (section.type === "table") return section.columns.some((cell) => cell.trim())
      || section.rows.some((row) => row.some((cell) => cell.trim()));
    if (section.type === "list") return section.items.some((item) => item.trim());
    return section.text.trim().length > 0;
  });
}

function drawRichText(
  document: InstanceType<typeof PDFDocument>,
  text: string,
  options: { readonly size: number; readonly color?: string; readonly baseBold?: boolean },
): void {
  const segments = inlineSegments(text);
  segments.forEach((segment, index) => {
    document
      .font(segment.bold || options.baseBold ? BOLD_FONT : REGULAR_FONT)
      .fontSize(options.size)
      .fillColor(options.color ?? "#202936")
      .text(segment.text, {
        continued: index < segments.length - 1,
        lineGap: 2,
        paragraphGap: 0,
      });
  });
  document.moveDown(0.45);
}

function isNumericCell(value: string): boolean {
  return /^\s*[($€£−-]?[\d,.%\s]+\)?\s*$/.test(value) && /\d/.test(value);
}

function drawTable(
  document: InstanceType<typeof PDFDocument>,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): void {
  const data = [columns, ...rows].map((row, rowIndex) => row.map((sourceText) => {
    const segments = inlineSegments(sourceText);
    const bold = rowIndex === 0 || (segments.length === 1 && segments[0]!.bold);
    const text = segments.map((segment) => segment.text).join("");
    return {
      text,
      font: { family: bold ? BOLD_FONT : REGULAR_FONT, size: TABLE_SIZE },
      align: rowIndex > 0 && isNumericCell(text) ? { x: "right" as const, y: "top" as const } : { x: "left" as const, y: "top" as const },
      ...(rowIndex === 0 ? { backgroundColor: "#e7edf5" } : {}),
    };
  }));
  document.table({
    data,
    columnStyles: columns.map(() => ({ width: "*", minWidth: 36 })),
    defaultStyle: {
      padding: { top: 5, bottom: 5, left: 6, right: 6 },
      border: 0.5,
      borderColor: "#bac5d1",
    },
  });
  document.moveDown(0.5);
}

function drawList(document: InstanceType<typeof PDFDocument>, items: readonly string[], ordered: boolean): void {
  document.font(REGULAR_FONT).fontSize(BODY_SIZE).fillColor("#202936").list([...items], {
    listType: ordered ? "numbered" : "bullet",
    bulletIndent: 8,
    textIndent: 22,
    paragraphGap: 3,
  });
  document.moveDown(0.4);
}

function renderMarkdown(document: InstanceType<typeof PDFDocument>, text: string, title?: string): void {
  for (const block of parseMarkdownBlocks(text, title)) {
    if (block.type === "heading") {
      document.moveDown(block.level === 1 ? 0.9 : 0.55);
      drawRichText(document, block.text, {
        size: block.level === 1 ? 18 : block.level === 2 ? 14 : 12,
        color: "#111a29",
        baseBold: true,
      });
    } else if (block.type === "paragraph") {
      drawRichText(document, block.text, { size: BODY_SIZE });
    } else if (block.type === "list") {
      drawList(document, block.items, block.ordered);
    } else {
      drawTable(document, block.columns, block.rows);
    }
  }
}

function renderSections(
  document: InstanceType<typeof PDFDocument>,
  sections: readonly DocumentSection[],
  title?: string,
): void {
  for (const section of sections) {
    if (section.type === "heading") {
      document.moveDown(section.level === 1 ? 0.9 : 0.55);
      drawRichText(document, section.text, {
        size: section.level === 1 ? 18 : section.level === 2 ? 14 : 12,
        color: "#111a29",
        baseBold: true,
      });
    } else if (section.type === "paragraph") {
      renderMarkdown(document, section.text, title);
    } else if (section.type === "list") {
      drawList(document, section.items, section.ordered);
    } else {
      drawTable(document, section.columns, section.rows);
    }
  }
}

function collectPdfBytes(
  document: InstanceType<typeof PDFDocument>,
  render: () => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      document.destroy();
      reject(error);
    };
    document.on("data", (chunk: Buffer | Uint8Array) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.byteLength;
      if (sizeBytes > MAX_ARTIFACT_BYTES) {
        fail(new DocumentGenerationValidationError(["Artifact exceeds the maximum size."]));
        return;
      }
      chunks.push(buffer);
    });
    document.once("error", (error: Error) => fail(error));
    document.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, sizeBytes));
    });
    try {
      render();
      document.end();
    } catch (error) {
      fail(error instanceof Error ? error : new Error("PDF generation failed."));
    }
  });
}

export async function generatePdfArtifact(
  request: StructuredDocumentRequest & { readonly format: "pdf" },
): Promise<GeneratedArtifact> {
  assertValidGenerationRequest(request);
  if (!hasContent(request)) {
    throw new DocumentGenerationValidationError(["PDF content is required."]);
  }

  const fonts = await loadFonts();
  validateFontCoverage(request, fonts);

  const document = new PDFDocument({
    autoFirstPage: true,
    size: "LETTER",
    margins: PAGE_MARGINS,
    compress: true,
    info: {},
  });
  document.registerFont(REGULAR_FONT, fonts.regular);
  document.registerFont(BOLD_FONT, fonts.bold);

  const bytes = await collectPdfBytes(document, () => {
    if (request.title?.trim()) {
      document.font(BOLD_FONT).fontSize(22).fillColor("#111a29").text(request.title, { paragraphGap: 10 });
    }
    renderSections(document, request.sections, request.title);
  });
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
