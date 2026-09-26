"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy as CopyIcon,
  Download,
  FileText,
  Globe2,
  HelpCircle,
  ImageIcon,
  Mic,
  MicOff,
  MessageCircle,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/branding";
import Tooltip from "@/components/ui/Tooltip";
import OnboardingModal from "@/components/help/OnboardingModal";
import DocumentUploadButton from "@/components/DocumentUploadButton";
import DocumentChip from "@/components/DocumentChip";
import { DOCUMENT_LIMITS } from "@/lib/documents/config";
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
import ImageEditDialog, {
  getImageEditInstructionError,
  type ImageEditDialogStatus,
} from "@/components/chat/ImageEditDialog";
import type { ImageEditSourceReference } from "@/lib/image-generation/lineage";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { ChatMessageContent } from "@/components/chat/ChatMessageContent";

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

export type PendingImage = {
  id: string;
  name: string;
  path: string;
  previewUrl: string;
};

export type MessageImage = {
  image_path: string;
  image_name: string;
  image_url?: string;
  ordinal?: number;
};

export type GeneratedImage = {
  id?: string;
  url: string;
  mimeType: string;
  provider?: string;
  model?: string;
};

export type GeneratedImageResult = GeneratedImage & {
  userMessageId?: string;
  assistantMessageId?: string;
};

export type NativeGeneratedImageDownloadRequest = {
  base64: string;
  fileName: string;
  mimeType: string;
};

type NativeGeneratedImageDownloadPlugin = {
  save(options: NativeGeneratedImageDownloadRequest): Promise<void>;
};

const NativeGeneratedImageDownload = registerPlugin<NativeGeneratedImageDownloadPlugin>(
  "GeneratedImageDownload"
);

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string | null;
  feedback?: MessageFeedbackRating | null;
  sources?: SourceItem[];
  sourceCount?: number;
  widget?: MessageWidget | null;
  image_path?: string | null;
  image_name?: string | null;
  image_url?: string | null;
  images?: MessageImage[];
  has_child_images?: boolean;
  documents?: UploadedDocument[];
  generatedImage?: GeneratedImage;
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

type ProfileMenuPosition = {
  top: number;
  left: number;
  width: number;
};

type ConversationRowProps = {
  conversation: ConversationItem;
  theme: ChatTheme;
  isActive: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
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
  imageGeneration?: ImageGenerationUsage;
};

type ImageUsageWindow = {
  used: number;
  reserved: number;
  limit: number;
  remaining: number;
};

type ImageGenerationUsage = {
  plan: Plan;
  daily: ImageUsageWindow;
  monthly: ImageUsageWindow;
};

type ImageQuotaWindow = "daily" | "monthly";

type DocumentsResponse = {
  documents?: UploadedDocument[];
  error?: string;
};

export type ComposerPlusMenuMode = "standard" | "web_search" | "create_image";

export type ComposerPlusMenuAction =
  | "camera"
  | "photos"
  | "files"
  | "create_image"
  | "web_search"
  | "standard";

export const COMPOSER_PLUS_MENU_LABELS: Record<ComposerPlusMenuAction, string> = {
  camera: "Camera",
  photos: "Photos",
  files: "Files",
  create_image: "Create image",
  web_search: "Web search",
  standard: "Standard",
};

export function getComposerPlusMenuActions(
  mode: ComposerPlusMenuMode
): ComposerPlusMenuAction[] {
  if (mode === "web_search") return ["standard", "create_image"];
  if (mode === "create_image") return ["standard", "web_search"];
  return ["camera", "photos", "files", "create_image", "web_search"];
}

