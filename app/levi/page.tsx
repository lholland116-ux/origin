import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

const pageUrl = "https://lvtchat.com/levi";

export const metadata: Metadata = {
  title: "Levi Holland | LVTChat",
  description:
    "Clear answers. Better decisions. Try LVTChat — practical AI for work, research, and real-life questions.",
  alternates: {
    canonical: pageUrl,
  },
  openGraph: {
    title: "Levi Holland | LVTChat",
    description:
      "Clear answers. Better decisions. Practical AI for work, research, and real-life questions.",
    url: pageUrl,
    siteName: "LVTChat",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Levi Holland | LVTChat",
    description:
      "Clear answers. Better decisions. Practical AI for work, research, and real-life questions.",
  },
};

export default function LeviPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-10 text-white">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md flex-col items-center justify-center text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
          LVTChat
        </p>

        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
          Clear answers. Better decisions.
        </h1>

        <p className="mt-2 text-xs font-medium text-blue-300">
          Built by an AI Engineer
        </p>

        <p className="mt-4 text-base leading-7 text-white/70">
          Practical AI for work, research, and real-life questions.
        </p>

        <div className="mt-8 w-full space-y-3">
          <Link
            href="/chat?src=qr&entry=levi"
            className="inline-flex w-full items-center justify-center rounded-2xl bg-blue-500 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            Try LVTChat Free →
          </Link>

          <Link
            href="/pricing?src=qr&entry=levi"
            className="inline-flex w-full items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3.5 text-base font-medium text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            View Pricing
          </Link>
        </div>

        <p className="mt-3 text-xs text-white/50">
          Free to try. No setup needed.
        </p>

        <div className="mt-8 grid w-full gap-3 text-left text-sm text-white/70">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            Ask questions and get straightforward answers.
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            Upload documents and get help understanding them.
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            Use web search mode for current information.
          </div>
        </div>

        <div className="my-9 h-px w-full bg-white/10" />

        <div className="text-sm text-white/70">
          <p className="font-semibold text-white">Levi Holland</p>
          <p>Founder | AI Engineer</p>
          <p className="mt-2">lvtchat.com</p>
        </div>

        <p className="mt-6 text-xs text-white/60">
          Scan to open on your phone
        </p>

        <div className="mt-3 rounded-2xl border border-white/10 bg-white p-3 shadow-2xl">
          <Image
            src="/qr-lvtchat.png"
            alt="QR code to open LVTChat"
            width={160}
            height={160}
            priority
          />
        </div>

        <p className="mt-3 text-xs text-white/50">Scan to try LVTChat</p>
      </section>
    </main>
  );
}