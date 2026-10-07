import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

type MockQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  then: Promise<{ data: unknown; error: { message: string } | null }> ["then"];
};

type MockSupabase = {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
};

type MockAdmin = {
  from: ReturnType<typeof vi.fn>;
  storage: { from: ReturnType<typeof vi.fn> };
};

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as MockSupabase,
  admin: null as unknown as MockAdmin,
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

import { GET } from "../../app/api/messages/route";

function queryResult(data: unknown, error: { message: string } | null = null) {
  const query = {} as MockQuery;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return query;
}

function parentMessage(
  id: string,
  createdAt: string,
  legacyImagePath: string | null = null
) {
  return {
    id,
    role: "user",
    content: `Message ${id}`,
    created_at: createdAt,
    image_path: legacyImagePath,
    image_name: legacyImagePath ? "legacy.jpg" : null,
    documents: [],
    sources: [],
    source_count: 0,
    widget: null,
  };
}

function childImage(messageId: string, id: string, ordinal: number, name: string) {
  return {
    id,
    message_id: messageId,
    storage_path: `${USER_ID}/${name}`,
    image_name: name,
    ordinal,
    created_at: `2026-09-13T12:00:0${ordinal}.000Z`,
  };
}

function setupSupabase(params: {
  parents: unknown[];
  childRows?: unknown[];
  childQueryError?: { message: string } | null;
  generatedRows?: unknown[];
  generatedQueryError?: { message: string } | null;
  generatedDocumentRows?: unknown[];
  generatedDocumentQueryError?: { message: string } | null;
  signingFailures?: string[];
}) {
  const messageQuery = queryResult(params.parents);
  const childQuery = queryResult(params.childRows ?? [], params.childQueryError ?? null);
  const generatedQuery = queryResult(
    params.generatedRows ?? [],
    params.generatedQueryError ?? null,
  );
  const generatedDocumentQuery = queryResult(
    params.generatedDocumentRows ?? [],
    params.generatedDocumentQueryError ?? null,
  );
  const fromCalls: string[] = [];
  const adminFromCalls: string[] = [];
  const createSignedUrl = vi.fn(async (path: string, lifetime: number) => {
    if (params.signingFailures?.includes(path)) {
      return { data: null, error: { message: "Storage object unavailable." } };
    }

    return {
      data: {
        signedUrl: `https://signed.example/${encodeURIComponent(path)}`,
      },
      error: null,
      lifetime,
    };
  });

    mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      if (table === "messages") return messageQuery;
      if (table === "message_images") return childQuery;
      if (table === "message_generated_images") return generatedQuery;
      return generatedQuery;
    }),
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
  };
  mocks.admin = {
    from: vi.fn((table: string) => {
      adminFromCalls.push(table);
      if (table === "generated_documents") return generatedDocumentQuery;
      return generatedQuery;
    }),
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
  };

  return {
    childQuery,
    createSignedUrl,
    fromCalls,
    adminFromCalls,
    messageQuery,
    generatedQuery,
    generatedDocumentQuery,
  };
}

function request() {
  return GET(
    new NextRequest(
      `http://localhost/api/messages?conversationId=${CONVERSATION_ID}`
    )
  );
}

