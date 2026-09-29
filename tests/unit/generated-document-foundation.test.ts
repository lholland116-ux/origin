import { describe, expect, it } from "vitest";
import {
  buildGeneratedDocumentStoragePath,
  validateGeneratedDocumentStoragePath,
} from "@/lib/documents/generated-document-storage";
import { createGeneratedDocumentRepository } from "@/lib/documents/generated-document-repository";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const conversationId = "7d834180-5023-4d99-a88c-68275c0bf635";
const generatedDocumentId = "55e89ec6-df34-4226-bad4-ad33237123a4";

describe("generated document persistence foundation", () => {
  it("builds the owner- and conversation-scoped generated path", () => {
    expect(buildGeneratedDocumentStoragePath({ userId, conversationId, generatedDocumentId, filename: "quarterly report.pdf", format: "pdf" })).toBe(
      `${userId}/${conversationId}/generated/${generatedDocumentId}/quarterly-report.pdf`,
    );
  });

  it("reuses safe filename normalization and rejects path tampering", () => {
    const path = buildGeneratedDocumentStoragePath({ userId, conversationId, generatedDocumentId, filename: "../secret@example.com.pdf", format: "pdf" });

    expect(path).toContain("/generated/");
    expect(path).not.toContain("..");
    expect(path).not.toContain("@");
    expect(validateGeneratedDocumentStoragePath(path, { userId, conversationId, generatedDocumentId, filename: "default.pdf", format: "pdf" })).toBe(false);
    expect(validateGeneratedDocumentStoragePath(path, { userId, conversationId, generatedDocumentId, filename: "_secretexample.com.pdf", format: "pdf" })).toBe(true);
  });

  it("rejects wrong owner, conversation, document ID, and format paths", () => {
    const path = `${userId}/${conversationId}/generated/${generatedDocumentId}/report.pptx`;

    expect(validateGeneratedDocumentStoragePath(path, { userId, conversationId, generatedDocumentId, filename: "report.pptx", format: "pptx" })).toBe(true);
    expect(validateGeneratedDocumentStoragePath(path, { userId: "650e8400-e29b-41d4-a716-446655440000", conversationId, generatedDocumentId, filename: "report.pptx", format: "pptx" })).toBe(false);
    expect(validateGeneratedDocumentStoragePath(path, { userId, conversationId, generatedDocumentId, filename: "report.pptx", format: "pdf" })).toBe(false);
  });

  it("keeps storage paths out of public metadata and exposes repository boundaries", async () => {
    const record = {
      id: generatedDocumentId,
      userId,
      conversationId,
      messageId: "65e84000-e29b-41d4-a716-446655440000",
      generationRequestId: "75e84000-e29b-41d4-a716-446655440000",
      storagePath: `${userId}/${conversationId}/generated/${generatedDocumentId}/report.pdf`,
      filename: "report.pdf",
      format: "pdf" as const,
      mimeType: "application/pdf",
      sizeBytes: 128,
      templateId: null,
      createdAt: "2026-09-29T00:00:00.000Z",
    };
    const metadata = {
      id: record.id,
      conversationId: record.conversationId,
      messageId: record.messageId,
      filename: record.filename,
      format: record.format,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      templateId: record.templateId,
      createdAt: record.createdAt,
    };
    const repository = createGeneratedDocumentRepository({
      insert: async () => metadata,
      findByIdForUser: async () => metadata,
      findForConversation: async () => [metadata],
      removeByIdForUser: async () => true,
    });

    await expect(repository.create(record)).resolves.toEqual(metadata);
    expect(metadata).not.toHaveProperty("storagePath");
    await expect(repository.getByIdForUser(record.id, userId)).resolves.toEqual(metadata);
    await expect(repository.listForConversation(conversationId, userId)).resolves.toEqual([metadata]);
    await expect(repository.deleteByIdForUser(record.id, userId)).resolves.toBe(true);
  });
});
