import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackBody = {
  messageId?: string;
  conversationId?: string;
  rating?: "up" | "down";
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FeedbackBody;

    const messageId = body.messageId;
    const conversationId = body.conversationId;
    const rating = body.rating;

    if (!messageId || !conversationId || !rating) {
      return jsonError("Missing required fields.", 400);
    }

    if (rating !== "up" && rating !== "down") {
      return jsonError("Invalid rating value.", 400);
    }

    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("Unauthorized.", 401);
    }

    const { error } = await supabase
      .from("message_feedback")
      .upsert(
        {
          user_id: user.id,
          message_id: messageId,
          conversation_id: conversationId,
          rating,
        },
        {
          onConflict: "user_id,message_id",
        }
      );

    if (error) {
      console.error("Failed to save feedback:", error);

      return jsonError("Failed to save feedback.", 500);
    }

    return NextResponse.json(
      {
        success: true,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Unexpected feedback API error:", error);

    return jsonError("Unexpected server error.", 500);
  }
}