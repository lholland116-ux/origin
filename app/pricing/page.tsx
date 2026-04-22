import Link from "next/link";
import { BRAND } from "@/lib/branding";

type PricingPlan = {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted: boolean;
  badge?: string | null;
};

const PLANS: PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "/ month",
    description: "A simple way to get started with practical AI support.",
    features: [
      "20 messages per day",
      "Standard AI mode",
      "Core chat experience",
      "Great for testing and everyday use",
    ],
    ctaLabel: "Get Started",
    ctaHref: BRAND.routes.login,
    highlighted: false,
    badge: null,
  },
  {
    name: "Pro",
    price: "$15",
    cadence: "/ month",
    description: "More power for users who want higher limits and advanced tools.",
    features: [
      "300 messages per day",
      "Web search access",
      "File uploads",
      "Priority feature access",
    ],
    ctaLabel: "Upgrade Coming Soon",
    ctaHref: BRAND.routes.login,
    highlighted: true,
    badge: "Recommended",
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto mb-8 max-w-5xl">
        <Link
          href={BRAND.routes.home}
          className="inline-flex rounded-md text-sm text-white/60 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
        >
          ← Back to Home
        </Link>
      </div>

      <div className="mx-auto max-w-5xl">
        <section className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            Pricing
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Simple, practical pricing for {BRAND.name}
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
            Start free and upgrade when you need more power. {BRAND.name} is
            built to help you solve problems faster with practical AI support.
          </p>
        </section>

        <section
          aria-label={`${BRAND.name} pricing plans`}
          className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2"
        >
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className={[
                "rounded-3xl border p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]",
                plan.highlighted
                  ? "border-blue-500/40 bg-[linear-gradient(180deg,rgba(17,32,70,0.95),rgba(9,18,38,0.98))]"
                  : "border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.95),rgba(5,10,22,0.98))]",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">{plan.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-white/65">
                    {plan.description}
                  </p>
                </div>

                {plan.badge ? (
                  <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-blue-300">
                    {plan.badge}
                  </span>
                ) : null}
              </div>

              <div className="mt-6 flex items-end gap-2">
                <span className="text-4xl font-semibold tracking-tight">
                  {plan.price}
                </span>
                <span className="pb-1 text-sm text-white/60">
                  {plan.cadence}
                </span>
              </div>

              <ul className="mt-6 space-y-3 text-sm text-white/75">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <span className="mt-0.5 text-blue-300" aria-hidden="true">
                      ✦
                    </span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <Link
                  href={plan.ctaHref}
                  className={[
                    "inline-flex rounded-2xl px-5 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2",
                    plan.highlighted
                      ? "bg-[linear-gradient(90deg,#2563EB,#4F8CFF)] text-white shadow-[0_14px_35px_rgba(37,99,235,0.35)] focus:ring-blue-400 focus:ring-offset-[#0B1328]"
                      : "bg-white text-[#08111F] shadow-[0_14px_35px_rgba(255,255,255,0.12)] focus:ring-white/60 focus:ring-offset-[#08111F]",
                  ].join(" ")}
                  aria-label={`${plan.ctaLabel} for ${plan.name} plan`}
                >
                  {plan.ctaLabel}
                </Link>
              </div>
            </article>
          ))}
        </section>

        <section className="mx-auto mt-14 max-w-3xl rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <h2 className="text-2xl font-semibold">
            Need more before Pro launches?
          </h2>

          <p className="mt-3 text-sm leading-7 text-white/65 sm:text-base">
            {BRAND.name} is still evolving. Start with the free plan today and
            watch for upcoming upgrades, higher limits, and expanded features.
          </p>

          <div className="mt-6">
            <Link
              href={BRAND.routes.login}
              className="inline-flex rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
            >
              Start Free
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}