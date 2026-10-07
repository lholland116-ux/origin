import { randomUUID } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { GENERAL_CHAT_MODEL } from "@/lib/ai/general-chat-config";
import {
  selectReasoningEffort,
} from "@/lib/ai/reasoning-effort";
import {
  parseUserReasoningMode,
  resolveProviderReasoningEffort,
} from "@/lib/ai/reasoning-mode";
import {
  type AiRequestTelemetryRecord,
  type AiTelemetryOutcome,
} from "@/lib/ai/request-telemetry";
import { writeAiRequestTelemetry } from "@/lib/ai/request-telemetry-writer";
import { buildConversationTitle } from "@/lib/utils";
import {
  buildDocumentContext,
} from "@/lib/documents/prepare-context";
import { DocumentContextLimitError } from "@/lib/documents/context-limits";
import { formatMaxDocumentCount, getDocumentLimits } from "@/lib/documents/config";
import {
  assertStoredImageCount,
  ChatImageValidationError,
  normalizeChatImageInput,
  type NormalizedChatImageInput,
  type StoredImageReference,
} from "@/lib/chat/chat-image-attachments";
import { generateTemplateOutput } from "@/lib/documents/generation";
import { resolveAccountPlan, type AccountPlanResolution } from "@/lib/capabilities/account-plan";
import {
  reserveDailyUsage,
  resolveDailyUsageLimits,
} from "@/lib/capabilities/daily-usage";
import { DocumentGenerationIntentValidationError, resolveDocumentGenerationIntent } from "@/lib/documents/generation/intent";
import { DocumentGenerationValidationError } from "@/lib/documents/generation/validation";
import { TemplateValidationError } from "@/lib/documents/generation/templates/types";
import {
  FileContextPreparationError,
  MAX_FILE_CONTEXT_DOCUMENTS,
  prepareFileContext,
} from "@/lib/ai/file-context-service";
import {
  downloadGeneratedDocument,
  findGeneratedDocumentByRequest,
} from "@/lib/documents/generated-document-server";
import {
  GeneratedDocumentPersistenceError,
  persistGeneratedDocument,
} from "@/lib/ai/generated-document-persistence-service";
import { createStandardOperationService } from "@/lib/ai/standard-operation-service";
import {
  requestTransactionContextSchema,
  type FileContextResult,
} from "@/lib/agent-runtime/application-contracts";

const DAILY_USAGE_LIMITS = resolveDailyUsageLimits();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_IMAGE_BASE64_LENGTH = 8_000_000;
const MIN_IMAGE_BASE64_LENGTH = 1_000;
const MAX_IMAGE_PATH_LENGTH = 500;
const MAX_IMAGE_NAME_LENGTH = 255;
const MODEL_IMAGE_URL_TTL_SECONDS = 5 * 60;
const IS_DEV = process.env.NODE_ENV === "development";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TITLE_INSTRUCTIONS = `
Generate a short conversation title based ONLY on the user's request.

Requirements:
- 3 to 6 words.
- Do not use quotes.
- Do not use emojis.
- Do not write the assistant's response.
- Do not refer to yourself.
- Do not use first-person language such as "I", "I'm", "My", or "Me".
- Describe the user's topic or question.
- Keep the title clear, concise, and natural.

Examples:

User:
"What is your name?"
Title:
Assistant Name

User:
"How do I start an LLC in Georgia?"
Title:
Georgia LLC Formation

User:
"Today's weather in Atlanta"
Title:
Atlanta Weather

User:
"Write a business plan"
Title:
Business Plan

User:
"How do I fix my laptop?"
Title:
Laptop Troubleshooting
`.trim();

type Plan = "free" | "pro";

type ProfileRow = {
  plan: Plan | string | null;
};

export type StandardChatServiceDependencies = Readonly<{
  createSupabaseClient: typeof createServerSupabaseClient;
  provider: typeof openai;
  writeTelemetry: typeof writeAiRequestTelemetry;
}>;

const defaultDependencies: StandardChatServiceDependencies = {
  createSupabaseClient: createServerSupabaseClient,
  provider: openai,
  writeTelemetry: writeAiRequestTelemetry,
};

