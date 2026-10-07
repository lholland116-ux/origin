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
  DocumentContextLimitError,
} from "@/lib/documents/prepare-context";
import { formatMaxDocumentCount, getDocumentLimits } from "@/lib/documents/config";
import { resolveAccountPlan, type AccountPlanResolution } from "@/lib/capabilities/account-plan";
import {
  reserveDailyUsage,
  resolveDailyUsageLimits,
} from "@/lib/capabilities/daily-usage";
import { createWebSearchOperationService } from "@/lib/ai/web-search-operation-service";
import { requestTransactionContextSchema } from "@/lib/agent-runtime/application-contracts";
import { omitPendingAssistantMessages, PENDING_ASSISTANT_MESSAGE_PREFIX } from "@/lib/chat/request-message-visibility";

const DAILY_USAGE_LIMITS = resolveDailyUsageLimits();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_DOCUMENT_IDS = 10;
const PASTED_TEXT_FILE_NAME = "pasted-text.txt";
const PASTED_TEXT_MIME_TYPE = "text/plain";
const MIN_PASTED_TEXT_BYTES = 2001;
const MAX_HISTORY_MESSAGES = 12;
const IS_DEV = process.env.NODE_ENV === "development";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
"Who are you?"
Title:
Assistant Identity

User:
"What should I call you?"
Title:
Assistant Name Question

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

export type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  regenerate?: boolean;
  documentIds?: string[];
  reasoningMode?: unknown;
  webSearchMode?: unknown;
};

type WebSearchMode = "auto" | "force";

export type WebSearchServiceDependencies = Readonly<{
  createSupabaseClient: typeof createServerSupabaseClient;
  provider: typeof openai;
  writeTelemetry: typeof writeAiRequestTelemetry;
}>;

const defaultDependencies: WebSearchServiceDependencies = {
  createSupabaseClient: createServerSupabaseClient,
  provider: openai,
  writeTelemetry: writeAiRequestTelemetry,
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

type StoredDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: "ready";
  extraction_error: string | null;
  conversation_id: string | null;
};

class WebSearchDocumentAdmissionError extends Error {
  constructor() {
    super("Web Search only supports large pasted-text attachments.");
    this.name = "WebSearchDocumentAdmissionError";
  }
}

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

export type WebSearchServiceResult = Readonly<{
  kind: "json";
  status: number;
  body: Record<string, unknown>;
}>;

function jsonResponse(body: Record<string, unknown>, status = 200): WebSearchServiceResult {
  return { kind: "json", status, body };
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

function normalizeMessage(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeDocumentIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_DOCUMENT_IDS);
}

function buildStoredUserContent(message: string, documents: StoredDocument[]): string {
  if (documents.length === 0) return message;

  const documentNames = documents.map((document) => document.file_name).join(", ");
  return [message, `[Documents attached: ${documentNames}]`]
    .filter(Boolean)
    .join("\n\n");
}

async function loadDocumentArtifacts(params: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  documentIds: string[];
}): Promise<{ persistedDocuments: StoredDocument[]; documentContext: string }> {
  const { supabase, userId, documentIds } = params;

  if (documentIds.length === 0) {
    return { persistedDocuments: [], documentContext: "" };
  }

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, file_name, mime_type, size_bytes, extraction_status, extraction_error, conversation_id, extracted_text",
    )
    .eq("user_id", userId)
    .in("id", documentIds)
    .eq("extraction_status", "ready");

  if (error) {
    throw new Error(`Failed to load document context: ${error.message}`);
  }

  const rows = (data ?? []) as Array<StoredDocument & { extracted_text: string | null }>;

  if (
    rows.length !== documentIds.length ||
    rows.some(
      (document) =>
        document.file_name !== PASTED_TEXT_FILE_NAME ||
        document.mime_type !== PASTED_TEXT_MIME_TYPE ||
        document.size_bytes < MIN_PASTED_TEXT_BYTES,
    )
  ) {
    throw new WebSearchDocumentAdmissionError();
  }

  return {
    persistedDocuments: rows.map((document) => ({
      id: document.id,
      file_name: document.file_name,
      mime_type: document.mime_type,
      size_bytes: document.size_bytes,
      extraction_status: document.extraction_status,
      extraction_error: document.extraction_error,
      conversation_id: document.conversation_id,
    })),
    documentContext: buildDocumentContext(rows),
  };
}

