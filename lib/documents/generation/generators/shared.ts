import type {
  MarkdownDocumentRequest,
  TextDocumentRequest,
  GeneratedArtifact,
} from "../contracts";
import { sanitizeFilename } from "../filenames";
import { getDocumentMimeType } from "../mime";
import { assertValidGenerationRequest } from "../validation";

export type TextLikeDocumentRequest =
  | TextDocumentRequest
  | MarkdownDocumentRequest;

export function createTextArtifact(
  request: TextLikeDocumentRequest,
): GeneratedArtifact {
  assertValidGenerationRequest(request);

  const bytes = new TextEncoder().encode(request.content);

  return {
    filename: sanitizeFilename(request.filename, request.format),
    mimeType: getDocumentMimeType(request.format),
    bytes,
    sizeBytes: bytes.byteLength,
    format: request.format,
  };
}
