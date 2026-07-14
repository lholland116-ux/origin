import Link from "next/link";
import { BRAND } from "@/lib/branding";
import { footerColumns } from "@/lib/landing-content";

const FOOTER_ROUTES: Readonly<Record<string, string>> = {
  Features: "#features",
  Pricing: BRAND.routes.pricing,
  About: BRAND.routes.about,
  Blog: BRAND.routes.blog,
  Contact: `mailto:${BRAND.contact.email}`,
  "Help Center": BRAND.routes.help,
};

const SOCIAL_LINKS = [
  {
    name: "X",
    href: "https://x.com/lvtchat",
    label: "Follow LVTChat on X",
    icon: "𝕏",
  },
  {
    name: "LinkedIn",
    href: "https://www.linkedin.com/company/lvtchat",
    label: "Follow LVTChat on LinkedIn",
    icon: "in",
  },
  {
    name: "YouTube",
    href: "https://www.youtube.com/@LVTChat",
    label: "Subscribe to LVTChat on YouTube",
    icon: "▶",
  },
  {
    name: "Facebook",
    href: "https://www.facebook.com/LVTChat",
    label: "Follow LVTChat on Facebook",
    icon: "f",
  },
] as const;

function isInternalRoute(href: string): boolean {
  return href.startsWith("/");
}

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const address = BRAND.contact.address;
  const showMobileMessage =
    BRAND.mobile.androidComingSoon || BRAND.mobile.iosComingSoon;

  return (
    <footer className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(5,10,22,0.98),rgba(3,7,18,0.98))] px-5 py-8 md:px-8 lg:px-10">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1fr]">
        <div>
          <Link
            href={BRAND.routes.home}
            aria-label={`${BRAND.name} home`}
            className="inline-flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/60 bg-[linear-gradient(180deg,#0A1328,#101C39)] text-sm font-bold tracking-wide text-white"
            >
              {BRAND.shortName}
            </span>

            <span className="text-lg font-semibold text-white">
              {BRAND.name}
            </span>
          </Link>

          <p className="mt-4 max-w-xs text-sm leading-7 text-white/60">
            {BRAND.tagline}
          </p>

          {showMobileMessage && (
            <p className="mt-4 max-w-xs rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium leading-6 text-emerald-200">
              <span aria-hidden="true">📱 </span>
              {BRAND.mobile.message}
            </p>
          )}

          <nav className="mt-5" aria-label={`${BRAND.name} social media`}>
            <ul className="flex items-center gap-4">
              {SOCIAL_LINKS.map((social) => (
                <li key={social.name}>
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={social.label}
                    title={social.name}
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-2 text-sm font-semibold text-white/65 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
                  >
                    <span aria-hidden="true">{social.icon}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {footerColumns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-sm font-semibold text-white">{column.title}</p>

            <ul className="mt-4 space-y-3 text-sm text-white/60">
              {column.links.map((link) => {
                const href = FOOTER_ROUTES[link] ?? "#";

                return (
                  <li key={link}>
                    {isInternalRoute(href) ? (
                      <Link
                        href={href}
                        className="rounded-md transition hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
                      >
                        {link}
                      </Link>
                    ) : (
                      <a
                        href={href}
                        className="rounded-md transition hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
                      >
                        {link}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        ))}

        <section aria-labelledby="footer-company-heading">
          <h2
            id="footer-company-heading"
            className="text-sm font-semibold text-white"
          >
            {BRAND.legalName}
          </h2>

          <p className="mt-4 text-sm leading-6 text-white/60">
            Practical AI for work, research, and everyday tasks.
          </p>

          <div className="mt-4 text-sm text-white/60">
            <a
              href={`mailto:${BRAND.contact.email}`}
              className="rounded-md transition hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
            >
              {BRAND.contact.email}
            </a>

            <address className="mt-3 not-italic leading-6 text-white/60">
              <div>{address.line1}</div>

              {address.line2 ? <div>{address.line2}</div> : null}

              <div>
                {address.city}, {address.state} {address.postalCode}
              </div>

              <div>{address.country}</div>
            </address>
          </div>
        </section>
      </div>

      <div className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-5 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {currentYear} {BRAND.legalName}. {BRAND.legal.rightsText}
        </p>

        <nav aria-label="Legal">
          <ul className="flex gap-5">
            <li>
              <Link
                href={BRAND.routes.privacy}
                className="rounded-md transition hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
              >
                Privacy
              </Link>
            </li>

            <li>
              <Link
                href={BRAND.routes.terms}
                className="rounded-md transition hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
              >
                Terms
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}