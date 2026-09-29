import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `generated/${USER_ID}/${CONVERSATION_ID}/image.webp`;
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000001";
const DOCUMENT_PATH = USER_ID + "/" + CONVERSATION_ID + "/generated/" + DOCUMENT_ID + "/report.pdf";

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as {
    auth: { getUser: ReturnType<typeof vi.fn> };
    from: ReturnType<typeof vi.fn>;
  },
  admin: null as unknown as {
    storage: { from: ReturnType<typeof vi.fn> };
  },
  documents: {
    listGeneratedDocumentsForConversation: vi.fn(),
    removeGeneratedDocumentObjects: vi.fn(),
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

vi.mock("../../lib/documents/generated-document-server", () => mocks.documents);

function query<T>(result: T) {
  const builder = {} as {
    select: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    then: Promise<T>["then"];
  };
  builder.select = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function documentRecord(id = DOCUMENT_ID) {
  return {
    id,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    messageId: "30000000-0000-4000-8000-000000000001",
    generationRequestId: "50000000-0000-4000-8000-000000000001",
    storagePath: id === DOCUMENT_ID ? DOCUMENT_PATH : USER_ID + "/" + CONVERSATION_ID + "/generated/" + id + "/second.pdf",
    filename: id === DOCUMENT_ID ? "report.pdf" : "second.pdf",
    format: "pdf" as const,
    mimeType: "application/pdf",
    sizeBytes: 4,
    templateId: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  };
}

import { DELETE } from "../../app/api/conversations/route";

describe("DELETE /api/conversations generated artifact cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const generatedQuery = query({
      data: [{ storage_path: STORAGE_PATH }],
      error: null,
    });
    const deleteQuery = query({ data: null, error: null });
    mocks.supabase = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: USER_ID } },
          error: null,
        })),
      },
      from: vi.fn((table: string) =>
        table === "message_generated_images" ? generatedQuery : deleteQuery,
      ),
    };
    const remove = vi.fn(async () => ({ data: [], error: null }));
    mocks.admin = {
      storage: { from: vi.fn(() => ({ remove })) },
    };
    mocks.documents.listGeneratedDocumentsForConversation.mockResolvedValue([]);
    mocks.documents.removeGeneratedDocumentObjects.mockResolvedValue(undefined);
  });

  it("removes generated documents and images before deleting the owned conversation", async () => {
    const documents = [documentRecord()];
    mocks.documents.listGeneratedDocumentsForConversation.mockResolvedValue(documents);

    const response = await DELETE(
      new NextRequest(`http://localhost/api/conversations?id=${CONVERSATION_ID}`),
    );

    expect(response.status).toBe(200);
    expect(mocks.documents.listGeneratedDocumentsForConversation).toHaveBeenCalledWith({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    });
    expect(mocks.documents.removeGeneratedDocumentObjects).toHaveBeenCalledWith(documents);
    const storage = mocks.admin.storage.from.mock.results[0]?.value as {
      remove: ReturnType<typeof vi.fn>;
    };
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(1, "message_generated_images");
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(2, "conversations");
  });

  it("supports multiple generated documents without touching another conversation", async () => {
    const documents = [documentRecord(), documentRecord("40000000-0000-4000-8000-000000000002")];
    mocks.documents.listGeneratedDocumentsForConversation.mockResolvedValue(documents);
    const generatedQuery = query({ data: [], error: null });
    const deleteQuery = query({ data: null, error: null });
    mocks.supabase.from = vi.fn((table: string) => table === "message_generated_images" ? generatedQuery : deleteQuery);

    const response = await DELETE(
      new NextRequest(`http://localhost/api/conversations?id=${CONVERSATION_ID}`),
    );

    expect(response.status).toBe(200);
    expect(mocks.documents.removeGeneratedDocumentObjects).toHaveBeenCalledWith(documents);
    expect(mocks.supabase.from).toHaveBeenCalledWith("conversations");
  });

  it("does not delete the conversation when generated-document cleanup fails", async () => {
    mocks.documents.listGeneratedDocumentsForConversation.mockResolvedValue([documentRecord()]);
    mocks.documents.removeGeneratedDocumentObjects.mockRejectedValue(new Error("storage unavailable"));

    const response = await DELETE(
      new NextRequest(`http://localhost/api/conversations?id=${CONVERSATION_ID}`),
    );

    expect(response.status).toBe(500);
    expect(mocks.supabase.from).toHaveBeenCalledWith("message_generated_images");
    expect(mocks.supabase.from).not.toHaveBeenCalledWith("conversations");
  });

  it("reports conversation deletion failure after cleanup without hiding the error", async () => {
    const generatedQuery = query({ data: [], error: null });
    const failedDeleteQuery = query({ data: null, error: { message: "database unavailable" } });
    mocks.supabase.from = vi.fn((table: string) => table === "message_generated_images" ? generatedQuery : failedDeleteQuery);

    const response = await DELETE(
      new NextRequest(`http://localhost/api/conversations?id=${CONVERSATION_ID}`),
    );

    expect(response.status).toBe(500);
    expect(mocks.documents.removeGeneratedDocumentObjects).toHaveBeenCalledWith([]);
  });

  it("preserves zero-artifact conversation deletion", async () => {
    const generatedQuery = query({ data: [], error: null });
    const deleteQuery = query({ data: null, error: null });
    mocks.supabase.from = vi.fn((table: string) => table === "message_generated_images" ? generatedQuery : deleteQuery);

    const response = await DELETE(
      new NextRequest(`http://localhost/api/conversations?id=${CONVERSATION_ID}`),
    );

    expect(response.status).toBe(200);
    expect(mocks.documents.removeGeneratedDocumentObjects).toHaveBeenCalledWith([]);
    expect(mocks.supabase.from).toHaveBeenCalledWith("conversations");
  });
});