export function isCameraCaptureSupported(
  userAgent: string,
  isNativeApp: boolean
): boolean {
  return isNativeApp || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function getSelectedImageFiles(files: FileList | null): File[] {
  return Array.from(files ?? []);
}

type ComposerPlusMenuProps = {
  open: boolean;
  mode: ComposerPlusMenuMode;
  disabled: boolean;
  cameraEnabled: boolean;
  onToggle: () => void;
  onAction: (action: ComposerPlusMenuAction) => void;
  buttonRef?: Ref<HTMLButtonElement>;
  menuRef?: Ref<HTMLDivElement>;
};

export function ComposerPlusMenu({
  open,
  mode,
  disabled,
  cameraEnabled,
  onToggle,
  onAction,
  buttonRef,
  menuRef,
}: ComposerPlusMenuProps) {
  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Open composer actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="composer-plus-menu"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          id="composer-plus-menu"
          role="menu"
          aria-label="Composer actions"
          className="absolute bottom-full left-0 z-40 mb-2 min-w-52 max-w-[calc(100vw-1.5rem)] origin-bottom-left rounded-xl border border-white/10 bg-neutral-950/95 p-1.5 shadow-2xl backdrop-blur"
        >
          {getComposerPlusMenuActions(mode).map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              onClick={() => onAction(action)}
              disabled={action === "camera" && !cameraEnabled}
              aria-disabled={action === "camera" && !cameraEnabled}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/85 transition hover:bg-white/10 focus:bg-white/10 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {action === "camera" && <Camera className="h-4 w-4" aria-hidden="true" />}
              {action === "photos" && <ImageIcon className="h-4 w-4" aria-hidden="true" />}
              {action === "files" && <FileText className="h-4 w-4" aria-hidden="true" />}
              {action === "create_image" && <Palette className="h-4 w-4" aria-hidden="true" />}
              {action === "web_search" && <Globe2 className="h-4 w-4" aria-hidden="true" />}
              {action === "standard" && <MessageCircle className="h-4 w-4" aria-hidden="true" />}
              <span>{COMPOSER_PLUS_MENU_LABELS[action]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type ImageEditOperation = {
  conversationId: string;
  sourceReference: ImageEditSourceReference;
  sourcePreview: string;
  sourceLabel: string;
  instruction: string;
  idempotencyKey: string | null;
  status: ImageEditDialogStatus;
  error: string | null;
  errorCode: string | null;
  canRetry: boolean;
};

export function getUploadedMessageImageGridClass(imageCount: number): string {
  if (imageCount <= 1) return "grid-cols-1 sm:max-w-md";
  if (imageCount === 2) return "grid-cols-2";
  return "grid-cols-2 sm:grid-cols-3";
}

function ConversationRow({
  conversation,
  theme,
  isActive,
  disabled,
  onSelect,
  onRename,
  onDelete,
}: ConversationRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const conversationTitle = conversation.title?.trim() || "New Chat";
  const menuId = `conversation-menu-${conversation.id}`;

  function closeMenu(restoreFocus = false): void {
    setMenuOpen(false);
    setMenuPosition(null);

    if (restoreFocus) {
      menuButtonRef.current?.focus();
    }
  }

  function getMenuPosition(): { top: number; left: number } | null {
    const button = menuButtonRef.current;
    if (!button) return null;

    const buttonRect = button.getBoundingClientRect();
    const menuWidth = 160;
    const estimatedMenuHeight = 96;
    const viewportPadding = 8;
    const gap = 4;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - menuWidth - viewportPadding
    );
    const left = Math.min(
      Math.max(viewportPadding, buttonRect.right - menuWidth),
      maxLeft
    );
    const hasRoomBelow =
      window.innerHeight - buttonRect.bottom >=
      estimatedMenuHeight + viewportPadding;
    const top = hasRoomBelow
      ? buttonRect.bottom + gap
      : Math.max(
          viewportPadding,
          buttonRect.top - estimatedMenuHeight - gap
        );

    return { top, left };
  }

  function toggleMenu(): void {
    if (menuOpen) {
      closeMenu(true);
      return;
    }

    setMenuPosition(getMenuPosition());
    setMenuOpen(true);
  }

  useEffect(() => {
    if (!menuOpen) return;

    const updateMenuPosition = () => {
      const button = menuButtonRef.current;
      if (!button) return;

      const buttonRect = button.getBoundingClientRect();
      const menuWidth = 160;
      const menuHeight = menuRef.current?.offsetHeight ?? 96;
      const viewportPadding = 8;
      const gap = 4;
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - menuWidth - viewportPadding
      );
      const left = Math.min(
        Math.max(viewportPadding, buttonRect.right - menuWidth),
        maxLeft
      );
      const hasRoomBelow =
        window.innerHeight - buttonRect.bottom >=
        menuHeight + viewportPadding;
      const top = hasRoomBelow
        ? buttonRect.bottom + gap
        : Math.max(viewportPadding, buttonRect.top - menuHeight - gap);

      setMenuPosition((current) =>
        current?.top === top && current.left === left ? current : { top, left }
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rowRef.current?.contains(event.target)) {
        return;
      }

      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      closeMenu(true);
    };

    const historyScrollContainer =
      rowRef.current?.closest<HTMLElement>("[data-sidebar-history]");
    const handleHistoryScroll = () => {
      closeMenu();
    };

    const animationFrameId = window.requestAnimationFrame(() => {
      updateMenuPosition();
      firstMenuItemRef.current?.focus();
    });

    window.addEventListener("resize", updateMenuPosition);
    historyScrollContainer?.addEventListener("scroll", handleHistoryScroll, {
      passive: true,
    });
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", updateMenuPosition);
      historyScrollContainer?.removeEventListener("scroll", handleHistoryScroll);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      ref={rowRef}
      className={cx(
        "relative flex min-w-0 items-center gap-1 rounded-lg px-2 py-2 transition",
        isActive
          ? "bg-white/[0.08] text-white"
          : "text-white/80 hover:bg-white/[0.05]"
      )}
    >
      <button
        type="button"
        onClick={() => {
          closeMenu();
          onSelect();
        }}
        disabled={disabled}
        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="truncate text-sm font-medium">{conversationTitle}</div>
        <div className={cx("mt-0.5 truncate text-xs", theme.mutedText)}>
          {formatConversationDate(conversation.updated_at)}
        </div>
      </button>

      <Tooltip content={`More actions for ${conversationTitle}`}>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={toggleMenu}
          disabled={disabled}
          className={cx(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition",
            "text-white/50 hover:bg-white/10 hover:text-white",
            "focus:outline-none focus:ring-2 focus:ring-white/30",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
          aria-label={`More actions for ${conversationTitle}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </Tooltip>

      {menuOpen && menuPosition && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${conversationTitle}`}
          className={cx(
            "fixed z-[60] w-40 rounded-lg border p-1 shadow-xl",
            theme.panelBg,
            theme.panelBorder
          )}
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <button
            ref={firstMenuItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onRename();
            }}
            disabled={disabled}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rename
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onDelete();
            }}
            disabled={disabled}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-red-300 transition hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

const MAX_INLINE_INPUT_LENGTH = 2000;
const MAX_REQUEST_MESSAGE_LENGTH = 4000;
const PASTED_TEXT_FILE_NAME = "pasted-text.txt";
const COMPOSER_TEXTAREA_MIN_HEIGHT = 52;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 180;
const GENERATED_IMAGE_DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000;
const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1024;
const JPEG_QUALITY = 0.72;
const FREE_MAX_PENDING_IMAGES = 1;
const PRO_MAX_PENDING_IMAGES = 3;
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

const CONVERSATION_STARTER = "Explain something step by step";

const SIDEBAR_LABEL_CLASS = "text-sm font-medium";
const PROFILE_MENU_HORIZONTAL_INSET = 12;

function getProfileMenuContainerBounds(
  trigger: HTMLElement,
): { left: number; width: number } | null {
  const container = trigger.closest<HTMLElement>("[data-profile-sidebar]");
  if (!container) return null;

  const rect = container.getBoundingClientRect();
  if (rect.width <= PROFILE_MENU_HORIZONTAL_INSET * 2) return null;

  return {
    left: rect.left + PROFILE_MENU_HORIZONTAL_INSET,
    width: rect.width - PROFILE_MENU_HORIZONTAL_INSET * 2,
  };
}

export function calculateComposerTextareaSize(
  inputValue: string,
  scrollHeight: number
): { height: number; overflowY: "hidden" | "auto" } {
  if (inputValue.length === 0) {
    return {
      height: COMPOSER_TEXTAREA_MIN_HEIGHT,
      overflowY: "hidden",
    };
  }

  return {
    height: Math.min(
      Math.max(scrollHeight, COMPOSER_TEXTAREA_MIN_HEIGHT),
      COMPOSER_TEXTAREA_MAX_HEIGHT
    ),
    overflowY:
      scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden",
  };
}

export function shouldConvertLargePasteToAttachment(pastedText: string): boolean {
  return pastedText.length > MAX_INLINE_INPUT_LENGTH;
}

export function insertTextAtSelection(
  value: string,
  pastedText: string,
  selectionStart: number,
  selectionEnd: number,
): string {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));

  return `${value.slice(0, start)}${pastedText}${value.slice(end)}`;
}

export function createPastedTextAttachment(pastedText: string): File {
  return new File([pastedText], PASTED_TEXT_FILE_NAME, { type: "text/plain" });
}

export function getComposerMessageLengthError(inputLength: number): string | null {
  return inputLength > MAX_REQUEST_MESSAGE_LENGTH
    ? `Message too long. Maximum ${MAX_REQUEST_MESSAGE_LENGTH} characters.`
    : null;
}

export type ImageGenerationClientErrorCode =
  | "http"
  | "network"
  | "invalid_response"
  | "download";

export class ImageGenerationClientError extends Error {
  readonly code: ImageGenerationClientErrorCode;
  readonly status?: number;

  constructor(
    code: ImageGenerationClientErrorCode,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "ImageGenerationClientError";
    this.code = code;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function getImageGenerationErrorMessage(
  status: number,
  code?: string,
  plan: Plan = "free",
): string {
  if (status === 429 && code === "IMAGE_DAILY_LIMIT_REACHED") {
    return getImageGenerationQuotaMessage(plan, "daily");
  }

  if (status === 429 && code === "IMAGE_MONTHLY_LIMIT_REACHED") {
    return getImageGenerationQuotaMessage(plan, "monthly");
  }

  switch (status) {
    case 400:
      return "Please enter a valid image prompt.";
    case 401:
      return "Your session has expired. Please sign in again.";
    case 413:
      return "That image request is too large. Please shorten the prompt.";
    case 415:
      return "Image generation requires a JSON request.";
    case 500:
      return "Image generation is not configured right now.";
    case 502:
      return "Image generation is temporarily unavailable. Please try again.";
    default:
      return "Image generation failed. Please try again.";
  }
}

export function getImageGenerationQuotaMessage(
  plan: Plan,
  window: ImageQuotaWindow,
): string {
  if (window === "daily") {
    return plan === "pro"
      ? "Daily image limit reached. Come back tomorrow."
      : "Daily image limit reached. Come back tomorrow or upgrade to Pro.";
  }

  return plan === "pro"
    ? "Monthly image limit reached. Come back next month."
    : "Monthly image limit reached. Come back next month or upgrade to Pro.";
}

export function getGeneratedImageDeleteErrorMessage(
  status: number,
  code?: string,
  serverMessage?: string,
): string {
  if (code === "IMAGE_HAS_DERIVATIVES") {
    return "This image can't be deleted because edited images depend on it.";
  }

  if (typeof serverMessage === "string" && serverMessage.trim()) {
    return serverMessage;
  }

  return status === 404
    ? "Generated image not found."
    : "The generated image could not be deleted.";
}

export function buildImageEditRequestBody(
  operation: Pick<ImageEditOperation, "conversationId" | "sourceReference" | "instruction">,
  idempotencyKey: string,
) {
  return {
    conversationId: operation.conversationId,
    sourceReference: operation.sourceReference,
    instruction: operation.instruction,
    idempotencyKey,
  };
}

export function getImageEditErrorMessage(
  status: number,
  code?: string,
  plan: Plan = "free",
): { message: string; canRetry: boolean } {
  if (status === 429 && (code === "IMAGE_DAILY_LIMIT_REACHED" || code === "IMAGE_MONTHLY_LIMIT_REACHED")) {
    return {
      message: getImageGenerationErrorMessage(status, code, plan),
      canRetry: false,
    };
  }

  switch (code) {
    case "IMAGE_EDIT_SOURCE_UNAVAILABLE":
      return { message: "This image is no longer available to edit.", canRetry: false };
    case "IMAGE_EDIT_IDEMPOTENCY_CONFLICT":
      return { message: "This edit request conflicts with an earlier request. Start a new edit.", canRetry: false };
    case "IMAGE_EDIT_RESULT_UNAVAILABLE":
      return { message: "This completed edit is no longer available.", canRetry: false };
    case "IMAGE_EDIT_CONFIGURATION":
      return { message: "Image editing is not configured right now.", canRetry: false };
    case "INVALID_REQUEST":
      return { message: "The image edit request is invalid.", canRetry: false };
    case "IMAGE_EDIT_PROVIDER_TIMEOUT":
      return { message: "Image editing timed out. You can retry this edit.", canRetry: true };
    case "IMAGE_EDIT_PROVIDER_FAILURE":
    case "IMAGE_EDIT_INVALID_PROVIDER_OUTPUT":
    case "IMAGE_EDIT_ATTEMPT_START_FAILED":
      return { message: "Image editing could not be completed. Try again.", canRetry: true };
    case "IMAGE_DAILY_LIMIT_REACHED":
    case "IMAGE_MONTHLY_LIMIT_REACHED":
      return { message: "Image editing is temporarily unavailable.", canRetry: false };
    case "UNAUTHORIZED":
      return { message: "Your session has expired. Please sign in again.", canRetry: false };
  }

  if (status === 400) {
    return { message: "The image edit request is invalid.", canRetry: false };
  }

  if (status === 401) {
    return { message: "Your session has expired. Please sign in again.", canRetry: false };
  }

  if (status === 404) {
    return { message: "This image is no longer available to edit.", canRetry: false };
  }

  if (status === 409) {
    return { message: "This edit request conflicts with an earlier request. Start a new edit.", canRetry: false };
  }

  if (status === 410) {
    return { message: "This completed edit is no longer available.", canRetry: false };
  }

  if (status === 429) {
    return { message: "Image editing is temporarily unavailable.", canRetry: false };
  }

  if (status === 504) {
    return { message: "Image editing timed out. You can retry this edit.", canRetry: true };
  }

  return {
    message:
      status === 502
        ? "Image editing could not be completed. Try again."
        : "Image editing is temporarily unavailable.",
    canRetry: true,
  };
}

function getImageEditResponseField(data: unknown, field: "status" | "code"): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const value = (data as Record<string, unknown>)[field];
  if (typeof value === "string") return value;

  const error = (data as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;

  const nestedValue = (error as Record<string, unknown>)[field];
  return typeof nestedValue === "string" ? nestedValue : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeResponseMimeType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isImageMimeType(value: string): boolean {
  return value.startsWith("image/");
}

function getSafeImageMetadataHeader(
  response: Response,
  headerName: string
): string | undefined {
  const value = response.headers.get(headerName)?.trim();

  if (!value || value.length > 100 || !/^[a-zA-Z0-9._:/-]+$/.test(value)) {
    return undefined;
  }

  return value;
}

function getSafeUuidHeader(response: Response, headerName: string): string | undefined {
  const value = response.headers.get(headerName)?.trim();
  return value && UUID_PATTERN.test(value) ? value : undefined;
}

async function throwImageGenerationHttpError(
  response: Response,
  plan: Plan,
): Promise<never> {
  const contentType = response.headers.get("content-type") || "";
  let errorCode: string | undefined;

  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      !Array.isArray(body.error) &&
      "code" in body.error &&
      typeof body.error.code === "string"
    ) {
      errorCode = body.error.code;
    }
  }

  throw new ImageGenerationClientError(
    "http",
    getImageGenerationErrorMessage(response.status, errorCode, plan),
    response.status
  );
}

export async function fetchGeneratedImage(
  prompt: string,
  options: {
    conversationId: string;
    signal?: AbortSignal;
    plan?: Plan;
    fetcher?: typeof fetch;
    createObjectUrl?: (blob: Blob) => string;
  }
): Promise<GeneratedImageResult> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;

  try {
    response = await fetcher("/api/image-generation", {
      method: "POST",
      signal: options.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: options.conversationId, prompt }),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;

    throw new ImageGenerationClientError(
      "network",
      "Could not reach image generation. Please try again."
    );
  }

  if (!response.ok) {
    return throwImageGenerationHttpError(response, options.plan ?? "free");
  }

  const responseMimeType = normalizeResponseMimeType(
    response.headers.get("content-type")
  );

  if (!isImageMimeType(responseMimeType)) {
    throw new ImageGenerationClientError(
      "invalid_response",
      "Image generation returned an invalid image. Please try again."
    );
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new ImageGenerationClientError(
      "invalid_response",
      "Image generation returned an unreadable image. Please try again."
    );
  }

  const blobMimeType = normalizeResponseMimeType(blob.type);
  if (blob.size === 0 || (blobMimeType && !isImageMimeType(blobMimeType))) {
    throw new ImageGenerationClientError(
      "invalid_response",
      "Image generation returned an invalid image. Please try again."
    );
  }

  let url: string;
  try {
    url = (options.createObjectUrl ?? ((value) => URL.createObjectURL(value)))(
      blob
    );
  } catch {
    throw new ImageGenerationClientError(
      "invalid_response",
      "Generated image could not be displayed. Please try again."
    );
  }

  const generatedImageId = getSafeUuidHeader(
    response,
    "x-lvtchat-generated-image-id"
  );
  const userMessageId = getSafeUuidHeader(
    response,
    "x-lvtchat-user-message-id"
  );
  const assistantMessageId = getSafeUuidHeader(
    response,
    "x-lvtchat-assistant-message-id"
  );

  return {
    url,
    mimeType: responseMimeType,
    ...(getSafeImageMetadataHeader(response, "x-lvtchat-image-provider")
      ? {
          provider: getSafeImageMetadataHeader(
            response,
            "x-lvtchat-image-provider"
          ),
        }
      : {}),
    ...(getSafeImageMetadataHeader(response, "x-lvtchat-image-model")
      ? {
          model: getSafeImageMetadataHeader(response, "x-lvtchat-image-model"),
        }
      : {}),
    ...(generatedImageId ? { id: generatedImageId } : {}),
    ...(userMessageId ? { userMessageId } : {}),
    ...(assistantMessageId ? { assistantMessageId } : {}),
  };
}

export function shouldRevokeGeneratedImageUrl(url: string): boolean {
  return url.startsWith("blob:");
}

function revokeGeneratedImageObjectUrl(url: string): void {
  if (shouldRevokeGeneratedImageUrl(url) && typeof URL !== "undefined") {
    URL.revokeObjectURL(url);
  }
}

const GENERATED_IMAGE_DOWNLOAD_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export type GeneratedImageDownloadOptions = {
  fetcher?: typeof fetch;
  createObjectUrl?: (blob: Blob) => string;
  createAnchor?: () => HTMLAnchorElement;
  revokeObjectUrl?: (url: string) => void;
  scheduleObjectUrlRevoke?: (callback: () => void) => void;
  nativeSave?: (options: NativeGeneratedImageDownloadRequest) => Promise<void>;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  if (typeof btoa !== "function") {
    throw new Error("Base64 encoding is unavailable.");
  }

  return btoa(binary);
}

export async function downloadGeneratedImage(
  generatedImageId: string,
  options: GeneratedImageDownloadOptions = {},
): Promise<void> {
  if (!UUID_PATTERN.test(generatedImageId)) {
    throw new ImageGenerationClientError(
      "download",
      "This generated image cannot be downloaded.",
    );
  }

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `/api/generated-images/${encodeURIComponent(generatedImageId)}/download`,
      { method: "GET", cache: "no-store" },
    );
  } catch {
    throw new ImageGenerationClientError(
      "download",
      "Could not download the generated image. Please try again.",
    );
  }

  if (!response.ok) {
    throw new ImageGenerationClientError(
      "download",
      "Could not download the generated image. Please try again.",
      response.status,
    );
  }

  const mimeType = normalizeResponseMimeType(response.headers.get("content-type"));
  const extension = GENERATED_IMAGE_DOWNLOAD_EXTENSIONS[mimeType];
  if (!extension) {
    throw new ImageGenerationClientError(
      "download",
      "The generated image could not be downloaded safely.",
      response.status,
    );
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new ImageGenerationClientError(
      "download",
      "The generated image could not be downloaded safely.",
      response.status,
    );
  }

  if (blob.size === 0) {
    throw new ImageGenerationClientError(
      "download",
      "The generated image could not be downloaded safely.",
      response.status,
    );
  }

  const fileName = `lvtchat-image-${generatedImageId}.${extension}`;

  if (options.nativeSave) {
    try {
      await options.nativeSave({
        base64: await blobToBase64(blob),
        fileName,
        mimeType,
      });
      return;
    } catch {
      throw new ImageGenerationClientError(
        "download",
        "Could not save the generated image. Please try again.",
        response.status,
      );
    }
  }

  let temporaryUrl: string;
  try {
    temporaryUrl = (
      options.createObjectUrl ?? ((value: Blob) => URL.createObjectURL(value))
    )(blob);
  } catch {
    throw new ImageGenerationClientError(
      "download",
      "The generated image could not be downloaded safely.",
      response.status,
    );
  }

  try {
    const anchor =
      options.createAnchor?.() ??
      (typeof document !== "undefined" ? document.createElement("a") : null);

    if (!anchor) {
      throw new ImageGenerationClientError(
        "download",
        "The generated image could not be downloaded safely.",
        response.status,
      );
    }

    anchor.href = temporaryUrl;
    anchor.download = fileName;
    anchor.rel = "noreferrer";
    anchor.click();
  } finally {
    const revoke = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
    const schedule =
      options.scheduleObjectUrlRevoke ??
      ((callback: () => void) => {
        if (typeof window !== "undefined") {
          window.setTimeout(callback, GENERATED_IMAGE_DOWNLOAD_URL_REVOKE_DELAY_MS);
        } else {
          callback();
        }
      });

    schedule(() => revoke(temporaryUrl));
  }
}

export function getMaxPendingImages(plan: string | null | undefined): number {
  return plan === "pro" ? PRO_MAX_PENDING_IMAGES : FREE_MAX_PENDING_IMAGES;
}

export function getPendingImageLimitMessage(plan: string | null | undefined): string {
  return plan === "pro"
    ? "You can attach up to 3 images per message."
    : "Free plans allow one image per message.";
}

export function validateImageBatch(
  files: Array<Pick<File, "type" | "size">>
): string | null {
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return "Please choose a valid image file.";
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      return "Image file is too large.";
    }
  }

  return null;
}

export function canAddPendingImages(
  currentCount: number,
  incomingCount: number,
  plan: string | null | undefined
): boolean {
  return currentCount + incomingCount <= getMaxPendingImages(plan);
}

export function buildStoredImagePayload(images: PendingImage[]) {
  return images.map((image) => ({
    imagePath: image.path,
    imageName: image.name,
  }));
}

export function buildOptimisticImageAttachments(images: PendingImage[]): MessageImage[] {
  return images.map((image) => ({
    image_path: image.path,
    image_name: image.name,
    image_url: image.previewUrl,
  }));
}

export function removePendingImage(images: PendingImage[], id: string): PendingImage[] {
  return images.filter((image) => image.id !== id);
}

