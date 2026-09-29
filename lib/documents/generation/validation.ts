import type {
  DocumentGenerationRequest,
  DocumentSection,
  GeneratedArtifact,
  PresentationSlide,
  WorkbookCell,
  WorkbookSheet,
  ZipPackageRequest,
} from "./contracts";
import {
  getDocumentExtension,
  getDocumentMimeType,
  isSupportedDocumentFormat,
} from "./mime";
import {
  isSafeFilename,
  MAX_FILENAME_LENGTH,
  sanitizeFilename,
} from "./filenames";

export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 20;
export const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_SECTION_COUNT = 200;
export const MAX_TABLE_COLUMNS = 100;
export const MAX_TABLE_ROWS = 2_000;
export const MAX_SHEETS = 50;
export const MAX_WORKSHEET_NAME_LENGTH = 31;
export const MAX_PRESENTATION_SLIDES = 100;
export const MAX_PRESENTATION_TITLE_LENGTH = 160;
export const MAX_PRESENTATION_SUBTITLE_LENGTH = 400;
export const MAX_PRESENTATION_BODY_PARAGRAPHS = 50;
export const MAX_PRESENTATION_BODY_LENGTH = 2_000;
export const MAX_PRESENTATION_LIST_ITEMS = 200;
export const MAX_PRESENTATION_LIST_ITEM_LENGTH = 1_000;
export const MAX_PRESENTATION_TABLE_COLUMNS = 8;
export const MAX_PRESENTATION_TABLE_ROWS = 100;
export const MAX_PRESENTATION_TABLE_CELL_LENGTH = 400;
export const MAX_PRESENTATION_NOTES_LENGTH = 5_000;

