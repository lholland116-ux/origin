import type { DocumentFormat } from "./generation/contracts";
import { getDocumentMimeType } from "./generation/mime";
import { isSafeFilename, sanitizeFilename } from "./generation/filenames";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GENERATED_DOCUMENT_STORAGE_PREFIX = "generated" as const;

export type GeneratedDocumentPathInput = Readonly<{
  userId: string;
  conversationId: string;
  generatedDocumentId: string;
  filename?: string;
  format: DocumentFormat;
}>;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isSafePathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

export function buildGeneratedDocumentStoragePath(
  input: GeneratedDocumentPathInput,
): string {
  if (
    !isUuid(input.userId) ||
    !isUuid(input.conversationId) ||
    !isUuid(input.generatedDocumentId)
  ) {
    throw new Error("Generated document identifiers are invalid.");
  }

  const filename = sanitizeFilename(input.filename, input.format);

  return [
    input.userId.toLowerCase(),
    input.conversationId.toLowerCase(),
    GENERATED_DOCUMENT_STORAGE_PREFIX,
    input.generatedDocumentId.toLowerCase(),
    filename,
  ].join("/");
}

export function validateGeneratedDocumentStoragePath(
  storagePath: string,
  input: Omit<GeneratedDocumentPathInput, "filename"> & { filename: string },
): boolean {
  if (
    !isUuid(input.userId) ||
    !isUuid(input.conversationId) ||
    !isUuid(input.generatedDocumentId)
  ) {
    return false;
  }

  const segments = storagePath.split("/");
  if (segments.length !== 5) return false;

  const [userId, conversationId, prefix, generatedDocumentId, filename] = segments;
  if (
    userId !== input.userId.toLowerCase() ||
    conversationId !== input.conversationId.toLowerCase() ||
    prefix !== GENERATED_DOCUMENT_STORAGE_PREFIX ||
    generatedDocumentId !== input.generatedDocumentId.toLowerCase() ||
    !isSafePathSegment(filename) ||
    !isSafeFilename(filename, input.format) ||
    filename !== input.filename
  ) {
    return false;
  }

  return storagePath === buildGeneratedDocumentStoragePath(input) && getDocumentMimeType(input.format).length > 0;
}
