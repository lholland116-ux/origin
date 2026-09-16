import {
  isValidGeneratedImagePath,
  normalizeGeneratedImageMimeType,
} from "@/lib/chat/generated-image-history";
import {
  validateStoredImagePath,
} from "@/lib/chat/chat-image-attachments";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  ImageEditSourceValidationError,
  inspectImageEditSource,
  MAX_IMAGE_EDIT_SOURCE_BYTES,
  type ImageEditSourceInspection,
  type ResolvedImageEditSource,
} from "./image-edit-source";
import {
  validateImageEditSourceReference,
  type ImageEditSourceReference,
} from "./lineage";

if (typeof window !== "undefined") {
  throw new Error("Image edit source resolution is server-only");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ImageEditSourceResolverErrorCode =
  | "unauthenticated"
  | "invalid_source_reference"
  | "conversation_not_found"
  | "source_not_found"
  | "malformed_source_metadata"
  | "storage_object_missing"
  | "storage_download_failed"
  | "invalid_source_image"
  | "database_query_failed";

const ERROR_MESSAGES: Record<ImageEditSourceResolverErrorCode, string> = {
  unauthenticated: "Authentication is required.",
  invalid_source_reference: "The image edit source is invalid.",
  conversation_not_found: "Conversation not found.",
  source_not_found: "Image edit source not found.",
  malformed_source_metadata: "The image edit source is unavailable.",
  storage_object_missing: "The image edit source is unavailable.",
  storage_download_failed: "The image edit source could not be retrieved.",
  invalid_source_image: "The image edit source is invalid.",
  database_query_failed: "The image edit source could not be resolved.",
};

export class ImageEditSourceResolverError extends Error {
  readonly code: ImageEditSourceResolverErrorCode;

  constructor(code: ImageEditSourceResolverErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ImageEditSourceResolverError";
    this.code = code;
  }
}

export type ImageEditSourceResolverInput = Readonly<{
  conversationId: string;
  sourceReference: unknown;
}>;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

type ResolverDependencies = Readonly<{
  createServerClient?: () => Promise<unknown>;
  createAdminClient?: () => unknown;
}>;

type GeneratedImageMetadataRow = Readonly<{
  id: unknown;
  message_id: unknown;
  conversation_id: unknown;
  user_id: unknown;
  storage_path: unknown;
  mime_type: unknown;
}>;

type LinkedMessageRow = Readonly<{
  id: unknown;
  user_id: unknown;
  conversation_id: unknown;
  role: unknown;
}>;

type UploadedImageMetadataRow = Readonly<{
  message_id: unknown;
  ordinal: unknown;
  storage_path: unknown;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function fail(code: ImageEditSourceResolverErrorCode): never {
  throw new ImageEditSourceResolverError(code);
}

function databaseFailure(): never {
  return fail("database_query_failed");
}

function normalizeConversationId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  return isUuid(normalized) ? normalized : null;
}

function isStorageNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) return false;

  const status = error.status ?? error.statusCode;
  return status === 404 || status === "404";
}

