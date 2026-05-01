"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

const TOTAL_LAUNCH_SPOTS = 100;
const CLAIMED_LAUNCH_SPOTS = 17;

function getTimeRemaining(endDate: string) {
  const total = new Date(endDate).getTime() - Date.now();

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

export default function MothersDayLaunchBanner() {
  const promoUrl = `${BRAND.routes.pricing}?promo=${BRAND.launch.promoCode}`;

  const [timeLeft, setTimeLeft] = useState(() =>
    getTimeRemaining(BRAND.launch.promoEnds)
  );

  const spotsLeft = useMemo(
    () => Math.max(TOTAL_LAUNCH_SPOTS - CLAIMED_LAUNCH_SPOTS, 0),
    []
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeLeft(getTimeRemaining(BRAND.launch.promoEnds));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      className="mx-auto mt-6 max-w-5xl overflow-hidden rounded-3xl border border-pink-400/30 bg-[linear-gradient(135deg,rgba(30,64,175,0.22),rgba(236,72,153,0.16),rgba(2,8,23,0.9))] px-6 py-5 text-white shadow-[0_20px_70px_rgba(236,72,153,0.16)]"
      aria-label="LVTChat Mother's Day launch special"
    >
      <div className="relative">
        <div className="pointer-events-none absolute -right-4 -top-4 text-5xl opacity-20">
          🎉
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-pink-300">
              {BRAND.launch.name}
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
              It&apos;s LVTChat Launch Day — get Pro for $
              {BRAND.launch.pricing.discounted}/month forever.
            </h2>

            <p className="mt-2 text-sm leading-6 text-white/75">
              Today is a huge day for LVT. To celebrate launch day and
              Mother&apos;s Day, the first {TOTAL_LAUNCH_SPOTS} first-time users
              can lock in early user pricing.
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
                  Launch spots left
                </p>

                <p className="mt-1 text-lg font-bold text-emerald-300">
                  Only {spotsLeft} spots left
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-white/55">
              Normally ${BRAND.launch.pricing.original}/month. Offer ends{" "}
              {BRAND.launch.promoEnds}. Discount applies at Stripe Checkout
              after sign-in.
            </p>
          </div>

          <Link
            href={promoUrl}
            className="inline-flex min-h-12 w-full min-w-[240px] items-center justify-center rounded-2xl bg-pink-500 px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_12px_30px_rgba(236,72,153,0.35)] transition hover:bg-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-300 focus:ring-offset-2 focus:ring-offset-[#020817] md:w-auto"
          >
            Claim launch pricing
          </Link>
        </div>
      </div>
    </section>
  );
}