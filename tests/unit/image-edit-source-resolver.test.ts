import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@napi-rs/canvas", () => ({
  loadImage: vi.fn(async () => ({ width: 2, height: 1 })),
}));

import {
  ImageEditSourceResolverError,
  resolveImageEditSource,
} from "@/lib/image-generation/image-edit-source-resolver";
import { MAX_IMAGE_EDIT_SOURCE_BYTES } from "@/lib/image-generation/image-edit-source";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const GENERATED_IMAGE_ID = "30000000-0000-4000-8000-000000000001";
const GENERATED_MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const UPLOADED_MESSAGE_ID = "50000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `${USER_ID}/source.png`;
const GENERATED_STORAGE_PATH =
  `generated/${USER_ID}/${CONVERSATION_ID}/${GENERATED_IMAGE_ID}.png`;

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAARSURBVAiZYzROm/mfgYGBAQANBQIz+/EjQQAAAABJRU5ErkJggg==";
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJEAWxe//9k=";
const WEBP_BASE64 =
  "UklGRh4CAABXRUJQVlA4WAoAAAAgAAAAAQAAAAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiV2FZAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggMAAAABACAJ0BKgIAAQAAgA4loAJ0ugH4AfgAA8gA/vgjb/9tDFPiD9k3/69EHiDfqaAAAA==";

function bytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function blobBytes(base64: string): ArrayBuffer {
  const source = Buffer.from(base64, "base64");
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  return buffer;
}

function blobFromBytes(bytesValue: Uint8Array, type = "application/octet-stream"): Blob {
  const buffer = new ArrayBuffer(bytesValue.byteLength);
  new Uint8Array(buffer).set(bytesValue);
  return new Blob([buffer], { type });
}

type QueryResult = {
  data: unknown;
  error: { message: string; status?: number | string; statusCode?: number | string } | null;
};

type EqualityPredicate = {
  column: string;
  value: unknown;
};

type MockQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  predicates: EqualityPredicate[];
};

function query(result: QueryResult, events: string[], label: string): MockQuery {
  const builder = { predicates: [] } as unknown as MockQuery;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    builder.predicates.push({ column, value });
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => {
    events.push(`query:${label}`);
    return result;
  });
  return builder;
}

function defaultConversation(): QueryResult {
  return { data: { id: CONVERSATION_ID }, error: null };
}

function generatedMetadata(
  mimeType = "image/png",
  storagePath = GENERATED_STORAGE_PATH,
) {
  return {
    id: GENERATED_IMAGE_ID,
    message_id: GENERATED_MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    user_id: USER_ID,
    storage_path: storagePath,
    mime_type: mimeType,
  };
}

function linkedAssistantMessage() {
  return {
    id: GENERATED_MESSAGE_ID,
    user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    role: "assistant",
  };
}

function uploadedParentMessage() {
  return {
    id: UPLOADED_MESSAGE_ID,
    user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    role: "user",
  };
}

function uploadedMetadata(storagePath = STORAGE_PATH) {
  return {
    message_id: UPLOADED_MESSAGE_ID,
    ordinal: 1,
    storage_path: storagePath,
  };
}

