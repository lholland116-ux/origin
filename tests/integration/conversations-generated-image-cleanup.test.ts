import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `generated/${USER_ID}/${CONVERSATION_ID}/image.webp`;

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

import { DELETE } from "../../app/api/conversations/route";

describe("DELETE /api/conversations generated-image cleanup", () => {
  beforeEach(() => {
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
        table === "message_generated_images" ? generatedQuery : deleteQuery
      ),
    };
    const remove = vi.fn(async () => ({ data: [], error: null }));
    mocks.admin = {
      storage: { from: vi.fn(() => ({ remove })) },
    };
  });

  it("removes generated objects before deleting the owned conversation", async () => {
    const response = await DELETE(
      new NextRequest(`http://localhost/api/conversations?id=${CONVERSATION_ID}`)
    );

    expect(response.status).toBe(200);
    const storage = mocks.admin.storage.from.mock.results[0]?.value as {
      remove: ReturnType<typeof vi.fn>;
    };
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(1, "message_generated_images");
    expect(mocks.supabase.from).toHaveBeenNthCalledWith(2, "conversations");
  });
});
