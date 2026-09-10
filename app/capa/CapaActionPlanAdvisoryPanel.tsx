"use client";

import { useState } from "react";
import { generateActionPlanAdvisory, type CapaActionPlanAdvisoryResult } from "./capa-action-plan-advisory-client";
import type { CapaActionPlanAdvisoryActionCandidate } from "../../lib/capa/ai/capa-action-plan-advisory-contract";

interface CapaActionPlanAdvisoryPanelProps {
  readonly caseId: string;
  readonly caseVersionId: string;
  readonly recordVersion: number;
  readonly onAdoptCandidate: (candidate: CapaActionPlanAdvisoryActionCandidate) => string | null;
  readonly onAdoptEffectivenessPlanning: (candidate: CapaActionPlanAdvisoryActionCandidate, actionItemId: string) => boolean;
}

export default function CapaActionPlanAdvisoryPanel({ caseId, caseVersionId, recordVersion, onAdoptCandidate, onAdoptEffectivenessPlanning }: CapaActionPlanAdvisoryPanelProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "failed">("idle");
  const [result, setResult] = useState<CapaActionPlanAdvisoryResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adoptedActionIds, setAdoptedActionIds] = useState<Readonly<Record<string, string>>>({});
  const [adoptedEffectiveness, setAdoptedEffectiveness] = useState<ReadonlySet<string>>(() => new Set());

  async function generate() {
    setStatus("loading"); setMessage(null);
    const next = await generateActionPlanAdvisory(caseId, caseVersionId, recordVersion);
    if (next.status === "failed") { setStatus("failed"); setMessage(next.message); return; }
    setResult(next.value); setAdoptedActionIds({}); setAdoptedEffectiveness(new Set()); setStatus("success");
  }

  function adoptCandidate(candidate: CapaActionPlanAdvisoryActionCandidate) {
    const actionItemId = onAdoptCandidate(candidate);
    if (actionItemId === null) { setMessage("This suggestion could not be adopted into the current local draft."); return; }
    setAdoptedActionIds((current) => ({ ...current, [candidate.suggestion_key]: actionItemId }));
    setMessage("Suggestion adopted into the local draft. Save the Action Planning draft to persist it.");
  }

  function adoptEffectivenessPlanning(candidate: CapaActionPlanAdvisoryActionCandidate) {
    const actionItemId = adoptedActionIds[candidate.suggestion_key];
    if (actionItemId === undefined || !onAdoptEffectivenessPlanning(candidate, actionItemId)) { setMessage("Effectiveness planning could not be adopted into the current local draft."); return; }
    setAdoptedEffectiveness((current) => new Set([...current, candidate.suggestion_key]));
    setMessage("Effectiveness planning adopted into the local draft. Save the Action Planning draft to persist it.");
  }

  return <section aria-labelledby="action-plan-advisory-heading" className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-500/[0.05] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">AG-ACTION · GOVERNED AI ADVISORY</p><h3 id="action-plan-advisory-heading" className="mt-1 text-lg font-semibold text-zinc-100">Action-planning suggestions</h3></div><button type="button" onClick={() => void generate()} disabled={status === "loading"} className="rounded-xl border border-violet-300/30 px-4 py-2 text-sm text-violet-100 disabled:opacity-50">{status === "loading" ? "Generating…" : "Generate advisory"}</button></div><p className="mt-3 text-sm leading-6 text-zinc-400">Governed AI suggestions are for human review only. They do not approve, submit, assign, persist changes to, or replace the draft workspace. Adoption is deliberate and local until you save the draft.</p>{message !== null ? <p role="status" className="mt-4 text-sm text-amber-200">{message}</p> : null}{result !== null ? <div role="status" className="mt-5 space-y-4"><p className="text-sm text-zinc-200">{result.advisory.proposal.advisory_summary}</p>{result.advisory.proposal.completeness_linkage_concerns.length > 0 ? <div><p className="font-semibold text-zinc-200">Completeness and linkage concerns</p><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-zinc-400">{result.advisory.proposal.completeness_linkage_concerns.map((item) => <li key={item.concern_key}>{item.description} <span className="text-zinc-500">({item.human_review_question})</span></li>)}</ul></div> : null}{result.advisory.proposal.action_candidates.length > 0 ? <div><p className="font-semibold text-zinc-200">Adoptable action suggestions</p><div className="mt-2 space-y-3">{result.advisory.proposal.action_candidates.map((candidate) => { const adoptedActionId = adoptedActionIds[candidate.suggestion_key]; const effectivenessAdopted = adoptedEffectiveness.has(candidate.suggestion_key); return <article key={candidate.suggestion_key} className="rounded-xl border border-violet-300/20 bg-zinc-950/30 p-3"><p className="text-sm font-semibold text-zinc-100">{candidate.action_type}: {candidate.description}</p><p className="mt-2 text-sm text-zinc-400">Deliverable: {candidate.deliverable}</p><p className="mt-1 text-sm text-zinc-400">Implementation evidence: {candidate.implementation_evidence}</p><p className="mt-1 text-sm text-zinc-400">Unintended consequence assessment: {candidate.unintended_consequence_assessment}</p><ul className="mt-2 list-disc pl-5 text-sm text-zinc-400">{candidate.linked_targets.map((target) => <li key={`${target.target_type}:${target.target_id}`}>{target.target_type}: {target.target_id} — {target.rationale}</li>)}</ul><p className="mt-2 text-xs text-zinc-500">{candidate.human_review_question}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={adoptedActionId !== undefined} onClick={() => adoptCandidate(candidate)} className="min-h-10 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{adoptedActionId === undefined ? "Adopt into Action Plan" : "Adopted into local draft"}</button>{candidate.effectiveness_planning !== null ? <button type="button" disabled={adoptedActionId === undefined || effectivenessAdopted} onClick={() => adoptEffectivenessPlanning(candidate)} className="min-h-10 rounded-lg border border-violet-300/30 px-3 text-sm text-violet-100 disabled:opacity-50">{effectivenessAdopted ? "Effectiveness planning adopted" : "Adopt effectiveness planning"}</button> : null}</div>{candidate.effectiveness_planning !== null ? <p className="mt-2 text-xs text-zinc-400">Effectiveness recommendation: {candidate.effectiveness_planning.recommendation}</p> : null}</article>; })}</div></div> : null}{result.advisory.proposal.action_improvements.length > 0 ? <div><p className="font-semibold text-zinc-200">Action improvements</p><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-zinc-400">{result.advisory.proposal.action_improvements.map((item) => <li key={item.suggestion_key}>{item.recommendation} <span className="text-zinc-500">({item.human_review_question})</span></li>)}</ul></div> : null}{result.advisory.proposal.effectiveness_planning_improvements.length > 0 ? <div><p className="font-semibold text-zinc-200">Effectiveness planning</p><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-zinc-400">{result.advisory.proposal.effectiveness_planning_improvements.map((item) => <li key={item.suggestion_key}>{item.recommendation} <span className="text-zinc-500">({item.human_review_question})</span></li>)}</ul></div> : null}{result.advisory.uncertainty_and_limitations.length > 0 ? <p className="text-xs text-zinc-500">Limitations: {result.advisory.uncertainty_and_limitations.join(" ")}</p> : null}<p className="text-xs text-violet-200">Human review required. Nothing was saved automatically. Correlation: {result.correlation_id}</p></div> : null}</section>;
}
