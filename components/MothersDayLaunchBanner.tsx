import Link from "next/link";
import { BRAND } from "@/lib/branding";

const PROMO_CODE = "MOTHERSDAY";

export default function MothersDayLaunchBanner() {
  return (
    <section
      className="mx-auto mt-6 max-w-5xl rounded-3xl border border-blue-400/30 bg-blue-500/10 px-6 py-5 text-white shadow-[0_20px_60px_rgba(37,99,235,0.18)]"
      aria-label="Mother's Day launch special"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
            Mother&apos;s Day Launch Special
          </p>

          <h2 className="mt-2 text-2xl font-semibold">
            Get Pro for $10/month forever.
          </h2>

          <p className="mt-2 text-sm leading-6 text-white/70">
            Normally $15/month. First 100 first-time users only. Offer ends May
            15, 2026.
          </p>

          <p className="mt-2 text-xs text-white/50">
            Discount automatically applies at checkout.
          </p>
        </div>

        <Link
          href={`${BRAND.routes.pricing}?promo=${PROMO_CODE}`}
          className="inline-flex min-h-12 w-full min-w-[240px] items-center justify-center rounded-2xl bg-blue-500 px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_12px_30px_rgba(59,130,246,0.35)] transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-[#020817] md:w-auto"
        >
          Claim early user pricing
        </Link>
      </div>
    </section>
  );
}