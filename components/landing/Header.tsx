"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";
import { navItems } from "@/lib/landing-content";

const NAV_ROUTES = {
  Features: "#features",
  "Use Cases": "#use-cases",
  Pricing: BRAND.routes.pricing,
  About: BRAND.routes.about,
  Blog: BRAND.routes.blog,
} satisfies Record<string, string>;

function isInternalRoute(href: string): boolean {
  return href.startsWith("/");
}

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  function closeMobileMenu(): void {
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeMobileMenu();
        menuButtonRef.current?.focus();
      }
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target;

      if (
        target instanceof Node &&
        !mobileMenuRef.current?.contains(target) &&
        !menuButtonRef.current?.contains(target)
      ) {
        closeMobileMenu();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [mobileMenuOpen]);

  return (
    <header className="relative flex items-center justify-between gap-3 px-5 py-4 md:px-8">
      <Link
        href={BRAND.routes.home}
        aria-label={`${BRAND.name} home`}
        onClick={closeMobileMenu}
        className="flex shrink-0 items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-400/60 bg-[linear-gradient(180deg,#0A1328,#101C39)] text-sm font-bold tracking-wide text-white shadow-[0_0_24px_rgba(59,130,246,0.18)]"
        >
          {BRAND.shortName}
        </span>

        <span className="text-lg font-semibold tracking-tight text-white">
          {BRAND.name}
        </span>
      </Link>

      <nav
        aria-label="Primary navigation"
        className="hidden items-center gap-7 text-sm text-white/70 md:flex"
      >
        {navItems.map((item) => {
          const href = NAV_ROUTES[item] ?? "#";

          return isInternalRoute(href) ? (
            <Link
              key={item}
              href={href}
              className="rounded-md transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
            >
              {item}
            </Link>
          ) : (
            <a
              key={item}
              href={href}
              className="rounded-md transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
            >
              {item}
            </a>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <Link
          href={BRAND.routes.pricing}
          className="hidden rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/85 transition hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817] lg:inline-flex"
        >
          View Pricing
        </Link>

        <Link
          href={BRAND.routes.login}
          className="hidden rounded-xl bg-[linear-gradient(90deg,#3B82F6,#4F8CFF)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(59,130,246,0.35)] transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817] sm:inline-flex"
        >
          Get Started
        </Link>

        <button
          ref={menuButtonRef}
          type="button"
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMobileMenuOpen((current) => !current)}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817] md:hidden"
        >
          <span aria-hidden="true" className="mr-2 text-base">
            {mobileMenuOpen ? "✕" : "☰"}
          </span>
          {mobileMenuOpen ? "Close" : "Menu"}
        </button>
      </div>

      {mobileMenuOpen ? (
        <div
          ref={mobileMenuRef}
          id="mobile-navigation"
          className="absolute left-5 right-5 top-[calc(100%+0.25rem)] z-50 rounded-2xl border border-white/10 bg-[#071022]/[0.98] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur md:hidden"
        >
          <nav aria-label="Mobile navigation">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const href = NAV_ROUTES[item] ?? "#";
                const linkClassName =
                  "flex w-full rounded-xl px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40";

                return (
                  <li key={item}>
                    {isInternalRoute(href) ? (
                      <Link
                        href={href}
                        onClick={closeMobileMenu}
                        className={linkClassName}
                      >
                        {item}
                      </Link>
                    ) : (
                      <a
                        href={href}
                        onClick={closeMobileMenu}
                        className={linkClassName}
                      >
                        {item}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
              <Link
                href={BRAND.routes.pricing}
                onClick={closeMobileMenu}
                className="flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-white/40"
              >
                View Pricing
              </Link>

              <Link
                href={BRAND.routes.login}
                onClick={closeMobileMenu}
                className="flex items-center justify-center rounded-xl bg-[linear-gradient(90deg,#3B82F6,#4F8CFF)] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(59,130,246,0.28)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                Get Started
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}