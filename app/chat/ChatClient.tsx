"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type ChatClientProps = {
  userEmail: string;
  conversationId: string;
  initialMessages: Message[];
};

type ChatWebResponse = {
  reply?: string;
  sources?: SourceItem[];
  error?: string;
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
  conversationId,
  initialMessages,
}: ChatClientProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const modeLabel = useMemo(() => {
    if (useWebSearch) return "Using web search";
    if (imageBase64) return "Image attached";
    return "Standard assistant";
  }, [useWebSearch, imageBase64]);

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
        error instanceof Error
          ? error.message
          : "Failed to process image."
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmed = input.trim();
    const hasImage = Boolean(imageBase64);

    if ((loading || uploadingImage) || (!trimmed && !hasImage)) return;

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
      trimmed || (hasImage ? `[Image attached${imageName ? `: ${imageName}` : ""}]` : "");

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

        return;
      }

      if (!res.body) {
        throw new Error("Streaming response body is missing.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const result = await reader.read();
        done = result.done;

        if (result.value) {
          const chunk = decoder.decode(result.value, { stream: true });

          updateAssistantMessage(assistantId, (msg) => ({
            ...msg,
            content: msg.content + chunk,
          }));
        }
      }

      updateAssistantMessage(assistantId, (msg) => ({
        ...msg,
        content: msg.content.trim() || "No response generated.",
      }));
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
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
        <div className="mb-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-xs text-neutral-400">Origin Sable</p>
          <h1 className="text-2xl font-bold">AI Assistant</h1>
          <p className="text-sm text-neutral-400">Logged in as {userEmail}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
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

        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.map((m) => {
            const sources = Array.isArray(m.sources) ? m.sources : [];
            const isStreamingAssistant =
              loading &&
              m.role === "assistant" &&
              m.id === messages[messages.length - 1]?.id;

            return (
              <div key={m.id} className="space-y-2">
                <div
                  className={`max-w-3xl rounded-2xl p-3 whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "ml-auto bg-white text-black"
                      : "bg-neutral-900 text-white"
                  }`}
                >
                  {m.content}
                  {isStreamingAssistant ? (
                    <span className="ml-1 inline-block animate-pulse">▍</span>
                  ) : null}
                </div>

                {sources.length > 0 && (
                  <div className="max-w-3xl space-y-2">
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
            <div className="max-w-3xl text-xs text-neutral-500">
              {useWebSearch
                ? "Using web search..."
                : "Thinking..."}
            </div>
          )}

          <div ref={endRef} />
        </div>

        <div className="mt-4 space-y-3">
          {!useWebSearch && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center rounded-xl border border-neutral-700 px-3 py-2 text-sm text-white transition hover:border-neutral-500">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    disabled={loading || uploadingImage}
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
              className="flex-1 rounded-xl bg-neutral-900 p-3 outline-none"
              placeholder={
                useWebSearch
                  ? "Ask something with web search..."
                  : imageBase64
                    ? "Add context for the image, or send without text..."
                    : "Ask something..."
              }
              maxLength={MAX_INPUT_LENGTH}
              disabled={loading || uploadingImage}
            />

            {loading ? (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-xl border border-neutral-700 px-4 text-white"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  uploadingImage ||
                  (!imageBase64 && input.trim().length === 0)
                }
                className="rounded-xl bg-white px-4 text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            )}
          </form>

          <div className="text-xs text-neutral-500">
            {uploadingImage
              ? "Preparing image for analysis..."
              : imageBase64
                ? "Analyzing image will use Standard mode only."
                : ""}
          </div>
        </div>
      </div>
    </main>
  );
}