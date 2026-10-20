import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: "AI Workflow Automation for Manufacturing Quality",
  description: "Learn about LVTChat's developing human-reviewed workflow automation for manufacturing quality and business processes.",
  alternates: { canonical: "/workflow-automation" },
  openGraph: {
    title: "AI Workflow Automation for Manufacturing Quality | LVTChat",
    description: "Human-reviewed workflow concepts for analyzing information, surfacing signals, preparing reports, and moving work forward.",
    url: "https://lvtchat.com/workflow-automation",
    type: "website",
  },
};

const WORKFLOW_GOALS = [
  { title: "Bring information together", text: "Organize selected business information and make its context easier for people to review." },
  { title: "Surface patterns for review", text: "Help teams examine mapped data and distinguish deterministic observations from advisory interpretation." },
  { title: "Prepare traceable drafts", text: "Support report and draft preparation with source context, explicit limitations, and human checkpoints." },
] as const;

export default function WorkflowAutomationPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <section className="relative overflow-hidden border-b border-blue-100 bg-gradient-to-br from-white via-blue-50 to-slate-100 px-4 py-14 text-slate-950 sm:px-6 sm:py-20">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(37,99,235,0.10),transparent_48%)]" />
        <div className="relative mx-auto max-w-6xl">
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-blue-900">Workflow Automation · Early Access</p>
          <h1 className="mt-6 max-w-4xl text-4xl font-bold tracking-tight sm:text-6xl">AI Workflow Automation for Manufacturing Quality—and Beyond.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-700">LVTChat is building intelligent workflows that help businesses analyze information, identify problems, generate reports, and move work forward with human oversight.</p>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-slate-600">These specialized workflows are in development. They are not being represented as generally available, validated production automation, regulatory certification, or guaranteed compliance.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/request?interest=demo&source=workflow_automation" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"><span className="text-white">Request Demo</span></Link>
            <Link href="/request?interest=early_access&source=workflow_automation" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"><span className="text-slate-800">Request Early Access</span></Link>
            <Link href="/workflow-preview" className="inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-blue-800 underline underline-offset-4 hover:text-blue-950 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"><span className="text-blue-800">Explore Illustrative Preview</span></Link>
          </div>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-blue-800">Designed to support people</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">Workflow goals, with human review built into the concept.</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">Potential applications include quality-data review, evidence organization, investigation support, and report drafting. Suitability depends on each organization&apos;s process, data, and controls.</p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {WORKFLOW_GOALS.map((goal) => <article key={goal.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-lg font-semibold">{goal.title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{goal.text}</p></article>)}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2">
          <article className="rounded-3xl border border-blue-100 bg-blue-50 p-6 sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Available today</p>
            <h2 className="mt-3 text-2xl font-bold">General-purpose LVTChat</h2>
            <p className="mt-4 text-sm leading-7 text-slate-700">The current LVTChat product supports general AI conversations, Web Search, supported document analysis, image capabilities, Voice Input, Read Aloud, and Android access under existing plan limits.</p>
            <Link href="/pricing" className="mt-5 inline-flex font-semibold text-blue-800 underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-blue-600"><span className="text-blue-800">See current plans</span></Link>
          </article>
          <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-900">In development</p>
            <h2 className="mt-3 text-2xl font-bold">Purpose-built workflow automation</h2>
            <p className="mt-4 text-sm leading-7 text-slate-700">Quality-intelligence and CAPA-related workflow concepts are being developed with source traceability and explicit human review. The preview is illustrative; customer-facing execution is still in development.</p>
            <p className="mt-4 text-sm font-medium text-slate-800">Qualified humans retain authority for controlled decisions, approvals, dispositions, and regulated records.</p>
          </article>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 rounded-3xl border border-blue-200 bg-blue-50 p-6 text-slate-950 sm:p-10 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-2xl font-bold">Tell us what your team needs to move forward.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-700">Request a conversation about your workflow, integrations, and requirements.</p></div>
          <Link href="/request?interest=demo&source=workflow_automation" className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"><span className="text-white">Request Demo</span></Link>
        </div>
      </section>
      <div className="bg-slate-950 px-4 py-6 sm:px-8"><Footer variant="dark" /></div>
    </main>
  );
}
