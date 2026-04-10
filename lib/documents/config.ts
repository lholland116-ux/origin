export const DOCUMENT_LIMITS = {
  maxFilesPerMessage: 3,
  maxFileSizeBytes: 10 * 1024 * 1024,
  allowedMimeTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/csv",
  ],
} as const;

export type AllowedDocumentMimeType =
  (typeof DOCUMENT_LIMITS.allowedMimeTypes)[number];

export const DOCUMENT_BUCKET = "documents";