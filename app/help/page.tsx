import type { Metadata } from "next";
import Link from "next/link";
import FaqAccordion from "@/components/help/FaqAccordion";
import { BRAND } from "@/lib/branding";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: "FAQ and Resources",
  description: "Answers about current LVTChat capabilities, developing workflows, pricing, human oversight, and privacy.",
  alternates: { canonical: "/help" },
};

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-800 transition hover:text-blue-950"
          >
            Try LVTChat Free
          </Link>
        </div>

        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-blue-800">
            {BRAND.name}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
            Learn what LVTChat offers today, what workflow automation is developing, and how human oversight, pricing, and privacy work.
          </p>
        </div>

        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          <Link
            href="/chat"
            className="rounded-xl border border-slate-200 bg-white p-4 text-sm transition hover:bg-slate-50"
          >
            <div className="font-medium">Start a new chat</div>
            <div className="mt-1 text-xs text-slate-500">
              Ask a question or begin a conversation.
            </div>
          </Link>

          <Link
            href="/account"
            className="rounded-xl border border-slate-200 bg-white p-4 text-sm transition hover:bg-slate-50"
          >
            <div className="font-medium">Manage your account</div>
            <div className="mt-1 text-xs text-slate-500">
              Update your settings and preferences.
            </div>
          </Link>
        </div>

        <FaqAccordion />

        <div className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-600">
          <p>
            Need more help? Contact us at{" "}
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="font-semibold text-blue-800 underline underline-offset-4"
            >
              {BRAND.supportEmail}
            </a>
            .
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-[1440px] px-4 pb-5 sm:px-6 lg:px-8"><Footer /></div>
    </main>
  );
}
