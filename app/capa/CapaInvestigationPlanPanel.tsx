"use client";

import { useEffect, useState } from "react";
import CapaParticipantSelector from "./CapaParticipantSelector";
import CapaInvestigationPlanningAdvisoryPanel from "./CapaInvestigationPlanningAdvisoryPanel";
import { fetchCapaInvestigationOwners, type CapaParticipant } from "./capa-participant-client";
import { addInvestigationPlanItem, composeInvestigationPlan, createEmptyInvestigationPlanDraft,
  normalizedReleaseComment, removeInvestigationPlanItem, setInvestigationPlanDependency,
  updateInvestigationPlanItem, validateInvestigationPlanDraft,
  type InvestigationPlanDraft } from "./capa-investigation-plan-draft";
import { createInvestigationReleaseAttempt, submitInvestigationReleaseAttempt,
  type InvestigationReleaseAttempt } from "./capa-investigation-release-client";

const traceId = () => crypto.randomUUID();

export default function CapaInvestigationPlanPanel({ caseId, caseNumber, recordVersion,
  currentVersionId, currentUserId, onAuthoritativeRefresh }: {
  readonly caseId: string; readonly caseNumber: string; readonly recordVersion: number;
  readonly currentVersionId: string; readonly currentUserId: string;
  readonly onAuthoritativeRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<InvestigationPlanDraft>(() => createEmptyInvestigationPlanDraft());
  const [participants, setParticipants] = useState<readonly CapaParticipant[]>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [loadingParticipants, setLoadingParticipants] = useState(true);
  const [comment, setComment] = useState("");
  const [attempt, setAttempt] = useState<InvestigationReleaseAttempt | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [adoptionBusy, setAdoptionBusy] = useState(false);
  const [provenanceNotice, setProvenanceNotice] = useState(false);

  async function loadParticipants() {
    setLoadingParticipants(true); setDirectoryError(null);
    try { setParticipants((await fetchCapaInvestigationOwners()).participants); }
    catch (error) { setParticipants([]); setDirectoryError(error instanceof Error ? error.message : "Assignable owners could not be loaded."); }
    finally { setLoadingParticipants(false); }
  }
  useEffect(() => { void loadParticipants(); }, []);
  useEffect(() => { setRefreshRequired(false); }, [currentVersionId]);

  const busy = submitting || adoptionBusy;
  function commitDraftChange(change: (current: InvestigationPlanDraft) => InvestigationPlanDraft) {
    setDraft((current) => {
      const next = change(current);
      if (next.items.some((nextItem) => current.items.find((item) => item.itemId === nextItem.itemId)?.provenance.source_type === "ai_proposal" && nextItem.provenance.source_type === "human")) {
        setProvenanceNotice(true);
      }
      return next;
    });
  }
  const beginRelease = () => {
    const errors = validateInvestigationPlanDraft(draft);
    if (directoryError !== null || loadingParticipants || errors.length > 0) {
      setReleaseError(directoryError ?? errors.join(" ") ?? "Assignable owners are unavailable."); return;
    }
    const next = createInvestigationReleaseAttempt({ caseId, recordVersion, currentVersionId,
      investigationPlan: composeInvestigationPlan(draft), comment: normalizedReleaseComment(comment),
      idempotencyKey: traceId() });
    if (next === null) { setReleaseError("The release request could not be prepared."); return; }
    setAttempt(next); setConfirmed(false); setReleaseError(null); setReasons([]); setConfirmationOpen(true);
  };

  async function submit(target: InvestigationReleaseAttempt) {
    setSubmitting(true); setReleaseError(null); setReasons([]);
    const result = await submitInvestigationReleaseAttempt(target);
    if (result.status === "released") {
      setConfirmationOpen(false); setAttempt(null); setConfirmed(false);
      await onAuthoritativeRefresh();
    } else {
      setReleaseError(result.message); setReasons(result.reasons); setRefreshRequired(result.requiresRefresh);
      if (!result.retryableExact) { setConfirmationOpen(false); setAttempt(null); setConfirmed(false); }
    }
    setSubmitting(false);
  }

  return <section aria-labelledby="investigation-planning-heading"
    className="mt-8 rounded-3xl border border-emerald-400/20 bg-emerald-500/[0.05] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">S30 · Human-controlled draft</p>
    <h2 id="investigation-planning-heading" className="mt-2 text-2xl font-semibold text-zinc-100">Investigation Planning</h2>
    <p className="mt-3 text-sm leading-6 text-zinc-400">Create the investigation plan for {caseNumber}. The human remains responsible for the final plan; draft edits are not controlled CAPA history until release.</p>
    {provenanceNotice ? <p className="mt-2 text-xs text-amber-200">Edited after AI adoption — this item is now treated as human-authored.</p> : null}

    {directoryError ? <div role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">
      <p>{directoryError}</p><button type="button" onClick={() => void loadParticipants()} className="mt-2 underline">Retry participant directory</button>
    </div> : null}
    {loadingParticipants ? <p role="status" className="mt-5 text-sm text-zinc-400">Loading eligible investigation owners…</p> : null}
    {releaseError ? <div role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">
      <p>{releaseError}</p>{reasons.length ? <ul className="mt-2 list-disc pl-5">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      {refreshRequired ? <button type="button" onClick={() => void onAuthoritativeRefresh()} className="mt-2 underline">Refresh authoritative CAPA</button> : null}
    </div> : null}

    <CapaInvestigationPlanningAdvisoryPanel caseId={caseId} caseNumber={caseNumber} currentVersionId={currentVersionId}
      recordVersion={recordVersion} currentUserId={currentUserId} participants={participants} draft={draft}
      disabled={submitting || refreshRequired} onDraftChange={(next) => commitDraftChange(() => next)} onBusyChange={setAdoptionBusy} />

    <div className="mt-6 space-y-5">{draft.items.map((item, index) => <fieldset key={item.itemId}
      disabled={busy || refreshRequired} className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4">
      <div className="flex items-center justify-between"><legend className="font-semibold text-zinc-100">Investigation item {index + 1}</legend>
        <span className="rounded-full border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300">{item.provenance.source_type === "ai_proposal" ? "AI proposal · Human adopted" : "Human-authored"}</span>
        <button type="button" onClick={() => commitDraftChange((value) => removeInvestigationPlanItem(value, item.itemId))}
          className="text-sm text-red-300">Remove item</button></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(["investigationQuestion", "evidenceTarget", "investigationMethod", "scopeRelationship"] as const).map((field) =>
          <label key={field} className="text-sm text-zinc-300"><span>{({ investigationQuestion: "Investigation question", evidenceTarget: "Evidence target", investigationMethod: "Investigation method", scopeRelationship: "Scope relationship" })[field]}</span>
            <textarea value={item[field]} onChange={(event) => commitDraftChange((value) => updateInvestigationPlanItem(value, item.itemId, { [field]: event.target.value }))}
              className="mt-2 min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100" /></label>)}
        <label className="text-sm text-zinc-300">Assigned owner<CapaParticipantSelector participants={participants}
          currentUserId={currentUserId} value={item.ownerUserId} disabled={busy || directoryError !== null}
          onChange={(ownerUserId) => commitDraftChange((value) => updateInvestigationPlanItem(value, item.itemId, { ownerUserId }))} /></label>
        <label className="text-sm text-zinc-300">Due date<input type="date" value={item.dueDate}
          onChange={(event) => commitDraftChange((value) => updateInvestigationPlanItem(value, item.itemId, { dueDate: event.target.value }))}
          className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100" /></label>
      </div>
      {draft.items.length > 1 ? <div className="mt-4"><p className="text-sm text-zinc-300">Dependencies</p>
        <div className="mt-2 flex flex-wrap gap-3">{draft.items.filter((candidate) => candidate.itemId !== item.itemId).map((candidate) =>
          <label key={candidate.itemId} className="text-sm text-zinc-400"><input type="checkbox"
            checked={item.dependencyItemIds.includes(candidate.itemId)} onChange={(event) => {
              const next = setInvestigationPlanDependency(draft, item.itemId, candidate.itemId, event.target.checked);
              if (next === null) setReleaseError("That dependency would be invalid or create a cycle."); else commitDraftChange(() => next);
            }} /> Item {draft.items.findIndex((entry) => entry.itemId === candidate.itemId) + 1}</label>)}</div></div> : null}
    </fieldset>)}</div>

    <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={busy || refreshRequired}
      onClick={() => commitDraftChange((value) => addInvestigationPlanItem(value, traceId()))}
      className="min-h-11 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-100">Add investigation item</button></div>
    <label className="mt-6 block text-sm text-zinc-300">Optional release comment<textarea value={comment}
        disabled={busy || refreshRequired} maxLength={4000} onChange={(event) => setComment(event.target.value)}
      className="mt-2 min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100" /></label>
    <div className="mt-6 flex justify-end"><button type="button" disabled={busy || refreshRequired || directoryError !== null || loadingParticipants}
      onClick={beginRelease} className="min-h-11 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white disabled:opacity-50">Release Investigation Plan</button></div>

    {confirmationOpen && attempt ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><section role="dialog" aria-modal="true"
      aria-labelledby="release-investigation-heading" className="w-full max-w-xl rounded-3xl border border-zinc-700 bg-zinc-950 p-6">
      <h2 id="release-investigation-heading" className="text-2xl font-semibold">Release this investigation plan for execution?</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-400">Successful release moves the CAPA from S30 Investigation Planning to S40 Investigation Active.</p>
      <label className="mt-5 flex gap-3 rounded-xl border border-zinc-700 p-4 text-sm"><input type="checkbox" checked={confirmed}
        disabled={submitting} onChange={(event) => setConfirmed(event.target.checked)} />I confirm this human-reviewed investigation plan is ready to release for execution.</label>
      {releaseError ? <p role="alert" className="mt-4 text-sm text-red-300">{releaseError}</p> : null}
      <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={submitting} onClick={() => { setConfirmationOpen(false); setAttempt(null); }}>Cancel</button>
        <button type="button" disabled={!confirmed || submitting} onClick={() => void submit(attempt)}
          className="min-h-11 rounded-xl bg-emerald-600 px-5 font-semibold disabled:opacity-50">{submitting ? "Releasing…" : "Release for Execution"}</button></div>
    </section></div> : null}
  </section>;
}
