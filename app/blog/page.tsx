import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

export const metadata: Metadata = {
  title: `Blog | ${BRAND.name}`,
  description:
    "News, product updates, practical AI guidance, demonstrations, and insights from LVTChat.",
};

const posts = [
  {
    title: "Watch the Official LVTChat Demo",
    description:
      "See LVTChat in action and discover practical AI for research, web search, document analysis, business planning, and everyday tasks.",
    date: "July 24, 2026",
    href: "/blog/watch-the-official-lvtchat-demo",
    category: "Product Demo",
  },
  {
    title: "LVTChat Is Now Available on Google Play",
    description:
      "LVTChat has officially launched on Google Play, bringing practical AI support to Android users worldwide.",
    date: "July 13, 2026",
    href: "/blog/lvtchat-now-available-on-google-play",
    category: "Launch",
  },
] as const;

const upcomingTopics = [
  "How to create a business plan with AI",
  "Practical web research with LVTChat",
  "How to analyze documents with AI",
  "Using AI for everyday planning and decisions",
] as const;

export default function BlogPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto max-w-4xl">
        <Link
          href={BRAND.routes.home}
          className="inline-flex rounded-md text-sm text-white/60 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
        >
          ← Back to Home
        </Link>

        <header className="mt-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            Blog
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Insights from {BRAND.name}
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
            Product updates, demonstrations, practical AI guidance, and ideas
            for working smarter with artificial intelligence.
          </p>
        </header>

        <section aria-labelledby="latest-articles-heading" className="mt-12">
          <h2 id="latest-articles-heading" className="sr-only">
            Latest articles
          </h2>

          <div className="grid gap-6">
            {posts.map((post) => (
              <article
                key={post.href}
                className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.95),rgba(5,10,22,0.98))] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
              >
                <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-white/50">
                  <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-blue-200">
                    {post.category}
                  </span>

                  <time>{post.date}</time>
                </div>

                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {post.title}
                </h2>

                <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65 sm:text-base">
                  {post.description}
                </p>

                <Link
                  href={post.href}
                  aria-label={`Read: ${post.title}`}
                  className="mt-6 inline-flex rounded-2xl border border-blue-400/30 bg-blue-500/10 px-5 py-3 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
                >
                  Read article →
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <h2 className="text-2xl font-semibold text-white">Coming next</h2>

          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/65 sm:text-base">
            More practical articles and demonstrations are on the way to help
            you get better results from AI.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {upcomingTopics.map((topic) => (
              <div
                key={topic}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
              >
                <p className="text-sm font-medium text-white">{topic}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}