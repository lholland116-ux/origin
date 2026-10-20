import type { Metadata } from "next";
import Image from "next/image";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import FounderContactCard from "@/components/marketing/FounderContactCard";
import { BRAND } from "@/lib/branding";

export const metadata: Metadata = {
  title: "About Founder Levi Holland",
  description: "Meet LVTChat LLC founder Levi Holland and learn about the practical, human-reviewed AI workflow vision for manufacturing quality and business.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <section className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-blue-800">About LVTChat LLC</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">Practical AI you can actually use.</h1>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="space-y-4 text-base leading-7 text-slate-600">
              <p>LVTChat combines general-purpose AI tools available today with purpose-built workflow automation in development, initially focused on manufacturing quality.</p>
              <p>The goal is to help businesses analyze information, identify problems, prepare reports, and move work forward while keeping qualified people responsible for decisions and controlled records.</p>
              <p>Founder Levi Holland brings more than 25 years of regulated-industry experience across pharmaceutical, biotechnology, medical-device, engineering, validation, quality-system, and regulatory work.</p>
              <p>That experience informs a product direction centered on clear evidence, traceability, practical workflows, and human oversight. Developing workflow features are not represented as validated production automation, regulatory certification, or guaranteed compliance.</p>
            </div>
            <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
              <Image src="/images/founder/levi-holland-portrait.png" alt="Levi Holland, founder of LVTChat LLC" width={560} height={700} priority sizes="(min-width: 1024px) 384px, 90vw" className="aspect-[4/5] w-full rounded-2xl object-cover object-center" />
            </div>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {["25+ years in regulated industries", "Pharmaceutical and biotechnology", "Medical-device, engineering, validation, and regulatory work"].map((item) => <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm font-semibold leading-6 text-slate-800 shadow-sm">{item}</div>)}
          </div>
          <div className="mt-10"><FounderContactCard /></div>
          <p className="mt-7 text-sm text-slate-600">For customer support, contact <a className="font-semibold text-blue-800 underline underline-offset-4" href={`mailto:${BRAND.contact.email}`}><span className="text-blue-800">{BRAND.contact.email}</span></a>.</p>
        </div>
      </section>
      <div className="bg-slate-950 px-4 py-6 sm:px-8"><Footer variant="dark" /></div>
    </main>
  );
}
