import Link from "next/link";
import Image from "next/image";
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
};

const SOCIAL_LINKS = [
  { name: "X", href: "https://x.com/lvtchat", label: "Follow LVTChat on X", icon: "𝕏" },
  { name: "LinkedIn", href: "https://www.linkedin.com/company/lvtchat", label: "Follow LVTChat on LinkedIn", icon: "in" },
  { name: "YouTube", href: "https://www.youtube.com/@LVTChat", label: "Subscribe to LVTChat on YouTube", icon: "▶" },
  { name: "Facebook", href: "https://www.facebook.com/LVTChat", label: "Follow LVTChat on Facebook", icon: "f" },
] as const;

function FooterLink({ label, href, dark }: { readonly label: string; readonly href: string; readonly dark: boolean }) {
  const className = `group rounded-md text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${dark ? "focus:ring-offset-slate-950" : ""}`;
  const labelColor = dark ? "text-slate-300 group-hover:text-white group-focus-visible:text-white" : "text-slate-600 group-hover:text-blue-800 group-focus-visible:text-blue-800";
  return href.startsWith("/") ? <Link href={href} className={className}><span className={labelColor}>{label}</span></Link> : <a href={href} className={className}><span className={labelColor}>{label}</span></a>;
}

export default function Footer({ variant = "default" }: { readonly variant?: "default" | "dark" }) {
  const dark = variant === "dark";
  const showMobileMessage = BRAND.mobile.androidComingSoon || BRAND.mobile.iosComingSoon;
  const address = BRAND.contact.address;
  const legalLinkClassName = `group rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${dark ? "focus:ring-offset-slate-950" : "focus:ring-offset-white"}`;
  const legalLabelClassName = dark ? "text-slate-400 group-hover:text-white group-focus-visible:text-white" : "text-slate-500 group-hover:text-blue-800 group-focus-visible:text-blue-800";
  return (
    <footer className={`${dark ? "mx-auto max-w-[1360px] border-t border-white/10 bg-slate-950 text-white" : "rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-sm"} px-5 py-7 md:px-8`}>
      <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.25fr_repeat(3,minmax(0,1fr))]">
        <div>
          <Link href={BRAND.routes.home} aria-label={`${BRAND.name} home`} className={`inline-flex items-center gap-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${dark ? "focus:ring-offset-slate-950" : ""}`}>
            <Image src="/logos/logo-icon.svg" alt="" width={38} height={38} className="h-9 w-9 object-contain" />
            <span className={`text-xl font-extrabold ${dark ? "text-white" : "text-slate-950"}`}>{BRAND.name}</span>
          </Link>
          <p className={`mt-3 max-w-xs text-sm leading-6 ${dark ? "text-slate-300" : "text-slate-600"}`}>Practical AI for Work, Research, and Business Automation.</p>
          <address className={`mt-4 max-w-xs break-words text-xs not-italic leading-5 ${dark ? "text-slate-300" : "text-slate-600"}`}>
            <span className={`font-semibold ${dark ? "text-white" : "text-slate-950"}`}>Business Mailing Address</span>
            <br />{address.line1}
            <br />{address.line2}
            <br />{address.city}, {address.state} {address.postalCode}
            <br />{address.country}
          </address>
          {showMobileMessage && !dark ? <p className="mt-3 text-xs leading-5 text-slate-500">{BRAND.mobile.message}</p> : null}
          <nav className="mt-4" aria-label="LVTChat social media">
            <ul className="flex gap-2">
              {SOCIAL_LINKS.map((social) => <li key={social.name}><a href={social.href} target="_blank" rel="noopener noreferrer" aria-label={social.label} className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${dark ? "border-white/15 text-slate-200 hover:bg-white/10 focus:ring-offset-slate-950" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><span aria-hidden="true">{social.icon}</span></a></li>)}
            </ul>
          </nav>
        </div>
        {footerColumns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className={`text-sm font-bold ${dark ? "text-white" : "text-slate-950"}`}>{column.title}</h2>
            <ul className="mt-4 space-y-3">
              {column.links.map((label) => <li key={label}><FooterLink label={label} href={FOOTER_ROUTES[label] ?? BRAND.routes.home} dark={dark} /></li>)}
            </ul>
          </nav>
        ))}
      </div>
      <div className={`mt-7 flex flex-col gap-4 border-t pt-5 text-sm sm:flex-row sm:items-center sm:justify-between ${dark ? "border-white/10 text-slate-400" : "border-slate-200 text-slate-500"}`}>
        <p>© {new Date().getFullYear()} {BRAND.legalName}. {BRAND.legal.rightsText}</p>
        <nav aria-label="Legal"><ul className="flex gap-5"><li><Link href={BRAND.routes.privacy} className={legalLinkClassName}><span className={legalLabelClassName}>Privacy</span></Link></li><li><Link href={BRAND.routes.terms} className={legalLinkClassName}><span className={legalLabelClassName}>Terms</span></Link></li><li><a href={`mailto:${BRAND.contact.email}`} className={legalLinkClassName}><span className={legalLabelClassName}>Contact</span></a></li></ul></nav>
      </div>
    </footer>
  );
}
