import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";

type QueryResult = {
  data: unknown;
  error: unknown;
};

const mocks = vi.hoisted(() => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

import { GET } from "../../app/api/usage/route";

function query(result: QueryResult) {
  const builder = {} as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: Promise<QueryResult>["then"];
  };
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function setup(params: {
  plan?: string | null;
  usage?: QueryResult;
  attempts?: QueryResult;
  profile?: QueryResult;
}) {
  const queries = {
    profiles: query(
      params.profile ?? {
        data: { plan: params.plan ?? "free" },
        error: null,
      },
    ),
    usage: query(
      params.usage ?? {
        data: { message_count: 4 },
        error: null,
      },
    ),
    image_generation_attempts: query(
      params.attempts ?? { data: [], error: null },
    ),
  };

  mocks.supabase.from.mockImplementation(
    (table: keyof typeof queries) => queries[table],
  );

  return queries;
}

describe("GET /api/usage image-generation quota section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
  });

  it("preserves text usage and returns separate Free image limits", async () => {
    setup({});

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      used: 4,
      limit: 20,
      remaining: 16,
      plan: "free",
      imageGeneration: {
        plan: "free",
        daily: { used: 0, reserved: 0, limit: 2, remaining: 2 },
        monthly: { used: 0, reserved: 0, limit: 10, remaining: 10 },
      },
    });
  });

  it("uses Pro limits and counts current UTC successes plus active reservations", async () => {
    const now = new Date();
    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    ).toISOString();

    const queries = setup({
      plan: "pro",
      attempts: {
        data: [
          {
            status: "succeeded",
            completed_at: new Date(Date.now() - 60_000).toISOString(),
            expires_at: null,
          },
          {
            status: "succeeded",
            completed_at: previousMonth,
            expires_at: null,
          },
          {
            status: "reserved",
            completed_at: null,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          {
            status: "reserved",
            completed_at: null,
            expires_at: new Date(Date.now() - 60_000).toISOString(),
          },
          {
            status: "released",
            completed_at: null,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
        error: null,
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.imageGeneration).toEqual({
      plan: "pro",
      daily: { used: 1, reserved: 1, limit: 20, remaining: 18 },
      monthly: { used: 1, reserved: 1, limit: 200, remaining: 198 },
    });
    expect(queries.image_generation_attempts.eq).toHaveBeenCalledWith(
      "user_id",
      USER_ID,
    );
  });

  it("fails closed for an unknown profile plan before exposing image usage", async () => {
    const queries = setup({ plan: "enterprise" });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(queries.image_generation_attempts.maybeSingle).not.toHaveBeenCalled();
  });
});
