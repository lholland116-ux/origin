"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  HelpCircle,
  Mic,
  MicOff,
  Palette,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/branding";
import Tooltip from "@/components/ui/Tooltip";
import OnboardingModal from "@/components/help/OnboardingModal";
import DocumentUploadButton from "@/components/DocumentUploadButton";
import DocumentChip from "@/components/DocumentChip";
import { validateFiles } from "@/lib/documents/validate-upload";
import {
  CHAT_THEMES,
  DEFAULT_CHAT_THEME_ID,
  getChatThemeById,
  type ChatTheme,
} from "@/lib/chat-themes";
import {
  getStoredChatThemeId,
  setStoredChatThemeId,
} from "@/lib/chat-theme-storage";
import UpgradeModal from "@/components/UpgradeModal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AppSpeechRecognitionResultAlternative = {
  transcript: string;
  confidence: number;
};

type Plan = "free" | "pro";

type ApiErrorResponse = {
  error?: string;
  code?: "PRO_REQUIRED" | "LIMIT_REACHED" | string;
  plan?: Plan | string;
  limit?: number;
};

type AppSpeechRecognitionResult = {
  [index: number]: AppSpeechRecognitionResultAlternative;
  isFinal: boolean;
  length: number;
};

type AppSpeechRecognitionResultList = {
  [index: number]: AppSpeechRecognitionResult;
  length: number;
};

type AppSpeechRecognitionEvent = {
  results: AppSpeechRecognitionResultList;
};

type AppSpeechRecognitionErrorEvent = {
  error: string;
  message?: string;
};

type AppSpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: AppSpeechRecognitionEvent) => void) | null;
  onerror: ((event: AppSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type AppSpeechRecognitionConstructor = new () => AppSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: AppSpeechRecognitionConstructor;
    webkitSpeechRecognition?: AppSpeechRecognitionConstructor;
    gtag?: (
      command: string,
      eventName: string,
      params?: Record<string, unknown>
    ) => void;
  }
}

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
};

type TimeWidgetPayload = {
  type: "time";
  location: string;
  timezone: string;
};

type MessageWidget = TimeWidgetPayload;

type UploadedDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: "uploading" | "processing" | "ready" | "failed";
  extraction_error?: string | null;
  conversation_id: string | null;
};

type MessageFeedbackRating = "up" | "down";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  feedback?: MessageFeedbackRating | null;
  sources?: SourceItem[];
  sourceCount?: number;
  widget?: MessageWidget | null;
  image_path?: string | null;
  image_name?: string | null;
  image_url?: string | null;
  documents?: UploadedDocument[];
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
  sourceCount?: number;
  widget?: MessageWidget | null;
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
const DOCUMENT_UPLOAD_TIMEOUT_MS = 30_000;
const ENABLE_UPLOAD_DEBUG = process.env.NODE_ENV !== "production";

const ALLOWED_DOCUMENT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const CONVERSATION_STARTERS = [
  "Summarize this image or document for me",
  "Explain something step by step",
] as const;

const TOOLTIP_TEXT = {
  help: "Open help and frequently asked questions",
  newChat: "Start a new conversation",
  standard: "General writing, brainstorming, and everyday help",
  webSearch: "Use current online information when freshness matters",
  image: "Attach an image in Standard mode",
  mic: "Speak your message using your microphone",
  send: "Send your message",
  stop: "Stop generating the current response",
  copy: "Copy this message",
  renameConversation: "Rename this conversation",
  deleteConversation: "Delete this conversation",
  account: "Open your account settings",
  signOut: "Sign out of your account",
  theme: "Choose chat colors",
} as const;

const CONTENT_RAIL_CLASS = "mx-auto w-full max-w-4xl px-3 sm:px-4 min-w-0 overflow-x-hidden";
const ASSISTANT_BUBBLE_CLASS = "w-full max-w-3xl min-w-0";
const USER_BUBBLE_CLASS = "w-full max-w-2xl min-w-0";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function createId(): string {
  return crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugLog(...args: unknown[]): void {
  if (ENABLE_UPLOAD_DEBUG) {
    console.log(...args);
  }
}

function trackGaEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") {
    return;
  }

  window.gtag?.("event", eventName, params);
}

function extractErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const maybeError = (data as { error?: unknown }).error;
  return typeof maybeError === "string" && maybeError.trim()
    ? maybeError
    : null;
}

function inferMimeType(file: File): string {
  const declaredType = file.type?.trim();
  if (declaredType) return declaredType;

  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lowerName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".txt")) return "text/plain";
  if (lowerName.endsWith(".md")) return "text/markdown";

  return "application/octet-stream";
}

function isAllowedUploadMimeType(mimeType: string, fileName: string): boolean {
  return (
    ALLOWED_DOCUMENT_MIME_TYPES.includes(
      mimeType as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number]
    ) ||
    fileName.toLowerCase().endsWith(".xlsx") ||
    fileName.toLowerCase().endsWith(".csv") ||
    fileName.toLowerCase().endsWith(".txt") ||
    fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase().endsWith(".docx") ||
    fileName.toLowerCase().endsWith(".pdf")
  );
}

function cloneDocuments(documents: UploadedDocument[]): UploadedDocument[] {
  return documents.map((doc) => ({ ...doc }));
}

function normalizeWidget(input: unknown): MessageWidget | null {
  if (!input || typeof input !== "object") return null;

  const widget = input as Record<string, unknown>;
  if (widget.type !== "time") return null;

  const location =
    typeof widget.location === "string" && widget.location.trim()
      ? widget.location.trim()
      : "";
  const timezone =
    typeof widget.timezone === "string" && widget.timezone.trim()
      ? widget.timezone.trim()
      : "";

  if (!location || !timezone) return null;

  return {
    type: "time",
    location,
    timezone,
  };
}

function normalizeInitialMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    sources: Array.isArray(message.sources) ? message.sources : [],
    sourceCount:
      typeof message.sourceCount === "number"
        ? message.sourceCount
        : Array.isArray(message.sources)
          ? message.sources.length
          : 0,
    widget: normalizeWidget(message.widget),
    documents: Array.isArray(message.documents)
      ? cloneDocuments(message.documents)
      : [],
  }));
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
      extraction_error:
        typeof item.extraction_error === "string"
          ? item.extraction_error
          : null,
      conversation_id:
        typeof item.conversation_id === "string" ? item.conversation_id : null,
    }));
}

