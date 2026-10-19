"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/branding";
import { navItems } from "@/lib/landing-content";

const NAV_ROUTES: Readonly<Record<string, string>> = {
  Product: "/#capabilities",
  "Workflow Automation": "/workflow-automation",
  "Workflow Preview": "/workflow-preview",
  Pricing: BRAND.routes.pricing,
  "FAQ / Resources": BRAND.routes.help,
  About: BRAND.routes.about,
};

function NavLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <>
      {navItems.map((item) => (
        <Link
          key={item}
          href={NAV_ROUTES[item]}
          onClick={onNavigate}
          className="rounded-md text-sm text-slate-600 transition hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {item}
        </Link>
      ))}
    </>
  );
}

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  function closeMobileMenu(): void {
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeMobileMenu();
        menuButtonRef.current?.focus();
      }
    }
    function handlePointerDown(event: MouseEvent): void {
      if (event.target instanceof Node
        && !mobileMenuRef.current?.contains(event.target)
        && !menuButtonRef.current?.contains(event.target)) closeMobileMenu();
    }
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [mobileMenuOpen]);

  return (
    <header className="relative z-20 flex items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-5 py-4 backdrop-blur md:px-7">
      <Link
        href={BRAND.routes.home}
        aria-label={`${BRAND.name} home`}
        onClick={closeMobileMenu}
        className="flex shrink-0 items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold tracking-wide text-white shadow-sm">
          {BRAND.shortName}
        </span>
        <span className="text-lg font-bold tracking-tight text-slate-950">{BRAND.name}</span>
      </Link>

      <nav aria-label="Primary navigation" className="hidden items-center gap-3 xl:flex 2xl:gap-4">
        <NavLinks />
      </nav>

      <div className="hidden shrink-0 items-center gap-2 xl:flex">
        <Link href="/request?interest=demo&source=homepage" className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
          Request Demo
        </Link>
        <Link href={BRAND.routes.login} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
          Sign In
        </Link>
        <Link href={BRAND.routes.login} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
          Try LVTChat Free
        </Link>
      </div>

      <button
        ref={menuButtonRef}
        type="button"
        aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileMenuOpen}
        aria-controls="public-mobile-navigation"
        onClick={() => setMobileMenuOpen((current) => !current)}
        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 xl:hidden"
      >
        <span aria-hidden="true" className="mr-2">{mobileMenuOpen ? "✕" : "☰"}</span>
        {mobileMenuOpen ? "Close" : "Menu"}
      </button>

      {mobileMenuOpen ? (
        <div ref={mobileMenuRef} id="public-mobile-navigation" className="absolute inset-x-4 top-[calc(100%-1px)] z-50 rounded-b-2xl border border-slate-200 bg-white p-4 shadow-xl xl:hidden">
          <nav aria-label="Mobile navigation" className="grid gap-1">
            <NavLinks onNavigate={closeMobileMenu} />
            <div className="mt-3 grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-3">
              <Link href="/request?interest=demo&source=homepage" onClick={closeMobileMenu} className="rounded-lg border border-blue-200 px-3 py-2.5 text-center text-sm font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Request Demo</Link>
              <Link href={BRAND.routes.login} onClick={closeMobileMenu} className="rounded-lg border border-slate-200 px-3 py-2.5 text-center text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Sign In</Link>
              <Link href={BRAND.routes.login} onClick={closeMobileMenu} className="rounded-lg bg-blue-700 px-3 py-2.5 text-center text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500">Try LVTChat Free</Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
