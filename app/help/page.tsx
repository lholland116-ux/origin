import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import FaqAccordion from "@/components/help/FaqAccordion";
import { BRAND } from "@/lib/branding";

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Chat
          </Link>
        </div>

        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            {BRAND.name}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Welcome to {BRAND.name}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {BRAND.tagline}
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Learn how to use {BRAND.name}, explore features, and get better
            results from every conversation.
          </p>
        </div>

        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          <Link
            href="/chat"
            className="rounded-xl border border-zinc-200 p-4 text-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <div className="font-medium">Start a new chat</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Ask a question or begin a conversation.
            </div>
          </Link>

          <Link
            href="/account"
            className="rounded-xl border border-zinc-200 p-4 text-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <div className="font-medium">Manage your account</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Update your settings and preferences.
            </div>
          </Link>
        </div>

        <FaqAccordion />

        <div className="mt-10 border-t border-zinc-200 pt-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <p>
            Need more help? Contact us at{" "}
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="underline transition hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {BRAND.supportEmail}
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}