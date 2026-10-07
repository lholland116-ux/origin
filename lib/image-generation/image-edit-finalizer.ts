import type { Database } from "../database.types";
import {
  createImageEditRequestFingerprint,
  createImageEditRequestFingerprintForExistingMessages,
  type ImageEditFinalizerInput,
  type ImageEditFinalizerResult,
} from "./image-edit-orchestrator";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type ImageEditFinalizerRpcClient = Readonly<{
  rpc: (
    functionName:
      | "complete_generated_image_edit"
      | "complete_generated_image_edit_for_existing_messages",
    args:
      | Database["public"]["Functions"]["complete_generated_image_edit"]["Args"]
      | Database["public"]["Functions"]["complete_generated_image_edit_for_existing_messages"]["Args"],
  ) => Promise<RpcResult>;
}>;

export class ImageEditFinalizerError extends Error {
  readonly code = "persistence_failure" as const;

  constructor() {
    super("The image edit could not be saved.");
    this.name = "ImageEditFinalizerError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseResult(data: unknown): ImageEditFinalizerResult {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new ImageEditFinalizerError();
  }

  const row = data[0];
  if (
    !isUuid(row.user_message_id) ||
    !isUuid(row.assistant_message_id) ||
    !isUuid(row.generated_image_id)
  ) {
    throw new ImageEditFinalizerError();
  }

  return {
    userMessageId: row.user_message_id.toLowerCase(),
    assistantMessageId: row.assistant_message_id.toLowerCase(),
    generatedImageId: row.generated_image_id.toLowerCase(),
  };
}

export function createImageEditFinalizer(
  client: ImageEditFinalizerRpcClient,
  authenticatedUserId: string,
): (
  input: ImageEditFinalizerInput,
) => Promise<ImageEditFinalizerResult> {
  if (!isUuid(authenticatedUserId)) {
    throw new ImageEditFinalizerError();
  }

  return async (input) => {
    const requestFingerprint = createImageEditRequestFingerprint({
      conversationId: input.conversationId,
      sourceReference: input.sourceReference,
      instruction: input.instruction,
    });

    const isGeneratedSource = input.sourceReference.kind === "generated_image";
    const sourceGeneratedImageId = isGeneratedSource
      ? input.sourceReference.generatedImageId
      : null;
    const sourceUploadedMessageId = isGeneratedSource
      ? null
      : input.sourceReference.messageId;
    const sourceUploadedOrdinal = isGeneratedSource
      ? null
      : input.sourceReference.ordinal;

    let result: RpcResult;
    try {
      result = await client.rpc("complete_generated_image_edit", {
        p_authenticated_user_id: authenticatedUserId,
        p_image_edit_request_id: input.imageEditRequestId,
        p_request_fingerprint: requestFingerprint,
        p_attempt_id: input.attemptId,
        p_conversation_id: input.conversationId,
        p_instruction: input.instruction,
        p_storage_path: input.storagePath,
        p_mime_type: input.mimeType,
        p_provider: input.provider,
        p_model: input.model,
        p_source_generated_image_id: sourceGeneratedImageId,
        p_source_uploaded_message_id: sourceUploadedMessageId,
        p_source_uploaded_ordinal: sourceUploadedOrdinal,
      });
    } catch {
      throw new ImageEditFinalizerError();
    }

    if (!result || result.error) {
      throw new ImageEditFinalizerError();
    }

    return parseResult(result.data);
  };
}

export function createImageEditFinalizerForExistingMessages(
  client: ImageEditFinalizerRpcClient,
  authenticatedUserId: string,
  messageTarget: Readonly<{ userMessageId: string; assistantMessageId: string }>,
): (input: ImageEditFinalizerInput) => Promise<ImageEditFinalizerResult> {
  if (
    !isUuid(authenticatedUserId) ||
    !isUuid(messageTarget.userMessageId) ||
    !isUuid(messageTarget.assistantMessageId) ||
    messageTarget.userMessageId.toLowerCase() === messageTarget.assistantMessageId.toLowerCase()
  ) {
    throw new ImageEditFinalizerError();
  }

  const userMessageId = messageTarget.userMessageId.toLowerCase();
  const assistantMessageId = messageTarget.assistantMessageId.toLowerCase();

  return async (input) => {
    const requestFingerprint = createImageEditRequestFingerprintForExistingMessages({
      conversationId: input.conversationId,
      sourceReference: input.sourceReference,
      instruction: input.instruction,
      userMessageId,
      assistantMessageId,
    });
    const isGeneratedSource = input.sourceReference.kind === "generated_image";
    const args: Database["public"]["Functions"]["complete_generated_image_edit_for_existing_messages"]["Args"] = {
      p_authenticated_user_id: authenticatedUserId,
      p_image_edit_request_id: input.imageEditRequestId,
      p_request_fingerprint: requestFingerprint,
      p_attempt_id: input.attemptId,
      p_conversation_id: input.conversationId,
      p_user_message_id: userMessageId,
      p_assistant_message_id: assistantMessageId,
      p_instruction: input.instruction,
      p_storage_path: input.storagePath,
      p_mime_type: input.mimeType,
      p_provider: input.provider,
      p_model: input.model,
      p_source_generated_image_id: isGeneratedSource
        ? input.sourceReference.generatedImageId
        : null,
      p_source_uploaded_message_id: isGeneratedSource
        ? null
        : input.sourceReference.messageId,
      p_source_uploaded_ordinal: isGeneratedSource
        ? null
        : input.sourceReference.ordinal,
    };

    let result: RpcResult;
    try {
      result = await client.rpc("complete_generated_image_edit_for_existing_messages", args);
    } catch {
      throw new ImageEditFinalizerError();
    }

    if (!result || result.error) throw new ImageEditFinalizerError();
    const parsed = parseResult(result.data);
    if (parsed.userMessageId !== userMessageId || parsed.assistantMessageId !== assistantMessageId) {
      throw new ImageEditFinalizerError();
    }
    return parsed;
  };
}