function sanitizeTitle(title: string, fallback: string): string {
  const cleaned = title.replace(/^["']|["']$/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback;
}

async function generateConversationTitle(
  message: string,
  provider: typeof openai,
): Promise<string> {
  try {
    const titleResponse = await provider.responses.create({
      model: GENERAL_CHAT_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: TITLE_INSTRUCTIONS }],
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

async function executeWebSearchService(input: {
  readonly userId: string;
  readonly body: ChatRequestBody;
}, dependencies: WebSearchServiceDependencies): Promise<WebSearchServiceResult> {
  const supabase = await dependencies.createSupabaseClient();
  const telemetryWrites: Promise<unknown>[] = [];
  const userId = input.userId;
  const body = input.body;

  try {
    const accountPlan = await resolveAccountPlan({
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

    if (accountPlan.kind !== "resolved") {
      return accountPlanFailureResponse(accountPlan);
    }

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

    let webSearchMode: WebSearchMode | undefined;
    if (Object.hasOwn(body, "webSearchMode")) {
      if (body.webSearchMode !== "auto" && body.webSearchMode !== "force") {
        return jsonResponse(
          {
            error: "webSearchMode must be one of: auto, force.",
            code: "INVALID_WEB_SEARCH_MODE",
          },
          400,
        );
      }
      webSearchMode = body.webSearchMode;
    }

    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId : "";

    const message = normalizeMessage(body.message);
    const regenerate = Boolean(body.regenerate);
    const documentIds = normalizeDocumentIds(body.documentIds);
    const plan = accountPlan.plan;
    const adaptiveEffort = parsedReasoningMode.kind === "absent"
      ? selectReasoningEffort({
          route: "web_search",
          message,
          hasDocuments: documentIds.length > 0,
          hasImages: false,
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

    if (!conversationId) {
      return jsonResponse({ error: "conversationId is required." }, 400);
    }

    if (!regenerate && !message && documentIds.length === 0) {
      return jsonResponse(
        { error: "message or documentIds is required unless regenerate is true." },
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
      .eq("user_id", userId)
      .single<ConversationRow>();

    if (conversationError || !conversation) {
      return jsonResponse({ error: "Conversation not found." }, 404);
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

    let persistedDocuments: StoredDocument[] = [];
    let documentContext = "";

    try {
      const artifacts = await loadDocumentArtifacts({
        supabase,
        userId,
        documentIds,
      });
      persistedDocuments = artifacts.persistedDocuments;
      documentContext = artifacts.documentContext;
    } catch (error) {
      console.error("Web Search document context load error:", error);
      if (error instanceof WebSearchDocumentAdmissionError) {
        return jsonResponse(
          { error: error.message, code: "WEB_SEARCH_DOCUMENT_NOT_ALLOWED" },
          400,
        );
      }
      if (error instanceof DocumentContextLimitError) {
        return jsonResponse({ error: error.message, code: "DOCUMENT_CONTEXT_TOO_LARGE" }, 413);
      }
      return jsonResponse({ error: "Failed to load document context." }, 500);
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
        403,
      );
    }

    if (usageReservation.kind !== "reserved") {
      return dailyUsageFailureResponse(usageReservation);
    }

    if (regenerate) {
      const { data: lastAssistant, error: lastAssistantError } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .eq("role", "assistant")
        .not("content", "like", `${PENDING_ASSISTANT_MESSAGE_PREFIX}%`)
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
          return jsonResponse(
            { error: "Failed to prepare regeneration." },
            500
          );
        }
      }
    } else {
      const { error: insertUserError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        user_id: userId,
        role: "user",
        content: buildStoredUserContent(message, persistedDocuments),
        documents: persistedDocuments,
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
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (historyError || !history) {
      console.error("History load error:", historyError);
      return jsonResponse(
        { error: "Failed to load conversation history." },
        500
      );
    }

    const recentMessages: ModelInputMessage[] = omitPendingAssistantMessages(history as DbMessage[])
      .slice(-MAX_HISTORY_MESSAGES)
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
    const latestUserMessageId = [...(history as DbMessage[])]
      .reverse()
      .find((historyMessage) => historyMessage.role === "user")?.id;
    const requestContext = requestTransactionContextSchema.parse({
      requestId: randomUUID(),
      userId,
      conversationId,
      userMessageId: latestUserMessageId && UUID_PATTERN.test(latestUserMessageId)
        ? latestUserMessageId
        : null,
    });

    if (IS_DEV) {
      console.log("🌐 WEB ROUTE ACTIVE");
      console.log("MODEL IN USE:", GENERAL_CHAT_MODEL);
      console.log("PLAN:", plan);
      console.log("USAGE:", `${usageReservation.messageCount}/${dailyLimit}`);
    }

    function scheduleTelemetry(params: {
      outcome: AiTelemetryOutcome;
      latencyMs: number;
      webSearchCalls: number;
      model: string;
      usage: {
        inputTokens: number | null;
        cachedInputTokens: number | null;
        outputTokens: number | null;
        reasoningTokens: number | null;
        totalTokens: number | null;
      };
    }): void {
      const record: AiRequestTelemetryRecord = {
        route: "web_search",
        attemptKind: "primary",
        model: params.model,
        webSearchCalls: params.webSearchCalls,
        reasoningEffort,
        plan,
        outcome: params.outcome,
        latencyMs: params.latencyMs,
        hadImage: false,
        ...params.usage,
      };

      telemetryWrites.push(
        Promise.resolve()
          .then(() => dependencies.writeTelemetry(record))
          .catch(() => undefined),
      );
    }

    const operation = createWebSearchOperationService({ provider: dependencies.provider });
    const operationExecution = await operation.run({
      requestContext,
      objective: message,
      reasoningEffort,
      history: recentMessages,
      documentContext,
      mode: webSearchMode,
    });
    scheduleTelemetry(operationExecution.measurement);
    if (!operationExecution.ok) throw new Error("Web Search operation failed.");

    const assistantResponse: WebRouteSuccessResponse = {
      reply: operationExecution.result.reply,
      sources: operationExecution.result.sources,
      sourceCount: operationExecution.result.sourceCount,
      widget: operationExecution.result.widget,
      web: true,
    };

    const { error: insertAssistantError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
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
      updates.title = await generateConversationTitle(message, dependencies.provider);
    }

    const { error: updateConversationError } = await supabase
      .from("conversations")
      .update(updates)
      .eq("id", conversationId)
      .eq("user_id", userId);

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
  } finally {
    await Promise.allSettled(telemetryWrites);
  }
}

export function createWebSearchService(dependencies: WebSearchServiceDependencies) {
  return {
    run: (input: { readonly userId: string; readonly body: ChatRequestBody }) =>
      executeWebSearchService(input, dependencies),
  } as const;
}

export function runWebSearchService(input: {
  readonly userId: string;
  readonly body: ChatRequestBody;
}): Promise<WebSearchServiceResult> {
  return executeWebSearchService(input, defaultDependencies);
}
