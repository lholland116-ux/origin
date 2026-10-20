import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BRAND } from "@/lib/branding";
import { WORKFLOW_PREVIEW_NOTICE } from "@/lib/marketing/workflow-preview";
import Footer from "@/components/landing/Footer";
import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import HomepageBenefits from "@/components/landing/HomepageBenefits";
import HomepageFounderLead from "@/components/landing/HomepageFounderLead";
import HomepageProductPanels from "@/components/landing/HomepageProductPanels";
import HomepageWorkflowStages from "@/components/landing/HomepageWorkflowStages";
import WorkflowPreview from "@/app/workflow-preview/WorkflowPreview";

export default function LandingPage() {
  return (
    <main id="top" aria-label={`${BRAND.name} landing page`} className="min-h-screen overflow-hidden bg-white text-slate-950">
      <Header variant="homepage" />
      <Hero />
      <HomepageWorkflowStages />

      <section id="capa-preview" aria-labelledby="home-workflow-preview-heading" className="px-4 py-4 sm:px-8 sm:py-5">
        <div className="mx-auto grid max-w-[1360px] items-center gap-6 rounded-2xl bg-slate-50 p-4 sm:p-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-8 lg:p-7">
          <div className="px-1 py-2 sm:px-3">
            <p className="inline-flex items-center rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">
              Illustrative Workflow Preview <span aria-hidden="true" className="ml-2">ⓘ</span>
            </p>
            <h2 id="home-workflow-preview-heading" className="mt-4 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
              Interactive CAPA Workflow Preview
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-700 sm:text-base sm:leading-7">
              Explore a sample six-stage workflow using fictional manufacturing data. See how information can be organized for analysis, reporting, human review, and controlled follow-up.
            </p>
            <p className="mt-3 max-w-xl text-xs leading-5 text-slate-600">{WORKFLOW_PREVIEW_NOTICE} Qualified humans retain decision authority.</p>
            <Link href="/workflow-preview" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2">
              <span className="text-white">Explore the CAPA Workflow Preview</span> <ArrowRight aria-hidden="true" className="text-white" size={16} />
            </Link>
          </div>
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <WorkflowPreview presentation="homepage" />
          </div>
        </div>
      </section>

      <HomepageProductPanels />
      <HomepageBenefits />
      <HomepageFounderLead />
      <div className="bg-slate-950 px-4 py-4 sm:px-8">
        <Footer variant="dark" />
      </div>
    </main>
  );
}
