import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const PDF_PATH = USER_ID + "/" + CONVERSATION_ID + "/generated/" + DOCUMENT_ID + "/report.pdf";

const mocks = vi.hoisted(() => ({
  admin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

import {
  downloadGeneratedDocument,
  findGeneratedDocumentByRequest,
  listGeneratedDocumentsForConversation,
  removeGeneratedDocumentObject,
  removeGeneratedDocumentObjects,
  deleteGeneratedDocumentMetadata,
  uploadGeneratedDocumentArtifact,
} from "@/lib/documents/generated-document-server";

function metadataRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    message_id: MESSAGE_ID,
    generation_request_id: REQUEST_ID,
    storage_path: PDF_PATH,
    filename: "report.pdf",
    format: "pdf",
    mime_type: "application/pdf",
    size_bytes: 4,
    template_id: null,
    created_at: "2026-09-29T00:00:00.000Z",
    ...overrides,
  };
}

function configureLookup(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error })),
    order: vi.fn(),
    delete: vi.fn(),
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  mocks.admin.from.mockReturnValue(query);
  return query;
}

describe("generated document server persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes metadata lookup by authenticated owner, conversation, and request", async () => {
    const query = configureLookup(metadataRow());
    await expect(findGeneratedDocumentByRequest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      generationRequestId: REQUEST_ID,
    })).resolves.toMatchObject({ id: DOCUMENT_ID, storagePath: PDF_PATH });
    expect(query.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(query.eq).toHaveBeenCalledWith("conversation_id", CONVERSATION_ID);
    expect(query.eq).toHaveBeenCalledWith("generation_request_id", REQUEST_ID);
  });

  it("rejects tampered metadata paths instead of exposing them", async () => {
    configureLookup(metadataRow({ storage_path: USER_ID + "/" + CONVERSATION_ID + "/generated/" + DOCUMENT_ID + "/../secret.pdf" }));
    await expect(findGeneratedDocumentByRequest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      generationRequestId: REQUEST_ID,
    })).resolves.toBeNull();
  });


  it("lists only fully validated documents for one owner and conversation", async () => {
    const query = configureLookup([metadataRow()], null);
    await expect(listGeneratedDocumentsForConversation({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    })).resolves.toHaveLength(1);
    expect(query.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(query.eq).toHaveBeenCalledWith("conversation_id", CONVERSATION_ID);
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("fails closed when conversation cleanup sees malformed metadata", async () => {
    configureLookup([metadataRow({ storage_path: USER_ID + "/" + CONVERSATION_ID + "/generated/" + DOCUMENT_ID + "/../secret.pdf" })], null);
    await expect(listGeneratedDocumentsForConversation({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    })).rejects.toThrow("validation");
  });

  it("uploads with canonical MIME and upsert disabled", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    mocks.admin.storage.from.mockReturnValue({ upload });
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(uploadGeneratedDocumentArtifact({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      generatedDocumentId: DOCUMENT_ID,
      filename: "report.pdf",
      format: "pdf",
      mimeType: "application/pdf",
      bytes,
    })).resolves.toBe(PDF_PATH);
    expect(upload).toHaveBeenCalledWith(PDF_PATH, expect.anything(), {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });
  });

  it("validates cleanup paths before calling Storage", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    mocks.admin.storage.from.mockReturnValue({ remove });
    await expect(removeGeneratedDocumentObject({
      record: {
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        id: DOCUMENT_ID,
        filename: "report.pdf",
        format: "pdf",
        storagePath: USER_ID + "/" + CONVERSATION_ID + "/generated/" + DOCUMENT_ID + "/../secret.pdf",
      },
    })).rejects.toThrow("storage path");
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes multiple validated objects in one bounded Storage call", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    mocks.admin.storage.from.mockReturnValue({ remove });
    const second = {
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      id: "40000000-0000-4000-8000-000000000002",
      filename: "second.pdf",
      format: "pdf" as const,
      storagePath: USER_ID + "/" + CONVERSATION_ID + "/generated/40000000-0000-4000-8000-000000000002/second.pdf",
    };
    await expect(removeGeneratedDocumentObjects([
      {
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        id: DOCUMENT_ID,
        filename: "report.pdf",
        format: "pdf",
        storagePath: PDF_PATH,
      },
      second,
    ])).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([PDF_PATH, second.storagePath]);
  });

  it("treats an already-missing Storage object as cleanup success", async () => {
    const remove = vi.fn(async () => ({
      error: { statusCode: "404", message: "Object not found." },
    }));
    mocks.admin.storage.from.mockReturnValue({ remove });
    await expect(removeGeneratedDocumentObject({
      record: {
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        id: DOCUMENT_ID,
        filename: "report.pdf",
        format: "pdf",
        storagePath: PDF_PATH,
      },
    })).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([PDF_PATH]);
  });

  it("removes metadata with all owner and linkage filters", async () => {
    const query = configureLookup({ id: DOCUMENT_ID }, null);
    await expect(deleteGeneratedDocumentMetadata({
      id: DOCUMENT_ID,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
    })).resolves.toBe(true);
    expect(query.delete).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenCalledWith("id", DOCUMENT_ID);
    expect(query.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(query.eq).toHaveBeenCalledWith("conversation_id", CONVERSATION_ID);
    expect(query.eq).toHaveBeenCalledWith("message_id", MESSAGE_ID);
  });

  it("rejects downloaded bytes whose size differs from persisted metadata", async () => {
    mocks.admin.storage.from.mockReturnValue({
      download: vi.fn(async () => ({
        data: new Blob([new Uint8Array([1, 2, 3])]),
        error: null,
      })),
    });
    await expect(downloadGeneratedDocument({
      storagePath: PDF_PATH,
      sizeBytes: 4,
    })).rejects.toThrow("size");
  });
});
