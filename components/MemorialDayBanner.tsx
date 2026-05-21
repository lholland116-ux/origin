"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

type TimeRemaining = {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function getTimeRemaining(endDate: string): TimeRemaining {
  const endTime = new Date(endDate).getTime();

  if (!endDate || Number.isNaN(endTime)) {
    return {
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  const total = endTime - Date.now();

  if (total <= 0) {
    return {
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  return {
    expired: false,
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
  };
}

function formatPromoEndDate(endDate: string) {
  const date = new Date(endDate);

  if (!endDate || Number.isNaN(date.getTime())) {
    return "soon";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export default function MemorialDayBanner() {
  const promo = BRAND.promotions.memorialDay;

  const promoCode = promo.promoCode || BRAND.launch.promoCode;
  const promoEnds = promo.endsAt || BRAND.launch.promoEnds;
  const originalPrice = promo.originalPrice || BRAND.launch.pricing.original;
  const discountedPrice =
    promo.discountedPrice || BRAND.launch.pricing.discounted;

  const [timeLeft, setTimeLeft] = useState<TimeRemaining>(() =>
    getTimeRemaining(promoEnds)
  );

  const promoUrl = useMemo(() => {
    const params = new URLSearchParams();

    if (promoCode) {
      params.set("promo", promoCode);
    }

    const queryString = params.toString();

    return queryString
      ? `${BRAND.routes.pricing}?${queryString}`
      : BRAND.routes.pricing;
  }, [promoCode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeLeft(getTimeRemaining(promoEnds));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [promoEnds]);

  if (!promo.enabled) {
    return null;
  }

  return (
    <section
      className="mx-auto mt-6 max-w-5xl overflow-hidden rounded-3xl border border-sky-400/25 bg-[linear-gradient(135deg,rgba(30,64,175,0.26),rgba(14,165,233,0.14),rgba(2,8,23,0.94))] px-6 py-5 text-white shadow-[0_20px_70px_rgba(14,165,233,0.14)]"
      aria-label="LVTChat Memorial Day early access special"
    >
      <div className="relative">
        <div className="pointer-events-none absolute -right-4 -top-4 text-5xl opacity-20">
          🇺🇸
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-sky-300">
              {promo.name}
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
              Get LVTChat Pro for ${discountedPrice}/month for a limited time.
            </h2>

            <p className="mt-2 text-sm leading-6 text-white/75">
              In recognition of Memorial Day weekend, new users can unlock
              early-access pricing for practical AI support at work, in
              research, planning, and everyday decision-making.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-white/45">
                  Promo ends in
                </p>

                <p className="mt-1 text-lg font-bold text-white">
                  {timeLeft.expired
                    ? "Offer ended"
                    : `${timeLeft.days}d ${timeLeft.hours}h ${timeLeft.minutes}m ${timeLeft.seconds}s`}
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-white/45">
                  Promo code
                </p>

                <p className="mt-1 text-lg font-bold text-emerald-300">
                  {promoCode}
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-white/55">
              Normally ${originalPrice}/month. Offer ends{" "}
              {formatPromoEndDate(promoEnds)}. Discount applies at Stripe
              Checkout after sign-in.
            </p>
          </div>

          <Link
            href={promoUrl}
            className="inline-flex min-h-12 w-full min-w-[240px] items-center justify-center rounded-2xl bg-sky-500 px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_12px_30px_rgba(14,165,233,0.35)] transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 focus:ring-offset-[#020817] md:w-auto"
          >
            {promo.ctaLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}