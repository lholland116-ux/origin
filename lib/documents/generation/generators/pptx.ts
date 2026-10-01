import { createRequire } from "node:module";
import type { PresSlide, TableRow } from "@lofcz/pptxgenjs";

const PptxGenJS = createRequire(import.meta.url)("@lofcz/pptxgenjs") as typeof import("@lofcz/pptxgenjs").default;
type PptxPresentation = InstanceType<typeof PptxGenJS>;
import type {
  GeneratedArtifact,
  PresentationDocumentRequest,
  PresentationSlide,
} from "../contracts";
import { sanitizeFilename } from "../filenames";
import { getDocumentMimeType } from "../mime";
import {
  assertValidGenerationRequest,
  DocumentGenerationValidationError,
  MAX_ARTIFACT_BYTES,
  validateGeneratedArtifact,
} from "../validation";

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;
const MARGIN_X = 0.7;
const CONTENT_WIDTH = SLIDE_WIDTH - MARGIN_X * 2;
const TITLE_COLOR = "17324D";
const BODY_COLOR = "26364A";
const ACCENT_COLOR = "2B6CB0";
const BACKGROUND_COLOR = "F7F9FC";
const TABLE_HEADER_COLOR = "1F4E78";
const BODY_MAX_LINES = 16;
const LIST_MAX_LINES = 14;
const TABLE_MAX_LINES = 12;
const BODY_CHARS_PER_LINE = 92;

function wrapText(text: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      let remaining = word;
      while (remaining.length > maxCharacters) {
        const piece = remaining.slice(0, maxCharacters);
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(piece);
        remaining = remaining.slice(maxCharacters);
      }
      const candidate = line ? line + " " + remaining : remaining;
      if (line && candidate.length > maxCharacters) {
        lines.push(line);
        line = remaining;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size) as T[]);
  }
  return result;
}

function addNotes(slide: PresSlide, notes: string | undefined): void {
  if (notes) slide.addNotes(notes);
}

function addSlideBase(pptx: PptxPresentation): PresSlide {
  const slide = pptx.addSlide();
  slide.background = { color: BACKGROUND_COLOR };
  return slide;
}

function addAccent(slide: PresSlide, pptx: PptxPresentation): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN_X,
    y: 0.34,
    w: 0.12,
    h: 0.62,
    fill: { color: ACCENT_COLOR },
    line: { color: ACCENT_COLOR },
  });
}

function addSlideTitle(
  slide: PresSlide,
  pptx: PptxPresentation,
  title: string,
  continued = false,
): void {
  addAccent(slide, pptx);
  const text = continued ? title + " — continued" : title;
  slide.addText(text, {
    x: MARGIN_X + 0.25,
    y: 0.34,
    w: CONTENT_WIDTH - 0.25,
    h: 0.75,
    fontFace: "Aptos Display",
    fontSize: 25,
    bold: true,
    color: TITLE_COLOR,
    margin: 0,
    fit: "shrink",
    valign: "middle",
  });
}

function addBodyText(
  slide: PresSlide,
  text: string,
  y: number,
  height: number,
  fontSize = 18,
): void {
  slide.addText(text, {
    x: MARGIN_X,
    y,
    w: CONTENT_WIDTH,
    h: height,
    fontFace: "Aptos",
    fontSize,
    color: BODY_COLOR,
    breakLine: false,
    margin: 0.04,
    fit: "shrink",
    valign: "top",
    paraSpaceAfter: 8,
  });
}

function renderTitleSlide(
  pptx: PptxPresentation,
  slide: Extract<PresentationSlide, { type: "title" }>,
): void {
  const page = pptx.addSlide();
  page.background = { color: TITLE_COLOR };
  page.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.25,
    h: SLIDE_HEIGHT,
    fill: { color: ACCENT_COLOR },
    line: { color: ACCENT_COLOR },
  });
  page.addText(slide.title, {
    x: 1.05,
    y: 2.1,
    w: 11.1,
    h: 1.6,
    fontFace: "Aptos Display",
    fontSize: 32,
    bold: true,
    color: "FFFFFF",
    margin: 0,
    fit: "shrink",
    valign: "middle",
  });
  if (slide.subtitle) {
    page.addText(slide.subtitle, {
      x: 1.08,
      y: 4.05,
      w: 10.8,
      h: 0.8,
      fontFace: "Aptos",
      fontSize: 18,
      color: "D8E7F5",
      margin: 0,
      fit: "shrink",
    });
  }
  addNotes(page, slide.notes);
}

