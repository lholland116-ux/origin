import { createServerSupabaseClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { buildConversationTitle } from "@/lib/utils";
import {
  buildDocumentContext,
  DocumentContextLimitError,
} from "@/lib/documents/prepare-context";
import {
  assertStoredImageCount,
  buildImageInputContent,
  ChatImageValidationError,
  normalizeChatImageInput,
  type NormalizedChatImageInput,
  type StoredImageReference,
} from "@/lib/chat/chat-image-attachments";

export const runtime = "nodejs";

const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_MESSAGE_LIMIT ?? 20);
const PRO_DAILY_LIMIT = Number(process.env.PRO_DAILY_MESSAGE_LIMIT ?? 300);

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_IMAGE_BASE64_LENGTH = 8_000_000;
const MIN_IMAGE_BASE64_LENGTH = 1_000;
const MIN_ACCEPTABLE_REPLY_LENGTH = 10;
const MAX_IMAGE_PATH_LENGTH = 500;
const MAX_IMAGE_NAME_LENGTH = 255;
const MODEL_IMAGE_URL_TTL_SECONDS = 5 * 60;
const MAX_DOCUMENT_IDS = 10;
const IS_DEV = process.env.NODE_ENV === "development";

const MODEL = "gpt-5.6";

const TONE_LAYER = `
Tone and style requirements:
- Be warm, calm, friendly, and supportive.
- Sound approachable and human, not robotic or overly formal.
- Use clear, natural language with a soft, respectful tone.
- Be encouraging when helpful, especially if the user seems uncertain or frustrated.
- Stay professional and concise, but not cold.
- Avoid harsh phrasing, unnecessary jargon, or stiff corporate wording.
- When giving steps or instructions, make them feel easy and manageable.
- When you do not know something, say so clearly and kindly.
- Prioritize clarity, usefulness, and a positive user experience.
`.trim();

const MODEL_LAYER = `
Model behavior requirements:
- Do not claim to be GPT-4, GPT-5, GPT-5.3, or any other specific model version.
- Do not speculate about model availability.
- If asked what model powers LVTChat, respond:
  "LVTChat is powered by OpenAI technology. This application uses the OpenAI model configured for LVTChat."
- Focus on answering the user's question instead of discussing model versions.
`.trim();

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

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  regenerate?: boolean;
  imageBase64?: string;
  imagePath?: string;
  imageName?: string;
  images?: unknown;
  documentIds?: string[];
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

type PersistableDocumentRow = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: "ready";
  extraction_error: string | null;
  conversation_id: string | null;
};

