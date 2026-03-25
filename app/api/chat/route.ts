import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { buildConversationTitle } from "@/lib/utils";

export const runtime = "nodejs";

const DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT ?? 20);
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_IMAGE_BASE64_LENGTH = 8_000_000;
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

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
};

type SimpleHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ModelInputMessage = {
  role: "user" | "assistant";
  content: Array<
    | {
        type: "input_text";
        text: string;
      }
    | {
        type: "input_image";
        image_url: string;
        detail: "auto";
      }
  >;
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

function extractSources(response: any): SourceItem[] {
  const seen = new Set<string>();
  const sources: SourceItem[] = [];

  for (const item of response?.output ?? []) {
    if (item?.type !== "web_search_call") continue;

    for (const src of item?.action?.sources ?? []) {
      const url = typeof src?.url === "string" ? src.url : "";
      if (!url || seen.has(url)) continue;

      seen.add(url);

      sources.push({
        title:
          typeof src?.title === "string" && src.title.trim().length > 0
            ? src.title.trim()
            : url,
        url,
        snippet:
          typeof src?.snippet === "string" && src.snippet.trim().length > 0
            ? src.snippet.trim()
            : undefined,
      });
    }
  }

  return sources;
}

function isLikelyDataUrlImage(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function buildModelInput(
  recentMessages: SimpleHistoryMessage[],
  message: string,
  imageBase64: string
): ModelInputMessage[] {
  const historyWithoutLatestUser = recentMessages.slice(0, -1).map((msg) => ({
    role: msg.role,
    content: [
      {
        type: "input_text" as const,
        text: msg.content,
      },
    ],
  }));

  if (!imageBase64) {
    return recentMessages.map((msg) => ({
      role: msg.role,
      content: [
        {
          type: "input_text" as const,
          text: msg.content,
        },
      ],
    }));
  }

  return [
    ...historyWithoutLatestUser,
    {
      role: "user",
      content: [
        {
          type: "input_text" as const,
          text: message || "Please analyze this image.",
        },
        {
          type: "input_image" as const,
          image_url: imageBase64,
          detail: "auto" as const,
        },
      ],
    },
  ];
}

async function generateConversationTitle(message: string): Promise<string> {
  try {
    const titleResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Generate a short, clear conversation title in 3 to 6 words. Do not use quotes.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      max_tokens: 20,
    });

    return sanitizeTitle(
      titleResponse.choices[0]?.message?.content ?? "",
      buildConversationTitle(message)
    );
  } catch {
    return buildConversationTitle(message);
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = (await req.json()) as ChatRequestBody;

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
        {
          error:
            "message or imageBase64 is required unless regenerate is true.",
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

      if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
        return jsonResponse({ error: "Attached image is too large." }, 400);
      }
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, user_id, title")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

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
      {
        onConflict: "user_id,date",
      }
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
        return jsonResponse(
          { error: "Failed to prepare regeneration." },
          500
        );
      }

      if (lastAssistant?.id) {
        const { error: deleteError } = await supabase
          .from("messages")
          .delete()
          .eq("id", lastAssistant.id)
          .eq("user_id", user.id);

        if (deleteError) {
          console.error("Assistant delete error:", deleteError);
          return jsonResponse(
            { error: "Failed to prepare regeneration." },
            500
          );
        }
      }
    } else {
      const storedUserContent = message || "[Image attached]";

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
      return jsonResponse(
        { error: "Failed to load conversation history." },
        500
      );
    }

    const recentMessages: SimpleHistoryMessage[] = (history as DbMessage[])
      .slice(-MAX_HISTORY_MESSAGES)
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

    const modelInput = buildModelInput(recentMessages, message, imageBase64);

    const response = await openai.responses.create({
      model: "gpt-5",
      instructions: SYSTEM_PROMPT,
      input: modelInput,
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      store: false,
    });

    const reply = response.output_text?.trim() || "";

    if (!reply) {
      console.error("Empty model response:", {
        output: response?.output,
      });

      return jsonResponse({
        reply:
          "I'm having trouble generating a response right now. Please try again.",
        sources: [],
      });
    }

    const sources = extractSources(response);

    const { error: insertAssistantError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: reply,
      });

    if (insertAssistantError) {
      console.error("Assistant message insert error:", insertAssistantError);
      return jsonResponse(
        { error: "Failed to save assistant message." },
        500
      );
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

    return jsonResponse({
      reply,
      sources,
    });
  } catch (error) {
    console.error("/api/chat error:", error);
    return jsonResponse({ error: "Something went wrong in /api/chat." }, 500);
  }
}