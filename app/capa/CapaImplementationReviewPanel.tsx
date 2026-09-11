"use client";

import { useEffect, useState } from "react";

import type { CapaActionPlanItem } from "../../lib/capa/domain/capa-action-plan";
import type { CapaImplementationActionProgress } from "../../lib/capa/implementation/capa-implementation-contract";
import type {
  CapaImplementationReviewAttempt,
  CapaImplementationReviewFailure,
} from "./capa-implementation-review-client";
import {
  createCapaImplementationReviewAttempt,
  loadCapaImplementationReview,
  submitCapaImplementationReviewAttempt,
  type CapaImplementationReviewLoadResult,
} from "./capa-implementation-review-client";
import FreshTotpStepUp from "./FreshTotpStepUp";
import type { CapaImplementationReviewProjection } from "../../lib/capa/implementation/capa-implementation-review-projection";

function display(value: string | null | undefined, fallback = "Not supplied") {
  return value === null || value === undefined || value.trim().length === 0 ? fallback : value;
}

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function actionType(value: string | null) {
  return value === null ? "Not supplied" : statusLabel(value);
}

function controlledError(failure: CapaImplementationReviewFailure) {
  switch (failure.code) {
    case "CAPA_STEP_UP_REQUIRED":
      return "Fresh step-up authentication is required before this reviewer decision can continue.";
    case "CAPA_ACCESS_DENIED":
    case "CAPA_IMPLEMENTATION_REVIEW_ACCESS_DENIED":
      return "You are not authorized to perform this S90 reviewer operation.";
    case "CAPA_CONCURRENCY_CONFLICT":
      return "The CAPA changed before this decision completed. Reload the current authoritative state.";
    case "CAPA_WORKFLOW_CONFLICT":
    case "CAPA_IMPLEMENTATION_REVIEW_CASE_STATE_CONFLICT":
      return "The CAPA is no longer available in S90 Implementation Review. Reload the current authoritative state.";
    case "CAPA_IMPLEMENTATION_REVIEW_VALIDATION_FAILED":
      return "The reviewer decision did not pass controlled validation. Check the rationale and current review package.";
    case "CAPA_IMPLEMENTATION_REVIEW_INVALID_AUTHORITATIVE_CONTEXT":
      return "The authoritative review context is inconsistent. Reload the current authoritative state.";
    case "CAPA_IDEMPOTENCY_CONFLICT":
      return "This idempotency key conflicts with an existing decision attempt. Do not submit a changed request; reload the authoritative state.";
    case "CAPA_IMPLEMENTATION_REVIEW_CASE_NOT_FOUND":
    case "CAPA_NOT_FOUND":
      return "The S90 review package is not available.";
    default:
      return failure.message;
  }
}

function ReadOnly({ label, value }: { readonly label: string; readonly value: string }) {
  return <div><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-zinc-200">{value}</dd></div>;
}

function Evidence({ evidence }: { readonly evidence: CapaImplementationActionProgress["evidence"][number] }) {
  return <article className="rounded-xl border border-zinc-800 bg-zinc-950/45 p-4">
    <p className="font-medium text-zinc-200">{statusLabel(evidence.evidence_kind)}</p>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <ReadOnly label="Evidence date" value={display(evidence.evidence_date)} />
      <ReadOnly label="Evidence ID" value={evidence.evidence_id} />
      <div className="sm:col-span-2"><ReadOnly label="Description" value={display(evidence.description)} /></div>
      <ReadOnly label="Origin kind" value={statusLabel(evidence.source.origin_kind)} />
      <ReadOnly label="Source system kind" value={statusLabel(evidence.source.source_system_kind)} />
      <ReadOnly label="Source system name" value={display(evidence.source.source_system_name)} />
      <ReadOnly label="Source record reference" value={display(evidence.source.source_record_reference)} />
      <ReadOnly label="Source record version" value={evidence.source.source_record_version === null ? "Not supplied" : String(evidence.source.source_record_version)} />
      <ReadOnly label="Artifact reference" value={display(evidence.source.artifact_reference)} />
    </dl>
  </article>;
}

