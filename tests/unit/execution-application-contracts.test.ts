import { describe, expect, it } from "vitest";
import {
  conversationExecutionContextSchema,
  fileContextMatchesExecutionContext,
  fileContextResultSchema,
  generatedImageReferenceSchema,
  generatedDocumentReferenceSchema,
  requestMessageBindingSchema,
  requestTransactionContextSchema,
} from "@/lib/agent-runtime/application-contracts";
import { MAX_DOCUMENT_CONTEXT_CHARS } from "@/lib/documents/prepare-context";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "a1000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "b1000000-0000-4000-8000-000000000001";
const OTHER_CONVERSATION_ID = "b1000000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "c1000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "d1000000-0000-4000-8000-000000000001";
const ASSISTANT_MESSAGE_ID = "d1000000-0000-4000-8000-000000000002";

const executionContext = {
  authenticatedUserId: USER_ID,
  conversationId: CONVERSATION_ID,
};

function fileContext(overrides: Record<string, unknown> = {}) {
  return {
    kind: "file_context",
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    documents: [{
      documentId: DOCUMENT_ID,
      fileName: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      extractedText: "Extracted, already-ingested text.",
    }],
    ...overrides,
  };
}

describe("Execution Engine V1 application semantic contracts", () => {
  it("accepts a strict UUID request-message binding while preserving direct request contexts", () => {
    const binding = {
      requestId: "e1000000-0000-4000-8000-000000000001",
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
    };
    expect(requestMessageBindingSchema.safeParse(binding).success).toBe(true);
    expect(JSON.parse(JSON.stringify(binding))).toEqual(binding);
    expect(requestMessageBindingSchema.safeParse({ ...binding, assistantMessageId: "invalid" }).success).toBe(false);
    expect(requestMessageBindingSchema.safeParse({ ...binding, assistantMessageId: USER_MESSAGE_ID }).success).toBe(false);
    expect(requestMessageBindingSchema.safeParse({ ...binding, unexpected: true }).success).toBe(false);
    expect(requestMessageBindingSchema.safeParse({ ...binding, userMessageId: undefined }).success).toBe(false);
    expect(requestMessageBindingSchema.safeParse({ ...binding, assistantMessageId: undefined }).success).toBe(false);

    expect(requestTransactionContextSchema.safeParse({
      requestId: binding.requestId,
      userId: binding.userId,
      conversationId: binding.conversationId,
      userMessageId: null,
    }).success).toBe(true);
    expect(requestTransactionContextSchema.safeParse({
      requestId: binding.requestId,
      userId: binding.userId,
      conversationId: binding.conversationId,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
    }).success).toBe(true);
  });

  it("requires trusted user and conversation identifiers together", () => {
    expect(conversationExecutionContextSchema.safeParse(executionContext).success).toBe(true);
    expect(conversationExecutionContextSchema.safeParse({ authenticatedUserId: USER_ID }).success).toBe(false);
    expect(conversationExecutionContextSchema.safeParse({ ...executionContext, conversationId: "" }).success).toBe(false);
  });

  it("defines file_analysis as bounded, already-extracted context suitable for Standard", () => {
    const value = fileContext();
    expect(fileContextResultSchema.safeParse(value).success).toBe(true);
    expect(fileContextMatchesExecutionContext(value, executionContext)).toBe(true);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    expect(value).not.toHaveProperty("provider");
    expect(value).not.toHaveProperty("model");
    expect(value).not.toHaveProperty("storagePath");
    expect(value.documents[0]).not.toHaveProperty("bytes");
  });

  it("rejects cross-user or cross-conversation context and raw upload/storage fields", () => {
    expect(fileContextMatchesExecutionContext(fileContext({ userId: OTHER_USER_ID }), executionContext)).toBe(false);
    expect(fileContextMatchesExecutionContext(fileContext({ conversationId: OTHER_CONVERSATION_ID }), executionContext)).toBe(false);
    expect(fileContextResultSchema.safeParse(fileContext({ bytes: "raw file bytes" })).success).toBe(false);
    expect(fileContextResultSchema.safeParse(fileContext({ storagePath: "private/path" })).success).toBe(false);
  });

  it("uses the Standard extracted-text bound and rejects oversized or unbounded document sets", () => {
    expect(fileContextResultSchema.safeParse(fileContext({
      documents: [{
        documentId: DOCUMENT_ID,
        fileName: "large.txt",
        mimeType: "text/plain",
        sizeBytes: MAX_DOCUMENT_CONTEXT_CHARS + 1,
        extractedText: "x".repeat(MAX_DOCUMENT_CONTEXT_CHARS + 1),
      }],
    })).success).toBe(false);
    expect(fileContextResultSchema.safeParse(fileContext({ documents: [] })).success).toBe(false);
  });

  it("defines a conversation/message-linked document reference without bytes or storage internals", () => {
    const reference = {
      kind: "generated_document",
      artifactId: DOCUMENT_ID,
      conversationId: CONVERSATION_ID,
      messageId: ASSISTANT_MESSAGE_ID,
      filename: "report.txt",
      format: "txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      createdAt: "2026-10-07T12:00:00.000Z",
    };

    expect(generatedDocumentReferenceSchema.safeParse(reference).success).toBe(true);
    expect(JSON.parse(JSON.stringify(reference))).toEqual(reference);
    expect(generatedDocumentReferenceSchema.safeParse({ ...reference, bytes: "private" }).success).toBe(false);
    expect(generatedDocumentReferenceSchema.safeParse({ ...reference, storagePath: "private/path" }).success).toBe(false);

    const imageReference = {
      kind: "generated_image",
      imageId: "e1000000-0000-4000-8000-000000000001",
      conversationId: CONVERSATION_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      mimeType: "image/webp",
      provider: "runware",
      model: "test-model",
    };
    expect(generatedImageReferenceSchema.safeParse(imageReference).success).toBe(true);
    expect(imageReference).toMatchObject({ userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID });
  });
});
