import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  type ImageEditClaim,
  type ImageEditFailureCode,
  type ImageEditOrchestratorDependencies,
  type ImageEditReleaseReason,
  type StaleAttemptResolution,
} from "./image-edit-orchestrator";
import { createImageEditFinalizer } from "./image-edit-finalizer";
import {
  resolveImageEditSource,
  type ImageEditSourceResolverInput,
} from "./image-edit-source-resolver";
import {
  RUNWARE_IMAGE_EDIT_MODEL,
  RUNWARE_IMAGE_EDIT_PROVIDER,
} from "./config";
import { RunwareImageEditProvider } from "./providers/runware-image-edit";

if (typeof window !== "undefined") {
  throw new Error("Image edit server dependencies are server-only");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DERIVATIVE_PATH_PATTERN =
  /^generated\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.png$/i;
const IMAGE_QUOTA_ERROR_CODES = [
  "IMAGE_DAILY_LIMIT_REACHED",
  "IMAGE_MONTHLY_LIMIT_REACHED",
] as const;
const ATTEMPT_STATUSES = ["reserved", "succeeded", "released"] as const;
const RELEASE_REASONS = [
  "provider_failure",
  "invalid_provider_output",
  "storage_failure",
  "persistence_failure",
  "request_aborted",
  "internal_failure",
  "expired",
] as const;

type ImageQuotaErrorCode = (typeof IMAGE_QUOTA_ERROR_CODES)[number];

type RpcResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

type RpcClientLike = Readonly<{
  rpc: (functionName: string, args: Record<string, unknown>) => Promise<RpcResult>;
}>;

type QueryLike = Readonly<{
  select: (columns: string) => QueryLike;
  eq: (column: string, value: unknown) => QueryLike;
  maybeSingle: () => Promise<RpcResult>;
}>;

type ReadClientLike = Readonly<{
  from: (table: string) => QueryLike;
}>;

type StorageBucketLike = Readonly<{
  upload: (
    path: string,
    body: Uint8Array,
    options: Readonly<{
      contentType: "image/png";
      cacheControl: "3600";
      upsert: false;
    }>,
  ) => Promise<RpcResult>;
  remove: (paths: string[]) => Promise<RpcResult>;
}>;

type StorageClientLike = Readonly<{
  storage: Readonly<{
    from: (bucket: string) => StorageBucketLike;
  }>;
}>;

export type ImageEditServerDependenciesOptions = Readonly<{
  authenticatedClient: unknown;
  serviceClient: unknown;
  authenticatedUserId: string;
  conversationId: string;
}>;

export type ImageEditServerDependencies = ImageEditOrchestratorDependencies &
  Readonly<{
    getLastQuotaErrorCode: () => ImageQuotaErrorCode | null;
  }>;

type ClaimContext = Readonly<{
  imageEditRequestId: string;
  conversationId: string;
  idempotencyKey: string;
  fingerprint: string;
}>;

type StaleRequestRow = Readonly<{
  id: unknown;
  user_id: unknown;
  conversation_id: unknown;
  attempt_id: unknown;
  status: unknown;
}>;

type StaleAttemptRow = Readonly<{
  id: unknown;
  user_id: unknown;
  conversation_id: unknown;
  status: unknown;
  expires_at: unknown;
  completed_at: unknown;
  released_at: unknown;
  release_reason: unknown;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeUuid(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string" ? error.message : "";
}

function exactlyOneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new Error("IMAGE_EDIT_RPC_MALFORMED");
  }

  return data[0];
}

function nullableUuid(value: unknown): string | null {
  if (value === null) return null;

  const normalized = normalizeUuid(value);
  if (!normalized) throw new Error("IMAGE_EDIT_RPC_MALFORMED");
  return normalized;
}

