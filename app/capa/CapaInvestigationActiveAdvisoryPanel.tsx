"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RootCauseLedgerDraft, RootCausePackageDraft } from "./capa-root-cause-draft";
import { buildCapaInvestigationActiveAdvisoryRequest, fetchCapaInvestigationActiveAdvisory, type CapaInvestigationActiveAdvisorySuccess } from "./capa-investigation-active-advisory-client";
import { createInvestigationActiveAdoptionAttempt, submitInvestigationActiveAdoptionAttempt, type InvestigationActiveAdoptionAttempt } from "./capa-investigation-active-adoption-client";
import type { CapaInvestigationActiveWorkspaceProjection } from "./capa-investigation-active-workspace-client";
import { buildCapaInvestigationActiveAdvisoryReview, updateCapaInvestigationActiveAdvisoryReviewCard, validateCapaInvestigationActiveAdvisorySelection, type CapaInvestigationActiveAdvisoryReviewCard, type CapaInvestigationActiveHumanCausalRole } from "./capa-investigation-active-advisory-review";

export interface CapaInvestigationActiveAdvisoryPanelProps {
  readonly caseId: string;
  readonly currentVersionId: string;
  readonly recordVersion: number;
  readonly ledger: RootCauseLedgerDraft;
  readonly rootPackage: RootCausePackageDraft;
  readonly currentUserId: string;
  readonly onApplyAdoptions: (records: readonly import("./capa-investigation-active-adoption-client").CapaInvestigationActiveAdoptionSafeRecord[], roles: Readonly<Record<string, CapaInvestigationActiveHumanCausalRole>>, workspace: CapaInvestigationActiveWorkspaceProjection) => void;
}
export interface InvestigationActiveAdoptionRetry {
  readonly attempt: InvestigationActiveAdoptionAttempt;
  readonly causalRoles: Readonly<Record<string, CapaInvestigationActiveHumanCausalRole>>;
}
/** Client-local role choices are frozen with the exact HTTP retry attempt. */
export function createInvestigationActiveAdoptionRetry(
  attempt: InvestigationActiveAdoptionAttempt,
  causalRoles: Readonly<Record<string, CapaInvestigationActiveHumanCausalRole>>,
): InvestigationActiveAdoptionRetry {
  return Object.freeze({ attempt, causalRoles: Object.freeze({ ...causalRoles }) });
}

