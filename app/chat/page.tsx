import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatClient from "./ChatClient";

type InitialMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default async function ChatPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const { data: existingConversation, error: conversationQueryError } =
    await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (conversationQueryError) {
    throw new Error("Failed to load conversation.");
  }

  let conversationId = existingConversation?.id;

  if (!conversationId) {
    const { data: newConversation, error: createConversationError } =
      await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: "New Chat",
        })
        .select("id")
        .single();

    if (createConversationError || !newConversation) {
      throw new Error("Failed to create conversation.");
    }

    conversationId = newConversation.id;
  }

  const { data: rawMessages, error: messagesError } = await supabase
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    throw new Error("Failed to load messages.");
  }

  const initialMessages: InitialMessage[] = (rawMessages ?? []).filter(
    (msg): msg is InitialMessage =>
      Boolean(
        msg &&
          typeof msg.id === "string" &&
          (msg.role === "user" || msg.role === "assistant") &&
          typeof msg.content === "string"
      )
  );

  return (
    <ChatClient
      userEmail={user.email ?? ""}
      conversationId={conversationId}
      initialMessages={initialMessages}
    />
  );
}