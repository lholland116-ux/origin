import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const GENERATED_IMAGE_ID = "30000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `generated/${USER_ID}/${CONVERSATION_ID}/image.webp`;

const mocks = vi.hoisted(() => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
  admin: {
    storage: { from: vi.fn() },
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

function query<T>(result: T) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function routeRequest(generatedImageId = GENERATED_IMAGE_ID): Request {
  return new Request(
    `http://localhost/api/generated-images/${generatedImageId}/download`,
  );
}

function routeContext(generatedImageId = GENERATED_IMAGE_ID) {
  return { params: Promise.resolve({ generatedImageId }) };
}

function ownedRow(mimeType = "image/webp", storagePath = STORAGE_PATH) {
  return {
    conversation_id: CONVERSATION_ID,
    mime_type: mimeType,
    storage_path: storagePath,
  };
}

function configureMetadata(
  result: { data: unknown; error: unknown } = {
    data: ownedRow(),
    error: null,
  },
) {
  const metadataQuery = query(result);
  mocks.supabase.from.mockReturnValue(metadataQuery);
  return metadataQuery;
}

describe("GET /api/generated-images/[generatedImageId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    configureMetadata();
    mocks.admin.storage.from.mockReturnValue({
      download: vi.fn(async () => ({
        data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
        error: null,
      })),
    });
  });

  it("requires authentication before looking up metadata or storage", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(routeRequest(), routeContext());

    expect(response.status).toBe(401);
    expect(mocks.supabase.from).not.toHaveBeenCalled();
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("rejects malformed generated-image IDs before querying metadata", async () => {
    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(
      routeRequest("not-a-uuid"),
      routeContext("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(mocks.supabase.from).not.toHaveBeenCalled();
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("returns the same safe not-found result for unknown or non-owned metadata", async () => {
    configureMetadata({ data: null, error: null });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(routeRequest(), routeContext());
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain(STORAGE_PATH);
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it.each([
    ["image/webp", "webp"],
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
  ])("returns exact %s bytes with a safe %s filename", async (mimeType, extension) => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    configureMetadata({ data: ownedRow(mimeType), error: null });
    const download = vi.fn(async () => ({
      data: new Blob([bytes], { type: mimeType }),
      error: null,
    }));
    mocks.admin.storage.from.mockReturnValue({ download });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(routeRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mimeType);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="lvtchat-image-${GENERATED_IMAGE_ID}.${extension}"`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
      Array.from(bytes),
    );
    expect(download).toHaveBeenCalledWith(STORAGE_PATH);
  });

  it("resolves ownership and validates the storage path before using the service-role client", async () => {
    const metadataQuery = configureMetadata();
    const download = vi.fn(async () => ({
      data: new Blob([new Uint8Array([1])], { type: "image/webp" }),
      error: null,
    }));
    mocks.admin.storage.from.mockReturnValue({ download });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    await GET(routeRequest(), routeContext());

    expect(metadataQuery.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mocks.admin.storage.from.mock.invocationCallOrder[0]).toBeGreaterThan(
      metadataQuery.maybeSingle.mock.invocationCallOrder[0] ?? 0,
    );
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("does not access storage for unsupported MIME metadata", async () => {
    configureMetadata({ data: ownedRow("image/svg+xml"), error: null });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(routeRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("does not access storage for an unsafe metadata path", async () => {
    configureMetadata({
      data: ownedRow("image/webp", `generated/${USER_ID}/${CONVERSATION_ID}/../other.webp`),
      error: null,
    });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(routeRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("does not proxy an arbitrary external image URL", async () => {
    configureMetadata({
      data: ownedRow("image/webp", "https://example.com/not-an-authorized-object.webp"),
      error: null,
    });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(routeRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(mocks.admin.storage.from).not.toHaveBeenCalled();
  });

  it("maps metadata and storage failures to safe responses without leaking internals", async () => {
    configureMetadata({
      data: null,
      error: {
        message: `secret ${STORAGE_PATH}`,
      },
    });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const metadataResponse = await GET(routeRequest(), routeContext());
    const metadataBody = await metadataResponse.text();

    expect(metadataResponse.status).toBe(500);
    expect(metadataBody).not.toContain(STORAGE_PATH);

    configureMetadata();
    mocks.admin.storage.from.mockReturnValue({
      download: vi.fn(async () => ({
        data: null,
        error: { message: `service secret ${STORAGE_PATH}` },
      })),
    });

    const storageResponse = await GET(routeRequest(), routeContext());
    const storageBody = await storageResponse.text();

    expect(storageResponse.status).toBe(502);
    expect(storageBody).not.toContain(STORAGE_PATH);
    expect(storageBody).not.toContain("service secret");
  });

  it("does not return an empty successful download", async () => {
    mocks.admin.storage.from.mockReturnValue({
      download: vi.fn(async () => ({
        data: new Blob([], { type: "image/webp" }),
        error: null,
      })),
    });

    const { GET } = await import("../../app/api/generated-images/[generatedImageId]/download/route");
    const response = await GET(routeRequest(), routeContext());

    expect(response.status).toBe(502);
  });
});
