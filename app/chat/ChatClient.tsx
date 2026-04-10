"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import DocumentUploadButton from "@/components/DocumentUploadButton";
import DocumentChip from "@/components/DocumentChip";
import { validateFiles } from "@/lib/documents/validate-upload";

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
  image_path?: string | null;
  image_name?: string | null;
  image_url?: string | null;
};

type ConversationItem = {
  id: string;
  title: string | null;
  updated_at: string;
};

type UploadedDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: "uploading" | "processing" | "ready" | "failed";
  conversation_id: string | null;
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

type DocumentsResponse = {
  documents?: UploadedDocument[];
  error?: string;
};

const MAX_INPUT_LENGTH = 2000;
const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1024;
const JPEG_QUALITY = 0.72;
const DOCUMENT_POLL_INTERVAL_MS = 2000;
const DOCUMENT_POLL_MAX_ATTEMPTS = 10;

const PRODUCT_DESCRIPTION =
  "A multimodal AI workspace for chat, image understanding, document analysis, and web-assisted answers with saved conversation history.";

const CONVERSATION_STARTERS = [
  "Summarize this image for me",
  "Summarize this document for me",
  "Help me brainstorm a SaaS feature",
  "Explain something step by step",
];

const CONTENT_RAIL_CLASS = "mx-auto w-full max-w-4xl px-4";
const ASSISTANT_BUBBLE_CLASS = "w-full max-w-3xl";
const USER_BUBBLE_CLASS = "w-full max-w-2xl";

function createId() {
  return crypto.randomUUID();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeUploadedDocuments(input: unknown): UploadedDocument[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object")
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : createId(),
      file_name:
        typeof item.file_name === "string"
          ? item.file_name
          : "Untitled document",
      mime_type: typeof item.mime_type === "string" ? item.mime_type : "",
      size_bytes: typeof item.size_bytes === "number" ? item.size_bytes : 0,
      extraction_status:
        item.extraction_status === "uploading" ||
        item.extraction_status === "processing" ||
        item.extraction_status === "ready" ||
        item.extraction_status === "failed"
          ? item.extraction_status
          : "failed",
      conversation_id:
        typeof item.conversation_id === "string" ? item.conversation_id : null,
    }));
}

