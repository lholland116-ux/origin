import { NextRequest } from "next/server";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { openai } from "@/lib/openai";
import { createClient } from "@/lib/supabase/server";
import { buildConversationTitle } from "@/lib/utils";
import type { Database } from "@/lib/database.types";

export const runtime = "nodejs";

const DAILY_LIMIT = 20;
const CHAT_MODEL = "gpt-4o-mini";
const TITLE_MODEL = "gpt-4o-mini";
const MAX_HISTORY_MESSAGES = 12;

const LOG_OPENAI_META = true;
const LOG_OPENAI_PAYLOADS = process.env.LOG_OPENAI_PAYLOADS === "true";

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  regenerate?: boolean;
};

type DbMessageRow = Database["public"]["Tables"]["messages"]["Row"];
type DbMessageInsert = Database["public"]["Tables"]["messages"]["Insert"];
type DbConversationRow = Database["public"]["Tables"]["conversations"]["Row"];

type AssistantOrUserRole = "user" | "assistant";

type ResponseInputTextItem = {
  role: AssistantOrUserRole;
  content: Array<{
    type: "input_text";
    text: string;
  }>;
};

type ChatResponsesPayload = {
  model: string;
  stream: true;
  instructions: string;
  input: ResponseInputTextItem[];
};

type TitleResponsesPayload = {
  model: string;
  instructions: string;
  input: [
    {
      role: "user";
      content: [
        {
          type: "input_text";
          text: string;
        },
      ];
    },
  ];
};

type ReserveDailyUsageResult = {
  allowed: boolean;
  messageCount: number;
};