function ApprovedAction({ item }: { readonly item: CapaActionPlanItem }) {
  return <article className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-300">Approved S70 action</p><h5 className="mt-1 text-lg font-semibold text-zinc-100">{item.item_id}</h5></div>
      <span className="rounded-full border border-amber-300/30 px-3 py-1 text-xs text-amber-100">Read-only authority</span>
    </div>
    <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><ReadOnly label="Description" value={display(item.description)} /></div>
      <ReadOnly label="Action type" value={actionType(item.action_type)} />
      <ReadOnly label="Owner" value={display(item.owner_user_id)} />
      <ReadOnly label="Due date" value={display(item.due_date)} />
      <div className="sm:col-span-2"><ReadOnly label="Deliverable" value={display(item.deliverable)} /></div>
      <div className="sm:col-span-2"><ReadOnly label="Implementation evidence plan" value={display(item.implementation_evidence)} /></div>
      <div className="sm:col-span-2"><ReadOnly label="Unintended consequence assessment" value={display(item.unintended_consequence_assessment)} /></div>
    </dl>
  </article>;
}

function SubmittedAction({ progress }: { readonly progress: CapaImplementationActionProgress }) {
  return <article className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-300">Submitted S80 implementation</p><h5 className="mt-1 text-lg font-semibold text-zinc-100">{progress.approved_action_reference}</h5></div>
      <span className="rounded-full border border-blue-300/30 bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-100">Owner-reported: {statusLabel(progress.owner_reported_status)}</span>
    </div>
    <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm text-amber-100"><strong>Evidence/reporting only:</strong> “{statusLabel(progress.owner_reported_status)}” is not accepted, approved, or verified implementation.</p>
    <dl className="mt-4 grid gap-4 text-sm">
      <div><ReadOnly label="Implementation narrative" value={display(progress.implementation_narrative)} /></div>
      {progress.blocked_reason !== null ? <div><ReadOnly label="Blocked reason" value={progress.blocked_reason} /></div> : null}
    </dl>
    <div className="mt-5 border-t border-zinc-800 pt-4"><h6 className="font-semibold text-zinc-200">Submitted evidence and provenance</h6><div className="mt-3 space-y-3">{progress.evidence.length === 0 ? <p className="text-sm text-zinc-500">No submitted evidence was recorded for this action.</p> : progress.evidence.map((evidence) => <Evidence key={evidence.evidence_id} evidence={evidence} />)}</div></div>
  </article>;
}

