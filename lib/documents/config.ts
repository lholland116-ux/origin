export const DOCUMENT_BUCKET = "documents";

export type DocumentPlan = "free" | "pro";

export type DocumentPlanLimits = {
  maxFilesPerMessage: number;
  maxFileSizeBytes: number;
};

export const DOCUMENT_LIMITS = {
  maxFilesPerMessage: 3,
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxExtractedTextLength: 200_000,
  allowedMimeTypes: [
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/csv",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  allowedExtensions: [".txt", ".md", ".csv", ".pdf", ".docx", ".xlsx", ".pptx"],
} as const;

export const DOCUMENT_PLAN_LIMITS: Record<DocumentPlan, DocumentPlanLimits> = {
  free: {
    maxFilesPerMessage: 1,
    maxFileSizeBytes: 5 * 1024 * 1024,
  },
  pro: {
    maxFilesPerMessage: DOCUMENT_LIMITS.maxFilesPerMessage,
    maxFileSizeBytes: DOCUMENT_LIMITS.maxFileSizeBytes,
  },
};

export function getDocumentLimits(plan: DocumentPlan): DocumentPlanLimits {
  return DOCUMENT_PLAN_LIMITS[plan];
}

export function formatMaxDocumentCount(count: number): string {
  return String(count) + " " + (count === 1 ? "document" : "documents");
}

export type AllowedDocumentMimeType =
  (typeof DOCUMENT_LIMITS.allowedMimeTypes)[number];

export type AllowedDocumentExtension =
  (typeof DOCUMENT_LIMITS.allowedExtensions)[number];

export function isAllowedDocumentMimeType(
  mimeType: string
): mimeType is AllowedDocumentMimeType {
  return DOCUMENT_LIMITS.allowedMimeTypes.includes(
    mimeType as AllowedDocumentMimeType
  );
}

export function isAllowedDocumentExtension(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return DOCUMENT_LIMITS.allowedExtensions.some((ext) => lowerName.endsWith(ext));
}

const DOCUMENT_MIME_TYPES_BY_EXTENSION: Readonly<Record<AllowedDocumentExtension, readonly AllowedDocumentMimeType[]>> = {
  ".txt": ["text/plain"],
  ".md": ["text/markdown"],
  ".csv": ["text/csv", "application/csv"],
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
};

export function getDocumentExtension(fileName: string): AllowedDocumentExtension | null {
  const lowerName = fileName.toLowerCase();
  return DOCUMENT_LIMITS.allowedExtensions.find((extension) => lowerName.endsWith(extension)) ?? null;
}

export function isAllowedDocumentMimeTypeForExtension(mimeType: string, fileName: string): boolean {
  const extension = getDocumentExtension(fileName);
  return extension ? DOCUMENT_MIME_TYPES_BY_EXTENSION[extension].includes(mimeType as AllowedDocumentMimeType) : false;
}

export function formatMaxFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb} MB`;
}