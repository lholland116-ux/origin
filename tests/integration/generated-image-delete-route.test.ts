import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const GENERATED_IMAGE_ID = "40000000-0000-4000-8000-000000000001";
const DERIVATIVE_IMAGE_ID = "40000000-0000-4000-8000-000000000002";
const LINEAGE_ID = "50000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `generated/${USER_ID}/${CONVERSATION_ID}/image.webp`;

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type MockQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: Promise<QueryResult>["then"];
};

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as {
    auth: { getUser: ReturnType<typeof vi.fn> };
    from: ReturnType<typeof vi.fn>;
  },
  admin: null as unknown as {
    storage: { from: ReturnType<typeof vi.fn> };
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

import { DELETE } from "../../app/api/generated-images/[generatedImageId]/route";

function query(result: QueryResult): MockQuery {
  const builder = {} as MockQuery;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function imageMetadata(id = GENERATED_IMAGE_ID) {
  return {
    id,
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    user_id: USER_ID,
    storage_path: STORAGE_PATH,
    mime_type: "image/webp",
  };
}

function imageOnlyMessage() {
  return {
    id: MESSAGE_ID,
    role: "assistant",
    content: "",
    documents: [],
    image_path: null,
    image_name: null,
    sources: null,
    source_count: null,
    widget: null,
  };
}

function configure(options: {
  metadata?: QueryResult;
  message?: QueryResult;
  lineage?: QueryResult;
  deletedMessage?: QueryResult;
  download?: QueryResult;
  remove?: QueryResult;
  upload?: QueryResult;
  user?: { id: string } | null;
} = {}) {
  const queries = new Map<string, MockQuery[]>([
    [
      "message_generated_images",
      [
        query(
          options.metadata ?? {
            data: imageMetadata(),
            error: null,
          },
        ),
      ],
    ],
    [
      "messages",
      [
        query(
          options.message ?? {
            data: imageOnlyMessage(),
            error: null,
          },
        ),
        query(
          options.deletedMessage ?? {
            data: [{ id: MESSAGE_ID }],
            error: null,
          },
        ),
      ],
    ],
    [
      "image_edit_lineage",
      [
        query(
          options.lineage ?? {
            data: [],
            error: null,
          },
        ),
      ],
    ],
  ]);

  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.user === undefined ? { id: USER_ID } : options.user },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      const tableQueries = queries.get(table);
      const tableQuery = tableQueries?.shift();
      if (!tableQuery) throw new Error(`Unexpected query for ${table}`);
      return tableQuery;
    }),
  };

  const storage = {
    download: vi.fn(async () =>
      options.download ?? {
        data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
        error: null,
      },
    ),
    remove: vi.fn(async () => options.remove ?? { data: [], error: null }),
    upload: vi.fn(async () => options.upload ?? { data: null, error: null }),
  };

  mocks.admin = {
    storage: { from: vi.fn(() => storage) },
  };

  return { storage };
}

