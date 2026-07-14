"use client";

import { useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

const LOGIN_REDIRECT = "/login?redirect=/pricing";
const MOBILE_APPS_FEATURE = BRAND.mobile.pricingFeature;

const FEATURES_FREE = [
  "20 messages per day",
  "Standard AI mode",
  "Core chat experience",
  "Conversation history",
  "Analyze one image per prompt",
  "Android app access",
  "Great for everyday use",
] as const;

const FEATURES_PRO = [
  "300 messages per day",
  "Web search with current information",
  "Upload up to 3 documents at once",
  "Analyze PDF, DOCX, XLSX, CSV, and TXT files",
  "Analyze one image per prompt",
  "Priority performance",
  "Custom AI Agents",
  MOBILE_APPS_FEATURE,
  "Built for serious work",
] as const;

type CheckoutResponse = {
  url?: string;
  error?: string;
};

async function readCheckoutResponse(
  response: Response
): Promise<CheckoutResponse> {
  try {
    return (await response.json()) as CheckoutResponse;
  } catch {
    return {};
  }
}

function formatPrice(price: number): string {
  return Number.isInteger(price) ? price.toString() : price.toFixed(2);
}

function ProCheckoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout(): Promise<void> {
    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await readCheckoutResponse(response);

      if (response.status === 401) {
        window.location.assign(LOGIN_REDIRECT);
        return;
      }

      if (!response.ok || !data.url) {
        throw new Error(
          data.error ??
            "Unable to start checkout. Please try again in a moment."
        );
      }

      window.location.assign(data.url);
    } catch (caughtError) {
      console.error("Checkout error:", caughtError);

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to start checkout. Please try again."
      );

      setLoading(false);
    }
  }

  return (
    <div className="mt-8 space-y-3">
      <button
        type="button"
        onClick={handleCheckout}
        disabled={loading}
        aria-busy={loading}
        className="w-full rounded-2xl bg-blue-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-[#020817] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Opening secure checkout..." : "Upgrade to Pro"}
      </button>

      <p className="text-center text-xs leading-5 text-zinc-400">
        Sign in or create a free account to upgrade securely through Stripe.
      </p>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          <p>{error}</p>

          {error.toLowerCase().includes("signed in") ? (
            <Link
              href={LOGIN_REDIRECT}
              className="mt-2 inline-flex font-semibold text-amber-100 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-amber-200 focus:ring-offset-2 focus:ring-offset-[#020817]"
            >
              Sign in or create an account
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FeatureItem({ feature }: { feature: string }) {
  const isCustomAgents = feature === "Custom AI Agents";
  const isMobileApps = feature === MOBILE_APPS_FEATURE;

  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 text-emerald-400">
        ✓
      </span>

      <span>
        {feature}

        {isCustomAgents ? (
          <span className="ml-2 inline-flex rounded-full border border-blue-400/40 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-200">
            Pro — Coming Soon
          </span>
        ) : null}

        {isMobileApps ? (
          <span className="ml-2 inline-flex rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
            {BRAND.mobile.availabilityLabel}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export default function PricingPage() {
  const earlyAdopter = BRAND.promotions.earlyAdopter;
  const proPrice = BRAND.pricing.proMonthlyPrice;
  const standardPrice = BRAND.pricing.standardProMonthlyPrice;
  const dailyCost = proPrice / 30;

  return (
    <main className="min-h-screen bg-[#020817] text-white">
      <header className="border-b border-white/10 bg-[#020817]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link
            href={BRAND.routes.home}
            aria-label={`${BRAND.name} home`}
            className="flex items-center gap-2 rounded-xl font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm"
            >
              💬
            </span>

            <span>{BRAND.name}</span>
          </Link>

          <nav
            aria-label="Pricing page navigation"
            className="flex items-center gap-1 text-sm font-medium sm:gap-2"
          >
            <Link
              href={BRAND.routes.app}
              className="rounded-xl px-3 py-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 sm:px-4"
            >
              Chat
            </Link>

            <Link
              href={BRAND.routes.pricing}
              aria-current="page"
              className="rounded-xl bg-white/10 px-3 py-2 text-white sm:px-4"
            >
              Pricing
            </Link>

            <Link
              href="/account"
              className="hidden rounded-xl px-4 py-2 text-zinc-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 sm:inline-flex"
            >
              Account
            </Link>

            <Link
              href={BRAND.routes.login}
              className="ml-1 rounded-xl border border-white/15 px-3 py-2 text-zinc-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 sm:ml-2 sm:px-4"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <section
        aria-labelledby="pricing-heading"
        className="relative overflow-hidden px-6 py-14 sm:py-16"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.22),transparent_35%),radial-gradient(circle_at_center,rgba(16,185,129,0.08),transparent_35%)]"
        />

        <div className="mx-auto max-w-5xl text-center">
          {earlyAdopter.enabled ? (
            <div className="mx-auto mb-6 inline-flex rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200">
              <span aria-hidden="true">🔥&nbsp;</span>
              {earlyAdopter.headline} — ${formatPrice(proPrice)}/month
            </div>
          ) : null}

          <h1
            id="pricing-heading"
            className="text-4xl font-bold tracking-tight sm:text-6xl"
          >
            Clear pricing for practical AI support
          </h1>

          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-300">
            Start free. Upgrade when you need more messages, current web
            information, document analysis, and advanced productivity tools.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-6 md:grid-cols-2">
          <article className="rounded-3xl border border-white/15 bg-white/[0.04] p-7 shadow-2xl">
            <h2 className="text-2xl font-bold">
              {BRAND.pricing.freePlanName}
            </h2>

            <p className="mt-3 text-zinc-300">
              A simple way to get started with practical AI support.
            </p>

            <div className="mt-8 flex items-end gap-2">
              <span className="text-4xl font-bold">$0</span>
              <span className="pb-1 text-zinc-400">/ month</span>
            </div>

            <ul className="mt-8 space-y-4 text-sm text-zinc-200">
              {FEATURES_FREE.map((feature) => (
                <FeatureItem key={feature} feature={feature} />
              ))}
            </ul>

            <Link
              href={BRAND.routes.login}
              className="mt-10 flex w-full items-center justify-center rounded-2xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
            >
              Get Started Free
            </Link>
          </article>

          <article className="relative rounded-3xl border border-blue-500/70 bg-blue-950/20 p-7 shadow-[0_0_60px_rgba(59,130,246,0.22)]">
            <div className="absolute right-6 top-6 rounded-full border border-blue-400/50 bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-200">
              Early Adopter
            </div>

            <h2 className="pr-28 text-2xl font-bold">
              {BRAND.pricing.proPlanName}
            </h2>

            <p className="mt-3 max-w-sm text-zinc-300">
              More power, flexibility, and advanced AI capabilities for
              professional and business use.
            </p>

            <div className="mt-8 flex flex-wrap items-end gap-2">
              <span className="pb-1 text-xl font-semibold text-zinc-500 line-through">
                {BRAND.pricing.currencySymbol}
                {formatPrice(standardPrice)}
              </span>

              <span className="text-4xl font-bold">
                {BRAND.pricing.currencySymbol}
                {formatPrice(proPrice)}
              </span>

              <span className="pb-1 text-zinc-400">/ month</span>
            </div>

            <p className="mt-2 text-sm text-zinc-400">
              About ${dailyCost.toFixed(2)}/day for practical AI support.
            </p>

            {earlyAdopter.enabled ? (
              <>
                <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  {earlyAdopter.subheadline}
                </div>

                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm leading-6 text-zinc-300">
                  {earlyAdopter.note}
                </div>
              </>
            ) : null}

            <div className="mt-4 rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 py-4">
              <p className="text-sm font-semibold text-blue-100">
                Android app now available on Google Play.
              </p>

              <p className="mt-1 text-xs leading-5 text-zinc-300">
                {BRAND.mobile.proMessage}
              </p>

              <a
                href={BRAND.mobile.androidPlayStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center justify-center rounded-xl border border-blue-300/30 bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-50 transition hover:bg-blue-500/30 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-[#020817]"
              >
                {BRAND.mobile.downloadLabel}
              </a>
            </div>

            <ul className="mt-6 space-y-4 text-sm text-zinc-200">
              {FEATURES_PRO.map((feature) => (
                <FeatureItem key={feature} feature={feature} />
              ))}
            </ul>

            <ProCheckoutButton />
          </article>
        </div>

        <p className="mt-8 text-center text-sm text-zinc-400">
          No credit card required for the free plan • Cancel Pro anytime
        </p>
      </section>
    </main>
  );
}