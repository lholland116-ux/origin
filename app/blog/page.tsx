import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/branding";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "News, product updates, practical AI guidance, demonstrations, and insights from LVTChat.",
  alternates: { canonical: "/blog" },
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
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-800">
            Blog
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Insights from {BRAND.name}
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
            Product updates, demonstrations, practical AI guidance, and ideas
            for working smarter with artificial intelligence.
          </p>
        </header>

        <section aria-labelledby="latest-articles-heading" className="mt-12">
          <h2 id="latest-articles-heading" className="sr-only">
            Latest articles
          </h2>

          <div className="grid gap-5 md:grid-cols-2">
            {posts.map((post) => (
              <article
                key={post.href}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md sm:p-7"
              >
                <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600">
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-900">
                    {post.category}
                  </span>

                  <time>{post.date}</time>
                </div>

                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                  {post.title}
                </h2>

                <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-700 sm:text-base">
                  {post.description}
                </p>

                <Link
                  href={post.href}
                  aria-label={`Read: ${post.title}`}
                  className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-blue-700 bg-white px-5 py-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
                >
                  <span className="text-blue-800">Read article →</span>
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-semibold text-slate-950">Coming next</h2>

          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-700 sm:text-base">
            More practical articles and demonstrations are on the way to help
            you get better results from AI.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {upcomingTopics.map((topic) => (
              <div
                key={topic}
                className="rounded-xl border border-slate-200 bg-slate-50 p-5"
              >
                <p className="text-sm font-medium text-slate-800">{topic}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="bg-slate-950 px-4 py-6 sm:px-8"><Footer variant="dark" /></div>
    </main>
  );
}