function request(id = GENERATED_IMAGE_ID, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/generated-images/${id}`, {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });
}

function context(id = GENERATED_IMAGE_ID) {
  return { params: Promise.resolve({ generatedImageId: id }) };
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("DELETE /api/generated-images/[generatedImageId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication before reading metadata or storage", async () => {
    configure({ user: null });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(401);
    expect(mocks.supabase.from).not.toHaveBeenCalled();
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs before querying metadata", async () => {
    configure();

    const response = await DELETE(request("not-a-uuid"), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.supabase.from).not.toHaveBeenCalled();
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("returns a safe not-found response for unknown or non-owned metadata", async () => {
    configure({ metadata: { data: null, error: null } });

    const response = await DELETE(request(), context());
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain(STORAGE_PATH);
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("rejects metadata that does not belong to the authenticated user", async () => {
    const { storage } = configure({
      metadata: {
        data: { ...imageMetadata(), user_id: OTHER_USER_ID },
        error: null,
      },
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(404);
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(mocks.supabase.from).toHaveBeenCalledTimes(1);
  });

  it("ignores a client-supplied storage path and uses server-resolved metadata", async () => {
    const { storage } = configure();

    const response = await DELETE(
      request(GENERATED_IMAGE_ID, { storagePath: "generated/other-user/secret.webp" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(storage.download).toHaveBeenCalledWith(STORAGE_PATH);
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH]);
  });

  it("fails closed for unsafe metadata without accessing storage", async () => {
    const { storage } = configure({
      metadata: {
        data: { ...imageMetadata(), storage_path: `generated/${USER_ID}/${CONVERSATION_ID}/../other.webp` },
        error: null,
      },
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(404);
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("does not delete a generated metadata row whose message is not image-only", async () => {
    const { storage } = configure({
      message: {
        data: { ...imageOnlyMessage(), content: "This is visible assistant text." },
        error: null,
      },
    });

    const response = await DELETE(request(), context());
    const body = await responseBody(response);

    expect(response.status).toBe(409);
    expect(body.code).toBe("IMAGE_MESSAGE_NOT_DELETABLE");
    expect(storage.download).not.toHaveBeenCalled();
    expect(mocks.supabase.from).toHaveBeenCalledTimes(2);
  });

  it("blocks a source image when edited-image descendants exist", async () => {
    const { storage } = configure({
      lineage: { data: [{ id: LINEAGE_ID }], error: null },
    });

    const response = await DELETE(request(), context());
    const body = await responseBody(response);

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "This image can't be deleted because edited images depend on it.",
      code: "IMAGE_HAS_DERIVATIVES",
    });
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(mocks.supabase.from.mock.calls.map(([table]) => table)).toEqual([
      "message_generated_images",
      "messages",
      "image_edit_lineage",
    ]);
  });

  it("deletes a derivative with no children while leaving its source outside the request", async () => {
    const { storage } = configure({
      metadata: { data: imageMetadata(DERIVATIVE_IMAGE_ID), error: null },
    });

    const response = await DELETE(request(DERIVATIVE_IMAGE_ID), context(DERIVATIVE_IMAGE_ID));

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toEqual({
      ok: true,
      generatedImageId: DERIVATIVE_IMAGE_ID,
    });
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("removes storage before the owned assistant message and cascaded metadata", async () => {
    const { storage } = configure();

    const response = await DELETE(request(), context());

    expect(response.status).toBe(200);
    expect(storage.download).toHaveBeenCalledWith(STORAGE_PATH);
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(1, "message_generated_images");
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(2, "messages");
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(3, "image_edit_lineage");
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(4, "messages");
  });

  it("does not involve image quota or attempt state", async () => {
    configure();

    const response = await DELETE(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.supabase.from).not.toHaveBeenCalledWith("image_generation_attempts");
    expect(mocks.supabase.from).not.toHaveBeenCalledWith("image_generation_quotas");
  });

  it("fails safely when storage download fails", async () => {
    const { storage } = configure({
      download: { data: null, error: { message: `secret ${STORAGE_PATH}` } },
    });

    const response = await DELETE(request(), context());
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).not.toContain(STORAGE_PATH);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(mocks.supabase.from).toHaveBeenCalledTimes(3);
  });

  it("fails safely when storage removal fails without deleting the message", async () => {
    const { storage } = configure({
      remove: { data: null, error: { message: `secret ${STORAGE_PATH}` } },
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(502);
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(mocks.supabase.from).toHaveBeenCalledTimes(3);
  });

  it("restores the exact downloaded bytes when message deletion fails", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const { storage } = configure({
      download: { data: new Blob([bytes], { type: "image/webp" }), error: null },
      deletedMessage: { data: null, error: { message: "deferred lineage constraint" } },
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(500);
    expect(storage.upload).toHaveBeenCalledWith(
      STORAGE_PATH,
      Buffer.from(bytes),
      {
        contentType: "image/webp",
        cacheControl: "3600",
        upsert: false,
      },
    );
  });

  it("restores storage when the deferred source-lineage FK rejects a concurrent delete", async () => {
    const { storage } = configure({
      deletedMessage: {
        data: null,
        error: { message: "insert or update on table image_edit_lineage violates foreign key" },
      },
    });

    const response = await DELETE(request(), context());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("image_edit_lineage");
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledWith(
      STORAGE_PATH,
      expect.anything(),
      expect.objectContaining({ upsert: false }),
    );
  });

  it("does not report success when the guarded message delete affects no row", async () => {
    const { storage } = configure({
      deletedMessage: { data: [], error: null },
    });

    const response = await DELETE(request(), context());

    expect(response.status).toBe(500);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it("does not expose metadata, storage, or database failure details", async () => {
    configure({
      metadata: { data: null, error: { message: `database secret ${STORAGE_PATH}` } },
    });

    const response = await DELETE(request(), context());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("database secret");
    expect(body).not.toContain(STORAGE_PATH);
  });
});
