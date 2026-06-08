"use client";

import { useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

const LOGIN_REDIRECT = "/login?redirect=/pricing";

const featuresFree = [
  "20 messages per day",
  "Standard AI mode",
  "Core chat experience",
  "Great for everyday use",
];

const featuresPro = [
  "300 messages per day",
  "Web search with real-time answers",
  "File uploads for PDF, DOCX, and XLSX",
  "Priority performance",
  "Custom AI Agents",
  "Built for serious work",
];

type CheckoutResponse = {
  url?: string;
  error?: string;
};

async function readCheckoutResponse(res: Response): Promise<CheckoutResponse> {
  try {
    return (await res.json()) as CheckoutResponse;
  } catch {
    return {};
  }
}

function formatPrice(price: number) {
  return Number.isInteger(price) ? price.toString() : price.toFixed(2);
}

function ProCheckoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await readCheckoutResponse(res);

      if (res.status === 401) {
        window.location.assign(LOGIN_REDIRECT);
        return;
      }

      if (!res.ok || !data.url) {
        throw new Error(data.error || "Unable to start checkout.");
      }

      window.location.assign(data.url);
    } catch (err) {
      console.error("Checkout error:", err);

      setError(
        err instanceof Error
          ? err.message
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
        className="w-full rounded-2xl bg-blue-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-[#020817] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Opening Stripe..." : "Upgrade to Pro"}
      </button>

      <p className="text-center text-xs text-zinc-400">
        Sign in or create a free account to upgrade securely through Stripe.
      </p>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p>{error}</p>

          {error.toLowerCase().includes("signed in") && (
            <Link
              href={LOGIN_REDIRECT}
              className="mt-2 inline-flex font-semibold text-amber-100 underline-offset-4 hover:underline"
            >
              Sign in or create account
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function FeatureItem({ feature }: { feature: string }) {
  const isComingSoon = feature === "Custom AI Agents";

  return (
    <li className="flex gap-3">
      <span className="mt-0.5 text-emerald-400">✓</span>
      <span>
        {feature}
        {isComingSoon && (
          <span className="ml-2 rounded-full border border-blue-400/40 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-200">
            Pro — Coming Soon
          </span>
        )}
      </span>
    </li>
  );
}

export default function PricingPage() {
  const earlyAdopter = BRAND.promotions.earlyAdopter;
  const proPrice = BRAND.pricing.proMonthlyPrice;
  const standardPrice = BRAND.pricing.standardProMonthlyPrice;

  return (
    <main className="min-h-screen bg-[#020817] text-white">
      <header className="border-b border-white/10 bg-[#020817]/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm">
              💬
            </span>
            <span>{BRAND.name}</span>
          </Link>

          <nav className="flex items-center gap-2 text-sm font-medium">
            <Link
              href={BRAND.routes.app}
              className="rounded-xl px-4 py-2 text-zinc-200 hover:bg-white/10"
            >
              Chat
            </Link>

            <Link
              href={BRAND.routes.pricing}
              className="rounded-xl bg-white/10 px-4 py-2 text-white"
            >
              Pricing
            </Link>

            <Link
              href="/account"
              className="rounded-xl px-4 py-2 text-zinc-200 hover:bg-white/10"
            >
              Account
            </Link>

            <Link
              href={BRAND.routes.login}
              className="ml-2 rounded-xl border border-white/15 px-4 py-2 text-zinc-100 hover:bg-white/10"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden px-6 py-14">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.22),transparent_35%),radial-gradient(circle_at_center,rgba(16,185,129,0.08),transparent_35%)]" />

        <div className="mx-auto max-w-5xl text-center">
          {earlyAdopter.enabled && (
            <div className="mx-auto mb-6 inline-flex rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200">
              Early Adopter Pricing: Lock in Pro for $
              {formatPrice(proPrice)}/month
            </div>
          )}

          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Clear pricing for practical AI support
          </h1>

          <p className="mt-5 text-lg text-zinc-300">
            Start free. Upgrade when you need more power, current answers, and
            document support.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/15 bg-white/[0.04] p-7 shadow-2xl">
            <h2 className="text-2xl font-bold">{BRAND.pricing.freePlanName}</h2>

            <p className="mt-3 text-zinc-300">
              A simple way to get started with practical AI support.
            </p>

            <div className="mt-8 flex items-end gap-2">
              <span className="text-4xl font-bold">$0</span>
              <span className="pb-1 text-zinc-400">/ month</span>
            </div>

            <ul className="mt-8 space-y-4 text-sm text-zinc-200">
              {featuresFree.map((feature) => (
                <FeatureItem key={feature} feature={feature} />
              ))}
            </ul>

            <Link
              href={BRAND.routes.login}
              className="mt-10 flex w-full items-center justify-center rounded-2xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Get Started
            </Link>
          </div>

          <div className="relative rounded-3xl border border-blue-500/70 bg-blue-950/20 p-7 shadow-[0_0_60px_rgba(59,130,246,0.22)]">
            <div className="absolute right-6 top-6 rounded-full border border-blue-400/50 bg-blue-500/15 px-3 py-1 text-xs text-blue-200">
              Early Adopter
            </div>

            <h2 className="text-2xl font-bold">{BRAND.pricing.proPlanName}</h2>

            <p className="mt-3 max-w-sm text-zinc-300">
              More power, flexibility, and advanced AI capabilities for serious
              work.
            </p>

            <div className="mt-8 flex items-end gap-2">
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

            <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Early Adopter Pricing — lock in ${formatPrice(proPrice)}/month
              before future price increases.
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300">
              Future subscribers will pay higher rates as new features are
              released. Early adopters keep their discounted rate.
            </div>

            <div className="mt-4 rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-blue-100">
                Custom AI Agents are coming soon.
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-300">
                Create specialized AI assistants for work, research, planning,
                productivity, and real-world workflows.
              </p>
            </div>

            <ul className="mt-6 space-y-4 text-sm text-zinc-200">
              {featuresPro.map((feature) => (
                <FeatureItem key={feature} feature={feature} />
              ))}
            </ul>

            <ProCheckoutButton />
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-zinc-400">
          No credit card required for the free plan • Cancel anytime
        </p>
      </section>
    </main>
  );
}