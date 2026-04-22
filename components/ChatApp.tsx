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

type DocumentItem = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: "processing" | "ready" | "failed";
  extraction_error: string | null;
  conversation_id: string | null;
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

type UploadDocumentsResponse = {
  ok?: boolean;
  uploaded?: boolean;
  documents?: DocumentItem[];
  error?: string;
  summary?: {
    total?: number;
    ready?: number;
    failed?: number;
  };
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_LENGTH = 2000;

const APP_PANEL =
  "border border-white/10 bg-[linear-gradient(180deg,rgba(12,22,48,0.92),rgba(7,13,30,0.95))] backdrop-blur shadow-[0_18px_50px_rgba(0,0,0,0.3)]";

const APP_PANEL_SOFT =
  "border border-white/10 bg-[linear-gradient(180deg,rgba(14,24,52,0.9),rgba(9,16,34,0.92))] backdrop-blur";

const APP_PANEL_DARK =
  "border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,30,0.95),rgba(5,10,22,0.98))] backdrop-blur shadow-[0_12px_30px_rgba(0,0,0,0.24)]";

const APP_INPUT =
  "border border-white/10 bg-[linear-gradient(180deg,rgba(7,13,28,0.94),rgba(4,8,20,0.98))] backdrop-blur";

const APP_BUTTON_PRIMARY =
  "rounded-2xl bg-[linear-gradient(90deg,#2563EB,#4F8CFF)] text-white shadow-[0_12px_30px_rgba(37,99,235,0.35)] transition hover:scale-[1.02] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50";

const APP_BUTTON_SECONDARY =
  "rounded-xl border border-white/10 bg-white/[0.03] text-zinc-200 transition hover:bg-white/[0.06]";

const APP_MESSAGE_ASSISTANT =
  "border border-white/10 bg-[linear-gradient(180deg,rgba(10,18,40,0.9),rgba(6,12,28,0.95))] text-zinc-100 shadow-[0_10px_40px_rgba(0,0,0,0.4)]";

const APP_MESSAGE_USER =
  "border border-blue-400/15 bg-[linear-gradient(180deg,rgba(37,99,235,0.18),rgba(255,255,255,0.05))] text-white backdrop-blur shadow-[0_10px_30px_rgba(0,0,0,0.22)]";

export default function ChatApp({ userEmail }: ChatAppProps) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
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
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) || null,
    [conversations, conversationId]
  );

  const readyDocumentIds = useMemo(
    () =>
      documents
        .filter((doc) => doc.extraction_status === "ready")
        .map((doc) => doc.id),
    [documents]
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
        setDocuments([]);
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
    if (loading || uploading) return;

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
      setDocuments([]);
      setEditingConversationId(null);
      setEditingTitle("");
      clearSelectedImage();
      clearSelectedDocuments();

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

      const res = await fetch(
        `/api/messages?conversationId=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );

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

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  function clearSelectedDocuments() {
    setDocuments([]);
    if (documentInputRef.current) {
      documentInputRef.current.value = "";
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

  async function handleDocumentUpload(files: FileList | null) {
    if (!files || !conversationId) return;

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();

      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });

      formData.append("conversationId", conversationId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data: UploadDocumentsResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      const newDocs: DocumentItem[] = Array.isArray(data.documents)
        ? data.documents.filter(
            (doc): doc is DocumentItem =>
              Boolean(doc) &&
              typeof doc === "object" &&
              typeof doc.id === "string" &&
              typeof doc.file_name === "string" &&
              typeof doc.mime_type === "string"
          )
        : [];

      setDocuments((prev) => [...prev, ...newDocs]);
    } catch (err) {
      console.error("UPLOAD ERROR:", err);
      setError(err instanceof Error ? err.message : "Document upload failed.");
    } finally {
      setUploading(false);
      if (documentInputRef.current) {
        documentInputRef.current.value = "";
      }
    }
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

  async function readTextResponse(res: Response): Promise<string> {
    if (!res.body) {
      return (await res.text()).trim();
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;

      fullText += chunk;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];

        if (last?.role === "assistant" && last.id === "streaming-assistant") {
          next[next.length - 1] = {
            ...last,
            content: fullText,
          };
        }

        return next;
      });
    }

    fullText += decoder.decode();
    return fullText.trim();
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

    const payload = {
      conversationId: targetConversationId,
      message,
      regenerate,
      imageBase64,
      documentIds: route === "/api/chat" ? readyDocumentIds : [],
    };

    if (route === "/api/chat") {
      setMessages((prev) => [
        ...prev,
        {
          id: "streaming-assistant",
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);
    }

    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      if (route === "/api/chat") {
        setMessages((prev) =>
          prev.filter((messageItem) => messageItem.id !== "streaming-assistant")
        );
      }

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

    if (route === "/api/chat") {
      const assistantContent = await readTextResponse(res);
      const finalContent =
        assistantContent || "I couldn’t generate a complete response.";

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];

        if (last?.role === "assistant" && last.id === "streaming-assistant") {
          next[next.length - 1] = {
            ...last,
            id: crypto.randomUUID(),
            content: finalContent,
          };
        }

        return next;
      });

      setLimitReached(false);
      return;
    }

    const data: ChatSuccessResponse = await res.json();

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

    if ((!trimmed && !hasImage) || !conversationId || loading || uploading) {
      return;
    }

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
          const next = [...prev].filter(
            (messageItem) => messageItem.id !== "streaming-assistant"
          );

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

      setMessages((prev) => {
        const next = [...prev].filter(
          (messageItem) => messageItem.id !== "streaming-assistant"
        );

        next.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Sorry, something went wrong while generating a reply.",
          created_at: new Date().toISOString(),
        });

        return next;
      });

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
    if (!conversationId || loading || uploading) return;

    setError(null);
    setLoading(true);

    const previousUsage = usageUsed;
    setUsageUsed((prev) => Math.min(prev + 1, usageLimit));

    const removedAssistantMessage =
      [...messages].reverse().find((message) => message.role === "assistant") ??
      null;

    setMessages((prev) => {
      const next = [...prev].filter(
        (messageItem) => messageItem.id !== "streaming-assistant"
      );

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

  function getDocumentStatusLabel(document: DocumentItem) {
    switch (document.extraction_status) {
      case "ready":
        return "Ready";
      case "failed":
        return "Extraction failed";
      default:
        return "Processing";
    }
  }

  function getDocumentStatusClass(document: DocumentItem) {
    switch (document.extraction_status) {
      case "ready":
        return "text-green-400";
      case "failed":
        return "text-red-400";
      default:
        return "text-amber-400";
    }
  }

  useEffect(() => {
    void loadConversations();
    void loadUsage();
  }, []);

  useEffect(() => {
    if (conversationId) {
      void loadMessages(conversationId);
      setDocuments([]);
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
    <main className="relative flex h-[100dvh] overflow-hidden bg-transparent text-zinc-100">
      <aside
        className={`relative hidden w-80 border-r border-white/10 md:flex md:flex-col ${APP_PANEL_DARK}`}
      >
        <div className="border-b border-white/10 p-4">
          <div className="mb-3">
            <div className="text-sm font-medium text-zinc-100">{userEmail}</div>
            <div className="mt-1 text-xs text-zinc-400">
              {usageUsed}/{usageLimit} messages used today
            </div>
          </div>

          <button
            type="button"
            onClick={createConversation}
            className={`w-full px-4 py-3 text-sm font-medium ${APP_BUTTON_PRIMARY}`}
          >
            + New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {sidebarLoading ? (
            <div className="space-y-2">
              <div className={`h-14 animate-pulse rounded-2xl ${APP_PANEL_SOFT}`} />
              <div className={`h-14 animate-pulse rounded-2xl ${APP_PANEL_SOFT}`} />
              <div className={`h-14 animate-pulse rounded-2xl ${APP_PANEL_SOFT}`} />
            </div>
          ) : conversations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-zinc-400">
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
                        ? "border-blue-400/25 bg-[linear-gradient(180deg,rgba(20,40,90,0.28),rgba(10,20,50,0.34))]"
                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
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
                          className={`w-full rounded-xl px-3 py-2 text-sm text-zinc-100 outline-none ${APP_INPUT}`}
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
                            className={`px-3 py-1.5 text-xs font-medium ${APP_BUTTON_PRIMARY}`}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingConversationId(null);
                              setEditingTitle("");
                            }}
                            className={`px-3 py-1.5 text-xs ${APP_BUTTON_SECONDARY}`}
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
                            className={`px-3 py-1.5 text-xs ${APP_BUTTON_SECONDARY}`}
                          >
                            Rename
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmDeleteConversation(conversation)}
                            disabled={deletingId === conversation.id}
                            className="rounded-xl border border-red-900/40 bg-red-950/10 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-950/20 disabled:opacity-50"
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

      <section className="relative flex flex-1 flex-col">
        <header className={`border-b border-white/10 px-6 py-4 ${APP_PANEL_DARK}`}>
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
            <div className="flex flex-col">
              <h1 className="text-sm font-semibold text-zinc-100">
                {activeConversation?.title || "AI Chat"}
              </h1>
              <p className="text-[11px] text-zinc-400">
                {usageUsed}/{usageLimit} messages used
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createConversation}
                className={`px-3 py-2 text-xs font-medium md:hidden ${APP_BUTTON_SECONDARY}`}
              >
                New Chat
              </button>

              <button
                type="button"
                onClick={signOut}
                className={`px-3 py-2 text-xs font-medium ${APP_BUTTON_SECONDARY}`}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-3">
            {limitReached && (
              <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 backdrop-blur">
                <div className="font-medium">Free plan limit reached</div>
                <div className="mt-1 text-amber-100/80">
                  You’ve reached your daily message limit. Upgrade to continue
                  using the app today.
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    className={`px-3 py-2 text-xs font-medium ${APP_BUTTON_PRIMARY}`}
                    onClick={() => setError("Upgrade flow not connected yet.")}
                  >
                    Upgrade
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100 backdrop-blur">
                {error}
              </div>
            )}

            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className={`max-w-md rounded-3xl p-6 text-center shadow-2xl ${APP_PANEL}`}>
                  <h2 className="text-xl font-semibold text-white">
                    Start a conversation
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {PRODUCT_DESCRIPTION}
                  </p>

                  <div className="mt-3 space-y-1 text-sm text-zinc-400">
                    <p className="font-medium text-zinc-200">Try asking:</p>
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
                    className={`mt-6 px-5 py-3 text-sm font-medium ${APP_BUTTON_PRIMARY}`}
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
                        className={`max-w-[85%] rounded-3xl px-4 py-3 md:max-w-[75%] ${
                          isUser ? APP_MESSAGE_USER : APP_MESSAGE_ASSISTANT
                        }`}
                      >
                        <div className="break-words text-sm leading-7">
                          {isUser ? (
                            <div className="space-y-2">
                              {message.imagePreview && (
                                <img
                                  src={message.imagePreview}
                                  alt="Uploaded"
                                  className="max-h-48 rounded-2xl border border-white/15"
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
                                prose-pre:border-white/10
                                prose-pre:bg-[#050B17]
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
                                  className={`block rounded-2xl px-3 py-3 transition hover:border-blue-400/20 ${APP_PANEL_DARK}`}
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
                              isUser ? "text-white/70" : "text-zinc-500"
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
                                disabled={loading || limitReached || uploading}
                                className={`px-3 py-1.5 text-xs ${APP_BUTTON_SECONDARY}`}
                              >
                                Regenerate
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => void copyMessage(message.content, index)}
                              className={`px-3 py-1.5 text-xs ${APP_BUTTON_SECONDARY}`}
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
                    <div
                      className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm text-zinc-300 md:max-w-[75%] ${APP_MESSAGE_ASSISTANT}`}
                    >
                      Thinking...
                    </div>
                  </div>
                )}

                <div ref={endRef} />
              </div>
            )}
          </div>
        </div>

        <div className={`border-t border-white/10 ${APP_PANEL_DARK}`}>
          <div className="mx-auto w-full max-w-4xl px-4 py-3">
            <div
              className={`rounded-3xl p-2 shadow-xl ${APP_PANEL}
                focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.4),0_0_25px_rgba(59,130,246,0.18)]`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label
                  className={`cursor-pointer px-3 py-2 text-xs text-zinc-300 ${APP_BUTTON_SECONDARY}`}
                >
                  Attach document
                  <input
                    ref={documentInputRef}
                    type="file"
                    multiple
                    onChange={(event) => {
                      void handleDocumentUpload(event.target.files);
                    }}
                    className="hidden"
                  />
                </label>

                <label
                  className={`cursor-pointer px-3 py-2 text-xs text-zinc-300 ${APP_BUTTON_SECONDARY}`}
                >
                  Attach image
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </label>

                {uploading && (
                  <div className="text-xs text-amber-400">
                    Uploading documents...
                  </div>
                )}

                {selectedImage && (
                  <>
                    <div className="truncate text-xs text-zinc-400">
                      {selectedImage.name}
                    </div>
                    <button
                      onClick={clearSelectedImage}
                      type="button"
                      className={`px-3 py-1 text-xs ${APP_BUTTON_SECONDARY}`}
                    >
                      Remove image
                    </button>
                  </>
                )}

                {documents.length > 0 && (
                  <button
                    type="button"
                    onClick={clearSelectedDocuments}
                    className={`px-3 py-1 text-xs ${APP_BUTTON_SECONDARY}`}
                  >
                    Clear documents
                  </button>
                )}
              </div>

              {documents.length > 0 && (
                <div className="mb-3 space-y-2">
                  {documents.map((doc) => {
                    if (!doc || typeof doc !== "object") return null;

                    return (
                      <div
                        key={doc.id}
                        className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs ${APP_PANEL_DARK}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-zinc-200">
                            {doc.file_name || "Unknown file"}
                          </div>

                          {doc.extraction_error ? (
                            <div className="mt-1 truncate text-[11px] text-zinc-500">
                              {doc.extraction_error}
                            </div>
                          ) : null}
                        </div>

                        <span
                          className={`shrink-0 font-medium ${getDocumentStatusClass(doc)}`}
                        >
                          {getDocumentStatusLabel(doc)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedImagePreview && (
                <div className="mb-2">
                  <img
                    src={selectedImagePreview}
                    alt="Selected preview"
                    className="max-h-32 rounded-2xl border border-white/10"
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
                disabled={!conversationId || loading || uploading || limitReached}
                className="max-h-32 min-h-[40px] w-full resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
              />

              <div className="mt-2 flex items-center justify-between">
                <p className="text-[11px] text-zinc-500">
                  {limitReached
                    ? "Free plan limit reached for today"
                    : uploading
                      ? "Uploading documents..."
                      : "Press Enter to send, Shift+Enter for a new line"}
                </p>

                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={
                    !conversationId ||
                    (!input.trim() && !selectedImage) ||
                    loading ||
                    uploading ||
                    limitReached
                  }
                  className={`px-4 py-2 text-sm font-medium ${APP_BUTTON_PRIMARY}`}
                >
                  {uploading
                    ? "Uploading..."
                    : loading
                      ? "Sending..."
                      : limitReached
                        ? "Locked"
                        : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {confirmDeleteConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className={`w-full max-w-md rounded-3xl p-6 shadow-2xl ${APP_PANEL}`}>
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
                className={`px-4 py-2 text-sm ${APP_BUTTON_SECONDARY}`}
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