const INVALID_WORKSHEET_NAME = /[\\/*?:\[\]]/;
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]) satisfies ReadonlySet<string>;

export class DocumentGenerationValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join(" "));
    this.name = "DocumentGenerationValidationError";
    this.issues = issues;
  }
}

function isWorkbookCell(value: WorkbookCell): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateSection(section: DocumentSection, index: number): string[] {
  const issues: string[] = [];

  if (!section || typeof section !== "object" || typeof section.type !== "string") {
    return [`Section ${index + 1} is invalid.`];
  }

  if (section.type === "heading") {
    if (section.level !== 1 && section.level !== 2 && section.level !== 3) {
      issues.push(`Section ${index + 1} has an invalid heading level.`);
    }
    if (typeof section.text !== "string" || !section.text.trim()) {
      issues.push(`Section ${index + 1} heading text is required.`);
    }
  } else if (section.type === "paragraph") {
    if (typeof section.text !== "string") {
      issues.push(`Section ${index + 1} paragraph text is invalid.`);
    }
  } else if (section.type === "list") {
    if (!Array.isArray(section.items) || section.items.length === 0) {
      issues.push(`Section ${index + 1} list items are required.`);
    } else if (section.items.some((item) => typeof item !== "string")) {
      issues.push(`Section ${index + 1} list items must be strings.`);
    }
  } else if (section.type === "table") {
    if (!Array.isArray(section.columns) || section.columns.length === 0) {
      issues.push(`Section ${index + 1} table columns are required.`);
    } else if (section.columns.length > MAX_TABLE_COLUMNS) {
      issues.push(`Section ${index + 1} has too many table columns.`);
    } else if (section.columns.some((column) => typeof column !== "string")) {
      issues.push(`Section ${index + 1} table columns must be strings.`);
    }

    const columns = Array.isArray(section.columns) ? section.columns : [];
    if (!Array.isArray(section.rows) || section.rows.length > MAX_TABLE_ROWS) {
      issues.push(`Section ${index + 1} has too many table rows.`);
    } else if (
      section.rows.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== columns.length ||
          row.some((cell) => typeof cell !== "string"),
      )
    ) {
      issues.push(`Section ${index + 1} table rows do not match the columns.`);
    }
  } else {
    issues.push(`Section ${index + 1} has an unsupported type.`);
  }

  return issues;
}

export function validateWorksheetName(name: string): string | null {
  if (!name.trim()) return "Worksheet name is required.";
  if (name.length > MAX_WORKSHEET_NAME_LENGTH) {
    return "Worksheet name is too long.";
  }
  if (INVALID_WORKSHEET_NAME.test(name) || /^['"]|['"]$/.test(name)) {
    return "Worksheet name contains unsupported characters.";
  }
  return null;
}

export function validateWorkbookSheet(sheet: WorkbookSheet, index: number): string[] {
  const issues: string[] = [];
  const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const nameError = validateWorksheetName(sheet.name);

  if (nameError) issues.push(`Sheet ${index + 1}: ${nameError}`);
  if (!Array.isArray(sheet.columns) || sheet.columns.length === 0) {
    issues.push(`Sheet ${index + 1} must have columns.`);
  }
  if (columns.length > MAX_TABLE_COLUMNS) {
    issues.push(`Sheet ${index + 1} has too many columns.`);
  }
  if (columns.some((column) => typeof column !== "string" || !column.trim())) {
    issues.push(`Sheet ${index + 1} column names must be non-empty strings.`);
  }
  if (!Array.isArray(sheet.rows) || rows.length > MAX_TABLE_ROWS) {
    issues.push(`Sheet ${index + 1} has too many rows.`);
  } else if (
    sheet.rows.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== columns.length ||
        row.some((cell) => !isWorkbookCell(cell)),
    )
  ) {
    issues.push(`Sheet ${index + 1} rows do not match the columns.`);
  }

  return issues;
}

export function validateGeneratedArtifact(artifact: GeneratedArtifact): string[] {
  const issues: string[] = [];
  const format = artifact.format as string;

  if (!isSupportedDocumentFormat(format)) {
    issues.push("Artifact format is unsupported.");
  } else if (!isSafeFilename(artifact.filename, artifact.format)) {
    issues.push("Artifact filename is unsafe.");
  } else if (!artifact.filename.endsWith(getDocumentExtension(artifact.format))) {
    issues.push("Artifact filename has the wrong extension.");
  }

  if (!(artifact.bytes instanceof Uint8Array)) {
    issues.push("Artifact bytes are invalid.");
  }
  if (isSupportedDocumentFormat(format) && artifact.mimeType !== getDocumentMimeType(format)) {
    issues.push("Artifact MIME type does not match its format.");
  }
  if (artifact.bytes instanceof Uint8Array && artifact.sizeBytes !== artifact.bytes.byteLength) {
    issues.push("Artifact size does not match its bytes.");
  }
  if (artifact.sizeBytes > MAX_ARTIFACT_BYTES) {
    issues.push("Artifact exceeds the maximum size.");
  }

  return issues;
}

export function validateZipPackage(request: ZipPackageRequest): string[] {
  const issues: string[] = [];
  const filename = sanitizeFilename(request.filename, "zip");

  if (!isSafeFilename(filename, "zip") || filename.length > MAX_FILENAME_LENGTH) {
    issues.push("ZIP filename is unsafe.");
  }
  if (request.entries.length === 0) issues.push("ZIP package must contain an entry.");
  if (request.entries.length > MAX_ZIP_ENTRIES) {
    issues.push("ZIP package contains too many entries.");
  }

  const filenames = new Set<string>();
  let totalBytes = 0;
  for (const entry of request.entries) {
    issues.push(...validateGeneratedArtifact(entry));
    if ((entry.format as string) === "zip") issues.push("Nested ZIP entries are not supported.");
    if (filenames.has(entry.filename)) issues.push("ZIP entry filenames must be unique.");
    filenames.add(entry.filename);
    totalBytes += entry.sizeBytes;
  }
  if (totalBytes > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
    issues.push("ZIP package exceeds the total uncompressed size limit.");
  }

  return issues;
}

function validatePresentationText(value: unknown, label: string, maxLength: number): string[] {
  if (typeof value !== "string") return [label + " must be a string."];
  if (value.length > maxLength) return [label + " is too long."];
  return [];
}

function validatePresentationSlide(slide: PresentationSlide, index: number): string[] {
  const issues: string[] = [];
  const prefix = "Slide " + (index + 1);
  if (!slide || typeof slide !== "object" || typeof slide.type !== "string") {
    return [prefix + " is invalid."];
  }
  issues.push(...validatePresentationText(slide.title, prefix + " title", MAX_PRESENTATION_TITLE_LENGTH));
  if (slide.notes !== undefined) {
    issues.push(...validatePresentationText(slide.notes, prefix + " notes", MAX_PRESENTATION_NOTES_LENGTH));
  }

  if (slide.type === "title") {
    if (slide.subtitle !== undefined) issues.push(...validatePresentationText(slide.subtitle, prefix + " subtitle", MAX_PRESENTATION_SUBTITLE_LENGTH));
  } else if (slide.type === "section") {
    if (slide.supportingText !== undefined) issues.push(...validatePresentationText(slide.supportingText, prefix + " supporting text", MAX_PRESENTATION_SUBTITLE_LENGTH));
  } else if (slide.type === "body") {
    if (!Array.isArray(slide.paragraphs) || slide.paragraphs.length === 0) issues.push(prefix + " paragraphs are required.");
    else if (slide.paragraphs.length > MAX_PRESENTATION_BODY_PARAGRAPHS) issues.push(prefix + " has too many paragraphs.");
    else slide.paragraphs.forEach((paragraph, paragraphIndex) => {
      issues.push(...validatePresentationText(paragraph, prefix + " paragraph " + (paragraphIndex + 1), MAX_PRESENTATION_BODY_LENGTH));
    });
  } else if (slide.type === "bullets" || slide.type === "numbered") {
    if (!Array.isArray(slide.items) || slide.items.length === 0) issues.push(prefix + " list items are required.");
    else if (slide.items.length > MAX_PRESENTATION_LIST_ITEMS) issues.push(prefix + " has too many list items.");
    else slide.items.forEach((item, itemIndex) => {
      issues.push(...validatePresentationText(item, prefix + " item " + (itemIndex + 1), MAX_PRESENTATION_LIST_ITEM_LENGTH));
    });
  } else if (slide.type === "table") {
    if (!Array.isArray(slide.columns) || slide.columns.length === 0) issues.push(prefix + " table columns are required.");
    else if (slide.columns.length > MAX_PRESENTATION_TABLE_COLUMNS) issues.push(prefix + " has too many table columns.");
    else slide.columns.forEach((column, columnIndex) => {
      issues.push(...validatePresentationText(column, prefix + " column " + (columnIndex + 1), MAX_PRESENTATION_TABLE_CELL_LENGTH));
    });
    const columns = Array.isArray(slide.columns) ? slide.columns : [];
    if (!Array.isArray(slide.rows)) issues.push(prefix + " table rows are required.");
    else if (slide.rows.length > MAX_PRESENTATION_TABLE_ROWS) issues.push(prefix + " has too many table rows.");
    else slide.rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== columns.length) issues.push(prefix + " row " + (rowIndex + 1) + " does not match the columns.");
      else row.forEach((cell, cellIndex) => {
        issues.push(...validatePresentationText(cell, prefix + " row " + (rowIndex + 1) + " cell " + (cellIndex + 1), MAX_PRESENTATION_TABLE_CELL_LENGTH));
      });
    });
  } else {
    issues.push(prefix + " has an unsupported type.");
  }
  return issues;
}

export function validateGenerationRequest(
  request: DocumentGenerationRequest,
): string[] {
  const issues: string[] = [];
  const filename = sanitizeFilename(request.filename, request.format);

  if (!isSupportedDocumentFormat(request.format)) {
    issues.push("Document format is unsupported.");
  }
  if (filename.length > MAX_FILENAME_LENGTH) issues.push("Filename is too long.");
  if (request.format === "txt" || request.format === "md") {
    if (typeof request.content !== "string") issues.push("Document content is required.");
  } else if (request.format === "docx" || request.format === "pdf") {
    if (request.sections.length > MAX_SECTION_COUNT) issues.push("Document has too many sections.");
    request.sections.forEach((section, index) => issues.push(...validateSection(section, index)));
  } else if (request.format === "pptx") {
    if (!Array.isArray(request.slides) || request.slides.length === 0) issues.push("Presentation must contain a slide.");
    else if (request.slides.length > MAX_PRESENTATION_SLIDES) issues.push("Presentation has too many slides.");
    else request.slides.forEach((slide, index) => issues.push(...validatePresentationSlide(slide, index)));
  } else if (request.format === "xlsx") {
    if (request.sheets.length === 0) issues.push("Workbook must contain a sheet.");
    if (request.sheets.length > MAX_SHEETS) issues.push("Workbook has too many sheets.");
    const sheetNames = new Set<string>();
    request.sheets.forEach((sheet, index) => {
      issues.push(...validateWorkbookSheet(sheet, index));
      if (sheetNames.has(sheet.name)) issues.push("Worksheet names must be unique.");
      sheetNames.add(sheet.name);
    });
  }

  return issues;
}

export function assertValidGenerationRequest(request: DocumentGenerationRequest): void {
  const issues = validateGenerationRequest(request);
  if (issues.length > 0) throw new DocumentGenerationValidationError(issues);
}

export function neutralizeWorkbookString(value: string): string {
  return value.length > 0 && FORMULA_PREFIXES.has(value[0] ?? "") ? `'${value}` : value;
}

export function normalizeWorkbookCell(value: WorkbookCell): WorkbookCell {
  return typeof value === "string" ? neutralizeWorkbookString(value) : value;
}