function renderSectionSlide(
  pptx: PptxPresentation,
  slide: Extract<PresentationSlide, { type: "section" }>,
): void {
  const page = pptx.addSlide();
  page.background = { color: ACCENT_COLOR };
  page.addText(slide.title, {
    x: 1.0,
    y: 2.25,
    w: 11.3,
    h: 1.0,
    fontFace: "Aptos Display",
    fontSize: 30,
    bold: true,
    color: "FFFFFF",
    margin: 0,
    fit: "shrink",
    align: "center",
  });
  if (slide.supportingText) {
    page.addText(slide.supportingText, {
      x: 1.4,
      y: 3.5,
      w: 10.5,
      h: 0.75,
      fontFace: "Aptos",
      fontSize: 17,
      color: "E4F0FA",
      margin: 0,
      fit: "shrink",
      align: "center",
    });
  }
  addNotes(page, slide.notes);
}

function renderBodySlides(
  pptx: PptxPresentation,
  slide: Extract<PresentationSlide, { type: "body" }>,
  allowContinuation: boolean,
): void {
  const lineGroups = slide.paragraphs.flatMap((paragraph) => [
    ...wrapText(paragraph, BODY_CHARS_PER_LINE),
    "",
  ]);
  const groups = chunks(lineGroups, BODY_MAX_LINES);
  if (!allowContinuation && groups.length > 1) {
    throw new DocumentGenerationValidationError([
      "Explicit slide content is too large to fit without changing the requested slide count.",
    ]);
  }
  groups.forEach((group, index) => {
    const page = addSlideBase(pptx);
    addSlideTitle(page, pptx, slide.title, index > 0);
    addBodyText(page, group.join("\n").trim(), 1.45, 5.35);
    addNotes(page, index === 0 ? slide.notes : undefined);
  });
}

function renderListSlides(
  pptx: PptxPresentation,
  slide: Extract<PresentationSlide, { type: "bullets" | "numbered" }>,
  allowContinuation: boolean,
): void {
  const lines: string[] = [];
  slide.items.forEach((item, index) => {
    const itemLines = wrapText(item, BODY_CHARS_PER_LINE - 5);
    itemLines.forEach((line, lineIndex) => {
      const prefix =
        lineIndex === 0 ? (slide.type === "bullets" ? "• " : String(index + 1) + ". ") : "  ";
      lines.push(prefix + line);
    });
    lines.push("");
  });
  const groups = chunks(lines, LIST_MAX_LINES);
  if (!allowContinuation && groups.length > 1) {
    throw new DocumentGenerationValidationError([
      "Explicit slide content is too large to fit without changing the requested slide count.",
    ]);
  }
  groups.forEach((group, index) => {
    const page = addSlideBase(pptx);
    addSlideTitle(page, pptx, slide.title, index > 0);
    addBodyText(page, group.join("\n").trim(), 1.45, 5.35, 17);
    addNotes(page, index === 0 ? slide.notes : undefined);
  });
}

function tableRowLines(row: readonly string[], columnCount: number): number {
  const charactersPerCell = Math.max(12, Math.floor(72 / columnCount));
  return Math.max(
    ...row.map((cell) => wrapText(cell, charactersPerCell).length),
    1,
  );
}

function tableRowsForSlide(
  slide: Extract<PresentationSlide, { type: "table" }>,
): TableRow[] {
  const rows: TableRow[] = [
    slide.columns.map((column) => ({
      text: column,
      options: {
        bold: true,
        color: "FFFFFF",
        fill: { color: TABLE_HEADER_COLOR },
      },
    })),
  ];
  for (const row of slide.rows) {
    rows.push(row.map((cell) => ({ text: cell })));
  }
  return rows;
}

