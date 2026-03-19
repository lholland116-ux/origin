"use client";

import ReactMarkdown from "react-markdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimestamp } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Message = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
};

type ChatAppProps = {
  userEmail: string;
};

type ApiErrorResponse = {
  error?: string;
  code?: string;
};

type UsageResponse = {
  used?: number;
  limit?: number;
  remaining?: number;
  error?: string;
};

export default function ChatApp({ userEmail }: ChatAppProps) {
  const router = useRouter();
  const supabase = createClient();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const [usageUsed, setUsageUsed] = useState(0);
  const [usageLimit, setUsageLimit] = useState(20);

  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteConversation, setConfirmDeleteConversation] =
    useState<Conversation | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  async function signOut() {
    try {
      setError(null);
      setLimitReached(false);

      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign out.");
    }
  }

  async function loadConversations() {
    try {
      setSidebarLoading(true);
      setError(null);

      const res = await fetch("/api/conversations", { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load conversations.");
      }

      const nextConversations = data.conversations || [];
      setConversations(nextConversations);

      if (!conversationId && nextConversations.length > 0) {
        setConversationId(nextConversations[0].id);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load conversations."
      );
    } finally {
      setSidebarLoading(false);
    }
  }

  async function loadUsage() {
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      const data: UsageResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load usage.");
      }

      const used = data.used ?? 0;
      const limit = data.limit ?? 20;
      const remaining = data.remaining ?? Math.max(limit - used, 0);

      setUsageUsed(used);
      setUsageLimit(limit);
      setLimitReached(remaining <= 0);
    } catch (err) {
      console.error("Usage load error:", err);
    }
  }

  async function renameConversation(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;

    try {
      setError(null);

      const res = await fetch("/api/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to rename conversation.");
      }

      setConversations((prev) =>
        prev.map((conv) => (conv.id === id ? data.conversation : conv))
      );

      setEditingConversationId(null);
      setEditingTitle("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to rename conversation."
      );
    }
  }

  async function deleteConversation(id: string) {
    try {
      setError(null);
      setDeletingId(id);

      const res = await fetch(`/api/conversations?id=${id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete conversation.");
      }

      const remaining = conversations.filter((conv) => conv.id !== id);
      setConversations(remaining);

      if (conversationId === id) {
        const nextConversation = remaining[0] ?? null;
        setConversationId(nextConversation ? nextConversation.id : null);
        setMessages([]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete conversation."
      );
    } finally {
      setDeletingId(null);
      setConfirmDeleteConversation(null);
    }
  }

  function startRenamingConversation(id: string, currentTitle: string) {
    setEditingConversationId(id);
    setEditingTitle(currentTitle);
  }

  async function createConversation() {
    try {
      setError(null);

      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create conversation.");
      }

      setConversations((prev) => [data.conversation, ...prev]);
      setConversationId(data.conversation.id);
      setMessages([]);
      setEditingConversationId(null);
      setEditingTitle("");

      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create conversation."
      );
    }
  }

  async function copyMessage(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setError("Failed to copy message.");
    }
  }

  async function loadMessages(id: string) {
    try {
      setError(null);

      const res = await fetch(`/api/messages?conversationId=${id}`, {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load messages.");
      }

      setMessages(data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages.");
    }
  }

  async function streamAssistantReply(
    conversationId: string,
    message: string,
    regenerate = false
  ) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationId, message, regenerate }),
    });

    if (!res.ok) {
      let errorMessage = regenerate
        ? "Failed to regenerate response."
        : "Failed to send message.";

      let errorCode: string | undefined;

      try {
        const data: ApiErrorResponse = await res.json();
        errorMessage = data.error || errorMessage;
        errorCode = data.code;
      } catch {
        // Keep fallback message
      }

      if (errorCode === "LIMIT_REACHED") {
        const limitError = new Error(
          "You've reached your daily limit. Upgrade to continue."
        );
        limitError.name = "LIMIT_REACHED";
        throw limitError;
      }

      throw new Error(errorMessage);
    }

    if (!res.body) {
      throw new Error("No response stream returned.");
    }

    setLimitReached(false);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let fullText = "";

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      },
    ]);

    while (!done) {
      const result = await reader.read();
      done = result.done;

      if (result.value) {
        const chunk = decoder.decode(result.value, { stream: true });
        fullText += chunk;

        setMessages((prev) => {
          const next = [...prev];
          const lastIndex = next.length - 1;

          if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
            next[lastIndex] = {
              ...next[lastIndex],
              content: fullText,
            };
          }

          return next;
        });
      }
    }
  }

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || !conversationId || loading) return;

    setError(null);
    setLoading(true);

    const previousUsage = usageUsed;
    setUsageUsed((prev) => Math.min(prev + 1, usageLimit));

    const userMessage: Message = {
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      await streamAssistantReply(conversationId, trimmed, false);
      await loadMessages(conversationId);
      await loadConversations();
      await loadUsage();
    } catch (err) {
      const isLimitError =
        err instanceof Error && err.name === "LIMIT_REACHED";

      if (isLimitError) {
        setLimitReached(true);
        setError(err.message);
        setUsageUsed(previousUsage);

        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "user" && next[i].content === trimmed) {
              next.splice(i, 1);
              break;
            }
          }
          return next;
        });

        setInput(trimmed);
        await loadUsage();
        return;
      }

      setUsageUsed(previousUsage);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, something went wrong while generating a reply.",
          created_at: new Date().toISOString(),
        },
      ]);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while sending your message."
      );
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function regenerateResponse() {
    if (!conversationId || loading) return;

    setError(null);
    setLoading(true);

    const previousUsage = usageUsed;
    setUsageUsed((prev) => Math.min(prev + 1, usageLimit));

    const removedAssistantMessage =
      [...messages].reverse().find((m) => m.role === "assistant") ?? null;

    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next.splice(i, 1);
          break;
        }
      }
      return next;
    });

    try {
      await streamAssistantReply(conversationId, "", true);
      await loadMessages(conversationId);
      await loadConversations();
      await loadUsage();
    } catch (err) {
      const isLimitError =
        err instanceof Error && err.name === "LIMIT_REACHED";

      if (isLimitError) {
        setLimitReached(true);
        setError(err.message);
        setUsageUsed(previousUsage);

        if (removedAssistantMessage) {
          setMessages((prev) => [...prev, removedAssistantMessage]);
        }

        await loadUsage();
        return;
      }

      setUsageUsed(previousUsage);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while regenerating the response."
      );

      if (removedAssistantMessage) {
        setMessages((prev) => [...prev, removedAssistantMessage]);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  useEffect(() => {
    void loadConversations();
    void loadUsage();
  }, []);

  useEffect(() => {
    if (conversationId) {
      void loadMessages(conversationId);
    }
  }, [conversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) || null,
    [conversations, conversationId]
  );

  const usagePercent =
    usageLimit > 0 ? Math.min((usageUsed / usageLimit) * 100, 100) : 0;

  return (
    <main className="flex h-screen bg-zinc-950 text-zinc-100">
      <aside className="hidden w-80 border-r border-zinc-800 bg-zinc-950 md:flex md:flex-col">
        <div className="border-b border-zinc-800 p-4">
          <button
            onClick={createConversation}
            className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-black transition hover:opacity-90"
          >
            + New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {sidebarLoading ? (
            <div className="space-y-2">
              <div className="h-14 animate-pulse rounded-2xl bg-zinc-900" />
              <div className="h-14 animate-pulse rounded-2xl bg-zinc-900" />
              <div className="h-14 animate-pulse rounded-2xl bg-zinc-900" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-4 text-sm text-zinc-400">
              No conversations yet. Start a new one.
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => {
                const active = conv.id === conversationId;
                const isEditing = editingConversationId === conv.id;

                return (
                  <div
                    key={conv.id}
                    className={`rounded-2xl border px-3 py-3 transition ${
                      active
                        ? "border-zinc-700 bg-zinc-800"
                        : "border-transparent bg-zinc-900 hover:bg-zinc-950"
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              void renameConversation(conv.id, editingTitle);
                            }
                            if (e.key === "Escape") {
                              setEditingConversationId(null);
                              setEditingTitle("");
                            }
                          }}
                          autoFocus
                          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              void renameConversation(conv.id, editingTitle)
                            }
                            className="rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-black"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingConversationId(null);
                              setEditingTitle("");
                            }}
                            className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setConversationId(conv.id)}
                          className="w-full text-left"
                        >
                          <div className="truncate text-sm font-medium">
                            {conv.title}
                          </div>
                          <div className="mt-1 text-xs text-zinc-400">
                            {new Date(conv.updated_at).toLocaleDateString()}
                          </div>
                        </button>

                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() =>
                              startRenamingConversation(conv.id, conv.title)
                            }
                            className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-950"
                          >
                            Rename
                          </button>

                          <button
                            onClick={() => setConfirmDeleteConversation(conv)}
                            disabled={deletingId === conv.id}
                            className="rounded-xl border border-red-900/50 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-950/30 disabled:opacity-50"
                          >
                            {deletingId === conv.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <section className="flex flex-1 flex-col">
        <header className="border-b border-zinc-800 bg-zinc-950/80 px-4 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
            <div>
              <h1 className="text-sm font-semibold text-zinc-100">
                {activeConversation?.title || "AI Chat"}
              </h1>

              <div className="mt-1 space-y-2">
                <p className="text-xs text-zinc-400">
                  Signed in as {userEmail}
                </p>

                <div className="space-y-1">
                  <p className="text-xs text-zinc-500">
                    {usageUsed} / {usageLimit} messages used today
                  </p>

                  <div className="h-1 w-40 rounded-full bg-zinc-800">
                    <div
                      className="h-1 rounded-full bg-white transition-all"
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={createConversation}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-900 md:hidden"
              >
                New Chat
              </button>

              <button
                onClick={signOut}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-900"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6">
            {limitReached && (
              <div className="mb-4 rounded-2xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                <div className="font-medium">Free plan limit reached</div>
                <div className="mt-1 text-amber-100/80">
                  You’ve reached your daily message limit. Upgrade to continue
                  using the app today.
                </div>
                <div className="mt-3">
                  <button
                    className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-black transition hover:opacity-90"
                    onClick={() => {
                      setError("Upgrade flow not connected yet.");
                    }}
                  >
                    Upgrade
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-4 rounded-2xl border border-red-900/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/60 p-8 text-center shadow-2xl">
                  <h2 className="text-xl font-semibold text-white">
                    Start a conversation
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    Ask a question, brainstorm ideas, or build with your AI
                    agent. Your conversation history will be saved automatically.
                  </p>
                  <button
                    onClick={createConversation}
                    className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:opacity-90"
                  >
                    New Chat
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((msg, index) => {
                  const isUser = msg.role === "user";
                  const isLastMessage = index === messages.length - 1;
                  const canRegenerate = !isUser && isLastMessage && !loading;

                  return (
                    <div
                      key={`${msg.created_at || "msg"}-${index}`}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-3xl px-4 py-3 shadow-lg md:max-w-[75%] ${
                          isUser
                            ? "bg-white text-black"
                            : "border border-zinc-800 bg-zinc-900 text-zinc-100"
                        }`}
                      >
                        <div className="break-words text-sm leading-7">
                          {isUser ? (
                            <div className="whitespace-pre-wrap">
                              {msg.content || (loading ? "Thinking..." : "")}
                            </div>
                          ) : (
                            <div
                              className="prose prose-invert max-w-none
                                prose-headings:text-zinc-100
                                prose-p:text-zinc-100
                                prose-strong:text-zinc-100
                                prose-code:text-zinc-100
                                prose-pre:rounded-2xl
                                prose-pre:border
                                prose-pre:border-zinc-700
                                prose-pre:bg-zinc-950
                                prose-ul:list-disc
                                prose-ul:pl-6
                                prose-ol:list-decimal
                                prose-ol:pl-6
                                prose-li:my-1
                                prose-li:text-zinc-100"
                            >
                              <ReactMarkdown>
                                {msg.content || (loading ? "Thinking..." : "")}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>

                        {msg.created_at && (
                          <div
                            className={`mt-2 text-[11px] ${
                              isUser ? "text-zinc-700" : "text-zinc-500"
                            }`}
                          >
                            {formatTimestamp(msg.created_at)}
                          </div>
                        )}

                        {!isUser && msg.content && (
                          <div className="mt-3 flex justify-end gap-2">
                            {canRegenerate && (
                              <button
                                onClick={() => void regenerateResponse()}
                                disabled={loading || limitReached}
                                className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
                              >
                                Regenerate
                              </button>
                            )}

                            <button
                              onClick={() => void copyMessage(msg.content, index)}
                              className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800"
                            >
                              {copiedIndex === index ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div ref={endRef} />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-800 bg-zinc-950">
          <div className="mx-auto w-full max-w-4xl px-4 py-4">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-3 shadow-2xl">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (limitReached) {
                    setError(null);
                  }
                }}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={
                  limitReached
                    ? "Daily limit reached. Upgrade to continue..."
                    : conversationId
                    ? "Message your AI agent..."
                    : "Create a new chat to begin..."
                }
                disabled={!conversationId || loading || limitReached}
                className="max-h-40 min-h-[52px] w-full resize-none bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
              />

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-zinc-500">
                  {limitReached
                    ? "Free plan limit reached for today"
                    : "Press Enter to send, Shift+Enter for a new line"}
                </p>

                <button
                  onClick={() => void sendMessage()}
                  disabled={
                    !conversationId || !input.trim() || loading || limitReached
                  }
                  className="rounded-2xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Sending..." : limitReached ? "Locked" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {confirmDeleteConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">
              Delete conversation?
            </h2>

            <p className="mt-3 text-sm leading-6 text-zinc-400">
              This will permanently delete{" "}
              <span className="font-medium text-zinc-200">
                {confirmDeleteConversation.title}
              </span>{" "}
              and all of its messages.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteConversation(null)}
                className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                Cancel
              </button>

              <button
                onClick={async () => {
                  await deleteConversation(confirmDeleteConversation.id);
                  setConfirmDeleteConversation(null);
                }}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}