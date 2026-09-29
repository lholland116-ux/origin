import type { DocumentFormat } from "./contracts";

export const DOCUMENT_FORMATS = [
  "txt",
  "md",
  "docx",
  "pdf",
  "xlsx",
  "pptx",
  "zip",
] as const satisfies readonly DocumentFormat[];

export const DOCUMENT_MIME_TYPES: Readonly<Record<DocumentFormat, string>> = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  docx:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

export const DOCUMENT_EXTENSIONS: Readonly<Record<DocumentFormat, string>> = {
  txt: ".txt",
  md: ".md",
  docx: ".docx",
  pdf: ".pdf",
  xlsx: ".xlsx",
  pptx: ".pptx",
  zip: ".zip",
};

export function isSupportedDocumentFormat(
  value: string,
): value is DocumentFormat {
  return (DOCUMENT_FORMATS as readonly string[]).includes(value);
}

export function getDocumentMimeType(format: DocumentFormat): string {
  return DOCUMENT_MIME_TYPES[format];
}

export function getDocumentExtension(format: DocumentFormat): string {
  return DOCUMENT_EXTENSIONS[format];
}