function parseClaim(data: unknown): ImageEditClaim {
  const row = exactlyOneRow(data);
  const imageEditRequestId = normalizeUuid(row.image_edit_request_id);
  const disposition = row.disposition;
  const status = row.status;

  if (
    !imageEditRequestId ||
    (disposition !== "claimed" &&
      disposition !== "in_progress" &&
      disposition !== "completed" &&
      disposition !== "conflict") ||
    (status !== "in_progress" && status !== "failed" && status !== "completed")
  ) {
    throw new Error("IMAGE_EDIT_RPC_MALFORMED");
  }

  const claim = {
    imageEditRequestId,
    disposition,
    attemptId: nullableUuid(row.attempt_id),
    staleAttemptId: nullableUuid(row.stale_attempt_id),
    userMessageId: nullableUuid(row.user_message_id),
    assistantMessageId: nullableUuid(row.assistant_message_id),
    generatedImageId: nullableUuid(row.generated_image_id),
    status,
  };

  if (!isValidClaim(claim)) {
    throw new Error("IMAGE_EDIT_RPC_MALFORMED");
  }

  return claim;
}

function hasNoDurableResultIds(claim: ImageEditClaim): boolean {
  return (
    claim.userMessageId === null &&
    claim.assistantMessageId === null &&
    claim.generatedImageId === null
  );
}

function isValidClaim(claim: ImageEditClaim): boolean {
  switch (claim.disposition) {
    case "claimed":
      return (
        claim.status === "in_progress" &&
        claim.attemptId === null &&
        hasNoDurableResultIds(claim)
      );
    case "in_progress":
      return (
        claim.status === "in_progress" &&
        claim.staleAttemptId === null &&
        hasNoDurableResultIds(claim)
      );
    case "completed":
      return claim.status === "completed" && claim.staleAttemptId === null;
    case "conflict":
      return (
        (claim.status === "in_progress" ||
          claim.status === "failed" ||
          claim.status === "completed") &&
        claim.attemptId === null &&
        claim.staleAttemptId === null &&
        hasNoDurableResultIds(claim)
      );
    default:
      return false;
  }
}

function parseBoolean(data: unknown): boolean {
  if (typeof data !== "boolean") throw new Error("IMAGE_EDIT_RPC_MALFORMED");
  return data;
}

function parseQuotaAttempt(data: unknown): { attemptId: string } {
  const row = exactlyOneRow(data);
  const attemptId = normalizeUuid(row.attempt_id);
  const plan = row.plan;
  const numericFields = [
    row.daily_used,
    row.daily_reserved,
    row.daily_limit,
    row.daily_remaining,
    row.monthly_used,
    row.monthly_reserved,
    row.monthly_limit,
    row.monthly_remaining,
  ];

  if (
    !attemptId ||
    (plan !== "free" && plan !== "pro") ||
    numericFields.some((value) => !Number.isSafeInteger(value) || (value as number) < 0)
  ) {
    throw new Error("IMAGE_EDIT_RPC_MALFORMED");
  }

  return { attemptId };
}

function isReleaseReason(value: unknown): value is ImageEditReleaseReason {
  return (
    typeof value === "string" &&
    RELEASE_REASONS.some((reason) => reason === value)
  );
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isDerivativePath(path: unknown, userId: string, conversationId: string): path is string {
  if (typeof path !== "string") return false;

  const match = DERIVATIVE_PATH_PATTERN.exec(path);
  return Boolean(
    match &&
      match[1]?.toLowerCase() === userId &&
      match[2]?.toLowerCase() === conversationId &&
      isUuid(match[3]),
  );
}

function terminalAttemptIsNonCounting(row: StaleAttemptRow): boolean {
  if (row.status === "released") {
    return isValidTimestamp(row.released_at) && isReleaseReason(row.release_reason);
  }

  if (row.status === "succeeded") {
    return isValidTimestamp(row.completed_at);
  }

  return false;
}

async function readSingle(
  client: ReadClientLike,
  table: string,
  columns: string,
  filters: ReadonlyArray<readonly [string, string]>,
): Promise<Record<string, unknown> | null> {
  try {
    let query = client.from(table).select(columns);
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }

    const { data, error } = await query.maybeSingle();
    if (error || data === null || data === undefined) return null;
    return isRecord(data) ? data : null;
  } catch {
    return null;
  }
}

