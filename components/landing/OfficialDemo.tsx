import Link from "next/link";
import { BRAND } from "@/lib/branding";

const DEMO_FEATURES = [
  "Practical AI conversations",
  "Current information with web search",
  "PDF and document analysis",
  "Business planning and research",
] as const;

const YOUTUBE_VIDEO_ID = "rUX_Vqlw63s";
const YOUTUBE_WATCH_URL = `https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}`;
const YOUTUBE_EMBED_URL = `https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}`;

export default function OfficialDemo() {
  return (
    <section
      id="official-demo"
      aria-labelledby="official-demo-heading"
      className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white px-5 py-14 shadow-sm md:px-8 md:py-20 lg:px-10"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">
            Official product demonstration
          </p>

          <h2
            id="official-demo-heading"
            className="mt-5 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl"
          >
            Watch LVTChat in action
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            See how {BRAND.name} helps with work, research, business planning,
            web search, document analysis, and everyday tasks.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950 p-2 shadow-xl sm:p-3">
          <div className="relative aspect-video overflow-hidden rounded-[20px] bg-black">
            <iframe
              src={YOUTUBE_EMBED_URL}
              title="LVTChat official product demonstration"
              className="absolute inset-0 h-full w-full"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DEMO_FEATURES.map((feature) => (
            <div
              key={feature}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 text-blue-800"
              >
                ✓
              </span>

              <p className="text-sm font-medium leading-6 text-slate-700">
                {feature}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href={BRAND.routes.login}
            className="rounded-xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
          >
            Try LVTChat
          </Link>

          <a
            href={YOUTUBE_WATCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
          >
            Watch on YouTube
            <span className="sr-only"> in a new tab</span>
          </a>
        </div>
      </div>
    </section>
  );
}
