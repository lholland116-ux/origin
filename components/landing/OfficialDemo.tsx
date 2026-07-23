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
      className="scroll-mt-24 px-5 py-14 md:px-8 md:py-20 lg:px-10"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
            Official product demonstration
          </p>

          <h2
            id="official-demo-heading"
            className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl"
          >
            Watch LVTChat in action
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/65 sm:text-lg">
            See how {BRAND.name} helps with work, research, business planning,
            web search, document analysis, and everyday tasks.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-[28px] border border-white/10 bg-[#050B17] p-2 shadow-[0_25px_90px_rgba(0,0,0,0.5)] sm:p-3">
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
              className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 text-blue-300"
              >
                ✓
              </span>

              <p className="text-sm font-medium leading-6 text-white/75">
                {feature}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href={BRAND.routes.login}
            className="rounded-2xl bg-[linear-gradient(90deg,#2563EB,#4F8CFF)] px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_35px_rgba(37,99,235,0.3)] transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            Try LVTChat
          </Link>

          <a
            href={YOUTUBE_WATCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-white/15 bg-white/[0.05] px-6 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            Watch on YouTube
            <span className="sr-only"> in a new tab</span>
          </a>
        </div>
      </div>
    </section>
  );
}