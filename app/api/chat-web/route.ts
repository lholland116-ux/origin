import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { SYSTEM_PROMPT_WEB } from "@/lib/system-prompt-web";
import { buildConversationTitle } from "@/lib/utils";

export const runtime = "nodejs";

const DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT ?? 20);
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const IS_DEV = process.env.NODE_ENV === "development";

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  regenerate?: boolean;
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

type ModelInputMessage = {
  role: "user" | "assistant";
  content: string;
};

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
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

async function generateConversationTitle(message: string): Promise<string> {
  try {
    const titleResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Generate a short, clear conversation title in 3 to 6 words. Do not use quotes.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: message }],
        },
      ],
      store: false,
    });

    return sanitizeTitle(
      titleResponse.output_text?.trim() ?? "",
      buildConversationTitle(message)
    );
  } catch {
    return buildConversationTitle(message);
  }
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

    if (!conversationId) {
      return jsonResponse({ error: "conversationId is required." }, 400);
    }

    if (!regenerate && !message) {
      return jsonResponse(
        { error: "message is required unless regenerate is true." },
        400
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return jsonResponse(
        { error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters.` },
        400
      );
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
      const { error: insertUserError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "user",
        content: message,
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

    const recentMessages: ModelInputMessage[] = (history as DbMessage[])
      .slice(-MAX_HISTORY_MESSAGES)
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

    if (IS_DEV) {
      console.log("🌐 WEB ROUTE ACTIVE");
      console.log("MODEL IN USE:", "gpt-4.1");
    }

    const response = await openai.responses.create({
      model: "gpt-4.1",
      instructions: SYSTEM_PROMPT_WEB,
      input: recentMessages,
      tools: [{ type: "web_search_preview" }],
      include: ["web_search_call.action.sources"],
      store: false,
    });

    const reply = response.output_text?.trim() || "";

    if (!reply) {
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
      return jsonResponse({ error: "Failed to save assistant message." }, 500);
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
      web: true,
    });
  } catch (error) {
    console.error("/api/chat-web error:", error);
    return jsonResponse({ error: "Something went wrong in /api/chat-web." }, 500);
  }
}