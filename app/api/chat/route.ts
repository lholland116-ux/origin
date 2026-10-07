import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  runStandardChatService,
  type ChatRequestBody,
  type StandardChatServiceResult,
} from "@/lib/ai/standard-chat-service";

export const runtime = "nodejs";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function toHttpResponse(result: StandardChatServiceResult): Response {
  if (result.kind === "json") return jsonResponse(result.body, result.status);

  if (result.kind === "document") {
    return new Response(new Blob([result.bytes as unknown as ArrayBuffer], { type: result.mimeType }), {
      status: result.status,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": result.mimeType,
        "X-Content-Type-Options": "nosniff",
        "X-LVTChat-Document": "generated",
        "X-LVTChat-Document-Format": result.format,
        ...(result.generatedDocumentId
          ? { "X-Generated-Document-Id": result.generatedDocumentId }
          : {}),
        ...(result.messageId
          ? { "X-Generated-Document-Message-Id": result.messageId }
          : {}),
      },
    });
  }

  const iterator = result.events[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value.text));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      void iterator.return?.();
      await result.onCancel(reason);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...(result.headers.userMessageId
        ? { "X-LVTChat-User-Message-Id": result.headers.userMessageId }
        : {}),
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) return jsonResponse({ error: "Unauthorized." }, 401);

    let body: ChatRequestBody;
    try {
      body = (await req.json()) as ChatRequestBody;
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const result = await runStandardChatService({ userId: user.id, body });
    return toHttpResponse(result);
  } catch (error) {
    console.error("/api/chat route error:", error);
    return jsonResponse({ error: "Something went wrong in /api/chat." }, 500);
  }
}