function formatTimeForZone(timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

function formatDateForZone(timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

function formatZoneLabel(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date());

    return parts.find((part) => part.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone;
  }
}

function getSourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function dedupeSources(sources: SourceItem[]): SourceItem[] {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.url}|${source.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findBestServerMatch(
  composerDoc: UploadedDocument,
  serverDocs: UploadedDocument[],
  usedServerIds: Set<string>
): UploadedDocument | null {
  for (const doc of serverDocs) {
    if (usedServerIds.has(doc.id)) continue;
    if (
      doc.file_name === composerDoc.file_name &&
      doc.size_bytes === composerDoc.size_bytes
    ) {
      usedServerIds.add(doc.id);
      return doc;
    }
  }

  for (const doc of serverDocs) {
    if (usedServerIds.has(doc.id)) continue;
    if (doc.file_name === composerDoc.file_name) {
      usedServerIds.add(doc.id);
      return doc;
    }
  }

  return null;
}

function reconcileComposerDocuments(
  currentComposerDocs: UploadedDocument[],
  serverDocs: UploadedDocument[]
): UploadedDocument[] {
  const usedServerIds = new Set<string>();

  return currentComposerDocs.map((composerDoc) => {
    if (
      composerDoc.extraction_status !== "uploading" &&
      composerDoc.extraction_status !== "processing"
    ) {
      return composerDoc;
    }

    const match = findBestServerMatch(composerDoc, serverDocs, usedServerIds);

    if (!match) {
      return {
        ...composerDoc,
        extraction_status: "processing",
      };
    }

    return {
      ...composerDoc,
      id: match.id,
      mime_type: match.mime_type,
      size_bytes: match.size_bytes,
      extraction_status: match.extraction_status,
      extraction_error: match.extraction_error,
      conversation_id: match.conversation_id,
    };
  });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
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

function formatConversationDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString();
}

function getMessageCopyValue(message: Message): string {
  return message.content?.trim() || "";
}

function getSecondaryButtonClass(theme: ChatTheme): string {
  return cx(
    "rounded-xl border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
    theme.panelBorder,
    "text-white/90 hover:bg-white/10"
  );
}

function getModeButtonClass(theme: ChatTheme, isActive: boolean): string {
  return isActive
    ? cx("rounded-xl px-3 py-2 text-sm transition", theme.buttonPrimary)
    : getSecondaryButtonClass(theme);
}

function getBubbleClass(theme: ChatTheme, role: "user" | "assistant"): string {
  return cx(
    "max-w-full rounded-2xl border p-4 break-words [overflow-wrap:anywhere] shadow-[0_10px_30px_rgba(0,0,0,0.22)]",
    role === "user" ? theme.userBubble : theme.assistantBubble,
    role === "user" ? theme.userText : theme.assistantText,
    theme.panelBorder
  );
}

function ChatThemePicker({
  theme,
  selectedThemeId,
  onChange,
  onClose,
}: {
  theme: ChatTheme;
  selectedThemeId: string;
  onChange: (themeId: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      className={cx(
        "rounded-2xl border p-4",
        "max-h-[calc(100dvh-230px)] overflow-hidden",
        theme.panelBg,
        theme.panelBorder
      )}
      aria-label="Chat theme picker"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className={cx("text-sm font-semibold", theme.titleText)}>
            Chat theme
          </h2>
          <p className={cx("mt-1 text-xs", theme.mutedText)}>
            Let users choose the chat window colors.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className={cx("shrink-0", getSecondaryButtonClass(theme))}
        >
          Close
        </button>
      </div>

      <div className="max-h-[calc(100dvh-310px)] overflow-y-auto overscroll-contain pr-1 pb-28 sm:max-h-none sm:overflow-visible sm:pb-0">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {CHAT_THEMES.map((item) => {
            const active = item.id === selectedThemeId;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                aria-pressed={active}
                className={cx(
                  "rounded-2xl border p-3 text-left transition",
                  "focus:outline-none focus:ring-2 focus:ring-blue-400/60 focus:ring-offset-2 focus:ring-offset-black",
                  active ? "border-blue-400/50 bg-white/10" : theme.panelBorder,
                  "hover:bg-white/5"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">
                      {item.label}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      {item.id}
                    </div>
                  </div>

                  {active ? (
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-black">
                      Active
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 rounded-xl border border-white/10 p-2">
                  <div
                    className={cx(
                      "rounded-lg border p-2",
                      item.panelBg,
                      item.panelBorder
                    )}
                  >
                    <div
                      className={cx(
                        "mb-2 rounded-lg px-3 py-2 text-xs",
                        item.assistantBubble,
                        item.assistantText
                      )}
                    >
                      Assistant
                    </div>

                    <div
                      className={cx(
                        "ml-auto w-fit rounded-lg px-3 py-2 text-xs",
                        item.userBubble,
                        item.userText
                      )}
                    >
                      User
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SourcesDisclosure({
  sources,
  sourceCount,
  theme,
}: {
  sources: SourceItem[];
  sourceCount: number;
  theme: ChatTheme;
}) {
  const [open, setOpen] = useState(false);
  const visibleSources = sources.slice(0, 3);

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cx(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
          theme.panelBorder,
          "text-white/80 hover:bg-white/5"
        )}
        aria-expanded={open}
      >
        <span>Sources ({sourceCount})</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className={cx("mt-2 rounded-2xl border p-3", theme.panelBg, theme.panelBorder)}>
          <div className="space-y-2">
            {visibleSources.map((source, index) => (
              <a
                key={`${source.url}-${index}`}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className={cx(
                  "block rounded-xl border p-3 transition hover:bg-white/5",
                  theme.panelBorder
                )}
              >
                <div className="text-xs font-medium text-blue-300">
                  {source.title?.trim() || getSourceHostname(source.url)}
                </div>
                <div className="mt-1 text-[11px] text-white/50">{getSourceHostname(source.url)}</div>
                {source.snippet ? (
                  <div className="mt-1 line-clamp-3 text-xs text-white/80">{source.snippet}</div>
                ) : null}
              </a>
            ))}

            {sourceCount > visibleSources.length && (
              <div className="text-[11px] text-white/50">
                Showing {visibleSources.length} of {sourceCount} sources
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeWidget({
  location,
  timezone,
  theme,
}: {
  location: string;
  timezone: string;
  theme: ChatTheme;
}) {
  const [time, setTime] = useState(() => formatTimeForZone(timezone));
  const [dateLabel, setDateLabel] = useState(() => formatDateForZone(timezone));

  useEffect(() => {
    const tick = () => {
      setTime(formatTimeForZone(timezone));
      setDateLabel(formatDateForZone(timezone));
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);

    return () => window.clearInterval(intervalId);
  }, [timezone]);

  return (
    <div className={cx("mb-3 rounded-3xl border p-5", theme.panelBg, theme.panelBorder)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={cx("text-4xl font-semibold tracking-tight", theme.titleText)}>{time}</div>
          <div className="mt-2 text-sm text-white/80">
            {location} ({formatZoneLabel(timezone)})
          </div>
          <div className={cx("mt-1 text-sm", theme.mutedText)}>{dateLabel}</div>
        </div>

        <div className={cx("rounded-2xl border p-3 text-white/80", theme.panelBorder)}>
          <Clock3 className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function MessageWidgetRenderer({
  widget,
  theme,
}: {
  widget?: MessageWidget | null;
  theme: ChatTheme;
}) {
  if (!widget) return null;

  if (widget.type === "time") {
    return <TimeWidget location={widget.location} timezone={widget.timezone} theme={theme} />;
  }

  return null;
}

export default function ChatClient({
  userEmail,
  initialConversationId,
  initialMessages,
  initialConversations,
}: ChatClientProps) {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>(
    normalizeInitialMessages(initialMessages)
  );
  const [input, setInput] = useState("");
  const [isTypingFocused, setIsTypingFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [composerDocuments, setComposerDocuments] = useState<UploadedDocument[]>([]);
  const [conversationDocuments, setConversationDocuments] = useState<UploadedDocument[]>([]);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [conversations, setConversations] = useState<ConversationItem[]>(initialConversations);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [usageError, setUsageError] = useState("");
  const [uiError, setUiError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState(DEFAULT_CHAT_THEME_ID);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [plan, setPlan] = useState<Plan>("free");
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeModalTitle, setUpgradeModalTitle] = useState("Upgrade to Pro");
  const [upgradeModalMessage, setUpgradeModalMessage] = useState(
    "This feature is available on the Pro plan."
  );

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const activeDocumentPollRef = useRef(0);
  const recognitionRef = useRef<AppSpeechRecognition | null>(null);
  const speechSessionBaseRef = useRef<string>("");
  const lastAppliedTranscriptRef = useRef<string>("");

  const activeTheme = useMemo(() => getChatThemeById(selectedThemeId), [selectedThemeId]);

  const readyComposerDocuments = useMemo(
    () => composerDocuments.filter((doc) => doc.extraction_status === "ready"),
    [composerDocuments]
  );

  const readyDocumentIds = useMemo(
    () => readyComposerDocuments.map((doc) => doc.id),
    [readyComposerDocuments]
  );

  const hasPendingDocuments = useMemo(
    () =>
      composerDocuments.some(
        (doc) =>
          doc.extraction_status === "uploading" ||
          doc.extraction_status === "processing"
      ),
    [composerDocuments]
  );

  const modeLabel = useMemo(() => {
    if (useWebSearch) return "Using web search";
    if (isListening) return "Voice input active";
    if (imageBase64) return "Image attached";
    if (composerDocuments.length > 0) return "Documents attached";
    return "Standard assistant";
  }, [useWebSearch, isListening, imageBase64, composerDocuments.length]);

  const isLimitReached = Boolean(usage && usage.limit > 0 && usage.remaining <= 0);

  const composerDisabled =
    loading || uploadingImage || isUploadingDocuments || isLimitReached;

  const micDisabled =
    !speechSupported ||
    loading ||
    uploadingImage ||
    isUploadingDocuments ||
    isLimitReached ||
    hasPendingDocuments;

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: loading ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, loading]);

function openUpgradeModal(title: string, message: string): void {
  setUpgradeModalTitle(title);
  setUpgradeModalMessage(message);
  setUpgradeModalOpen(true);
}

function handleApiUpgradeError(data: ApiErrorResponse): boolean {
  if (data.code === "PRO_REQUIRED") {
    openUpgradeModal(
      "Upgrade to unlock this feature",
      data.error ||
        "This feature is available on the Pro plan. Upgrade to use web search and file uploads."
    );
    return true;
  }

  if (data.code === "LIMIT_REACHED") {
    openUpgradeModal(
      "You’ve reached today’s limit",
      data.error ||
        "You’ve reached your daily free message limit. Upgrade to Pro to continue with a higher daily limit."
    );
    return true;
  }

  return false;
}

  useEffect(() => {
    setSelectedThemeId(getStoredChatThemeId());
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    void fetchUsage();
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void fetchUsage();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    void fetchDocuments(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionConstructor =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionConstructor) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: AppSpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = 0; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const transcriptToApply = (finalTranscript || interimTranscript).trim();
      if (!transcriptToApply) return;

      const sessionBase = speechSessionBaseRef.current.trim();
      lastAppliedTranscriptRef.current = transcriptToApply;

      setInput(sessionBase ? `${sessionBase} ${transcriptToApply}` : transcriptToApply);
      setUiError("");
      setSpeechError(null);
    };

    recognition.onerror = (event: AppSpeechRecognitionErrorEvent) => {
      setIsListening(false);

      if (event.error === "not-allowed") {
        setSpeechError("Microphone access was denied.");
        return;
      }

      if (event.error === "no-speech") {
        setSpeechError("No speech was detected. Please try again.");
        return;
      }

      if (event.error === "audio-capture") {
        setSpeechError("No microphone was found on this device.");
        return;
      }

      setSpeechError("Voice input failed. Please try again.");
    };

    recognition.onend = () => {
      setIsListening(false);
      lastAppliedTranscriptRef.current = "";
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (loading || isUploadingDocuments || uploadingImage) {
      if (isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
      }
    }
  }, [loading, isUploadingDocuments, uploadingImage, isListening]);

  useEffect(() => {
    if (!conversationId || !hasPendingDocuments) return;

    const pollId = ++activeDocumentPollRef.current;

    void (async () => {
      for (let attempt = 0; attempt < DOCUMENT_POLL_MAX_ATTEMPTS; attempt += 1) {
        const delay = DOCUMENT_POLL_INTERVAL_MS * (attempt + 1);
        await sleep(delay);

        if (pollId !== activeDocumentPollRef.current) return;

        const docs = await fetchDocuments(conversationId, { silent: true });
        if (!docs) return;

        setComposerDocuments((prev) => reconcileComposerDocuments(prev, docs));

        const stillPending = docs.some(
          (doc) =>
            doc.extraction_status === "uploading" ||
            doc.extraction_status === "processing"
        );

        const composerSnapshot = reconcileComposerDocuments(composerDocuments, docs);
        const composerStillPending = composerSnapshot.some(
          (doc) =>
            doc.extraction_status === "uploading" ||
            doc.extraction_status === "processing"
        );

        if (!stillPending || !composerStillPending) {
          debugLog("Document polling completed", { conversationId, docs });
          return;
        }
      }

      debugLog("Document polling max attempts reached", { conversationId });
    })();

    return () => {
      activeDocumentPollRef.current += 1;
    };
  }, [conversationId, hasPendingDocuments]);

  function handleThemeChange(themeId: string) {
    setSelectedThemeId(themeId);
    setStoredChatThemeId(themeId);
  }

  function clearImage(): void {
    setImageBase64(null);
    setImageName("");
    setImagePath(null);

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  function clearComposerDocuments(): void {
    setComposerDocuments([]);
    setDocumentError("");
    activeDocumentPollRef.current += 1;
  }

  function clearConversationDocuments(): void {
    setConversationDocuments([]);
  }

  function clearTransientErrors(): void {
    setUiError("");
    setDocumentError("");
    setSpeechError(null);
  }

  function updateAssistantMessage(
    messageId: string,
    updater: (msg: Message) => Message
  ): void {
    setMessages((prev) => prev.map((msg) => (msg.id === messageId ? updater(msg) : msg)));
  }

  async function handleCopyMessage(messageId: string, content: string) {
    try {
      if (!content.trim()) {
        setUiError("There is no message text to copy.");
        return;
      }

      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);

      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1500);
    } catch {
      setUiError("Failed to copy message.");
    }
  }

  async function handleMessageFeedback(
    messageId: string,
    rating: MessageFeedbackRating
  ): Promise<void> {
    if (!conversationId) {
      setUiError("Missing conversationId.");
      return;
    }

    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, feedback: rating } : message
      )
    );

    try {
      const res = await fetch("/api/message-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          conversationId,
          rating,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to save feedback.");
      }

      setUiError("");
    } catch (error) {
      setUiError(
        error instanceof Error ? error.message : "Failed to save feedback."
      );

      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? { ...message, feedback: null } : message
        )
      );
    }
  }

  function handleConversationStarterClick(starter: string): void {
    if (loading || isLimitReached) return;
    setInput(starter);
    clearTransientErrors();
  }

  function handleOpenImagePicker(): void {
    if (loading || uploadingImage || isUploadingDocuments || isLimitReached || useWebSearch) {
      return;
    }

    imageInputRef.current?.click();
  }

  function handleStartListening(): void {
    if (loading || uploadingImage || isUploadingDocuments || isLimitReached || hasPendingDocuments) {
      return;
    }

    if (!recognitionRef.current) {
      setSpeechSupported(false);
      return;
    }

    clearTransientErrors();
    speechSessionBaseRef.current = input.trim();
    lastAppliedTranscriptRef.current = "";

    try {
      setIsListening(true);
      recognitionRef.current.start();
    } catch {
      setIsListening(false);
      setSpeechError("Could not start microphone input.");
    }
  }

  function handleStopListening(): void {
    try {
      recognitionRef.current?.stop();
    } finally {
      setIsListening(false);
      lastAppliedTranscriptRef.current = "";
    }
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

   setPlan(data?.plan === "pro" ? "pro" : "free");
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : "Failed to load usage.");
    }
  }

  async function fetchDocuments(
    targetConversationId: string,
    options?: { silent?: boolean }
  ): Promise<UploadedDocument[] | null> {
    if (!targetConversationId) {
      clearConversationDocuments();
      return [];
    }

    try {
      if (!options?.silent) {
        setDocumentError("");
      }

      const res = await fetch(
        `/api/documents?conversationId=${encodeURIComponent(targetConversationId)}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as DocumentsResponse | null;
        throw new Error(data?.error || "Failed to load documents.");
      }

      const data = (await res.json()) as DocumentsResponse;
      const normalized = normalizeUploadedDocuments(data.documents);
      setConversationDocuments(normalized);
      return normalized;
    } catch (error) {
      if (!options?.silent) {
        const message = error instanceof Error ? error.message : "Failed to load documents.";
        setDocumentError(message);
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

    const { error: uploadError } = await supabase.storage.from("chat-images").upload(filePath, blob, {
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
    if (isUploadingDocuments) return;

    if (useWebSearch) {
      setDocumentError("Document upload is only available in Standard mode.");
      return;
    }

    const validationError = validateFiles(files);
    if (validationError) {
      setDocumentError(validationError);
      return;
    }

    for (const file of files) {
      const mimeType = inferMimeType(file);
      if (!isAllowedUploadMimeType(mimeType, file.name)) {
        setDocumentError(`Unsupported file type: ${file.name}`);
        return;
      }
    }

    if (!conversationId) {
      setDocumentError("Missing conversationId.");
      return;
    }

    try {
      setIsUploadingDocuments(true);
      clearTransientErrors();

      const optimisticDocs: UploadedDocument[] = files.map((file, index) => ({
        id: `temp-${Date.now()}-${index}`,
        file_name: file.name,
        mime_type: inferMimeType(file),
        size_bytes: file.size,
        extraction_status: "uploading",
        extraction_error: null,
        conversation_id: conversationId,
      }));

      setComposerDocuments((prev) => [...prev, ...optimisticDocs]);

      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
      formData.append("conversationId", conversationId);

      let res: Response;
      try {
        res = await fetchWithTimeout(
          "/api/documents/upload",
          { method: "POST", body: formData },
          DOCUMENT_UPLOAD_TIMEOUT_MS
        );
      } catch {
        throw new Error("Upload request failed or timed out.");
      }

      const data = (await res.json().catch(() => null)) as DocumentsResponse | { error?: string } | null;

      if (!res.ok) {
        const errorData = data as ApiErrorResponse | null;

        if (errorData && handleApiUpgradeError(errorData)) {
          throw new Error(errorData.error || "File uploads are a Pro feature.");
      }

      const errorMessage =
        extractErrorMessage(data) || `Upload failed (status ${res.status})`;

      throw new Error(errorMessage);
    }

      const refreshedDocs = await fetchDocuments(conversationId, { silent: true });
      if (refreshedDocs) {
        setComposerDocuments((prev) => reconcileComposerDocuments(prev, refreshedDocs));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setDocumentError(message);
      setComposerDocuments((prev) =>
        prev.map((doc) =>
          doc.extraction_status === "uploading"
            ? { ...doc, extraction_status: "failed", extraction_error: message }
            : doc
        )
      );
      await fetchDocuments(conversationId, { silent: true });
    } finally {
      setIsUploadingDocuments(false);
    }
  }

  function removeComposerDocument(id: string): void {
    setComposerDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }

  async function handleSignOut() {
    try {
      setUiError("");
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.push("/login");
      router.refresh();
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "Failed to sign out.");
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
    clearTransientErrors();
    clearImage();
    clearComposerDocuments();
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
          const normalizedMessage: Message = {
            ...msg,
            sources: Array.isArray(msg.sources) ? dedupeSources(msg.sources) : [],
            sourceCount:
              typeof msg.sourceCount === "number"
                ? msg.sourceCount
                : Array.isArray(msg.sources)
                  ? dedupeSources(msg.sources).length
                  : 0,
            widget: normalizeWidget(msg.widget),
            documents: Array.isArray(msg.documents) ? cloneDocuments(msg.documents) : [],
          };

          if (normalizedMessage.image_path) {
            const imageUrl = await getSignedImageUrl(normalizedMessage.image_path);
            return { ...normalizedMessage, image_url: imageUrl };
          }

          return normalizedMessage;
        })
      );

      setConversationId(nextConversationId);
      setMessages(nextMessages);
      await fetchDocuments(nextConversationId);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "Failed to load conversation.");
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
    clearTransientErrors();
    clearImage();
    clearComposerDocuments();
    clearConversationDocuments();
    setInput("");

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setComposerDocuments([]);
      setConversationDocuments([]);
      setMobileMenuOpen(false);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "Failed to create conversation.");
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleRenameConversation(target: ConversationItem) {
    if (loading || sidebarLoading) return;

    const nextTitle = window.prompt("Rename conversation", target.title?.trim() || "New Chat");
    if (!nextTitle) return;

    const trimmed = nextTitle.trim();
    if (!trimmed) return;

    setSidebarLoading(true);
    setUiError("");

    try {
      const res = await fetch("/api/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, title: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to rename conversation.");
      }

      await refreshConversations(target.id);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "Failed to rename conversation.");
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleDeleteConversation(target: ConversationItem) {
    if (loading || sidebarLoading) return;

    const confirmed = window.confirm(`Delete "${target.title?.trim() || "New Chat"}"?`);
    if (!confirmed) return;

    setSidebarLoading(true);
    setUiError("");

    try {
      const res = await fetch(`/api/conversations?id=${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });

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
      setUiError(error instanceof Error ? error.message : "Failed to delete conversation.");
    } finally {
      setSidebarLoading(false);
    }
  }

  async function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (useWebSearch) {
      setUiError("Image upload is only available in Standard mode.");
      clearImage();
      return;
    }

    setUploadingImage(true);
    setUiError("");
    setSpeechError(null);

    try {
      const uploaded = await uploadImageToStorage(file);
      setImageBase64(uploaded.dataUrl);
      setImageName(uploaded.name);
      setImagePath(uploaded.path);
    } catch (error) {
      clearImage();
      setUiError(error instanceof Error ? error.message : "Failed to process image.");
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
      if (plan !== "pro") {
        openUpgradeModal(
          "You’ve reached today’s free limit",
          "Upgrade to Pro to continue with a higher daily message limit."
        );
      } else {
        setUiError("You’ve reached today’s Pro message limit. Please try again tomorrow.");
      }
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

    if (useWebSearch && (hasImage || composerDocuments.length > 0)) {
      setUiError("Web Search mode does not support file upload.");
      return;
    }

    if (hasPendingDocuments) {
      setUiError("Please wait for attached documents to finish processing before sending.");
      return;
    }

    if (!trimmed && !hasImage) {
      if (hasReadyDocuments) {
        setInput("Please summarize the attached document(s).");
      } else {
        return;
      }
    }

    clearTransientErrors();

    if (isListening) {
      handleStopListening();
    }

    const effectiveMessage =
      trimmed || (hasReadyDocuments ? "Please summarize the attached document(s)." : "");

    const attachmentNotes = [
      hasImage ? `[Image attached${imageName ? `: ${imageName}` : ""}]` : "",
      hasReadyDocuments
        ? `[Documents attached: ${readyComposerDocuments.map((doc) => doc.file_name).join(", ")}]`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const userVisibleContent = [effectiveMessage, attachmentNotes].filter(Boolean).join("\n\n");
    const sentDocuments = cloneDocuments(readyComposerDocuments);

    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: userVisibleContent,
      image_path: imagePath,
      image_name: imageName,
      image_url: imageBase64,
      documents: sentDocuments,
    };

    const assistantId = createId();
    const assistantPlaceholder: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      sources: [],
      sourceCount: 0,
      widget: null,
      documents: [],
    };

    const payloadImage = imageBase64;
    const payloadImagePath = imagePath;
    const payloadImageName = imageName;
    const payloadDocumentIds = [...readyDocumentIds];

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput("");
    clearImage();
    clearComposerDocuments();
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const endpoint = useWebSearch ? "/api/chat-web" : "/api/chat";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
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
          const errorData = (await res.json()) as ApiErrorResponse;

          if (handleApiUpgradeError(errorData)) {
            throw new Error(errorData.error || "Upgrade required.");
          }

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
        const sources = Array.isArray(data.sources) ? dedupeSources(data.sources) : [];
        const sourceCount = typeof data.sourceCount === "number" ? data.sourceCount : sources.length;

        updateAssistantMessage(assistantId, (msg) => ({
          ...msg,
          content: reply,
          sources,
          sourceCount,
          widget: normalizeWidget(data.widget),
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

          updateAssistantMessage(assistantId, (msg) => ({ ...msg, content: fullText }));
        }

        updateAssistantMessage(assistantId, (msg) => ({
          ...msg,
          content: msg.content.trim() || "No response generated.",
        }));
      }

      await refreshConversations(conversationId);
      await fetchUsage();

      trackGaEvent("chat_message_sent", {
        plan,
        mode: useWebSearch ? "web_search" : "standard",
        has_image: hasImage,
        has_documents: hasReadyDocuments,
      });
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
          error instanceof Error ? error.message : "Something went wrong. Please try again.",
        sources: [],
        sourceCount: 0,
        widget: null,
        documents: [],
      }));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function handleStop(): void {
    abortRef.current?.abort();
  }

  function handleModeChange(nextUseWebSearch: boolean): void {
    if (loading) return;

    if (nextUseWebSearch) {
      if (plan !== "pro") {
        openUpgradeModal(
          "Web Search is a Pro feature",
          "Upgrade to Pro to use real-time web search for current answers."
        );
        return;
      }
    
      clearImage();
      clearComposerDocuments();
    }

    setUseWebSearch(nextUseWebSearch);
    clearTransientErrors();
  }

  function renderStatusMessages() {
    return (
      <>
        {usageError && <div className="mt-2 text-xs text-red-400">{usageError}</div>}
        {uiError && <div className="mt-2 text-xs text-red-400">{uiError}</div>}
        {documentError && <div className="mt-2 text-xs text-red-400">{documentError}</div>}
        {speechError && <div className="mt-2 text-xs text-red-400">{speechError}</div>}
      </>
    );
  }

  function renderSidebarActions(isMobile = false) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <Tooltip content={TOOLTIP_TEXT.newChat}>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={loading || sidebarLoading}
            className={cx("px-4 py-2 text-sm", activeTheme.buttonPrimary)}
          >
            New Chat
          </button>
        </Tooltip>

        <Tooltip content={TOOLTIP_TEXT.account}>
          <button
            type="button"
            onClick={() => {
              if (isMobile) setMobileMenuOpen(false);
              router.push("/account");
            }}
            className={getSecondaryButtonClass(activeTheme)}
          >
            Account
          </button>
        </Tooltip>

       {plan !== "pro" && (
         <Tooltip content="Upgrade to Pro">
           <button
             type="button"
             onClick={() => {
               if (isMobile) setMobileMenuOpen(false);
               router.push(BRAND.routes.pricing);
             }}
             className={cx("px-4 py-2 text-sm", activeTheme.buttonPrimary)}
           >
             Upgrade to Pro
           </button>
         </Tooltip>
       )}

        <Tooltip content={TOOLTIP_TEXT.help}>
          <Link
            href="/help"
            onClick={() => {
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={cx(getSecondaryButtonClass(activeTheme), "text-center")}
          >
            Help
          </Link>
        </Tooltip>

        <Tooltip content={TOOLTIP_TEXT.signOut}>
          <button type="button" onClick={handleSignOut} className={getSecondaryButtonClass(activeTheme)}>
            Sign Out
          </button>
        </Tooltip>
      </div>
    );
  }

  function renderConversationCard(conversation: ConversationItem, isMobile = false) {
    const isActive = conversation.id === conversationId;

    return (
      <div
        key={conversation.id}
        className={cx(
          "rounded-xl border p-2 transition",
          isActive ? "border-blue-400/30 bg-white/10 text-white" : cx(activeTheme.panelBorder, "bg-white/[0.03] text-white hover:bg-white/[0.06]")
        )}
      >
        <button
          type="button"
          onClick={() =>
            isMobile ? handleMobileConversationOpen(conversation.id) : loadConversation(conversation.id)
          }
          disabled={loading || sidebarLoading}
          className="w-full text-left"
        >
          <div className="truncate font-medium">{conversation.title?.trim() || "New Chat"}</div>
          <div className={cx("mt-1 text-xs", activeTheme.mutedText)}>
            {formatConversationDate(conversation.updated_at)}
          </div>
        </button>

        <div className="mt-2 flex gap-2">
          <Tooltip content={TOOLTIP_TEXT.renameConversation}>
            <button
              type="button"
              onClick={() => handleRenameConversation(conversation)}
              disabled={loading || sidebarLoading}
              className={cx("rounded-lg px-2 py-1 text-xs", getSecondaryButtonClass(activeTheme))}
            >
              Rename
            </button>
          </Tooltip>

          <Tooltip content={TOOLTIP_TEXT.deleteConversation}>
            <button
              type="button"
              onClick={() => handleDeleteConversation(conversation)}
              disabled={loading || sidebarLoading}
              className="rounded-lg border border-red-900/60 px-2 py-1 text-xs text-red-400 transition hover:border-red-700 disabled:opacity-50"
            >
              Delete
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <>
      <OnboardingModal />

      <UpgradeModal
        open={upgradeModalOpen}
        title={upgradeModalTitle}
        message={upgradeModalMessage}
        onClose={() => setUpgradeModalOpen(false)}
      />

      <main className={cx("h-[100dvh] overflow-hidden transition-colors", activeTheme.pageBg, activeTheme.inputText)}>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button
              type="button"
              aria-label="Close menu overlay"
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileMenuOpen(false)}
            />

            <div className={cx("relative z-10 flex h-full w-80 max-w-[85vw] flex-col border-r", activeTheme.sidebarBg, activeTheme.sidebarBorder)}>
              <div className={cx("sticky top-0 border-b p-4 backdrop-blur", activeTheme.panelBg, activeTheme.panelBorder)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cx("text-xs", activeTheme.mutedText)}>{BRAND.name}</p>
                    <div className="truncate text-sm font-semibold">{userEmail}</div>

                    {usage && (
                      <div className={cx("mt-2 text-xs", activeTheme.mutedText)}>
                        {usage.used} / {usage.limit} messages used today
                      </div>
                    )}
                      <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80">
                        {plan === "pro" ? "Pro Plan" : "Free Plan"}
                      </div>

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

                    {renderStatusMessages()}
                  </div>

                  <button type="button" onClick={() => setMobileMenuOpen(false)} className={getSecondaryButtonClass(activeTheme)}>
                    Close
                  </button>
                </div>

                {renderSidebarActions(true)}
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                <div className={cx("mb-2 text-xs uppercase tracking-wide", activeTheme.mutedText)}>
                  Chat History
                </div>

                <div className="space-y-2">{conversations.map((conversation) => renderConversationCard(conversation, true))}</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex h-full overflow-hidden">
          <aside className={cx("hidden h-full w-80 shrink-0 border-r md:flex md:flex-col", activeTheme.sidebarBg, activeTheme.sidebarBorder)}>
            <div className={cx("sticky top-0 border-b p-4 backdrop-blur", activeTheme.panelBg, activeTheme.panelBorder)}>
              <div className="truncate text-sm font-semibold">{userEmail}</div>

              {usage && (
                <div className={cx("mt-2 text-xs", activeTheme.mutedText)}>
                  {usage.used} / {usage.limit} messages used today
                </div>
              )}
                <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80">
                  {plan === "pro" ? "Pro Plan" : "Free Plan"}
                </div>

              {usage && usage.remaining > 0 && usage.remaining <= 5 && (
                <div className="mt-1 text-xs text-yellow-400">Only {usage.remaining} messages remaining today</div>
              )}

              {isLimitReached && (
                <div className="mt-2 rounded-lg border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
                  Daily limit reached. Come back tomorrow or upgrade your plan.
                </div>
              )}

              {renderStatusMessages()}
              {renderSidebarActions()}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className={cx("mb-2 text-xs uppercase tracking-wide", activeTheme.mutedText)}>
                Chat History
              </div>
              <div className="space-y-2">{conversations.map((conversation) => renderConversationCard(conversation))}</div>
            </div>
          </aside>

          <section className="flex h-full min-w-0 flex-1 flex-col overflow-x-hidden bg-transparent">
            <div className={cx("sticky top-0 z-20 border-b backdrop-blur", activeTheme.panelBg, activeTheme.panelBorder)}>
              <div className={`${CONTENT_RAIL_CLASS} py-2`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setMobileMenuOpen(true)}
                      className={cx("mt-0.5 px-2 py-1 text-sm md:hidden", getSecondaryButtonClass(activeTheme))}
                      aria-label="Open menu"
                    >
                      ☰
                    </button>

                    <div className="min-w-0">
                      <p className={cx("text-[11px]", activeTheme.mutedText)}>{BRAND.name}</p>
                      <h1 className={cx("text-lg font-semibold", activeTheme.titleText)}>AI Assistant</h1>
                    </div>
                  </div>

                  <div className="hidden items-start gap-2 md:flex">
                    <div className={cx("pt-1 text-right text-xs", activeTheme.mutedText)}>{modeLabel}</div>

                    <Tooltip content={TOOLTIP_TEXT.theme}>
                      <button
                        type="button"
                        onClick={() => setThemePickerOpen((prev) => !prev)}
                        className={cx("inline-flex h-9 w-9 items-center justify-center", getSecondaryButtonClass(activeTheme))}
                        aria-label="Open theme picker"
                      >
                        <Palette className="h-4 w-4" />
                      </button>
                    </Tooltip>

                    <Tooltip content={TOOLTIP_TEXT.help}>
                      <Link
                        href="/help"
                        className={cx("inline-flex h-9 w-9 items-center justify-center", getSecondaryButtonClass(activeTheme))}
                        aria-label="Open help"
                      >
                        <HelpCircle className="h-4 w-4" />
                      </Link>
                    </Tooltip>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Tooltip content={TOOLTIP_TEXT.standard}>
                    <button
                      type="button"
                      onClick={() => handleModeChange(false)}
                      disabled={loading}
                      className={getModeButtonClass(activeTheme, !useWebSearch)}
                    >
                      Standard
                    </button>
                  </Tooltip>

                  <Tooltip content={TOOLTIP_TEXT.webSearch}>
                    <button
                      type="button"
                      onClick={() => handleModeChange(true)}
                      disabled={loading}
                      className={getModeButtonClass(activeTheme, useWebSearch)}
                    >
                      Web Search
                    </button>
                  </Tooltip>

                  <Tooltip content={TOOLTIP_TEXT.theme}>
                    <button
                      type="button"
                      onClick={() => setThemePickerOpen((prev) => !prev)}
                      className={cx("inline-flex items-center gap-2 md:hidden", getSecondaryButtonClass(activeTheme))}
                    >
                      <Palette className="h-4 w-4" />
                      Theme
                    </button>
                  </Tooltip>

                  <span className={cx("text-xs md:hidden", activeTheme.mutedText)}>{modeLabel}</span>

                  <Tooltip content={TOOLTIP_TEXT.help}>
                    <Link
                      href="/help"
                      className={cx("inline-flex h-9 w-9 items-center justify-center md:hidden", getSecondaryButtonClass(activeTheme))}
                      aria-label="Open help"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </Link>
                  </Tooltip>
                </div>

                {themePickerOpen && (
                  <div className="mt-4">
                    <ChatThemePicker
                      theme={activeTheme}
                      selectedThemeId={selectedThemeId}
                      onChange={handleThemeChange}
                      onClose={() => setThemePickerOpen(false)}
                    />
                  </div>
                )}

                {messages.length === 0 && (
                  <div className="mt-3">
                    <div className={cx("mb-2 text-[11px] uppercase tracking-wide", activeTheme.mutedText)}>
                      Conversation starters
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {CONVERSATION_STARTERS.map((starter) => (
                        <button
                          key={starter}
                          type="button"
                          onClick={() => handleConversationStarterClick(starter)}
                          disabled={loading || isLimitReached}
                          className={cx("rounded-full px-3 py-2 text-sm", getSecondaryButtonClass(activeTheme))}
                        >
                          {starter}
                        </button>
                      ))}
                    </div>

                    <div className={cx("mt-4 rounded-2xl border p-4", activeTheme.panelBg, activeTheme.panelBorder)}>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <p className="text-xs uppercase tracking-wide text-white/40">
                          Safety
                        </p>

                        <p className="mt-3 text-sm leading-6 text-white/60">
                          Do not share sensitive personal, financial, medical, or confidential
                          information.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
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

                {speechError && (
                  <div className={`${ASSISTANT_BUBBLE_CLASS} mx-auto mb-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300`}>
                    {speechError}
                  </div>
                )}

                <div className="space-y-4">
                  {messages.map((message) => {
                    const sources = Array.isArray(message.sources) ? dedupeSources(message.sources) : [];
                    const sourceCount =
                      typeof message.sourceCount === "number" ? message.sourceCount : sources.length;
                    const messageDocuments = Array.isArray(message.documents) ? message.documents : [];
                    const isStreamingAssistant =
                      loading && message.role === "assistant" && message.id === messages[messages.length - 1]?.id;

                    const bubbleWidthClass =
                      message.role === "user" ? USER_BUBBLE_CLASS : ASSISTANT_BUBBLE_CLASS;

                    return (
                      <div key={message.id} className="space-y-2">
                        <div className={`${bubbleWidthClass} mx-auto ${getBubbleClass(activeTheme, message.role)}`}>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="text-xs font-medium opacity-70">
                              {message.role === "user" ? "You" : "Assistant"}
                            </div>

                            <Tooltip content={TOOLTIP_TEXT.copy}>
                              <button
                                type="button"
                                onClick={() => handleCopyMessage(message.id, getMessageCopyValue(message))}
                                className={cx(
                                  "rounded-lg px-2 py-1 text-xs",
                                  message.role === "user"
                                    ? "border border-white/10 bg-white/10 text-white transition hover:bg-white/20"
                                    : getSecondaryButtonClass(activeTheme)
                                )}
                                aria-label="Copy message"
                              >
                                {copiedMessageId === message.id ? "Copied" : "Copy"}
                              </button>
                            </Tooltip>
                          </div>

                          <MessageWidgetRenderer widget={message.widget} theme={activeTheme} />

                          <div
                            className="
                              prose
                              prose-invert
                              max-w-none
                              min-w-0
                              overflow-x-hidden
                              break-words
                              [overflow-wrap:anywhere]
                              [&_*]:max-w-full
                              prose-headings:text-white
                              prose-p:text-white
                              prose-p:break-words
                              prose-p:[overflow-wrap:anywhere]
                              prose-strong:text-white
                              prose-code:text-white
                              prose-code:break-words
                              prose-code:[overflow-wrap:anywhere]
                              prose-a:text-blue-300
                              prose-a:break-all
                              prose-ul:pl-6
                              prose-ol:pl-6
                              prose-li:text-white
                              prose-li:break-words
                              prose-li:[overflow-wrap:anywhere]
                            "
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.content || (isStreamingAssistant ? "Thinking..." : "")}
                            </ReactMarkdown>
                          </div>

                          {message.image_url && (
                            <div className="mt-3">
                              <img
                                src={message.image_url}
                                alt={message.image_name || "Uploaded image"}
                                className="max-h-56 rounded-xl border border-white/10 object-contain"
                              />
                            </div>
                          )}

                          {messageDocuments.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {messageDocuments.map((doc) => (
                                <div
                                  key={doc.id}
                                  title={
                                    doc.extraction_status === "failed"
                                      ? doc.extraction_error || "Document processing failed."
                                      : undefined
                                  }
                                >
                                  <DocumentChip
                                    name={doc.file_name}
                                    status={
                                      doc.extraction_status === "failed"
                                        ? "failed"
                                        : doc.extraction_status === "ready"
                                          ? "ready"
                                          : "uploading"
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {isStreamingAssistant ? <span className="ml-1 inline-block animate-pulse">▍</span> : null}
                          {message.role === "assistant" && message.content.trim() && !isStreamingAssistant ? (
                            <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
                              <span className="text-xs opacity-60">Was this helpful?</span>

                              <button
                                type="button"
                                onClick={() => handleMessageFeedback(message.id, "up")}
                                className={cx(
                                  "rounded-full border px-2.5 py-1 text-xs transition",
                                  message.feedback === "up"
                                    ? "border-green-400/50 bg-green-500/15 text-green-200"
                                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                                )}
                                aria-label="Mark assistant response as helpful"
                              >
                                👍
                              </button>

                              <button
                                type="button"
                                onClick={() => handleMessageFeedback(message.id, "down")}
                                className={cx(
                                  "rounded-full border px-2.5 py-1 text-xs transition",
                                  message.feedback === "down"
                                    ? "border-red-400/50 bg-red-500/15 text-red-200"
                                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                                )}
                                aria-label="Mark assistant response as not helpful"
                              >
                                👎
                              </button>

                              {message.feedback ? (
                                <span className="text-xs text-white/50">Thanks for the feedback.</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {sources.length > 0 && (
                          <div className={`${ASSISTANT_BUBBLE_CLASS} mx-auto`}>
                            <SourcesDisclosure sources={sources} sourceCount={sourceCount} theme={activeTheme} />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {loading && messages.length > 0 && (
                    <div className={`${ASSISTANT_BUBBLE_CLASS} mx-auto text-xs ${activeTheme.mutedText}`}>
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

            <div className={cx("sticky bottom-0 z-20 border-t bg-black/10 backdrop-blur-xl", activeTheme.panelBorder)}>
              <div className={`${CONTENT_RAIL_CLASS} space-y-1.5 py-2.5`}>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  disabled={composerDisabled || useWebSearch}
                  className="hidden"
                />

                {!useWebSearch && composerDocuments.length > 0 && (
                  <div className={cx("rounded-2xl border p-2", activeTheme.panelBg, activeTheme.panelBorder)}>
                    <div className="flex flex-wrap gap-2">
                      {composerDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          title={
                            doc.extraction_status === "failed"
                              ? doc.extraction_error || "Document processing failed."
                              : undefined
                          }
                        >
                          <DocumentChip
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
                                : () => removeComposerDocument(doc.id)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!useWebSearch && imageBase64 && (
                  <div className={cx("rounded-2xl border p-2", activeTheme.panelBg, activeTheme.panelBorder)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/80">
                        {imageName || "Image attached"}
                      </div>

                      {!loading && (
                        <button type="button" onClick={clearImage} className={getSecondaryButtonClass(activeTheme)}>
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="mt-2">
                      <img
                        src={imageBase64}
                        alt="Selected upload preview"
                        className="max-h-24 rounded-xl border border-white/10 object-contain"
                      />
                    </div>
                  </div>
                )}

            <div
              className={cx(
                "sticky bottom-0 z-30 border-t backdrop-blur-xl",
                "pb-[calc(env(safe-area-inset-bottom)+12px)]",
                activeTheme.panelBg,
                activeTheme.panelBorder
              )}
            >
              <div className={`${CONTENT_RAIL_CLASS} py-2`}>

                <form onSubmit={handleSubmit} className="space-y-2">
                  <div
                    className={cx(
                      "relative w-full rounded-2xl border shadow-[0_10px_30px_rgba(0,0,0,0.25)] focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.4),0_0_25px_rgba(59,130,246,0.18)]",
                      activeTheme.inputBg,
                      activeTheme.inputBorder
                    )}
                  >
                    <textarea
                      value={input}
                      onChange={(event) => {
                        setInput(event.target.value);

                        if (uiError) setUiError("");
                        if (documentError) setDocumentError("");
                        if (speechError) setSpeechError(null);
                      }}
                      onFocus={() => setIsTypingFocused(true)}
                      onBlur={() => setIsTypingFocused(false)}
                      placeholder={
                        useWebSearch
                          ? isListening
                            ? "Listening… tap mic to stop."
                            : "Ask something with web search..."
                          : imageBase64
                            ? "Add context for the image, or send without text..."
                            : composerDocuments.length > 0
                              ? hasPendingDocuments
                                ? "Please wait while documents finish processing..."
                                : "Ask about the attached documents..."
                              : isListening
                                ? "Listening… tap mic to stop."
                                : "Ask something..."
                      }
                      rows={isTypingFocused ? 4 : 2}
                      maxLength={MAX_INPUT_LENGTH}
                      disabled={composerDisabled}
                      className={cx(
                        "w-full resize-none rounded-2xl border bg-transparent px-4 py-3.5 outline-none transition-all duration-200",
                        "min-h-[76px] sm:min-h-[52px]",
                        "max-h-[220px]",
                        "overflow-y-auto",
                        "leading-6",
                        "focus:min-h-[104px]",
                        "sm:focus:min-h-[52px]",
                        activeTheme.panelBorder,
                        activeTheme.inputText,
                        "placeholder:text-white/40"
                      )}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {!useWebSearch && (
                      <>
                        {plan === "pro" ? (
                          <DocumentUploadButton
                            disabled={composerDisabled}
                            onFilesSelected={handleFilesSelected}
                          />
                        ) : (
                          <Tooltip content="File uploads are a Pro feature">
                            <button
                              type="button"
                              onClick={() =>
                                openUpgradeModal(
                                  "File uploads are a Pro feature",
                                  "Upgrade to Pro to upload and analyze PDF, DOCX, XLSX, CSV, and text files."
                                )
                              }
                              disabled={loading}
                              className={cx(
                                "flex h-[52px] w-[52px] shrink-0 items-center justify-center text-xl",
                                getSecondaryButtonClass(activeTheme)
                              )}
                              aria-label="Upgrade to upload files"
                            >
                              +
                            </button>
                          </Tooltip>
                        )}

                        <Tooltip content={TOOLTIP_TEXT.image}>
                          <button
                            type="button"
                            onClick={handleOpenImagePicker}
                            disabled={composerDisabled}
                            className={cx(
                              "flex h-[52px] w-[52px] shrink-0 items-center justify-center text-xl",
                              getSecondaryButtonClass(activeTheme)
                            )}
                            aria-label="Attach image"
                          >
                            🖼️
                          </button>
                        </Tooltip>
                      </>
                    )}

                    <Tooltip content={TOOLTIP_TEXT.mic}>
                      <button
                        type="button"
                        onClick={isListening ? handleStopListening : handleStartListening}
                        disabled={micDisabled}
                        aria-label={isListening ? "Stop voice input" : "Start voice input"}
                        className={cx(
                          "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border transition disabled:cursor-not-allowed disabled:opacity-50",
                          isListening
                            ? "border-red-500 bg-red-500/15 text-red-400 shadow-[0_0_0_6px_rgba(239,68,68,0.12)] animate-pulse"
                            : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                        )}
                      >
                        {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                      </button>
                    </Tooltip>

                    <div className="ml-auto">
                      {loading ? (
                        <Tooltip content={TOOLTIP_TEXT.stop}>
                          <button
                            type="button"
                            onClick={handleStop}
                            className="h-[52px] rounded-2xl border border-red-700 px-5 py-3.5 text-white transition hover:bg-red-900/30"
                          >
                            Stop
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip content={TOOLTIP_TEXT.send}>
                          <button
                            type="submit"
                            disabled={
                              composerDisabled ||
                              (!input.trim() && !imageBase64 && readyDocumentIds.length === 0)
                            }
                            className={cx(
                              "h-[52px] rounded-2xl px-5 py-3.5 text-white transition disabled:cursor-not-allowed disabled:opacity-50",
                              activeTheme.buttonPrimary
                            )}
                          >
                            Send
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </div>
             
                <div className="flex items-center justify-between gap-3 px-1">
                  <div className={cx("text-[11px]", activeTheme.mutedText)}>
                    {MAX_INPUT_LENGTH - input.length} characters remaining
                  </div>

                  <div className={cx("text-[11px]", activeTheme.mutedText)}>
                    {conversationDocuments.length > 0
                      ? `${conversationDocuments.length} document${conversationDocuments.length === 1 ? "" : "s"} in this conversation`
                      : "No conversation documents"}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}