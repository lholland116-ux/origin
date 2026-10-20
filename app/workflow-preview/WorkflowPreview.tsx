"use client";

import { useState } from "react";
import { CAPA_WORKFLOW_PREVIEW_STAGES, WORKFLOW_PREVIEW_NOTICE } from "@/lib/marketing/workflow-preview";

export default function WorkflowPreview({ presentation = "full" }: { readonly presentation?: "full" | "homepage" }) {
  const homepage = presentation === "homepage";
  const [selected, setSelected] = useState(0);
  const stage = CAPA_WORKFLOW_PREVIEW_STAGES[selected]!;
  return (
    <section aria-labelledby="preview-heading" className={homepage ? "w-full" : "mx-auto max-w-6xl"}>
      {!homepage ? <>
        <div role="note" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">{WORKFLOW_PREVIEW_NOTICE}</div>
        <p className="mt-5 text-sm leading-6 text-slate-600">This interactive example uses fictional manufacturing data. It has no connection to production CAPA records, customer accounts, workflow execution, or uploaded customer files.</p>
      </> : null}
      <div className={`grid gap-4 ${homepage ? "lg:grid-cols-[0.78fr_1.22fr]" : "mt-8 gap-6 lg:grid-cols-[0.75fr_1.25fr]"}`}>
        <nav aria-label="Illustrative CAPA workflow stages" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {CAPA_WORKFLOW_PREVIEW_STAGES.map((item, index) => (
            <button key={item.key} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs font-semibold leading-4 transition focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 sm:min-h-12 sm:text-sm ${selected === index ? "border-blue-200 bg-blue-50 text-blue-950" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"}`}>
              <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${selected === index ? "bg-blue-100 text-blue-800" : "bg-white text-slate-500"}`}>{index + 1}.</span>
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
        <article aria-live="polite" aria-atomic="true" className="min-h-72 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-800">Stage {selected + 1} of {CAPA_WORKFLOW_PREVIEW_STAGES.length}</p>
          <h3 id="preview-heading" className="mt-2 text-lg font-bold leading-tight text-slate-950 sm:text-xl">{stage.title}</h3>
          <p className="mt-2 text-xs leading-5 text-slate-600">{stage.summary}</p>
          <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 sm:p-4">
            <h4 className="text-xs font-bold text-blue-950">{stage.outputLabel}</h4>
            <p className="mt-2 text-xs leading-5 text-slate-800">{stage.output}</p>
          </div>
          <p className="mt-3 text-[11px] leading-4 text-slate-500">Illustrative only. Not validated production automation or a compliance guarantee. Qualified humans retain decision authority.</p>
        </article>
      </div>
    </section>
  );
}