function createSetup(params: {
  authenticated?: boolean;
  conversation?: QueryResult;
  generated?: QueryResult;
  linkedMessage?: QueryResult;
  uploadedParent?: QueryResult;
  uploadedChild?: QueryResult;
  storage?: QueryResult;
  events?: string[];
} = {}) {
  const events = params.events ?? [];
  const queryQueues = new Map<string, MockQuery[]>();
  const queries = new Map<string, MockQuery>();

  const addQuery = (table: string, result: QueryResult, label: string) => {
    const tableQueries = queryQueues.get(table) ?? [];
    const queryBuilder = query(result, events, label);
    tableQueries.push(queryBuilder);
    queryQueues.set(table, tableQueries);
    queries.set(label, queryBuilder);
  };

  addQuery("conversations", params.conversation ?? defaultConversation(), "conversation");
  if (params.generated !== undefined) {
    addQuery("message_generated_images", params.generated, "generated");
    addQuery("messages", params.linkedMessage ?? { data: linkedAssistantMessage(), error: null }, "linked-message");
  }
  if (params.uploadedParent !== undefined || params.uploadedChild !== undefined) {
    addQuery("messages", params.uploadedParent ?? { data: uploadedParentMessage(), error: null }, "uploaded-parent");
    addQuery("message_images", params.uploadedChild ?? { data: uploadedMetadata(), error: null }, "uploaded-child");
  }

  const from = vi.fn((table: string) => {
    events.push(`from:${table}`);
    const tableQueries = queryQueues.get(table) ?? [];
    const next = tableQueries.shift();
    if (!next) throw new Error(`Unexpected query for ${table}`);
    return next;
  });

  const supabase = {
    auth: {
      getUser: vi.fn(async () =>
        params.authenticated === false
          ? { data: { user: null }, error: { message: "no session" } }
          : { data: { user: { id: USER_ID } }, error: null },
      ),
    },
    from,
  };

  const storageResult = params.storage ?? {
    data: new Blob([blobBytes(PNG_BASE64)], { type: "image/png" }),
    error: null,
  };
  const download = vi.fn(async (storagePath: string) => {
    events.push(`download:${storagePath}`);
    return storageResult;
  });
  const createSignedUrl = vi.fn();
  const storageFrom = vi.fn(() => ({ download, createSignedUrl }));
  const admin = { storage: { from: storageFrom } };
  const createAdminClient = vi.fn(() => {
    events.push("createAdminClient");
    return admin;
  });
  const createServerClient = vi.fn(async () => supabase);

  return {
    admin,
    createAdminClient,
    createSignedUrl,
    createServerClient,
    download,
    events,
    from,
    queries,
    supabase,
  };
}

function expectPredicates(
  setup: ReturnType<typeof createSetup>,
  label: string,
  predicates: EqualityPredicate[],
) {
  expect(setup.queries.get(label)?.predicates).toEqual(predicates);
}

function input(sourceReference: unknown, extra: Record<string, unknown> = {}) {
  return {
    conversationId: CONVERSATION_ID,
    sourceReference,
    ...extra,
  } as never;
}

function generatedInput(extra: Record<string, unknown> = {}) {
  return input(
    { kind: "generated_image", generatedImageId: GENERATED_IMAGE_ID },
    extra,
  );
}

function uploadedInput(ordinal = 1, extra: Record<string, unknown> = {}) {
  return input(
    { kind: "uploaded_image", messageId: UPLOADED_MESSAGE_ID, ordinal },
    extra,
  );
}

function dependencies(setup: ReturnType<typeof createSetup>) {
  return {
    createServerClient: setup.createServerClient,
    createAdminClient: setup.createAdminClient,
  };
}

async function expectResolverError(
  promise: Promise<unknown>,
  code: ImageEditSourceResolverError["code"],
) {
  await expect(promise).rejects.toMatchObject({
    name: "ImageEditSourceResolverError",
    code,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveImageEditSource authentication and conversation authorization", () => {
  it("returns unauthenticated without creating an admin client or querying Storage", async () => {
    const setup = createSetup({ authenticated: false });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "unauthenticated",
    );

    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.from).not.toHaveBeenCalled();
  });

  it("rejects invalid source references before database or Storage access", async () => {
    const setup = createSetup();

    await expectResolverError(
      resolveImageEditSource(
        input({ kind: "uploaded_image", messageId: UPLOADED_MESSAGE_ID, ordinal: 0 }),
        dependencies(setup),
      ),
      "invalid_source_reference",
    );

    expect(setup.from).not.toHaveBeenCalled();
    expect(setup.createAdminClient).not.toHaveBeenCalled();
  });

  it("maps a nonexistent target conversation to conversation_not_found", async () => {
    const setup = createSetup({ conversation: { data: null, error: null } });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "conversation_not_found",
    );

    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.events).not.toContain(`download:${STORAGE_PATH}`);
  });

  it("maps a foreign target conversation to conversation_not_found without authorizing it", async () => {
    const setup = createSetup({ conversation: { data: null, error: null } });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "conversation_not_found",
    );

    expectPredicates(setup, "conversation", [
      { column: "id", value: CONVERSATION_ID },
      { column: "user_id", value: USER_ID },
    ]);
    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.download).not.toHaveBeenCalled();
  });

  it("maps a target conversation query failure to database_query_failed", async () => {
    const setup = createSetup({
      conversation: {
        data: null,
        error: { message: "database secret must not leak" },
      },
    });

    const error = await resolveImageEditSource(
      generatedInput(),
      dependencies(setup),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ImageEditSourceResolverError",
      code: "database_query_failed",
    });
    expect((error as Error).message).not.toContain("database secret");
    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.download).not.toHaveBeenCalled();
  });

  it("authorizes an owned target conversation before resolving the source", async () => {
    const setup = createSetup({
      generated: { data: generatedMetadata(), error: null },
    });

    await resolveImageEditSource(generatedInput(), dependencies(setup));

    expectPredicates(setup, "conversation", [
      { column: "id", value: CONVERSATION_ID },
      { column: "user_id", value: USER_ID },
    ]);
    expect(setup.events.indexOf("query:conversation")).toBeLessThan(
      setup.events.indexOf("query:generated"),
    );
  });
});

