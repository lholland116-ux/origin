import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const STORAGE_PATH = USER_ID + "/" + CONVERSATION_ID + "/generated/" + DOCUMENT_ID + "/report.pdf";

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as {
    auth: { getUser: ReturnType<typeof vi.fn> };
    from: ReturnType<typeof vi.fn>;
  },
  documents: {
    findGeneratedDocumentById: vi.fn(),
    removeGeneratedDocumentObject: vi.fn(),
    deleteGeneratedDocumentMetadata: vi.fn(),
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/documents/generated-document-server", () => mocks.documents);

import { DELETE } from "../../app/api/generated-documents/[generatedDocumentId]/route";

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder = {} as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    generationRequestId: REQUEST_ID,
    storagePath: STORAGE_PATH,
    filename: "report.pdf",
    format: "pdf" as const,
    mimeType: "application/pdf",
    sizeBytes: 4,
    templateId: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    ...overrides,
  };
}

function configure(options: {
  user?: { id: string } | null;
  document?: unknown;
  documentError?: Error;
  message?: { data: unknown; error: { message: string } | null };
  removeError?: Error;
  metadataResult?: boolean;
  metadataError?: Error;
} = {}) {
  const messageQuery = query(options.message ?? { data: { id: MESSAGE_ID }, error: null });
  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.user === undefined ? { id: USER_ID } : options.user },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table !== "messages") throw new Error("Unexpected table");
      return messageQuery;
    }),
  };
  mocks.documents.findGeneratedDocumentById.mockImplementation(async () => {
    if (options.documentError) throw options.documentError;
    return options.document === undefined ? record() : options.document;
  });
  mocks.documents.removeGeneratedDocumentObject.mockImplementation(async () => {
    if (options.removeError) throw options.removeError;
  });
  mocks.documents.deleteGeneratedDocumentMetadata.mockImplementation(async () => {
    if (options.metadataError) throw options.metadataError;
    return options.metadataResult ?? true;
  });
  return { messageQuery };
}

function request(id = DOCUMENT_ID): NextRequest {
  return new NextRequest("http://localhost/api/generated-documents/" + id, {
    method: "DELETE",
    body: JSON.stringify({
      storagePath: "other-user/secret.pdf",
      conversationId: "forged-conversation",
    }),
    headers: { "content-type": "application/json" },
  });
}

function context(id = DOCUMENT_ID) {
  return { params: Promise.resolve({ generatedDocumentId: id }) };
}

describe("DELETE /api/generated-documents/[generatedDocumentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication before metadata or Storage access", async () => {
    configure({ user: null });
    const response = await DELETE(request(), context());
    expect(response.status).toBe(401);
    expect(mocks.documents.findGeneratedDocumentById).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs before metadata lookup", async () => {
    configure();
    const response = await DELETE(request("not-a-uuid"), context("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(mocks.documents.findGeneratedDocumentById).not.toHaveBeenCalled();
  });

  it("returns safe not-found semantics for nonexistent and cross-user artifacts", async () => {
    configure({ document: null });
    expect((await DELETE(request(), context())).status).toBe(404);

    configure({ document: record({ userId: OTHER_USER_ID }) });
    expect((await DELETE(request(), context())).status).toBe(404);
    expect(mocks.documents.removeGeneratedDocumentObject).not.toHaveBeenCalled();
  });

  it("validates the persisted message and storage path before cleanup", async () => {
    configure({ document: record({ storagePath: USER_ID + "/" + CONVERSATION_ID + "/generated/" + DOCUMENT_ID + "/../secret.pdf" }) });
    expect((await DELETE(request(), context())).status).toBe(404);
    expect(mocks.documents.removeGeneratedDocumentObject).not.toHaveBeenCalled();

    configure({ message: { data: null, error: null } });
    expect((await DELETE(request(), context())).status).toBe(404);
    expect(mocks.documents.removeGeneratedDocumentObject).not.toHaveBeenCalled();
  });

  it("deletes Storage before owner-scoped metadata and ignores client paths", async () => {
    const { messageQuery } = configure();
    const response = await DELETE(request(), context());
    expect(response.status).toBe(200);
    expect(mocks.documents.findGeneratedDocumentById).toHaveBeenCalledWith({
      userId: USER_ID,
      generatedDocumentId: DOCUMENT_ID,
    });
    expect(mocks.documents.removeGeneratedDocumentObject).toHaveBeenCalledWith({ record: record() });
    expect(mocks.documents.deleteGeneratedDocumentMetadata).toHaveBeenCalledWith(record());
    expect(mocks.documents.removeGeneratedDocumentObject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.documents.deleteGeneratedDocumentMetadata.mock.invocationCallOrder[0],
    );
    expect(messageQuery.eq).toHaveBeenCalledWith("conversation_id", CONVERSATION_ID);
    expect(messageQuery.eq).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("leaves metadata when Storage cleanup fails", async () => {
    configure({ removeError: new Error("storage unavailable") });
    const response = await DELETE(request(), context());
    expect(response.status).toBe(502);
    expect(mocks.documents.deleteGeneratedDocumentMetadata).not.toHaveBeenCalled();
  });

  it("reports metadata failure after Storage cleanup without exposing internals", async () => {
    configure({ metadataError: new Error("private database detail") });
    const response = await DELETE(request(), context());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database detail");
    expect(mocks.documents.removeGeneratedDocumentObject).toHaveBeenCalledTimes(1);
  });

  it("supports idempotent cleanup when Storage reports an already-missing object", async () => {
    configure();
    const response = await DELETE(request(), context());
    expect(response.status).toBe(200);
    expect(mocks.documents.deleteGeneratedDocumentMetadata).toHaveBeenCalledTimes(1);
  });
});
