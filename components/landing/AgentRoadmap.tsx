import Link from "next/link";

const DESIGN_GOALS = [
  { title: "Make quality information easier to review", body: "Bring structured records, source context, and clear data limitations into one review-oriented workflow." },
  { title: "Keep evidence traceable", body: "Keep findings connected to their source and distinguish observed data from interpretation." },
  { title: "Keep people in control", body: "Use AI for assistance while qualified humans retain authority for decisions and controlled records." },
] as const;

export default function AgentRoadmap() {
  return (
    <section id="workflow-automation" aria-labelledby="workflow-automation-heading" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-800">Workflow Automation · Early Access</p>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">In development</span>
        </div>
        <h2 id="workflow-automation-heading" className="mt-4 max-w-4xl text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Purpose-built workflows for manufacturing quality—and beyond.
        </h2>
        <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600">
          LVTChat is building workflow automation to help quality teams organize information, surface signals, prepare reports, and support human review. These workflows are developing and are not represented as generally available or validated for regulated use.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {DESIGN_GOALS.map((item) => (
            <article key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/workflow-automation" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">Explore Workflow Automation</Link>
          <Link href="/workflow-preview" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">View Illustrative Preview</Link>
          <Link href="/request?interest=early_access&source=homepage" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">Request Early Access</Link>
        </div>
      </div>
    </section>
  );
}
