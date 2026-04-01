"use client";

import ReactMarkdown from "react-markdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimestamp } from "@/lib/utils";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { PRODUCT_DESCRIPTION } from "@/lib/product-content";

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
};

type Message = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
  sources?: SourceItem[];
  imagePreview?: string;
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

type ChatSuccessResponse = {
  reply?: string;
  sources?: SourceItem[];
  error?: string;
  code?: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_LENGTH = 2000;

export default function ChatApp({ userEmail }: ChatAppProps) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

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

  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) || null,
    [conversations, conversationId]
  );

  async function signOut() {
    try {
      setError(null);
      setLimitReached(false);

      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }

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

      const nextConversations: Conversation[] = Array.isArray(data.conversations)
        ? data.conversations
        : [];

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

      const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
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
    if (loading) return;

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
      clearSelectedImage();

      window.setTimeout(() => inputRef.current?.focus(), 50);
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
      window.setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setError("Failed to copy message.");
    }
  }

  async function loadMessages(id: string) {
    try {
      setError(null);

      const res = await fetch(`/api/messages?conversationId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load messages.");
      }

      const nextMessages: Message[] = Array.isArray(data.messages)
        ? data.messages
        : [];

      setMessages(nextMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages.");
    }
  }

  function clearSelectedImage() {
    setSelectedImage(null);
    setSelectedImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      clearSelectedImage();
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please upload a supported image file.");
      clearSelectedImage();
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be 5 MB or smaller.");
      clearSelectedImage();
      return;
    }

    setError(null);
    setSelectedImage(file);

    const previewUrl = URL.createObjectURL(file);
    setSelectedImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return previewUrl;
    });
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("Failed to read image file."));
          return;
        }
        resolve(result);
      };

      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.readAsDataURL(file);
    });
  }

  function shouldUseWebRoute(message: string, hasImage: boolean): boolean {
    if (hasImage) return false;

    const text = message.toLowerCase();

    return [
      "current",
      "latest",
      "today",
      "now",
      "weather",
      "news",
      "price",
      "stock",
      "time",
      "temperature",
    ].some((keyword) => text.includes(keyword));
  }

  async function requestAssistantReply(
    targetConversationId: string,
    message: string,
    regenerate = false,
    imageBase64?: string
  ) {
    const hasImage = Boolean(imageBase64);
    const route = shouldUseWebRoute(message, hasImage)
      ? "/api/chat-web"
      : "/api/chat";

    const res = await fetch(route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: targetConversationId,
        message,
        regenerate,
        imageBase64,
      }),
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
        // ignore parse error
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

    const data: ChatSuccessResponse = await res.json();

    if (process.env.NODE_ENV === "development") {
      console.log("chat success response:", JSON.stringify(data, null, 2));
      console.log("route used:", route);
    }

    const assistantContent =
      typeof data.reply === "string" && data.reply.trim().length > 0
        ? data.reply.trim()
        : "No response generated.";

    const assistantSources = Array.isArray(data.sources) ? data.sources : [];

    setLimitReached(false);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: assistantContent,
      sources: assistantSources,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
  }

  async function sendMessage() {
    const trimmed = input.trim();
    const hasImage = Boolean(selectedImage);

    if ((!trimmed && !hasImage) || !conversationId || loading) return;

    if (trimmed.length > MAX_INPUT_LENGTH) {
      setError(`Message must be ${MAX_INPUT_LENGTH} characters or fewer.`);
      return;
    }

    setError(null);
    setLoading(true);

    const previousUsage = usageUsed;
    setUsageUsed((prev) => Math.min(prev + 1, usageLimit));

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed || "",
      created_at: new Date().toISOString(),
      imagePreview: selectedImagePreview ?? undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const imageBase64 = selectedImage
        ? await fileToBase64(selectedImage)
        : undefined;

      await requestAssistantReply(conversationId, trimmed, false, imageBase64);

      clearSelectedImage();
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
            if (
              next[i].role === "user" &&
              next[i].content === (trimmed || "")
            ) {
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
          id: crypto.randomUUID(),
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
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function regenerateResponse() {
    if (!conversationId || loading) return;

    setError(null);
    setLoading(true);

    const previousUsage = usageUsed;
    setUsageUsed((prev) => Math.min(prev + 1, usageLimit));

    const removedAssistantMessage =
      [...messages].reverse().find((message) => message.role === "assistant") ??
      null;

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
      await requestAssistantReply(conversationId, "", true);
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

  function handleStarterPrompt(prompt: string) {
    setInput(prompt);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
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
    if (!endRef.current) return;

    if (loading) {
      endRef.current.scrollIntoView({ behavior: "auto" });
      return;
    }

    endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      if (selectedImagePreview) {
        URL.revokeObjectURL(selectedImagePreview);
      }
    };
  }, [selectedImagePreview]);

  return (
    <main className="flex h-screen bg-zinc-950 text-zinc-100">
      <aside className="hidden w-80 border-r border-zinc-800 bg-zinc-950 md:flex md:flex-col">
        <div className="border-b border-zinc-800 p-4">
          <button
            type="button"
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
              {conversations.map((conversation) => {
                const active = conversation.id === conversationId;
                const isEditing = editingConversationId === conversation.id;

                return (
                  <div
                    key={conversation.id}
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
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void renameConversation(
                                conversation.id,
                                editingTitle
                              );
                            }
                            if (event.key === "Escape") {
                              setEditingConversationId(null);
                              setEditingTitle("");
                            }
                          }}
                          autoFocus
                          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void renameConversation(
                                conversation.id,
                                editingTitle
                              )
                            }
                            className="rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-black"
                          >
                            Save
                          </button>
                          <button
                            type="button"
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
                          type="button"
                          onClick={() => setConversationId(conversation.id)}
                          className="w-full text-left"
                        >
                          <div className="truncate text-sm font-medium">
                            {conversation.title}
                          </div>
                          <div className="mt-1 text-xs text-zinc-400">
                            {new Date(conversation.updated_at).toLocaleDateString()}
                          </div>
                        </button>

                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              startRenamingConversation(
                                conversation.id,
                                conversation.title
                              )
                            }
                            className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-950"
                          >
                            Rename
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmDeleteConversation(conversation)}
                            disabled={deletingId === conversation.id}
                            className="rounded-xl border border-red-900/50 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-950/30 disabled:opacity-50"
                          >
                            {deletingId === conversation.id ? "Deleting..." : "Delete"}
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
        <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-2">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
            <div className="flex flex-col">
              <h1 className="text-sm font-semibold text-zinc-100">
                {activeConversation?.title || "AI Chat"}
              </h1>
              <p className="text-[11px] text-zinc-500">
                {usageUsed}/{usageLimit} messages used
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createConversation}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-900 md:hidden"
              >
                New Chat
              </button>

              <button
                type="button"
                onClick={signOut}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-900"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-3">
            {limitReached && (
              <div className="mb-4 rounded-2xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                <div className="font-medium">Free plan limit reached</div>
                <div className="mt-1 text-amber-100/80">
                  You’ve reached your daily message limit. Upgrade to continue
                  using the app today.
                </div>
                <div className="mt-3">
                  <button
                    type="button"
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
                <div className="max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 text-center shadow-2xl">
                  <h2 className="text-xl font-semibold text-white">
                    Start a conversation
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {PRODUCT_DESCRIPTION}
                  </p>

                  <div className="mt-3 space-y-1 text-sm text-zinc-400">
                    <p className="font-medium text-zinc-300">Try asking:</p>
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() =>
                          handleStarterPrompt("What time is it in Georgia right now?")
                        }
                        className="block w-full text-left hover:text-white"
                      >
                        • What time is it in Georgia right now?
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleStarterPrompt("What’s the weather in Atlanta, GA?")
                        }
                        className="block w-full text-left hover:text-white"
                      >
                        • What’s the weather in Atlanta, GA?
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleStarterPrompt("Explain EU MDR in simple terms")
                        }
                        className="block w-full text-left hover:text-white"
                      >
                        • Explain EU MDR in simple terms
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    Ask a question, explore ideas, or get help quickly.
                  </p>

                  <button
                    type="button"
                    onClick={createConversation}
                    className="mt-6 rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:opacity-90"
                  >
                    New Chat
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => {
                  const isUser = message.role === "user";
                  const isLastMessage = index === messages.length - 1;
                  const canRegenerate = !isUser && isLastMessage && !loading;

                  return (
                    <div
                      key={message.id ?? `${message.created_at || "msg"}-${index}`}
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
                            <div className="space-y-2">
                              {message.imagePreview && (
                                <img
                                  src={message.imagePreview}
                                  alt="Uploaded"
                                  className="max-h-48 rounded-2xl border border-zinc-300"
                                />
                              )}

                              {message.content && (
                                <div className="whitespace-pre-wrap">
                                  {message.content}
                                </div>
                              )}
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
                                {message.content || (loading ? "Thinking..." : "")}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>

                        {!isUser &&
                          Array.isArray(message.sources) &&
                          message.sources.length > 0 && (
                            <div className="mt-4 space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                                Sources
                              </p>

                              {message.sources.map((source, sourceIndex) => (
                                <a
                                  key={`${source.url}-${sourceIndex}`}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 transition hover:border-zinc-700"
                                >
                                  <div className="text-sm font-medium text-zinc-100">
                                    {source.title}
                                  </div>

                                  <div className="mt-1 break-all text-xs text-zinc-500">
                                    {source.url}
                                  </div>

                                  {source.snippet ? (
                                    <div className="mt-2 text-sm leading-6 text-zinc-400">
                                      {source.snippet}
                                    </div>
                                  ) : null}
                                </a>
                              ))}
                            </div>
                          )}

                        {message.created_at && (
                          <div
                            className={`mt-2 text-[11px] ${
                              isUser ? "text-zinc-700" : "text-zinc-500"
                            }`}
                          >
                            {formatTimestamp(message.created_at)}
                          </div>
                        )}

                        {!isUser && message.content && (
                          <div className="mt-3 flex justify-end gap-2">
                            {canRegenerate && (
                              <button
                                type="button"
                                onClick={() => void regenerateResponse()}
                                disabled={loading || limitReached}
                                className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
                              >
                                Regenerate
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => void copyMessage(message.content, index)}
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

                {loading && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-3xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400 shadow-lg">
                      Thinking...
                    </div>
                  </div>
                )}

                <div ref={endRef} />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-800 bg-zinc-950">
          <div className="mx-auto w-full max-w-4xl px-4 py-3">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-2 shadow-xl">
              <div className="mb-2 flex items-center gap-2">
                <label className="cursor-pointer rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800">
                  Attach image
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </label>

                {selectedImage && (
                  <>
                    <div className="truncate text-xs text-zinc-400">
                      {selectedImage.name}
                    </div>
                    <button
                      onClick={clearSelectedImage}
                      type="button"
                      className="rounded-xl border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>

              {selectedImagePreview && (
                <div className="mb-2">
                  <img
                    src={selectedImagePreview}
                    alt="Selected preview"
                    className="max-h-32 rounded-2xl border border-zinc-800"
                  />
                </div>
              )}

              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
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
                className="max-h-32 min-h-[40px] w-full resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
              />

              <div className="mt-2 flex items-center justify-between">
                <p className="text-[11px] text-zinc-500">
                  {limitReached
                    ? "Free plan limit reached for today"
                    : "Press Enter to send, Shift+Enter for a new line"}
                </p>

                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={
                    !conversationId ||
                    (!input.trim() && !selectedImage) ||
                    loading ||
                    limitReached
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
                type="button"
                onClick={() => setConfirmDeleteConversation(null)}
                className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                Cancel
              </button>

              <button
                type="button"
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