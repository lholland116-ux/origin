"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceItem[];
};

type ConversationItem = {
  id: string;
  title: string | null;
  updated_at: string;
};

type ChatClientProps = {
  userEmail: string;
  initialConversationId: string;
  initialMessages: Message[];
  initialConversations: ConversationItem[];
};

type ChatWebResponse = {
  reply?: string;
  sources?: SourceItem[];
  error?: string;
};

type UsageState = {
  used: number;
  limit: number;
  remaining: number;
};

const MAX_INPUT_LENGTH = 2000;
const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1024;
const JPEG_QUALITY = 0.72;

function createId() {
  return crypto.randomUUID();
}

async function fileToProcessedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose a valid image file.");
  }

  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error("Image file is too large.");
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read image."));
      }
    };

    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image."));
    img.src = rawDataUrl;
  });

  let width = image.width;
  let height = image.height;

  if (width <= 0 || height <= 0) {
    throw new Error("Invalid image dimensions.");
  }

  if (width > height && width > MAX_IMAGE_DIMENSION) {
    height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
    width = MAX_IMAGE_DIMENSION;
  } else if (height > MAX_IMAGE_DIMENSION) {
    width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
    height = MAX_IMAGE_DIMENSION;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to process image.");
  }

  ctx.drawImage(image, 0, 0, width, height);

  const processedDataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  if (!processedDataUrl.startsWith("data:image/")) {
    throw new Error("Processed image format is invalid.");
  }

  return processedDataUrl;
}