const categoryLabel: Record<string, string> = { evidence_gap: "Evidence gaps", conflicting_information: "Conflicting information", assumption: "Assumptions", causal_hypothesis: "Causal hypotheses", alternative_hypothesis: "Alternative hypotheses", investigation_recommendation: "Investigation recommendations" };
const contentFields = (category: string): readonly string[] => category === "evidence_gap" ? ["gap", "why_it_matters", "recommended_next_step"] : category === "conflicting_information" ? ["conflict", "why_it_matters"] : category === "assumption" ? ["assumption", "verification_question"] : [category === "investigation_recommendation" ? "recommendation" : "hypothesis", "rationale"];
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function CapaInvestigationActiveAdvisoryPanel({ caseId, currentVersionId, recordVersion, ledger, rootPackage, currentUserId, onApplyAdoptions }: CapaInvestigationActiveAdvisoryPanelProps) {
  const [advisory, setAdvisory] = useState<CapaInvestigationActiveAdvisorySuccess | null>(null);
  const [cards, setCards] = useState<readonly CapaInvestigationActiveAdvisoryReviewCard[]>([]);
  const [requesting, setRequesting] = useState(false); const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState<InvestigationActiveAdoptionRetry | null>(null); const fingerprint = useMemo(() => JSON.stringify({ ledger, rootPackage }), [ledger, rootPackage]); const latest = useRef(fingerprint);
  useEffect(() => { latest.current = fingerprint; setAdvisory(null); setCards([]); setRetry(null); setError(null); }, [caseId, currentVersionId, recordVersion, fingerprint]);

  async function generate() {
    if (requesting || adopting || retry !== null) return; setRequesting(true); setError(null); setMessage(null);
    const result = await fetchCapaInvestigationActiveAdvisory(caseId, buildCapaInvestigationActiveAdvisoryRequest({ currentVersionId, recordVersion, ledger, rootCausePackage: rootPackage }));
    if (latest.current !== fingerprint) { setError("The local S40 draft changed while the advisory was generated. Generate a new advisory."); setRequesting(false); return; }
    if ("advisory" in result) { const built = buildCapaInvestigationActiveAdvisoryReview(result.advisory.proposal); if (built.valid) { setAdvisory(result); setCards(built.cards); } else setError(built.message); } else setError(result.message);
    setRequesting(false);
  }
  function update(key: string, changes: Partial<Pick<CapaInvestigationActiveAdvisoryReviewCard, "selected" | "humanCausalRole" | "adoptedContent">>) { if (retry === null) setCards((value) => updateCapaInvestigationActiveAdvisoryReviewCard(value, key, changes)); }
  async function adopt() {
    if (advisory === null || requesting || adopting) return;
    let localRetry = retry;
    if (localRetry === null) {
      let selection: ReturnType<typeof validateCapaInvestigationActiveAdvisorySelection>;
      try { selection = validateCapaInvestigationActiveAdvisorySelection(cards); } catch { setError("The selected proposal could not be prepared."); return; }
      if (!selection.valid) { setError(selection.message); return; }
      const attempt = createInvestigationActiveAdoptionAttempt({ caseId, currentVersionId, recordVersion, outputId: advisory.advisory.outputId, selectedItems: selection.selectedItems, selectedCategories: Object.fromEntries(cards.filter((card) => card.selected).map((card) => [card.proposalKey, card.category])), idempotencyKey: crypto.randomUUID(), currentUserId });
      if (attempt === null) { setError("The adoption request could not be prepared."); return; }
      localRetry = createInvestigationActiveAdoptionRetry(attempt, selection.causalRoles);
      setRetry(localRetry);
    }
    setAdopting(true); setError(null); const result = await submitInvestigationActiveAdoptionAttempt(localRetry.attempt);
    if (result.status === "adopted" || result.status === "already_adopted") { onApplyAdoptions(result.records, localRetry.causalRoles, result.workspace); setMessage(`${result.records.length} proposal${result.records.length === 1 ? "" : "s"} adopted into the durable S40 workspace.`); setAdvisory(null); setCards([]); setRetry(null); }
    else if (result.status === "failed") { setError(result.message); if (result.requiresRefresh) setMessage("Refresh the authoritative CAPA before retrying."); if (!result.retryableExact) setRetry(null); }
    setAdopting(false);
  }
  const grouped = useMemo(() => Object.fromEntries(Object.keys(categoryLabel).map((category) => [category, cards.filter((card) => card.category === category)])), [cards]);
  return <section aria-labelledby="investigation-active-advisory-heading" className="mt-7 rounded-2xl border border-sky-400/20 bg-sky-500/[0.04] p-4 sm:p-6">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Governed AI assistance</p><h2 id="investigation-active-advisory-heading" className="mt-2 text-xl font-semibold">S40 Investigation Active Advisory</h2>
    <p className="mt-2 text-sm leading-6 text-zinc-400">AI output is advisory only and requires human review. Adoption adds selected content to the local S40 working draft; it does not verify evidence, confirm root cause, mutate the authoritative controlled record, or submit the CAPA. S40→S50 submission remains a separate human action.</p>
    <button type="button" disabled={requesting || adopting || retry !== null} onClick={() => void generate()} className="mt-5 min-h-11 rounded-xl border border-sky-300/40 bg-sky-400/15 px-4 py-2.5 text-sm font-semibold text-sky-100 disabled:opacity-50">{requesting ? "Generating…" : "Generate advisory"}</button>
    {error ? <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}{message ? <p role="status" className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p> : null}
    {advisory ? <div className="mt-6 space-y-5"><div className="rounded-xl border border-sky-300/25 bg-sky-400/10 p-3 text-sm text-sky-100"><strong>Advisory only — human review required.</strong> Output ID: {advisory.advisory.outputId}</div>
      {Object.entries(categoryLabel).map(([category, title]) => <section key={category} aria-labelledby={`active-${category}`}><h3 id={`active-${category}`} className="text-lg font-semibold">{title}</h3><div className="mt-3 space-y-3">{(grouped[category] ?? []).length === 0 ? <p className="text-sm text-zinc-500">None returned.</p> : (grouped[category] ?? []).map((card) => <ReviewCard key={card.proposalKey} card={card} disabled={requesting || adopting || retry !== null || !currentUserId} onUpdate={update} />)}</div></section>)}
      <section aria-labelledby="active-uncertainty"><h3 id="active-uncertainty" className="text-lg font-semibold">Uncertainty and limitations</h3>{advisory.advisory.uncertaintyAndLimitations.length === 0 ? <p className="mt-2 text-sm text-zinc-500">None returned.</p> : <ul className="mt-2 space-y-2 text-sm text-zinc-300">{advisory.advisory.uncertaintyAndLimitations.map((item, index) => <li key={`${item.category}-${index}`}><span className="font-medium">{readable(item.category)}:</span> {item.human_review_question}</li>)}</ul>}</section>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={requesting || adopting || (retry === null && cards.every((card) => !card.selected))} onClick={() => void adopt()} className="min-h-11 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{adopting ? "Adopting…" : retry ? "Retry exact adoption" : "Adopt selected into draft"}</button>{retry ? <button type="button" disabled={adopting} onClick={() => { setRetry(null); setError(null); }} className="min-h-11 rounded-xl border border-zinc-700 px-4 text-sm">Discard exact retry</button> : null}</div>
    </div> : null}
  </section>;
}