type ResponsesStreamEvent = {
  type: string;
  delta?: string;
  error?: {
    message?: string;
  };
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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

  return Array.from(new Set(ids)).slice(0, MAX_DOCUMENT_IDS);
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

function getPlanLimit(plan: Plan): number {
  return plan === "pro" ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
}

function normalizePlan(plan: ProfileRow["plan"]): Plan {
  return plan === "pro" ? "pro" : "free";
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

function isWeakReply(reply: string): boolean {
  return reply.trim().length < MIN_ACCEPTABLE_REPLY_LENGTH;
}

function buildImageAnalysisInstruction(latestMessage: string): string {
  if (latestMessage.trim()) {
    return latestMessage;
  }

  return "Carefully analyze this image. Describe everything you can see in detail. If there is text, extract it clearly. If the image is unclear, explain what might be happening and note any uncertainty.";
}

function buildSystemInstructions(hasDocumentContext: boolean): string {
  const base = [SYSTEM_PROMPT.trim(), TONE_LAYER, MODEL_LAYER];

  if (hasDocumentContext) {
    base.push(
      "When document context is provided, use it as the primary source of truth.",
      "If the answer is not contained in the document context, say so clearly.",
      "Do not fabricate document details, quotations, findings, or conclusions.",
      "If multiple documents are provided, synthesize them carefully and mention disagreements or missing information when relevant."
    );
  }

  return base.join("\n\n");
}

function buildLatestUserContent(params: {
  latestMessage: string;
  imageBase64: string;
  imageUrls: string[];
  documentContext: string;
}) {
  const { latestMessage, imageBase64, imageUrls, documentContext } = params;
  const modelImageUrls = imageBase64 ? [imageBase64] : imageUrls;

  const effectiveText = modelImageUrls.length > 0
    ? buildImageAnalysisInstruction(latestMessage)
    : latestMessage;

  const userText = documentContext
    ? `${documentContext}\n\nUser question:\n${effectiveText}`
    : effectiveText;

  if (modelImageUrls.length > 0) {
    return buildImageInputContent(userText, modelImageUrls);
  }

  return userText;
}

function buildResponsesInput(params: {
  history: DbMessage[];
  latestMessage: string;
  imageBase64: string;
  imageUrls: string[];
  documentContext: string;
}) {
  const { history, latestMessage, imageBase64, imageUrls, documentContext } = params;

  const priorMessages = history.slice(0, -1).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const latestUserInput = {
    role: "user" as const,
    content: buildLatestUserContent({
      latestMessage,
      imageBase64,
      imageUrls,
      documentContext,
    }),
  };

  return [...priorMessages, latestUserInput];
}

async function createRetryResponse(params: {
  input: ReturnType<typeof buildResponsesInput>;
  hasDocumentContext: boolean;
}) {
  const { input, hasDocumentContext } = params;

  return openai.responses.create({
    model: MODEL,
    instructions: buildSystemInstructions(hasDocumentContext),
    input,
    store: false,
  } as never);
}

async function generateConversationTitle(message: string): Promise<string> {
  try {
    const titleResponse = await openai.responses.create({
      model: MODEL,
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

async function getUserPlan(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
}): Promise<Plan> {
  const { supabase, userId } = params;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single<ProfileRow>();

  if (error || !profile) {
    console.error("Profile lookup error:", error);
    return "free";
  }

  return normalizePlan(profile.plan);
}

async function getAuthoritativeUserPlan(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
}): Promise<Plan | null> {
  const { supabase, userId } = params;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error || !profile || (profile.plan !== "free" && profile.plan !== "pro")) {
    console.error("Authoritative profile lookup error:", error);
    return null;
  }

  return profile.plan;
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

async function loadPersistableDocuments(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  documentIds: string[];
}) {
  const { supabase, userId, documentIds } = params;

  if (documentIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, file_name, mime_type, size_bytes, extraction_status, extraction_error, conversation_id, extracted_text"
    )
    .eq("user_id", userId)
    .in("id", documentIds)
    .eq("extraction_status", "ready");

  if (error) {
    throw new Error(`Failed to load document context: ${error.message}`);
  }

  return (data ?? []) as (PersistableDocumentRow & {
    extracted_text: string | null;
  })[];
}

async function loadDocumentArtifacts(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  documentIds: string[];
}) {
  const rows = await loadPersistableDocuments(params);

  const persistedDocuments: StoredDocument[] = rows.map((row) => ({
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    extraction_status: "ready",
    extraction_error: row.extraction_error,
    conversation_id: row.conversation_id,
  }));

  const documentContext = buildDocumentContext(
    rows.map((row) => ({
      id: row.id,
      file_name: row.file_name,
      extracted_text: row.extracted_text,
      extraction_status: row.extraction_status,
    }))
  );

  return {
    persistedDocuments,
    documentContext,
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

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    let body: ChatRequestBody;

    try {
      body = (await req.json()) as ChatRequestBody;
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const conversationId = normalizeString(body.conversationId);
    const message = normalizeString(body.message);
    const regenerate = Boolean(body.regenerate);
    const imageBase64 = normalizeString(body.imageBase64);
    const imagePath = normalizeString(body.imagePath);
    const imageName = normalizeString(body.imageName);
    const documentIds = normalizeDocumentIds(body.documentIds);

    let normalizedImageInput: NormalizedChatImageInput;

    try {
      normalizedImageInput = normalizeChatImageInput({
        images: body.images,
        imageBase64,
        imagePath,
        imageName,
        userId: user.id,
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
      .eq("user_id", user.id)
      .single<ConversationRow>();

    if (conversationError || !conversation) {
      return jsonResponse({ error: "Conversation not found." }, 404);
    }

    let plan: Plan;
    let storedImageUrls: string[] = [];

    if (hasStoredImages) {
      const authoritativePlan = await getAuthoritativeUserPlan({
        supabase,
        userId: user.id,
      });

      if (!authoritativePlan) {
        return jsonResponse(
          { error: "Unable to verify image attachment eligibility.", code: "PLAN_UNAVAILABLE" },
          503
        );
      }

      plan = authoritativePlan;

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
    } else {
      plan = await getUserPlan({ supabase, userId: user.id });
    }

    const dailyLimit = getPlanLimit(plan);

    const today = new Date().toISOString().slice(0, 10);

    const { data: usageRow, error: usageError } = await supabase
      .from("usage")
      .select("message_count")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle();

    if (usageError) {
      console.error("Usage read error:", usageError);
      return jsonResponse({ error: "Failed to read usage." }, 500);
    }

    const currentCount = usageRow?.message_count ?? 0;

    if (!IS_DEV && currentCount >= dailyLimit) {
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

    const { error: usageWriteError } = await supabase.from("usage").upsert(
      {
        user_id: user.id,
        date: today,
        message_count: currentCount + 1,
      },
      { onConflict: "user_id,date" }
    );

    if (usageWriteError) {
      console.error("Usage write error:", usageWriteError);
      return jsonResponse({ error: "Failed to update usage." }, 500);
    }

    let persistedDocuments: StoredDocument[] = [];
    let documentContext = "";

    try {
      const artifacts = await loadDocumentArtifacts({
        supabase,
        userId: user.id,
        documentIds,
      });

      persistedDocuments = artifacts.persistedDocuments;
      documentContext = artifacts.documentContext;
    } catch (error) {
      console.error("Document context load error:", error);
      if (error instanceof DocumentContextLimitError) {
        return jsonResponse({ error: error.message, code: "DOCUMENT_CONTEXT_TOO_LARGE" }, 413);
      }
      return jsonResponse({ error: "Failed to load document context." }, 500);
    }

    if (regenerate) {
      const { data: lastAssistant, error: lastAssistantError } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
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
          .eq("user_id", user.id);

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
            user_id: user.id,
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
    }

    const { data: history, error: historyError } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
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

    const input = buildResponsesInput({
      history: recentHistory,
      latestMessage: latestUserMessage,
      imageBase64,
      imageUrls: storedImageUrls,
      documentContext,
    }) as never;

    const encoder = new TextEncoder();
    let fullReply = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const responseStream = (await openai.responses.stream({
            model: MODEL,
            instructions: buildSystemInstructions(Boolean(documentContext)),
            input,
            store: false,
          } as never)) as unknown as AsyncIterable<ResponsesStreamEvent>;

          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              const delta = event.delta ?? "";

              if (delta) {
                fullReply += delta;
                controller.enqueue(encoder.encode(delta));
              }
            }

            if (event.type === "response.failed") {
              throw new Error(
                event.error?.message ?? "OpenAI response failed."
              );
            }

            if (event.type === "error") {
              throw new Error(event.error?.message ?? "OpenAI stream error.");
            }

            if (event.type === "response.completed") {
              break;
            }
          }

          const streamedReply = fullReply.trim();
          let finalReply = streamedReply;

          if ((imageBase64 || storedImageUrls.length > 0) && isWeakReply(finalReply)) {
            try {
              const retry = await createRetryResponse({
                input,
                hasDocumentContext: Boolean(documentContext),
              });

              const retryText = retry.output_text?.trim() ?? "";

              if (!isWeakReply(retryText)) {
                finalReply = retryText;
              }
            } catch (retryError) {
              console.error("Retry failed:", retryError);
            }
          }

          const persistedReply =
            finalReply ||
            "I couldn’t generate a complete response. Try again, upload a clearer image, or ask a more specific question.";

          if (isWeakReply(streamedReply) && persistedReply !== streamedReply) {
            controller.enqueue(encoder.encode(`\n\n${persistedReply}`));
          }

          await persistAssistantMessage({
            supabase,
            conversationId,
            userId: user.id,
            content: persistedReply,
          });

          const shouldGenerateTitle =
            !regenerate &&
            message &&
            (conversation.title === "New Chat" ||
              conversation.title === buildConversationTitle(message));

          const title = shouldGenerateTitle
            ? await generateConversationTitle(message)
            : undefined;

          await touchConversation({
            supabase,
            conversationId,
            userId: user.id,
            title,
          });

          controller.close();
        } catch (error) {
          console.error("/api/chat streaming error:", error);

          const fallback =
            fullReply.trim() ||
            "I'm sorry — something went wrong while generating the response.";

          if (!fullReply.trim()) {
            controller.enqueue(encoder.encode(fallback));
          }

          await persistAssistantMessage({
            supabase,
            conversationId,
            userId: user.id,
            content: fallback,
          });

          await touchConversation({
            supabase,
            conversationId,
            userId: user.id,
          });

          controller.close();
        }
      },

      async cancel(reason) {
        console.warn("/api/chat stream cancelled:", reason);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("/api/chat error:", error);
    return jsonResponse({ error: "Something went wrong in /api/chat." }, 500);
  }
}
