import { createServerSupabaseClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { SYSTEM_PROMPT_WEB } from "@/lib/system-prompt-web";
import { buildConversationTitle } from "@/lib/utils";

export const runtime = "nodejs";

const DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT ?? 20);
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_RETURNED_SOURCES = 5;
const IS_DEV = process.env.NODE_ENV === "development";

const MODEL = "gpt-5.3-chat-latest";

const TONE_LAYER_WEB = `
Tone and style requirements:
- Be warm, calm, friendly, and supportive.
- Sound approachable and human, not robotic or overly formal.
- Use clear, natural language with a soft, respectful tone.
- Be encouraging when helpful, but keep answers grounded in current information.
- Stay professional, clear, and easy to follow.
- Avoid harsh phrasing, stiff wording, or unnecessary jargon.
- When sharing current or time-sensitive information, be precise without sounding cold.
- When you are uncertain, say so clearly and kindly.
- Prioritize clarity, usefulness, and a positive user experience.
`.trim();

const GPT_5_LAYER_WEB = `
Model behavior requirements:
- You are running on GPT-5.3 via the OpenAI API.
- Do not claim to be GPT-4 or any other model version.
- Do not speculate about model availability.
- If asked what model you are using, respond: "I am running on the latest OpenAI model available in this application."
- Focus on answering the user's question instead of discussing model versions.
`.trim();

const TITLE_INSTRUCTIONS = `
Generate a short, clear conversation title in 3 to 6 words.
Do not use quotes.
Keep the wording natural, polished, and user-friendly.
`.trim();

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

type ProfileRow = {
  plan: "free" | "pro" | string | null;
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

type TimeWidgetPayload = {
  type: "time";
  location: string;
  timezone: string;
};

type AssistantWidget = TimeWidgetPayload | null;

type WebRouteSuccessResponse = {
  reply: string;
  sources: SourceItem[];
  sourceCount: number;
  widget: AssistantWidget;
  web: true;
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

function buildWebInstructions(): string {
  return [SYSTEM_PROMPT_WEB.trim(), TONE_LAYER_WEB, GPT_5_LAYER_WEB].join(
    "\n\n"
  );
}

function safeLower(value: string): string {
  return value.trim().toLowerCase();
}

function getHostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function emptyWebResponse(message: string): WebRouteSuccessResponse {
  return {
    reply: message,
    sources: [],
    sourceCount: 0,
    widget: null,
    web: true,
  };
}

function extractSources(response: unknown): SourceItem[] {
  const seen = new Set<string>();
  const sources: SourceItem[] = [];

  const output = (response as { output?: unknown[] } | null)?.output ?? [];

  for (const item of output) {
    const typedItem = item as {
      type?: string;
      action?: {
        sources?: Array<{
          title?: string;
          url?: string;
          snippet?: string;
        }>;
      };
    };

    if (typedItem?.type !== "web_search_call") continue;

    for (const src of typedItem?.action?.sources ?? []) {
      const url = typeof src?.url === "string" ? src.url.trim() : "";
      if (!url || seen.has(url)) continue;

      seen.add(url);

      const title =
        typeof src?.title === "string" && src.title.trim().length > 0
          ? src.title.trim()
          : getHostnameLabel(url);

      const snippet =
        typeof src?.snippet === "string" && src.snippet.trim().length > 0
          ? src.snippet.trim()
          : undefined;

      sources.push({
        title,
        url,
        snippet,
      });
    }
  }

  return sources;
}

function compactSources(sources: SourceItem[]): {
  sources: SourceItem[];
  sourceCount: number;
} {
  const unique = new Map<string, SourceItem>();

  for (const source of sources) {
    const key = source.url.trim();
    if (!key || unique.has(key)) continue;
    unique.set(key, source);
  }

  const deduped = Array.from(unique.values());

  return {
    sources: deduped.slice(0, MAX_RETURNED_SOURCES),
    sourceCount: deduped.length,
  };
}

function detectTimeWidget(
  message: string,
  reply: string
): TimeWidgetPayload | null {
  const normalizedMessage = safeLower(message);
  const normalizedReply = safeLower(reply);

  const looksLikeTimeQuestion =
    normalizedMessage.includes("what time is it") ||
    normalizedMessage.includes("current time") ||
    normalizedMessage.includes("local time") ||
    normalizedMessage.includes("time in ");

  if (!looksLikeTimeQuestion) {
    return null;
  }

  if (
    normalizedMessage.includes("rentz") ||
    normalizedMessage.includes("rentz, ga") ||
    normalizedMessage.includes("rentz ga")
  ) {
    return {
      type: "time",
      location: "Rentz, GA",
      timezone: "America/New_York",
    };
  }

  if (
    normalizedReply.includes("eastern daylight time") ||
    normalizedReply.includes("eastern time")
  ) {
    return {
      type: "time",
      location: "Eastern Time",
      timezone: "America/New_York",
    };
  }

  return null;
}

async function generateConversationTitle(message: string): Promise<string> {
  try {
    const titleResponse = await openai.responses.create({
      model: MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: TITLE_INSTRUCTIONS,
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

async function buildAssistantResponse(
  recentMessages: ModelInputMessage[],
  message: string
): Promise<WebRouteSuccessResponse> {
  const response = await openai.responses.create({
    model: MODEL,
    instructions: buildWebInstructions(),
    input: recentMessages,
    tools: [{ type: "web_search_preview" }],
    include: ["web_search_call.action.sources"],
    store: false,
  });

  const reply = response.output_text?.trim() || "";

  if (!reply) {
    return emptyWebResponse(
      "I'm having trouble generating a response right now. Please try again."
    );
  }

  const extractedSources = extractSources(response);
  const { sources, sourceCount } = compactSources(extractedSources);
  const widget = detectTimeWidget(message, reply);

  return {
    reply,
    sources,
    sourceCount,
    widget,
    web: true,
  };
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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single<ProfileRow>();

    if (profileError || !profile) {
      console.error("Profile lookup error:", profileError);
      return jsonResponse({ error: "Failed to verify subscription plan." }, 500);
    }

    if (profile.plan !== "pro") {
      return jsonResponse(
        {
          error: "Web search is a Pro feature. Please upgrade to continue.",
          code: "PRO_REQUIRED",
        },
        403
      );
    }

    let body: ChatRequestBody;

    try {
      body = (await req.json()) as ChatRequestBody;
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId : "";
    const message = normalizeMessage(body.message);
    const regenerate = Boolean(body.regenerate);

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
          return jsonResponse(
            { error: "Failed to prepare regeneration." },
            500
          );
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
      return jsonResponse(
        { error: "Failed to load conversation history." },
        500
      );
    }

    const recentMessages: ModelInputMessage[] = (history as DbMessage[])
      .slice(-MAX_HISTORY_MESSAGES)
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

    if (IS_DEV) {
      console.log("🌐 WEB ROUTE ACTIVE");
      console.log("MODEL IN USE:", MODEL);
    }

    const assistantResponse = await buildAssistantResponse(
      recentMessages,
      message
    );

    const { error: insertAssistantError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: assistantResponse.reply,
        sources: assistantResponse.sources ?? [],
        source_count: assistantResponse.sourceCount ?? 0,
        widget: assistantResponse.widget ?? null,
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

    return jsonResponse(assistantResponse);
  } catch (error) {
    console.error("/api/chat-web error:", error);
    return jsonResponse(
      { error: "Something went wrong in /api/chat-web." },
      500
    );
  }
}