import mammoth from "mammoth";
import ExcelJS from "exceljs";

// Force CommonJS build of pdf-parse for Node/Vercel compatibility.
// This avoids the ESM path that can trigger "DOMMatrix is not defined".
const pdfParse: (input: Buffer) => Promise<{ text?: string }> = require("pdf-parse");

const MAX_EXTRACTED_TEXT_LENGTH = 200_000;
const MIN_MEANINGFUL_TEXT_LENGTH = 20;
const LOW_TEXT_WARNING_PREFIX =
  "[Low text content detected — document may be scanned]\n\n";
const PDF_PREVIEW_LENGTH = 200;

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(
  input: string,
  maxLength = MAX_EXTRACTED_TEXT_LENGTH
): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength)}\n\n[Truncated due to size limit]`;
}

function finalizeText(input: string): string {
  return truncateText(normalizeText(input));
}

function hasMeaningfulText(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized.length >= MIN_MEANINGFUL_TEXT_LENGTH;
}

function hasAnyText(input: string): boolean {
  return normalizeText(input).length > 0;
}

function normalizeExcelCellValue(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const maybeRichText = value as {
      richText?: Array<{ text?: string }>;
      text?: string;
      hyperlink?: string;
      result?: unknown;
      formula?: string;
    };

    if (Array.isArray(maybeRichText.richText)) {
      return maybeRichText.richText.map((part) => part.text ?? "").join("");
    }

    if (typeof maybeRichText.text === "string" && maybeRichText.text.trim()) {
      return maybeRichText.text;
    }

    if (
      typeof maybeRichText.hyperlink === "string" &&
      maybeRichText.hyperlink.trim()
    ) {
      return maybeRichText.hyperlink;
    }

    if (maybeRichText.result != null) {
      return String(maybeRichText.result);
    }

    if (
      typeof maybeRichText.formula === "string" &&
      maybeRichText.formula.trim()
    ) {
      return maybeRichText.formula;
    }
  }

  return String(value);
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    console.log("PDF extraction started", {
      sizeBytes: buffer.length,
    });

    const result = await pdfParse(buffer);
    const rawText = result.text || "";
    const normalized = normalizeText(rawText);
    const text = truncateText(normalized);

    console.log("PDF extraction result", {
      sizeBytes: buffer.length,
      rawLength: rawText.length,
      normalizedLength: normalized.length,
      preview: normalized.slice(0, PDF_PREVIEW_LENGTH),
    });

    if (!hasAnyText(normalized)) {
      throw new Error("No extractable text found.");
    }

    if (!hasMeaningfulText(normalized)) {
      console.warn("PDF extraction low text volume", {
        sizeBytes: buffer.length,
        normalizedLength: normalized.length,
        preview: normalized.slice(0, PDF_PREVIEW_LENGTH),
      });

      return `${LOW_TEXT_WARNING_PREFIX}${text}`;
    }

    return text;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown PDF parsing error.";
    const stack = error instanceof Error ? error.stack : undefined;

    console.error(
      "PDF extraction failed:",
      JSON.stringify(
        {
          sizeBytes: buffer.length,
          message,
          stack,
        },
        null,
        2
      )
    );

    if (/password|encrypted/i.test(message)) {
      throw new Error("Encrypted or password-protected PDF is not supported.");
    }

    if (/no extractable text/i.test(message)) {
      throw new Error(
        "PDF appears to contain no extractable text. It may be scanned or image-only."
      );
    }

    throw new Error(`PDF parsing error: ${message}`);
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return finalizeText(result.value || "");
}

async function extractPlainText(buffer: Buffer): Promise<string> {
  return finalizeText(buffer.toString("utf-8"));
}

async function extractCsvText(buffer: Buffer): Promise<string> {
  return finalizeText(buffer.toString("utf-8"));
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();

  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

  await workbook.xlsx.load(arrayBuffer);

  const sections: string[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const rowValues = row.values;
      const rawCells = Array.isArray(rowValues) ? rowValues.slice(1) : [];

      const normalizedCells = rawCells.map(normalizeExcelCellValue);
      const hasContent = normalizedCells.some((cell) => cell.trim().length > 0);

      if (hasContent) {
        rows.push(normalizedCells.join(","));
      }
    });

    const sheetBody = rows.length > 0 ? rows.join("\n") : "[Empty sheet]";
    sections.push(`Sheet: ${worksheet.name}\n${sheetBody}`);
  });

  if (sections.length === 0) {
    return finalizeText("[Workbook contains no sheets]");
  }

  return finalizeText(sections.join("\n\n---\n\n"));
}

export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  switch (mimeType) {
    case "text/plain":
    case "text/markdown":
      return extractPlainText(buffer);

    case "text/csv":
    case "application/csv":
      return extractCsvText(buffer);

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocxText(buffer);

    case "application/pdf":
      return extractPdfText(buffer);

    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return extractXlsxText(buffer);

    default:
      throw new Error(`Unsupported MIME type for extraction: ${mimeType}`);
  }
}