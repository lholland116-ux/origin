import {
  DOCUMENT_LIMITS,
  formatMaxFileSize,
  isAllowedDocumentExtension,
  isAllowedDocumentMimeType,
} from "@/lib/documents/config";

export function validateFiles(files: File[]): string | null {
  if (!files.length) {
    return "No files selected.";
  }

  if (files.length > DOCUMENT_LIMITS.maxFilesPerMessage) {
    return `You can upload up to ${DOCUMENT_LIMITS.maxFilesPerMessage} files per message.`;
  }

  for (const file of files) {
    const fileName = file.name?.trim() || "Unnamed file";
    const mimeType = file.type?.trim() || "";

    if (file.size <= 0) {
      return `File is empty: ${fileName}`;
    }

    if (file.size > DOCUMENT_LIMITS.maxFileSizeBytes) {
      return `File exceeds ${formatMaxFileSize(
        DOCUMENT_LIMITS.maxFileSizeBytes
      )}: ${fileName}`;
    }

    const hasAllowedMimeType = mimeType
      ? isAllowedDocumentMimeType(mimeType)
      : false;

    const hasAllowedExtension = isAllowedDocumentExtension(fileName);

    if (!hasAllowedMimeType && !hasAllowedExtension) {
      return `Unsupported file type: ${fileName}`;
    }
  }

  return null;
}