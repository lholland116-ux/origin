import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ChatClient from "./ChatClient";

type InitialMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image_path?: string | null;
  image_name?: string | null;
};

type ConversationItem = {
  id: string;
  title: string | null;
  updated_at: string;
};

function isInitialMessage(value: unknown): value is InitialMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Record<string, unknown>;

  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    (message.image_path === undefined ||
      message.image_path === null ||
      typeof message.image_path === "string") &&
    (message.image_name === undefined ||
      message.image_name === null ||
      typeof message.image_name === "string")
  );
}

export default async function ChatPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const { data: conversations, error: conversationsError } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (conversationsError) {
    console.error(
      "Failed to load conversations:",
      conversationsError
    );

    throw new Error("Failed to load conversations.");
  }

  let conversationList: ConversationItem[] = conversations ?? [];

  if (conversationList.length === 0) {
    const {
      data: newConversation,
      error: createConversationError,
    } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        title: "New Chat",
      })
      .select("id, title, updated_at")
      .single();

    if (createConversationError || !newConversation) {
      console.error(
        "Failed to create initial conversation:",
        createConversationError
      );

      throw new Error("Failed to create conversation.");
    }

    conversationList = [newConversation];
  }

  const activeConversationId = conversationList[0]?.id;

  if (!activeConversationId) {
    throw new Error("No active conversation found.");
  }

  const { data: rawMessages, error: messagesError } = await supabase
    .from("messages")
    .select(
      `
        id,
        role,
        content,
        image_path,
        image_name
      `
    )
    .eq("conversation_id", activeConversationId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    console.error("Failed to load messages:", messagesError);
    throw new Error("Failed to load messages.");
  }

  const initialMessages: InitialMessage[] = (rawMessages ?? [])
    .filter(isInitialMessage)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      image_path:
        typeof message.image_path === "string"
          ? message.image_path
          : null,
      image_name:
        typeof message.image_name === "string"
          ? message.image_name
          : null,
    }));

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#020817_0%,#020617_100%)] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        <div className="absolute left-[10%] top-[10%] h-[300px] w-[300px] rounded-full bg-blue-600/10 blur-3xl" />

        <div className="absolute right-[5%] top-[15%] h-[260px] w-[260px] rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative">
        <ChatClient
          userEmail={user.email ?? ""}
          initialConversationId={activeConversationId}
          initialMessages={initialMessages}
          initialConversations={conversationList}
        />
      </div>
    </main>
  );
}