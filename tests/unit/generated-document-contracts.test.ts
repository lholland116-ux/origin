import { describe, expect, it } from "vitest";
import {
  isValidGeneratedDocumentMetadata,
  MAX_GENERATED_DOCUMENT_BYTES,
} from "@/lib/documents/generated-document-contracts";

const validMetadata = {
  id: "55e89ec6-df34-4226-bad4-ad33237123a4",
  conversationId: "7d834180-5023-4d99-a88c-68275c0bf635",
  messageId: "65e84000-e29b-41d4-a716-446655440000",
  filename: "report.pptx",
  format: "pptx" as const,
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  sizeBytes: MAX_GENERATED_DOCUMENT_BYTES,
  templateId: null,
  createdAt: "2026-09-29T00:00:00.000Z",
};

describe("generated document metadata contract", () => {
  it("accepts supported format/MIME pairs at the 10 MiB boundary", () => {
    expect(isValidGeneratedDocumentMetadata(validMetadata)).toBe(true);
  });

  it("rejects mismatched MIME, unsupported format, and invalid sizes", () => {
    expect(
      isValidGeneratedDocumentMetadata({ ...validMetadata, mimeType: "application/pdf" }),
    ).toBe(false);
    expect(
      isValidGeneratedDocumentMetadata({ ...validMetadata, format: "csv" }),
    ).toBe(false);
    expect(
      isValidGeneratedDocumentMetadata({ ...validMetadata, sizeBytes: MAX_GENERATED_DOCUMENT_BYTES + 1 }),
    ).toBe(false);
  });
});
