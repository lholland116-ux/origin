import Link from "next/link";
import { BRAND } from "@/lib/branding";

export default function MothersDayLaunchBanner() {
  return (
    <section className="mx-auto mt-6 max-w-5xl rounded-3xl border border-blue-400/30 bg-blue-500/10 px-6 py-5 text-white shadow-[0_20px_60px_rgba(37,99,235,0.18)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
            Mother&apos;s Day Launch Special
          </p>

          <h2 className="mt-2 text-2xl font-semibold">
            Get Pro for $10/month forever.
          </h2>

          <p className="mt-2 text-sm text-white/70">
            Normally $15/month. First 100 first-time users only. Offer ends May
            15, 2026.
          </p>

          <p className="mt-2 text-xs text-white/50">
            Discount automatically applies at checkout.
          </p>
        </div>

        <Link
          href={`${BRAND.routes.pricing}?promo=MOTHERSDAY`}
          className="inline-flex rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
        >
          Claim early user pricing
        </Link>
      </div>
    </section>
  );
}