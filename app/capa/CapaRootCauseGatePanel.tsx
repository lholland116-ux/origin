"use client";

import { useState } from "react";
import FreshTotpStepUp from "./FreshTotpStepUp";
import {
  createCapaRootCauseGateAttempt,
  submitCapaRootCauseGateAttempt,
  type RootCauseGateAttempt,
  type RootCauseGateDecision,
} from "./capa-root-cause-gate-client";

export default function CapaRootCauseGatePanel({
  caseId,
  recordVersion,
  currentVersionId,
  onAuthoritativeRefresh,
}: {
  readonly caseId: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly onAuthoritativeRefresh: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<RootCauseGateDecision>("approve");
  const [approvalRationale, setApprovalRationale] = useState("");
  const [returnRationale, setReturnRationale] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [attempt, setAttempt] = useState<RootCauseGateAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<readonly string[]>([]);

  const rationale = decision === "approve" ? approvalRationale : returnRationale;

  function begin(decisionValue: RootCauseGateDecision) {
    const selectedRationale = decisionValue === "approve" ? approvalRationale : returnRationale;
    const next = createCapaRootCauseGateAttempt({
      caseId,
      recordVersion,
      currentVersionId,
      decision: decisionValue,
      rationale: selectedRationale,
      idempotencyKey: crypto.randomUUID(),
    });
    if (next === null) {
      setError("A non-empty, trimmed rationale is required.");
      return;
    }
    setDecision(decisionValue);
    setAttempt(next);
    setConfirmed(false);
    setError(null);
    setReasons([]);
    setConfirmationOpen(true);
  }

  async function submit(target: RootCauseGateAttempt) {
    setSubmitting(true);
    setError(null);
    setReasons([]);
    const result = await submitCapaRootCauseGateAttempt(target);
    if (result.status === "decided") {
      setConfirmationOpen(false);
      setStepUpOpen(false);
      setAttempt(null);
      await onAuthoritativeRefresh();
    } else {
      setError(result.message);
      setReasons(result.reasons);
      if (!result.retryableExact) {
        setConfirmationOpen(false);
        setStepUpOpen(false);
        setAttempt(null);
      }
    }
    setSubmitting(false);
  }

  return <section aria-labelledby="root-cause-gate-heading" className="mt-8 rounded-3xl border border-amber-400/25 bg-amber-500/[0.05] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">S50 · Human-controlled gate</p>
    <h2 id="root-cause-gate-heading" className="mt-2 text-2xl font-semibold">Root-Cause Gate</h2>
    <p className="mt-3 text-sm leading-6 text-zinc-400">The submitted S50 root-cause package remains read-only. An authorized approver may approve it for S60 or return it to S40 for investigation.</p>
    {error ? <div role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200"><p>{error}</p>{reasons.length ? <ul className="mt-2 list-disc pl-5">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}{attempt && !submitting ? <button type="button" onClick={() => setConfirmationOpen(true)} className="mt-2 underline">Retry exact gate attempt</button> : null}</div> : null}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Approval rationale<textarea value={approvalRationale} disabled={submitting} onChange={(event) => setApprovalRationale(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
      <label className="text-sm">Return-for-investigation rationale<textarea value={returnRationale} disabled={submitting} onChange={(event) => setReturnRationale(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
    </div>
    <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={submitting || approvalRationale.trim().length === 0} onClick={() => begin("approve")} className="min-h-11 rounded-xl bg-emerald-600 px-5 font-semibold disabled:opacity-50">Approve to S60</button><button type="button" disabled={submitting || returnRationale.trim().length === 0} onClick={() => begin("return_for_investigation")} className="min-h-11 rounded-xl border border-amber-400/40 px-5 font-semibold disabled:opacity-50">Return to S40</button></div>

    {confirmationOpen && attempt ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><section role="dialog" aria-modal="true" aria-labelledby="root-cause-gate-confirmation-heading" className="w-full max-w-xl rounded-3xl border border-zinc-700 bg-zinc-950 p-6">
      <h3 id="root-cause-gate-confirmation-heading" className="text-2xl font-semibold">Confirm root-cause gate decision</h3>
      <p className="mt-3 text-sm leading-6 text-zinc-400">This human-controlled action will move the authoritative CAPA from S50 to {decision === "approve" ? "S60" : "S40"}.</p>
      <label className="mt-5 flex gap-3 rounded-xl border border-zinc-700 p-4 text-sm"><input type="checkbox" checked={confirmed} disabled={submitting} onChange={(event) => setConfirmed(event.target.checked)} />I confirm this decision and rationale.</label>
      <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={submitting} onClick={() => { setConfirmationOpen(false); setAttempt(null); }}>Cancel</button><button type="button" disabled={!confirmed || submitting} onClick={() => { setConfirmationOpen(false); setStepUpOpen(true); }} className="min-h-11 rounded-xl bg-amber-600 px-5 font-semibold disabled:opacity-50">Continue to step-up</button></div>
    </section></div> : null}
    {stepUpOpen ? <FreshTotpStepUp open={stepUpOpen} title="Confirm root-cause gate" description="Fresh step-up authentication is required for this consequential CAPA decision." onCancel={() => setStepUpOpen(false)} onVerified={() => { setStepUpOpen(false); if (attempt) void submit(attempt); }} /> : null}
    <span className="sr-only">Current rationale: {rationale}</span>
  </section>;
}
