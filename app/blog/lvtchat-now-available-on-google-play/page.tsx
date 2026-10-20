import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/branding";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.lvtchat.app";

export const metadata: Metadata = {
  title: "LVTChat Is Now Available on Google Play",
  description:
    "LVTChat has officially launched on Google Play, bringing practical AI support to Android users worldwide.",
  alternates: {
    canonical: `${BRAND.url}/blog/lvtchat-now-available-on-google-play`,
  },
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
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap gap-4">
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
        </div>

        <header className="mt-10 border-b border-slate-200 pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-800">
            Launch Announcement
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            LVTChat Is Now Available on Google Play
          </h1>

          <p className="mt-5 text-lg leading-8 text-slate-700">
            Practical AI you can actually use is now available for Android
            users worldwide.
          </p>

          <p className="mt-4 text-sm text-slate-600">July 13, 2026</p>
        </header>

        <div className="mt-10 space-y-10 text-base leading-8 text-slate-700">
          <section>
            <p>
              After months of planning, development, testing, and refinement,
              I&apos;m excited to announce that{" "}
              <strong className="text-slate-950">
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
            <h2 className="text-2xl font-semibold text-slate-950">
              What You Can Do with LVTChat
            </h2>

            <div className="mt-6 space-y-5">
              <div>
                <h3 className="font-semibold text-slate-950">
                  AI-Powered Conversations
                </h3>
                <p className="mt-2">
                  Ask questions, brainstorm ideas, write content, summarize
                  information, and receive practical guidance across a wide
                  range of topics.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-slate-950">Web Search</h3>
                <p className="mt-2">
                  Access current information from the web when you need answers
                  that go beyond the AI&apos;s built-in knowledge.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-slate-950">
                  Document Upload and Analysis
                </h3>
                <p className="mt-2">
                  Upload supported documents and use LVTChat to summarize,
                  explain, and analyze their contents. Free supports one
                  document up to 5 MB per Standard message; Pro supports up to
                  three documents up to 10 MB each.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-slate-950">Secure Sign-In</h3>
                <p className="mt-2">
                  Sign in with Google or email using secure cloud-based
                  authentication.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-slate-950">
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
            <h2 className="text-2xl font-semibold text-slate-950">
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
            <h2 className="text-2xl font-semibold text-slate-950">Thank You</h2>

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
            <h2 className="text-2xl font-semibold text-slate-950">
              This Is Only the Beginning
            </h2>

            <p className="mt-4">
              Future updates will continue to improve LVTChat with new
              capabilities, performance enhancements, and features shaped by
              user feedback.
            </p>
          </section>

          <section className="rounded-3xl border border-blue-200 bg-blue-50 p-7">
            <h2 className="text-2xl font-semibold text-slate-950">
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
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
              >
                <span className="text-white">Download on Google Play</span>
              </a>

              <Link
                href={BRAND.routes.home}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 focus:ring-offset-slate-50"
              >
                <span className="text-slate-800">Visit LVTChat</span>
              </Link>
            </div>
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
