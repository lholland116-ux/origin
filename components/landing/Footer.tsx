import { BRAND } from "@/lib/branding";
import { footerColumns, toId } from "@/lib/landing-content";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(5,10,22,0.98),rgba(3,7,18,0.98))] px-5 py-8 md:px-8 lg:px-10">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1fr]">
        <div>
          <a
            href="#top"
            aria-label={`${BRAND.name} home`}
            className="inline-flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/60 bg-[linear-gradient(180deg,#0A1328,#101C39)] text-sm font-bold tracking-wide text-white">
              {BRAND.shortName}
            </div>

            <span className="text-lg font-semibold text-white">
              {BRAND.name}
            </span>
          </a>

          <p className="mt-4 max-w-xs text-sm leading-7 text-white/60">
            {BRAND.tagline}
          </p>

          <div
            className="mt-5 flex items-center gap-4 text-white/65"
            aria-label="Social links"
          >
            <span aria-hidden="true">𝕏</span>
            <span aria-hidden="true">in</span>
            <span aria-hidden="true">▶</span>
            <span aria-hidden="true">◎</span>
          </div>
        </div>

        {footerColumns.map((column) => (
          <div key={column.title}>
            <p className="text-sm font-semibold text-white">{column.title}</p>

            <ul className="mt-4 space-y-3 text-sm text-white/60">
              {column.links.map((link) => (
                <li key={link}>
                  <a
                    href={`#${toId(link)}`}
                    className="rounded-md transition hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
                  >
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <p className="text-sm font-semibold text-white">Built by</p>
          <p className="mt-4 text-2xl font-semibold tracking-tight text-white">
            {BRAND.creator}
          </p>
          <p className="mt-2 text-sm text-white/60">{BRAND.creatorTitle}</p>
          <p className="mt-4 text-sm text-white/60">{BRAND.supportEmail}</p>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-5 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {currentYear} {BRAND.legalName}. All rights reserved.
        </p>

        <div className="flex gap-5">
          <a
            href="#privacy"
            className="rounded-md transition hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            Privacy
          </a>
          <a
            href="#terms"
            className="rounded-md transition hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
          >
            Terms
          </a>
        </div>
      </div>
    </footer>
  );
}