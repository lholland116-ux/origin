import Link from "next/link";
import { BRAND } from "@/lib/branding";
import { footerColumns } from "@/lib/landing-content";

const FOOTER_ROUTES: Readonly<Record<string, string>> = {
  "Available today": "/#capabilities",
  "Workflow Automation": "/workflow-automation",
  "Workflow Preview": "/workflow-preview",
  Pricing: BRAND.routes.pricing,
  About: BRAND.routes.about,
  Blog: BRAND.routes.blog,
  "Request Demo": "/request?interest=demo&source=footer",
  "Request Early Access": "/request?interest=early_access&source=footer",
  "FAQ / Resources": BRAND.routes.help,
  Contact: `mailto:${BRAND.contact.email}`,
};

const SOCIAL_LINKS = [
  { name: "X", href: "https://x.com/lvtchat", label: "Follow LVTChat on X", icon: "𝕏" },
  { name: "LinkedIn", href: "https://www.linkedin.com/company/lvtchat", label: "Follow LVTChat on LinkedIn", icon: "in" },
  { name: "YouTube", href: "https://www.youtube.com/@LVTChat", label: "Subscribe to LVTChat on YouTube", icon: "▶" },
  { name: "Facebook", href: "https://www.facebook.com/LVTChat", label: "Follow LVTChat on Facebook", icon: "f" },
] as const;

function FooterLink({ label, href }: { readonly label: string; readonly href: string }) {
  const className = "rounded-md text-sm text-slate-600 transition hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2";
  return href.startsWith("/") ? <Link href={href} className={className}>{label}</Link> : <a href={href} className={className}>{label}</a>;
}

export default function Footer() {
  const showMobileMessage = BRAND.mobile.androidComingSoon || BRAND.mobile.iosComingSoon;
  return (
    <footer className="rounded-3xl border border-slate-200 bg-white px-5 py-8 shadow-sm md:px-8">
      <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.25fr_repeat(3,minmax(0,1fr))]">
        <div>
          <Link href={BRAND.routes.home} aria-label={`${BRAND.name} home`} className="inline-flex items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">{BRAND.shortName}</span>
            <span className="text-lg font-bold text-slate-950">{BRAND.name}</span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-6 text-slate-600">AI Workflow Automation for Manufacturing Quality—and Beyond.</p>
          {showMobileMessage ? <p className="mt-3 text-xs leading-5 text-slate-500">{BRAND.mobile.message}</p> : null}
          <nav className="mt-4" aria-label="LVTChat social media">
            <ul className="flex gap-2">
              {SOCIAL_LINKS.map((social) => <li key={social.name}><a href={social.href} target="_blank" rel="noopener noreferrer" aria-label={social.label} className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><span aria-hidden="true">{social.icon}</span></a></li>)}
            </ul>
          </nav>
        </div>
        {footerColumns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-sm font-bold text-slate-950">{column.title}</h2>
            <ul className="mt-4 space-y-3">
              {column.links.map((label) => <li key={label}><FooterLink label={label} href={FOOTER_ROUTES[label] ?? BRAND.routes.home} /></li>)}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-4 border-t border-slate-200 pt-5 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} {BRAND.legalName}. {BRAND.legal.rightsText}</p>
        <nav aria-label="Legal"><ul className="flex gap-5"><li><Link href={BRAND.routes.privacy} className="hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500">Privacy</Link></li><li><Link href={BRAND.routes.terms} className="hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500">Terms</Link></li><li><a href={`mailto:${BRAND.contact.email}`} className="hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500">Contact</a></li></ul></nav>
      </div>
    </footer>
  );
}
