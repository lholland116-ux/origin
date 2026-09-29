import type { DocumentFormat } from "./generation/contracts";
import { getDocumentMimeType, isSupportedDocumentFormat } from "./generation/mime";
import { isSafeFilename } from "./generation/filenames";

export const MAX_GENERATED_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type GeneratedDocumentMetadata = Readonly<{
  id: string;
  conversationId: string;
  messageId: string;
  filename: string;
  format: DocumentFormat;
  mimeType: string;
  sizeBytes: number;
  templateId?: string | null;
  createdAt: string;
}>;

/** Server-only persistence record. Storage paths are never public metadata. */
export type GeneratedDocumentPersistenceRecord = Readonly<
  GeneratedDocumentMetadata & {
    userId: string;
    generationRequestId: string;
    storagePath: string;
  }
>;

export type GeneratedDocumentFormat = DocumentFormat;

export function isValidGeneratedDocumentMetadata(
  value: unknown,
): value is GeneratedDocumentMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const metadata = value as Record<string, unknown>;
  const format = metadata.format;
  const filename = metadata.filename;
  const mimeType = metadata.mimeType;
  const sizeBytes = metadata.sizeBytes;

  return (
    typeof metadata.id === "string" &&
    typeof metadata.conversationId === "string" &&
    typeof metadata.messageId === "string" &&
    typeof filename === "string" &&
    typeof format === "string" &&
    isSupportedDocumentFormat(format) &&
    isSafeFilename(filename, format) &&
    typeof mimeType === "string" &&
    mimeType === getDocumentMimeType(format).split(";", 1)[0] &&
    typeof sizeBytes === "number" &&
    Number.isSafeInteger(sizeBytes) &&
    sizeBytes > 0 &&
    sizeBytes <= MAX_GENERATED_DOCUMENT_BYTES &&
    typeof metadata.createdAt === "string" &&
    Number.isFinite(Date.parse(metadata.createdAt)) &&
    (metadata.templateId === undefined || metadata.templateId === null || typeof metadata.templateId === "string")
  );
}