function ReviewPackage({ projection }: { readonly projection: CapaImplementationReviewProjection }) {
  const authority = projection.approved_s70_baseline;
  const submitted = projection.submitted_implementation;
  return <>
    <section aria-labelledby="implementation-review-authority-heading" className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-400/[0.04] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Approved S70 authority · read-only</p>
      <h4 id="implementation-review-authority-heading" className="mt-2 text-xl font-semibold">Approved action plan</h4>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><ReadOnly label="Approval rationale" value={authority.approval_decision.rationale} /><ReadOnly label="Approval reviewer" value={authority.approval_decision.reviewer_user_id} /><ReadOnly label="Approved at" value={date(authority.approval_decision.decided_at)} /><ReadOnly label="S70 source version" value={authority.source_case_version_id} /><ReadOnly label="Action-plan section version" value={authority.action_plan_section.section_version_id} /><ReadOnly label="Approval transition audit event" value={authority.approval_decision.transition_audit_event_id} /></dl>
      <div className="mt-5 space-y-4">{authority.action_plan.items.map((item) => <ApprovedAction key={item.item_id} item={item} />)}</div>
    </section>

    <section aria-labelledby="implementation-review-submission-heading" className="mt-6 rounded-2xl border border-blue-300/25 bg-blue-400/[0.04] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Submitted S80 package · read-only</p>
      <h4 id="implementation-review-submission-heading" className="mt-2 text-xl font-semibold">Implementation package under review</h4>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><ReadOnly label="Submitted by" value={submitted.submitted_by_user_id} /><ReadOnly label="Submitted at" value={date(submitted.submitted_at)} /><ReadOnly label="S80 source version" value={submitted.source_s80_case_version_id} /><ReadOnly label="Workspace revision" value={String(submitted.source_s80_workspace_revision)} /></dl>
      <div className="mt-5 space-y-4">{submitted.action_progress.map((progress) => <SubmittedAction key={progress.approved_action_reference} progress={progress} />)}</div>
    </section>

    {projection.prior_review_history.length > 0 ? <section aria-labelledby="implementation-review-history-heading" className="mt-6 rounded-2xl border border-zinc-700 bg-zinc-950/45 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Prior immutable S90 review history</p><h4 id="implementation-review-history-heading" className="mt-2 text-xl font-semibold">Previous review cycles</h4><div className="mt-4 space-y-4">{projection.prior_review_history.map((entry, index) => <article key={entry.transition_audit_event_id} className="rounded-xl border border-zinc-800 p-4"><h5 className="font-semibold text-zinc-100">Review cycle {index + 1}</h5><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><ReadOnly label="Decision" value={entry.decision === "accept" ? "Accept implementation" : "Return for implementation"} /><ReadOnly label="Rationale" value={entry.rationale} /><ReadOnly label="Reviewer" value={entry.reviewer_user_id} /><ReadOnly label="Decided at" value={date(entry.decided_at)} /><ReadOnly label="Resulting version" value={entry.resulting_case_version_id} /><ReadOnly label="Baseline section version" value={entry.implementation_review_baseline_section_version_id} /></dl></article>)}</div></section> : null}
  </>;
}

export default function CapaImplementationReviewPanel({ caseId, caseNumber, onAuthoritativeRefresh }: { readonly caseId: string; readonly caseNumber: string; readonly onAuthoritativeRefresh: () => Promise<void> }) {
  const [loadState, setLoadState] = useState<CapaImplementationReviewLoadResult | null>(null);
  const [rationale, setRationale] = useState("");
  const [attempt, setAttempt] = useState<CapaImplementationReviewAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  async function hydrate() {
    const next = await loadCapaImplementationReview(caseId);
    setError(null);
    setSuccess(null);
    setLoadState(next);
  }

  useEffect(() => {
    void loadCapaImplementationReview(caseId).then((next) => {
      setError(null);
      setSuccess(null);
      setLoadState(next);
    });
  }, [caseId]);

  const projection = loadState?.status === "loaded" ? loadState.projection : null;
  const authorization = projection?.reviewer.authorization.decision;
  const disabled = submitting || attempt !== null || authorization?.status === "denied";

  function begin(decision: "accept" | "return") {
    if (disabled || projection === null || rationale.trim().length === 0) return;
    const next = createCapaImplementationReviewAttempt({
      caseId,
      recordVersion: projection.record_version,
      currentCaseVersionId: projection.current_case_version_id,
      sourceCaseVersionId: projection.current_case_version_id,
      implementationReviewBaselineSectionVersionId: projection.implementation_review_baseline_section_version_id,
      decision,
      rationale,
      idempotencyKey: crypto.randomUUID(),
    });
    if (next === null) {
      setError("A non-empty, trimmed rationale is required for both decisions.");
      return;
    }
    setAttempt(next);
    setError(null);
    setReasons([]);
    setSuccess(null);
    if (authorization?.status === "step_up_required") setStepUpOpen(true);
    else void submit(next);
  }

  async function submit(target: CapaImplementationReviewAttempt) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setReasons([]);
    const result = await submitCapaImplementationReviewAttempt(target);
    if (result.status === "decided") {
      setAttempt(null);
      setStepUpOpen(false);
      setSuccess(result.decision === "accept" ? "Implementation accepted by the S90 reviewer. Reloading authoritative CAPA state…" : "Implementation returned for implementation. Reloading authoritative CAPA state…");
      await onAuthoritativeRefresh();
    } else {
      setError(controlledError(result));
      setReasons(result.reasons);
      if (result.code === "CAPA_STEP_UP_REQUIRED") setStepUpOpen(true);
      else if (!result.retryableExact) setAttempt(null);
      if (result.requiresRefresh) await onAuthoritativeRefresh().catch(() => undefined);
    }
    setSubmitting(false);
  }

  if (loadState === null) return <section className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6"><p role="status">Loading authoritative S90 review package…</p></section>;
  if (loadState.status === "failed") return <section className="mt-8 rounded-3xl border border-red-400/25 bg-red-500/10 p-6"><h3 className="text-xl font-semibold">S90 · Implementation Review</h3><p role="alert" className="mt-3 text-sm text-red-100">{controlledError(loadState)}</p><button type="button" onClick={() => void hydrate()} className="mt-4 min-h-11 rounded-xl border border-zinc-600 px-4 py-2 text-sm">Reload authoritative review package</button></section>;
  if (projection === null) return null;

  return <section aria-labelledby="implementation-review-heading" className="mt-8 rounded-3xl border border-amber-400/25 bg-amber-500/[0.05] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">S90 · Implementation Review</p>
    <h3 id="implementation-review-heading" className="mt-2 text-2xl font-semibold">Implementation Review</h3>
    <p className="mt-3 text-sm leading-6 text-zinc-400">Review the immutable submitted S80 implementation package against the approved S70 authority for {caseNumber}. Owner-reported completion is evidence/reporting only; it is not reviewer acceptance.</p>
    <dl className="mt-5 grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/45 p-4 text-sm sm:grid-cols-3"><ReadOnly label="Case identifier" value={projection.capa_case_id} /><ReadOnly label="Workflow state" value={projection.workflow_state} /><ReadOnly label="Current version" value={`${projection.current_case_version_id} · record ${projection.record_version}`} /></dl>
    <ReviewPackage projection={projection} />
    <section aria-labelledby="implementation-review-authorization-heading" className="mt-6 rounded-2xl border border-zinc-700 bg-zinc-950/45 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Reviewer authorization state</p><h4 id="implementation-review-authorization-heading" className="mt-2 text-xl font-semibold">Controlled decision access</h4><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><ReadOnly label="View authorization" value={`${projection.reviewer.authorization.read.status} · ${projection.reviewer.authorization.read.reason_code}`} /><ReadOnly label="Decision authorization" value={`${authorization?.status ?? "Unavailable"} · ${authorization?.reason_code ?? "Unavailable"}`} /><ReadOnly label="Reviewer identity" value={projection.reviewer.user_id} /><ReadOnly label="Step-up assurance" value={authorization?.required_assurance ?? "Not exposed"} /></dl></section>
    {success ? <p role="status" className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">{success}</p> : null}
    {error ? <div role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-100"><p>{error}</p>{reasons.length > 0 ? <ul className="mt-2 list-disc pl-5">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}{attempt && !submitting && !stepUpOpen && !error.includes("reload") ? <button type="button" onClick={() => void submit(attempt)} className="mt-3 underline">Retry the exact same decision request</button> : null}</div> : null}
    <label className="mt-6 block text-sm text-zinc-200">Reviewer rationale<textarea value={rationale} disabled={submitting || attempt !== null} onChange={(event) => setRationale(event.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" placeholder="Explain the basis for accepting or returning this implementation." /></label>
    <p className="mt-2 text-xs text-zinc-500">A rationale is required for both decisions. This reviewer interface does not generate decisions or authoritative rationale automatically.</p>
    <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={disabled || rationale.trim().length === 0} onClick={() => begin("return")} className="min-h-11 rounded-xl border border-amber-400/40 px-5 font-semibold disabled:opacity-50">Return for implementation</button><button type="button" disabled={disabled || rationale.trim().length === 0} onClick={() => begin("accept")} className="min-h-11 rounded-xl bg-emerald-600 px-5 font-semibold disabled:opacity-50">Accept implementation</button></div>
    {stepUpOpen && attempt ? <FreshTotpStepUp open={stepUpOpen} title={attempt.decision === "accept" ? "Confirm accept implementation" : "Confirm return for implementation"} description="Fresh step-up authentication is required for this controlled S90 reviewer decision." onCancel={() => { setStepUpOpen(false); setAttempt(null); }} onVerified={() => { setStepUpOpen(false); void submit(attempt); }} /> : null}
  </section>;
}