function renderTableSlides(
  pptx: PptxPresentation,
  slide: Extract<PresentationSlide, { type: "table" }>,
  allowContinuation: boolean,
): void {
  const rowGroups: (readonly (readonly string[])[])[] = [];
  let current: (readonly string[])[] = [];
  let currentLines = 1;
  for (const row of slide.rows) {
    const rowLines = tableRowLines(row, slide.columns.length);
    if (rowLines > TABLE_MAX_LINES) {
      throw new DocumentGenerationValidationError([
        "Table row is too tall to fit safely on a slide.",
      ]);
    }
    if (current.length > 0 && currentLines + rowLines > TABLE_MAX_LINES) {
      rowGroups.push(current);
      current = [];
      currentLines = 1;
    }
    current.push(row);
    currentLines += rowLines;
  }
  if (current.length > 0 || rowGroups.length === 0) rowGroups.push(current);
  if (!allowContinuation && rowGroups.length > 1) {
    throw new DocumentGenerationValidationError([
      "Explicit slide content is too large to fit without changing the requested slide count.",
    ]);
  }

  rowGroups.forEach((rows, index) => {
    const page = addSlideBase(pptx);
    addSlideTitle(page, pptx, slide.title, index > 0);
    page.addTable(tableRowsForSlide({ ...slide, rows }), {
      x: MARGIN_X,
      y: 1.45,
      w: CONTENT_WIDTH,
      h: 5.25,
      colW: CONTENT_WIDTH / slide.columns.length,
      fontFace: "Aptos",
      fontSize: 12,
      color: BODY_COLOR,
      margin: 0.06,
      border: { type: "solid", color: "B8C7D9", pt: 0.7 },
      fill: { color: "FFFFFF" },
      valign: "middle",
      autoPage: false,
    });
    addNotes(page, index === 0 ? slide.notes : undefined);
  });
}

function renderSlide(
  pptx: PptxPresentation,
  slide: PresentationSlide,
  allowContinuation: boolean,
): void {
  if (slide.type === "title") renderTitleSlide(pptx, slide);
  else if (slide.type === "section") renderSectionSlide(pptx, slide);
  else if (slide.type === "body") renderBodySlides(pptx, slide, allowContinuation);
  else if (slide.type === "bullets" || slide.type === "numbered") {
    renderListSlides(pptx, slide, allowContinuation);
  } else {
    renderTableSlides(pptx, slide, allowContinuation);
  }
}

export async function generatePptxArtifact(
  request: PresentationDocumentRequest & { readonly format: "pptx" },
): Promise<GeneratedArtifact> {
  assertValidGenerationRequest(request);

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "LVTChat";
  pptx.company = "LVTChat";
  pptx.subject = "Generated presentation";
  pptx.title = request.title ?? "LVTChat presentation";
  pptx.revision = "1";

  const allowContinuation = request.exactSlideCount === undefined;
  for (const slide of request.slides) {
    renderSlide(pptx, slide, allowContinuation);
  }

  const output = await pptx.write({
    outputType: "uint8array",
    compression: true,
  });
  if (!(output instanceof Uint8Array)) {
    throw new DocumentGenerationValidationError([
      "PPTX generator did not return in-memory bytes.",
    ]);
  }
  const bytes = new Uint8Array(output);
  const artifact: GeneratedArtifact = {
    filename: sanitizeFilename(request.filename, "pptx"),
    mimeType: getDocumentMimeType("pptx"),
    bytes,
    sizeBytes: bytes.byteLength,
    format: "pptx",
  };
  const issues = validateGeneratedArtifact(artifact);
  if (issues.length > 0) throw new DocumentGenerationValidationError(issues);
  if (artifact.sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new DocumentGenerationValidationError([
      "Generated PPTX exceeds the maximum artifact size.",
    ]);
  }
  return artifact;
}
