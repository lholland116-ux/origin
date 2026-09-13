import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

type MockQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
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

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as MockSupabase,
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

import { GET } from "../../app/api/messages/route";

function queryResult(data: unknown, error: { message: string } | null = null) {
  const query = {} as MockQuery;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(async () => ({ data, error }));
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
  signingFailures?: string[];
}) {
  const messageQuery = queryResult(params.parents);
  const childQuery = queryResult(params.childRows ?? [], params.childQueryError ?? null);
  const fromCalls: string[] = [];
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
      return table === "messages" ? messageQuery : childQuery;
    }),
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
  };

  return {
    childQuery,
    createSignedUrl,
    fromCalls,
    messageQuery,
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
      expect(body.messages[0].images.every((image: { image_url: string }) => image.image_url.startsWith("https://signed.example/"))).toBe(true);
      expect(body.messages[0].has_child_images).toBe(true);
      expect(body.messages[1].images).toEqual([]);
      expect(setup.fromCalls).toEqual(["messages", "message_images"]);
      expect(setup.childQuery.in).toHaveBeenCalledWith("message_id", [firstMessage.id, secondMessage.id]);
      expect(setup.createSignedUrl).toHaveBeenCalledTimes(count);
      expect(setup.createSignedUrl).toHaveBeenCalledWith(
        `${USER_ID}/image-1.jpg`,
        3600
      );
    }
  );

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
});
