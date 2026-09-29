import type { DocumentFormat } from "./generation/contracts";
import { getDocumentMimeType } from "./generation/mime";
import { isSafeFilename } from "./generation/filenames";

const MIME_TO_FORMAT: Readonly<Record<string, DocumentFormat>> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
};

export type NativeFileDownloadRequest = {
  readonly base64: string;
  readonly fileName: string;
  readonly mimeType: string;
};

export type SaveDocumentBlobOptions = {
  readonly nativeSave?: (options: NativeFileDownloadRequest) => Promise<void>;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly createAnchor?: () => HTMLAnchorElement;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly scheduleObjectUrlRevoke?: (callback: () => void) => void;
};

export class DocumentDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentDownloadError";
  }
}

export function documentFormatFromMimeType(value: string | null | undefined): DocumentFormat | null {
  const mimeType = (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_FORMAT[mimeType] ?? null;
}

export function filenameFromContentDisposition(value: string | null): string | null {
  const match = value?.match(/(?:^|;)\s*filename="([^"]+)"/i);
  return match?.[1] ?? null;
}

export function formatDocumentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  if (typeof btoa !== "function") {
    throw new DocumentDownloadError("Base64 encoding is unavailable.");
  }

  return btoa(binary);
}

export async function saveDocumentBlob(
  blob: Blob,
  filename: string,
  format: DocumentFormat,
  options: SaveDocumentBlobOptions = {},
): Promise<void> {
  const mimeType = getDocumentMimeType(format).split(";", 1)[0] ?? "";
  if (!blob || blob.size === 0 || !isSafeFilename(filename, format)) {
    throw new DocumentDownloadError("The document could not be downloaded safely.");
  }

  if (documentFormatFromMimeType(blob.type) !== null && documentFormatFromMimeType(blob.type) !== format) {
    throw new DocumentDownloadError("The document MIME type is invalid.");
  }

  if (options.nativeSave) {
    try {
      await options.nativeSave({
        base64: await blobToBase64(blob),
        fileName: filename,
        mimeType,
      });
      return;
    } catch {
      throw new DocumentDownloadError("Could not save the document. Please try again.");
    }
  }

  let objectUrl: string;
  try {
    objectUrl = (
      options.createObjectUrl ?? ((value: Blob) => URL.createObjectURL(value))
    )(blob);
  } catch {
    throw new DocumentDownloadError("The document could not be downloaded safely.");
  }

  try {
    const anchor =
      options.createAnchor?.() ??
      (typeof document !== "undefined" ? document.createElement("a") : null);

    if (!anchor) {
      throw new DocumentDownloadError("The document could not be downloaded safely.");
    }

    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noreferrer";
    anchor.click();
  } finally {
    const revoke = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
    const schedule =
      options.scheduleObjectUrlRevoke ??
      ((callback: () => void) => {
        if (typeof window !== "undefined") window.setTimeout(callback, 0);
        else callback();
      });
    schedule(() => revoke(objectUrl));
  }
}
