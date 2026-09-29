import type { DocumentFormat } from "./contracts";
import { getDocumentExtension } from "./mime";

export const MAX_FILENAME_LENGTH = 160;
export const DEFAULT_DOCUMENT_FILENAME = "lvtchat-document";

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.[^.]+)?$/i;

function removeKnownExtension(value: string): string {
  return value.replace(/\.(?:(?:txt|md|docx|pdf|xlsx|pptx|zip))(?:\.(?:(?:txt|md|docx|pdf|xlsx|pptx|zip)))*$/i, "");
}

function trimFilenameStem(value: string): string {
  return value
    .replace(/[. ]+$/g, "")
    .replace(/^[. ]+/g, "")
    .replace(/\.{2,}/g, ".")
    .trim();
}

export function sanitizeFilename(
  requestedFilename: string | undefined,
  format: DocumentFormat,
): string {
  const extension = getDocumentExtension(format);
  const input = requestedFilename?.trim() || DEFAULT_DOCUMENT_FILENAME;
  const withoutSeparators = input.replace(/[\\/]/g, "_");
  const withoutControls = withoutSeparators.replace(/[\u0000-\u001f\u007f]/g, "");
  const normalizedWhitespace = withoutControls.replace(/\s+/g, "-");
  const normalizedCharacters = normalizedWhitespace.replace(
    /[^A-Za-z0-9._() -]/g,
    "",
  );
  const stem = trimFilenameStem(removeKnownExtension(normalizedCharacters));
  const safeStem = stem && !WINDOWS_RESERVED_NAMES.test(stem) ? stem : DEFAULT_DOCUMENT_FILENAME;
  const maxStemLength = Math.max(1, MAX_FILENAME_LENGTH - extension.length);

  return `${safeStem.slice(0, maxStemLength)}${extension}`;
}

export function isSafeFilename(
  filename: string,
  format: DocumentFormat,
): boolean {
  return (
    filename.length > 0 &&
    filename.length <= MAX_FILENAME_LENGTH &&
    filename === sanitizeFilename(filename, format) &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !filename.includes("..") &&
    !/[\u0000-\u001f\u007f]/.test(filename) &&
    !WINDOWS_RESERVED_NAMES.test(filename)
  );
}
