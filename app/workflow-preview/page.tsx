import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import WorkflowPreview from "./WorkflowPreview";

export const metadata: Metadata = {
  title: "Illustrative CAPA Workflow Preview",
  description: "Explore a fictional six-stage example of quality signal review and CAPA drafting with human decision authority.",
  alternates: { canonical: "/workflow-preview" },
};

export default function WorkflowPreviewPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <section className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-800">Concept walkthrough</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">A human-led quality workflow, stage by stage.</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">See how an illustrative signal could be organized into a report, reviewed by a person, and prepared for controlled follow-up.</p>
          <div className="mt-9"><WorkflowPreview /></div>
        </div>
      </section>
      <div className="mx-auto max-w-[1440px] px-4 pb-5 sm:px-6 lg:px-8"><Footer /></div>
    </main>
  );
}