describe("resolveImageEditSource generated sources", () => {
  it.each([
    ["PNG", PNG_BASE64, "image/png"],
    ["JPEG", JPEG_BASE64, "image/jpeg"],
    ["WebP", WEBP_BASE64, "image/webp"],
  ])("resolves an owned generated %s from authoritative metadata and bytes", async (_label, base64, mimeType) => {
    const setup = createSetup({
      generated: { data: generatedMetadata(mimeType), error: null },
      storage: {
        data: new Blob([blobBytes(base64)], { type: mimeType }),
        error: null,
      },
    });

    const result = await resolveImageEditSource(generatedInput(), dependencies(setup));

    expect(result).toMatchObject({
      sourceReference: { kind: "generated_image", generatedImageId: GENERATED_IMAGE_ID },
      conversationId: CONVERSATION_ID,
      mimeType,
      width: 2,
      height: 1,
      byteLength: bytes(base64).byteLength,
    });
    expect(result.bytes).toEqual(bytes(base64));
    expect(setup.download).toHaveBeenCalledWith(GENERATED_STORAGE_PATH);
    expectPredicates(setup, "generated", [
      { column: "id", value: GENERATED_IMAGE_ID },
      { column: "user_id", value: USER_ID },
      { column: "conversation_id", value: CONVERSATION_ID },
    ]);
    expectPredicates(setup, "linked-message", [
      { column: "id", value: GENERATED_MESSAGE_ID },
      { column: "user_id", value: USER_ID },
      { column: "conversation_id", value: CONVERSATION_ID },
      { column: "role", value: "assistant" },
    ]);
    expect(setup.events.indexOf("createAdminClient")).toBeGreaterThan(
      setup.events.indexOf("query:linked-message"),
    );
  });

  it.each([
    ["nonexistent", null],
    ["foreign", null],
    ["same-user cross-conversation", null],
  ])("maps a %s generated image to source_not_found", async (_label, data) => {
    const setup = createSetup({ generated: { data, error: null } });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "source_not_found",
    );

    expectPredicates(setup, "generated", [
      { column: "id", value: GENERATED_IMAGE_ID },
      { column: "user_id", value: USER_ID },
      { column: "conversation_id", value: CONVERSATION_ID },
    ]);
    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.download).not.toHaveBeenCalled();
  });

  it.each([
    ["missing linked message", null],
    ["linked message owned by another user", { ...linkedAssistantMessage(), user_id: "foreign-user" }],
    ["linked message in another conversation", { ...linkedAssistantMessage(), conversation_id: "60000000-0000-4000-8000-000000000001" }],
    ["linked message with a non-assistant role", { ...linkedAssistantMessage(), role: "user" }],
  ])("fails closed for %s as malformed_source_metadata", async (_label, linkedMessage) => {
    const setup = createSetup({
      generated: { data: generatedMetadata(), error: null },
      linkedMessage: { data: linkedMessage, error: null },
    });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "malformed_source_metadata",
    );

    expect(setup.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed path", generatedMetadata("image/png", `generated/${USER_ID}/other/${GENERATED_IMAGE_ID}.png`), null],
    ["malformed MIME", generatedMetadata("image/gif"), null],
  ])("rejects generated metadata before Storage for %s", async (_label, data) => {
    const setup = createSetup({
      generated: { data, error: null },
    });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "malformed_source_metadata",
    );

    expect(setup.createAdminClient).not.toHaveBeenCalled();
  });

  it("maps a generated metadata query failure to database_query_failed", async () => {
    const setup = createSetup({
      generated: {
        data: null,
        error: { message: "generated query secret must not leak" },
      },
    });

    const error = await resolveImageEditSource(
      generatedInput(),
      dependencies(setup),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ImageEditSourceResolverError",
      code: "database_query_failed",
    });
    expect((error as Error).message).not.toContain("generated query secret");
    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.download).not.toHaveBeenCalled();
  });

  it("maps stored MIME and actual-byte mismatches to invalid_source_image", async () => {
    const setup = createSetup({
      generated: { data: generatedMetadata("image/jpeg"), error: null },
      storage: {
        data: new Blob([blobBytes(PNG_BASE64)], { type: "image/png" }),
        error: null,
      },
    });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "invalid_source_image",
    );
  });

  it.each([
    ["missing object", { data: null, error: null }, "storage_object_missing"],
    ["404 object", { data: null, error: { message: "not found", statusCode: "404" } }, "storage_object_missing"],
    ["Storage failure", { data: null, error: { message: "temporary failure", status: 503 } }, "storage_download_failed"],
  ])("maps %s without exposing Storage details", async (_label, storage, code) => {
    const setup = createSetup({
      generated: { data: generatedMetadata(), error: null },
      storage,
    });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      code as ImageEditSourceResolverError["code"],
    );

    expect(setup.createAdminClient).toHaveBeenCalledOnce();
  });

  it("rejects an oversized Storage Blob before arrayBuffer materialization", async () => {
    const arrayBuffer = vi.fn(async () => bytes(PNG_BASE64).buffer);
    const setup = createSetup({
      generated: { data: generatedMetadata(), error: null },
      storage: {
        data: { size: MAX_IMAGE_EDIT_SOURCE_BYTES + 1, arrayBuffer } as unknown as Blob,
        error: null,
      },
    });

    await expectResolverError(
      resolveImageEditSource(generatedInput(), dependencies(setup)),
      "invalid_source_image",
    );

    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("resolves an edit-of-edit through the ordinary generated-image row without lineage traversal", async () => {
    const setup = createSetup({
      generated: { data: generatedMetadata(), error: null },
    });

    await resolveImageEditSource(generatedInput(), dependencies(setup));

    expect(setup.from).not.toHaveBeenCalledWith("image_edit_lineage");
  });
});

