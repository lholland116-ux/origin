"use client";

import { useEffect, useState } from "react";
import type { CapaInvestigationPlanContent, CapaInvestigationPlanItemStatus } from "../../lib/capa/domain/capa-investigation-plan";
import { createInvestigationProgressAttempt, emptyInvestigationProgressForm, submitInvestigationProgressAttempt,
  type InvestigationProgressAttempt } from "./capa-investigation-progress-client";

const CONTROLLED_CODE = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const terminal = new Set<CapaInvestigationPlanItemStatus>(["completed", "dispositioned", "cancelled"]);
const labels: Record<CapaInvestigationPlanItemStatus, string> = {
  planned: "Planned", in_progress: "In progress", completed: "Completed",
  dispositioned: "Dispositioned", cancelled: "Cancelled",
};
const identity = (id: string | null) => id === null ? "Not assigned" : `Participant …${id.slice(-8)}`;

export default function CapaInvestigationProgressPanel({ caseId, plan, recordVersion, currentVersionId,
  readOnly = false, onAuthoritativeRefresh }: {
  readonly caseId: string; readonly plan: CapaInvestigationPlanContent; readonly recordVersion: number;
  readonly currentVersionId: string; readonly readOnly?: boolean;
  readonly onAuthoritativeRefresh: () => Promise<void>;
}) {
  const [action, setAction] = useState<{ itemId: string; status: "dispositioned" | "cancelled" } | null>(null);
  const [disposition, setDisposition] = useState("");
  const [rationale, setRationale] = useState("");
  const [attempt, setAttempt] = useState<InvestigationProgressAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  useEffect(() => { const empty = emptyInvestigationProgressForm(); setAction(null); setDisposition(empty.disposition); setRationale(empty.rationale); setAttempt(null); }, [caseId, readOnly]);

  const clearAction = () => { setAction(null); setDisposition(""); setRationale(""); };
  async function submit(target: InvestigationProgressAttempt) {
    setSubmitting(true); setError(null); setReasons([]);
    const result = await submitInvestigationProgressAttempt(target);
    if (result.status === "updated") {
      setAttempt(null); clearAction();
      await onAuthoritativeRefresh();
    } else {
      setError(result.message); setReasons(result.reasons);
      if (result.requiresRefresh) {
        setAttempt(null); clearAction();
        await onAuthoritativeRefresh();
      } else if (!result.retryableExact) setAttempt(null);
    }
    setSubmitting(false);
  }
  function begin(itemId: string, status: CapaInvestigationPlanItemStatus,
    code: string | null = null, reason: string | null = null) {
    const next = createInvestigationProgressAttempt({ caseId, recordVersion, currentVersionId, itemId,
      newStatus: status, disposition: code, dispositionRationale: reason, idempotencyKey: crypto.randomUUID() });
    if (next === null) { setError("The investigation-progress request is incomplete."); return; }
    setAttempt(next); void submit(next);
  }

  const byId = new Map(plan.items.map((item) => [item.item_id, item]));
  return <section aria-labelledby="investigation-progress-heading" className="rounded-3xl border border-emerald-400/20 bg-emerald-500/[0.05] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Authoritative released plan</p>
    <h2 id="investigation-progress-heading" className="mt-2 text-2xl font-semibold">Investigation Plan</h2>
    <p className="mt-2 text-sm text-zinc-400">Plan details are read-only. {readOnly ? "This submitted plan is shown for review." : "Only controlled progress actions create a new S40 revision."}</p>
    {error ? <div role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">
      <p>{error}</p>{reasons.length ? <ul className="mt-2 list-disc pl-5">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      {attempt ? <button type="button" disabled={submitting} className="mt-2 underline" onClick={() => void submit(attempt)}>Retry exact request</button> : null}
    </div> : null}
    <div className="mt-5 space-y-4">{plan.items.map((item, index) => {
      const blocked = item.dependency_item_ids.map((id) => byId.get(id)).filter((dependency) => dependency && !terminal.has(dependency.status));
      const canStartOrComplete = blocked.length === 0;
      const activeAction = action?.itemId === item.item_id ? action : null;
      return <article key={item.item_id} className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Item {index + 1}: {item.item_id}</h3>
          <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs">{labels[item.status]}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-zinc-500">Investigation question</dt><dd>{item.investigation_question ?? "Not recorded"}</dd></div>
          <div><dt className="text-zinc-500">Evidence target</dt><dd>{item.evidence_target ?? "Not recorded"}</dd></div>
          <div><dt className="text-zinc-500">Investigation method</dt><dd>{item.investigation_method ?? "Not recorded"}</dd></div>
          <div><dt className="text-zinc-500">Owner</dt><dd>{identity(item.owner_user_id)}</dd></div>
          <div><dt className="text-zinc-500">Due date</dt><dd>{item.due_date ?? "Not recorded"}</dd></div>
          <div><dt className="text-zinc-500">SMEs</dt><dd>{item.sme_user_ids.length ? item.sme_user_ids.map(identity).join(", ") : "None"}</dd></div>
          <div><dt className="text-zinc-500">Dependencies</dt><dd>{item.dependency_item_ids.length ? item.dependency_item_ids.map((id) => `${id} (${labels[byId.get(id)?.status ?? "planned"]})`).join(", ") : "None"}</dd></div>
          <div><dt className="text-zinc-500">Scope relationship</dt><dd>{item.scope_relationship ?? "Not recorded"}</dd></div>
          {item.disposition ? <div><dt className="text-zinc-500">Disposition</dt><dd>{item.disposition}</dd></div> : null}
          {item.disposition_rationale ? <div><dt className="text-zinc-500">Disposition rationale</dt><dd>{item.disposition_rationale}</dd></div> : null}
        </dl>
        {!readOnly && !terminal.has(item.status) ? <div className="mt-4">
          {!canStartOrComplete ? <p className="mb-3 text-sm text-amber-300">Start and Complete are blocked by {blocked.map((entry) => `${entry!.item_id} (${labels[entry!.status]})`).join(", ")}.</p> : null}
          <div className="flex flex-wrap gap-2">
            {item.status === "planned" ? <button type="button" disabled={submitting || !canStartOrComplete} onClick={() => { clearAction(); begin(item.item_id, "in_progress"); }} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40">Start</button> : null}
            <button type="button" disabled={submitting || !canStartOrComplete} onClick={() => { clearAction(); begin(item.item_id, "completed"); }} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm disabled:opacity-40">Complete</button>
            {(["dispositioned", "cancelled"] as const).map((status) => <button key={status} type="button" disabled={submitting}
              onClick={() => { setAttempt(null); setError(null); setDisposition(""); setRationale(""); setAction({ itemId: item.item_id, status }); }}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm">{status === "dispositioned" ? "Disposition" : "Cancel"}</button>)}
          </div>
          {activeAction ? <div className="mt-4 rounded-xl border border-zinc-700 p-4">
            <h4 className="font-medium">{activeAction.status === "dispositioned" ? "Disposition item" : "Cancel item"}</h4>
            <label className="mt-3 block text-sm">Disposition code<input value={disposition} onChange={(event) => setDisposition(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" /></label>
            <label className="mt-3 block text-sm">Rationale<textarea value={rationale} onChange={(event) => setRationale(event.target.value)}
              className="mt-1 min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
            <div className="mt-3 flex justify-end gap-3"><button type="button" onClick={clearAction}>Close</button>
              <button type="button" disabled={submitting || !CONTROLLED_CODE.test(disposition) || !rationale.trim()}
                onClick={() => begin(item.item_id, activeAction.status, disposition, rationale.trim())}
                className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-40">Record action</button></div>
          </div> : null}
        </div> : null}
      </article>;
    })}</div>
  </section>;
}