describe("GET /api/messages durable multi-image reads", () => {
  beforeEach(() => {
    mocks.supabase = null as unknown as MockSupabase;
  });

  it.each([1, 2, 3])(
    "returns %s child image(s) with signed URLs in ordinal order",
    async (count) => {
      const firstMessage = parentMessage(
        "30000000-0000-4000-8000-000000000001",
        "2026-09-13T12:00:00.000Z"
      );
      const secondMessage = parentMessage(
        "30000000-0000-4000-8000-000000000002",
        "2026-09-13T12:01:00.000Z"
      );
      const rows = Array.from({ length: count }, (_, index) =>
        childImage(firstMessage.id, `40000000-0000-4000-8000-00000000000${index + 1}`, index + 1, `image-${index + 1}.jpg`)
      ).reverse();
      const setup = setupSupabase({
        parents: [firstMessage, secondMessage],
        childRows: rows,
      });

      const response = await request();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.messages.map((message: { id: string }) => message.id)).toEqual([
        firstMessage.id,
        secondMessage.id,
      ]);
      expect(body.messages[0].images.map((image: { image_name: string }) => image.image_name)).toEqual(
        Array.from({ length: count }, (_, index) => `image-${index + 1}.jpg`)
      );
      expect(body.messages[0].images.map((image: { ordinal: number }) => image.ordinal)).toEqual(
        Array.from({ length: count }, (_, index) => index + 1)
      );
      expect(body.messages[0].images.every((image: { image_url: string }) => image.image_url.startsWith("https://signed.example/"))).toBe(true);
      expect(body.messages[0].has_child_images).toBe(true);
      expect(body.messages[1].images).toEqual([]);
      expect(setup.fromCalls).toEqual([
        "messages",
        "message_images",
        "message_generated_images",
      ]);
      expect(setup.adminFromCalls).toEqual(["generated_documents"]);
      expect(setup.childQuery.in).toHaveBeenCalledWith("message_id", [firstMessage.id, secondMessage.id]);
      expect(setup.createSignedUrl).toHaveBeenCalledTimes(count);
      expect(setup.createSignedUrl).toHaveBeenCalledWith(
        `${USER_ID}/image-1.jpg`,
        3600
      );
    }
  );

  it("preserves non-contiguous authoritative child ordinals without renumbering", async () => {
    const parent = parentMessage(
      "30000000-0000-4000-8000-000000000007",
      "2026-09-13T12:00:00.000Z",
    );
    const setup = setupSupabase({
      parents: [parent],
      childRows: [
        childImage(parent.id, "40000000-0000-4000-8000-000000000007", 3, "three.jpg"),
        childImage(parent.id, "40000000-0000-4000-8000-000000000006", 1, "one.jpg"),
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].images.map((image: { ordinal: number }) => image.ordinal)).toEqual([1, 3]);
    expect(body.messages[0].images.map((image: { image_name: string }) => image.image_name)).toEqual([
      "one.jpg",
      "three.jpg",
    ]);
    expect(setup.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("omits child rows with malformed ordinals without deriving a replacement ordinal", async () => {
    const parent = parentMessage(
      "30000000-0000-4000-8000-000000000008",
      "2026-09-13T12:00:00.000Z",
    );
    const setup = setupSupabase({
      parents: [parent],
      childRows: [
        childImage(parent.id, "40000000-0000-4000-8000-000000000014", 3, "valid.jpg"),
        childImage(parent.id, "40000000-0000-4000-8000-000000000015", 0, "zero.jpg"),
        childImage(
          parent.id,
          "40000000-0000-4000-8000-000000000016",
          Number.MAX_SAFE_INTEGER + 1,
          "unsafe.jpg",
        ),
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].images.map((image: { image_name: string }) => image.image_name)).toEqual([
      "valid.jpg",
    ]);
    expect(body.messages[0].images.map((image: { ordinal: number }) => image.ordinal)).toEqual([3]);
    expect(setup.createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("excludes child rows outside the authorized parent message IDs", async () => {
    const parent = parentMessage(
      "30000000-0000-4000-8000-000000000003",
      "2026-09-13T12:00:00.000Z"
    );
    const setup = setupSupabase({
      parents: [parent],
      childRows: [
        childImage(parent.id, "40000000-0000-4000-8000-000000000003", 1, "owned.jpg"),
        childImage(
          "30000000-0000-4000-8000-000000000099",
          "40000000-0000-4000-8000-000000000099",
          1,
          "other-conversation.jpg"
        ),
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].images).toHaveLength(1);
    expect(body.messages[0].images[0].image_name).toBe("owned.jpg");
    expect(setup.childQuery.in).toHaveBeenCalledWith("message_id", [parent.id]);
    expect(setup.createSignedUrl).not.toHaveBeenCalledWith(
      `${USER_ID}/other-conversation.jpg`,
      3600
    );
  });

  it("preserves parent messages when the child-image query fails", async () => {
    const parent = parentMessage(
      "30000000-0000-4000-8000-000000000004",
      "2026-09-13T12:00:00.000Z",
      `${USER_ID}/legacy.jpg`
    );
    const setup = setupSupabase({
      parents: [parent],
      childQueryError: { message: "message_images unavailable" },
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).toMatchObject({
      id: parent.id,
      content: parent.content,
      image_path: `${USER_ID}/legacy.jpg`,
      images: [],
      has_child_images: false,
    });
    expect(setup.createSignedUrl).not.toHaveBeenCalled();
  });

  it("omits only an unsigned child image without leaking its failed path", async () => {
    const parent = parentMessage(
      "30000000-0000-4000-8000-000000000005",
      "2026-09-13T12:00:00.000Z",
      `${USER_ID}/legacy.jpg`
    );
    const failedPath = `${USER_ID}/missing.jpg`;
    const setup = setupSupabase({
      parents: [parent],
      childRows: [
        childImage(parent.id, "40000000-0000-4000-8000-000000000005", 1, "valid.jpg"),
        childImage(parent.id, "40000000-0000-4000-8000-000000000006", 2, "missing.jpg"),
        childImage(parent.id, "40000000-0000-4000-8000-000000000007", 3, "valid-two.jpg"),
      ],
      signingFailures: [failedPath],
    });

    const response = await request();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.messages[0].has_child_images).toBe(true);
    expect(body.messages[0].images.map((image: { image_name: string }) => image.image_name)).toEqual([
      "valid.jpg",
      "valid-two.jpg",
    ]);
    expect(serialized).not.toContain(failedPath);
    expect(serialized).toContain(`${USER_ID}/legacy.jpg`);
    expect(setup.createSignedUrl).toHaveBeenCalledTimes(3);
  });

  it("does not consult plan data when reading historical images", async () => {
    const parent = parentMessage(
      "30000000-0000-4000-8000-000000000006",
      "2026-09-13T12:00:00.000Z"
    );
    const setup = setupSupabase({
      parents: [parent],
      childRows: [
        childImage(parent.id, "40000000-0000-4000-8000-000000000008", 1, "one.jpg"),
        childImage(parent.id, "40000000-0000-4000-8000-000000000009", 2, "two.jpg"),
        childImage(parent.id, "40000000-0000-4000-8000-000000000010", 3, "three.jpg"),
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].images).toHaveLength(3);
    expect(setup.fromCalls).not.toContain("profiles");
    expect(setup.fromCalls).not.toContain("usage");
  });

  it("skips the child query when no authorized parent messages exist", async () => {
    const setup = setupSupabase({ parents: [], childRows: [] });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([]);
    expect(setup.fromCalls).toEqual(["messages"]);
  });

  it("hydrates an authorized generated image with safe signed metadata", async () => {
    const parent = {
      ...parentMessage(
        "30000000-0000-4000-8000-000000000011",
        "2026-09-13T12:00:00.000Z",
      ),
      role: "assistant",
      content: "",
    };
    const storagePath = `generated/${USER_ID}/${CONVERSATION_ID}/image.webp`;
    const setup = setupSupabase({
      parents: [parent],
      generatedRows: [
        {
          id: "40000000-0000-4000-8000-000000000011",
          message_id: parent.id,
          conversation_id: CONVERSATION_ID,
          user_id: USER_ID,
          storage_path: storagePath,
          mime_type: "image/webp",
          provider: "replicate",
          model: "black-forest-labs/flux-schnell",
        },
        {
          id: "40000000-0000-4000-8000-000000000012",
          message_id: parent.id,
          conversation_id: "20000000-0000-4000-8000-000000000099",
          user_id: USER_ID,
          storage_path: "generated/other-user/other-conversation/leak.webp",
          mime_type: "image/webp",
          provider: "replicate",
          model: "flux-schnell",
        },
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].generatedImage).toEqual({
      id: "40000000-0000-4000-8000-000000000011",
      url: `https://signed.example/${encodeURIComponent(storagePath)}`,
      mimeType: "image/webp",
      provider: "replicate",
      model: "black-forest-labs/flux-schnell",
    });
    expect(JSON.stringify(body)).not.toContain(storagePath);
    expect(setup.fromCalls).toContain("message_generated_images");
  });

  it("hydrates a completed image-edit derivative using its Runware model identifier", async () => {
    const assistantMessage = {
      ...parentMessage(
        "30000000-0000-4000-8000-000000000013",
        "2026-09-13T12:00:00.000Z",
      ),
      role: "assistant",
      content: "",
    };
    const storagePath = `generated/${USER_ID}/${CONVERSATION_ID}/edited-image.png`;
    const generatedImageId = "40000000-0000-4000-8000-000000000014";
    const setup = setupSupabase({
      parents: [assistantMessage],
      generatedRows: [
        {
          id: generatedImageId,
          message_id: assistantMessage.id,
          conversation_id: CONVERSATION_ID,
          user_id: USER_ID,
          storage_path: storagePath,
          mime_type: "image/png",
          provider: "runware",
          model: "runware:400@4",
        },
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].id).toBe(assistantMessage.id);
    expect(body.messages[0].generatedImage).toEqual({
      id: generatedImageId,
      url: `https://signed.example/${encodeURIComponent(storagePath)}`,
      mimeType: "image/png",
      provider: "runware",
      model: "runware:400@4",
    });
    expect(setup.createSignedUrl).toHaveBeenCalledWith(storagePath, 3600);
  });

  it("returns every generated image linked to one assistant message in deterministic order", async () => {
    const assistantMessage = {
      ...parentMessage(
        "30000000-0000-4000-8000-000000000015",
        "2026-09-13T12:00:00.000Z",
      ),
      role: "assistant",
      content: "",
    };
    const firstImageId = "40000000-0000-4000-8000-000000000015";
    const secondImageId = "40000000-0000-4000-8000-000000000016";
    const firstPath = `generated/${USER_ID}/${CONVERSATION_ID}/first.webp`;
    const secondPath = `generated/${USER_ID}/${CONVERSATION_ID}/second.webp`;
    const setup = setupSupabase({
      parents: [assistantMessage],
      generatedRows: [
        {
          id: firstImageId,
          message_id: assistantMessage.id,
          conversation_id: CONVERSATION_ID,
          user_id: USER_ID,
          storage_path: firstPath,
          mime_type: "image/webp",
          provider: "replicate",
          model: "flux-schnell",
        },
        {
          id: secondImageId,
          message_id: assistantMessage.id,
          conversation_id: CONVERSATION_ID,
          user_id: USER_ID,
          storage_path: secondPath,
          mime_type: "image/png",
          provider: "runware",
          model: "runware:400@4",
        },
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].generatedImages.map((image: { id: string }) => image.id)).toEqual([
      firstImageId,
      secondImageId,
    ]);
    expect(body.messages[0]).not.toHaveProperty("generatedImage");
    expect(setup.generatedQuery.order.mock.calls).toEqual([
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(setup.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("hydrates generated documents onto their exact assistant message without exposing storage paths", async () => {
    const userMessage = parentMessage(
      "30000000-0000-4000-8000-000000000020",
      "2026-09-13T12:00:00.000Z",
    );
    const assistantMessage = {
      ...parentMessage(
        "30000000-0000-4000-8000-000000000021",
        "2026-09-13T12:01:00.000Z",
      ),
      role: "assistant",
      content: "I created the requested report.",
    };
    const storagePath = USER_ID + "/" + CONVERSATION_ID + "/generated/50000000-0000-4000-8000-000000000020/report.pdf";
    const setup = setupSupabase({
      parents: [userMessage, assistantMessage],
      generatedDocumentRows: [
        {
          id: "50000000-0000-4000-8000-000000000020",
          user_id: USER_ID,
          conversation_id: CONVERSATION_ID,
          message_id: assistantMessage.id,
          filename: "report.pdf",
          format: "pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          template_id: "general-report",
          created_at: "2026-09-13T12:01:01.000Z",
          storage_path: storagePath,
        },
        {
          id: "50000000-0000-4000-8000-000000000020",
          user_id: USER_ID,
          conversation_id: CONVERSATION_ID,
          message_id: assistantMessage.id,
          filename: "duplicate-report.pdf",
          format: "pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          template_id: "general-report",
          created_at: "2026-09-13T12:01:00.500Z",
          storage_path: "private/duplicate.pdf",
        },
        {
          id: "50000000-0000-4000-8000-000000000021",
          user_id: USER_ID,
          conversation_id: CONVERSATION_ID,
          message_id: assistantMessage.id,
          filename: "report.txt",
          format: "txt",
          mime_type: "text/plain",
          size_bytes: 128,
          template_id: null,
          created_at: "2026-09-13T12:01:02.000Z",
          storage_path: "private/second.txt",
        },
        {
          id: "50000000-0000-4000-8000-000000000022",
          user_id: "90000000-0000-4000-8000-000000000001",
          conversation_id: CONVERSATION_ID,
          message_id: assistantMessage.id,
          filename: "leak.pdf",
          format: "pdf",
          mime_type: "application/pdf",
          size_bytes: 12,
          template_id: null,
          created_at: "2026-09-13T12:01:03.000Z",
          storage_path: "other-user/leak.pdf",
        },
        {
          id: "50000000-0000-4000-8000-000000000023",
          user_id: USER_ID,
          conversation_id: "70000000-0000-4000-8000-000000000001",
          message_id: assistantMessage.id,
          filename: "other-conversation.pdf",
          format: "pdf",
          mime_type: "application/pdf",
          size_bytes: 64,
          template_id: null,
          created_at: "2026-09-13T12:01:04.000Z",
          storage_path: "other-conversation/file.pdf",
        },
      ],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages.map((message: { id: string }) => message.id)).toEqual([
      userMessage.id,
      assistantMessage.id,
    ]);
    expect(body.messages[0].generatedDocuments).toEqual([]);
    expect(body.messages[1].generatedDocuments).toEqual([
      {
        id: "50000000-0000-4000-8000-000000000020",
        conversationId: CONVERSATION_ID,
        messageId: assistantMessage.id,
        filename: "report.pdf",
        format: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        templateId: "general-report",
        createdAt: "2026-09-13T12:01:01.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000021",
        conversationId: CONVERSATION_ID,
        messageId: assistantMessage.id,
        filename: "report.txt",
        format: "txt",
        mimeType: "text/plain",
        sizeBytes: 128,
        templateId: null,
        createdAt: "2026-09-13T12:01:02.000Z",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(storagePath);
    expect(setup.generatedDocumentQuery.in).toHaveBeenCalledWith(
      "message_id",
      [userMessage.id, assistantMessage.id],
    );
    expect(setup.generatedDocumentQuery.eq).toHaveBeenCalledWith(
      "conversation_id",
      CONVERSATION_ID,
    );
    expect(setup.generatedDocumentQuery.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(setup.fromCalls).not.toContain("generated_documents");
    expect(setup.adminFromCalls).toEqual(["generated_documents"]);
  });

  it("preserves uploaded document metadata on the parent message during history hydration", async () => {
    const parent = {
      ...parentMessage(
        "30000000-0000-4000-8000-000000000023",
        "2026-09-13T12:00:00.000Z",
      ),
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
    };
    setupSupabase({ parents: [parent] });
    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].documents).toEqual(parent.documents);
    expect(body.messages[0]).not.toHaveProperty("storage_path");
  });

  it("omits generated history safely when signing fails", async () => {
    const parent = parentMessage(
      "30000000-0000-4000-8000-000000000012",
      "2026-09-13T12:00:00.000Z",
    );
    const storagePath = `generated/${USER_ID}/${CONVERSATION_ID}/missing.webp`;
    const setup = setupSupabase({
      parents: [parent],
      generatedRows: [
        {
          id: "40000000-0000-4000-8000-000000000013",
          message_id: parent.id,
          conversation_id: CONVERSATION_ID,
          user_id: USER_ID,
          storage_path: storagePath,
          mime_type: "image/webp",
          provider: "replicate",
          model: "flux-schnell",
        },
      ],
      signingFailures: [storagePath],
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).not.toHaveProperty("generatedImage");
    expect(JSON.stringify(body)).not.toContain(storagePath);
    expect(setup.createSignedUrl).toHaveBeenCalledWith(storagePath, 3600);
  });
});
