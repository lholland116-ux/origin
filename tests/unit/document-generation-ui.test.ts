import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
const cardSource = readFileSync("components/chat/GeneratedDocumentCard.tsx", "utf8");

describe("generated document chat integration", () => {
  it("handles generated binary responses as transient assistant attachments", () => {
    expect(clientSource).toContain('res.headers.get("x-lvtchat-document") === "generated"');
    expect(clientSource).toContain("filenameFromContentDisposition");
    expect(clientSource).toContain("generatedDocuments:");
    expect(clientSource).toContain("const generationRequestId = createId();");
    expect(clientSource).toContain("X-Generated-Document-Id");
    expect(clientSource).toContain("getGeneratedDocumentDownloadUrl");
    expect(clientSource).toContain("<GeneratedDocumentCard");
    expect(clientSource).toContain('I created " + filename');
  });

  it("provides a clear download card and prevents duplicate saves while pending", () => {
    expect(cardSource).toContain('aria-label={`Download ${generatedDocument.filename}`}');
    expect(cardSource).toContain('Download');
    expect(clientSource).toContain("if (loading || downloadingGeneratedDocumentMessageId) return;");
    expect(clientSource).toContain("saveDocumentBlob");
    expect(clientSource).toContain("generatedDocument.blob");
    expect(clientSource).toContain('Capacitor.getPlatform() === "android"');
  });
});
