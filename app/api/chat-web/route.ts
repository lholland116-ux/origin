import { createServerSupabaseClient } from "@/lib/supabase/server";
import { runWebSearchService, type ChatRequestBody } from "@/lib/ai/web-search-service";

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

export async function POST(req: Request): Promise<Response> {
  try {
    const supabase = await createServerSupabaseClient();
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

    const result = await runWebSearchService({ userId: user.id, body });
    return jsonResponse(result.body, result.status);
  } catch (error) {
    console.error("/api/chat-web route error:", error);
    return jsonResponse({ error: "Something went wrong in /api/chat-web." }, 500);
  }
}
