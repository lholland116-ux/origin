import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedDocumentPersistenceRecord } from "../../lib/documents/generated-document-contracts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

type GeneratedDocumentLookup = (params: {
  userId: string;
  conversationId: string;
  generationRequestId: string;
}) => Promise<GeneratedDocumentPersistenceRecord | null>;

type MockQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn>;
};

type MockSupabase = {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
  rpc: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as MockSupabase,
  generatedDocumentServer: {
    findGeneratedDocumentByRequest: vi.fn<GeneratedDocumentLookup>(async () => null),
    findGeneratedDocumentById: vi.fn(async () => null),
    uploadGeneratedDocumentArtifact: vi.fn(async () => "uploaded/path"),
    removeGeneratedDocumentObjectByPath: vi.fn(async () => undefined),
    downloadGeneratedDocument: vi.fn(async () => new Uint8Array([1, 2, 3])),
  },
  openai: {
    responses: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/openai", () => ({ openai: mocks.openai }));

vi.mock("../../lib/documents/generated-document-server", () => mocks.generatedDocumentServer);

vi.mock("../../lib/documents/prepare-context", () => ({
  buildDocumentContext: vi.fn(() => ""),
}));

vi.mock("../../lib/utils", () => ({
  buildConversationTitle: vi.fn(() => "Test conversation"),
}));

vi.mock("../../lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test system prompt" }));

import { POST } from "../../app/api/chat/route";

function queryResult(data: unknown, error: unknown = null) {
  const query = {} as MockQuery;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data, error }));
  query.single = vi.fn(async () => ({ data, error }));
  query.insert = vi.fn(async () => ({ data: null, error }));
  query.upsert = vi.fn(async () => ({ data: null, error }));
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.then = vi.fn((resolve) => Promise.resolve({ data, error }).then(resolve));

  return query;
}

function setupSupabase(params: {
  plan?: string | null;
  storageError?: { statusCode?: string } | null;
}) {
  const fromCalls: string[] = [];
  const queries = {
    conversations: queryResult({
      id: CONVERSATION_ID,
      user_id: USER_ID,
      title: "Existing conversation",
    }),
    profiles: queryResult({ plan: params.plan ?? "free" }),
    usage: queryResult({ message_count: 0 }),
    messages: queryResult([
      {
        id: "30000000-0000-4000-8000-000000000001",
        role: "user",
        content: "We reviewed the release evidence and identified two follow-up actions.",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        role: "assistant",
        content: "The release is ready for the remaining review.",
        created_at: "2026-01-01T00:01:00.000Z",
      },
    ]),
  };

  const storageCreateSignedUrl = vi.fn(async () => ({
    data: params.storageError ? null : { signedUrl: "https://signed.example/image" },
    error: params.storageError,
  }));

  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return queries[table as keyof typeof queries] ?? queryResult(null);
    }),
    storage: {
      from: vi.fn(() => ({ createSignedUrl: storageCreateSignedUrl })),
    },
    rpc: vi.fn(async () => ({
      data: [{
        assistant_message_id: "350e8400-e29b-41d4-a716-446655440000",
        generated_document_id: "450e8400-e29b-41d4-a716-446655440000",
        was_existing: false,
      }],
      error: null,
    })),
  };

  return { fromCalls, storageCreateSignedUrl };
}

function request(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: CONVERSATION_ID,
        message: "Review these images.",
        generationRequestId: "750e8400-e29b-41d4-a716-446655440000",
        ...body,
      }),
    })
  );
}

function image(name: string) {
  return {
    imagePath: `${USER_ID}/${name}`,
    imageName: name,
  };
}


function configureDocumentPlanner(format = "txt") {
  mocks.openai.responses.create.mockResolvedValue({
    output_text: JSON.stringify({
      action: "generate_document",
      templateId: "general-report",
      formats: [format],
      packageAsZip: false,
      title: "Conversation Summary",
      variables: {
        title: "Conversation Summary",
        summary: "The conversation reviewed release evidence and identified two follow-up actions.",
        sections: [{
          heading: "Key points",
          body: "The release evidence was reviewed and two follow-up actions were identified.",
        }],
      },
    }),
  });
}