describe("resolveImageEditSource uploaded sources", () => {
  it.each([
    ["PNG", PNG_BASE64, "image/png"],
    ["JPEG", JPEG_BASE64, "image/jpeg"],
    ["WebP", WEBP_BASE64, "image/webp"],
  ])("resolves an authorized uploaded %s from bytes without stored MIME", async (_label, base64, mimeType) => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: { data: uploadedMetadata(), error: null },
      storage: {
        data: new Blob([blobBytes(base64)], { type: mimeType }),
        error: null,
      },
    });

    const result = await resolveImageEditSource(uploadedInput(), dependencies(setup));

    expect(result).toMatchObject({
      sourceReference: {
        kind: "uploaded_image",
        messageId: UPLOADED_MESSAGE_ID,
        ordinal: 1,
      },
      conversationId: CONVERSATION_ID,
      mimeType,
      width: 2,
      height: 1,
    });
    expect(setup.download).toHaveBeenCalledWith(STORAGE_PATH);
    expectPredicates(setup, "uploaded-parent", [
      { column: "id", value: UPLOADED_MESSAGE_ID },
      { column: "user_id", value: USER_ID },
      { column: "conversation_id", value: CONVERSATION_ID },
      { column: "role", value: "user" },
    ]);
    expectPredicates(setup, "uploaded-child", [
      { column: "message_id", value: UPLOADED_MESSAGE_ID },
      { column: "ordinal", value: 1 },
    ]);
  });

  it("maps an authorized uploaded source with a missing Storage object to storage_object_missing", async () => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: { data: uploadedMetadata(), error: null },
      storage: {
        data: null,
        error: { message: "object missing", statusCode: 404 },
      },
    });

    await expectResolverError(
      resolveImageEditSource(uploadedInput(), dependencies(setup)),
      "storage_object_missing",
    );

    expect(setup.download).toHaveBeenCalledWith(STORAGE_PATH);
    expect(setup.createSignedUrl).not.toHaveBeenCalled();
  });

  it("maps an authorized uploaded malformed image to invalid_source_image", async () => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: { data: uploadedMetadata(), error: null },
      storage: {
        data: blobFromBytes(new Uint8Array([1, 2, 3])),
        error: null,
      },
    });

    await expectResolverError(
      resolveImageEditSource(uploadedInput(), dependencies(setup)),
      "invalid_source_image",
    );

    expect(setup.download).toHaveBeenCalledWith(STORAGE_PATH);
  });

  it("maps an authorized uploaded unsupported file signature to invalid_source_image", async () => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: { data: uploadedMetadata(), error: null },
      storage: {
        data: blobFromBytes(new TextEncoder().encode("GIF89a"), "image/gif"),
        error: null,
      },
    });

    await expectResolverError(
      resolveImageEditSource(uploadedInput(), dependencies(setup)),
      "invalid_source_image",
    );

    expect(setup.download).toHaveBeenCalledWith(STORAGE_PATH);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid uploaded ordinal %s before database or Storage access",
    async (ordinal) => {
      const setup = createSetup();

      await expectResolverError(
        resolveImageEditSource(uploadedInput(ordinal), dependencies(setup)),
        "invalid_source_reference",
      );

      expect(setup.from).not.toHaveBeenCalled();
      expect(setup.createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("maps an uploaded parent-message query failure to database_query_failed", async () => {
    const setup = createSetup({
      uploadedParent: {
        data: null,
        error: { message: "parent query secret must not leak" },
      },
    });

    const error = await resolveImageEditSource(
      uploadedInput(),
      dependencies(setup),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ImageEditSourceResolverError",
      code: "database_query_failed",
    });
    expect((error as Error).message).not.toContain("parent query secret");
    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.download).not.toHaveBeenCalled();
  });

  it("maps an uploaded child-image query failure to database_query_failed", async () => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: {
        data: null,
        error: { message: "child query secret must not leak" },
      },
    });

    const error = await resolveImageEditSource(
      uploadedInput(),
      dependencies(setup),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ImageEditSourceResolverError",
      code: "database_query_failed",
    });
    expect((error as Error).message).not.toContain("child query secret");
    expect(setup.createAdminClient).not.toHaveBeenCalled();
    expect(setup.download).not.toHaveBeenCalled();
  });

  it.each([
    ["missing parent", null],
    ["foreign parent", { ...uploadedParentMessage(), user_id: "foreign-user" }],
    ["wrong conversation", { ...uploadedParentMessage(), conversation_id: "60000000-0000-4000-8000-000000000001" }],
    ["assistant parent", { ...uploadedParentMessage(), role: "assistant" }],
  ])("maps %s uploaded parent to source_not_found", async (_label, parent) => {
    const setup = createSetup({
      uploadedParent: { data: parent, error: null },
    });

    await expectResolverError(
      resolveImageEditSource(uploadedInput(), dependencies(setup)),
      "source_not_found",
    );

    expect(setup.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["missing child", null],
    ["malformed child path", uploadedMetadata("other-user/source.png")],
  ])("rejects %s before Storage", async (_label, child) => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: { data: child, error: null },
    });

    await expectResolverError(
      resolveImageEditSource(uploadedInput(), dependencies(setup)),
      child ? "malformed_source_metadata" : "source_not_found",
    );

    expect(setup.createAdminClient).not.toHaveBeenCalled();
  });

  it("ignores client-supplied path and MIME fields", async () => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: { data: uploadedMetadata(), error: null },
    });

    const result = await resolveImageEditSource(
      uploadedInput(1, {
        storagePath: "other-user/secret.png",
        mimeType: "image/gif",
      }),
      dependencies(setup),
    );

    expect(result.mimeType).toBe("image/png");
    expect(setup.download).toHaveBeenCalledWith(STORAGE_PATH);
  });

  it("returns only the trusted result fields and never creates a signed URL", async () => {
    const setup = createSetup({
      uploadedParent: { data: uploadedParentMessage(), error: null },
      uploadedChild: { data: uploadedMetadata(), error: null },
    });

    const result = await resolveImageEditSource(uploadedInput(), dependencies(setup));

    expect(Object.keys(result).sort()).toEqual([
      "byteLength",
      "bytes",
      "conversationId",
      "height",
      "mimeType",
      "sourceReference",
      "width",
    ]);
    expect(result).not.toHaveProperty("storagePath");
    expect(result).not.toHaveProperty("url");
    expect(result).not.toHaveProperty("userId");
    expect(setup.admin.storage.from).toHaveBeenCalledWith("chat-images");
  });
});
