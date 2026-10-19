import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

export default function FounderContactCard() {
  return (
    <section aria-labelledby="founder-card-heading" className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-800">Founder &amp; Business Contact</p>
        <h2 id="founder-card-heading" className="mt-3 text-2xl font-bold text-slate-950">Levi Holland</h2>
        <p className="mt-1 text-sm text-slate-600">Founder, LVTChat LLC · AI Engineer · Scientist</p>
        <dl className="mt-5 space-y-3 text-sm">
          <div><dt className="font-semibold text-slate-800">Business email</dt><dd className="mt-1"><a className="text-blue-800 underline underline-offset-4" href={`mailto:${BRAND.contact.founderEmail}`}>{BRAND.contact.founderEmail}</a></dd></div>
          <div><dt className="font-semibold text-slate-800">Website</dt><dd className="mt-1"><a className="text-blue-800 underline underline-offset-4" href={BRAND.url}>{BRAND.url}</a></dd></div>
          <div><dt className="font-semibold text-slate-800">LinkedIn</dt><dd className="mt-1"><a className="text-blue-800 underline underline-offset-4" href={BRAND.contact.linkedinUrl} target="_blank" rel="noopener noreferrer">LVTChat company profile<span className="sr-only"> (opens in a new tab)</span></a></dd></div>
        </dl>
        <Link href="/levi-holland.vcf" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2" download>Save Contact (.vcf)</Link>
      </div>
      <div className="flex flex-col items-center gap-2 sm:items-end">
        <Link href="/levi" aria-label="Open LVTChat founder digital contact card" className="rounded-2xl border border-slate-200 bg-white p-2 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">
          <Image src="/qr-lvtchat.png" alt="QR code linking to the LVTChat digital contact page" width={144} height={144} />
        </Link>
        <p className="text-xs text-slate-500">Scan to open the digital contact page</p>
      </div>
    </section>
  );
}