export default function ChatClient({
  userEmail,
  initialConversationId,
  initialMessages,
  initialConversations,
}: ChatClientProps) {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [attachedDocuments, setAttachedDocuments] = useState<UploadedDocument[]>(
    []
  );
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [documentError, setDocumentError] = useState("");

  const [conversationId, setConversationId] = useState(initialConversationId);
  const [conversations, setConversations] =
    useState<ConversationItem[]>(initialConversations);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [usage, setUsage] = useState<UsageState | null>(null);
  const [usageError, setUsageError] = useState("");
  const [uiError, setUiError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const activeDocumentPollRef = useRef(0);

  const readyDocumentIds = useMemo(
    () =>
      attachedDocuments
        .filter((doc) => doc.extraction_status === "ready")
        .map((doc) => doc.id),
    [attachedDocuments]
  );

  const hasPendingDocuments = useMemo(
    () =>
      attachedDocuments.some(
        (doc) =>
          doc.extraction_status === "uploading" ||
          doc.extraction_status === "processing"
      ),
    [attachedDocuments]
  );

  const modeLabel = useMemo(() => {
    if (useWebSearch) return "Using web search";
    if (imageBase64) return "Image attached";
    if (attachedDocuments.length > 0) return "Documents attached";
    return "Standard assistant";
  }, [useWebSearch, imageBase64, attachedDocuments.length]);

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
    void fetchUsage();
  }, []);

  useEffect(() => {
    void fetchDocuments(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !hasPendingDocuments) {
      return;
    }

    const pollId = ++activeDocumentPollRef.current;

    void (async () => {
      for (let attempt = 0; attempt < DOCUMENT_POLL_MAX_ATTEMPTS; attempt++) {
        await sleep(DOCUMENT_POLL_INTERVAL_MS);

        if (pollId !== activeDocumentPollRef.current) {
          return;
        }

        const docs = await fetchDocuments(conversationId, { silent: true });
        if (!docs) return;

        const stillPending = docs.some(
          (doc) =>
            doc.extraction_status === "uploading" ||
            doc.extraction_status === "processing"
        );

        if (!stillPending) {
          return;
        }
      }
    })();

    return () => {
      activeDocumentPollRef.current++;
    };
  }, [conversationId, hasPendingDocuments]);

  function clearImage() {
    setImageBase64(null);
    setImageName("");
    setImagePath(null);

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  function clearDocuments() {
    setAttachedDocuments([]);
    setDocumentError("");
    activeDocumentPollRef.current++;
  }

  function updateAssistantMessage(
    messageId: string,
    updater: (msg: Message) => Message
  ) {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? updater(msg) : msg))
    );
  }

  function handleConversationStarterClick(starter: string) {
    if (loading || isLimitReached) return;
    setInput(starter);
    setUiError("");
  }

  function handleOpenImagePicker() {
    if (
      loading ||
      uploadingImage ||
      isUploadingDocuments ||
      isLimitReached ||
      useWebSearch
    ) {
      return;
    }

    imageInputRef.current?.click();
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

  async function fetchDocuments(
    targetConversationId: string,
    options?: { silent?: boolean }
  ): Promise<UploadedDocument[] | null> {
    if (!targetConversationId) {
      clearDocuments();
      return [];
    }

    try {
      if (!options?.silent) {
        setDocumentError("");
      }

      const res = await fetch(
        `/api/documents?conversationId=${encodeURIComponent(
          targetConversationId
        )}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | DocumentsResponse
          | null;
        throw new Error(data?.error || "Failed to load documents.");
      }

      const data = (await res.json()) as DocumentsResponse;
      const normalized = normalizeUploadedDocuments(data.documents);
      setAttachedDocuments(normalized);
      return normalized;
    } catch (error) {
      if (!options?.silent) {
        setDocumentError(
          error instanceof Error ? error.message : "Failed to load documents."
        );
      }
      return null;
    }
  }

  async function getSignedImageUrl(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from("chat-images")
      .createSignedUrl(path, 60 * 60);

    if (error) {
      console.error("Signed URL error:", error);
      return null;
    }

    return data.signedUrl;
  }

  async function uploadImageToStorage(file: File): Promise<{
    path: string;
    name: string;
    dataUrl: string;
  }> {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error("You must be signed in to upload images.");
    }

    const processedDataUrl = await fileToProcessedDataUrl(file);

    const fileExt =
      file.name.split(".").pop()?.toLowerCase() ||
      (processedDataUrl.startsWith("data:image/png") ? "png" : "jpg");

    const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;

    const response = await fetch(processedDataUrl);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage
      .from("chat-images")
      .upload(filePath, blob, {
        contentType: blob.type || file.type || "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    return {
      path: filePath,
      name: file.name,
      dataUrl: processedDataUrl,
    };
  }

  async function handleFilesSelected(files: File[]) {
    if (useWebSearch) {
      setDocumentError("Document upload is only available in Standard mode.");
      return;
    }

    const validationError = validateFiles(files);
    if (validationError) {
      setDocumentError(validationError);
      return;
    }

    if (!conversationId) {
      setDocumentError("Missing conversationId.");
      return;
    }

    try {
      setIsUploadingDocuments(true);
      setDocumentError("");
      setUiError("");

      const optimisticDocs: UploadedDocument[] = files.map((file, index) => ({
        id: `temp-${Date.now()}-${index}`,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        extraction_status: "uploading",
        conversation_id: conversationId,
      }));

      setAttachedDocuments((prev) => [...prev, ...optimisticDocs]);

      const formData = new FormData();

      for (const file of files) {
        formData.append("files", file);
      }

      formData.append("conversationId", conversationId);

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json().catch(() => null)) as
        | DocumentsResponse
        | null;

      if (!res.ok) {
        throw new Error(data?.error || "Upload failed.");
      }

      // Do not trust optimistic state or upload response as final truth.
      // Always refresh from the backend.
      await fetchDocuments(conversationId, { silent: true });
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : "Upload failed."
      );
      await fetchDocuments(conversationId, { silent: true });
    } finally {
      setIsUploadingDocuments(false);
    }
  }

  function removeAttachedDocument(id: string) {
    setAttachedDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }

  async function handleSignOut() {
    try {
      setUiError("");
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      router.push("/login");
      router.refresh();
    } catch (error) {
      setUiError(
        error instanceof Error ? error.message : "Failed to sign out."
      );
    }
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
    setUiError("");
    setDocumentError("");
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
      const rawMessages = Array.isArray(data?.messages) ? data.messages : [];

      const nextMessages = await Promise.all(
        rawMessages.map(async (msg: Message) => {
          if (msg.image_path) {
            const imageUrl = await getSignedImageUrl(msg.image_path);
            return { ...msg, image_url: imageUrl };
          }
          return msg;
        })
      );

      setConversationId(nextConversationId);
      setMessages(nextMessages);
      await fetchDocuments(nextConversationId);
    } catch (error) {
      setUiError(
        error instanceof Error ? error.message : "Failed to load conversation."
      );
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleMobileConversationOpen(nextConversationId: string) {
    await loadConversation(nextConversationId);
    setMobileMenuOpen(false);
  }

  async function handleNewChat() {
    if (loading) return;

    setSidebarLoading(true);
    setUiError("");
    setDocumentError("");
    clearImage();
    clearDocuments();
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
      setAttachedDocuments([]);
      setMobileMenuOpen(false);
    } catch (error) {
      setUiError(
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
    setUiError("");

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
      setUiError(
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
    setUiError("");

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
      setUiError(
        error instanceof Error ? error.message : "Failed to delete conversation."
      );
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleImageChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (useWebSearch) {
      setUiError("Image upload is only available in Standard mode.");
      clearImage();
      return;
    }

    setUploadingImage(true);
    setUiError("");

    try {
      const uploaded = await uploadImageToStorage(file);
      setImageBase64(uploaded.dataUrl);
      setImageName(uploaded.name);
      setImagePath(uploaded.path);
    } catch (error) {
      clearImage();
      setUiError(
        error instanceof Error ? error.message : "Failed to process image."
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    const hasImage = Boolean(imageBase64);
    const hasReadyDocuments = readyDocumentIds.length > 0;

    if (loading || uploadingImage || isUploadingDocuments) return;

    if (isLimitReached) {
      setUiError("You’ve reached your daily message limit.");
      return;
    }

    if (!conversationId) {
      setUiError("Missing conversationId.");
      return;
    }

    if (trimmed.length > MAX_INPUT_LENGTH) {
      setUiError(`Message too long. Maximum ${MAX_INPUT_LENGTH} characters.`);
      return;
    }

    if (useWebSearch && (hasImage || attachedDocuments.length > 0)) {
      setUiError("Web Search mode does not support file upload.");
      return;
    }

    if (hasPendingDocuments) {
      setUiError(
        "Please wait for attached documents to finish processing before sending."
      );
      return;
    }

    if (!trimmed && !hasImage) {
      if (hasReadyDocuments) {
        setInput("Please summarize the attached document(s).");
      } else {
        return;
      }
    }

    setUiError("");
    setDocumentError("");

    const effectiveMessage =
      trimmed ||
      (hasReadyDocuments ? "Please summarize the attached document(s)." : "");

    const attachmentNotes = [
      hasImage ? `[Image attached${imageName ? `: ${imageName}` : ""}]` : "",
      hasReadyDocuments
        ? `[Documents attached: ${attachedDocuments
            .filter((doc) => doc.extraction_status === "ready")
            .map((doc) => doc.file_name)
            .join(", ")}]`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const userVisibleContent = [effectiveMessage, attachmentNotes]
      .filter(Boolean)
      .join("\n\n");

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: userVisibleContent,
      image_path: imagePath,
      image_name: imageName,
      image_url: imageBase64,
    };

    const assistantId = createId();

    const assistantPlaceholder: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      sources: [],
    };

    const payloadImage = imageBase64;
    const payloadImagePath = imagePath;
    const payloadImageName = imageName;
    const payloadDocumentIds = readyDocumentIds;

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
          message: effectiveMessage,
          imageBase64: payloadImage,
          imagePath: payloadImagePath,
          imageName: payloadImageName,
          documentIds: payloadDocumentIds,
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
      await fetchDocuments(conversationId, { silent: true });
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
      clearDocuments();
    }

    setUseWebSearch(nextUseWebSearch);
    setUiError("");
    setDocumentError("");
  }

  function renderConversationCard(
    conversation: ConversationItem,
    isMobile = false
  ) {
    const isActive = conversation.id === conversationId;

    return (
      <div
        key={conversation.id}
        className={`rounded-xl p-2 transition ${
          isActive ? "bg-white text-black" : "bg-neutral-900 text-white"
        }`}
      >
        <button
          type="button"
          onClick={() =>
            isMobile
              ? handleMobileConversationOpen(conversation.id)
              : loadConversation(conversation.id)
          }
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
  }

  return (
    <main className="h-screen overflow-hidden bg-black text-white">
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Close menu overlay"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />

          <div className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-950">
            <div className="sticky top-0 border-b border-neutral-800 bg-neutral-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-neutral-500">Origin Sable</p>
                  <div className="truncate text-sm font-semibold">
                    {userEmail}
                  </div>

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
                      Daily limit reached. Come back tomorrow or upgrade your
                      plan.
                    </div>
                  )}

                  {usageError && (
                    <div className="mt-2 text-xs text-red-400">
                      {usageError}
                    </div>
                  )}

                  {uiError && (
                    <div className="mt-2 text-xs text-red-400">{uiError}</div>
                  )}

                  {documentError && (
                    <div className="mt-2 text-xs text-red-400">
                      {documentError}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg border border-neutral-700 px-2 py-1 text-sm text-white"
                >
                  Close
                </button>
              </div>

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
                  onClick={() => {
                    setMobileMenuOpen(false);
                    router.push("/account");
                  }}
                  className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-white"
                >
                  Account
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
                {conversations.map((conversation) =>
                  renderConversationCard(conversation, true)
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-screen overflow-hidden">
        <aside className="hidden h-full w-80 shrink-0 border-r border-neutral-800 bg-neutral-950 md:flex md:flex-col">
          <div className="sticky top-0 border-b border-neutral-800 bg-neutral-950 p-4">
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

            {uiError && (
              <div className="mt-2 text-xs text-red-400">{uiError}</div>
            )}

            {documentError && (
              <div className="mt-2 text-xs text-red-400">{documentError}</div>
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
                onClick={() => router.push("/account")}
                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-white"
              >
                Account
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
              {conversations.map((conversation) =>
                renderConversationCard(conversation)
              )}
            </div>
          </div>
        </aside>

        <section className="flex h-full flex-1 flex-col bg-black">
          <div className="sticky top-0 z-20 border-b border-neutral-800 bg-black/95 backdrop-blur">
            <div className={`${CONTENT_RAIL_CLASS} py-3`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(true)}
                    className="mt-0.5 rounded-lg border border-neutral-700 px-2 py-1 text-sm text-white md:hidden"
                    aria-label="Open menu"
                  >
                    ☰
                  </button>

                  <div className="min-w-0">
                    <p className="text-[11px] text-neutral-500">Origin Sable</p>
                    <h1 className="text-lg font-semibold">AI Assistant</h1>
                    <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-neutral-400">
                      {PRODUCT_DESCRIPTION}
                    </p>
                  </div>
                </div>

                <div className="hidden text-right text-xs text-neutral-500 md:block">
                  {modeLabel}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
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

                <span className="text-xs text-neutral-500 md:hidden">
                  {modeLabel}
                </span>
              </div>

              {messages.length === 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wide text-neutral-500">
                    Conversation starters
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {CONVERSATION_STARTERS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => handleConversationStarterClick(starter)}
                        disabled={loading || isLimitReached}
                        className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white transition hover:border-neutral-500 disabled:opacity-50"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                      App information
                    </div>

                    <div className="mt-2 text-sm text-white">
                      <span className="font-medium">App Developer:</span> Levi Holland
                    </div>

                    <div className="mt-1 text-sm text-neutral-400">
                      <span className="font-medium text-neutral-300">
                        Questions or support:
                      </span>{" "}
                      <a
                        href="mailto:Lholland116@gmail.com"
                        className="underline transition hover:text-white"
                      >
                        Lholland116@gmail.com
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`${CONTENT_RAIL_CLASS} py-5`}>
              {uiError && (
                <div className={`${ASSISTANT_BUBBLE_CLASS} mx-auto mb-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300`}>
                  {uiError}
                </div>
              )}

              {documentError && (
                <div className={`${ASSISTANT_BUBBLE_CLASS} mx-auto mb-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300`}>
                  {documentError}
                </div>
              )}

              <div className="space-y-4">
                {messages.map((message) => {
                  const sources = Array.isArray(message.sources)
                    ? message.sources
                    : [];
                  const isStreamingAssistant =
                    loading &&
                    message.role === "assistant" &&
                    message.id === messages[messages.length - 1]?.id;

                  const bubbleWidthClass =
                    message.role === "user"
                      ? USER_BUBBLE_CLASS
                      : ASSISTANT_BUBBLE_CLASS;

                  return (
                    <div key={message.id} className="space-y-2">
                      <div
                        className={`${bubbleWidthClass} mx-auto rounded-2xl p-4 whitespace-pre-wrap break-words ${
                          message.role === "user"
                            ? "bg-white text-black"
                            : "bg-neutral-900 text-white"
                        }`}
                      >
                        {message.content}

                        {message.image_url && (
                          <div className="mt-3">
                            <img
                              src={message.image_url}
                              alt={message.image_name || "Uploaded image"}
                              className="max-h-56 rounded-xl border border-neutral-800 object-contain"
                            />
                          </div>
                        )}

                        {isStreamingAssistant ? (
                          <span className="ml-1 inline-block animate-pulse">
                            ▍
                          </span>
                        ) : null}
                      </div>

                      {sources.length > 0 && (
                        <div
                          className={`${ASSISTANT_BUBBLE_CLASS} mx-auto space-y-2`}
                        >
                          {sources.map((source, index) => (
                            <a
                              key={`${source.url}-${index}`}
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-xl border border-neutral-800 bg-neutral-950 p-3 transition hover:border-neutral-700"
                            >
                              <div className="text-xs text-blue-400 underline">
                                {source.title}
                              </div>
                              {source.snippet ? (
                                <div className="mt-1 text-xs text-neutral-400">
                                  {source.snippet}
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
                  <div
                    className={`${ASSISTANT_BUBBLE_CLASS} mx-auto text-xs text-neutral-500`}
                  >
                    {useWebSearch
                      ? "Using web search..."
                      : uploadingImage
                        ? "Processing image..."
                        : isUploadingDocuments || hasPendingDocuments
                          ? "Processing documents..."
                          : "Thinking..."}
                  </div>
                )}

                <div ref={endRef} />
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 z-20 border-t border-neutral-800 bg-black/95 backdrop-blur">
            <div className={`${CONTENT_RAIL_CLASS} space-y-1.5 py-2.5`}>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={
                  loading ||
                  uploadingImage ||
                  isUploadingDocuments ||
                  isLimitReached ||
                  useWebSearch
                }
                className="hidden"
              />

              {!useWebSearch && attachedDocuments.length > 0 && (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-2">
                  <div className="flex flex-wrap gap-2">
                    {attachedDocuments.map((doc) => (
                      <DocumentChip
                        key={doc.id}
                        name={doc.file_name}
                        status={
                          doc.extraction_status === "ready"
                            ? "ready"
                            : doc.extraction_status === "failed"
                              ? "failed"
                              : "uploading"
                        }
                        onRemove={
                          loading || isUploadingDocuments || hasPendingDocuments
                            ? undefined
                            : () => removeAttachedDocument(doc.id)
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {!useWebSearch && imageBase64 && (
                <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300">
                      {imageName || "Image attached"}
                    </div>

                    {!loading && (
                      <button
                        type="button"
                        onClick={clearImage}
                        className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-white transition hover:border-neutral-500"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="mt-2">
                    <img
                      src={imageBase64}
                      alt="Selected upload preview"
                      className="max-h-24 rounded-xl border border-neutral-800 object-contain"
                    />
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex items-end gap-2">
                {!useWebSearch && (
                  <div className="flex gap-2">
                    <DocumentUploadButton
                      disabled={
                        loading ||
                        uploadingImage ||
                        isUploadingDocuments ||
                        isLimitReached
                      }
                      onFilesSelected={handleFilesSelected}
                    />

                    <button
                      type="button"
                      onClick={handleOpenImagePicker}
                      disabled={
                        loading ||
                        uploadingImage ||
                        isUploadingDocuments ||
                        isLimitReached
                      }
                      className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-neutral-700 bg-neutral-900 text-xl text-white transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Attach image"
                      title="Attach image"
                    >
                      🖼️
                    </button>
                  </div>
                )}

                <input
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    if (uiError) {
                      setUiError("");
                    }
                    if (documentError) {
                      setDocumentError("");
                    }
                  }}
                  className="flex-1 rounded-2xl bg-neutral-900 px-4 py-3.5 outline-none"
                  placeholder={
                    useWebSearch
                      ? "Ask something with web search..."
                      : imageBase64
                        ? "Add context for the image, or send without text..."
                        : attachedDocuments.length > 0
                          ? hasPendingDocuments
                            ? "Please wait while documents finish processing..."
                            : "Ask about the attached documents..."
                          : "Ask something..."
                  }
                  maxLength={MAX_INPUT_LENGTH}
                  disabled={
                    loading ||
                    uploadingImage ||
                    isUploadingDocuments ||
                    isLimitReached
                  }
                />

                {loading ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="rounded-2xl border border-neutral-700 px-5 py-3.5 text-white"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      uploadingImage ||
                      isUploadingDocuments ||
                      isLimitReached ||
                      hasPendingDocuments ||
                      (!imageBase64 &&
                        readyDocumentIds.length === 0 &&
                        input.trim().length === 0)
                    }
                    className="rounded-2xl bg-white px-5 py-3.5 text-black disabled:cursor-not-allowed disabled:opacity-50"
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