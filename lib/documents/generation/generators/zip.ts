import { zipSync } from "fflate";
import type { GeneratedArtifact, ZipPackageRequest } from "../contracts";
import { sanitizeFilename } from "../filenames";
import { getDocumentMimeType } from "../mime";
import {
  DocumentGenerationValidationError,
  validateGeneratedArtifact,
  validateZipPackage,
} from "../validation";

const ZIP_COMPRESSION_LEVEL = 6;
const ZIP_MTIME = new Date(2000, 0, 1);

export function generateZipArtifact(
  request: ZipPackageRequest,
): GeneratedArtifact {
  const issues = validateZipPackage(request);
  if (issues.length > 0) {
    throw new DocumentGenerationValidationError(issues);
  }

  const entries: Record<string, Uint8Array> = {};
  for (const entry of request.entries) {
    entries[entry.filename] = entry.bytes;
  }

  const bytes = zipSync(entries, {
    level: ZIP_COMPRESSION_LEVEL,
    mtime: ZIP_MTIME,
  });
  const artifact: GeneratedArtifact = {
    filename: sanitizeFilename(request.filename, "zip"),
    mimeType: getDocumentMimeType("zip"),
    bytes,
    sizeBytes: bytes.byteLength,
    format: "zip",
  };

  const artifactIssues = validateGeneratedArtifact(artifact);
  if (artifactIssues.length > 0) {
    throw new DocumentGenerationValidationError(artifactIssues);
  }

  return artifact;
}