export function createImageEditServerDependencies(
  options: ImageEditServerDependenciesOptions,
): ImageEditServerDependencies {
  const authenticatedClient = options.authenticatedClient as RpcClientLike;
  const serviceClient = options.serviceClient as RpcClientLike &
    ReadClientLike &
    StorageClientLike;
  const authenticatedUserId = normalizeUuid(options.authenticatedUserId);
  const conversationId = normalizeUuid(options.conversationId);

  if (!authenticatedUserId || !conversationId) {
    throw new Error("IMAGE_EDIT_DEPENDENCIES_INVALID_CONTEXT");
  }

  let claimContext: ClaimContext | null = null;
  let lastQuotaErrorCode: ImageQuotaErrorCode | null = null;

  const claimImageEditRequest = async (input: {
    conversationId: string;
    idempotencyKey: string;
    fingerprint: string;
  }): Promise<ImageEditClaim> => {
    let result: RpcResult;
    try {
      result = await authenticatedClient.rpc("claim_image_edit_request", {
        p_conversation_id: input.conversationId,
        p_idempotency_key: input.idempotencyKey,
        p_request_fingerprint: input.fingerprint,
      });
    } catch {
      throw new Error("IMAGE_EDIT_CLAIM_FAILED");
    }

    if (result.error) throw new Error("IMAGE_EDIT_CLAIM_FAILED");

    let claim: ImageEditClaim;
    try {
      claim = parseClaim(result.data);
    } catch {
      throw new Error("IMAGE_EDIT_CLAIM_FAILED");
    }

    claimContext = {
      imageEditRequestId: claim.imageEditRequestId,
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      fingerprint: input.fingerprint,
    };
    return claim;
  };

  const resolveStaleAttempt = async (
    attemptId: string,
  ): Promise<StaleAttemptResolution> => {
    const normalizedAttemptId = normalizeUuid(attemptId);
    const context = claimContext;
    if (!normalizedAttemptId || !context) return { status: "ambiguous" };

    const request = await readSingle(
      serviceClient,
      "image_edit_requests",
      "id, user_id, conversation_id, attempt_id, status",
      [
        ["id", context.imageEditRequestId],
        ["user_id", authenticatedUserId],
        ["conversation_id", conversationId],
      ],
    );
    if (!request) return { status: "ambiguous" };

    const requestRow = request as StaleRequestRow;
    if (
      normalizeUuid(requestRow.id) !== context.imageEditRequestId ||
      normalizeUuid(requestRow.user_id) !== authenticatedUserId ||
      normalizeUuid(requestRow.conversation_id) !== conversationId ||
      normalizeUuid(requestRow.attempt_id) !== normalizedAttemptId ||
      requestRow.status !== "in_progress"
    ) {
      return { status: "ambiguous" };
    }

    const readAttempt = async (): Promise<StaleAttemptRow | null> => {
      const attempt = await readSingle(
        serviceClient,
        "image_generation_attempts",
        "id, user_id, conversation_id, status, expires_at, completed_at, released_at, release_reason",
        [
          ["id", normalizedAttemptId],
          ["user_id", authenticatedUserId],
          ["conversation_id", conversationId],
        ],
      );
      return attempt as StaleAttemptRow | null;
    };

    const attempt = await readAttempt();
    if (!attempt) return { status: "ambiguous" };

    if (
      normalizeUuid(attempt.id) !== normalizedAttemptId ||
      normalizeUuid(attempt.user_id) !== authenticatedUserId ||
      normalizeUuid(attempt.conversation_id) !== conversationId ||
      !ATTEMPT_STATUSES.includes(attempt.status as (typeof ATTEMPT_STATUSES)[number])
    ) {
      return { status: "ambiguous" };
    }

    if (terminalAttemptIsNonCounting(attempt)) {
      return { status: "non_counting" };
    }

    if (attempt.status !== "reserved" || !isValidTimestamp(attempt.expires_at)) {
      return { status: "ambiguous" };
    }

    if (Date.parse(attempt.expires_at) > Date.now()) {
      return { status: "ambiguous" };
    }

    try {
      await releaseImageQuota(normalizedAttemptId, "expired");
    } catch {
      // The authoritative reread below is still required. A release result or
      // exception alone cannot prove that this attempt is non-counting.
    }

    const reread = await readAttempt();
    if (!reread) return { status: "ambiguous" };

    return terminalAttemptIsNonCounting(reread)
      ? { status: "non_counting" }
      : { status: "ambiguous" };
  };

  const releaseImageQuota = async (
    attemptId: string,
    reason: ImageEditReleaseReason,
  ): Promise<boolean> => {
    if (!isReleaseReason(reason)) throw new Error("IMAGE_EDIT_RELEASE_INVALID");

    let result: RpcResult;
    try {
      result = await authenticatedClient.rpc("release_image_generation_quota", {
        p_attempt_id: attemptId,
        p_reason: reason,
      });
    } catch {
      throw new Error("IMAGE_EDIT_RELEASE_FAILED");
    }

    if (result.error) throw new Error("IMAGE_EDIT_RELEASE_FAILED");

    try {
      return parseBoolean(result.data);
    } catch {
      throw new Error("IMAGE_EDIT_RELEASE_FAILED");
    }
  };

  const reserveImageQuota = async (conversationIdForQuota: string) => {
    lastQuotaErrorCode = null;
    let result: RpcResult;
    try {
      result = await authenticatedClient.rpc("reserve_image_generation_quota", {
        p_conversation_id: conversationIdForQuota,
      });
    } catch (error) {
      const message = errorMessage(error);
      if (IMAGE_QUOTA_ERROR_CODES.includes(message as ImageQuotaErrorCode)) {
        lastQuotaErrorCode = message as ImageQuotaErrorCode;
        throw new Error(message);
      }
      throw new Error("IMAGE_EDIT_QUOTA_RESERVATION_FAILED");
    }

    if (result.error) {
      const message = errorMessage(result.error);
      if (IMAGE_QUOTA_ERROR_CODES.includes(message as ImageQuotaErrorCode)) {
        lastQuotaErrorCode = message as ImageQuotaErrorCode;
        throw new Error(message);
      }
      throw new Error("IMAGE_EDIT_QUOTA_RESERVATION_FAILED");
    }

    try {
      return parseQuotaAttempt(result.data);
    } catch {
      throw new Error("IMAGE_EDIT_QUOTA_RESERVATION_FAILED");
    }
  };

  const bindImageEditRequestAttempt = async (input: {
    imageEditRequestId: string;
    attemptId: string;
  }): Promise<boolean> => {
    let result: RpcResult;
    try {
      result = await authenticatedClient.rpc("bind_image_edit_request_attempt", {
        p_image_edit_request_id: input.imageEditRequestId,
        p_attempt_id: input.attemptId,
      });
    } catch {
      throw new Error("IMAGE_EDIT_BIND_FAILED");
    }

    if (result.error) throw new Error("IMAGE_EDIT_BIND_FAILED");

    try {
      return parseBoolean(result.data);
    } catch {
      throw new Error("IMAGE_EDIT_BIND_FAILED");
    }
  };

  const startImageGenerationAttempt = async (input: {
    attemptId: string;
    provider: typeof RUNWARE_IMAGE_EDIT_PROVIDER;
    model: typeof RUNWARE_IMAGE_EDIT_MODEL;
  }): Promise<boolean> => {
    let result: RpcResult;
    try {
      result = await authenticatedClient.rpc("start_image_generation_attempt", {
        p_attempt_id: input.attemptId,
        p_provider: RUNWARE_IMAGE_EDIT_PROVIDER,
        p_model: RUNWARE_IMAGE_EDIT_MODEL,
      });
    } catch {
      throw new Error("IMAGE_EDIT_ATTEMPT_START_FAILED");
    }

    if (result.error) throw new Error("IMAGE_EDIT_ATTEMPT_START_FAILED");

    try {
      return parseBoolean(result.data);
    } catch {
      throw new Error("IMAGE_EDIT_ATTEMPT_START_FAILED");
    }
  };

  const failImageEditRequest = async (
    imageEditRequestId: string,
    failureCode: ImageEditFailureCode,
  ): Promise<boolean> => {
    let result: RpcResult;
    try {
      result = await authenticatedClient.rpc("fail_image_edit_request", {
        p_image_edit_request_id: imageEditRequestId,
        p_failure_code: failureCode,
      });
    } catch {
      throw new Error("IMAGE_EDIT_FAILURE_UPDATE_FAILED");
    }

    if (result.error) throw new Error("IMAGE_EDIT_FAILURE_UPDATE_FAILED");

    try {
      return parseBoolean(result.data);
    } catch {
      throw new Error("IMAGE_EDIT_FAILURE_UPDATE_FAILED");
    }
  };

  const uploadDerivative = async (input: {
    bucket: "chat-images";
    storagePath: string;
    bytes: Uint8Array;
    mimeType: "image/png";
    cacheControl: "3600";
    upsert: false;
  }): Promise<void> => {
    if (
      input.bucket !== "chat-images" ||
      input.mimeType !== "image/png" ||
      input.cacheControl !== "3600" ||
      input.upsert !== false ||
      !isDerivativePath(input.storagePath, authenticatedUserId, conversationId)
    ) {
      throw new Error("IMAGE_EDIT_STORAGE_INVALID");
    }

    let result: RpcResult;
    try {
      result = await serviceClient.storage.from("chat-images").upload(
        input.storagePath,
        input.bytes,
        {
          contentType: "image/png",
          cacheControl: "3600",
          upsert: false,
        },
      );
    } catch {
      throw new Error("IMAGE_EDIT_STORAGE_UPLOAD_FAILED");
    }

    if (result.error) throw new Error("IMAGE_EDIT_STORAGE_UPLOAD_FAILED");
  };

  const removeDerivative = async (input: {
    bucket: "chat-images";
    storagePath: string;
  }): Promise<void> => {
    if (
      input.bucket !== "chat-images" ||
      !isDerivativePath(input.storagePath, authenticatedUserId, conversationId)
    ) {
      throw new Error("IMAGE_EDIT_STORAGE_INVALID");
    }

    let result: RpcResult;
    try {
      result = await serviceClient.storage.from("chat-images").remove([input.storagePath]);
    } catch {
      throw new Error("IMAGE_EDIT_STORAGE_REMOVE_FAILED");
    }

    if (result.error) throw new Error("IMAGE_EDIT_STORAGE_REMOVE_FAILED");
  };

  const finalizer = createImageEditFinalizer(
    serviceClient as Parameters<typeof createImageEditFinalizer>[0],
    authenticatedUserId,
  );

  return {
    claimImageEditRequest,
    resolveStaleAttempt,
    releaseImageQuota,
    reserveImageQuota,
    bindImageEditRequestAttempt,
    startImageGenerationAttempt,
    resolveImageEditSource: (input: ImageEditSourceResolverInput) =>
      resolveImageEditSource(input, {
        createServerClient: async () => authenticatedClient,
        createAdminClient: () => serviceClient,
      }),
    imageEditingProvider: new RunwareImageEditProvider(),
    uploadDerivative,
    removeDerivative,
    failImageEditRequest,
    finalizeImageEdit: finalizer,
    logger: (event, metadata) => {
      console.error(`image-edit:${event}`, metadata);
    },
    getLastQuotaErrorCode: () => lastQuotaErrorCode,
  };
}

export async function createDefaultImageEditServerDependencies(input: {
  authenticatedUserId: string;
  conversationId: string;
}): Promise<ImageEditServerDependencies> {
  const authenticatedClient = await createServerSupabaseClient();
  const serviceClient = createAdminClient();

  return createImageEditServerDependencies({
    authenticatedClient,
    serviceClient,
    authenticatedUserId: input.authenticatedUserId,
    conversationId: input.conversationId,
  });
}