async function downloadAndInspectSource(params: {
  storagePath: string;
  declaredMimeType?: string | null;
  createAdminClient: () => AdminSupabaseClient;
}): Promise<ImageEditSourceInspection> {
  let blob: Blob | null = null;
  let storageError: unknown = null;

  try {
    const admin = params.createAdminClient();
    const result = await admin.storage
      .from("chat-images")
      .download(params.storagePath);
    blob = result.data;
    storageError = result.error;
  } catch (error) {
    if (isStorageNotFoundError(error)) {
      fail("storage_object_missing");
    }
    fail("storage_download_failed");
  }

  if (storageError) {
    fail(
      isStorageNotFoundError(storageError)
        ? "storage_object_missing"
        : "storage_download_failed",
    );
  }

  if (!blob) {
    fail("storage_object_missing");
  }

  if (
    typeof blob.size !== "number" ||
    !Number.isFinite(blob.size) ||
    blob.size < 0
  ) {
    fail("storage_download_failed");
  }

  if (blob.size > MAX_IMAGE_EDIT_SOURCE_BYTES) {
    fail("invalid_source_image");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch {
    fail("storage_download_failed");
  }

  try {
    return await inspectImageEditSource({
      bytes,
      declaredMimeType: params.declaredMimeType,
    });
  } catch (error) {
    if (error instanceof ImageEditSourceValidationError) {
      fail("invalid_source_image");
    }
    fail("storage_download_failed");
  }
}

async function authorizeConversation(params: {
  supabase: ServerSupabaseClient;
  userId: string;
  conversationId: string;
}): Promise<void> {
  const { data, error } = await params.supabase
    .from("conversations")
    .select("id")
    .eq("id", params.conversationId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) databaseFailure();
  if (!data) fail("conversation_not_found");

  if (!isRecord(data) || data.id !== params.conversationId) {
    databaseFailure();
  }
}

async function resolveGeneratedSource(params: {
  supabase: ServerSupabaseClient;
  userId: string;
  conversationId: string;
  sourceReference: Extract<
    ImageEditSourceReference,
    { kind: "generated_image" }
  >;
  createAdminClient: () => AdminSupabaseClient;
}): Promise<ResolvedImageEditSource> {
  if (!isUuid(params.sourceReference.generatedImageId)) {
    fail("invalid_source_reference");
  }

  const { data, error } = await params.supabase
    .from("message_generated_images")
    .select("id, message_id, conversation_id, user_id, storage_path, mime_type")
    .eq("id", params.sourceReference.generatedImageId)
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .maybeSingle();

  if (error) databaseFailure();
  if (!data) fail("source_not_found");

  const row = data as unknown as GeneratedImageMetadataRow;
  const id = typeof row.id === "string" ? row.id : "";
  const messageId = typeof row.message_id === "string" ? row.message_id : "";
  const conversationId =
    typeof row.conversation_id === "string" ? row.conversation_id : "";
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const storagePath =
    typeof row.storage_path === "string" ? row.storage_path : "";
  const mimeType = normalizeGeneratedImageMimeType(row.mime_type);

  if (
    id !== params.sourceReference.generatedImageId ||
    !isUuid(messageId) ||
    conversationId !== params.conversationId ||
    userId !== params.userId ||
    !mimeType ||
    !isValidGeneratedImagePath(
      storagePath,
      params.userId,
      params.conversationId,
    )
  ) {
    fail("malformed_source_metadata");
  }

  const {
    data: linkedMessage,
    error: linkedMessageError,
  } = await params.supabase
    .from("messages")
    .select("id, user_id, conversation_id, role")
    .eq("id", messageId)
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .eq("role", "assistant")
    .maybeSingle();

  if (linkedMessageError) databaseFailure();
  if (!linkedMessage) fail("malformed_source_metadata");

  const message = linkedMessage as unknown as LinkedMessageRow;
  if (
    !isRecord(message) ||
    message.id !== messageId ||
    message.user_id !== params.userId ||
    message.conversation_id !== params.conversationId ||
    message.role !== "assistant"
  ) {
    fail("malformed_source_metadata");
  }

  const inspected = await downloadAndInspectSource({
    storagePath,
    declaredMimeType: mimeType,
    createAdminClient: params.createAdminClient,
  });

  return {
    sourceReference: params.sourceReference,
    conversationId: params.conversationId,
    bytes: new Uint8Array(inspected.bytes),
    mimeType: inspected.mimeType,
    width: inspected.width,
    height: inspected.height,
    byteLength: inspected.byteLength,
  };
}

async function resolveUploadedSource(params: {
  supabase: ServerSupabaseClient;
  userId: string;
  conversationId: string;
  sourceReference: Extract<
    ImageEditSourceReference,
    { kind: "uploaded_image" }
  >;
  createAdminClient: () => AdminSupabaseClient;
}): Promise<ResolvedImageEditSource> {
  if (!isUuid(params.sourceReference.messageId)) {
    fail("invalid_source_reference");
  }

  const { data: parentMessage, error: parentMessageError } = await params.supabase
    .from("messages")
    .select("id, user_id, conversation_id, role")
    .eq("id", params.sourceReference.messageId)
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .eq("role", "user")
    .maybeSingle();

  if (parentMessageError) databaseFailure();
  if (!parentMessage) fail("source_not_found");

  const message = parentMessage as unknown as LinkedMessageRow;
  if (
    !isRecord(message) ||
    message.id !== params.sourceReference.messageId ||
    message.user_id !== params.userId ||
    message.conversation_id !== params.conversationId ||
    message.role !== "user"
  ) {
    fail("source_not_found");
  }

  const { data: childImage, error: childImageError } = await params.supabase
    .from("message_images")
    .select("message_id, ordinal, storage_path")
    .eq("message_id", params.sourceReference.messageId)
    .eq("ordinal", params.sourceReference.ordinal)
    .maybeSingle();

  if (childImageError) databaseFailure();
  if (!childImage) fail("source_not_found");

  const row = childImage as unknown as UploadedImageMetadataRow;
  const messageId = typeof row.message_id === "string" ? row.message_id : "";
  const storagePath =
    typeof row.storage_path === "string" ? row.storage_path : "";

  if (
    messageId !== params.sourceReference.messageId ||
    row.ordinal !== params.sourceReference.ordinal ||
    !storagePath
  ) {
    fail("malformed_source_metadata");
  }

  try {
    validateStoredImagePath(storagePath, params.userId);
  } catch {
    fail("malformed_source_metadata");
  }

  const inspected = await downloadAndInspectSource({
    storagePath,
    createAdminClient: params.createAdminClient,
  });

  return {
    sourceReference: params.sourceReference,
    conversationId: params.conversationId,
    bytes: new Uint8Array(inspected.bytes),
    mimeType: inspected.mimeType,
    width: inspected.width,
    height: inspected.height,
    byteLength: inspected.byteLength,
  };
}

export async function resolveImageEditSource(
  input: ImageEditSourceResolverInput,
  dependencies: ResolverDependencies = {},
): Promise<ResolvedImageEditSource> {
  let supabase: ServerSupabaseClient;

  try {
    const createServerClient =
      dependencies.createServerClient ?? createServerSupabaseClient;
    supabase = (await createServerClient()) as ServerSupabaseClient;
  } catch {
    fail("unauthenticated");
  }

  let userId: string;
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user?.id) {
      fail("unauthenticated");
    }

    userId = user.id;
  } catch (error) {
    if (error instanceof ImageEditSourceResolverError) throw error;
    fail("unauthenticated");
  }

  const rawInput = isRecord(input) ? input : null;
  const conversationId = normalizeConversationId(rawInput?.conversationId);
  const sourceResult = validateImageEditSourceReference(
    rawInput?.sourceReference,
  );

  if (!sourceResult.success) {
    fail("invalid_source_reference");
  }

  if (!conversationId) {
    fail("conversation_not_found");
  }

  await authorizeConversation({ supabase, userId, conversationId });

  const createAdminClientFactory: () => AdminSupabaseClient =
    dependencies.createAdminClient
      ? () => dependencies.createAdminClient!() as AdminSupabaseClient
      : createAdminClient;

  if (sourceResult.source.kind === "generated_image") {
    return resolveGeneratedSource({
      supabase,
      userId,
      conversationId,
      sourceReference: sourceResult.source,
      createAdminClient: createAdminClientFactory,
    });
  }

  return resolveUploadedSource({
    supabase,
    userId,
    conversationId,
    sourceReference: sourceResult.source,
    createAdminClient: createAdminClientFactory,
  });
}