export function removeSubmittedPendingImages(
  images: PendingImage[],
  submittedIds: string[]
): PendingImage[] {
  const submittedIdSet = new Set(submittedIds);
  return images.filter((image) => !submittedIdSet.has(image.id));
}

export function restorePendingImageSnapshot(
  current: PendingImage[],
  snapshot: PendingImage[]
): PendingImage[] {
  const currentIds = new Set(current.map((image) => image.id));
  return [...snapshot.filter((image) => !currentIds.has(image.id)), ...current];
}

export function rollbackOptimisticMessages<T extends { id: string }>(
  messages: T[],
  optimisticIds: string[]
): T[] {
  const optimisticIdSet = new Set(optimisticIds);
  return messages.filter((message) => !optimisticIdSet.has(message.id));
}

export type PendingImageCleanupReason = "discard" | "upload-failure" | "request-failure" | "accepted";

export function getPendingImageCleanupPaths(
  images: PendingImage[],
  reason: PendingImageCleanupReason
): string[] {
  if (reason === "request-failure" || reason === "accepted") {
    return [];
  }

  return images.map((image) => image.path).filter(Boolean);
}

export function canSubmitWithPendingImages(
  input: string,
  pendingImageCount: number,
  readyDocumentCount: number
): boolean {
  return Boolean(input.trim() || pendingImageCount > 0 || readyDocumentCount > 0);
}

const TOOLTIP_TEXT = {
  help: "Open help and frequently asked questions",
  newChat: "Start a new conversation",
  standard: "General writing, brainstorming, and everyday help",
  webSearch: "Use current online information when freshness matters",
  imageMode: "Generate an image from your prompt",
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

const CONTENT_RAIL_CLASS = "mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 min-w-0 overflow-x-hidden";
const COMPOSER_RAIL_CLASS = "mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 min-w-0";
const ASSISTANT_BUBBLE_CLASS = "w-full max-w-3xl min-w-0";
const USER_BUBBLE_CLASS = "ml-auto w-fit max-w-[90%] min-w-0 sm:max-w-[70%]";

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

export function normalizeInitialMessages(messages: Message[]): Message[] {
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
    images: normalizeMessageImages(message.images),
    documents: Array.isArray(message.documents)
      ? cloneDocuments(message.documents)
      : [],
  }));
}

export function removeGeneratedImageMessage(
  messages: Message[],
  generatedImageId: string,
): Message[] {
  return messages.filter(
    (message) =>
      message.role !== "assistant" || message.generatedImage?.id !== generatedImageId,
  );
}

export function createOptimisticUserMessage(
  id: string,
  content: string,
  images: MessageImage[] = [],
  documents: UploadedDocument[] = []
): Message {
  return {
    id,
    role: "user",
    content,
    created_at: new Date().toISOString(),
    ...(images.length > 0 ? { images } : {}),
    documents: cloneDocuments(documents),
  };
}

export function createOptimisticAssistantMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    content: "",
    created_at: new Date().toISOString(),
    sources: [],
    sourceCount: 0,
    widget: null,
    documents: [],
  };
}

export function reconcileGeneratedImageMessages(
  messages: Message[],
  optimisticUserId: string,
  optimisticAssistantId: string,
  result: GeneratedImageResult,
): Message[] {
  const {
    userMessageId,
    assistantMessageId,
    ...generatedImage
  } = result;

  return messages.map((message) => {
    if (message.id === optimisticUserId && userMessageId) {
      return { ...message, id: userMessageId };
    }

    if (message.id !== optimisticAssistantId) {
      return message;
    }

    return {
      ...message,
      id: assistantMessageId ?? message.id,
      generatedImage,
    };
  });
}

export function resolveGeneratedImagePrompt(
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }>,
  assistantMessageId: string,
): string | null {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId && message.role === "assistant",
  );
  const sourceMessage =
    assistantIndex > 0 ? messages[assistantIndex - 1] : undefined;

  if (!sourceMessage || sourceMessage.role !== "user") {
    return null;
  }

  const prompt = sourceMessage.content.trim();
  return prompt || null;
}

export function normalizeMessageImages(input: unknown): MessageImage[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object"
    )
    .map((item) => {
      const imagePath =
        typeof item.image_path === "string" ? item.image_path.trim() : "";
      const imageName =
        typeof item.image_name === "string" ? item.image_name.trim() : "";
      const imageUrl =
        typeof item.image_url === "string" && item.image_url.trim()
          ? item.image_url
          : undefined;
      const ordinal =
        typeof item.ordinal === "number" ? item.ordinal : undefined;

      return {
        image_path: imagePath,
        image_name: imageName,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        ...(ordinal !== undefined ? { ordinal } : {}),
      };
    })
    .filter((image) => image.image_path.length > 0 && image.image_name.length > 0);
}

export function isEligibleUploadedMessageImage(
  image: MessageImage | null | undefined,
): image is MessageImage & { ordinal: number } {
  return Boolean(
    image &&
      typeof image.ordinal === "number" &&
      Number.isSafeInteger(image.ordinal) &&
      image.ordinal >= 1,
  );
}

export function getUploadedImageEditSourceReference(
  messageId: string,
  image: MessageImage,
): ImageEditSourceReference | null {
  if (!messageId || !isEligibleUploadedMessageImage(image)) return null;

  return {
    kind: "uploaded_image",
    messageId,
    ordinal: image.ordinal,
  };
}

export function hasCanonicalChildImages(message: {
  images?: unknown;
  has_child_images?: boolean;
}): boolean {
  return (
    message.has_child_images === true ||
    (Array.isArray(message.images) && message.images.length > 0)
  );
}

export function getMessageImageSource(message: {
  images?: unknown;
  has_child_images?: boolean;
  image_url?: string | null;
}): "children" | "legacy" | "none" {
  if (hasCanonicalChildImages(message)) return "children";
  if (typeof message.image_url === "string" && message.image_url.trim()) {
    return "legacy";
  }
  return "none";
}

