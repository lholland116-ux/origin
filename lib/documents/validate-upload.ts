import { DOCUMENT_LIMITS } from "@/lib/documents/config";

export function validateFiles(files: File[]) {
  if (!files.length) {
    return "No files selected.";
  }

  if (files.length > DOCUMENT_LIMITS.maxFilesPerMessage) {
    return `You can upload up to ${DOCUMENT_LIMITS.maxFilesPerMessage} files per message.`;
  }

  for (const file of files) {
    if (!DOCUMENT_LIMITS.allowedMimeTypes.includes(file.type as any)) {
      return `Unsupported file type: ${file.name}`;
    }

    if (file.size > DOCUMENT_LIMITS.maxFileSizeBytes) {
      return `File exceeds 10 MB: ${file.name}`;
    }
  }

  return null;
}