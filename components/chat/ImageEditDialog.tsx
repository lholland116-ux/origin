"use client";

import NextImage from "next/image";
import { useEffect, useId, useRef } from "react";
import { RefreshCw, X } from "lucide-react";
import { getChatThemeHoverClass, type ChatTheme } from "@/lib/chat-themes";

export type ImageEditDialogStatus =
  | "idle"
  | "submitting"
  | "in_progress"
  | "error"
  | "completed";

type ImageEditDialogProps = {
  isOpen: boolean;
  sourcePreview: string;
  sourceLabel: string;
  theme: ChatTheme;
  instruction: string;
  status: ImageEditDialogStatus;
  error: string | null;
  canRetry: boolean;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

const MAX_INSTRUCTION_LENGTH = 4000;

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function getImageEditInstructionError(value: string): string | null {
  if (!value.trim()) return "Enter an instruction for this image.";
  if (value.length > MAX_INSTRUCTION_LENGTH) {
    return `Instruction too long. Maximum ${MAX_INSTRUCTION_LENGTH} characters.`;
  }
  return null;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export default function ImageEditDialog({
  isOpen,
  sourcePreview,
  sourceLabel,
  theme,
  instruction,
  status,
  error,
  canRetry,
  onInstructionChange,
  onSubmit,
  onClose,
}: ImageEditDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const isSubmitting = status === "submitting";
  const canDismiss = !isSubmitting;
  const validationError = getImageEditInstructionError(instruction);
  const isRetry = status === "in_progress" || (status === "error" && canRetry);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFrame = window.requestAnimationFrame(() => {
      instructionRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousActiveElementRef.current?.focus();
      previousActiveElementRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!canDismiss) return;
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [canDismiss, isOpen, onClose]);

  if (!isOpen) return null;

  const statusMessage =
    status === "submitting"
      ? "Editing image…"
      : status === "in_progress"
        ? "Image edit is still processing."
        : status === "completed"
          ? "Image edit completed."
          : null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <button
        type="button"
        aria-label="Close image edit dialog"
        disabled={!canDismiss}
        className="absolute inset-0 disabled:cursor-not-allowed"
        onClick={onClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isSubmitting}
        className={cx(
          "relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/40",
          theme.panelBg,
          theme.panelBorder,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={cx("flex items-start justify-between gap-4 border-b px-4 py-3", theme.panelBorder)}>
          <div className="min-w-0">
            <h2 id={titleId} className={cx("text-base font-semibold", theme.titleText)}>
              Edit image
            </h2>
            <p id={descriptionId} className={cx("mt-1 text-xs", theme.mutedText)}>
              Create a new edited image while keeping the original unchanged.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!canDismiss}
            aria-label="Close image edit dialog"
            className={cx("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition focus:outline-none focus:ring-2 focus:ring-blue-400/60 disabled:cursor-not-allowed disabled:opacity-50", theme.mutedText, getChatThemeHoverClass(theme), theme.titleText)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          className="min-h-0 overflow-y-auto"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isSubmitting && (status === "idle" || isRetry) && !validationError) {
              onSubmit();
            }
          }}
        >
          <div className="space-y-4 px-4 py-4">
            <figure className={cx("overflow-hidden rounded-xl border p-2", theme.inputBg, theme.inputBorder)}>
              <NextImage
                src={sourcePreview}
                alt={sourceLabel}
                width={768}
                height={768}
                unoptimized
                className="mx-auto block h-auto max-h-[45vh] w-auto max-w-full object-contain"
              />
              <figcaption className={cx("mt-2 truncate text-center text-xs", theme.mutedText)}>
                {sourceLabel}
              </figcaption>
            </figure>

            <div>
              <label
                htmlFor={`${titleId}-instruction`}
                className={cx("text-sm font-medium", theme.titleText)}
              >
                Editing instruction
              </label>
              <textarea
                ref={instructionRef}
                id={`${titleId}-instruction`}
                value={instruction}
                onChange={(event) => onInstructionChange(event.target.value)}
                disabled={status !== "idle"}
                aria-invalid={Boolean(validationError)}
                aria-describedby={validationError ? errorId : undefined}
                placeholder="Describe the change you want..."
                className={cx(
                  "mt-2 min-h-28 w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-70",
                  theme.inputBg,
                  theme.inputBorder,
                  theme.inputText,
                )}
              />
              <div className={cx("mt-1 text-right text-[11px]", theme.mutedText)}>
                {instruction.length} / {MAX_INSTRUCTION_LENGTH}
              </div>
            </div>

            {validationError ? (
              <p id={errorId} role="alert" className="text-sm text-red-300">
                {validationError}
              </p>
            ) : null}

            {statusMessage ? (
              <p aria-live="polite" className={cx("flex items-center gap-2 text-sm", theme.mutedText)}>
                {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {statusMessage}
              </p>
            ) : null}

            {error ? (
              <p role="alert" aria-live="polite" className="text-sm text-red-300">
                {error}
              </p>
            ) : null}
          </div>

          <div className={cx("flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end", theme.panelBorder)}>
            <button
              type="button"
              onClick={onClose}
              disabled={!canDismiss}
              className={cx(
                "inline-flex min-h-10 items-center justify-center rounded-xl border px-4 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-400/60 disabled:cursor-not-allowed disabled:opacity-50",
                theme.buttonSecondary,
              )}
            >
              {isSubmitting ? "Editing…" : "Close"}
            </button>

            {(status === "idle" || isRetry) ? (
              <button
                type="submit"
                disabled={isSubmitting || Boolean(validationError)}
                className={cx(
                  "inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-400/60 disabled:cursor-not-allowed disabled:opacity-50",
                  theme.buttonPrimary,
                )}
              >
                {isRetry ? "Check again" : "Edit image"}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
