import Link from "next/link";
import { BRAND } from "@/lib/branding";

const PREVIEW_STEPS = [
  {
    title: "1. Define Your Audience",
    subtitle: "Who are you trying to reach?",
  },
  {
    title: "2. Craft Your Message",
    subtitle: "What makes you different?",
  },
  {
    title: "3. Choose Your Channels",
    subtitle: "Where is your audience active?",
  },
  {
    title: "4. Track & Improve",
    subtitle: "Measure results and iterate.",
  },
] as const;

const CREDIBILITY_LINE =
  "Built to make practical AI simple, useful, and accessible.";

function formatPrice(price: number): string {
  return Number.isInteger(price) ? price.toString() : price.toFixed(2);
}

export default function Hero() {
  const earlyAdopter = BRAND.promotions.earlyAdopter;
  const proMonthlyPrice = formatPrice(BRAND.pricing.proMonthlyPrice);

  return (
    <section
      aria-labelledby="hero-heading"
      className="grid gap-10 px-5 pb-8 pt-6 md:px-8 md:pb-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:pb-12 lg:pt-10"
    >
      <div className="max-w-2xl">
        <p className="inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
          AI assistant, built for real life
        </p>

        <h1
          id="hero-heading"
          className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl"
        >
          {BRAND.headline}
          <br />
          <span className="bg-[linear-gradient(90deg,#3B82F6_0%,#6A8DFF_45%,#8B5CF6_100%)] bg-clip-text text-transparent">
            {BRAND.slogan}
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-base leading-7 text-white/70 sm:text-lg">
          {BRAND.subheadline}
        </p>

        <div className="mt-3 grid max-w-xl gap-3">
          <p className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm font-medium leading-6 text-blue-200">
            <span aria-hidden="true">🎉 </span>
            Now live — practical AI for work, research, planning, and everyday
            decisions.
          </p>

          {earlyAdopter.enabled && (
            <p className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm font-semibold leading-6 text-emerald-200">
              <span aria-hidden="true">🔥 </span>
              Early Adopter Pricing Available — Pro starts at just $
              {proMonthlyPrice}/month.
            </p>
          )}
        </div>

        <p className="mt-6 max-w-xl text-sm leading-6 text-white/60">
          {CREDIBILITY_LINE}
        </p>

        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href={BRAND.routes.login}
            className="rounded-2xl bg-[linear-gradient(90deg,#2563EB,#4F8CFF)] px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_35px_rgba(37,99,235,0.35)] transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            {BRAND.ctaPrimary}
          </Link>

          <Link
            href={BRAND.routes.pricing}
            className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-6 py-3 text-sm font-semibold text-emerald-100 backdrop-blur transition hover:bg-emerald-500/15 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            View Early Adopter Pricing
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[470px]">
        <div
          role="img"
          aria-label="Preview of LVTChat creating a practical marketing plan"
          className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,16,32,0.96),rgba(5,10,24,0.94))] p-4 shadow-[0_25px_90px_rgba(0,0,0,0.55)]"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-[-35%] mx-auto h-48 w-72 rounded-full bg-blue-500/20 blur-3xl"
          />

          <div className="relative rounded-[22px] border border-white/10 bg-[#050B17] p-4">
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-400/60 bg-[#0B1224] text-xs font-bold text-white">
                  {BRAND.shortName}
                </div>

                <p className="text-sm font-semibold text-white">
                  {BRAND.name}
                </p>
              </div>

              <span aria-hidden="true" className="text-white/50">
                ✕
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl rounded-tr-md bg-[linear-gradient(90deg,#2563EB,#3B82F6)] px-4 py-3 text-sm text-white shadow-[0_10px_30px_rgba(37,99,235,0.3)]">
                  Help me create a marketing plan for my business.
                </div>
              </div>

              <div className="flex gap-3">
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#0D152B] text-xs font-bold text-white/90">
                  {BRAND.shortName}
                </div>

                <div className="flex-1 rounded-2xl rounded-tl-md border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/85">
                  <p className="mb-4 text-white/90">
                    Here&apos;s a practical marketing plan tailored to your
                    goals:
                  </p>

                  <div className="space-y-4">
                    {PREVIEW_STEPS.map((step) => (
                      <div key={step.title} className="flex gap-3">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 text-blue-300"
                        >
                          ✦
                        </span>

                        <div>
                          <p className="font-medium text-white">{step.title}</p>
                          <p className="mt-0.5 text-white/55">
                            {step.subtitle}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/45">
              <span className="flex-1">Ask {BRAND.name} anything...</span>

              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(90deg,#2563EB,#3B82F6)] text-white shadow-[0_8px_25px_rgba(37,99,235,0.35)]"
              >
                ↑
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}