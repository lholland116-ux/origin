"use client";

import { useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

const LOGIN_REDIRECT = "/login?redirectTo=/pricing";
const FEATURES_FREE = [
  "20 messages/day",
  "Standard AI",
  "Web Search",
  "Conversation history",
  "1 document per Standard message (TXT, MD, CSV, PDF, DOCX, XLSX)",
  "5 MB maximum document size",
  "1 image attachment per Standard message",
  "Image upload and analysis",
  "Image generation",
  "Image editing",
  "3 shared image operations/day",
  "21 shared image operations/month",
  "Generated-image deletion",
  "Voice Input",
  "Read Aloud",
  "Android access",
] as const;

const FEATURES_PRO = [
  "300 messages/day",
  "Standard AI",
  "Web Search",
  "Conversation history",
  "Up to 3 documents per message (TXT, MD, CSV, PDF, DOCX, XLSX)",
  "10 MB maximum per document",
  "Up to 3 image attachments per Standard message",
  "Image upload and analysis",
  "Image generation",
  "Image editing",
  "20 shared image operations/day",
  "200 shared image operations/month",
  "Generated-image deletion",
  "Voice Input",
  "Read Aloud",
  "Android access",
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
        className="w-full rounded-2xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Opening secure checkout..." : "Upgrade to Pro"}
      </button>

      <p className="text-center text-xs leading-5 text-slate-700">
        Sign in or create a free account to upgrade securely through Stripe.
      </p>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <p>{error}</p>

          {error.toLowerCase().includes("signed in") ? (
            <Link
              href={LOGIN_REDIRECT}
              className="mt-2 inline-flex rounded-md font-semibold text-amber-900 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-amber-800 focus:ring-offset-2"
            >
              <span className="text-amber-900">Sign in or create an account</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FeatureItem({ feature }: { feature: string }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 text-emerald-800">
        ✓
      </span>
      <span>{feature}</span>
    </li>
  );
}

function PricingHeader() {
  return <Header />;
}

export default function PricingPage() {
  const earlyAdopter = BRAND.promotions.earlyAdopter;
  const proPrice = BRAND.pricing.proMonthlyPrice;
  const standardPrice = BRAND.pricing.standardProMonthlyPrice;
  const dailyCost = proPrice / 30;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <PricingHeader />

      <section
        aria-labelledby="pricing-heading"
        className="relative overflow-hidden bg-gradient-to-b from-white via-white to-slate-50 px-4 py-12 sm:px-6 sm:py-16"
      >
        <div className="mx-auto max-w-5xl text-center">
          {earlyAdopter.enabled ? (
            <div className="mx-auto mb-6 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900">
              <span aria-hidden="true">🔥&nbsp;</span>
              {BRAND.pricing.currencySymbol}{formatPrice(proPrice)}/month — Limited-time offer
            </div>
          ) : null}

          <h1
            id="pricing-heading"
            className="text-4xl font-bold tracking-tight sm:text-6xl"
          >
            Clear pricing for practical AI support
          </h1>

          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-700">
            Web Search and document analysis are available on both plans. Free
            includes one supported document up to 5 MB per Standard message;
            Pro raises that to three documents up to 10 MB each, with higher
            message and image-operation limits.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-6 md:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <h2 className="text-2xl font-bold">
              {BRAND.pricing.freePlanName}
            </h2>

            <p className="mt-3 text-slate-700">
              A simple way to get started with practical AI support.
            </p>

            <div className="mt-8 flex items-end gap-2">
              <span className="text-4xl font-bold">$0</span>
              <span className="pb-1 text-slate-600">/ month</span>
            </div>

            <ul className="mt-8 space-y-4 text-sm text-slate-700">
              {FEATURES_FREE.map((feature) => (
                <FeatureItem key={feature} feature={feature} />
              ))}
            </ul>

            <Link
              href={BRAND.routes.login}
              className="mt-10 flex min-h-12 w-full items-center justify-center rounded-xl border border-blue-700 px-5 py-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
            >
              <span className="text-blue-800">Get Started Free</span>
            </Link>
          </article>

          <article className="relative rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-md shadow-blue-950/5 sm:p-7">
            <div className="absolute right-6 top-6 rounded-full border border-blue-700 bg-blue-700 px-3 py-1 text-xs font-semibold text-white">
              Early Adopter
            </div>

            <h2 className="pr-28 text-2xl font-bold">
              {BRAND.pricing.proPlanName}
            </h2>

            <p className="mt-3 max-w-sm text-slate-700">
              More power, flexibility, and advanced AI capabilities for
              professional and business use.
            </p>

            <div className="mt-8 flex flex-wrap items-end gap-2">
              <span className="pb-1 text-xl font-semibold text-slate-600 line-through">
                {BRAND.pricing.currencySymbol}
                {formatPrice(standardPrice)}
              </span>

              <span className="text-4xl font-bold">
                {BRAND.pricing.currencySymbol}
                {formatPrice(proPrice)}
              </span>

              <span className="pb-1 text-slate-600">/ month</span>
            </div>

            <p className="mt-2 text-sm text-slate-600">
              About ${dailyCost.toFixed(2)}/day for practical AI support.
            </p>

            {earlyAdopter.enabled ? (
              <>
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  $5.99/month is a limited-time offer. Future pricing may differ.
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 px-4 py-2 text-sm leading-6 text-slate-700">
                  Future subscribers may pay different rates as the product expands.
                </div>
              </>
            ) : null}

            <div className="mt-4 rounded-xl border border-blue-200 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-blue-900">
                Android app now available on Google Play.
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-700">
                {BRAND.mobile.proMessage}
              </p>

              <a
                href={BRAND.mobile.androidPlayStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg border border-blue-700 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
              >
                <span className="text-blue-800">{BRAND.mobile.downloadLabel}</span>
              </a>
            </div>

            <ul className="mt-6 space-y-4 text-sm text-slate-700">
              {FEATURES_PRO.map((feature) => (
                <FeatureItem key={feature} feature={feature} />
              ))}
            </ul>

            <ProCheckoutButton />
          </article>
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-6 text-slate-600">
          Generate, Regenerate, and Edit share the same image-operation allowance.
        </p>

        <p className="mt-8 text-center text-sm text-slate-600">
          No credit card required for the free plan • Cancel Pro anytime
        </p>
      </section>
      <section className="mx-4 mb-10 rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center sm:mx-6 lg:mx-auto lg:max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-900">Separate from current subscriptions</p>
        <h2 className="mt-3 text-2xl font-bold text-slate-950 sm:text-3xl">Workflow Automation — Early Access</h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-700">Pricing tailored to your workflows, integrations, and business requirements. Workflow Automation is in development and is not included in Free or Pro subscriptions.</p>
        <Link href="/request?interest=demo&source=pricing" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"><span className="text-white">Request Demo</span></Link>
      </section>
      <div className="bg-slate-950 px-4 py-6 sm:px-8"><Footer variant="dark" /></div>
    </main>
  );
}