export function shouldApplyMessageLoad(
  requestGeneration: number,
  currentGeneration: number
): boolean {
  return requestGeneration === currentGeneration;
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

export function formatMessageTime(createdAt?: string | null): string | null {
  if (!createdAt) return null;

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function getMessageDisplayLabel(role: "user" | "assistant"): string {
  return role === "user" ? "You" : "LVTChat";
}

function getUserInitials(email: string): string {
  const localPart = email.trim().split("@")[0] ?? "";
  const nameParts = localPart.split(/[._-]+/).filter(Boolean);

  if (nameParts.length >= 2) {
    return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase();
  }

  return localPart.slice(0, 2).toUpperCase() || "A";
}

export function getProfileDisplayName(email: string): string {
  const localPart = email.trim().split("@")[0] ?? "";
  const words = localPart.split(/[._-]+/).filter(Boolean);

  if (words.length === 0) return "LVTChat user";

  return words
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

export function getMessageCopyValue(message: Pick<Message, "content">): string {
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
    ? cx(
        "inline-flex h-10 items-center gap-1.5 rounded-full border px-3 transition focus:outline-none focus:ring-2 focus:ring-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50",
        SIDEBAR_LABEL_CLASS,
        "border-blue-500/70 bg-blue-600 text-white hover:bg-blue-500"
      )
    : cx(
        "inline-flex h-10 items-center gap-1.5 rounded-full border px-3 transition focus:outline-none focus:ring-2 focus:ring-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50",
        SIDEBAR_LABEL_CLASS,
        theme.panelBorder,
        "bg-transparent text-white/80 hover:bg-white/10 hover:text-white"
      );
}

function getBubbleClass(theme: ChatTheme, role: "user" | "assistant"): string {
  if (role === "user") {
    return cx(
      "max-w-full rounded-2xl border border-white/15 px-3 py-2.5 break-words [overflow-wrap:anywhere]",
      theme.userBubble,
      theme.userText
    );
  }

  return cx(
    "min-w-0 max-w-full rounded-xl p-3 break-words [overflow-wrap:anywhere]",
    theme.assistantText
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
        "rounded-xl border p-2",
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

      <div className="grid grid-cols-1 gap-1.5">
        {CHAT_THEMES.map((item) => {
          const active = item.id === selectedThemeId;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-pressed={active}
              className={cx(
                "flex min-h-11 w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition",
                SIDEBAR_LABEL_CLASS,
                "focus:outline-none focus:ring-2 focus:ring-blue-400/60 focus:ring-offset-2 focus:ring-offset-black",
                active ? "border-blue-400/50 bg-white/10" : theme.panelBorder,
                "hover:bg-white/5"
              )}
            >
              <span
                className={cx(
                  "flex h-8 w-10 shrink-0 gap-0.5 overflow-hidden rounded-lg border p-1",
                  item.pageBg,
                  item.panelBorder
                )}
                aria-hidden="true"
              >
                <span className={cx("min-w-0 flex-1 rounded", item.assistantBubble)} />
                <span className={cx("min-w-0 flex-1 rounded", item.userBubble)} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-white">{item.label}</span>
                <span className={cx("mt-0.5 block truncate text-xs font-normal", theme.mutedText)}>
                  {item.id}
                </span>
              </span>

              {active ? (
                <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-medium text-black">
                  Active
                </span>
              ) : null}
            </button>
          );
        })}
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
  const [loading, setLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [useImageGeneration, setUseImageGeneration] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [cameraCaptureSupported, setCameraCaptureSupported] = useState(false);
  const [composerDocuments, setComposerDocuments] = useState<UploadedDocument[]>([]);
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [profileMenuPosition, setProfileMenuPosition] = useState<ProfileMenuPosition>({
    top: 0,
    left: 0,
    width: 0,
  });
  const [downloadingGeneratedImageId, setDownloadingGeneratedImageId] = useState<string | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [deletingGeneratedImageId, setDeletingGeneratedImageId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>("free");
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeModalTitle, setUpgradeModalTitle] = useState("Upgrade to Pro");
  const [upgradeModalMessage, setUpgradeModalMessage] = useState(
    "This feature is available on the Pro plan."
  );
  const [imageEditOperation, setImageEditOperation] =
    useState<ImageEditOperation | null>(null);
  const planRef = useRef<Plan>("free");

  const abortRef = useRef<AbortController | null>(null);
  const messageLoadGenerationRef = useRef(0);
  const imageRequestGenerationRef = useRef(0);
  const generatedImageUrlsRef = useRef<Set<string>>(new Set());
  const regenerationInFlightRef = useRef(false);
  const imageEditOperationRef = useRef<ImageEditOperation | null>(null);
  const imageEditInFlightRef = useRef(false);
  const pastedTextUploadInFlightRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const requestGeneration = ++messageLoadGenerationRef.current;
    const controller = new AbortController();

    async function hydrateInitialMessageImages(): Promise<void> {
      try {
        const response = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(initialConversationId)}`,
          { cache: "no-store", signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("Failed to load messages.");
        }

        const data = await response.json();
        const rawMessages = Array.isArray(data?.messages)
          ? data.messages
          : initialMessages;
        const hydratedMessages = await hydrateMessagesWithImageUrls(rawMessages);

        if (
          !cancelled &&
          shouldApplyMessageLoad(
            requestGeneration,
            messageLoadGenerationRef.current
          )
        ) {
          setMessages(hydratedMessages);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("Failed to load initial message images:", error);

        try {
          const fallbackMessages = await hydrateMessagesWithImageUrls(initialMessages);
          if (
            !cancelled &&
            shouldApplyMessageLoad(
              requestGeneration,
              messageLoadGenerationRef.current
            )
          ) {
            setMessages(fallbackMessages);
          }
        } catch (fallbackError) {
          console.error("Failed to hydrate initial message images:", fallbackError);
        }
      }
    }

    void hydrateInitialMessageImages();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [initialConversationId, initialMessages]);
  
  const endRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeDocumentPollRef = useRef(0);
  const recognitionRef = useRef<AppSpeechRecognition | null>(null);
  const speechSessionBaseRef = useRef<string>("");

  const lastAppliedTranscriptRef = useRef<string>("");
  const nativeSpeechListenerRef = useRef<PluginListenerHandle | null>(null);
  const nativeListeningStateListenerRef =
    useRef<PluginListenerHandle | null>(null);
  const nativeSpeechAvailableRef = useRef(false);
  const desktopProfileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileProfileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const plusMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const isNativeApp = Capacitor.isNativePlatform();
  const activeTheme = useMemo(() => getChatThemeById(selectedThemeId), [selectedThemeId]);
  const composerPlusMenuMode: ComposerPlusMenuMode = useImageGeneration
    ? "create_image"
    : useWebSearch
      ? "web_search"
      : "standard";
  const messageTimestamps = useMemo(
    () =>
      new Map(
        messages.map((message) => [
          message.id,
          formatMessageTime(message.created_at),
        ])
      ),
    [messages]
  );

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    setCameraCaptureSupported(
      isCameraCaptureSupported(
        typeof navigator === "undefined" ? "" : navigator.userAgent,
        isNativeApp
      )
    );
  }, [isNativeApp]);

  useLayoutEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    const nextSize = calculateComposerTextareaSize(input, textarea.scrollHeight);

    textarea.style.height = `${nextSize.height}px`;
    textarea.style.overflowY = nextSize.overflowY;
  }, [input]);

  function registerGeneratedImageUrl(url: string): void {
    generatedImageUrlsRef.current.add(url);
  }

  function revokeGeneratedImageUrl(url: string): void {
    generatedImageUrlsRef.current.delete(url);
    revokeGeneratedImageObjectUrl(url);
  }

  useEffect(() => {
    const displayedUrls = new Set(
      messages
        .map((message) => message.generatedImage?.url)
        .filter((url): url is string => Boolean(url))
    );

    for (const url of generatedImageUrlsRef.current) {
      if (!displayedUrls.has(url)) {
        generatedImageUrlsRef.current.delete(url);
        revokeGeneratedImageObjectUrl(url);
      }
    }
  }, [messages]);

  const closePlusMenu = useCallback((restoreFocus = false) => {
    setPlusMenuOpen(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => plusMenuButtonRef.current?.focus());
    }
  }, []);

  const getProfileTrigger = useCallback(
    () =>
      profileMenuTriggerRef.current ??
      (mobileMenuOpen
        ? mobileProfileTriggerRef.current
        : desktopProfileTriggerRef.current),
    [mobileMenuOpen]
  );

  const closeProfileMenu = useCallback(
    (restoreFocus = true) => {
      setProfileMenuOpen(false);
      setThemePickerOpen(false);

      if (restoreFocus) {
        window.requestAnimationFrame(() => getProfileTrigger()?.focus());
      }
    },
    [getProfileTrigger]
  );

  const toggleProfileMenu = useCallback(
    (trigger: HTMLButtonElement) => {
      profileMenuTriggerRef.current = trigger;

      if (profileMenuOpen) {
        closeProfileMenu();
        return;
      }

      const containerBounds = getProfileMenuContainerBounds(trigger);
      if (containerBounds) {
        setProfileMenuPosition((current) => ({
          ...current,
          ...containerBounds,
        }));
      }

      setThemePickerOpen(false);
      setProfileMenuOpen(true);
    },
    [closeProfileMenu, profileMenuOpen]
  );

  const updateProfileMenuPosition = useCallback(() => {
    const trigger = getProfileTrigger();
    const menu = profileMenuRef.current;

    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const containerBounds = getProfileMenuContainerBounds(trigger);
    if (!containerBounds) return;

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportPadding = 12;
    const menuGap = 8;

    const spaceBelow = viewportTop + viewportHeight - triggerRect.bottom;
    const placeBelow =
      spaceBelow >= menuRect.height + menuGap + viewportPadding ||
      triggerRect.top < menuRect.height + menuGap + viewportPadding;
    const preferredTop = placeBelow
      ? triggerRect.bottom + menuGap
      : triggerRect.top - menuRect.height - menuGap;
    const minTop = viewportTop + viewportPadding;
    const maxTop = viewportTop + viewportHeight - menuRect.height - viewportPadding;
    const top = Math.min(Math.max(preferredTop, minTop), Math.max(minTop, maxTop));

    setProfileMenuPosition({
      top,
      left: containerBounds.left,
      width: containerBounds.width,
    });
  }, [getProfileTrigger]);

  useLayoutEffect(() => {
    if (!profileMenuOpen) return;
    updateProfileMenuPosition();
  }, [profileMenuOpen, themePickerOpen, updateProfileMenuPosition]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const handleViewportResize = () => {
      window.requestAnimationFrame(updateProfileMenuPosition);
    };

    window.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("resize", handleViewportResize);

    return () => {
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [profileMenuOpen, updateProfileMenuPosition]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (
        profileMenuRef.current?.contains(target) ||
        desktopProfileTriggerRef.current?.contains(target) ||
        mobileProfileTriggerRef.current?.contains(target)
      ) {
        return;
      }

      closeProfileMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeProfileMenu();
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [closeProfileMenu, profileMenuOpen]);

  useEffect(() => {
    if (!plusMenuOpen) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && plusMenuRef.current?.contains(target)) return;
      closePlusMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      closePlusMenu(true);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [closePlusMenu, plusMenuOpen]);

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
    if (useImageGeneration) return "Image generation";
    if (useWebSearch) return "Using web search";
    if (isListening) return "Voice input active";
    if (pendingImages.length > 0) {
      return pendingImages.length === 1
        ? "Image attached"
        : `${pendingImages.length} images attached`;
    }
    if (composerDocuments.length > 0) return "Documents attached";
    return "Standard assistant";
  }, [useImageGeneration, useWebSearch, isListening, pendingImages.length, composerDocuments.length]);

  const imageGenerationUsage = usage?.imageGeneration;
  const isImageLimitReached = Boolean(
    useImageGeneration &&
      imageGenerationUsage &&
      (imageGenerationUsage.daily.remaining <= 0 ||
        imageGenerationUsage.monthly.remaining <= 0),
  );
  const isTextLimitReached = Boolean(
    usage && usage.limit > 0 && usage.remaining <= 0,
  );
  const isLimitReached = useImageGeneration
    ? isImageLimitReached
    : isTextLimitReached;
  const imageQuotaLimitMessage =
    imageGenerationUsage && isImageLimitReached
      ? getImageGenerationQuotaMessage(
          plan,
          imageGenerationUsage.daily.remaining <= 0 ? "daily" : "monthly",
        )
      : null;
  const pendingImageLimitExceeded =
    pendingImages.length > getMaxPendingImages(plan);

  useEffect(() => {
    if (pendingImageLimitExceeded) {
      setUiError(getPendingImageLimitMessage(plan));
    }
  }, [pendingImageLimitExceeded, plan]);

  const composerDisabled =
    loading || uploadingImages || isUploadingDocuments || isLimitReached;

  const micDisabled =
    !speechSupported ||
    loading ||
    uploadingImages ||
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
        "This feature is available on the Pro plan. Upgrade to use file uploads."
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

  function setImageEditOperationState(next: ImageEditOperation | null): void {
    imageEditOperationRef.current = next;
    setImageEditOperation(next);
  }

  function handleOpenImageEdit(
    sourceReference: ImageEditSourceReference,
    sourcePreview: string,
    sourceLabel: string,
  ): void {
    if (loading || imageEditInFlightRef.current || !conversationId) return;

    setUiError("");
    setImageEditOperationState({
      conversationId,
      sourceReference,
      sourcePreview,
      sourceLabel,
      instruction: "",
      idempotencyKey: null,
      status: "idle",
      error: null,
      errorCode: null,
      canRetry: false,
    });
  }

  function handleImageEditInstructionChange(value: string): void {
    const current = imageEditOperationRef.current;
    if (!current || current.status !== "idle") return;

    setImageEditOperationState({ ...current, instruction: value, error: null });
  }

  function handleCloseImageEdit(): void {
    if (imageEditInFlightRef.current) return;
    setImageEditOperationState(null);
  }

  async function refreshMessagesForConversation(
    targetConversationId: string,
  ): Promise<boolean> {
    const requestGeneration = ++messageLoadGenerationRef.current;

    try {
      const response = await fetch(
        `/api/messages?conversationId=${encodeURIComponent(targetConversationId)}`,
        { cache: "no-store" },
      );

      if (!response.ok) return false;

      const data = await response.json();
      const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
      const refreshedMessages = await hydrateMessagesWithImageUrls(rawMessages);

      if (
        shouldApplyMessageLoad(
          requestGeneration,
          messageLoadGenerationRef.current,
        ) &&
        targetConversationId === conversationId
      ) {
        setMessages(refreshedMessages);
      }

      return true;
    } catch {
      return false;
    }
  }

  async function handleImageEditSubmit(): Promise<void> {
    if (imageEditInFlightRef.current) return;

    const current = imageEditOperationRef.current;
    if (!current) return;

    const validationError = getImageEditInstructionError(current.instruction);
    if (validationError) {
      setImageEditOperationState({
        ...current,
        status: "idle",
        error: validationError,
        canRetry: false,
      });
      return;
    }

    const canAttempt =
      current.status === "idle" ||
      (current.status === "in_progress" && current.canRetry) ||
      (current.status === "error" && current.canRetry);
    if (!canAttempt) return;

    const idempotencyKey = current.idempotencyKey ?? createId();
    const submittingOperation: ImageEditOperation = {
      ...current,
      idempotencyKey,
      status: "submitting",
      error: null,
      errorCode: null,
      canRetry: false,
    };

    imageEditInFlightRef.current = true;
    setImageEditOperationState(submittingOperation);

    try {
      let response: Response;

      try {
        response = await fetch("/api/image-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildImageEditRequestBody(submittingOperation, idempotencyKey),
          ),
          cache: "no-store",
        });
      } catch {
        setImageEditOperationState({
          ...submittingOperation,
          status: "error",
          error: "Image editing is temporarily unavailable.",
          errorCode: "NETWORK_ERROR",
          canRetry: true,
        });
        return;
      }

      const data = await response.json().catch(() => null);
      const responseStatus = getImageEditResponseField(data, "status");

      if (response.ok && response.status === 200 && responseStatus === "completed") {
        const refreshed = await refreshMessagesForConversation(
          submittingOperation.conversationId,
        );

        if (!refreshed) {
          setImageEditOperationState({
            ...submittingOperation,
            status: "error",
            error: "The edit completed, but the conversation could not be refreshed. Try again.",
            errorCode: "REFRESH_FAILED",
            canRetry: true,
          });
          return;
        }

        await refreshConversations().catch(() => undefined);
        setImageEditOperationState(null);
        return;
      }

      if (response.status === 202 && responseStatus === "in_progress") {
        setImageEditOperationState({
          ...submittingOperation,
          status: "in_progress",
          error: null,
          errorCode: null,
          canRetry: true,
        });
        return;
      }

      const errorCode = getImageEditResponseField(data, "code") ?? undefined;
      const mappedError = getImageEditErrorMessage(
        response.status,
        errorCode,
        planRef.current,
      );
      setImageEditOperationState({
        ...submittingOperation,
        status: "error",
        error: mappedError.message,
        errorCode: errorCode ?? null,
        canRetry: mappedError.canRetry,
      });
    } catch {
      setImageEditOperationState({
        ...submittingOperation,
        status: "error",
        error: "Image editing is temporarily unavailable.",
        errorCode: "INTERNAL_ERROR",
        canRetry: true,
      });
    } finally {
      imageEditInFlightRef.current = false;
    }
  }

  useEffect(() => {
    setSelectedThemeId(getStoredChatThemeId());
  }, []);

  useEffect(() => {
    const generatedImageUrls = generatedImageUrlsRef.current;

    return () => {
      imageRequestGenerationRef.current += 1;
      abortRef.current?.abort();
      recognitionRef.current?.abort();
      recognitionRef.current = null;

      for (const url of generatedImageUrls) {
        revokeGeneratedImageObjectUrl(url);
      }
      generatedImageUrls.clear();
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
  let cancelled = false;

  async function initializeSpeechRecognition(): Promise<void> {
    if (isNativeApp) {
      try {
        const availability = await SpeechRecognition.available();

        if (cancelled) return;

        nativeSpeechAvailableRef.current = availability.available;
        setSpeechSupported(availability.available);

        if (!availability.available) {
          setSpeechError(
            "Voice input is not available on this Android device."
          );
          return;
        }

        nativeSpeechListenerRef.current =
          await SpeechRecognition.addListener(
            "partialResults",
            (event) => {
              const transcript = event.matches?.[0]?.trim() ?? "";

              if (!transcript) return;

              const sessionBase = speechSessionBaseRef.current.trim();
              lastAppliedTranscriptRef.current = transcript;

              setInput(
                sessionBase ? `${sessionBase} ${transcript}` : transcript
              );

              setUiError("");
              setSpeechError(null);
            }
          );

        nativeListeningStateListenerRef.current =
          await SpeechRecognition.addListener(
            "listeningState",
            (event) => {
              const state = event.state ?? event.status;

              if (state === "startingListening" || state === "started") {
                setIsListening(true);
                return;
              }

              if (state === "stoppingListening" || state === "stopped") {
                setIsListening(false);
                lastAppliedTranscriptRef.current = "";

                if (event.reason === "error") {
                  setSpeechError(
                    "Voice input stopped unexpectedly. Please try again."
                  );
                }
              }
            }
          );

        return;
      } catch (error) {
        console.error(
          "Native speech recognition initialization failed:",
          error
        );

        if (!cancelled) {
          setSpeechSupported(false);
          setSpeechError(
            "Voice input could not be initialized on this device."
          );
        }

        return;
      }
    }

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

      const transcriptToApply = (
        finalTranscript || interimTranscript
      ).trim();

      if (!transcriptToApply) return;

      const sessionBase = speechSessionBaseRef.current.trim();
      lastAppliedTranscriptRef.current = transcriptToApply;

      setInput(
        sessionBase
          ? `${sessionBase} ${transcriptToApply}`
          : transcriptToApply
      );

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
  }

  void initializeSpeechRecognition();

  return () => {
    cancelled = true;

    recognitionRef.current?.abort();
    recognitionRef.current = null;

    if (nativeSpeechListenerRef.current) {
      void nativeSpeechListenerRef.current.remove();
      nativeSpeechListenerRef.current = null;
    }
    if (nativeListeningStateListenerRef.current) {
      void nativeListeningStateListenerRef.current.remove();
      nativeListeningStateListenerRef.current = null;
    }
    if (isNativeApp) {
      void SpeechRecognition.forceStop().catch(() => {
        // Native recognition may already be stopped.
      });
    }
  };
}, [isNativeApp]);

  useEffect(() => {
  if (
    !isListening ||
    (!loading && !isUploadingDocuments && !uploadingImages)
  ) {
    return;
  }

  if (isNativeApp) {
    void SpeechRecognition.stop().catch((error) => {
      console.error("Could not stop native voice input:", error);
    });
  } else {
    recognitionRef.current?.stop();
  }

  setIsListening(false);
}, [
  isNativeApp,
  isListening,
  isUploadingDocuments,
  loading,
  uploadingImages,
]);

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

  async function removePendingImageObjects(
    images: PendingImage[],
    reason: PendingImageCleanupReason
  ): Promise<void> {
    const paths = getPendingImageCleanupPaths(images, reason);
    if (paths.length === 0) return;

    const { error } = await supabase.storage.from("chat-images").remove(paths);
    if (error) {
      console.error("Pending image cleanup error:", error);
    }
  }

  function resetImageInput(): void {
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }

    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
  }

  function discardPendingImages(): void {
    const discardedImages = pendingImages;
    setPendingImages([]);
    resetImageInput();

    if (discardedImages.length > 0) {
      void removePendingImageObjects(discardedImages, "discard");
    }
  }

  function clearSubmittedPendingImages(imageIds: string[]): void {
    setPendingImages((current) => removeSubmittedPendingImages(current, imageIds));
    resetImageInput();
  }

  function restorePendingImages(snapshot: PendingImage[]): void {
    setPendingImages((current) => restorePendingImageSnapshot(current, snapshot));
    resetImageInput();
  }

  function removePendingImageById(id: string): void {
    const image = pendingImages.find((pendingImage) => pendingImage.id === id);
    setPendingImages((current) => removePendingImage(current, id));
    resetImageInput();

    if (image) {
      void removePendingImageObjects([image], "discard");
    }
  }

  function clearComposerDocuments(): void {
    setComposerDocuments([]);
    setDocumentError("");
    activeDocumentPollRef.current += 1;
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
    if (
      loading ||
      uploadingImages ||
      isUploadingDocuments ||
      isLimitReached ||
      useWebSearch ||
      useImageGeneration
    ) {
      return;
    }

    if (!canAddPendingImages(pendingImages.length, 1, plan)) {
      setUiError(getPendingImageLimitMessage(plan));
      return;
    }

    imageInputRef.current?.click();
  }

  function handleOpenCameraPicker(): void {
    if (
      !cameraCaptureSupported ||
      loading ||
      uploadingImages ||
      isUploadingDocuments ||
      isLimitReached ||
      useWebSearch ||
      useImageGeneration
    ) {
      return;
    }

    if (!canAddPendingImages(pendingImages.length, 1, plan)) {
      setUiError(getPendingImageLimitMessage(plan));
      return;
    }

    cameraInputRef.current?.click();
  }

  function handleOpenDocumentPicker(): void {
    if (
      loading ||
      uploadingImages ||
      isUploadingDocuments ||
      useWebSearch ||
      useImageGeneration
    ) {
      return;
    }

    if (plan !== "pro") {
      openUpgradeModal(
        "File uploads are a Pro feature",
        "Upgrade to Pro to upload and analyze PDF, DOCX, XLSX, CSV, and text files."
      );
      return;
    }

    documentInputRef.current?.click();
  }

  async function handleStartListening(): Promise<void> {
  if (
    loading ||
    uploadingImages ||
    isUploadingDocuments ||
    isLimitReached ||
    hasPendingDocuments
  ) {
    return;
  }

  clearTransientErrors();
  speechSessionBaseRef.current = input.trim();
  lastAppliedTranscriptRef.current = "";

  try {
    if (isNativeApp) {
      if (!nativeSpeechAvailableRef.current) {
        setSpeechSupported(false);
        setSpeechError(
          "Voice input is not available on this Android device."
        );
        return;
      }

      const permissions = await SpeechRecognition.checkPermissions();

      if (permissions.speechRecognition !== "granted") {
        const requested = await SpeechRecognition.requestPermissions();

        if (requested.speechRecognition !== "granted") {
          setSpeechError("Microphone access was denied.");
          return;
        }
      }

      await SpeechRecognition.start({
        language: "en-US",
        maxResults: 3,
        partialResults: true,
      });

      return;
    }

    if (!recognitionRef.current) {
      setSpeechSupported(false);
      return;
    }

    setIsListening(true);
    recognitionRef.current.start();
  } catch (error) {
    console.error("Could not start voice input:", error);

    setIsListening(false);
    lastAppliedTranscriptRef.current = "";
    setSpeechError("Could not start microphone input.");
  }
}

  async function handleStopListening(): Promise<void> {
    try {
      if (isNativeApp) {
        await SpeechRecognition.stop();
        return;
      }

      recognitionRef.current?.stop();
      setIsListening(false);
      lastAppliedTranscriptRef.current = "";
    } catch (error) {
      console.error("Could not stop voice input:", error);

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

      const imageGeneration =
        data?.imageGeneration &&
        (data.imageGeneration.plan === "free" ||
          data.imageGeneration.plan === "pro") &&
        data.imageGeneration.daily &&
        data.imageGeneration.monthly
          ? {
              plan: data.imageGeneration.plan as Plan,
              daily: {
                used:
                  typeof data.imageGeneration.daily.used === "number"
                    ? data.imageGeneration.daily.used
                    : 0,
                reserved:
                  typeof data.imageGeneration.daily.reserved === "number"
                    ? data.imageGeneration.daily.reserved
                    : 0,
                limit:
                  typeof data.imageGeneration.daily.limit === "number"
                    ? data.imageGeneration.daily.limit
                    : 0,
                remaining:
                  typeof data.imageGeneration.daily.remaining === "number"
                    ? data.imageGeneration.daily.remaining
                    : 0,
              },
              monthly: {
                used:
                  typeof data.imageGeneration.monthly.used === "number"
                    ? data.imageGeneration.monthly.used
                    : 0,
                reserved:
                  typeof data.imageGeneration.monthly.reserved === "number"
                    ? data.imageGeneration.monthly.reserved
                    : 0,
                limit:
                  typeof data.imageGeneration.monthly.limit === "number"
                    ? data.imageGeneration.monthly.limit
                    : 0,
                remaining:
                  typeof data.imageGeneration.monthly.remaining === "number"
                    ? data.imageGeneration.monthly.remaining
                    : 0,
              },
            }
          : undefined;

      setUsage({
        used: typeof data?.used === "number" ? data.used : 0,
        limit: typeof data?.limit === "number" ? data.limit : 0,
        remaining: typeof data?.remaining === "number" ? data.remaining : 0,
        imageGeneration,
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

  async function hydrateMessagesWithImageUrls(
    rawMessages: Message[]
  ): Promise<Message[]> {
    return Promise.all(
      rawMessages.map(async (message) => {
        const sources = Array.isArray(message.sources)
          ? dedupeSources(message.sources)
          : [];
        const images = normalizeMessageImages(message.images);
        const hasChildImages = hasCanonicalChildImages(message);

        const normalizedMessage: Message = {
          ...message,
          sources,
          sourceCount:
            typeof message.sourceCount === "number"
              ? message.sourceCount
              : sources.length,
          widget: normalizeWidget(message.widget),
          documents: Array.isArray(message.documents)
            ? cloneDocuments(message.documents)
            : [],
          image_url:
            typeof message.image_url === "string" && message.image_url.trim()
              ? message.image_url
              : null,
          images,
          has_child_images: hasChildImages,
        };

        if (hasChildImages || !normalizedMessage.image_path) {
          return normalizedMessage;
        }

        const signedImageUrl = await getSignedImageUrl(
          normalizedMessage.image_path
        );

        return {
          ...normalizedMessage,
          image_url: signedImageUrl,
        };
      })
    );
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

  async function handleFilesSelected(files: File[]): Promise<boolean> {
    if (isUploadingDocuments) return false;

    if (useWebSearch || useImageGeneration) {
      setDocumentError("Document upload is only available in Standard mode.");
      return false;
    }

    const validationError = validateFiles(files);
    if (validationError) {
      setDocumentError(validationError);
      return false;
    }

    for (const file of files) {
      const mimeType = inferMimeType(file);
      if (!isAllowedUploadMimeType(mimeType, file.name)) {
        setDocumentError(`Unsupported file type: ${file.name}`);
        return false;
      }
    }

    if (!conversationId) {
      setDocumentError("Missing conversationId.");
      return false;
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

      const responseDocuments =
        data && "documents" in data && Array.isArray(data.documents)
          ? data.documents
          : [];
      const hasFailedDocument = responseDocuments.some(
        (document) => document.extraction_status === "failed"
      );
      if (hasFailedDocument) {
        const failedDocument = responseDocuments.find(
          (document) => document.extraction_status === "failed"
        );
        setDocumentError(
          failedDocument?.extraction_error ||
            "The text attachment could not be processed. Your full paste remains in the composer."
        );
      }

      const refreshedDocs = await fetchDocuments(conversationId, { silent: true });
      if (refreshedDocs) {
        setComposerDocuments((prev) => reconcileComposerDocuments(prev, refreshedDocs));
      }

      return !hasFailedDocument;
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
      return false;
    } finally {
      setIsUploadingDocuments(false);
    }
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const pastedText = event.clipboardData.getData("text/plain");

    if (!shouldConvertLargePasteToAttachment(pastedText)) {
      return;
    }

    event.preventDefault();

    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart ?? input.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const nextInput = insertTextAtSelection(
      input,
      pastedText,
      selectionStart,
      selectionEnd,
    );
    const preservePastedText = () => {
      setInput((current) => {
        if (current.includes(pastedText)) return current;
        return current ? `${current}\n\n${pastedText}` : pastedText;
      });
    };
    const pastedFile = createPastedTextAttachment(pastedText);

    if (
      plan !== "pro" ||
      useWebSearch ||
      useImageGeneration ||
      pastedFile.size > DOCUMENT_LIMITS.maxFileSizeBytes
    ) {
      setInput(nextInput);
      setUiError(
        plan !== "pro"
          ? "Large pasted text attachments require Pro. Your full paste remains in the composer; shorten it to send inline or upgrade to attach it."
          : useWebSearch || useImageGeneration
            ? "Large pasted text cannot be attached in this mode. Your full paste remains in the composer; shorten it before sending."
            : "This pasted text is too large for an attachment. Your full paste remains in the composer."
      );
      return;
    }

    if (pastedTextUploadInFlightRef.current === pastedText) {
      setUiError("This pasted text is already being attached.");
      return;
    }

    pastedTextUploadInFlightRef.current = pastedText;
    void handleFilesSelected([pastedFile])
      .then((accepted) => {
        if (!accepted) preservePastedText();
      })
      .finally(() => {
        if (pastedTextUploadInFlightRef.current === pastedText) {
          pastedTextUploadInFlightRef.current = null;
        }
      });
  }

  function removeComposerDocument(id: string): void {
    setComposerDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }

  async function handleSignOut() {
    try {
      setUiError("");
      discardPendingImages();
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
    if (
      loading ||
      imageEditInFlightRef.current ||
      nextConversationId === conversationId
    ) {
      return;
    }

    if (imageEditOperationRef.current) {
      setImageEditOperationState(null);
    }

    imageRequestGenerationRef.current += 1;
    abortRef.current?.abort();
    const requestGeneration = ++messageLoadGenerationRef.current;
    setSidebarLoading(true);
    clearTransientErrors();
    discardPendingImages();
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

      const nextMessages = await hydrateMessagesWithImageUrls(rawMessages);

      if (
        !shouldApplyMessageLoad(
          requestGeneration,
          messageLoadGenerationRef.current
        )
      ) {
        return;
      }

      setConversationId(nextConversationId);
      setMessages(nextMessages);
      await fetchDocuments(nextConversationId);
    } catch (error) {
      if (
        shouldApplyMessageLoad(
          requestGeneration,
          messageLoadGenerationRef.current
        )
      ) {
        setUiError(error instanceof Error ? error.message : "Failed to load conversation.");
      }
    } finally {
      if (
        shouldApplyMessageLoad(
          requestGeneration,
          messageLoadGenerationRef.current
        )
      ) {
        setSidebarLoading(false);
      }
    }
  }

  async function handleMobileConversationOpen(nextConversationId: string) {
    await loadConversation(nextConversationId);
    setMobileMenuOpen(false);
  }

  async function handleNewChat() {
    if (loading || imageEditInFlightRef.current) return;

    if (imageEditOperationRef.current) {
      setImageEditOperationState(null);
    }

    imageRequestGenerationRef.current += 1;
    abortRef.current?.abort();
    messageLoadGenerationRef.current += 1;
    setSidebarLoading(true);
    clearTransientErrors();
    discardPendingImages();
    clearComposerDocuments();
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
    const files = getSelectedImageFiles(event.target.files);
    event.target.value = "";
    if (files.length === 0) return;

    if (useWebSearch || useImageGeneration) {
      setUiError("Image upload is only available in Standard mode.");
      return;
    }

    const currentPlan = planRef.current;
    if (!canAddPendingImages(pendingImages.length, files.length, currentPlan)) {
      setUiError(getPendingImageLimitMessage(currentPlan));
      return;
    }

    const validationError = validateImageBatch(files);
    if (validationError) {
      setUiError(validationError);
      return;
    }

    setUploadingImages(true);
    setUiError("");
    setSpeechError(null);

    const uploadedBatch: PendingImage[] = [];

    try {
      for (const file of files) {
        const uploaded = await uploadImageToStorage(file);
        uploadedBatch.push({
          id: createId(),
          name: uploaded.name,
          path: uploaded.path,
          previewUrl: uploaded.dataUrl,
        });
      }

      const latestPlan = planRef.current;
      if (!canAddPendingImages(pendingImages.length, uploadedBatch.length, latestPlan)) {
        throw new Error(getPendingImageLimitMessage(latestPlan));
      }

      setPendingImages((current) => [...current, ...uploadedBatch]);
    } catch (error) {
      if (uploadedBatch.length > 0) {
        await removePendingImageObjects(uploadedBatch, "upload-failure");
      }

      const message = error instanceof Error ? error.message : "";
      const limitMessage = getPendingImageLimitMessage(planRef.current);
      setUiError(
        message === limitMessage || message === "Free plans allow one image per message."
          ? message
          : "Could not upload all selected images."
      );
    } finally {
      setUploadingImages(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    const pendingImageSnapshot = pendingImages.map((image) => ({ ...image }));
    const hasImages = pendingImageSnapshot.length > 0;
    const hasReadyDocuments = readyDocumentIds.length > 0;

    if (loading || uploadingImages || isUploadingDocuments) return;

    if (hasImages && !canAddPendingImages(0, pendingImageSnapshot.length, plan)) {
      setUiError(getPendingImageLimitMessage(plan));
      return;
    }

    if (isLimitReached) {
      if (useImageGeneration && imageGenerationUsage) {
        setUiError(imageQuotaLimitMessage ?? getImageGenerationQuotaMessage(
          plan,
          imageGenerationUsage.daily.remaining <= 0 ? "daily" : "monthly",
        ));
        return;
      }

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

    const messageLengthError = getComposerMessageLengthError(trimmed.length);
    if (messageLengthError) {
      setUiError(messageLengthError);
      return;
    }

    if (useWebSearch && (hasImages || composerDocuments.length > 0)) {
      setUiError("Web Search mode does not support file upload.");
      return;
    }

    if (useImageGeneration && (hasImages || composerDocuments.length > 0)) {
      setUiError("Image generation mode does not support file upload.");
      return;
    }

    if (hasPendingDocuments) {
      setUiError("Please wait for attached documents to finish processing before sending.");
      return;
    }

    if (!trimmed && !hasImages) {
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
      hasImages
        ? `[${pendingImageSnapshot.length === 1 ? "Image" : "Images"} attached: ${pendingImageSnapshot
            .map((image) => image.name)
            .join(", ")}]`
        : "",
      hasReadyDocuments
        ? `[Documents attached: ${readyComposerDocuments.map((doc) => doc.file_name).join(", ")}]`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const userVisibleContent = [effectiveMessage, attachmentNotes].filter(Boolean).join("\n\n");
    const sentDocuments = cloneDocuments(readyComposerDocuments);

    const optimisticImages = buildOptimisticImageAttachments(pendingImageSnapshot);
    const optimisticUserId = createId();
    const userMessage = createOptimisticUserMessage(
      optimisticUserId,
      userVisibleContent,
      hasImages ? optimisticImages : [],
      sentDocuments
    );

    const assistantId = createId();
    const assistantPlaceholder = createOptimisticAssistantMessage(assistantId);

    const payloadImages = buildStoredImagePayload(pendingImageSnapshot);
    const payloadDocumentIds = [...readyDocumentIds];

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput("");
    clearComposerDocuments();
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const requestGeneration = ++imageRequestGenerationRef.current;
    let responseAccepted = false;

    try {
      if (useImageGeneration) {
        const generatedImageResult = await fetchGeneratedImage(effectiveMessage, {
          conversationId,
          signal: controller.signal,
          plan,
        });

        if (
          controller.signal.aborted ||
          imageRequestGenerationRef.current !== requestGeneration
        ) {
          revokeGeneratedImageUrl(generatedImageResult.url);
          return;
        }

        responseAccepted = true;
        registerGeneratedImageUrl(generatedImageResult.url);
        setMessages((prev) =>
          reconcileGeneratedImageMessages(
            prev,
            optimisticUserId,
            assistantId,
            generatedImageResult,
          )
        );

        trackGaEvent("chat_message_sent", {
          plan,
          mode: "image",
          has_image: false,
          has_documents: false,
        });
        await fetchUsage();
        return;
      }

      const endpoint = useWebSearch ? "/api/chat-web" : "/api/chat";
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: effectiveMessage,
          documentIds: payloadDocumentIds,
          ...(useWebSearch || !hasImages ? {} : { images: payloadImages }),
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

      responseAccepted = true;
      const persistedUserMessageId = hasImages
        ? getSafeUuidHeader(res, "X-LVTChat-User-Message-Id")
        : undefined;

      if (hasImages && persistedUserMessageId) {
        setMessages((prev) =>
          reconcileSubmittedImageMessage(
            prev,
            optimisticUserId,
            persistedUserMessageId,
            pendingImageSnapshot,
          ),
        );
      }

      if (hasImages) {
        clearSubmittedPendingImages(pendingImageSnapshot.map((image) => image.id));
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

      if (hasImages && !persistedUserMessageId) {
        await refreshMessagesForConversation(conversationId);
      }

      await refreshConversations(conversationId);
      await fetchUsage();

      trackGaEvent("chat_message_sent", {
        plan,
        mode: useWebSearch ? "web_search" : "standard",
        has_image: hasImages,
        has_documents: hasReadyDocuments,
      });
    } catch (error) {
      if (useImageGeneration) {
        if (imageRequestGenerationRef.current !== requestGeneration) {
          return;
        }

        if (error instanceof ImageGenerationClientError && error.status === 429) {
          await fetchUsage();
        }

        restorePendingImages(pendingImageSnapshot);
        setMessages((prev) => rollbackOptimisticMessages(prev, [optimisticUserId, assistantId]));

        if (isAbortError(error)) {
          setUiError("Image generation stopped.");
        } else {
          setUiError(
            error instanceof ImageGenerationClientError
              ? error.message
              : "Image generation failed. Please try again."
          );
        }
        return;
      }

      if (!responseAccepted) {
        restorePendingImages(pendingImageSnapshot);
        setInput(effectiveMessage);
        setComposerDocuments(sentDocuments);
        setMessages((prev) => rollbackOptimisticMessages(prev, [optimisticUserId, assistantId]));
        setUiError(
          error instanceof Error ? error.message : "Something went wrong. Please try again."
        );
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        updateAssistantMessage(assistantId, (msg) => ({
          ...msg,
          content: msg.content.trim() || "Generation stopped.",
        }));
        return;
      }

      updateAssistantMessage(assistantId, (msg) => ({
        ...msg,
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

  async function handleDownloadGeneratedImage(generatedImageId: string): Promise<void> {
    if (loading || downloadingGeneratedImageId || deletingGeneratedImageId) return;

    setDownloadingGeneratedImageId(generatedImageId);

    try {
      await downloadGeneratedImage(generatedImageId, {
        nativeSave:
          Capacitor.getPlatform() === "android"
            ? (options) => NativeGeneratedImageDownload.save(options)
            : undefined,
      });
    } catch (error) {
      setUiError(
        error instanceof ImageGenerationClientError
          ? error.message
          : "Could not download the generated image. Please try again."
      );
    } finally {
      setDownloadingGeneratedImageId(null);
    }
  }

  async function handleDeleteGeneratedImage(generatedImageId: string): Promise<void> {
    if (loading || deletingGeneratedImageId || downloadingGeneratedImageId) return;

    const confirmed = window.confirm("Delete this generated image? This cannot be undone.");
    if (!confirmed) return;

    setDeletingGeneratedImageId(generatedImageId);
    setUiError("");

    try {
      const response = await fetch(
        `/api/generated-images/${encodeURIComponent(generatedImageId)}`,
        { method: "DELETE", cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          getGeneratedImageDeleteErrorMessage(response.status, data?.code, data?.error),
        );
      }

      setMessages((prev) => removeGeneratedImageMessage(prev, generatedImageId));
    } catch (error) {
      setUiError(
        error instanceof Error
          ? error.message
          : "The generated image could not be deleted.",
      );
    } finally {
      setDeletingGeneratedImageId(null);
    }
  }

  async function handleRegenerateImage(messageId: string): Promise<void> {
    if (loading || regenerationInFlightRef.current) return;

    const prompt = resolveGeneratedImagePrompt(messages, messageId);
    if (!prompt) {
      setUiError(
        "This generated image cannot be regenerated because its original prompt is unavailable."
      );
      return;
    }

    regenerationInFlightRef.current = true;
    const requestGeneration = ++imageRequestGenerationRef.current;
    const controller = new AbortController();
    const optimisticUserId = createId();
    const assistantId = createId();

    setUiError("");
    setRegeneratingMessageId(messageId);
    setMessages((prev) => [
      ...prev,
      createOptimisticUserMessage(optimisticUserId, prompt),
      createOptimisticAssistantMessage(assistantId),
    ]);
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);

    try {
      const generatedImageResult = await fetchGeneratedImage(prompt, {
        conversationId,
        signal: controller.signal,
        plan,
      });

      if (
        controller.signal.aborted ||
        imageRequestGenerationRef.current !== requestGeneration
      ) {
        revokeGeneratedImageUrl(generatedImageResult.url);
        setMessages((prev) =>
          rollbackOptimisticMessages(prev, [optimisticUserId, assistantId])
        );
        return;
      }

      registerGeneratedImageUrl(generatedImageResult.url);
      setMessages((prev) =>
        reconcileGeneratedImageMessages(
          prev,
          optimisticUserId,
          assistantId,
          generatedImageResult,
        )
      );

      trackGaEvent("chat_message_sent", {
        plan,
        mode: "image",
        has_image: false,
        has_documents: false,
      });
      await fetchUsage();
    } catch (error) {
      if (imageRequestGenerationRef.current !== requestGeneration) return;

      if (error instanceof ImageGenerationClientError && error.status === 429) {
        await fetchUsage();
      }

      setMessages((prev) =>
        rollbackOptimisticMessages(prev, [optimisticUserId, assistantId])
      );
      setUiError(
        isAbortError(error)
          ? "Image generation stopped."
          : error instanceof ImageGenerationClientError
            ? error.message
            : "Image generation failed. Please try again."
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
        setRegeneratingMessageId(null);
      }
      regenerationInFlightRef.current = false;
    }
  }

  function handleStop(): void {
    abortRef.current?.abort();
  }

  function handleModeChange(nextUseWebSearch: boolean): void {
    if (loading) return;

    closePlusMenu();

    if (nextUseWebSearch) {
      discardPendingImages();
      clearComposerDocuments();
    }

    setUseWebSearch(nextUseWebSearch);
    setUseImageGeneration(false);
    clearTransientErrors();
  }

  function handleImageModeChange(): void {
    if (loading) return;

    closePlusMenu();

    discardPendingImages();
    clearComposerDocuments();
    setUseWebSearch(false);
    setUseImageGeneration(true);
    clearTransientErrors();
  }

  function handleComposerPlusMenuAction(action: ComposerPlusMenuAction): void {
    closePlusMenu();

    if (action === "camera") {
      handleOpenCameraPicker();
      return;
    }

    if (action === "photos") {
      handleOpenImagePicker();
      return;
    }

    if (action === "files") {
      handleOpenDocumentPicker();
      return;
    }

    if (action === "create_image") {
      handleImageModeChange();
      return;
    }

    if (action === "web_search") {
      handleModeChange(true);
      return;
    }

    handleModeChange(false);
  }

  function renderStatusMessages() {
    const shouldRenderUiError =
      uiError && !(isImageLimitReached && uiError === imageQuotaLimitMessage);

    return (
      <>
        {usageError && <div className="mt-2 text-xs text-red-400">{usageError}</div>}
        {shouldRenderUiError && <div className="mt-2 text-xs text-red-400">{uiError}</div>}
        {documentError && <div className="mt-2 text-xs text-red-400">{documentError}</div>}
        {speechError && <div className="mt-2 text-xs text-red-400">{speechError}</div>}
      </>
    );
  }

  function renderSidebarBrand() {
    return (
      <div className="flex min-w-0 items-center gap-2.5" aria-label={BRAND.name}>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-400/10 text-blue-300 ring-1 ring-inset ring-blue-300/20"
          aria-hidden="true"
        >
          <MessageCircle className="h-[18px] w-[18px]" />
        </span>
        <span className={cx("truncate text-2xl font-semibold tracking-tight", activeTheme.titleText)}>
          <span className="text-white">LVT</span>
          <span className="text-blue-300">Chat</span>
        </span>
      </div>
    );
  }

  function renderNewChatAction() {
    return (
      <div className="w-full">
        <Tooltip content={TOOLTIP_TEXT.newChat}>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={loading || sidebarLoading}
            className={cx("min-h-12 w-full rounded-xl px-4 py-2.5", SIDEBAR_LABEL_CLASS, activeTheme.buttonPrimary)}
          >
            <span className="flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Chat
            </span>
          </button>
        </Tooltip>
      </div>
    );
  }

  function renderSidebarUtilityActions(isMobile = false) {
    return (
      <button
        ref={isMobile ? mobileProfileTriggerRef : desktopProfileTriggerRef}
        type="button"
        onClick={(event) => toggleProfileMenu(event.currentTarget)}
        className={cx(
          "flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
          activeTheme.mutedText,
          "hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/20"
        )}
        aria-label="Open profile and settings"
        aria-haspopup="dialog"
        aria-expanded={profileMenuOpen}
        aria-controls="chat-profile-settings"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
          {getUserInitials(userEmail)}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-white">{userEmail}</span>
        <span className="shrink-0 text-[11px] text-white/50">
          {plan === "pro" ? "Pro" : "Free"}
        </span>
        <ChevronDown className={cx("h-4 w-4 shrink-0 transition-transform", profileMenuOpen && "rotate-180")} />
      </button>
    );
  }

  function renderProfileSettingsMenu() {
    if (!profileMenuOpen) return null;

    return (
      <div
        ref={profileMenuRef}
        id="chat-profile-settings"
        role="dialog"
        aria-label="Profile and settings"
        className={cx(
          "fixed z-[60] min-w-0 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl border p-3 shadow-2xl shadow-black/40",
          activeTheme.panelBg,
          activeTheme.panelBorder
        )}
        style={{
          top: profileMenuPosition.top,
          left: profileMenuPosition.left,
          width: profileMenuPosition.width || undefined,
        }}
      >
        <div className="flex min-w-0 items-center gap-2 px-1 pb-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
            {getUserInitials(userEmail)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {getProfileDisplayName(userEmail)}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-white">
              {userEmail}
            </div>
            <div className={cx("mt-0.5 text-xs", activeTheme.mutedText)}>
              {plan === "pro" ? "Pro Plan" : "Free Plan"}
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-2">
          <button
            type="button"
            onClick={() => setThemePickerOpen((prev) => !prev)}
            className={cx(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition",
              SIDEBAR_LABEL_CLASS,
              activeTheme.mutedText,
              "hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/20"
            )}
            aria-expanded={themePickerOpen}
            aria-controls="chat-theme-picker"
          >
            <span className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Theme
            </span>
            {themePickerOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {themePickerOpen && (
            <div id="chat-theme-picker" className="mt-2">
              <ChatThemePicker
                theme={activeTheme}
                selectedThemeId={selectedThemeId}
                onChange={handleThemeChange}
                onClose={() => setThemePickerOpen(false)}
              />
            </div>
          )}

          <Link
            href="/help"
            onClick={() => {
              closeProfileMenu(false);
              if (mobileMenuOpen) setMobileMenuOpen(false);
            }}
            className={cx(
              "mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition",
              SIDEBAR_LABEL_CLASS,
              activeTheme.mutedText,
              "hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/20"
            )}
            aria-label="Help"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
            Help
          </Link>

          <button
            type="button"
            onClick={() => {
              closeProfileMenu(false);
              if (mobileMenuOpen) setMobileMenuOpen(false);
              router.push("/account");
            }}
            className={cx(
              "mt-1 flex w-full items-center rounded-lg px-3 py-2 text-left transition",
              SIDEBAR_LABEL_CLASS,
              activeTheme.mutedText,
              "hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/20"
            )}
          >
            Account
          </button>

          {plan !== "pro" && (
            <button
              type="button"
              onClick={() => {
                closeProfileMenu(false);
                if (mobileMenuOpen) setMobileMenuOpen(false);
                router.push(BRAND.routes.pricing);
              }}
              className={cx(
                "flex w-full items-center rounded-lg px-3 py-2 text-left text-blue-300 transition",
                SIDEBAR_LABEL_CLASS,
                "hover:bg-blue-500/10 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
              )}
            >
              Upgrade to Pro
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              closeProfileMenu(false);
              void handleSignOut();
            }}
            className={cx(
              "flex w-full items-center rounded-lg px-3 py-2 text-left text-red-300/80 transition",
              SIDEBAR_LABEL_CLASS,
              "hover:bg-red-950/30 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400/30"
            )}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  function renderSidebarModeActions() {
    const standardActive = !useWebSearch && !useImageGeneration;

    return (
      <div className="flex flex-col gap-1" aria-label="Chat modes">
        <Tooltip content={TOOLTIP_TEXT.standard}>
          <button
            type="button"
            onClick={() => handleModeChange(false)}
            disabled={loading}
            className={cx(
              "w-full justify-start",
              getModeButtonClass(activeTheme, standardActive)
            )}
            aria-pressed={standardActive}
          >
            Standard
          </button>
        </Tooltip>

        <Tooltip content={TOOLTIP_TEXT.webSearch}>
          <button
            type="button"
            onClick={() => handleModeChange(true)}
            disabled={loading}
            className={cx(
              "w-full justify-start",
              getModeButtonClass(activeTheme, useWebSearch)
            )}
            aria-pressed={useWebSearch}
          >
            <Globe2 className="h-4 w-4" aria-hidden="true" />
            Web Search
          </button>
        </Tooltip>

        <Tooltip content={TOOLTIP_TEXT.imageMode}>
          <button
            type="button"
            onClick={handleImageModeChange}
            disabled={loading}
            className={cx(
              "w-full justify-start",
              getModeButtonClass(activeTheme, useImageGeneration)
            )}
            aria-pressed={useImageGeneration}
          >
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Create image
          </button>
        </Tooltip>

        {modeLabel !== "Standard assistant" && (
          <div className={cx("px-3 pt-1 text-xs", activeTheme.mutedText)} aria-live="polite">
            {modeLabel}
          </div>
        )}

      </div>
    );
  }

  function renderSidebarActions() {
    return (
      <div className="mt-3 flex flex-col gap-2">
        {renderNewChatAction()}
        <div className={cx("border-t pt-3", activeTheme.panelBorder)}>
          {renderSidebarModeActions()}
        </div>
      </div>
    );
  }

  function renderConversationRow(conversation: ConversationItem, isMobile = false) {
    return (
      <ConversationRow
        key={conversation.id}
        conversation={conversation}
        theme={activeTheme}
        isActive={conversation.id === conversationId}
        disabled={loading || sidebarLoading}
        onSelect={() => {
          if (isMobile) {
            void handleMobileConversationOpen(conversation.id);
            return;
          }

          void loadConversation(conversation.id);
        }}
        onRename={() => {
          void handleRenameConversation(conversation);
        }}
        onDelete={() => {
          void handleDeleteConversation(conversation);
        }}
      />
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

      {imageEditOperation ? (
        <ImageEditDialog
          isOpen
          sourcePreview={imageEditOperation.sourcePreview}
          sourceLabel={imageEditOperation.sourceLabel}
          theme={activeTheme}
          instruction={imageEditOperation.instruction}
          status={imageEditOperation.status}
          error={imageEditOperation.error}
          canRetry={imageEditOperation.canRetry}
          onInstructionChange={handleImageEditInstructionChange}
          onSubmit={() => void handleImageEditSubmit()}
          onClose={handleCloseImageEdit}
        />
      ) : null}

      <main className={cx("h-[100dvh] overflow-hidden transition-colors", activeTheme.pageBg, activeTheme.inputText)}>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button
              type="button"
              aria-label="Close menu overlay"
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                closeProfileMenu(false);
                setMobileMenuOpen(false);
              }}
            />

            <div data-profile-sidebar className={cx("relative z-10 flex h-full w-[min(18rem,78vw)] max-w-[calc(100vw-1rem)] min-w-0 flex-col overflow-hidden border-r", activeTheme.sidebarBg, activeTheme.sidebarBorder)}>
              <div className={cx("sticky top-0 border-b p-4 backdrop-blur", activeTheme.panelBg, activeTheme.panelBorder)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {renderSidebarBrand()}

                    {isLimitReached && (
                      <div className="mt-2 rounded-lg border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
                        {imageQuotaLimitMessage ??
                          "Daily limit reached. Come back tomorrow or upgrade your plan."}
                      </div>
                    )}

                    {renderStatusMessages()}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      closeProfileMenu(false);
                      setMobileMenuOpen(false);
                    }}
                    className={getSecondaryButtonClass(activeTheme)}
                  >
                    Close
                  </button>
                </div>

                {renderSidebarActions()}
              </div>

              <div className="flex-1 overflow-y-auto p-3" data-sidebar-history>
                <div
                  className={cx(
                    "mb-2 inline-flex rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide",
                    activeTheme.badge
                  )}
                >
                  Chat History
                </div>

                <div className="space-y-1">{conversations.map((conversation) => renderConversationRow(conversation, true))}</div>
              </div>

              <div className={cx("shrink-0 border-t p-3", activeTheme.panelBorder)}>
                {renderSidebarUtilityActions(true)}
              </div>
            </div>
          </div>
        )}

        {renderProfileSettingsMenu()}

        <div className="flex h-full overflow-hidden">
          <aside data-profile-sidebar className={cx("hidden h-full w-64 shrink-0 border-r md:flex md:flex-col", activeTheme.sidebarBg, activeTheme.sidebarBorder)}>
            <div className={cx("sticky top-0 border-b p-3 backdrop-blur", activeTheme.panelBg, activeTheme.panelBorder)}>
              {renderSidebarBrand()}

              {isLimitReached && (
                <div className="mt-2 rounded-lg border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
                  {imageQuotaLimitMessage ??
                    "Daily limit reached. Come back tomorrow or upgrade your plan."}
                </div>
              )}

              {renderStatusMessages()}
              {renderSidebarActions()}
            </div>

            <div className="flex-1 overflow-y-auto p-3" data-sidebar-history>
              <div
                className={cx(
                  "mb-2 inline-flex rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide",
                  activeTheme.badge
                )}
              >
                Chat History
              </div>
              <div className="space-y-1">{conversations.map((conversation) => renderConversationRow(conversation))}</div>
            </div>

            <div className={cx("shrink-0 border-t p-3", activeTheme.panelBorder)}>
              <div className="flex flex-col gap-1">
                {renderSidebarUtilityActions()}
              </div>
            </div>
          </aside>

          <section className="flex h-full min-w-0 flex-1 flex-col overflow-x-hidden bg-transparent">
            <div className="flex h-12 shrink-0 items-center px-3 md:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className={cx("h-9 w-9 shrink-0 p-0 text-sm", getSecondaryButtonClass(activeTheme))}
                aria-label="Open menu"
              >
                ☰
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <div className={`${CONTENT_RAIL_CLASS} py-6 sm:py-8`}>
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

                {messages.length === 0 && (
                  <div className="mb-4">
                    <div className={cx("mb-1 text-xs", activeTheme.mutedText)}>
                      Try asking
                    </div>

                    <button
                      type="button"
                      onClick={() => handleConversationStarterClick(CONVERSATION_STARTER)}
                      disabled={loading || isLimitReached}
                      className={cx(
                        "inline-flex min-h-10 items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm",
                        getSecondaryButtonClass(activeTheme)
                      )}
                    >
                      {CONVERSATION_STARTER}
                    </button>

                    <div
                      className={cx(
                        "mt-3 rounded-xl border px-3 py-2.5 text-sm",
                        activeTheme.panelBg,
                        activeTheme.panelBorder,
                        activeTheme.mutedText
                      )}
                    >
                      Do not share sensitive information.
                    </div>
                  </div>
                )}

                <div className="space-y-5 sm:space-y-6">
                  {messages.map((message) => {
                    const sources = Array.isArray(message.sources) ? dedupeSources(message.sources) : [];
                    const sourceCount =
                      typeof message.sourceCount === "number" ? message.sourceCount : sources.length;
                    const messageDocuments = Array.isArray(message.documents) ? message.documents : [];
                    const messageImages = normalizeMessageImages(message.images);
                    const messageImageSource = getMessageImageSource(message);
                    const messageTime = messageTimestamps.get(message.id);
                    const isStreamingAssistant =
                      loading && message.role === "assistant" && message.id === messages[messages.length - 1]?.id;
                    const isGeneratingImage =
                      loading &&
                      useImageGeneration &&
                      message.role === "assistant" &&
                      message.id === messages[messages.length - 1]?.id;
                    const isLatestMessage = message.id === messages[messages.length - 1]?.id;
                    const isRegeneratingImage = regeneratingMessageId === message.id;

                    const bubbleWidthClass =
                      message.role === "user"
                        ? USER_BUBBLE_CLASS
                        : cx(ASSISTANT_BUBBLE_CLASS, "mx-auto");

                    return (
                      <div key={message.id} className="space-y-2">
                        <div className={cx(bubbleWidthClass, getBubbleClass(activeTheme, message.role))}>
                          <div className="mb-2 flex items-center gap-2">
                            <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
                              <span className="font-semibold opacity-90">
                                {getMessageDisplayLabel(message.role)}
                              </span>
                              {messageTime ? (
                                <time
                                  dateTime={message.created_at ?? undefined}
                                  className="truncate opacity-60"
                                >
                                  {messageTime}
                                </time>
                              ) : null}
                            </div>

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
                            <ChatMessageContent
                              content={
                                message.content ||
                                (isGeneratingImage
                                  ? "Generating image…"
                                  : isStreamingAssistant
                                    ? "Thinking..."
                                    : "")
                              }
                            />
                          </div>

                          {message.generatedImage ? (
                            <div className="mt-3 flex w-fit min-w-0 max-w-full overflow-hidden rounded-xl">
                              <NextImage
                                src={message.generatedImage.url}
                                alt="Generated image"
                                width={768}
                                height={768}
                                unoptimized
                                priority={isLatestMessage}
                                sizes="(max-width: 768px) calc(100vw - 2rem), 768px"
                                className="block h-auto w-auto max-h-[min(70vh,640px)] max-w-full object-contain"
                              />
                            </div>
                          ) : null}

                          {message.role === "assistant" && message.generatedImage?.id ? (
                            <div
                              className="mt-2 flex flex-wrap items-center gap-1.5"
                              role="group"
                              aria-label="Generated image actions"
                            >
                              <Tooltip content="Edit image" touchSafe>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenImageEdit(
                                      {
                                        kind: "generated_image",
                                        generatedImageId: message.generatedImage!.id!,
                                      },
                                      message.generatedImage!.url,
                                      "Generated image",
                                    )
                                  }
                                  disabled={loading || imageEditOperation?.status === "submitting"}
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/55 transition hover:bg-white/5 hover:text-white/90 focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="Edit image"
                                >
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                  <span className="sr-only">Edit image</span>
                                </button>
                              </Tooltip>

                              <Tooltip content="Download image" touchSafe>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDownloadGeneratedImage(message.generatedImage!.id!)
                                  }
                                  disabled={
                                    loading ||
                                    downloadingGeneratedImageId !== null ||
                                    deletingGeneratedImageId !== null
                                  }
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/55 transition hover:bg-white/5 hover:text-white/90 focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="Download image"
                                >
                                  {downloadingGeneratedImageId === message.generatedImage.id ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Download className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  <span className="sr-only">Download image</span>
                                </button>
                              </Tooltip>

                              <Tooltip
                                content={isRegeneratingImage ? "Regenerating image…" : "Regenerate image"}
                                touchSafe
                              >
                                <button
                                  type="button"
                                  onClick={() => void handleRegenerateImage(message.id)}
                                  disabled={loading || deletingGeneratedImageId !== null}
                                  aria-busy={isRegeneratingImage}
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/55 transition hover:bg-white/5 hover:text-white/90 focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="Regenerate image"
                                >
                                  <RefreshCw
                                    className={cx("h-4 w-4", isRegeneratingImage && "animate-spin")}
                                    aria-hidden="true"
                                  />
                                  <span className="sr-only">
                                    {isRegeneratingImage ? "Regenerating image" : "Regenerate image"}
                                  </span>
                                </button>
                              </Tooltip>

                              <Tooltip
                                content={
                                  deletingGeneratedImageId === message.generatedImage.id
                                    ? "Deleting image…"
                                    : "Delete image"
                                }
                                touchSafe
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDeleteGeneratedImage(message.generatedImage!.id!)
                                  }
                                  disabled={
                                    loading ||
                                    downloadingGeneratedImageId !== null ||
                                    deletingGeneratedImageId !== null
                                  }
                                  aria-busy={
                                    deletingGeneratedImageId === message.generatedImage.id
                                  }
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-300/65 transition hover:bg-red-400/10 hover:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400/50 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="Delete image"
                                >
                                  {deletingGeneratedImageId === message.generatedImage.id ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  <span className="sr-only">
                                    {deletingGeneratedImageId === message.generatedImage.id
                                      ? "Deleting image"
                                      : "Delete image"}
                                  </span>
                                </button>
                              </Tooltip>

                              {isRegeneratingImage ? (
                                <span className="text-xs text-white/50" aria-live="polite">
                                  Regenerating…
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {messageImageSource === "children" && messageImages.length > 0 ? (
                            <div
                              className={cx(
                                "mt-3 grid min-w-0 max-w-full gap-2",
                                getUploadedMessageImageGridClass(messageImages.length)
                              )}
                            >
                              {messageImages.map((image, index) => {
                                const editSource =
                                  getUploadedImageEditSourceReference(message.id, image);

                                return image.image_url ? (
                                  <div
                                    key={`${message.id}-image-${index}`}
                                    className="relative min-w-0"
                                  >
                                    <img
                                      src={image.image_url}
                                      alt={image.image_name || "Uploaded image"}
                                      className="max-h-56 max-w-full rounded-xl border border-white/10 object-contain"
                                    />

                                    {message.role === "user" && editSource ? (
                                      <div className="absolute right-1 top-1">
                                        <Tooltip content="Edit image" touchSafe>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenImageEdit(
                                                editSource,
                                                image.image_url!,
                                                image.image_name || "Uploaded image",
                                              )
                                            }
                                            disabled={loading || imageEditOperation?.status === "submitting"}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-white/85 transition hover:bg-black/80 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                                            aria-label="Edit uploaded image"
                                          >
                                            <Pencil className="h-4 w-4" aria-hidden="true" />
                                            <span className="sr-only">Edit uploaded image</span>
                                          </button>
                                        </Tooltip>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null;
                              })}
                            </div>
                          ) : messageImageSource === "children" ? null : message.image_url ? (
                            <div className="mt-3">
                              <img
                                src={message.image_url}
                                alt={message.image_name || "Uploaded image"}
                                className="max-h-56 max-w-full rounded-xl border border-white/10 object-contain"
                              />
                            </div>
                          ) : null}

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

                          {message.role === "user" && (
                            <div className="mt-3 flex justify-end">
                              <Tooltip content="Copy message" touchSafe>
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(message.id, getMessageCopyValue(message))}
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/55 transition hover:bg-black/10 hover:text-white/90 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                                  aria-label="Copy message"
                                >
                                  {copiedMessageId === message.id ? (
                                    <Check className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <CopyIcon className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  <span className="sr-only">
                                    {copiedMessageId === message.id ? "Copied" : "Copy message"}
                                  </span>
                                </button>
                              </Tooltip>
                            </div>
                          )}

                          {isStreamingAssistant ? <span className="ml-1 inline-block animate-pulse">▍</span> : null}
                          {message.role === "assistant" && (
                            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                              <Tooltip content="Copy response" touchSafe>
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(message.id, getMessageCopyValue(message))}
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/55 transition hover:bg-white/5 hover:text-white/90 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                                  aria-label="Copy response"
                                >
                                  {copiedMessageId === message.id ? (
                                    <Check className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <CopyIcon className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  <span className="sr-only">
                                    {copiedMessageId === message.id ? "Copied" : "Copy response"}
                                  </span>
                                </button>
                              </Tooltip>

                              {message.content.trim() && !isStreamingAssistant ? (
                                <>
                                  <span className="mr-1 text-[11px] opacity-50">Was this helpful?</span>

                                  <button
                                    type="button"
                                    onClick={() => handleMessageFeedback(message.id, "up")}
                                    className={cx(
                                      "h-7 w-7 rounded-full border border-transparent text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-400/50",
                                      message.feedback === "up"
                                        ? "border-green-400/50 bg-green-500/15 text-green-200"
                                        : "text-white/60 hover:bg-white/5 hover:text-white"
                                    )}
                                    aria-label="Mark assistant response as helpful"
                                  >
                                    👍
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleMessageFeedback(message.id, "down")}
                                    className={cx(
                                      "h-7 w-7 rounded-full border border-transparent text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-400/50",
                                      message.feedback === "down"
                                        ? "border-red-400/50 bg-red-500/15 text-red-200"
                                        : "text-white/60 hover:bg-white/5 hover:text-white"
                                    )}
                                    aria-label="Mark assistant response as not helpful"
                                  >
                                    👎
                                  </button>

                                  {message.feedback ? (
                                    <span className="text-xs text-white/50">Thanks for the feedback.</span>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          )}
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
                      {useImageGeneration
                        ? "Generating image…"
                        : useWebSearch
                        ? "Using web search..."
                        : uploadingImages
                          ? "Processing images..."
                          : isUploadingDocuments || hasPendingDocuments
                            ? "Processing documents..."
                            : "Thinking..."}
                    </div>
                  )}

                  <div ref={endRef} />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-20">
              <div className={`${COMPOSER_RAIL_CLASS} space-y-1.5 py-2.5`}>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple={plan === "pro"}
                  onChange={handleImageChange}
                  disabled={composerDisabled || useWebSearch || useImageGeneration}
                  className="hidden"
                />

                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageChange}
                  disabled={
                    composerDisabled ||
                    !cameraCaptureSupported ||
                    useWebSearch ||
                    useImageGeneration
                  }
                  className="hidden"
                />

                {!useWebSearch && !useImageGeneration && composerDocuments.length > 0 && (
                  <div className={cx("rounded-xl border p-1.5", activeTheme.inputBg, activeTheme.inputBorder)}>
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

                {!useWebSearch && !useImageGeneration && pendingImages.length > 0 && (
                  <div className={cx("rounded-xl border p-1.5", activeTheme.inputBg, activeTheme.inputBorder)}>
                    <div className="grid max-w-full grid-cols-1 gap-2 sm:grid-cols-3">
                      {pendingImages.map((image) => (
                        <div
                          key={image.id}
                          className="min-w-0 rounded-xl border border-white/10 p-1.5"
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span
                              className="min-w-0 truncate text-xs text-white/80"
                              title={image.name}
                            >
                              {image.name}
                            </span>

                            {!loading && (
                              <button
                                type="button"
                                onClick={() => removePendingImageById(image.id)}
                                className={cx(
                                  "shrink-0 rounded-md px-1.5 py-1 text-[11px] text-white/60 transition hover:bg-white/10 hover:text-white",
                                  "focus:outline-none focus:ring-2 focus:ring-blue-400/50"
                                )}
                                aria-label={`Remove image ${image.name}`}
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          <NextImage
                            src={image.previewUrl}
                            alt={`Selected upload preview: ${image.name}`}
                            width={256}
                            height={96}
                            unoptimized
                            className={cx(
                              "mt-1 max-w-full rounded-lg border border-white/10",
                              pendingImages.length === 1
                                ? "max-h-24 object-contain"
                                : "h-24 w-full object-cover"
                            )}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

            <div className="sticky bottom-0 z-30 pb-[calc(env(safe-area-inset-bottom)+12px)]">
              <div className={`${COMPOSER_RAIL_CLASS} py-2`}>

                <form
                  onSubmit={handleSubmit}
                  className={cx(
                    "min-w-0 overflow-visible rounded-2xl border transition focus-within:ring-1 focus-within:ring-blue-400/50",
                    activeTheme.inputBg,
                    activeTheme.inputBorder
                  )}
                >
                  <div
                    className="relative w-full"
                  >
                    <textarea
                      ref={composerTextareaRef}
                      value={input}
                      onPaste={handleComposerPaste}
                      onChange={(event) => {
                        setInput(event.target.value);

                        if (uiError) setUiError("");
                        if (documentError) setDocumentError("");
                        if (speechError) setSpeechError(null);
                      }}
                      placeholder={
                        useImageGeneration
                          ? isListening
                            ? "Listening… tap mic to stop."
                            : "Describe the image you want to generate..."
                          : useWebSearch
                          ? isListening
                            ? "Listening… tap mic to stop."
                            : "Ask something with web search..."
                          : pendingImages.length > 0
                            ? pendingImages.length === 1
                              ? "Add context for the image, or send without text..."
                              : "Add context for the images, or send without text..."
                            : composerDocuments.length > 0
                              ? hasPendingDocuments
                                ? "Please wait while documents finish processing..."
                                : "Ask about the attached documents..."
                              : isListening
                                ? "Listening… tap mic to stop."
                                : "Ask something..."
                      }
                      rows={1}
                      disabled={composerDisabled}
                      style={{ height: COMPOSER_TEXTAREA_MIN_HEIGHT }}
                      className={cx(
                        "w-full min-w-0 max-w-full resize-none rounded-2xl border-0 bg-transparent px-4 py-3.5 outline-none transition-all duration-200",
                        "min-h-[52px] max-h-[180px] overflow-y-hidden",
                        "leading-6",
                        activeTheme.inputText,
                        "placeholder:text-white/40"
                      )}
                    />
                  </div>

                  <div className="flex min-w-0 items-center gap-1.5 px-2 pb-2">
                    <ComposerPlusMenu
                      open={plusMenuOpen}
                      mode={composerPlusMenuMode}
                      disabled={composerDisabled}
                      cameraEnabled={cameraCaptureSupported}
                      onToggle={() => setPlusMenuOpen((open) => !open)}
                      onAction={handleComposerPlusMenuAction}
                      buttonRef={plusMenuButtonRef}
                      menuRef={plusMenuRef}
                    />

                    <div className="hidden">
                      <DocumentUploadButton
                        inputRef={documentInputRef}
                        disabled={composerDisabled || plan !== "pro"}
                        hideTrigger
                        onFilesSelected={handleFilesSelected}
                      />
                    </div>

                    <Tooltip content={TOOLTIP_TEXT.mic}>
                      <button
                        type="button"
                        onClick={isListening ? handleStopListening : handleStartListening}
                        disabled={micDisabled}
                        aria-label={isListening ? "Stop voice input" : "Start voice input"}
                        className={cx(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50",
                          isListening
                            ? "border-red-500 bg-red-500/15 text-red-400 shadow-[0_0_0_6px_rgba(239,68,68,0.12)] animate-pulse"
                            : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                        )}
                      >
                        {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                      </button>
                    </Tooltip>

                    {!useImageGeneration &&
                      usage &&
                      usage.remaining > 0 &&
                      usage.remaining <= 5 && (
                        <span className="text-xs text-yellow-400">
                          Only {usage.remaining} messages remaining today
                        </span>
                      )}

                    <div className="ml-auto">
                      {loading ? (
                        <Tooltip content={TOOLTIP_TEXT.stop}>
                          <button
                            type="button"
                            onClick={handleStop}
                            className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-red-700 px-3 text-sm text-white transition hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-400/50"
                          >
                            Stop
                          </button>
                        </Tooltip>
                      ) : (
                        <button
                          type="submit"
                          disabled={
                            composerDisabled ||
                            pendingImageLimitExceeded ||
                            !canSubmitWithPendingImages(
                              input,
                              pendingImages.length,
                              readyDocumentIds.length
                            )
                          }
                          className={cx(
                            "flex h-11 min-w-11 items-center justify-center rounded-xl px-3 text-white transition focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50",
                            activeTheme.buttonPrimary
                          )}
                          aria-label="Send your message"
                        >
                          <Send className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </div>
                {input.length >= MAX_REQUEST_MESSAGE_LENGTH - 200 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                    <div className={cx("text-[11px]", activeTheme.mutedText)}>
                      {getComposerMessageLengthError(input.length)
                        ? `${input.length - MAX_REQUEST_MESSAGE_LENGTH} characters over limit`
                        : `${MAX_REQUEST_MESSAGE_LENGTH - input.length} characters remaining`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export function reconcileSubmittedImageMessage(
  messages: Message[],
  optimisticMessageId: string,
  persistedMessageId: string,
  images: PendingImage[],
): Message[] {
  const persistedImages = images.map((image, index) => ({
    image_path: image.path,
    image_name: image.name,
    image_url: image.previewUrl,
    ordinal: index + 1,
  }));

  return messages
    .filter(
      (message) =>
        message.id === optimisticMessageId || message.id !== persistedMessageId,
    )
    .map((message) =>
      message.id === optimisticMessageId
        ? {
            ...message,
            id: persistedMessageId,
            images: persistedImages,
            has_child_images: true,
          }
        : message,
    );
}