export type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  regenerate?: boolean;
  imageBase64?: string;
  imagePath?: string;
  imageName?: string;
  images?: unknown;
  documentIds?: string[];
  generationRequestId?: string;
  reasoningMode?: unknown;
};

type DbMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ConversationRow = {
  id: string;
  user_id: string;
  title: string;
};

type StoredDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: "uploading" | "processing" | "ready" | "failed";
  extraction_error?: string | null;
  conversation_id: string | null;
};

export type StandardChatEvent = Readonly<{ type: "text_delta"; text: string }>;

export type StandardChatServiceResult =
  | Readonly<{ kind: "json"; status: number; body: Record<string, unknown> }>
  | Readonly<{
      kind: "document";
      status: 200;
      bytes: Uint8Array;
      filename: string;
      mimeType: string;
      format: string;
      generatedDocumentId?: string;
      messageId?: string;
    }>
  | Readonly<{
      kind: "stream";
      events: AsyncIterable<StandardChatEvent>;
      headers: Readonly<{ userMessageId?: string }>;
      onCancel: (reason: unknown) => Promise<void>;
    }>;

function jsonResponse(body: Record<string, unknown>, status = 200): StandardChatServiceResult {
  return { kind: "json", status, body };
}

function generatedDocumentResponse(
  artifact: { readonly bytes: Uint8Array; readonly filename: string; readonly mimeType: string; readonly format: string },
  ids: { readonly generatedDocumentId?: string; readonly messageId?: string } = {},
): StandardChatServiceResult {
  return {
    kind: "document",
    status: 200,
    bytes: artifact.bytes,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    format: artifact.format,
    ...ids,
  };
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeDocumentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const ids = input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(ids)).slice(0, MAX_FILE_CONTEXT_DOCUMENTS);
}

function sanitizeTitle(title: string, fallback: string): string {
  const cleaned = title.replace(/^["']|["']$/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback;
}

function isLikelyDataUrlImage(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function isLikelyStoragePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.includes("..");
}

function buildStoredUserContent(params: {
  message: string;
  hasImage: boolean;
  imageCount?: number;
  documents: StoredDocument[];
}): string {
  const parts: string[] = [];

  if (params.message) {
    parts.push(params.message);
  }

  const attachmentNotes: string[] = [];

  if (params.hasImage) {
    attachmentNotes.push(params.imageCount && params.imageCount > 1 ? "[Images attached]" : "[Image attached]");
  }

  if (params.documents.length > 0) {
    const names = params.documents.map((doc) => doc.file_name).join(", ");
    attachmentNotes.push(`[Documents attached: ${names}]`);
  }

  if (attachmentNotes.length > 0) {
    parts.push(attachmentNotes.join("\n"));
  }

  return parts.join("\n\n").trim();
}

async function generateConversationTitle(message: string, provider: typeof openai): Promise<string> {
  try {
    const titleResponse = await provider.responses.create({
      model: GENERAL_CHAT_MODEL,
      instructions: TITLE_INSTRUCTIONS,
      input: message,
      store: false,
    } as never);

    return sanitizeTitle(
      titleResponse.output_text?.trim() ?? "",
      buildConversationTitle(message)
    );
  } catch {
    return buildConversationTitle(message);
  }
}

async function getAccountPlan(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
}): Promise<AccountPlanResolution> {
  const { supabase, userId } = params;
  return resolveAccountPlan({
    userId,
    lookup: async (id) => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", id)
        .maybeSingle<ProfileRow>();
      return { plan: profile?.plan ?? null, error };
    },
  });
}

function accountPlanFailureResponse(
  resolution: Exclude<AccountPlanResolution, { readonly kind: "resolved" }>,
) {
  if (resolution.kind === "invalid_account") {
    return jsonResponse(
      { error: "The account plan is invalid.", code: "INVALID_ACCOUNT_STATE" },
      503,
    );
  }

  return jsonResponse(
    { error: "Unable to verify the account plan. Please try again.", code: "ACCOUNT_STATE_UNAVAILABLE" },
    503,
  );
}