type ReserveDailyUsageRpcRow = {
  allowed?: boolean;
  message_count?: number;
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTraceId(prefix = "trace"): string {
  return `${prefix}_${randomUUID()}`;
}

function nowMs(): number {
  return Date.now();
}

function safeLog(label: string, data: unknown): void {
  try {
    console.log(label, JSON.stringify(data, null, 2));
  } catch {
    console.log(label, data);
  }
}

function isAssistantOrUserRole(role: DbMessageRow["role"]): role is AssistantOrUserRole {
  return role === "user" || role === "assistant";
}

function redactInputItems(
  items: ResponseInputTextItem[],
  previewChars = 120
): Array<{ role: AssistantOrUserRole; contentPreview: string; contentLength: number }> {
  return items.map((item) => {
    const joined = item.content.map((c) => c.text).join("\n");
    return {
      role: item.role,
      contentPreview:
        joined.length > previewChars ? `${joined.slice(0, previewChars)}…` : joined,
      contentLength: joined.length,
    };
  });
}

function buildSystemPrompt(): string {
  return [
    "You are a helpful AI assistant.",
    "Give clear, accurate, concise answers.",
    "Use a warm and professional tone.",
    "Do not claim a specific model name or architecture.",
    "If asked what model you are, say: 'I’m the assistant running in this app.'",
  ].join(" ");
}

function mapHistoryToResponseInput(history: DbMessageRow[]): ResponseInputTextItem[] {
  return history
    .filter((msg): msg is DbMessageRow & { role: AssistantOrUserRole } =>
      isAssistantOrUserRole(msg.role)
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((msg) => ({
      role: msg.role,
      content: [
        {
          type: "input_text" as const,
          text: msg.content,
        },
      ],
    }));
}

function buildChatPayload(input: ResponseInputTextItem[]): ChatResponsesPayload {
  return {
    model: CHAT_MODEL,
    stream: true,
    instructions: buildSystemPrompt(),
    input,
  };
}

function buildTitlePayload(message: string): TitleResponsesPayload {
  return {
    model: TITLE_MODEL,
    instructions:
      "Generate a short, clear conversation title in 3 to 6 words. Do not use quotes.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    ],
  };
}

function extractOutputText(response: { output_text?: string | null }): string {
  return response.output_text?.trim() ?? "";
}

function isOutputTextDeltaEvent(
  event: unknown
): event is { type: "response.output_text.delta"; delta: string } {
  if (!event || typeof event !== "object") return false;

  const maybe = event as Record<string, unknown>;
  return maybe.type === "response.output_text.delta" && typeof maybe.delta === "string";
}

function isResponseCompletedEvent(
  event: unknown
): event is { type: "response.completed" } {
  if (!event || typeof event !== "object") return false;

  const maybe = event as Record<string, unknown>;
  return maybe.type === "response.completed";
}

function isResponseFailedEvent(
  event: unknown
): event is { type: "response.failed"; response?: unknown } {
  if (!event || typeof event !== "object") return false;

  const maybe = event as Record<string, unknown>;
  return maybe.type === "response.failed";
}

async function reserveDailyUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  date: string,
  limit: number
): Promise<ReserveDailyUsageResult> {
  const { data, error } = await supabase.rpc("reserve_daily_usage", {
    p_user_id: userId,
    p_date: date,
    p_limit: limit,
  });

  if (error) throw error;

  const row =
    Array.isArray(data) && data.length > 0
      ? (data[0] as ReserveDailyUsageRpcRow)
      : null;

  return {
    allowed: Boolean(row?.allowed),
    messageCount: Number(row?.message_count ?? 0),
  };
}

async function refundDailyUsage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  date: string
): Promise<void> {
  const { error } = await supabase.rpc("refund_daily_usage", {
    p_user_id: userId,
    p_date: date,
  });

  if (error) {
    safeLog("[usage] refund failed", { userId, date, error });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const routeTraceId = makeTraceId("route");
  const routeStartedAt = nowMs();

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      safeLog("[auth] unauthorized", { routeTraceId, authError });
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

    safeLog("[chat] request", {
      routeTraceId,
      userId: user.id,
      conversationId,
      regenerate,
      messageLength: message.length,
      model: CHAT_MODEL,
    });

    const conversationReadStartedAt = nowMs();
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, title, user_id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    const typedConversation = conversation as DbConversationRow | null;

    if (conversationError || !typedConversation) {
      safeLog("[conversation] not found", {
        routeTraceId,
        conversationId,
        durationMs: nowMs() - conversationReadStartedAt,
        conversationError,
      });
      return jsonResponse({ error: "Conversation not found." }, 404);
    }

    let oldAssistantIdToReplace: string | null = null;

    if (regenerate) {
      const regenLookupStartedAt = nowMs();

      const { data: lastAssistant, error: lastAssistantError } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const typedLastAssistant = lastAssistant as Pick<DbMessageRow, "id"> | null;

      if (lastAssistantError) {
        safeLog("[regenerate] lookup error", {
          routeTraceId,
          durationMs: nowMs() - regenLookupStartedAt,
          lastAssistantError,
        });
        return jsonResponse(
          { error: "Failed to prepare regeneration." },
          500
        );
      }

      oldAssistantIdToReplace = typedLastAssistant?.id ?? null;
    } else {
      const userInsertStartedAt = nowMs();

      const userMessageInsert: DbMessageInsert = {
        conversation_id: conversationId,
        user_id: user.id,
        role: "user",
        content: message,
      };

      const { error: insertUserError } = await supabase
        .from("messages")
        .insert(userMessageInsert);

      if (insertUserError) {
        safeLog("[messages] user insert error", {
          routeTraceId,
          durationMs: nowMs() - userInsertStartedAt,
          insertUserError,
        });
        return jsonResponse({ error: "Failed to save user message." }, 500);
      }
    }

    const historyLoadStartedAt = nowMs();
    const { data: history, error: historyError } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    const typedHistory = (history ?? []) as DbMessageRow[];

    if (historyError) {
      safeLog("[history] load error", {
        routeTraceId,
        durationMs: nowMs() - historyLoadStartedAt,
        historyError,
      });
      return jsonResponse(
        { error: "Failed to load conversation history." },
        500
      );
    }

    const responseInput = mapHistoryToResponseInput(typedHistory);
    const chatPayload = buildChatPayload(responseInput);
    const openAiTraceId = makeTraceId("openai_response");

    if (LOG_OPENAI_META) {
      safeLog("[openai] responses request meta", {
        routeTraceId,
        openAiTraceId,
        model: CHAT_MODEL,
        inputCount: chatPayload.input.length,
        input: redactInputItems(chatPayload.input),
      });
    }

    if (LOG_OPENAI_PAYLOADS) {
      safeLog("[openai] exact responses payload", {
        routeTraceId,
        openAiTraceId,
        payload: chatPayload,
      });
    }

    let usageReserved = false;
    const usageReserveStartedAt = nowMs();

    try {
      const usage = await reserveDailyUsage(
        supabase,
        user.id,
        today,
        DAILY_LIMIT
      );

      if (!usage.allowed) {
        safeLog("[usage] limit reached", {
          routeTraceId,
          userId: user.id,
          messageCount: usage.messageCount,
          dailyLimit: DAILY_LIMIT,
          durationMs: nowMs() - usageReserveStartedAt,
        });

        return jsonResponse(
          {
            error: "Daily limit reached. Upgrade to continue.",
            code: "LIMIT_REACHED",
          },
          403
        );
      }

      usageReserved = true;

      safeLog("[usage] reserved", {
        routeTraceId,
        userId: user.id,
        messageCount: usage.messageCount,
        dailyLimit: DAILY_LIMIT,
        durationMs: nowMs() - usageReserveStartedAt,
      });
    } catch (usageError) {
      safeLog("[usage] reserve error", {
        routeTraceId,
        usageError,
      });
      return jsonResponse({ error: "Failed to reserve usage." }, 500);
    }

    let openAiRequestId: string | undefined;
    let fullReply = "";

    try {
      const openAiStartedAt = nowMs();

      const { data: stream, request_id } = await openai.responses
        .create(chatPayload, {
          headers: {
            "X-Client-Request-Id": openAiTraceId,
          },
        })
        .withResponse();

      openAiRequestId = request_id;

      safeLog("[openai] responses stream opened", {
        routeTraceId,
        openAiTraceId,
        openAiRequestId,
        model: CHAT_MODEL,
        durationMs: nowMs() - openAiStartedAt,
      });

      const encoder = new TextEncoder();

      const readableStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const event of stream as AsyncIterable<unknown>) {
              if (isOutputTextDeltaEvent(event)) {
                if (event.delta.length === 0) continue;
                fullReply += event.delta;
                controller.enqueue(encoder.encode(event.delta));
                continue;
              }

              if (isResponseFailedEvent(event)) {
                throw new Error("OpenAI response stream reported failure.");
              }

              if (isResponseCompletedEvent(event)) {
                continue;
              }
            }

            safeLog("[openai] responses stream complete", {
              routeTraceId,
              openAiTraceId,
              openAiRequestId,
              responseLength: fullReply.length,
            });

            if (fullReply.trim()) {
              const assistantInsertStartedAt = nowMs();

              const assistantMessageInsert: DbMessageInsert = {
                conversation_id: conversationId,
                user_id: user.id,
                role: "assistant",
                content: fullReply,
              };

              const { data: insertedAssistant, error: assistantInsertError } =
                await supabase
                  .from("messages")
                  .insert(assistantMessageInsert)
                  .select("id")
                  .single();

              const typedInsertedAssistant =
                insertedAssistant as Pick<DbMessageRow, "id"> | null;

              if (assistantInsertError) {
                safeLog("[messages] assistant insert error", {
                  routeTraceId,
                  durationMs: nowMs() - assistantInsertStartedAt,
                  assistantInsertError,
                });
              } else if (regenerate && oldAssistantIdToReplace) {
                const deleteOldStartedAt = nowMs();

                const { error: deleteOldAssistantError } = await supabase
                  .from("messages")
                  .delete()
                  .eq("id", oldAssistantIdToReplace)
                  .eq("user_id", user.id);

                if (deleteOldAssistantError) {
                  safeLog("[regenerate] old assistant delete error", {
                    routeTraceId,
                    oldAssistantIdToReplace,
                    newAssistantId: typedInsertedAssistant?.id,
                    durationMs: nowMs() - deleteOldStartedAt,
                    deleteOldAssistantError,
                  });
                }
              }

              const updateConversationStartedAt = nowMs();
              const { error: updateConversationError } = await supabase
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", conversationId)
                .eq("user_id", user.id);

              if (updateConversationError) {
                safeLog("[conversation] update error", {
                  routeTraceId,
                  durationMs: nowMs() - updateConversationStartedAt,
                  updateConversationError,
                });
              }
            }

            const shouldGenerateTitle =
              !regenerate &&
              message &&
              (typedConversation.title === "New Chat" ||
                typedConversation.title === buildConversationTitle(message));

            if (shouldGenerateTitle && message) {
              const titleTraceId = makeTraceId("openai_title");
              const titlePayload = buildTitlePayload(message);

              if (LOG_OPENAI_META) {
                safeLog("[openai] title responses request meta", {
                  routeTraceId,
                  titleTraceId,
                  model: TITLE_MODEL,
                  input: redactInputItems(titlePayload.input),
                });
              }

              if (LOG_OPENAI_PAYLOADS) {
                safeLog("[openai] exact title responses payload", {
                  routeTraceId,
                  titleTraceId,
                  payload: titlePayload,
                });
              }

              try {
                const titleStartedAt = nowMs();

                const titleResponse = await openai.responses.create(titlePayload, {
                  headers: {
                    "X-Client-Request-Id": titleTraceId,
                  },
                });

                safeLog("[openai] title responses result", {
                  routeTraceId,
                  titleTraceId,
                  openAiRequestId: titleResponse._request_id,
                  model: TITLE_MODEL,
                  durationMs: nowMs() - titleStartedAt,
                });

                const generatedTitle =
                  extractOutputText(titleResponse) || buildConversationTitle(message);

                const cleanedTitle = generatedTitle.replace(/^"|"$/g, "");

                const titleUpdateStartedAt = nowMs();
                const { error: titleUpdateError } = await supabase
                  .from("conversations")
                  .update({
                    title: cleanedTitle,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", conversationId)
                  .eq("user_id", user.id);

                if (titleUpdateError) {
                  safeLog("[conversation] title update error", {
                    routeTraceId,
                    durationMs: nowMs() - titleUpdateStartedAt,
                    titleUpdateError,
                  });
                }
              } catch (titleError) {
                if (titleError instanceof OpenAI.APIError) {
                  safeLog("[openai] title API error", {
                    routeTraceId,
                    status: titleError.status,
                    name: titleError.name,
                    message: titleError.message,
                    type: titleError.type,
                    code: titleError.code,
                    requestId: titleError.request_id,
                  });
                } else {
                  safeLog("[openai] title unknown error", {
                    routeTraceId,
                    titleError,
                  });
                }
              }
            }

            controller.close();
          } catch (streamError) {
            if (usageReserved) {
              await refundDailyUsage(supabase, user.id, today);
            }

            if (streamError instanceof OpenAI.APIError) {
              safeLog("[openai] responses stream API error", {
                routeTraceId,
                openAiTraceId,
                openAiRequestId,
                status: streamError.status,
                name: streamError.name,
                message: streamError.message,
                type: streamError.type,
                code: streamError.code,
                requestId: streamError.request_id,
              });
            } else {
              safeLog("[openai] responses stream unknown error", {
                routeTraceId,
                openAiTraceId,
                openAiRequestId,
                streamError,
              });
            }

            try {
              controller.enqueue(
                encoder.encode("\n\n[STREAM_ERROR] Response interrupted.")
              );
            } catch {
              // ignore enqueue failure during teardown
            }

            controller.error(streamError);
          }
        },
      });

      safeLog("[route] response ready", {
        routeTraceId,
        openAiTraceId,
        openAiRequestId,
        totalSetupDurationMs: nowMs() - routeStartedAt,
      });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-App-Trace-Id": routeTraceId,
          "X-OpenAI-Client-Trace-Id": openAiTraceId,
        },
      });
    } catch (openAiError) {
      if (usageReserved) {
        await refundDailyUsage(supabase, user.id, today);
      }

      if (openAiError instanceof OpenAI.APIError) {
        safeLog("[openai] responses setup API error", {
          routeTraceId,
          openAiTraceId,
          openAiRequestId,
          status: openAiError.status,
          name: openAiError.name,
          message: openAiError.message,
          type: openAiError.type,
          code: openAiError.code,
          requestId: openAiError.request_id,
        });
      } else {
        safeLog("[openai] responses setup unknown error", {
          routeTraceId,
          openAiTraceId,
          openAiError,
        });
      }

      return jsonResponse({ error: "Failed to generate response." }, 500);
    }
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      safeLog("[route] API error", {
        routeTraceId,
        status: error.status,
        name: error.name,
        message: error.message,
        type: error.type,
        code: error.code,
        requestId: error.request_id,
      });
    } else {
      safeLog("[route] unknown error", {
        routeTraceId,
        error,
      });
    }

    return jsonResponse({ error: "Something went wrong in /api/chat." }, 500);
  }
}