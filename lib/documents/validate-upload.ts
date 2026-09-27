import {
  formatMaxDocumentCount,
  formatMaxFileSize,
  getDocumentLimits,
  isAllowedDocumentExtension,
  isAllowedDocumentMimeType,
  type DocumentPlan,
} from "@/lib/documents/config";

export function validateFiles(
  files: File[],
  plan: DocumentPlan = "pro",
  options?: { getMimeType?: (file: File) => string },
): string | null {
  if (!files.length) {
    return "No files selected.";
  }

  const limits = getDocumentLimits(plan);

  if (files.length > limits.maxFilesPerMessage) {
    return `You can upload up to ${formatMaxDocumentCount(limits.maxFilesPerMessage)} per message.`;
  }

  for (const file of files) {
    const fileName = file.name?.trim() || "Unnamed file";
    const mimeType = options?.getMimeType?.(file) ?? file.type?.trim() ?? "";

    if (file.size <= 0) {
      return `File is empty: ${fileName}`;
    }

    if (file.size > limits.maxFileSizeBytes) {
      return `File exceeds ${formatMaxFileSize(limits.maxFileSizeBytes)}: ${fileName}`;
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
