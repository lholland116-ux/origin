import { describe, expect, it, vi } from "vitest";
import {
  createGeneratedDocumentPersistenceService,
  GeneratedDocumentPersistenceError,
  type GeneratedDocumentPersistenceDependencies,
  type PersistGeneratedDocumentInput,
} from "@/lib/ai/generated-document-persistence-service";
import type { GeneratedDocumentPersistenceRecord } from "@/lib/documents/generated-document-contracts";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "b1000000-0000-4000-8000-000000000001";
const GENERATED_ID = "c1000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "d1000000-0000-4000-8000-000000000001";
const REQUEST_ID = "e1000000-0000-4000-8000-000000000001";
const BYTES = new Uint8Array([1, 2, 3]);

const input: PersistGeneratedDocumentInput = {
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  generationRequestId: REQUEST_ID,
  templateId: "business-report",
  generatedOutput: {
    filename: "report.txt",
    mimeType: "text/plain; charset=utf-8",
    bytes: BYTES,
    sizeBytes: BYTES.byteLength,
    format: "txt",
  },
  assistantMessageContent: "I created report.txt.",
};

function record(overrides: Partial<GeneratedDocumentPersistenceRecord> = {}): GeneratedDocumentPersistenceRecord {
  return {
    id: GENERATED_ID,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    generationRequestId: REQUEST_ID,
    storagePath: `${USER_ID}/${CONVERSATION_ID}/${GENERATED_ID}/report.txt`,
    filename: "report.txt",
    format: "txt",
    mimeType: "text/plain",
    sizeBytes: BYTES.byteLength,
    templateId: "business-report",
    createdAt: "2026-10-07T12:00:00.000Z",
    ...overrides,
  };
}

function setup(overrides: Partial<GeneratedDocumentPersistenceDependencies> = {}) {
  const dependencies: GeneratedDocumentPersistenceDependencies = {
    createId: () => GENERATED_ID,
    upload: vi.fn(async () => "private/storage/path"),
    persistChat: vi.fn(async () => [{
      assistant_message_id: MESSAGE_ID,
      generated_document_id: GENERATED_ID,
      was_existing: false,
    }]),
    remove: vi.fn(async () => undefined),
    findById: vi.fn(async () => record()),
    download: vi.fn(async () => BYTES),
    ...overrides,
  };
  return { dependencies, persist: createGeneratedDocumentPersistenceService(dependencies) };
}

describe("conversation-bound generated document persistence service", () => {
  it("uploads once, persists once through the existing chat mechanism, and returns a safe reference", async () => {
    const { dependencies, persist } = setup();
    const result = await persist(input);

    expect(dependencies.upload).toHaveBeenCalledOnce();
    expect(dependencies.persistChat).toHaveBeenCalledOnce();
    expect(dependencies.persistChat).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      generationRequestId: REQUEST_ID,
      generatedDocumentId: GENERATED_ID,
      storagePath: "private/storage/path",
    }));
    expect(result.reference).toMatchObject({
      kind: "generated_document",
      artifactId: GENERATED_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      format: "txt",
      mimeType: "text/plain",
    });
    expect(JSON.parse(JSON.stringify(result.reference))).toEqual(result.reference);
    expect(result.reference).not.toHaveProperty("bytes");
    expect(result.reference).not.toHaveProperty("storagePath");
    expect(result.delivery.bytes).toEqual(BYTES);
    expect(dependencies.remove).not.toHaveBeenCalled();
  });

  it("preserves the existing idempotent result and removes only the duplicate upload", async () => {
    const existingBytes = new Uint8Array([9, 8, 7]);
    const { dependencies, persist } = setup({
      persistChat: vi.fn(async () => [{
        assistant_message_id: MESSAGE_ID,
        generated_document_id: GENERATED_ID,
        was_existing: true,
      }]),
      download: vi.fn(async () => existingBytes),
    });
    const result = await persist(input);

    expect(dependencies.upload).toHaveBeenCalledOnce();
    expect(dependencies.persistChat).toHaveBeenCalledOnce();
    expect(dependencies.remove).toHaveBeenCalledOnce();
    expect(dependencies.findById).toHaveBeenCalledWith({ userId: USER_ID, generatedDocumentId: GENERATED_ID });
    expect(result.reference.messageId).toBe(MESSAGE_ID);
    expect(result.delivery.bytes).toEqual(existingBytes);
  });

  it("cleans the uploaded object when metadata persistence fails", async () => {
    const { dependencies, persist } = setup({
      persistChat: vi.fn(async () => { throw new Error("secret database detail"); }),
    });

    await expect(persist(input)).rejects.toMatchObject({
      code: "persistence_failure",
      message: "The generated document could not be saved.",
    });
    expect(dependencies.upload).toHaveBeenCalledOnce();
    expect(dependencies.persistChat).toHaveBeenCalledOnce();
    expect(dependencies.remove).toHaveBeenCalledOnce();
    expect(dependencies.findById).not.toHaveBeenCalled();
  });

  it("maps storage failures safely and does not attempt metadata persistence", async () => {
    const { dependencies, persist } = setup({
      upload: vi.fn(async () => { throw new Error("private bucket path"); }),
    });
    await expect(persist(input)).rejects.toMatchObject({
      code: "storage_failure",
      message: "The generated document could not be stored.",
    });
    expect(dependencies.persistChat).not.toHaveBeenCalled();
  });

  it("rejects unsupported or inconsistent rendered output before storage", async () => {
    const { dependencies, persist } = setup();
    await expect(persist({
      ...input,
      generatedOutput: { ...input.generatedOutput, sizeBytes: 99 },
    })).rejects.toBeInstanceOf(GeneratedDocumentPersistenceError);
    expect(dependencies.upload).not.toHaveBeenCalled();
    expect(dependencies.persistChat).not.toHaveBeenCalled();
  });
});
