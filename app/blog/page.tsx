import Link from "next/link";
import { BRAND } from "@/lib/branding";

const UPCOMING_TOPICS = [
  "Practical AI for everyday work",
  "How to use AI more effectively",
  "Productivity, planning, and decision support",
  "Building useful AI tools for real-world needs",
] as const;

export default function BlogPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto max-w-4xl">
        <section className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            Blog
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Insights from {BRAND.name}
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
            Thoughts on AI, productivity, practical problem-solving, and
            building tools people can actually use.
          </p>
        </section>

        <section className="mt-12 rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.95),rgba(5,10,22,0.98))] p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <h2 className="text-2xl font-semibold text-white">
            First articles coming soon
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/65 sm:text-base">
            The {BRAND.name} blog is being prepared with practical content that
            helps users work smarter, think more clearly, and get better results
            from AI.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {UPCOMING_TOPICS.map((topic) => (
              <div
                key={topic}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left"
              >
                <p className="text-sm font-medium text-white">{topic}</p>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <Link
              href={BRAND.routes.home}
              className="inline-flex rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
            >
              Back to Home
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}