function dailyUsageFailureResponse(
  result: Exclude<Awaited<ReturnType<typeof reserveDailyUsage>>, { readonly kind: "reserved" | "limit_reached" }>,
) {
  if (result.kind === "account_unavailable") {
    return jsonResponse(
      { error: "Unable to verify the account plan. Please try again.", code: "ACCOUNT_STATE_UNAVAILABLE" },
      503,
    );
  }

  return jsonResponse(
    { error: "Daily usage is temporarily unavailable. Please try again.", code: "USAGE_UNAVAILABLE" },
    500,
  );
}

async function resolveStoredImageUrls(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  images: StoredImageReference[];
}): Promise<
  | { ok: true; urls: string[] }
  | { ok: false; status: 404 | 503 }
> {
  const { supabase, images } = params;

  const resolved = await Promise.all(
    images.map(async (image) => {
      const { data, error } = await supabase.storage
        .from("chat-images")
        .createSignedUrl(image.imagePath, MODEL_IMAGE_URL_TTL_SECONDS);

      if (error || !data?.signedUrl) {
        console.error("Stored image URL resolution error:", error);
        return {
          ok: false as const,
          status: error?.statusCode === "404" ? (404 as const) : (503 as const),
        };
      }

      return { ok: true as const, url: data.signedUrl };
    })
  );

  const failure = resolved.find((item) => !item.ok);

  if (failure && !failure.ok) {
    return failure;
  }

  return {
    ok: true,
    urls: resolved.flatMap((item) => (item.ok ? [item.url] : [])),
  };
}

async function loadDocumentArtifacts(params: {
  userId: string;
  conversationId: string;
  documentIds: string[];
}) {
  if (params.documentIds.length === 0) {
    return {
      persistedDocuments: [] as StoredDocument[],
      documentContext: "",
      fileContext: undefined as FileContextResult | undefined,
    };
  }

  const fileContext = await prepareFileContext(params);

  const persistedDocuments: StoredDocument[] = fileContext.documents.map((document) => ({
    id: document.documentId,
    file_name: document.fileName,
    mime_type: document.mimeType,
    size_bytes: document.sizeBytes,
    extraction_status: "ready",
    extraction_error: null,
    conversation_id: fileContext.conversationId,
  }));

  const documentContext = buildDocumentContext(
    fileContext.documents.map((document) => ({
      id: document.documentId,
      file_name: document.fileName,
      extracted_text: document.extractedText,
      extraction_status: "ready" as const,
    }))
  );

  return {
    persistedDocuments,
    documentContext,
    fileContext,
  };
}

async function persistAssistantMessage(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  conversationId: string;
  userId: string;
  content: string;
}) {
  const { supabase, conversationId, userId, content } = params;

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content,
    documents: [],
  });

  if (error) {
    console.error("Assistant message insert error:", error);
  }
}

async function persistUserMessageWithImages(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  conversationId: string;
  content: string;
  documents: StoredDocument[];
  images: StoredImageReference[];
}) {
  const { supabase, conversationId, content, documents, images } = params;

  return supabase.rpc("create_chat_message_with_images", {
    p_conversation_id: conversationId,
    p_content: content,
    p_documents: documents,
    p_images: images.map((image) => ({
      storage_path: image.imagePath,
      image_name: image.imageName,
    })),
  });
}

function imageRpcErrorCode(error: { code?: string; message?: string }): string {
  const message = error.message ?? "";
  const knownCodes = [
    "CONVERSATION_NOT_FOUND",
    "DUPLICATE_IMAGE",
    "IMAGE_LIMIT_EXCEEDED",
    "INVALID_IMAGE",
    "PLAN_UNAVAILABLE",
    "UNAUTHORIZED",
  ];

  return knownCodes.find((code) => message.includes(code)) ?? "";
}

async function touchConversation(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  conversationId: string;
  userId: string;
  title?: string;
}) {
  const { supabase, conversationId, userId, title } = params;

  const updates: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };

  if (title) {
    updates.title = title;
  }

  const { error } = await supabase
    .from("conversations")
    .update(updates)
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) {
    console.error("Conversation update error:", error);
  }
}

