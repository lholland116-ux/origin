import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createSupabaseClient }));

import { createFileContextService } from "@/lib/ai/file-context-service";

const input = {
  userId: "a1000000-0000-4000-8000-000000000001",
  conversationId: "b1000000-0000-4000-8000-000000000001",
  documentIds: ["c1000000-0000-4000-8000-000000000001"],
};

function queryBuilder(status: number) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { status } }).then(resolve, reject),
  };
  return builder;
}

beforeEach(() => vi.clearAllMocks());

describe("File Context temporary lookup normalization", () => {
  it.each([0, 503])("normalizes status %s as a temporary read-only lookup failure", async (status) => {
    const builder = queryBuilder(status);
    mocks.createSupabaseClient.mockResolvedValue({ from: vi.fn(() => builder) });
    await expect(createFileContextService()(input)).rejects.toMatchObject({ code: "temporary_lookup_failure" });
  });

  it("does not classify other database statuses as retry-safe", async () => {
    const builder = queryBuilder(400);
    mocks.createSupabaseClient.mockResolvedValue({ from: vi.fn(() => builder) });
    await expect(createFileContextService()(input)).rejects.toMatchObject({ code: "lookup_failed" });
  });
});
