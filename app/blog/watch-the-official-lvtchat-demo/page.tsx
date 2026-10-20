import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/branding";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

const YOUTUBE_VIDEO_ID = "rUX_Vqlw63s";

const YOUTUBE_WATCH_URL =
  `https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}`;

const YOUTUBE_EMBED_URL =
  `https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}`;

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.lvtchat.app";

const ARTICLE_URL =
  "https://lvtchat.com/blog/watch-the-official-lvtchat-demo";

const DEMO_FEATURES = [
  {
    title: "AI-Powered Conversations",
    description:
      "Ask questions, develop ideas, create content, summarize information, and receive practical guidance.",
  },
  {
    title: "Web Search",
    description:
      "Use current web information for research and questions that require up-to-date answers.",
  },
  {
    title: "Document Analysis",
    description:
      "Upload supported documents and ask LVTChat to summarize, explain, organize, or analyze their contents.",
  },
  {
    title: "Business Planning",
    description:
      "Develop practical plans, clarify goals, evaluate ideas, and organize the next steps for a business or project.",
  },
] as const;

export const metadata: Metadata = {
  title: `Watch the Official LVTChat Demo | ${BRAND.name}`,
  description:
    "Watch the official LVTChat demonstration and see how practical AI can help with work, research, web search, document analysis, and business planning.",
  alternates: {
    canonical: ARTICLE_URL,
  },
  openGraph: {
    title: "Watch the Official LVTChat Demo",
    description:
      "See LVTChat in action and discover practical AI for work, research, document analysis, web search, and business planning.",
    type: "article",
    url: ARTICLE_URL,
    siteName: BRAND.name,
  },
  twitter: {
    card: "summary_large_image",
    title: "Watch the Official LVTChat Demo",
    description:
      "See practical AI in action with the official LVTChat product demonstration.",
  },
};

export default function OfficialDemoArticlePage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <nav
          aria-label="Article navigation"
          className="flex flex-wrap gap-4"
        >
          <Link
            href={BRAND.routes.blog}
            className="inline-flex rounded-md text-sm text-slate-600 transition hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 focus:ring-offset-slate-50"
          >
            ← Back to Blog
          </Link>

          <Link
            href={BRAND.routes.home}
            className="inline-flex rounded-md text-sm text-slate-600 transition hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 focus:ring-offset-slate-50"
          >
            Home
          </Link>
        </nav>

        <header className="mt-10 border-b border-slate-200 pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-800">
            Product Demo
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Watch the Official LVTChat Demo
          </h1>

          <p className="mt-5 text-lg leading-8 text-slate-700">
            See how practical AI can help with research, web search, document
            analysis, business planning, and everyday tasks.
          </p>

          <p className="mt-4 text-sm text-slate-600">July 24, 2026</p>
        </header>

        <div className="mt-10 space-y-10 text-base leading-8 text-slate-700">
          <section>
            <p>
              The first official LVTChat demonstration video is now available.
            </p>

            <p className="mt-5">
              This demonstration provides a guided look at how LVTChat can help
              people work more efficiently, organize information, solve
              problems, and make better-informed decisions.
            </p>

            <p className="mt-5">
              LVTChat was built around a straightforward goal: make artificial
              intelligence practical, approachable, and useful for real-world
              needs.
            </p>
          </section>

          <section aria-labelledby="watch-demo-heading">
            <h2
              id="watch-demo-heading"
              className="text-2xl font-semibold text-slate-950"
            >
              Watch the Demonstration
            </h2>

            <p className="mt-4">
              The video walks through several of LVTChat&apos;s core
              capabilities and shows how they can be used in a practical
              workflow.
            </p>

            <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-slate-900 p-2 shadow-sm sm:p-3">
              <div className="relative aspect-video overflow-hidden rounded-[20px] bg-black">
                <iframe
                  src={YOUTUBE_EMBED_URL}
                  title="Official LVTChat product demonstration"
                  className="absolute inset-0 h-full w-full"
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>

            <p className="mt-5 text-sm text-slate-600">
              Prefer to watch directly on YouTube?{" "}
              <a
                href={YOUTUBE_WATCH_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm font-semibold text-blue-800 underline decoration-blue-700/40 underline-offset-4 transition hover:text-blue-950 focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <span className="text-blue-800">Open the official demonstration</span>
                <span className="sr-only"> in a new tab</span>
              </a>
              .
            </p>
          </section>

          <section aria-labelledby="demo-features-heading">
            <h2
              id="demo-features-heading"
              className="text-2xl font-semibold text-slate-950"
            >
              What You&apos;ll See
            </h2>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {DEMO_FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                >
                  <h3 className="font-semibold text-slate-950">
                    {feature.title}
                  </h3>

                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-slate-950">
              Built for Real-World Tasks
            </h2>

            <p className="mt-4">
              LVTChat can support professionals, business owners, students,
              researchers, and anyone who wants practical help thinking through
              a task or finding a clearer path forward.
            </p>

            <p className="mt-5">
              Use it for writing, research, planning, document review, idea
              development, project organization, and everyday
              decision-making.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-slate-950">
              Available on the Web and Android
            </h2>

            <p className="mt-4">
              You can use LVTChat from a modern web browser or install the
              Android app from Google Play.
            </p>

            <p className="mt-5">
              Your account and conversation history remain available when you
              sign in, making it easy to continue working across supported
              devices.
            </p>
          </section>

          <section className="rounded-3xl border border-blue-200 bg-blue-50 p-7">
            <h2 className="text-2xl font-semibold text-slate-950">
              Experience LVTChat
            </h2>

            <p className="mt-4">
              Create a free account and discover how practical AI can help with
              your next task, question, project, or decision.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href={BRAND.routes.login}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
              >
                <span className="text-white">Try LVTChat Free</span>
              </Link>

              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 focus:ring-offset-slate-50"
              >
                <span className="text-slate-800">Get the Android App</span>
                <span className="sr-only"> in a new tab</span>
              </a>

              <a
                href={YOUTUBE_WATCH_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 focus:ring-offset-slate-50"
              >
                <span className="text-slate-800">Watch on YouTube</span>
                <span className="sr-only"> in a new tab</span>
              </a>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-slate-950">
              More Demonstrations Are Coming
            </h2>

            <p className="mt-4">
              This is the first in a planned series of tutorials and
              demonstrations showing practical ways to use LVTChat.
            </p>

            <p className="mt-5">
              Future videos will explore focused use cases such as business
              planning, web research, document analysis, and other everyday
              workflows.
            </p>
          </section>

          <footer className="border-t border-slate-200 pt-8">
            <p className="font-semibold text-slate-950">Levi Holland</p>

            <p className="mt-1 text-slate-600">
              Founder &amp; AI Engineer, LVTChat LLC
            </p>
          </footer>
        </div>
      </article>
      <div className="bg-slate-950 px-4 py-6 sm:px-8"><Footer variant="dark" /></div>
    </main>
  );
}
