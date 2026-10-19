"use client";

import { useState } from "react";
import { CAPA_WORKFLOW_PREVIEW_STAGES, WORKFLOW_PREVIEW_NOTICE } from "@/lib/marketing/workflow-preview";

export default function WorkflowPreview() {
  const [selected, setSelected] = useState(0);
  const stage = CAPA_WORKFLOW_PREVIEW_STAGES[selected]!;
  return (
    <section aria-labelledby="preview-heading" className="mx-auto max-w-6xl">
      <div role="note" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">{WORKFLOW_PREVIEW_NOTICE}</div>
      <p className="mt-5 text-sm leading-6 text-slate-600">This interactive example uses fictional manufacturing data. It has no connection to production CAPA records, customer accounts, workflow execution, or uploaded customer files.</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
        <nav aria-label="Illustrative CAPA workflow stages" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {CAPA_WORKFLOW_PREVIEW_STAGES.map((item, index) => (
            <button key={item.key} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${selected === index ? "border-blue-700 bg-blue-50 text-blue-950" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs">{index + 1}</span>
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
        <article aria-live="polite" aria-atomic="true" className="min-h-72 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-800">Stage {selected + 1} of {CAPA_WORKFLOW_PREVIEW_STAGES.length}</p>
          <h2 id="preview-heading" className="mt-3 text-2xl font-bold text-slate-950">{stage.title}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">{stage.summary}</p>
          <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-5">
            <h3 className="text-sm font-semibold text-blue-950">{stage.outputLabel}</h3>
            <p className="mt-2 text-sm leading-7 text-slate-800">{stage.output}</p>
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">Illustrative only. This is not validated production automation, regulatory certification, or a compliance guarantee. Qualified humans retain decision authority.</p>
        </article>
      </div>
    </section>
  );
}
