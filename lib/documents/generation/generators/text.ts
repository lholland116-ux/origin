import type { GeneratedArtifact, TextDocumentRequest } from "../contracts";
import { createTextArtifact } from "./shared";

export function generateTextArtifact(
  request: TextDocumentRequest,
): GeneratedArtifact {
  return createTextArtifact(request);
}
