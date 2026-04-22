import Link from "next/link";
import { BRAND } from "@/lib/branding";

export default function CTASection() {
  const ctaLabel =
    typeof BRAND.ctaPrimary === "string" && BRAND.ctaPrimary.trim().length > 0
      ? BRAND.ctaPrimary.trim()
      : `Try ${BRAND.name} Free`;

  return (
    <section
      className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(90deg,rgba(7,16,35,1)_0%,rgba(18,38,92,0.96)_45%,rgba(103,63,195,0.96)_100%)] px-5 py-8 shadow-[0_25px_80px_rgba(0,0,0,0.4)] md:px-8 lg:px-10"
      aria-label={`${BRAND.name} call to action`}
    >
      <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-white/20 bg-[#071225]/80 text-xl font-bold text-white shadow-[0_0_40px_rgba(59,130,246,0.2)]">
            {BRAND.shortName}
          </div>

          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Ready to upgrade the way you think and work?
            </h2>

            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75 sm:text-base">
              Join early users who are using {BRAND.name} to save time, solve
              more, and move faster.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 lg:items-end">
          <Link
            href={BRAND.routes.login}
            aria-label={`${ctaLabel} - go to login`}
            className="inline-flex min-w-[190px] items-center justify-center rounded-2xl bg-white px-6 py-3 shadow-[0_16px_35px_rgba(255,255,255,0.2)] transition hover:scale-[1.02] hover:shadow-[0_20px_45px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-white/70 focus:ring-offset-2 focus:ring-offset-[#17326F]"
          >
            <span className="whitespace-nowrap text-sm font-semibold leading-none text-[#17326F]">
              {ctaLabel}
            </span>
          </Link>

          <p className="text-sm text-white/75">
            Start free. No credit card required.
          </p>
        </div>
      </div>
    </section>
  );
}