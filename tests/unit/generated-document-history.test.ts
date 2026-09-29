import { describe, expect, it } from "vitest";
import {
  getGeneratedDocumentDownloadUrl,
  normalizeGeneratedDocumentAttachments,
  normalizeInitialMessages,
} from "@/app/chat/ChatClient";

const DOCUMENT_ID = "50000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

function durableDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    filename: "report.pdf",
    format: "pdf" as const,
    mimeType: "application/pdf",
    sizeBytes: 2048,
    templateId: "general-report",
    createdAt: "2026-09-13T12:01:01.000Z",
    ...overrides,
  };
}

describe("generated-document history hydration", () => {
  it("normalizes durable metadata without requiring a Blob or exposing storage paths", () => {
    const documents = normalizeGeneratedDocumentAttachments([
      durableDocument({
        storagePath: "user/conversation/generated/document/report.pdf",
      }),
      durableDocument(),
    ]);

    expect(documents).toEqual([
      {
        id: DOCUMENT_ID,
        filename: "report.pdf",
        format: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        templateId: "general-report",
        createdAt: "2026-09-13T12:01:01.000Z",
      },
    ]);
    expect(documents[0]).not.toHaveProperty("blob");
    expect(documents[0]).not.toHaveProperty("storagePath");
  });

  it("rejects malformed metadata and preserves stable message-level ordering", () => {
    const documents = normalizeGeneratedDocumentAttachments([
      durableDocument({ id: "not-a-uuid" }),
      durableDocument({ format: "unsupported" }),
      durableDocument({ id: "50000000-0000-4000-8000-000000000002", filename: "second.pdf" }),
      durableDocument({ id: "50000000-0000-4000-8000-000000000002", filename: "duplicate.pdf" }),
    ]);

    expect(documents.map((document) => document.filename)).toEqual(["second.pdf"]);
  });

  it("keeps uploaded source documents distinct while reconstructing durable generated documents", () => {
    const messages = normalizeInitialMessages([
      {
        id: MESSAGE_ID,
        role: "user",
        content: "Analyze this source.",
        documents: [
          {
            id: "60000000-0000-4000-8000-000000000001",
            file_name: "source.md",
            mime_type: "text/markdown",
            size_bytes: 42,
            extraction_status: "ready",
            extraction_error: null,
            conversation_id: CONVERSATION_ID,
          },
        ],
        generatedDocuments: [],
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        role: "assistant",
        content: "I created the report.",
        documents: [],
        generatedDocuments: [durableDocument()],
      },
    ]);

    expect(messages[0]?.documents?.[0]?.file_name).toBe("source.md");
    expect(messages[0]?.generatedDocuments).toEqual([]);
    expect(messages[1]?.generatedDocuments?.[0]).toMatchObject({
      id: DOCUMENT_ID,
      filename: "report.pdf",
    });
    expect(messages[1]?.generatedDocuments?.[0]).not.toHaveProperty("blob");
  });

  it("uses the authenticated durable download route for historical artifacts", () => {
    expect(getGeneratedDocumentDownloadUrl(DOCUMENT_ID)).toBe(
      "/api/generated-documents/50000000-0000-4000-8000-000000000001/download",
    );
  });
});
