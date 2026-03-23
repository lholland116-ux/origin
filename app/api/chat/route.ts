import { NextRequest } from "next/server";
import { openai } from "@/lib/openai";
import { createClient } from "@/lib/supabase/server";
import { buildConversationTitle } from "@/lib/utils";

export const runtime = "nodejs";

const DAILY_LIMIT = 20;

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  regenerate?: boolean;
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as ChatRequestBody;
    const conversationId = body?.conversationId;
    const message = body?.message?.trim() ?? "";
    const regenerate = Boolean(body?.regenerate);

    if (!conversationId) {
      return jsonResponse({ error: "conversationId is required." }, 400);
    }

    if (!regenerate && !message) {
      return jsonResponse(
        { error: "message is required unless regenerating." },
        400
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    const { data: usageRow, error: usageReadError } = await supabase
      .from("usage")
      .select("message_count")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle();

    if (usageReadError) {
      console.error("Usage read error:", usageReadError);
      return jsonResponse({ error: "Failed to read usage." }, 500);
    }

    const currentCount = usageRow?.message_count ?? 0;

    if (currentCount >= DAILY_LIMIT) {
      return jsonResponse(
        {
          error: "Daily limit reached. Upgrade to continue.",
          code: "LIMIT_REACHED",
        },
        403
      );
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, title, user_id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (conversationError || !conversation) {
      return jsonResponse({ error: "Conversation not found." }, 404);
    }

    // Count every generation request, including regenerate, because both consume API usage.
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
        const { error: deleteAssistantError } = await supabase
          .from("messages")
          .delete()
          .eq("id", lastAssistant.id)
          .eq("user_id", user.id);

        if (deleteAssistantError) {
          console.error("Assistant delete error:", deleteAssistantError);
          return jsonResponse(
            { error: "Failed to prepare regeneration." },
            500
          );
        }
      }
    } else {
      const { error: insertUserError } = await supabase
        .from("messages")
        .insert({
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

    const recentMessages = history.slice(-12).map((msg) => ({
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    }));

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful AI assistant. Give clear, accurate, concise answers. Use a warm and professional tone.",
        },
        ...recentMessages,
      ],
    });

    const encoder = new TextEncoder();
    let fullReply = "";

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content || "";
            if (token) {
              fullReply += token;
              controller.enqueue(encoder.encode(token));
            }
          }

          if (fullReply.trim()) {
            const { error: assistantInsertError } = await supabase
              .from("messages")
              .insert({
                conversation_id: conversationId,
                user_id: user.id,
                role: "assistant",
                content: fullReply,
              });

            if (assistantInsertError) {
              console.error("Assistant insert error:", assistantInsertError);
            }

            const { error: updateConversationError } = await supabase
              .from("conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", conversationId)
              .eq("user_id", user.id);

            if (updateConversationError) {
              console.error(
                "Conversation update error:",
                updateConversationError
              );
            }
          }

          const shouldGenerateTitle =
            !regenerate &&
            message &&
            (conversation.title === "New Chat" ||
              conversation.title === buildConversationTitle(message));

          if (shouldGenerateTitle && message) {
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

              const generatedTitle =
                titleResponse.choices[0]?.message?.content?.trim() ||
                buildConversationTitle(message);

              const cleanedTitle = generatedTitle.replace(/^"|"$/g, "");

              const { error: titleUpdateError } = await supabase
                .from("conversations")
                .update({
                  title: cleanedTitle,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", conversationId)
                .eq("user_id", user.id);

              if (titleUpdateError) {
                console.error("Title update error:", titleUpdateError);
              }
            } catch (titleError) {
              console.error("Title generation failed:", titleError);
            }
          }

          controller.close();
        } catch (streamError) {
          console.error("Streaming error:", streamError);
          controller.error(streamError);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error("/api/chat error:", error);
    return jsonResponse({ error: "Something went wrong in /api/chat." }, 500);
  }
}