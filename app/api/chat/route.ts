import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { buildConversationTitle } from "@/lib/utils";

export const runtime = "nodejs";

const DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT ?? 20);
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_IMAGE_BASE64_LENGTH = 8_000_000;
const MIN_IMAGE_BASE64_LENGTH = 1_000;
const MIN_ACCEPTABLE_REPLY_LENGTH = 10;
const IS_DEV = process.env.NODE_ENV === "development";

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  regenerate?: boolean;
  imageBase64?: string;
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

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeMessage(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeImageBase64(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function sanitizeTitle(title: string, fallback: string): string {
  const cleaned = title.replace(/^["']|["']$/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback;
}

function isLikelyDataUrlImage(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function buildStoredUserContent(message: string, hasImage: boolean): string {
  if (message && hasImage) return `${message}\n\n[Image attached]`;
  if (message) return message;
  if (hasImage) return "[Image attached]";
  return "";
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

async function generateConversationTitle(message: string): Promise<string> {
  try {
    const titleResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Generate a short, clear conversation title in 3 to 6 words. Do not use quotes.",
      input: message,
      store: false,
    } as any);

    return sanitizeTitle(
      titleResponse.output_text?.trim() ?? "",
      buildConversationTitle(message)
    );
  } catch {
    return buildConversationTitle(message);
  }
}

function buildResponsesInput(params: {
  history: DbMessage[];
  latestMessage: string;
  imageBase64: string;
}) {
  const { history, latestMessage, imageBase64 } = params;

  const priorMessages = history.slice(0, -1).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const latestUserInput = imageBase64
    ? {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: buildImageAnalysisInstruction(latestMessage),
          },
          {
            type: "input_image" as const,
            image_url: imageBase64,
            detail: "auto" as const,
          },
        ],
      }
    : {
        role: "user" as const,
        content:
          latestMessage || history[history.length - 1]?.content || "",
      };

  return [...priorMessages, latestUserInput];
}

async function createRetryResponse(
  input: ReturnType<typeof buildResponsesInput>
) {
  return openai.responses.create({
    model: "gpt-4.1",
    instructions: SYSTEM_PROMPT,
    input,
    store: false,
  } as any);
}

export async function POST(req: Request) {
  const supabase = await createClient();

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

    const conversationId =
      typeof body?.conversationId === "string" ? body.conversationId : "";
    const message = normalizeMessage(body?.message);
    const regenerate = Boolean(body?.regenerate);
    const imageBase64 = normalizeImageBase64(body?.imageBase64);

    if (!conversationId) {
      return jsonResponse({ error: "conversationId is required." }, 400);
    }

    if (!regenerate && !message && !imageBase64) {
      return jsonResponse(
        { error: "message or imageBase64 is required unless regenerate is true." },
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

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, user_id, title")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single<ConversationRow>();

    if (conversationError || !conversation) {
      return jsonResponse({ error: "Conversation not found." }, 404);
    }

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

    if (!IS_DEV && currentCount >= DAILY_LIMIT) {
      return jsonResponse(
        {
          error: "Daily limit reached. Upgrade to continue.",
          code: "LIMIT_REACHED",
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
      const storedUserContent = buildStoredUserContent(
        message,
        Boolean(imageBase64)
      );

      const { error: insertUserError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "user",
        content: storedUserContent,
      });

      if (insertUserError) {
        console.error("User message insert error:", insertUserError);
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
      return jsonResponse({ error: "Failed to load conversation history." }, 500);
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
    }) as any;

    const encoder = new TextEncoder();
    let fullReply = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (IS_DEV) {
            console.log("Image included:", Boolean(imageBase64));
            console.log("Image length:", imageBase64 ? imageBase64.length : 0);
            console.log("Latest user message:", latestUserMessage);
          }

          const responseStream = (await openai.responses.create({
            model: "gpt-4.1",
            instructions: SYSTEM_PROMPT,
            input,
            stream: true as const,
            store: false,
          } as any)) as unknown as AsyncIterable<any>;

          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              const delta = event.delta ?? "";
              if (delta) {
                fullReply += delta;
                controller.enqueue(encoder.encode(delta));
              }
            }

            if (event.type === "response.completed") {
              break;
            }
          }

          if (IS_DEV) {
            console.log("Reply length:", fullReply.length);
          }

          const streamedReply = fullReply.trim();
          let finalReply = streamedReply;

          if (imageBase64 && isWeakReply(finalReply)) {
            console.warn("Weak or empty image response detected. Retrying once.");

            try {
              const retry = await createRetryResponse(input);
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
            "I couldn’t fully analyze this image. Try uploading a clearer image or adding a short description of what you want to know.";

          if (isWeakReply(streamedReply) && persistedReply !== streamedReply) {
            controller.enqueue(encoder.encode(`\n\n${persistedReply}`));
          }

          const { error: insertAssistantError } = await supabase
            .from("messages")
            .insert({
              conversation_id: conversationId,
              user_id: user.id,
              role: "assistant",
              content: persistedReply,
            });

          if (insertAssistantError) {
            console.error("Assistant message insert error:", insertAssistantError);
          }

          const updates: Record<string, string> = {
            updated_at: new Date().toISOString(),
          };

          const shouldGenerateTitle =
            !regenerate &&
            message &&
            (conversation.title === "New Chat" ||
              conversation.title === buildConversationTitle(message));

          if (shouldGenerateTitle) {
            updates.title = await generateConversationTitle(message);
          }

          const { error: updateConversationError } = await supabase
            .from("conversations")
            .update(updates)
            .eq("id", conversationId)
            .eq("user_id", user.id);

          if (updateConversationError) {
            console.error("Conversation update error:", updateConversationError);
          }

          controller.close();
        } catch (error) {
          console.error("/api/chat streaming error:", error);

          const fallback =
            fullReply.trim() ||
            "I'm sorry — something went wrong while generating the response.";

          if (!fullReply.trim()) {
            controller.enqueue(encoder.encode(fallback));
          }

          const { error: insertAssistantError } = await supabase
            .from("messages")
            .insert({
              conversation_id: conversationId,
              user_id: user.id,
              role: "assistant",
              content: fallback,
            });

          if (insertAssistantError) {
            console.error("Assistant fallback insert error:", insertAssistantError);
          }

          const { error: updateConversationError } = await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("user_id", user.id);

          if (updateConversationError) {
            console.error("Conversation update error:", updateConversationError);
          }

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