function ReviewCard({ card, disabled, onUpdate }: { readonly card: CapaInvestigationActiveAdvisoryReviewCard; readonly disabled: boolean; readonly onUpdate: (key: string, changes: Partial<Pick<CapaInvestigationActiveAdvisoryReviewCard, "selected" | "humanCausalRole" | "adoptedContent">>) => void }) {
  const content = card.adoptedContent as unknown as Record<string, string>;
  return <article className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={card.selected} disabled={disabled} onChange={(event) => onUpdate(card.proposalKey, { selected: event.target.checked })} />Adopt proposal <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-sky-200">{card.proposalKey}</span></label>
    <p className="mt-3 text-xs text-zinc-400">References (read-only): {card.referenceKeys.length ? card.referenceKeys.join(", ") : "None"}</p><p className="mt-2 text-sm text-zinc-300">Human review question: {card.humanReviewQuestion}</p>
    {card.suggestedRole ? <p className="mt-2 text-xs text-zinc-400">AI suggested role (guidance only): {readable(card.suggestedRole)}</p> : null}
    {card.category === "causal_hypothesis" ? <label className="mt-3 block text-sm">Human causal role<select value={card.humanCausalRole ?? ""} disabled={disabled} onChange={(event) => onUpdate(card.proposalKey, { humanCausalRole: event.target.value as CapaInvestigationActiveHumanCausalRole })} className="mt-1 block min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2"><option value="">Select a human role</option><option value="proposed_root_cause">Proposed root cause</option><option value="contributing_factor">Contributing factor</option></select></label> : null}
    <div className="mt-3 grid gap-3 md:grid-cols-2">{contentFields(card.category).map((field) => <label key={field} className="text-sm text-zinc-300">{readable(field)}<textarea value={content[field] ?? ""} disabled={disabled} onChange={(event) => onUpdate(card.proposalKey, { adoptedContent: { ...card.adoptedContent, [field]: event.target.value } as never })} className="mt-1 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>)}</div>
  </article>;
}
