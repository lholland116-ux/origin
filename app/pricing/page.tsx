"use client";

import Link from "next/link";
import { useState } from "react";
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
      "Web search with real-time answers",
      "File uploads for PDF, DOCX, and XLSX",
      "Priority performance",
      "Built for serious work",
    ],
    cta: "Upgrade to Pro",
    href: null,
    highlight: true,
  },
] as const;

export default function PricingPage() {
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handleUpgradeToPro() {
    setIsUpgrading(true);
    setCheckoutError(null);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = (await response.json()) as {
        url?: string;
        error?: string;
      };

      if (response.status === 401) {
        window.location.href = BRAND.routes.login;
        return;
      }

      if (!response.ok || !data.url) {
        throw new Error(data.error || "Unable to start checkout.");
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Stripe checkout failed:", error);
      setCheckoutError(
        "Unable to start checkout. Please sign in and try again."
      );
      setIsUpgrading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto mb-8 max-w-5xl">
        <Link
          href={BRAND.routes.home}
          className="inline-flex text-sm text-white/60 transition hover:text-white"
        >
          ← Back to Home
        </Link>
      </div>

      <section className="mx-auto max-w-3xl text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-300">
          Pricing
        </p>

        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">
          Simple, transparent pricing
        </h1>

        <p className="mt-4 text-lg text-white/70">
          Start free. Upgrade when you need more power.
        </p>

        <p className="mt-4 text-sm text-white/60">
          Built by Levi Holland to make practical AI support easier to use for
          work, research, and everyday tasks.
        </p>
      </section>

      <section className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-2">
        {PLANS.map((plan) => (
          <article
            key={plan.name}
            className={`relative rounded-3xl border p-6 transition ${
              plan.highlight
                ? "border-blue-500/40 bg-[linear-gradient(180deg,rgba(20,40,90,0.3),rgba(10,20,50,0.4))] shadow-[0_20px_60px_rgba(59,130,246,0.2)]"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
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

            {plan.highlight ? (
              <button
                type="button"
                onClick={handleUpgradeToPro}
                disabled={isUpgrading}
                className="mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-[linear-gradient(90deg,#2563EB,#3B82F6)] px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_12px_30px_rgba(37,99,235,0.35)] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
              >
                {isUpgrading ? "Redirecting..." : plan.cta}
              </button>
            ) : (
              <Link
                href={plan.href}
                className="mt-8 inline-block w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {plan.cta}
              </Link>
            )}
          </article>
        ))}
      </section>

      {checkoutError && (
        <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">
          {checkoutError}
        </div>
      )}

      <section className="mx-auto mt-10 max-w-3xl text-center text-sm text-white/60">
        <p>No credit card required for the free plan • Cancel anytime</p>
        <p className="mt-2">
          Need special pricing for education or research? Contact us at{" "}
          <a
            href={`mailto:${BRAND.supportEmail}`}
            className="text-blue-300 hover:text-blue-200"
          >
            {BRAND.supportEmail}
          </a>
          .
        </p>
      </section>
    </main>
  );
}