import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `${USER_ID}/${CONVERSATION_ID}/generated/${DOCUMENT_ID}/report.pdf`;
const BYTES = new Uint8Array([1, 2, 3, 4]);

const mocks = vi.hoisted(() => ({
  supabase: { auth: { getUser: vi.fn() } },
  documents: {
    findGeneratedDocumentById: vi.fn(),
    downloadGeneratedDocument: vi.fn(),
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/documents/generated-document-server", () => mocks.documents);

import { GET } from "../../app/api/generated-documents/[generatedDocumentId]/download/route";

function recordFor(userId = USER_ID) {
  return {
    id: DOCUMENT_ID,
    userId,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    generationRequestId: REQUEST_ID,
    storagePath: `${userId}/${CONVERSATION_ID}/generated/${DOCUMENT_ID}/report.pdf`,
    filename: "report.pdf",
    format: "pdf" as const,
    mimeType: "application/pdf",
    sizeBytes: BYTES.byteLength,
    templateId: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  };
}

function context(id = DOCUMENT_ID) {
  return { params: Promise.resolve({ generatedDocumentId: id }) };
}

describe("GET /api/generated-documents/[generatedDocumentId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    mocks.documents.findGeneratedDocumentById.mockResolvedValue(recordFor());
    mocks.documents.downloadGeneratedDocument.mockResolvedValue(BYTES);
  });

  it("requires authentication before metadata or storage access", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET(new Request("http://localhost/download"), context());

    expect(response.status).toBe(401);
    expect(mocks.documents.findGeneratedDocumentById).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs before metadata lookup", async () => {
    const response = await GET(new Request("http://localhost/download"), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.documents.findGeneratedDocumentById).not.toHaveBeenCalled();
  });

  it("returns owner-scoped bytes and required safe headers", async () => {
    const response = await GET(new Request("http://localhost/download"), context());

    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toEqual(BYTES.buffer);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="report.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.documents.findGeneratedDocumentById).toHaveBeenCalledWith({
      userId: USER_ID,
      generatedDocumentId: DOCUMENT_ID,
    });
  });

  it("returns the same safe 404 for nonexistent or cross-user metadata", async () => {
    mocks.documents.findGeneratedDocumentById.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/download"), context());
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(STORAGE_PATH);

    mocks.documents.findGeneratedDocumentById.mockResolvedValue(recordFor(OTHER_USER_ID));
    const crossUser = await GET(new Request("http://localhost/download"), context());
    expect(crossUser.status).toBe(404);
  });

  it("does not expose metadata or storage errors", async () => {
    mocks.documents.findGeneratedDocumentById.mockRejectedValue(new Error("secret path"));
    const response = await GET(new Request("http://localhost/download"), context());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret path");

    mocks.documents.findGeneratedDocumentById.mockResolvedValue(recordFor());
    mocks.documents.downloadGeneratedDocument.mockRejectedValue(new Error("private storage path"));
    const storageResponse = await GET(new Request("http://localhost/download"), context());
    expect(storageResponse.status).toBe(502);
    expect(await storageResponse.text()).not.toContain("private storage path");
  });
});
