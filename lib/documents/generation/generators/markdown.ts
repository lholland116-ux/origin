import type {
  GeneratedArtifact,
  MarkdownDocumentRequest,
} from "../contracts";
import { createTextArtifact } from "./shared";

export function generateMarkdownArtifact(
  request: MarkdownDocumentRequest,
): GeneratedArtifact {
  return createTextArtifact(request);
}