async function executeStandardChatService(input: {
  readonly userId: string;
  readonly body: ChatRequestBody;
}, dependencies: StandardChatServiceDependencies): Promise<StandardChatServiceResult> {
  const supabase = await dependencies.createSupabaseClient();
  const userId = input.userId;
  const body = input.body;

  try {
    const parsedReasoningMode = parseUserReasoningMode(body);
    if (parsedReasoningMode.kind === "invalid") {
      return jsonResponse(
        {
          error: "reasoningMode must be one of: instant, medium, high.",
          code: "INVALID_REASONING_MODE",
        },
        400,
      );
    }

    const conversationId = normalizeString(body.conversationId);
    const message = normalizeString(body.message);
    const regenerate = Boolean(body.regenerate);
    const imageBase64 = normalizeString(body.imageBase64);
    const imagePath = normalizeString(body.imagePath);
    const imageName = normalizeString(body.imageName);
    const documentIds = normalizeDocumentIds(body.documentIds);
    const generationRequestId = normalizeString(body.generationRequestId);

    if (generationRequestId && !isValidUuid(generationRequestId)) {
      return jsonResponse({ error: "generationRequestId is invalid." }, 400);
    }

    let normalizedImageInput: NormalizedChatImageInput;

    try {
      normalizedImageInput = normalizeChatImageInput({
        images: body.images,
        imageBase64,
        imagePath,
        imageName,
        userId,
      });
    } catch (error) {
      if (error instanceof ChatImageValidationError) {
        return jsonResponse({ error: error.message, code: error.code }, 400);
      }

      return jsonResponse({ error: "Invalid image attachments.", code: "INVALID_IMAGES" }, 400);
    }

    const storedImages =
      normalizedImageInput.source === "stored" ? normalizedImageInput.images : [];
    const hasStoredImages = storedImages.length > 0;

    if (regenerate && hasStoredImages) {
      return jsonResponse(
        {
          error: "Stored image attachments are not supported during regeneration.",
          code: "REGENERATE_IMAGES_NOT_SUPPORTED",
        },
        400
      );
    }

    if (!conversationId) {
      return jsonResponse({ error: "conversationId is required." }, 400);
    }

    if (
      !regenerate &&
      !message &&
      !imageBase64 &&
      !hasStoredImages &&
      documentIds.length === 0
    ) {
      return jsonResponse(
        {
          error:
            "message, imageBase64, or documentIds is required unless regenerate is true.",
        },
        400
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return jsonResponse(
        { error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters.` },
        400
      );
    }

    if (imageBase64) {
      if (!isLikelyDataUrlImage(imageBase64)) {
        return jsonResponse(
          { error: "imageBase64 must be a valid base64 image data URL." },
          400
        );
      }

      if (imageBase64.length < MIN_IMAGE_BASE64_LENGTH) {
        return jsonResponse({ error: "Invalid or corrupted image." }, 400);
      }

      if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
        return jsonResponse({ error: "Attached image is too large." }, 400);
      }
    }

    if (imagePath) {
      if (!isLikelyStoragePath(imagePath)) {
        return jsonResponse({ error: "Invalid imagePath." }, 400);
      }

      if (imagePath.length > MAX_IMAGE_PATH_LENGTH) {
        return jsonResponse({ error: "imagePath is too long." }, 400);
      }
    }

    if (imageName && imageName.length > MAX_IMAGE_NAME_LENGTH) {
      return jsonResponse({ error: "imageName is too long." }, 400);
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, user_id, title")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single<ConversationRow>();

    if (conversationError || !conversation) {
      return jsonResponse({ error: "Conversation not found." }, 404);
    }

    const accountPlan = await getAccountPlan({ supabase, userId });
    if (accountPlan.kind !== "resolved") {
      if (hasStoredImages && accountPlan.kind !== "invalid_account") {
        return jsonResponse(
          { error: "Unable to verify image attachment eligibility.", code: "PLAN_UNAVAILABLE" },
          503,
        );
      }
      return accountPlanFailureResponse(accountPlan);
    }

    const plan = accountPlan.plan;
    let storedImageUrls: string[] = [];
    let persistedUserMessageId: string | null = null;

    if (hasStoredImages) {
      try {
        assertStoredImageCount(storedImages, plan);
      } catch (error) {
        if (error instanceof ChatImageValidationError && error.code === "IMAGE_LIMIT_EXCEEDED") {
          return jsonResponse(
            { error: "Image attachment limit exceeded.", code: "IMAGE_LIMIT_EXCEEDED" },
            403
          );
        }

        return jsonResponse({ error: "Invalid image attachments.", code: "INVALID_IMAGES" }, 400);
      }

      const resolvedImages = await resolveStoredImageUrls({
        supabase,
        images: storedImages,
      });

      if (!resolvedImages.ok) {
        return jsonResponse(
          {
            error: "One or more image attachments are unavailable.",
            code: "IMAGE_UNAVAILABLE",
          },
          resolvedImages.status
        );
      }

      storedImageUrls = resolvedImages.urls;
    }

    let adaptiveMessage = message;
    if (parsedReasoningMode.kind === "absent" && regenerate) {
      const { data: regenerationHistory, error: regenerationHistoryError } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (regenerationHistoryError || !regenerationHistory) {
        console.error("Regeneration reasoning history lookup error:", regenerationHistoryError);
        return jsonResponse({ error: "Failed to prepare regeneration." }, 500);
      }

      const latestUserMessage = [...(regenerationHistory as DbMessage[])]
        .reverse()
        .find((historyMessage) => historyMessage.role === "user")?.content;
      adaptiveMessage = latestUserMessage ?? "";
    }

    const adaptiveEffort = parsedReasoningMode.kind === "absent"
      ? selectReasoningEffort({
          route: "standard",
          message: adaptiveMessage,
          hasDocuments: documentIds.length > 0,
          hasImages: Boolean(imageBase64) || hasStoredImages,
        })
      : undefined;
    const reasoningResolution = resolveProviderReasoningEffort({
      parsedMode: parsedReasoningMode,
      plan,
      adaptiveEffort,
    });
    if (!reasoningResolution.ok) {
      return jsonResponse(
        {
          error: "High reasoning is available with Pro.",
          code: reasoningResolution.code,
        },
        403,
      );
    }
    const reasoningEffort = reasoningResolution.effort;

    if (generationRequestId) {
      try {
        const existing = await findGeneratedDocumentByRequest({
          userId,
          conversationId,
          generationRequestId,
        });

        if (existing) {
          const bytes = await downloadGeneratedDocument(existing);
          return generatedDocumentResponse(
            {
              bytes,
              filename: existing.filename,
              mimeType: existing.mimeType,
              format: existing.format,
            },
            {
              generatedDocumentId: existing.id,
              messageId: existing.messageId,
            },
          );
        }
      } catch (error) {
        console.error("Existing generated document lookup failed:", {
          reason: error instanceof Error ? error.message : "unknown",
        });
        return jsonResponse({ error: "The generated document could not be retrieved." }, 500);
      }
    }

    const dailyLimit = DAILY_USAGE_LIMITS[plan];
    const documentLimits = getDocumentLimits(plan);

    if (documentIds.length > documentLimits.maxFilesPerMessage) {
      return jsonResponse(
        {
          error: `You can upload up to ${formatMaxDocumentCount(documentLimits.maxFilesPerMessage)} per message.`,
          code: "DOCUMENT_LIMIT_EXCEEDED",
          plan,
        },
        400,
      );
    }

    const usageReservation = await reserveDailyUsage({
      client: supabase,
      userId,
      account: accountPlan,
      limits: DAILY_USAGE_LIMITS,
      enforceLimit: !IS_DEV,
    });

    if (usageReservation.kind === "limit_reached") {
      return jsonResponse(
        {
          error:
            plan === "pro"
              ? "Daily Pro message limit reached. Please try again tomorrow."
              : "Daily free message limit reached. Upgrade to Pro to continue.",
          code: "LIMIT_REACHED",
          plan,
          limit: dailyLimit,
        },
        403
      );
    }

    if (usageReservation.kind !== "reserved") {
      return dailyUsageFailureResponse(usageReservation);
    }

    let persistedDocuments: StoredDocument[] = [];
    let documentContext = "";
    let fileContext: FileContextResult | undefined;

    try {
      const artifacts = await loadDocumentArtifacts({
        userId,
        conversationId,
        documentIds,
      });

      persistedDocuments = artifacts.persistedDocuments;
      documentContext = artifacts.documentContext;
      fileContext = artifacts.fileContext;
    } catch (error) {
      console.error("Document context load error:", error);
      if (error instanceof DocumentContextLimitError
        || (error instanceof FileContextPreparationError && error.code === "context_too_large")) {
        return jsonResponse({ error: error.message, code: "DOCUMENT_CONTEXT_TOO_LARGE" }, 413);
      }
      return jsonResponse({ error: "Failed to load document context." }, 500);
    }

    if (regenerate) {
      const { data: lastAssistant, error: lastAssistantError } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastAssistantError) {
        console.error("Last assistant lookup error:", lastAssistantError);
        return jsonResponse({ error: "Failed to prepare regeneration." }, 500);
      }

      if (lastAssistant?.id) {
        const { error: deleteError } = await supabase
          .from("messages")
          .delete()
          .eq("id", lastAssistant.id)
          .eq("user_id", userId);

        if (deleteError) {
          console.error("Assistant delete error:", deleteError);
          return jsonResponse({ error: "Failed to prepare regeneration." }, 500);
        }
      }
    } else {
      const storedUserContent = buildStoredUserContent({
        message,
        hasImage: Boolean(imageBase64) || hasStoredImages,
        imageCount: hasStoredImages ? storedImages.length : undefined,
        documents: persistedDocuments,
      });

      const userMessageResult = hasStoredImages
        ? await persistUserMessageWithImages({
            supabase,
            conversationId,
            content: storedUserContent,
            documents: persistedDocuments,
            images: storedImages,
          })
        : await supabase.from("messages").insert({
            conversation_id: conversationId,
            user_id: userId,
            role: "user",
            content: storedUserContent,
            image_path: imagePath || null,
            image_name: imageName || null,
            documents: persistedDocuments,
          });

      const insertUserError = userMessageResult.error;

      if (insertUserError) {
        console.error("User message insert error:", insertUserError);

        if (hasStoredImages) {
          const rpcCode = imageRpcErrorCode(insertUserError);

          if (rpcCode === "UNAUTHORIZED") {
            return jsonResponse({ error: "Unauthorized.", code: rpcCode }, 401);
          }

          if (rpcCode === "CONVERSATION_NOT_FOUND") {
            return jsonResponse({ error: "Conversation not found.", code: rpcCode }, 404);
          }

          if (rpcCode === "PLAN_UNAVAILABLE") {
            return jsonResponse(
              { error: "Unable to verify image attachment eligibility.", code: rpcCode },
              503
            );
          }

          if (rpcCode === "IMAGE_LIMIT_EXCEEDED") {
            return jsonResponse(
              { error: "Image attachment limit exceeded.", code: rpcCode },
              403
            );
          }

          if (rpcCode === "DUPLICATE_IMAGE" || rpcCode === "INVALID_IMAGE") {
            return jsonResponse(
              { error: "Invalid image attachments.", code: rpcCode },
              400
            );
          }

          return jsonResponse(
            {
              error: "Failed to save image attachments.",
              code: "IMAGE_PERSISTENCE_UNAVAILABLE",
            },
            503
          );
        }

        return jsonResponse({ error: "Failed to save user message." }, 500);
      }

      if (hasStoredImages && typeof userMessageResult.data === "string") {
        persistedUserMessageId = userMessageResult.data;
      }
    }

    const { data: history, error: historyError } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (historyError || !history) {
      console.error("History load error:", historyError);
      return jsonResponse(
        { error: "Failed to load conversation history." },
        500
      );
    }

    const recentHistory = (history as DbMessage[]).slice(-MAX_HISTORY_MESSAGES);

    if (recentHistory.length === 0) {
      return jsonResponse({ error: "Conversation history is empty." }, 400);
    }

    const latestUserMessage = regenerate
      ? recentHistory[recentHistory.length - 1]?.content ?? ""
      : message || recentHistory[recentHistory.length - 1]?.content || "";
    const requestContext = requestTransactionContextSchema.parse({
      requestId: randomUUID(),
      userId,
      conversationId,
      userMessageId: (() => {
        const id = [...recentHistory].reverse().find((historyMessage) => historyMessage.role === "user")?.id;
        return id && isValidUuid(id) ? id : null;
      })(),
    });

    let documentIntent: Awaited<ReturnType<typeof resolveDocumentGenerationIntent>>;
    try {
      documentIntent = await resolveDocumentGenerationIntent({
        latestMessage: latestUserMessage,
        history: recentHistory,
        documentContext,
      });
    } catch (error) {
      if (error instanceof DocumentGenerationIntentValidationError) {
        console.error("/api/chat document intent validation error:", { issues: error.issues });
        return jsonResponse({ error: "The requested document could not be generated." }, 400);
      }
      throw error;
    }

    if (documentIntent) {
      const effectiveGenerationRequestId = generationRequestId || randomUUID();

      try {
        const artifact = await generateTemplateOutput({
          templateId: documentIntent.templateId,
          formats: documentIntent.formats,
          variables: documentIntent.variables,
          packageAsZip: documentIntent.packageAsZip,
        });
        const persisted = await persistGeneratedDocument({
          userId,
          conversationId,
          generationRequestId: effectiveGenerationRequestId,
          templateId: documentIntent.templateId,
          generatedOutput: artifact,
          assistantMessageContent: "I created " + artifact.filename + ". Use the download button below to save it.",
        });
        await touchConversation({ supabase, conversationId, userId });
        return generatedDocumentResponse(persisted.delivery, {
          generatedDocumentId: persisted.reference.artifactId,
          messageId: persisted.reference.messageId,
        });
      } catch (error) {
        if (error instanceof TemplateValidationError) {
          console.error("/api/chat document template validation error:", {
            issues: error.issues,
          });
          return jsonResponse({ error: "The requested document could not be generated." }, 400);
        }

        if (error instanceof GeneratedDocumentPersistenceError) {
          console.error("/api/chat document persistence error:", { code: error.code });
          return jsonResponse({ error: "The document could not be generated. Please try again." }, 500);
        }

        if (error instanceof DocumentGenerationValidationError) {
          console.error("/api/chat document generation validation error:", {
            issues: error.issues,
          });
          return jsonResponse({ error: "The requested document could not be generated." }, 400);
        }

        console.error("/api/chat document persistence error:", {
          reason: error instanceof Error ? error.message : "unknown",
        });
        return jsonResponse({ error: "The document could not be generated. Please try again." }, 500);
      }
    }

    const operation = createStandardOperationService({ provider: dependencies.provider });
    const operationInput = {
      requestContext,
      objective: latestUserMessage,
      reasoningEffort,
      history: recentHistory.map(({ role, content }) => ({ role, content })),
      ...(imageBase64 ? { imageDataUrl: imageBase64 } : {}),
      ...(storedImageUrls.length > 0 ? { imageUrls: storedImageUrls } : {}),
      ...(fileContext ? { fileContext } : {}),
    } as const;
    const telemetryWrites: Promise<unknown>[] = [];
    let primaryAttemptStartedAt: number | null = null;
    let primaryAttemptStarted = false;
    let primaryTelemetryRecorded = false;

    function scheduleTelemetry(params: {
      attemptKind: "primary" | "image_retry";
      model: string;
      outcome: AiTelemetryOutcome;
      latencyMs: number;
      hadImage: boolean;
      usage: {
        inputTokens: number | null;
        cachedInputTokens: number | null;
        outputTokens: number | null;
        reasoningTokens: number | null;
        totalTokens: number | null;
      };
    }): void {
      const record: AiRequestTelemetryRecord = {
        route: "standard",
        attemptKind: params.attemptKind,
        model: params.model,
        webSearchCalls: 0,
        reasoningEffort,
        plan,
        outcome: params.outcome,
        latencyMs: params.latencyMs,
        hadImage: params.hadImage,
        ...params.usage,
      };

      telemetryWrites.push(
        Promise.resolve()
          .then(() => dependencies.writeTelemetry(record))
          .catch(() => undefined),
      );
    }

    function schedulePrimaryTelemetry(outcome: AiTelemetryOutcome): void {
      if (
        !primaryAttemptStarted ||
        primaryAttemptStartedAt === null ||
        primaryTelemetryRecorded
      ) {
        return;
      }

      primaryTelemetryRecorded = true;
      scheduleTelemetry({
        attemptKind: "primary",
        model: GENERAL_CHAT_MODEL,
        outcome,
        latencyMs: Math.max(0, Math.round(performance.now() - primaryAttemptStartedAt)),
        hadImage: Boolean(imageBase64) || storedImageUrls.length > 0,
        usage: {
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          totalTokens: null,
        },
      });
    }

    let fullReply = "";

    const events = async function* (): AsyncGenerator<StandardChatEvent> {
      let streamCompleted = false;
      try {
          let completedReply: string | undefined;
          for await (const event of operation.run(operationInput)) {
            if (event.type === "attempt_started" && event.attemptKind === "primary") {
              primaryAttemptStarted = true;
              primaryAttemptStartedAt = event.startedAt;
            } else if (event.type === "measurement") {
              const { measurement } = event;
              scheduleTelemetry({ ...measurement });
              if (measurement.attemptKind === "primary") primaryTelemetryRecorded = true;
            } else if (event.type === "text_delta") {
              fullReply += event.text;
              yield { type: "text_delta", text: event.text };
            } else if (event.type === "completion") {
              completedReply = event.result.reply;
            }
          }

          const persistedReply = completedReply
            ?? "I couldn’t generate a complete response. Try again, upload a clearer image, or ask a more specific question.";

          await persistAssistantMessage({
            supabase,
            conversationId,
            userId,
            content: persistedReply,
          });

          const shouldGenerateTitle =
            !regenerate &&
            message &&
            (conversation.title === "New Chat" ||
              conversation.title === buildConversationTitle(message));

          const title = shouldGenerateTitle
            ? await generateConversationTitle(message, dependencies.provider)
            : undefined;

          await touchConversation({
            supabase,
            conversationId,
            userId,
            title,
          });

          await Promise.allSettled(telemetryWrites);
          streamCompleted = true;
      } catch (error) {
          schedulePrimaryTelemetry("api_error");
          console.error("/api/chat streaming error:", error instanceof Error ? error.name : "unknown");

          const fallback =
            fullReply.trim() ||
            "I'm sorry — something went wrong while generating the response.";

          if (!fullReply.trim()) {
            yield { type: "text_delta", text: fallback };
          }

          await persistAssistantMessage({
            supabase,
            conversationId,
            userId,
            content: fallback,
          });

          await touchConversation({
            supabase,
            conversationId,
            userId,
          });

          await Promise.allSettled(telemetryWrites);
      } finally {
        if (!streamCompleted) schedulePrimaryTelemetry("cancelled");
        await Promise.allSettled(telemetryWrites);
      }
    };

    return {
      kind: "stream",
      events: events(),
      headers: persistedUserMessageId ? { userMessageId: persistedUserMessageId } : {},
      onCancel: async (reason) => {
        console.warn("/api/chat stream cancelled:", reason);
        schedulePrimaryTelemetry("cancelled");
        await Promise.allSettled(telemetryWrites);
      },
    };
  } catch (error) {
    console.error("/api/chat error:", error);
    return jsonResponse({ error: "Something went wrong in /api/chat." }, 500);
  }
}

export function createStandardChatService(dependencies: StandardChatServiceDependencies) {
  return {
    run: (input: { readonly userId: string; readonly body: ChatRequestBody }) =>
      executeStandardChatService(input, dependencies),
  } as const;
}

export function runStandardChatService(input: {
  readonly userId: string;
  readonly body: ChatRequestBody;
}): Promise<StandardChatServiceResult> {
  return executeStandardChatService(input, defaultDependencies);
}
