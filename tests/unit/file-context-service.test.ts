import { describe, expect, it, vi } from "vitest";
import { createFileContextService, FileContextPreparationError, MAX_FILE_CONTEXT_DOCUMENTS } from "@/lib/ai/file-context-service";
import { MAX_DOCUMENT_CONTEXT_CHARS } from "@/lib/documents/prepare-context";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "a1000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "b1000000-0000-4000-8000-000000000001";
const OTHER_CONVERSATION_ID = "b1000000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "c1000000-0000-4000-8000-000000000001";

const input = {
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  documentIds: [DOCUMENT_ID],
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    file_name: "report.txt",
    mime_type: "text/plain",
    size_bytes: 24,
    extraction_status: "ready",
    extracted_text: "Extracted document text.",
    ...overrides,
  };
}

describe("File Context Preparation Service", () => {
  it("returns the A.4a context contract from owned, ready, conversation-associated extracted content", async () => {
    const loadDocuments = vi.fn(async () => [row()]);
    const prepareFileContext = createFileContextService({ loadDocuments });
    const result = await prepareFileContext(input);

    expect(loadDocuments).toHaveBeenCalledOnce();
    expect(loadDocuments).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      kind: "file_context",
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      documents: [{
        documentId: DOCUMENT_ID,
        fileName: "report.txt",
        mimeType: "text/plain",
        sizeBytes: 24,
        extractedText: "Extracted document text.",
      }],
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.documents[0]).not.toHaveProperty("bytes");
    expect(result.documents[0]).not.toHaveProperty("storagePath");
  });

  it("denies a document owned by another user", async () => {
    const prepareFileContext = createFileContextService({ loadDocuments: async () => [row({ user_id: OTHER_USER_ID })] });
    await expect(prepareFileContext(input)).rejects.toMatchObject({ code: "document_unavailable" });
  });

  it("denies a document associated with a different conversation", async () => {
    const prepareFileContext = createFileContextService({ loadDocuments: async () => [row({ conversation_id: OTHER_CONVERSATION_ID })] });
    await expect(prepareFileContext(input)).rejects.toMatchObject({ code: "document_unavailable" });
  });

  it.each([
    ["missing", []],
    ["not ready", [row({ extraction_status: "processing" })]],
    ["empty extracted text", [row({ extracted_text: "  " })]],
  ])("fails closed when a referenced document is %s", async (_label, rows) => {
    const prepareFileContext = createFileContextService({ loadDocuments: async () => rows as ReturnType<typeof row>[] });
    await expect(prepareFileContext(input)).rejects.toBeInstanceOf(FileContextPreparationError);
  });

  it("enforces the 10-document maximum before querying", async () => {
    const loadDocuments = vi.fn(async () => []);
    const prepareFileContext = createFileContextService({ loadDocuments });
    const documentIds = Array.from({ length: MAX_FILE_CONTEXT_DOCUMENTS + 1 }, (_, index) =>
      `c1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);

    await expect(prepareFileContext({ ...input, documentIds })).rejects.toMatchObject({ code: "invalid_reference" });
    expect(loadDocuments).not.toHaveBeenCalled();
  });

  it("enforces the same 30,000-character extracted-content bound as Standard", async () => {
    const prepareFileContext = createFileContextService({
      loadDocuments: async () => [row({ extracted_text: "x".repeat(MAX_DOCUMENT_CONTEXT_CHARS + 1) })],
    });
    await expect(prepareFileContext(input)).rejects.toMatchObject({ code: "context_too_large" });
  });

  it("does not expose lookup errors or accept duplicate/invalid IDs", async () => {
    const prepareBroken = createFileContextService({ loadDocuments: async () => { throw new Error("private database detail"); } });
    await expect(prepareBroken(input)).rejects.toMatchObject({
      code: "lookup_failed",
      message: "Failed to load document context.",
    });
    const prepareNoop = createFileContextService({ loadDocuments: vi.fn(async () => []) });
    await expect(prepareNoop({ ...input, documentIds: [DOCUMENT_ID, DOCUMENT_ID] })).rejects.toMatchObject({ code: "invalid_reference" });
  });

  it("preserves only an explicitly normalized temporary lookup failure", async () => {
    const temporary = createFileContextService({
      loadDocuments: async () => { throw new FileContextPreparationError("temporary_lookup_failure"); },
    });
    await expect(temporary(input)).rejects.toMatchObject({ code: "temporary_lookup_failure" });

    const unclassified = createFileContextService({
      loadDocuments: async () => { throw new FileContextPreparationError("lookup_failed"); },
    });
    await expect(unclassified(input)).rejects.toMatchObject({ code: "lookup_failed" });
  });
});
