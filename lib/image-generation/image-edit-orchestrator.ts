import { createHash } from "node:crypto";
import {
  IMAGE_GENERATION_PROMPT_MAX_LENGTH,
  RUNWARE_IMAGE_EDIT_MODEL,
  RUNWARE_IMAGE_EDIT_PROVIDER,
} from "./config";
import {
  normalizeImageEditDimensions,
  type ResolvedImageEditSource,
} from "./image-edit-source";
import {
  ImageEditSourceResolverError,
  resolveImageEditSource,
  type ImageEditSourceResolverInput,
} from "./image-edit-source-resolver";
import {
  validateImageEditSourceReference,
  type ImageEditSourceReference,
} from "./lineage";
import {
  RunwareImageEditProvider,
  RunwareImageEditProviderError,
} from "./providers/runware-image-edit";
import type {
  ImageEditingProvider,
  ImageGenerationResult,
} from "./provider";

if (typeof window !== "undefined") {
  throw new Error("Image edit orchestration is server-only");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INSTRUCTION_LENGTH = IMAGE_GENERATION_PROMPT_MAX_LENGTH;
const IMAGE_EDIT_STORAGE_BUCKET = "chat-images" as const;
const IMAGE_EDIT_CACHE_CONTROL = "3600" as const;

export type ImageEditOrchestratorInput = Readonly<{
  authenticatedUserId: string;
  conversationId: string;
  sourceReference: unknown;
  instruction: string;
  idempotencyKey: string;
}>;

export type ImageEditRequestDisposition =
  | "claimed"
  | "in_progress"
  | "completed"
  | "conflict";

export type ImageEditClaim = Readonly<{
  imageEditRequestId: string;
  disposition: string;
  attemptId: string | null;
  staleAttemptId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  generatedImageId: string | null;
  status: string;
}>;

export type ImageEditQuotaAttempt = Readonly<{
  attemptId: string;
}>;

export type ImageEditFailureCode =
  | "invalid_request"
  | "source_not_found"
  | "source_forbidden"
  | "quota_reservation_failed"
  | "attempt_start_failed"
  | "provider_configuration"
  | "provider_timeout"
  | "provider_failure"
  | "invalid_provider_output"
  | "storage_failure"
  | "persistence_failure"
  | "request_aborted"
  | "internal_failure";

export type ImageEditReleaseReason =
  | "provider_failure"
  | "invalid_provider_output"
  | "storage_failure"
  | "persistence_failure"
  | "request_aborted"
  | "internal_failure"
  | "expired";

export type StaleAttemptResolution =
  | Readonly<{ status: "non_counting" }>
  | Readonly<{ status: "ambiguous" }>;

export type ImageEditOrchestrationErrorCode =
  | "invalid_request"
  | "idempotency_conflict"
  | "operation_in_progress"
  | "completed_replay"
  | "completed_result_unavailable"
  | "quota_exhausted"
  | "source_forbidden"
  | "source_not_found"
  | "invalid_source"
  | "attempt_start_failed"
  | "provider_configuration"
  | "provider_timeout"
  | "provider_failure"
  | "invalid_provider_output"
  | "storage_failure"
  | "persistence_failure"
  | "internal_failure";

const ERROR_MESSAGES: Record<ImageEditOrchestrationErrorCode, string> = {
  invalid_request: "The image edit request is invalid.",
  idempotency_conflict: "The image edit request conflicts with an existing request.",
  operation_in_progress: "The image edit request is already in progress.",
  completed_replay: "The image edit request has already completed.",
  completed_result_unavailable: "The image edit request completed without an available result.",
  quota_exhausted: "The image edit image quota is unavailable.",
  source_forbidden: "The image edit source is unavailable.",
  source_not_found: "The image edit source was not found.",
  invalid_source: "The image edit source is invalid.",
  attempt_start_failed: "The image edit attempt could not be started.",
  provider_configuration: "Image editing is not configured.",
  provider_timeout: "The image edit provider timed out.",
  provider_failure: "The image edit provider failed.",
  invalid_provider_output: "The image edit provider returned an invalid result.",
  storage_failure: "The edited image could not be stored.",
  persistence_failure: "The image edit could not be saved.",
  internal_failure: "The image edit could not be completed.",
};

export class ImageEditOrchestrationError extends Error {
  readonly code: ImageEditOrchestrationErrorCode;

  constructor(code: ImageEditOrchestrationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ImageEditOrchestrationError";
    this.code = code;
  }
}

export type ImageEditOrchestrationResult =
  | Readonly<{
      kind: "completed";
      disposition: "claimed" | "completed";
      status: "completed";
      conversationId: string;
      imageEditRequestId: string;
      userMessageId: string;
      assistantMessageId: string;
      generatedImageId: string;
    }>
  | Readonly<{
      kind: "completed_replay";
      disposition: "completed";
      status: "completed";
      conversationId: string;
      imageEditRequestId: string;
      userMessageId: string;
      assistantMessageId: string;
      generatedImageId: string;
    }>
  | Readonly<{
      kind: "completed_result_unavailable";
      disposition: "completed";
      status: "completed";
      conversationId: string;
      imageEditRequestId: string;
      userMessageId: string | null;
      assistantMessageId: string | null;
      generatedImageId: string | null;
    }>
  | Readonly<{
      kind: "in_progress";
      disposition: "in_progress";
      status: "in_progress";
      conversationId: string;
      imageEditRequestId: string;
    }>
  | Readonly<{
      kind: "conflict";
      disposition: "conflict";
      status: string;
      conversationId: string;
      imageEditRequestId: string;
    }>;

export type ImageEditFinalizerInput = Readonly<{
  imageEditRequestId: string;
  attemptId: string;
  conversationId: string;
  sourceReference: ImageEditSourceReference;
  instruction: string;
  storagePath: string;
  mimeType: "image/png";
  provider: typeof RUNWARE_IMAGE_EDIT_PROVIDER;
  model: typeof RUNWARE_IMAGE_EDIT_MODEL;
  sourceGeneratedImageId: string | null;
  sourceUploadedMessageId: string | null;
  sourceUploadedOrdinal: number | null;
}>;

export type ImageEditFinalizerResult = Readonly<{
  userMessageId: string;
  assistantMessageId: string;
  generatedImageId: string;
}>;

export type ImageEditUploadInput = Readonly<{
  bucket: typeof IMAGE_EDIT_STORAGE_BUCKET;
  storagePath: string;
  bytes: Uint8Array;
  mimeType: "image/png";
  cacheControl: typeof IMAGE_EDIT_CACHE_CONTROL;
  upsert: false;
}>;

export type ImageEditRemoveInput = Readonly<{
  bucket: typeof IMAGE_EDIT_STORAGE_BUCKET;
  storagePath: string;
}>;

export type ImageEditOrchestratorDependencies = Readonly<{
  claimImageEditRequest: (input: {
    conversationId: string;
    idempotencyKey: string;
    fingerprint: string;
  }) => Promise<ImageEditClaim>;
  resolveStaleAttempt: (attemptId: string) => Promise<StaleAttemptResolution>;
  releaseImageQuota: (attemptId: string, reason: ImageEditReleaseReason) => Promise<boolean>;
  reserveImageQuota: (conversationId: string) => Promise<ImageEditQuotaAttempt>;
  bindImageEditRequestAttempt: (input: {
    imageEditRequestId: string;
    attemptId: string;
  }) => Promise<boolean>;
  startImageGenerationAttempt: (input: {
    attemptId: string;
    provider: typeof RUNWARE_IMAGE_EDIT_PROVIDER;
    model: typeof RUNWARE_IMAGE_EDIT_MODEL;
  }) => Promise<boolean>;
  resolveImageEditSource?: (
    input: ImageEditSourceResolverInput,
  ) => Promise<ResolvedImageEditSource>;
  imageEditingProvider?: ImageEditingProvider;
  uploadDerivative: (input: ImageEditUploadInput) => Promise<void>;
  removeDerivative: (input: ImageEditRemoveInput) => Promise<void>;
  failImageEditRequest: (
    imageEditRequestId: string,
    failureCode: ImageEditFailureCode,
  ) => Promise<boolean>;
  finalizeImageEdit: (
    input: ImageEditFinalizerInput,
  ) => Promise<ImageEditFinalizerResult>;
  logger?: (event: string, metadata: Readonly<Record<string, string>>) => void;
}>;

type NormalizedInput = Readonly<{
  authenticatedUserId: string;
  conversationId: string;
  sourceReference: ImageEditSourceReference;
  instruction: string;
  idempotencyKey: string;
}>;

type CompensationContext = Readonly<{
  imageEditRequestId: string | null;
  attemptId: string | null;
  storagePath: string | null;
  provider: typeof RUNWARE_IMAGE_EDIT_PROVIDER;
  model: typeof RUNWARE_IMAGE_EDIT_MODEL;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return isUuid(normalized) ? normalized.toLowerCase() : null;
}

function normalizeInput(input: ImageEditOrchestratorInput): NormalizedInput {
  if (!isRecord(input)) {
    throw new ImageEditOrchestrationError("invalid_request");
  }

  const authenticatedUserId = normalizeUuid(input.authenticatedUserId);
  const conversationId = normalizeUuid(input.conversationId);
  const idempotencyKey = normalizeUuid(input.idempotencyKey);
  const sourceResult = validateImageEditSourceReference(input.sourceReference);

  if (!authenticatedUserId || !conversationId || !idempotencyKey || !sourceResult.success) {
    throw new ImageEditOrchestrationError("invalid_request");
  }

  if (
    typeof input.instruction !== "string" ||
    input.instruction.trim().length === 0 ||
    input.instruction.length > MAX_INSTRUCTION_LENGTH
  ) {
    throw new ImageEditOrchestrationError("invalid_request");
  }

  return {
    authenticatedUserId,
    conversationId,
    sourceReference: sourceResult.source,
    instruction: input.instruction,
    idempotencyKey,
  };
}

function canonicalSourceReference(source: ImageEditSourceReference): Readonly<Record<string, unknown>> {
  if (source.kind === "generated_image") {
    return {
      kind: source.kind,
      generatedImageId: source.generatedImageId,
    };
  }

  return {
    kind: source.kind,
    messageId: source.messageId,
    ordinal: source.ordinal,
  };
}

export function createImageEditRequestFingerprint(input: {
  conversationId: string;
  sourceReference: unknown;
  instruction: string;
}): string {
  const conversationId = normalizeUuid(input.conversationId);
  const sourceResult = validateImageEditSourceReference(input.sourceReference);

  if (
    !conversationId ||
    !sourceResult.success ||
    typeof input.instruction !== "string" ||
    input.instruction.trim().length === 0 ||
    input.instruction.length > MAX_INSTRUCTION_LENGTH
  ) {
    throw new ImageEditOrchestrationError("invalid_request");
  }

  const canonical = JSON.stringify({
    version: 1,
    conversationId,
    sourceReference: canonicalSourceReference(sourceResult.source),
    instruction: input.instruction,
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeClaim(value: ImageEditClaim): ImageEditClaim {
  if (!isRecord(value)) {
    throw new ImageEditOrchestrationError("internal_failure");
  }

  const imageEditRequestId = normalizeUuid(value.imageEditRequestId);
  if (!imageEditRequestId) {
    throw new ImageEditOrchestrationError("internal_failure");
  }

  const normalizeNullableUuid = (candidate: unknown): string | null => {
    if (candidate === null) return null;
    const normalized = normalizeUuid(candidate);
    if (!normalized) {
      throw new ImageEditOrchestrationError("internal_failure");
    }
    return normalized;
  };

  return {
    imageEditRequestId,
    disposition: safeString(value.disposition) ?? "",
    attemptId: normalizeNullableUuid(value.attemptId),
    staleAttemptId: normalizeNullableUuid(value.staleAttemptId),
    userMessageId: normalizeNullableUuid(value.userMessageId),
    assistantMessageId: normalizeNullableUuid(value.assistantMessageId),
    generatedImageId: normalizeNullableUuid(value.generatedImageId),
    status: safeString(value.status) ?? "",
  };
}

function isStaleAttemptResolution(value: unknown): value is StaleAttemptResolution {
  return (
    isRecord(value) &&
    (value.status === "non_counting" || value.status === "ambiguous")
  );
}

function completedResult(
  input: NormalizedInput,
  claim: ImageEditClaim,
  disposition: "claimed" | "completed",
): ImageEditOrchestrationResult {
  const { userMessageId, assistantMessageId, generatedImageId } = claim;
  if (userMessageId && assistantMessageId && generatedImageId) {
    if (disposition === "completed") {
      return {
        kind: "completed_replay",
        disposition: "completed",
        status: "completed",
        conversationId: input.conversationId,
        imageEditRequestId: claim.imageEditRequestId,
        userMessageId,
        assistantMessageId,
        generatedImageId,
      };
    }

    return {
      kind: "completed",
      disposition: "claimed",
      status: "completed",
      conversationId: input.conversationId,
      imageEditRequestId: claim.imageEditRequestId,
      userMessageId,
      assistantMessageId,
      generatedImageId,
    };
  }

  return {
    kind: "completed_result_unavailable",
    disposition: "completed",
    status: "completed",
    conversationId: input.conversationId,
    imageEditRequestId: claim.imageEditRequestId,
    userMessageId,
    assistantMessageId,
    generatedImageId,
  };
}

function isSameSourceReference(
  left: ImageEditSourceReference,
  right: ImageEditSourceReference,
): boolean {
  return JSON.stringify(canonicalSourceReference(left)) === JSON.stringify(canonicalSourceReference(right));
}

function mapResolverError(error: ImageEditSourceResolverError): {
  errorCode: ImageEditOrchestrationErrorCode;
  failureCode: ImageEditFailureCode;
  releaseReason: ImageEditReleaseReason;
} {
  switch (error.code) {
    case "unauthenticated":
    case "conversation_not_found":
      return {
        errorCode: "source_forbidden",
        failureCode: "source_forbidden",
        releaseReason: "request_aborted",
      };
    case "invalid_source_reference":
      return {
        errorCode: "invalid_request",
        failureCode: "invalid_request",
        releaseReason: "request_aborted",
      };
    case "source_not_found":
    case "malformed_source_metadata":
    case "storage_object_missing":
      return {
        errorCode: "source_not_found",
        failureCode: "source_not_found",
        releaseReason: "request_aborted",
      };
    case "invalid_source_image":
      return {
        errorCode: "invalid_source",
        failureCode: "invalid_request",
        releaseReason: "request_aborted",
      };
    case "storage_download_failed":
    case "database_query_failed":
      return {
        errorCode: "internal_failure",
        failureCode: "internal_failure",
        releaseReason: "internal_failure",
      };
  }
}

function mapProviderError(error: RunwareImageEditProviderError): {
  errorCode: ImageEditOrchestrationErrorCode;
  failureCode: ImageEditFailureCode;
  releaseReason: ImageEditReleaseReason;
} {
  switch (error.code) {
    case "invalid_request":
      return {
        errorCode: "invalid_request",
        failureCode: "invalid_request",
        releaseReason: "request_aborted",
      };
    case "configuration":
      return {
        errorCode: "provider_configuration",
        failureCode: "provider_configuration",
        releaseReason: "provider_failure",
      };
    case "timeout":
      return {
        errorCode: "provider_timeout",
        failureCode: "provider_timeout",
        releaseReason: "provider_failure",
      };
    case "invalid_output":
      return {
        errorCode: "invalid_provider_output",
        failureCode: "invalid_provider_output",
        releaseReason: "invalid_provider_output",
      };
    case "provider_failure":
      return {
        errorCode: "provider_failure",
        failureCode: "provider_failure",
        releaseReason: "provider_failure",
      };
  }
}

function logSafe(
  dependencies: ImageEditOrchestratorDependencies,
  event: string,
  context: CompensationContext,
  code: string,
): void {
  dependencies.logger?.(event, {
    code,
    ...(context.imageEditRequestId ? { imageEditRequestId: context.imageEditRequestId } : {}),
    ...(context.attemptId ? { attemptId: context.attemptId } : {}),
    provider: context.provider,
    model: context.model,
  });
}

async function compensate(
  dependencies: ImageEditOrchestratorDependencies,
  context: CompensationContext,
  failureCode: ImageEditFailureCode,
  releaseReason: ImageEditReleaseReason,
  errorCode?: ImageEditOrchestrationErrorCode,
): Promise<never> {
  if (context.storagePath) {
    try {
      await dependencies.removeDerivative({
        bucket: IMAGE_EDIT_STORAGE_BUCKET,
        storagePath: context.storagePath,
      });
    } catch {
      logSafe(dependencies, "image_edit_derivative_cleanup_failed", context, "storage_failure");
    }
  }

  if (context.attemptId) {
    try {
      await dependencies.releaseImageQuota(context.attemptId, releaseReason);
    } catch {
      logSafe(dependencies, "image_edit_attempt_release_failed", context, "internal_failure");
    }
  }

  if (context.imageEditRequestId) {
    try {
      await dependencies.failImageEditRequest(
        context.imageEditRequestId,
        failureCode,
      );
    } catch {
      logSafe(dependencies, "image_edit_request_failure_update_failed", context, "internal_failure");
    }
  }

  throw new ImageEditOrchestrationError(
    errorCode ??
      (failureCode === "invalid_request"
        ? "invalid_request"
        : failureCode === "source_not_found"
          ? "source_not_found"
          : failureCode === "source_forbidden"
            ? "source_forbidden"
            : failureCode === "provider_configuration"
              ? "provider_configuration"
              : failureCode === "provider_timeout"
                ? "provider_timeout"
                : failureCode === "provider_failure"
                  ? "provider_failure"
                  : failureCode === "invalid_provider_output"
                    ? "invalid_provider_output"
                    : failureCode === "storage_failure"
                      ? "storage_failure"
                      : failureCode === "persistence_failure"
                        ? "persistence_failure"
                        : failureCode === "attempt_start_failed"
                          ? "attempt_start_failed"
                          : "internal_failure"),
  );
}

async function failClaimedRequest(
  dependencies: ImageEditOrchestratorDependencies,
  claim: ImageEditClaim,
  code: ImageEditFailureCode,
  errorCode?: ImageEditOrchestrationErrorCode,
): Promise<never> {
  return compensate(
    dependencies,
    {
      imageEditRequestId: claim.imageEditRequestId,
      attemptId: null,
      storagePath: null,
      provider: RUNWARE_IMAGE_EDIT_PROVIDER,
      model: RUNWARE_IMAGE_EDIT_MODEL,
    },
    code,
    "internal_failure",
    errorCode,
  );
}

function safePath(userId: string, conversationId: string): string {
  return `generated/${userId}/${conversationId}/${crypto.randomUUID()}.png`;
}

function isValidProviderResult(value: unknown): value is ImageGenerationResult {
  if (!isRecord(value)) return false;

  return (
    value.provider === RUNWARE_IMAGE_EDIT_PROVIDER &&
    value.model === RUNWARE_IMAGE_EDIT_MODEL &&
    value.mimeType === "image/png" &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength > 0
  );
}

function validateFinalizerResult(value: ImageEditFinalizerResult): ImageEditFinalizerResult {
  if (
    !isRecord(value) ||
    !isUuid(value.userMessageId) ||
    !isUuid(value.assistantMessageId) ||
    !isUuid(value.generatedImageId)
  ) {
    throw new ImageEditOrchestrationError("persistence_failure");
  }

  return {
    userMessageId: value.userMessageId.toLowerCase(),
    assistantMessageId: value.assistantMessageId.toLowerCase(),
    generatedImageId: value.generatedImageId.toLowerCase(),
  };
}

export async function orchestrateImageEdit(
  input: ImageEditOrchestratorInput,
  dependencies: ImageEditOrchestratorDependencies,
): Promise<ImageEditOrchestrationResult> {
  const normalized = normalizeInput(input);
  const fingerprint = createImageEditRequestFingerprint({
    conversationId: normalized.conversationId,
    sourceReference: normalized.sourceReference,
    instruction: normalized.instruction,
  });

  let rawClaim: ImageEditClaim;
  try {
    rawClaim = await dependencies.claimImageEditRequest({
      conversationId: normalized.conversationId,
      idempotencyKey: normalized.idempotencyKey,
      fingerprint,
    });
  } catch {
    throw new ImageEditOrchestrationError("internal_failure");
  }

  const claim = normalizeClaim(rawClaim);
  switch (claim.disposition) {
    case "in_progress":
      return {
        kind: "in_progress",
        disposition: "in_progress",
        status: "in_progress",
        conversationId: normalized.conversationId,
        imageEditRequestId: claim.imageEditRequestId,
      };
    case "completed":
      return completedResult(normalized, claim, "completed");
    case "conflict":
      return {
        kind: "conflict",
        disposition: "conflict",
        status: claim.status,
        conversationId: normalized.conversationId,
        imageEditRequestId: claim.imageEditRequestId,
      };
    case "claimed":
      break;
    default:
      throw new ImageEditOrchestrationError("internal_failure");
  }

  if (claim.staleAttemptId) {
    let staleResolution: StaleAttemptResolution;
    try {
      staleResolution = await dependencies.resolveStaleAttempt(claim.staleAttemptId);
    } catch {
      return failClaimedRequest(
        dependencies,
        claim,
        "internal_failure",
      );
    }

    if (
      !isStaleAttemptResolution(staleResolution) ||
      staleResolution.status !== "non_counting"
    ) {
      return failClaimedRequest(dependencies, claim, "internal_failure");
    }
  }

  let quotaAttempt: ImageEditQuotaAttempt;
  try {
    quotaAttempt = await dependencies.reserveImageQuota(normalized.conversationId);
  } catch (error) {
    const quotaError = error instanceof Error ? error.message : "";
    const isExhausted =
      quotaError === "IMAGE_DAILY_LIMIT_REACHED" ||
      quotaError === "IMAGE_MONTHLY_LIMIT_REACHED";
    return failClaimedRequest(
      dependencies,
      claim,
      "quota_reservation_failed",
      isExhausted ? "quota_exhausted" : "internal_failure",
    );
  }

  const attemptId = normalizeUuid(quotaAttempt.attemptId);
  if (!attemptId) {
    return compensate(
      dependencies,
      {
        imageEditRequestId: claim.imageEditRequestId,
        attemptId: null,
        storagePath: null,
        provider: RUNWARE_IMAGE_EDIT_PROVIDER,
        model: RUNWARE_IMAGE_EDIT_MODEL,
      },
      "quota_reservation_failed",
      "internal_failure",
    );
  }

  const compensationContext: CompensationContext = {
    imageEditRequestId: claim.imageEditRequestId,
    attemptId,
    storagePath: null,
    provider: RUNWARE_IMAGE_EDIT_PROVIDER,
    model: RUNWARE_IMAGE_EDIT_MODEL,
  };

  let bound: boolean;
  try {
    bound = await dependencies.bindImageEditRequestAttempt({
      imageEditRequestId: claim.imageEditRequestId,
      attemptId,
    });
  } catch {
    return compensate(
      dependencies,
      compensationContext,
      "persistence_failure",
      "persistence_failure",
    );
  }

  if (!bound) {
    return compensate(
      dependencies,
      compensationContext,
      "persistence_failure",
      "persistence_failure",
    );
  }

  let started: boolean;
  try {
    started = await dependencies.startImageGenerationAttempt({
      attemptId,
      provider: RUNWARE_IMAGE_EDIT_PROVIDER,
      model: RUNWARE_IMAGE_EDIT_MODEL,
    });
  } catch {
    return compensate(
      dependencies,
      compensationContext,
      "attempt_start_failed",
      "internal_failure",
    );
  }

  if (!started) {
    return compensate(
      dependencies,
      compensationContext,
      "attempt_start_failed",
      "internal_failure",
    );
  }

  const resolveSource = dependencies.resolveImageEditSource ?? resolveImageEditSource;
  let resolvedSource: ResolvedImageEditSource;
  try {
    resolvedSource = await resolveSource({
      conversationId: normalized.conversationId,
      sourceReference: normalized.sourceReference,
    });
  } catch (error) {
    if (error instanceof ImageEditSourceResolverError) {
      const mapped = mapResolverError(error);
      return compensate(
        dependencies,
        compensationContext,
        mapped.failureCode,
        mapped.releaseReason,
        mapped.errorCode,
      );
    }

    return compensate(
      dependencies,
      compensationContext,
      "internal_failure",
      "internal_failure",
    );
  }

  if (
    !isRecord(resolvedSource) ||
    resolvedSource.conversationId !== normalized.conversationId ||
    !isSameSourceReference(resolvedSource.sourceReference, normalized.sourceReference) ||
    !(resolvedSource.bytes instanceof Uint8Array) ||
    resolvedSource.bytes.byteLength === 0
  ) {
    return compensate(
      dependencies,
      compensationContext,
      "invalid_request",
      "request_aborted",
      "invalid_source",
    );
  }

  let dimensions: { width: number; height: number };
  try {
    dimensions = normalizeImageEditDimensions({
      width: resolvedSource.width,
      height: resolvedSource.height,
    });
  } catch {
    return compensate(
      dependencies,
      compensationContext,
      "invalid_request",
      "request_aborted",
    );
  }

  const provider = dependencies.imageEditingProvider ?? new RunwareImageEditProvider();
  let providerResult: ImageGenerationResult;
  try {
    providerResult = await provider.editImage({
      sourceImage: {
        bytes: new Uint8Array(resolvedSource.bytes),
        mimeType: resolvedSource.mimeType,
      },
      instruction: normalized.instruction,
      width: dimensions.width,
      height: dimensions.height,
      model: RUNWARE_IMAGE_EDIT_MODEL,
    });
  } catch (error) {
    if (error instanceof RunwareImageEditProviderError) {
      const mapped = mapProviderError(error);
      return compensate(
        dependencies,
        compensationContext,
        mapped.failureCode,
        mapped.releaseReason,
      );
    }

    return compensate(
      dependencies,
      compensationContext,
      "provider_failure",
      "provider_failure",
    );
  }

  if (!isValidProviderResult(providerResult)) {
    return compensate(
      dependencies,
      compensationContext,
      "invalid_provider_output",
      "invalid_provider_output",
    );
  }

  const storagePath = safePath(
    normalized.authenticatedUserId,
    normalized.conversationId,
  );
  const uploadContext: CompensationContext = {
    ...compensationContext,
    storagePath,
  };

  try {
    await dependencies.uploadDerivative({
      bucket: IMAGE_EDIT_STORAGE_BUCKET,
      storagePath,
      bytes: new Uint8Array(providerResult.bytes),
      mimeType: "image/png",
      cacheControl: IMAGE_EDIT_CACHE_CONTROL,
      upsert: false,
    });
  } catch {
    return compensate(
      dependencies,
      uploadContext,
      "storage_failure",
      "storage_failure",
    );
  }

  const sourceReference = normalized.sourceReference;
  let finalizerResult: ImageEditFinalizerResult;
  try {
    finalizerResult = validateFinalizerResult(
      await dependencies.finalizeImageEdit({
        imageEditRequestId: claim.imageEditRequestId,
        attemptId,
        conversationId: normalized.conversationId,
        sourceReference,
        instruction: normalized.instruction,
        storagePath,
        mimeType: "image/png",
        provider: RUNWARE_IMAGE_EDIT_PROVIDER,
        model: RUNWARE_IMAGE_EDIT_MODEL,
        sourceGeneratedImageId:
          sourceReference.kind === "generated_image"
            ? sourceReference.generatedImageId
            : null,
        sourceUploadedMessageId:
          sourceReference.kind === "uploaded_image" ? sourceReference.messageId : null,
        sourceUploadedOrdinal:
          sourceReference.kind === "uploaded_image" ? sourceReference.ordinal : null,
      }),
    );
  } catch {
    return compensate(
      dependencies,
      uploadContext,
      "persistence_failure",
      "persistence_failure",
    );
  }

  return {
    kind: "completed",
    disposition: "claimed",
    status: "completed",
    conversationId: normalized.conversationId,
    imageEditRequestId: claim.imageEditRequestId,
    userMessageId: finalizerResult.userMessageId,
    assistantMessageId: finalizerResult.assistantMessageId,
    generatedImageId: finalizerResult.generatedImageId,
  };
}
