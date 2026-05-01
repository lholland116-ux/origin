"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/branding";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const MOTHERS_DAY_PROMO_CODE = "MOTHERSDAY";

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

function normalizePromoCode(value: string | null): string | null {
  const cleaned = value?.trim().toUpperCase();
  return cleaned === MOTHERS_DAY_PROMO_CODE ? cleaned : null;
}

function PricingPageContent() {
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const promoCode = useMemo(
    () => normalizePromoCode(searchParams.get("promo")),
    [searchParams]
  );

  const hasMothersDayPromo =
    mounted && promoCode === MOTHERS_DAY_PROMO_CODE;

  async function handleUpgradeToPro() {
    setIsUpgrading(true);
    setCheckoutError(null);

    try {
      const supabase = createBrowserSupabaseClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = hasMothersDayPromo
          ? `${BRAND.routes.login}?redirectTo=${encodeURIComponent(
              `${BRAND.routes.pricing}?promo=${MOTHERS_DAY_PROMO_CODE}`
            )}`
          : BRAND.routes.login;
        return;
      }

      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          promoCode,
        }),
      });

      const data = await response.json();

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
        error instanceof Error
          ? error.message
          : "Unable to start checkout. Please sign in and try again."
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
          Built by Levi Holland to make practical AI support easier to use.
        </p>

        {mounted && hasMothersDayPromo && (
          <div className="mx-auto mt-6 max-w-2xl rounded-3xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-4 text-left">
            <p className="text-xs text-emerald-300">
              Mother&apos;s Day Launch Special Applied
            </p>
            <p className="mt-2 text-lg font-semibold">
              Get Pro for $10/month forever.
            </p>
          </div>
        )}
      </section>

      <section className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-2">
        {PLANS.map((plan) => (
          <article key={plan.name} className="rounded-3xl border p-6">
            <h2 className="text-xl font-semibold">{plan.name}</h2>

            <div className="mt-6">
              {plan.highlight && mounted && hasMothersDayPromo ? (
                <>
                  <span className="text-3xl font-semibold">$10</span>
                  <span className="line-through ml-2 text-white/50">
                    {plan.price}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-3xl font-semibold">{plan.price}</span>
                  <span className="text-white/60">{plan.cadence}</span>
                </>
              )}
            </div>

            {plan.highlight ? (
              <button
                onClick={handleUpgradeToPro}
                disabled={isUpgrading}
                className="mt-8 w-full rounded-2xl bg-blue-600 px-5 py-3"
              >
                {isUpgrading ? "Redirecting..." : plan.cta}
              </button>
            ) : (
              <Link href={plan.href} className="mt-8 block text-center">
                {plan.cta}
              </Link>
            )}
          </article>
        ))}
      </section>

      {checkoutError && (
        <div className="mt-6 text-center text-red-400">
          {checkoutError}
        </div>
      )}
    </main>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<div>Loading pricing...</div>}>
      <PricingPageContent />
    </Suspense>
  );
}