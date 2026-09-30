import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { GET } from "../../app/auth/callback/route";

function callbackRequest(query = "") {
  return new Request(`http://0.0.0.0:3000/auth/callback${query}`);
}

function location(response: Response) {
  return response.headers.get("location");
}

describe("GET /auth/callback canonical redirect origin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_APP_URL = "https://lvtchat.com";
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
      },
    });
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("uses the configured public origin for a no-code callback", async () => {
    const response = await GET(callbackRequest("?next=%2Fchat"));

    expect(response.status).toBe(307);
    expect(location(response)).toBe("https://lvtchat.com/chat");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("uses the configured public origin after a successful code exchange", async () => {
    const response = await GET(
      callbackRequest("?code=authorization-code&next=%2Fchat")
    );

    expect(response.status).toBe(307);
    expect(location(response)).toBe("https://lvtchat.com/chat");
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith(
      "authorization-code"
    );
  });

  it("preserves the authentication-error redirect on the configured origin", async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: { message: "code exchange failed" },
    });

    const response = await GET(
      callbackRequest("?code=authorization-code&next=%2Fchat")
    );

    expect(response.status).toBe(307);
    expect(location(response)).toBe(
      "https://lvtchat.com/login?auth_error=callback"
    );
  });

  it.each(["https%3A%2F%2Fevil.example%2Fsteal", "%2F%2Fevil.example%2Fsteal"])(
    "rejects external next path %s without changing the public origin",
    async (next) => {
      const response = await GET(callbackRequest(`?next=${next}`));

      expect(response.status).toBe(307);
      expect(location(response)).toBe("https://lvtchat.com/chat");
    }
  );

  it.each([
    ["missing", undefined],
    ["invalid", "not-a-url"],
    ["internal", "https://0.0.0.0:3000"],
  ])("fails closed for a %s production application URL", async (_label, value) => {
    if (value === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = value;
    }

    const response = await GET(callbackRequest("?next=%2Fchat"));

    expect(response.status).toBe(500);
    expect(location(response)).toBeNull();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("allows an explicitly configured development origin without hardcoding production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const response = await GET(callbackRequest("?next=%2Fchat"));

    expect(response.status).toBe(307);
    expect(location(response)).toBe("http://localhost:3000/chat");
  });
});
