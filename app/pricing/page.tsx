import Link from "next/link";
import { BRAND } from "@/lib/branding";

const PLANS = [
  {
    name: BRAND.pricing.freePlanName,
    price: "$0",
    cadence: "/ month",
    description: "A simple way to get started with practical AI support.",
    features: [
      `${BRAND.pricing.freeDailyMessageLimit} messages per day`,
      "Standard AI mode",
      "Core chat experience",
      "Great for everyday use",
    ],
    cta: "Get Started",
    href: BRAND.routes.login,
    highlight: false,
  },
  {
    name: BRAND.pricing.proPlanName,
    price: `$${BRAND.pricing.proMonthlyPrice}`,
    cadence: "/ month",
    description: "More power, flexibility, and advanced AI capabilities.",
    features: [
      `${BRAND.pricing.proDailyMessageLimit} messages per day`,
      "Web search (real-time answers)",
      "File uploads (PDF, DOCX, XLSX)",
      "Priority performance",
      "Built for serious work",
    ],
    cta: "Upgrade to Pro",
    href: BRAND.routes.login,
    highlight: true,
  },
] as const;

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      {/* Back to Home */}
      <div className="mx-auto mb-8 max-w-5xl">
        <Link
          href={BRAND.routes.home}
          className="inline-flex text-sm text-white/60 hover:text-white transition"
        >
          ← Back to Home
        </Link>
      </div>

      {/* Header */}
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-300">
          Pricing
        </p>

        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">
          Simple, transparent pricing
        </h1>

        <p className="mt-4 text-white/70 text-lg">
          Start free. Upgrade when you need more power.
        </p>

        {/* Trust signal */}
        <p className="mt-4 text-sm text-white/60">
          Built by a scientist with 25+ years of experience in pharma, biotech,
          cosmetics, and medical devices.
        </p>
      </div>

      {/* Plans */}
      <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`relative rounded-3xl border p-6 transition ${
              plan.highlight
                ? "border-blue-500/40 bg-[linear-gradient(180deg,rgba(20,40,90,0.3),rgba(10,20,50,0.4))] shadow-[0_20px_60px_rgba(59,130,246,0.2)]"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            {/* Highlight badge */}
            {plan.highlight && (
              <span className="absolute right-6 top-6 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
                Most Popular
              </span>
            )}

            <h2 className="text-xl font-semibold">{plan.name}</h2>

            <p className="mt-2 text-white/70">{plan.description}</p>

            <div className="mt-6">
              <span className="text-3xl font-semibold">{plan.price}</span>
              <span className="text-white/60">{plan.cadence}</span>
            </div>

            <ul className="mt-6 space-y-3 text-sm text-white/70">
              {plan.features.map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>

            <Link
              href={plan.href}
              className={`mt-8 inline-block w-full rounded-2xl px-5 py-3 text-center text-sm font-semibold transition ${
                plan.highlight
                  ? "bg-[linear-gradient(90deg,#2563EB,#3B82F6)] text-white shadow-[0_12px_30px_rgba(37,99,235,0.35)] hover:scale-[1.02]"
                  : "border border-white/15 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>

      {/* Bottom reassurance */}
      <div className="mx-auto mt-10 max-w-3xl text-center text-sm text-white/60">
        <p>No credit card required • Cancel anytime</p>
        <p className="mt-2">
          Need special pricing for education or research? Contact us.
        </p>
      </div>
    </main>
  );
}