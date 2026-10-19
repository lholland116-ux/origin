import Link from "next/link";
import { BRAND } from "@/lib/branding";

const WORKFLOW_PREVIEW = ["Analyze information", "Identify signals", "Prepare reports", "Human review"] as const;

export default function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="grid gap-12 px-5 pb-12 pt-12 md:px-8 md:pb-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-12 lg:pt-16">
      <div className="max-w-3xl">
        <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-blue-800">
          AI workflow automation for manufacturing quality—and beyond
        </p>
        <h1 id="hero-heading" className="mt-6 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-[3.6rem] lg:leading-[1.08]">
          Move complex work forward with practical AI and human oversight.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          {BRAND.name} is building intelligent workflows that help businesses analyze information, identify problems, generate reports, and move work forward—with qualified people retaining decision authority.
        </p>
        <p className="mt-4 text-sm font-semibold text-blue-800">Practical AI you can actually use.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/request?interest=early_access&source=homepage" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">
            Request Early Access
          </Link>
          <Link href="/workflow-preview" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">
            Explore Workflow Preview
          </Link>
          <Link href={BRAND.routes.login} className="inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">
            Try LVTChat Free
          </Link>
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-slate-500">
          Workflow automation is in development and available by request for early discussion. Current LVTChat chat, document, image, and web-search tools are available separately.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Founded by Levi Holland, drawing on 25+ years across regulated industries. <Link href="/about" className="font-semibold text-blue-800 underline underline-offset-4">Meet the founder</Link>
        </p>
      </div>

      <div className="mx-auto w-full max-w-xl">
        <div className="rounded-[28px] border border-slate-200 bg-slate-950 p-4 shadow-[0_30px_90px_rgba(15,23,42,0.2)] sm:p-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Workflow concept</p>
              <h2 className="mt-1 text-base font-semibold text-white">From information to reviewed next steps</h2>
            </div>
            <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200">In development</span>
          </div>
          <ol className="mt-5 space-y-3">
            {WORKFLOW_PREVIEW.map((step, index) => (
              <li key={step} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-sm font-bold text-blue-200">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{step}</p>
                  <p className="mt-1 text-xs text-slate-400">Illustrative workflow stage</p>
                </div>
                {index < WORKFLOW_PREVIEW.length - 1 ? <span aria-hidden="true" className="text-blue-300">→</span> : <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-200">Human-led</span>}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs leading-5 text-slate-400">Concept illustration only. No customer records or live CAPA operations are used in this preview.</p>
          <Link href="/workflow-preview" className="mt-4 inline-flex text-sm font-semibold text-blue-200 underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-blue-300">View the six-stage preview</Link>
        </div>
      </div>
    </section>
  );
}
