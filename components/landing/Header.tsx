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

export default function Header() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 md:px-8">
      <Link
        href={BRAND.routes.home}
        aria-label={`${BRAND.name} home`}
        className="flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-400/60 bg-[linear-gradient(180deg,#0A1328,#101C39)] text-sm font-bold tracking-wide text-white shadow-[0_0_24px_rgba(59,130,246,0.18)]">
          {BRAND.shortName}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight text-white">
            {BRAND.name}
          </span>

          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
            Live
          </span>
        </div>
      </Link>

      <nav
        aria-label="Primary navigation"
        className="hidden items-center gap-7 text-sm text-white/70 md:flex"
      >
        {navItems.map((item) => {
          const href = NAV_ROUTES[item] ?? "#";

          if (href.startsWith("/")) {
            return (
              <Link
                key={item}
                href={href}
                className="rounded-md transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
              >
                {item}
              </Link>
            );
          }

          return (
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

      <div className="flex items-center gap-3">
        <Link
          href={`${BRAND.routes.pricing}?promo=MOTHERSDAY`}
          className="hidden rounded-full border border-pink-400/30 bg-pink-500/10 px-3 py-2 text-xs font-semibold text-pink-200 transition hover:bg-pink-500/20 focus:outline-none focus:ring-2 focus:ring-pink-300 focus:ring-offset-2 focus:ring-offset-[#020817] sm:inline-flex"
        >
          Mother&apos;s Day Launch
        </Link>

        <Link
          href={BRAND.routes.login}
          className="rounded-xl bg-[linear-gradient(90deg,#3B82F6,#4F8CFF)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(59,130,246,0.35)] transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
        >
          Get Started
        </Link>
      </div>
    </header>
  );
}