export default function ChatClient({
  userEmail,
  initialConversationId,
  initialMessages,
  initialConversations,
}: ChatClientProps) {
  const supabase = createClient();

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);

  const [conversationId, setConversationId] = useState(initialConversationId);
  const [conversations, setConversations] =
    useState<ConversationItem[]>(initialConversations);
  const [sidebarLoading, setSidebarLoading] = useState(false);

  const [usage, setUsage] = useState<UsageState | null>(null);
  const [usageError, setUsageError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const modeLabel = useMemo(() => {
    if (useWebSearch) return "Using web search";
    if (imageBase64) return "Image attached";
    return "Standard assistant";
  }, [useWebSearch, imageBase64]);

  const isLimitReached = Boolean(
    usage && usage.limit > 0 && usage.remaining <= 0
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: loading ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    fetchUsage();
  }, []);

  function clearImage() {
    setImageBase64(null);
    setImageName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function updateAssistantMessage(
    messageId: string,
    updater: (msg: Message) => Message
  ) {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? updater(msg) : msg))
    );
  }

  async function fetchUsage() {
    try {
      setUsageError("");

      const res = await fetch("/api/usage", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load usage.");
      }

      const data = await res.json();

      setUsage({
        used: typeof data?.used === "number" ? data.used : 0,
        limit: typeof data?.limit === "number" ? data.limit : 0,
        remaining: typeof data?.remaining === "number" ? data.remaining : 0,
      });
    } catch (error) {
      setUsageError(
        error instanceof Error ? error.message : "Failed to load usage."
      );
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function refreshConversations(preferredId?: string) {
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (!res.ok) return;

    const data = await res.json();
    const rows = Array.isArray(data?.conversations) ? data.conversations : [];

    setConversations(rows);

    if (preferredId) {
      const found = rows.find((c: ConversationItem) => c.id === preferredId);
      if (found) {
        setConversationId(preferredId);
      }
    }
  }

  async function loadConversation(nextConversationId: string) {
    if (loading || nextConversationId === conversationId) return;

    setSidebarLoading(true);
    clearImage();
    setInput("");

    try {
      const res = await fetch(
        `/api/messages?conversationId=${encodeURIComponent(nextConversationId)}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        throw new Error("Failed to load messages.");
      }

      const data = await res.json();
      const nextMessages = Array.isArray(data?.messages) ? data.messages : [];

      setConversationId(nextConversationId);
      setMessages(nextMessages);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to load conversation."
      );
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleNewChat() {
    if (loading) return;

    setSidebarLoading(true);
    clearImage();
    setInput("");

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "New Chat" }),
      });

      if (!res.ok) {
        throw new Error("Failed to create conversation.");
      }

      const data = await res.json();
      const newConversationId =
        typeof data?.conversation?.id === "string"
          ? data.conversation.id
          : typeof data?.id === "string"
            ? data.id
            : "";

      if (!newConversationId) {
        throw new Error("Conversation ID missing.");
      }

      await refreshConversations(newConversationId);
      setConversationId(newConversationId);
      setMessages([]);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to create conversation."
      );
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleRenameConversation(target: ConversationItem) {
    if (loading || sidebarLoading) return;

    const nextTitle = window.prompt(
      "Rename conversation",
      target.title?.trim() || "New Chat"
    );

    if (!nextTitle) return;

    const trimmed = nextTitle.trim();
    if (!trimmed) return;

    setSidebarLoading(true);

    try {
      const res = await fetch("/api/conversations", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: target.id,
          title: trimmed,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to rename conversation.");
      }

      await refreshConversations(target.id);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to rename conversation."
      );
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleDeleteConversation(target: ConversationItem) {
    if (loading || sidebarLoading) return;

    const confirmed = window.confirm(
      `Delete "${target.title?.trim() || "New Chat"}"?`
    );

    if (!confirmed) return;

    setSidebarLoading(true);

    try {
      const res = await fetch(
        `/api/conversations?id=${encodeURIComponent(target.id)}`,
        {
          method: "DELETE",
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete conversation.");
      }

      const remaining = conversations.filter((c) => c.id !== target.id);

      if (target.id === conversationId) {
        if (remaining.length > 0) {
          const fallbackId = remaining[0].id;
          await refreshConversations(fallbackId);
          await loadConversation(fallbackId);
        } else {
          await handleNewChat();
        }
      } else {
        await refreshConversations(conversationId);
      }
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Failed to delete conversation."
      );
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleImageChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (useWebSearch) {
      window.alert("Image upload is only available in Standard mode.");
      clearImage();
      return;
    }

    setUploadingImage(true);

    try {
      const processed = await fileToProcessedDataUrl(file);
      setImageBase64(processed);
      setImageName(file.name);
    } catch (error) {
      clearImage();
      window.alert(
        error instanceof Error ? error.message : "Failed to process image."
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmed = input.trim();
    const hasImage = Boolean(imageBase64);

    if (loading || uploadingImage || (!trimmed && !hasImage)) return;

    if (isLimitReached) {
      window.alert("You’ve reached your daily message limit.");
      return;
    }

    if (!conversationId) {
      window.alert("Missing conversationId.");
      return;
    }

    if (trimmed.length > MAX_INPUT_LENGTH) {
      window.alert(`Message too long. Maximum ${MAX_INPUT_LENGTH} characters.`);
      return;
    }

    if (useWebSearch && hasImage) {
      window.alert("Web Search mode does not support image upload.");
      return;
    }

    const userVisibleContent =
      trimmed || (hasImage
        ? `[Image attached${imageName ? `: ${imageName}` : ""}]`
        : "");

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: userVisibleContent,
    };

    const assistantId = createId();

    const assistantPlaceholder: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      sources: [],
    };

    const payloadImage = imageBase64;

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput("");
    clearImage();
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const endpoint = useWebSearch ? "/api/chat-web" : "/api/chat";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          message: trimmed,
          imageBase64: payloadImage,
        }),
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const errorData = (await res.json()) as { error?: string };
          throw new Error(errorData?.error || "Request failed.");
        }

        const text = await res.text();
        throw new Error(text || "Request failed.");
      }

      if (useWebSearch) {
        const data = (await res.json()) as ChatWebResponse;

        const reply =
          typeof data.reply === "string" && data.reply.trim().length > 0
            ? data.reply.trim()
            : "No response generated.";

        const sources = Array.isArray(data.sources) ? data.sources : [];

        updateAssistantMessage(assistantId, (msg) => ({
          ...msg,
          content: reply,
          sources,
        }));
      } else {
        if (!res.body) {
          throw new Error("Streaming response body is missing.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;

          updateAssistantMessage(assistantId, (msg) => ({
            ...msg,
            content: fullText,
          }));
        }

        updateAssistantMessage(assistantId, (msg) => ({
          ...msg,
          content: msg.content.trim() || "No response generated.",
        }));
      }

      await refreshConversations(conversationId);
      await fetchUsage();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updateAssistantMessage(assistantId, (msg) => ({
          ...msg,
          content: msg.content.trim() || "Generation stopped.",
        }));
        return;
      }

      updateAssistantMessage(assistantId, () => ({
        id: assistantId,
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.",
        sources: [],
      }));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleModeChange(nextUseWebSearch: boolean) {
    if (loading) return;

    if (nextUseWebSearch) {
      clearImage();
    }

    setUseWebSearch(nextUseWebSearch);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen">
        <aside className="hidden w-80 shrink-0 border-r border-neutral-800 bg-neutral-950 md:flex md:flex-col">
          <div className="border-b border-neutral-800 p-4">
            <div className="text-sm font-semibold truncate">{userEmail}</div>

            {usage && (
              <div className="mt-2 text-xs text-neutral-400">
                {usage.used} / {usage.limit} messages used today
              </div>
            )}

            {usage && usage.remaining > 0 && usage.remaining <= 5 && (
              <div className="mt-1 text-xs text-yellow-400">
                Only {usage.remaining} messages remaining today
              </div>
            )}

            {isLimitReached && (
              <div className="mt-2 rounded-lg border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
                Daily limit reached. Come back tomorrow or upgrade your plan.
              </div>
            )}

            {usageError && (
              <div className="mt-2 text-xs text-red-400">{usageError}</div>
            )}

            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleNewChat}
                disabled={loading || sidebarLoading}
                className="rounded-xl bg-white px-4 py-2 text-sm text-black disabled:opacity-50"
              >
                New Chat
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-white"
              >
                Sign Out
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
              Chat History
            </div>

            <div className="space-y-2">
              {conversations.map((conversation) => {
                const isActive = conversation.id === conversationId;

                return (
                  <div
                    key={conversation.id}
                    className={`rounded-xl p-2 transition ${
                      isActive
                        ? "bg-white text-black"
                        : "bg-neutral-900 text-white"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => loadConversation(conversation.id)}
                      disabled={loading || sidebarLoading}
                      className="w-full text-left"
                    >
                      <div className="truncate font-medium">
                        {conversation.title?.trim() || "New Chat"}
                      </div>
                      <div
                        className={`mt-1 text-xs ${
                          isActive ? "text-neutral-700" : "text-neutral-400"
                        }`}
                      >
                        {new Date(conversation.updated_at).toLocaleString()}
                      </div>
                    </button>

                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleRenameConversation(conversation)}
                        disabled={loading || sidebarLoading}
                        className={`rounded-lg px-2 py-1 text-xs ${
                          isActive
                            ? "bg-black/10 text-black hover:bg-black/20"
                            : "border border-neutral-700 text-neutral-300 hover:border-neutral-500"
                        }`}
                      >
                        Rename
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteConversation(conversation)}
                        disabled={loading || sidebarLoading}
                        className={`rounded-lg px-2 py-1 text-xs ${
                          isActive
                            ? "bg-red-600/15 text-red-700 hover:bg-red-600/25"
                            : "border border-red-900/60 text-red-400 hover:border-red-700"
                        }`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="flex min-h-screen flex-1 flex-col bg-black">
          <div className="sticky top-0 z-20 border-b border-neutral-800 bg-black/95 backdrop-blur">
            <div className="mx-auto w-full max-w-4xl px-4 py-4">
              <p className="text-xs text-neutral-400">Origin Sable</p>
              <h1 className="text-2xl font-bold">AI Assistant</h1>
              <p className="text-sm text-neutral-400">Logged in as {userEmail}</p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleNewChat}
                  disabled={loading || sidebarLoading}
                  className="rounded-xl border border-neutral-700 px-3 py-2 text-sm text-white md:hidden"
                >
                  New Chat
                </button>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="rounded-xl border border-neutral-700 px-3 py-2 text-sm text-white md:hidden"
                >
                  Sign Out
                </button>

                <button
                  type="button"
                  onClick={() => handleModeChange(false)}
                  disabled={loading}
                  className={`rounded-xl px-3 py-2 text-sm transition ${
                    !useWebSearch
                      ? "bg-white text-black"
                      : "border border-neutral-700 bg-neutral-900 text-white"
                  }`}
                >
                  Standard
                </button>

                <button
                  type="button"
                  onClick={() => handleModeChange(true)}
                  disabled={loading}
                  className={`rounded-xl px-3 py-2 text-sm transition ${
                    useWebSearch
                      ? "bg-white text-black"
                      : "border border-neutral-700 bg-neutral-900 text-white"
                  }`}
                >
                  Web Search
                </button>

                <span className="text-xs text-neutral-400">{modeLabel}</span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl px-4 py-6">
              <div className="space-y-4">
                {messages.map((m) => {
                  const sources = Array.isArray(m.sources) ? m.sources : [];
                  const isStreamingAssistant =
                    loading &&
                    m.role === "assistant" &&
                    m.id === messages[messages.length - 1]?.id;

                  return (
                    <div key={m.id} className="space-y-2">
                      <div
                        className={`w-full max-w-3xl rounded-2xl p-4 whitespace-pre-wrap break-words ${
                          m.role === "user"
                            ? "ml-auto bg-white text-black"
                            : "mr-auto bg-neutral-900 text-white"
                        }`}
                      >
                        {m.content}
                        {isStreamingAssistant ? (
                          <span className="ml-1 inline-block animate-pulse">▍</span>
                        ) : null}
                      </div>

                      {sources.length > 0 && (
                        <div className="mr-auto w-full max-w-3xl space-y-2">
                          {sources.map((s, j) => (
                            <a
                              key={`${s.url}-${j}`}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-xl border border-neutral-800 bg-neutral-950 p-3 transition hover:border-neutral-700"
                            >
                              <div className="text-xs text-blue-400 underline">
                                {s.title}
                              </div>
                              {s.snippet ? (
                                <div className="mt-1 text-xs text-neutral-400">
                                  {s.snippet}
                                </div>
                              ) : null}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {loading && messages.length > 0 && (
                  <div className="mr-auto w-full max-w-3xl text-xs text-neutral-500">
                    {useWebSearch
                      ? "Using web search..."
                      : imageBase64
                        ? "Analyzing image..."
                        : "Thinking..."}
                  </div>
                )}

                <div ref={endRef} />
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 z-20 border-t border-neutral-800 bg-black/95 backdrop-blur">
            <div className="mx-auto w-full max-w-4xl px-4 py-4 space-y-3">
              {!useWebSearch && (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center rounded-xl border border-neutral-700 px-3 py-2 text-sm text-white transition hover:border-neutral-500">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        disabled={loading || uploadingImage || isLimitReached}
                        className="hidden"
                      />
                      {uploadingImage ? "Processing image..." : "Attach image"}
                    </label>

                    {imageName ? (
                      <span className="text-xs text-neutral-400">{imageName}</span>
                    ) : (
                      <span className="text-xs text-neutral-500">
                        JPG, PNG, WEBP supported
                      </span>
                    )}

                    {imageBase64 && !loading && (
                      <button
                        type="button"
                        onClick={clearImage}
                        className="rounded-xl border border-neutral-700 px-3 py-2 text-sm text-white transition hover:border-neutral-500"
                      >
                        Remove image
                      </button>
                    )}
                  </div>

                  {imageBase64 && (
                    <div className="mt-3">
                      <img
                        src={imageBase64}
                        alt="Selected upload preview"
                        className="max-h-64 rounded-xl border border-neutral-800 object-contain"
                      />
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 rounded-2xl bg-neutral-900 p-4 outline-none"
                  placeholder={
                    useWebSearch
                      ? "Ask something with web search..."
                      : imageBase64
                        ? "Add context for the image, or send without text..."
                        : "Ask something..."
                  }
                  maxLength={MAX_INPUT_LENGTH}
                  disabled={loading || uploadingImage || isLimitReached}
                />

                {loading ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="rounded-2xl border border-neutral-700 px-5 text-white"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      uploadingImage ||
                      isLimitReached ||
                      (!imageBase64 && input.trim().length === 0)
                    }
                    className="rounded-2xl bg-white px-5 text-black disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send
                  </button>
                )}
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}