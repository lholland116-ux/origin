import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { BRAND } from "@/lib/branding";

const PLANNED_OUTCOMES = [
  "Find patterns for review",
  "Prepare evidence-linked reports",
  "Support structured investigations",
  "Keep people in control",
] as const;

export default function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate overflow-hidden bg-slate-100"
    >
      <div className="absolute inset-0 z-0">
        <Image
          src="/images/marketing/manufacturing-quality-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[62%_center]"
        />
      </div>
      <div className="absolute inset-0 z-[1] bg-gradient-to-r from-white/95 via-white/75 to-white/20 md:from-white/95 md:via-white/75 md:to-transparent" />
      <div className="absolute inset-0 z-[1] bg-gradient-to-t from-white/20 via-transparent to-white/5 md:hidden" />

      <div className="relative z-10 mx-auto grid min-h-[650px] max-w-[1440px] gap-8 px-5 py-10 sm:px-8 sm:py-12 md:min-h-[510px] md:grid-cols-[minmax(0,1fr)_300px] md:items-center md:px-10 lg:min-h-[500px] lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12 lg:px-14">
        <div className="max-w-[800px]">
          <h1 id="hero-heading" className="text-[2.65rem] font-extrabold leading-[1.02] tracking-tight text-slate-950 sm:text-5xl lg:text-[3.4rem]">
            <span className="block text-blue-700">AI Workflow Automation</span>
            <span className="mt-1 block">for Manufacturing Quality—</span>
            <span className="block">and Beyond.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg sm:leading-8">
            LVTChat is building intelligent workflows that help businesses analyze information, identify problems, generate reports, and move work forward with human oversight.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/request?interest=early_access&source=homepage"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-md shadow-blue-950/15 transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
            >
              <span className="text-white">Request Early Access</span> <ArrowRight aria-hidden="true" className="text-white" size={17} />
            </Link>
            <Link
              href="/workflow-preview"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blue-300 bg-white/90 px-5 py-3 text-sm font-bold text-blue-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
            >
              <span className="text-blue-800">Explore Workflow Preview</span>
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="font-semibold text-slate-900">Need AI help today?</span>
            <Link
              href={BRAND.routes.login}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-300 bg-white/90 px-4 py-2 font-semibold text-blue-800 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
            >
              <span className="text-blue-800">Try LVTChat Free</span> <ArrowRight aria-hidden="true" className="text-blue-800" size={15} />
            </Link>
          </div>
          <p className="mt-4 max-w-2xl text-xs leading-5 text-slate-700">
            Purpose-built Workflow Automation is in development. Current AI Assistant tools are available separately under Free and Pro plans.
          </p>
        </div>

        <aside className="rounded-2xl border border-white/20 bg-slate-950/90 p-5 text-white shadow-2xl shadow-slate-950/25 backdrop-blur-sm sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-200">Workflow concept</p>
          <h2 className="mt-2 text-xl font-bold leading-tight sm:text-2xl">Turn quality data into reviewed next steps.</h2>
          <ul className="mt-5 space-y-3">
            {PLANNED_OUTCOMES.map((outcome) => (
              <li key={outcome} className="flex items-start gap-2.5 text-sm leading-5 text-slate-100">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check aria-hidden="true" size={13} strokeWidth={3} />
                </span>
                {outcome}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center gap-3 border-t border-white/15 pt-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-blue-100">
              <ShieldCheck aria-hidden="true" size={22} />
            </span>
            <p className="text-xs leading-5 text-slate-200">Designed for traceable review, with qualified people retaining decision authority.</p>
          </div>
          <p className="mt-3 text-[11px] leading-4 text-slate-400">Illustrative direction only · customer-facing workflow execution is in development.</p>
        </aside>
      </div>
    </section>
  );
}
