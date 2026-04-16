"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import FaqAccordion from "@/components/help/FaqAccordion";
import { BRAND } from "@/lib/branding";

type OnboardingModalProps = {
  storageKey?: string;
};

function getDefaultStorageKey(): string {
  return `${BRAND.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-onboarding-dismissed`;
}

export default function OnboardingModal({
  storageKey,
}: OnboardingModalProps) {
  const resolvedStorageKey = useMemo(
    () => storageKey || getDefaultStorageKey(),
    [storageKey]
  );

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    try {
      const dismissed = window.localStorage.getItem(resolvedStorageKey);
      if (dismissed !== "true") {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, [resolvedStorageKey]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, resolvedStorageKey]);

  function handleClose() {
    try {
      window.localStorage.setItem(resolvedStorageKey, "true");
    } catch {
      // Ignore storage errors and still close the modal.
    }

    setOpen(false);
  }

  function handleBackdropClick() {
    handleClose();
  }

  if (!mounted || !open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-modal-title"
      aria-describedby="onboarding-modal-description"
    >
      <button
        type="button"
        aria-label="Close onboarding backdrop"
        className="absolute inset-0 cursor-default"
        onClick={handleBackdropClick}
      />

      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-white shadow-2xl dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="min-w-0">
            <h2
              id="onboarding-modal-title"
              className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
            >
              Welcome to {BRAND.name}
            </h2>

            <p
              id="onboarding-modal-description"
              className="mt-1 text-sm text-zinc-600 dark:text-zinc-400"
            >
              {BRAND.tagline}
            </p>

            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Here’s a quick guide to help you get better results right away.
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            aria-label="Close onboarding"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                1. Start simple
              </div>
              <div className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                Ask a clear question or describe your goal in one sentence.
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                2. Pick the right mode
              </div>
              <div className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                Use Standard for writing, brainstorming, and general help. Use
                Web Search when you need current or time-sensitive information.
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                3. Ask follow-ups
              </div>
              <div className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                Refine the answer by asking for a simpler, deeper, shorter, or
                more structured version.
              </div>
            </div>
          </div>

          <FaqAccordion
            title={`Getting Started with ${BRAND.name}`}
            subtitle="Browse the most helpful questions for new users."
          />
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Maybe later
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Start using {BRAND.name}
          </button>
        </div>
      </div>
    </div>
  );
}