describe("POST /api/chat stored image validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openai.responses.stream.mockReset();
    mocks.openai.responses.create.mockReset();
    mocks.generatedDocumentServer.findGeneratedDocumentByRequest.mockImplementation(async () => null);
    mocks.generatedDocumentServer.findGeneratedDocumentById.mockImplementation(async () => null);
    mocks.generatedDocumentServer.uploadGeneratedDocumentArtifact.mockImplementation(async () => "uploaded/path");
    mocks.generatedDocumentServer.removeGeneratedDocumentObjectByPath.mockImplementation(async () => undefined);
    mocks.generatedDocumentServer.downloadGeneratedDocument.mockImplementation(async () => new Uint8Array([1, 2, 3]));
  });

  it("rejects mixed legacy and stored image inputs before database work", async () => {
    const { fromCalls } = setupSupabase({});
    const response = await request({
      imageBase64: "data:image/jpeg;base64,encoded",
      images: [image("one.jpg")],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MIXED_IMAGE_INPUT" });
    expect(fromCalls).toEqual([]);
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("rejects Free users above one image before usage or model invocation", async () => {
    const { fromCalls } = setupSupabase({ plan: "free" });
    const response = await request({ images: [image("one.jpg"), image("two.jpg")] });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "IMAGE_LIMIT_EXCEEDED" });
    expect(fromCalls).toEqual(["conversations", "profiles"]);
    expect(mocks.supabase.storage.from).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("fails closed when the stored-image plan is unavailable", async () => {
    const { fromCalls } = setupSupabase({ plan: "unknown" });
    const response = await request({ images: [image("one.jpg")] });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PLAN_UNAVAILABLE" });
    expect(fromCalls).toEqual(["conversations", "profiles"]);
    expect(mocks.supabase.storage.from).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("rejects inaccessible stored images before usage or persistence", async () => {
    const { fromCalls, storageCreateSignedUrl } = setupSupabase({
      plan: "pro",
      storageError: { statusCode: "404" },
    });
    const response = await request({ images: [image("one.jpg")] });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect(storageCreateSignedUrl).toHaveBeenCalledOnce();
    expect(fromCalls).toEqual(["conversations", "profiles"]);
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("rejects stored images during regeneration without changing legacy regeneration", async () => {
    const { fromCalls } = setupSupabase({ plan: "pro" });
    const response = await request({ regenerate: true, images: [image("one.jpg")] });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "REGENERATE_IMAGES_NOT_SUPPORTED",
    });
    expect(fromCalls).toEqual([]);
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });
});


describe("POST /api/chat document generation integration", () => {
  it("generates a TXT summary from an existing conversation", async () => {
    setupSupabase({});
    mocks.openai.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "general-report",
        formats: ["txt"],
        packageAsZip: false,
        title: "Conversation Summary",
        variables: {
          title: "Conversation Summary",
          summary: "The conversation reviewed release evidence and identified two follow-up actions.",
          sections: [
            {
              heading: "Key points",
              body: "The release evidence was reviewed and two follow-up actions were identified.",
            },
          ],
        },
      }),
    });

    const response = await request({
      message: "Create a TXT summary of the key points from this conversation.",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"Conversation-Summary.txt\"",
    );
    expect(await response.text()).toContain("The conversation reviewed release evidence");
    expect(response.headers.get("x-generated-document-id")).toBe("450e8400-e29b-41d4-a716-446655440000");
    expect(mocks.generatedDocumentServer.uploadGeneratedDocumentArtifact).toHaveBeenCalledOnce();
    expect(mocks.supabase.rpc).toHaveBeenCalledWith("persist_generated_document_chat", expect.objectContaining({
      p_generation_request_id: "750e8400-e29b-41d4-a716-446655440000",
    }));

    const plannerInput = mocks.openai.responses.create.mock.calls[0]?.[0]?.input as string;
    const plannerRequest = mocks.openai.responses.create.mock.calls[0]?.[0];
    expect(plannerInput).toContain("We reviewed the release evidence");
    expect(plannerInput).toContain("requiredVariables");
    expect(plannerRequest).toMatchObject({ model: "gpt-5.6-luna" });
    expect(plannerRequest).not.toHaveProperty("reasoning");
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
  });

  it("keeps malformed generation variables as a safe 400", async () => {
    setupSupabase({});
    mocks.openai.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "general-report",
        formats: ["txt"],
        packageAsZip: false,
        title: "Missing fields",
        variables: { title: "Missing required report fields" },
      }),
    });

    const response = await request({
      message: "Create a TXT summary of the key points from this conversation.",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The requested document could not be generated.",
    });
    expect(mocks.generatedDocumentServer.uploadGeneratedDocumentArtifact).not.toHaveBeenCalled();
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
  });

  it("does not fall through to ordinary chat when an explicit planner result is none", async () => {
    setupSupabase({});
    mocks.openai.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "none", templateId: "", formats: [], packageAsZip: false, title: "", variables: {},
      }),
    });

    const response = await request({ message: "Create a PDF summary." });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The requested document could not be generated.",
    });
    expect(mocks.openai.responses.stream).not.toHaveBeenCalled();
    expect(mocks.generatedDocumentServer.uploadGeneratedDocumentArtifact).not.toHaveBeenCalled();
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
  });

  it("keeps informational format questions on ordinary chat", async () => {
    setupSupabase({});
    mocks.openai.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "none", templateId: "", formats: [], packageAsZip: false, title: "", variables: {},
      }),
    });
    mocks.openai.responses.stream.mockResolvedValue((async function* () {
      yield { type: "response.output_text.delta", delta: "A PDF is a document format." };
      yield { type: "response.completed" };
    })());

    const response = await request({ message: "What is a PDF?" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("A PDF is a document format.");
    expect(mocks.openai.responses.stream).toHaveBeenCalledOnce();
  });

  it("rejects malformed generation request UUIDs before persistence", async () => {
    setupSupabase({});
    const response = await request({ generationRequestId: "not-a-uuid" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "generationRequestId is invalid." });
    expect(mocks.generatedDocumentServer.findGeneratedDocumentByRequest).not.toHaveBeenCalled();
  });
  it("reuses a durable artifact on the same request UUID without regenerating", async () => {
    setupSupabase({});
    const existing = {
      id: "450e8400-e29b-41d4-a716-446655440000",
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      messageId: "350e8400-e29b-41d4-a716-446655440000",
      generationRequestId: "750e8400-e29b-41d4-a716-446655440000",
      storagePath: USER_ID + "/" + CONVERSATION_ID + "/generated/450e8400-e29b-41d4-a716-446655440000/Conversation-Summary.txt",
      filename: "Conversation-Summary.txt",
      format: "txt" as const,
      mimeType: "text/plain",
      sizeBytes: 3,
      templateId: "general-report",
      createdAt: "2026-09-29T00:00:00.000Z",
    };
    mocks.generatedDocumentServer.findGeneratedDocumentByRequest.mockResolvedValue(existing);
    mocks.generatedDocumentServer.downloadGeneratedDocument.mockResolvedValue(new Uint8Array([7, 8, 9]));

    const response = await request({ message: "Create the report again." });

    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([7, 8, 9]);
    expect(response.headers.get("x-generated-document-id")).toBe(existing.id);
    expect(mocks.openai.responses.create).not.toHaveBeenCalled();
    expect(mocks.generatedDocumentServer.uploadGeneratedDocumentArtifact).not.toHaveBeenCalled();
  });

  it("removes an uploaded object when atomic metadata persistence fails", async () => {
    setupSupabase({});
    configureDocumentPlanner();
    mocks.supabase.rpc.mockResolvedValue({ data: null, error: { message: "db failure" } });
    const response = await request({ message: "Create a TXT summary." });

    expect(response.status).toBe(500);
    expect(mocks.generatedDocumentServer.uploadGeneratedDocumentArtifact).toHaveBeenCalledOnce();
    expect(mocks.generatedDocumentServer.removeGeneratedDocumentObjectByPath).toHaveBeenCalledOnce();
  });

  it("supports binary persistence metadata using PDF", async () => {
    setupSupabase({});
    configureDocumentPlanner("pdf");
    const response = await request({
      message: "Create a PDF summary.",
      reasoningMode: "instant",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-generated-document-id")).toBe("450e8400-e29b-41d4-a716-446655440000");
    expect(mocks.generatedDocumentServer.uploadGeneratedDocumentArtifact).toHaveBeenCalledOnce();
    expect(mocks.openai.responses.create).toHaveBeenCalledOnce();
    expect(mocks.openai.responses.create.mock.calls[0]?.[0]).not.toHaveProperty("reasoning");
  });
});
