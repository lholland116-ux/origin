import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.lvtchat.app";

export const metadata: Metadata = {
  title: `LVTChat Is Now Available on Google Play | ${BRAND.name}`,
  description:
    "LVTChat has officially launched on Google Play, bringing practical AI support to Android users worldwide.",
  openGraph: {
    title: "LVTChat Is Now Available on Google Play",
    description:
      "Practical AI for work, research, business, and everyday tasks is now available on Android.",
    type: "article",
    url: "https://lvtchat.com/blog/lvtchat-now-available-on-google-play",
  },
};

export default function LaunchArticlePage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <article className="mx-auto max-w-3xl">
        <div className="flex flex-wrap gap-4">
          <Link
            href={BRAND.routes.blog}
            className="inline-flex rounded-md text-sm text-white/60 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            ← Back to Blog
          </Link>

          <Link
            href={BRAND.routes.home}
            className="inline-flex rounded-md text-sm text-white/60 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            Home
          </Link>
        </div>

        <header className="mt-10 border-b border-white/10 pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            Launch Announcement
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            LVTChat Is Now Available on Google Play
          </h1>

          <p className="mt-5 text-lg leading-8 text-white/70">
            Practical AI you can actually use is now available for Android
            users worldwide.
          </p>

          <p className="mt-4 text-sm text-white/45">July 13, 2026</p>
        </header>

        <div className="mt-10 space-y-10 text-base leading-8 text-white/75">
          <section>
            <p>
              After months of planning, development, testing, and refinement,
              I&apos;m excited to announce that{" "}
              <strong className="text-white">
                LVTChat is now officially available on Google Play.
              </strong>
            </p>

            <p className="mt-5">
              LVTChat was created with one goal: to provide practical AI that
              helps people work smarter, solve problems faster, and make better
              decisions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">
              What You Can Do with LVTChat
            </h2>

            <div className="mt-6 space-y-5">
              <div>
                <h3 className="font-semibold text-white">
                  AI-Powered Conversations
                </h3>
                <p className="mt-2">
                  Ask questions, brainstorm ideas, write content, summarize
                  information, and receive practical guidance across a wide
                  range of topics.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white">Web Search (Pro)</h3>
                <p className="mt-2">
                  Access current information from the web when you need answers
                  that go beyond the AI&apos;s built-in knowledge.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white">
                  Document Upload and Analysis (Pro)
                </h3>
                <p className="mt-2">
                  Upload supported documents and use LVTChat to summarize,
                  explain, and analyze their contents.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white">Secure Sign-In</h3>
                <p className="mt-2">
                  Sign in with Google or email using secure cloud-based
                  authentication.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-white">
                  Conversation History
                </h3>
                <p className="mt-2">
                  Save and revisit your conversations so you can continue where
                  you left off.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">
              Built for Practical Use
            </h2>

            <p className="mt-4">
              LVTChat was built to help with real-world needs, including
              research, writing, business planning, learning, project
              organization, and everyday decision-making.
            </p>

            <p className="mt-5">
              Whether you&apos;re a student, professional, business owner,
              researcher, or simply curious about artificial intelligence,
              LVTChat is designed to help you move forward with confidence.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">Thank You</h2>

            <p className="mt-4">
              This launch would not have been possible without the family,
              friends, and testers who participated in the internal, closed,
              and open testing phases.
            </p>

            <p className="mt-5">
              Your feedback helped improve stability, usability, and the
              overall experience before the public release.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white">
              This Is Only the Beginning
            </h2>

            <p className="mt-4">
              Future updates will continue to improve LVTChat with new
              capabilities, performance enhancements, and features shaped by
              user feedback.
            </p>
          </section>

          <section className="rounded-3xl border border-blue-400/20 bg-blue-500/10 p-7">
            <h2 className="text-2xl font-semibold text-white">
              Download LVTChat Today
            </h2>

            <p className="mt-4">
              LVTChat is available now on Google Play.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-2xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-[#020817]"
              >
                Download on Google Play
              </a>

              <Link
                href={BRAND.routes.home}
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
              >
                Visit LVTChat
              </Link>
            </div>
          </section>

          <footer className="border-t border-white/10 pt-8">
            <p className="font-semibold text-white">Levi Holland</p>
            <p className="mt-1 text-white/60">
              Founder &amp; AI Engineer, LVTChat LLC
            </p>
          </footer>
        </div>
      </article>
    </main>
  );
}
