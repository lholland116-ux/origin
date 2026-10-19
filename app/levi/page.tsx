import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

export const metadata: Metadata = {
  title: "Levi Holland Founder Contact Card",
  description: "Business contact card for Levi Holland, founder of LVTChat LLC.",
  alternates: { canonical: "/levi" },
};

export default function LeviPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-800">LVTChat LLC</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Levi Holland</h1>
        <p className="mt-2 text-sm font-medium text-slate-600">Founder · AI Engineer · Scientist</p>
        <p className="mt-4 text-sm leading-6 text-slate-600">25+ years of experience across regulated industries, including pharmaceuticals, biotechnology, medical devices, engineering, validation, and regulatory work.</p>
        <dl className="mt-7 w-full space-y-4 rounded-2xl bg-slate-50 p-5 text-left text-sm">
          <div><dt className="font-semibold text-slate-900">Business email</dt><dd className="mt-1"><a href={`mailto:${BRAND.contact.founderEmail}`} className="break-all text-blue-800 underline underline-offset-4">{BRAND.contact.founderEmail}</a></dd></div>
          <div><dt className="font-semibold text-slate-900">Website</dt><dd className="mt-1"><a href={BRAND.url} className="break-all text-blue-800 underline underline-offset-4">{BRAND.url}</a></dd></div>
          <div><dt className="font-semibold text-slate-900">LinkedIn</dt><dd className="mt-1"><a href={BRAND.contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-800 underline underline-offset-4">LVTChat company profile<span className="sr-only"> (opens in a new tab)</span></a></dd></div>
        </dl>
        <Link href="/levi-holland.vcf" download className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">Save Contact (.vcf)</Link>
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-2">
          <Image src="/qr-lvtchat.png" alt="QR code to open the LVTChat digital contact page" width={160} height={160} priority />
        </div>
        <p className="mt-2 text-xs text-slate-500">Scan to open this digital contact page</p>
        <Link href="/" className="mt-7 text-sm font-semibold text-blue-800 underline underline-offset-4">Visit LVTChat</Link>
      </section>
    </main>
  );
}
