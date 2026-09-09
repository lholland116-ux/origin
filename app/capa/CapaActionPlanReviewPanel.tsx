"use client";

import { useState } from "react";
import FreshTotpStepUp from "./FreshTotpStepUp";
import {
  createCapaActionPlanReviewAttempt,
  submitCapaActionPlanReviewAttempt,
  type CapaActionPlanReviewAttempt,
} from "./capa-action-plan-review-client";
import type {
  CapaActionPlanContent,
  CapaActionPlanItem,
} from "../../lib/capa/domain/capa-action-plan";
import type { CapaActionPlanReviewDecision } from "../../lib/capa/domain/capa-action-plan-review-decision";

function display(value: string | null, fallback = "Not supplied") {
  return value === null || value.trim().length === 0 ? fallback : value;
}

function actionType(value: string | null) {
  if (value === null) return "Not selected";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function targetLabel(targetType: string) {
  if (targetType === "cause") return "Cause";
  if (targetType === "contributing_factor") return "Contributing factor";
  if (targetType === "gap") return "Investigation gap";
  return "Risk";
}

function ActionPlanItemView({ item }: { readonly item: CapaActionPlanItem }) {
  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
            Controlled action {item.item_id}
          </p>
          <h4 className="mt-2 text-lg font-semibold">{actionType(item.action_type)}</h4>
        </div>
        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-300">
          {item.status}
        </span>
      </div>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-zinc-500">Description</dt>
          <dd className="mt-1 whitespace-pre-wrap text-zinc-200">{display(item.description)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Owner</dt>
          <dd className="mt-1 break-all text-zinc-200">{display(item.owner_user_id)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Due date</dt>
          <dd className="mt-1 text-zinc-200">{display(item.due_date)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-zinc-500">Deliverable</dt>
          <dd className="mt-1 whitespace-pre-wrap text-zinc-200">{display(item.deliverable)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-zinc-500">Implementation evidence plan</dt>
          <dd className="mt-1 whitespace-pre-wrap text-zinc-200">{display(item.implementation_evidence)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-zinc-500">Unintended consequence assessment</dt>
          <dd className="mt-1 whitespace-pre-wrap text-zinc-200">{display(item.unintended_consequence_assessment)}</dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-zinc-800 pt-4">
        <h5 className="text-sm font-semibold text-zinc-200">Linked authoritative targets</h5>
        {item.linked_targets.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No linked targets.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {item.linked_targets.map((target) => (
              <li key={`${target.target_type}:${target.target_id}`} className="rounded-xl border border-zinc-800 p-3 text-sm">
                <p className="font-medium text-zinc-200">{targetLabel(target.target_type)}</p>
                <p className="mt-1 break-all font-mono text-xs text-zinc-400">{target.target_id}</p>
                <p className="mt-2 whitespace-pre-wrap text-zinc-400">{target.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 grid gap-4 border-t border-zinc-800 pt-4 text-sm sm:grid-cols-2">
        <div>
          <h5 className="font-semibold text-zinc-200">Dependencies</h5>
          <p className="mt-1 break-all text-zinc-400">
            {item.dependency_item_ids.length === 0 ? "None" : item.dependency_item_ids.join(", ")}
          </p>
        </div>
        <div>
          <h5 className="font-semibold text-zinc-200">Effectiveness check</h5>
          <p className="mt-1 text-zinc-400">
            {item.effectiveness_check_required ? "Required" : "Not required"}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function CapaActionPlanReviewPanel({
  caseId,
  caseNumber,
  recordVersion,
  currentVersionId,
  actionPlanSectionVersionId,
  actionPlan,
  onAuthoritativeRefresh,
}: {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly actionPlanSectionVersionId: string;
  readonly actionPlan: CapaActionPlanContent;
  readonly onAuthoritativeRefresh: () => Promise<void>;
}) {
  const [rationale, setRationale] = useState("");
  const [attempt, setAttempt] = useState<CapaActionPlanReviewAttempt | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  function begin(decision: CapaActionPlanReviewDecision) {
    const next = createCapaActionPlanReviewAttempt({
      caseId,
      recordVersion,
      currentVersionId,
      sourceCaseVersionId: currentVersionId,
      actionPlanSectionVersionId,
      decision,
      rationale,
      idempotencyKey: crypto.randomUUID(),
    });
    if (next === null) {
      setError("A non-empty, trimmed rationale is required.");
      return;
    }

    setAttempt(next);
    setError(null);
    setReasons([]);
    setSuccess(null);
    if (decision === "approve") {
      setConfirmationChecked(false);
      setConfirmationOpen(true);
    } else {
      void submit(next);
    }
  }

  async function submit(target: CapaActionPlanReviewAttempt) {
    setSubmitting(true);
    setError(null);
    setReasons([]);
    const result = await submitCapaActionPlanReviewAttempt(target);
    if (result.status === "decided") {
      setConfirmationOpen(false);
      setStepUpOpen(false);
      setAttempt(null);
      setSuccess(
        result.workflowState === "S80"
          ? "The action plan has been approved for implementation. Implementation evidence has not yet been submitted."
          : "The action plan has been returned for action planning.",
      );
      await onAuthoritativeRefresh();
    } else {
      setError(result.message);
      setReasons(result.reasons);
      if (!result.retryableExact) {
        setConfirmationOpen(false);
        setStepUpOpen(false);
        setAttempt(null);
      }
      if (result.requiresRefresh) {
        await onAuthoritativeRefresh().catch(() => undefined);
      }
    }
    setSubmitting(false);
  }

  return (
    <section aria-labelledby="action-plan-review-heading" className="mt-8 rounded-3xl border border-amber-400/25 bg-amber-500/[0.05] p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">S70 · Human-controlled review</p>
      <h3 id="action-plan-review-heading" className="mt-2 text-2xl font-semibold">Action Plan Review</h3>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Review the submitted controlled baseline for {caseNumber}. This baseline is read-only; approval does not mean implementation evidence has been submitted.
      </p>

      <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        <p>Submitted controlled baseline</p>
        <p className="mt-2 break-all font-mono">Case version: {currentVersionId}</p>
        <p className="mt-1 break-all font-mono">Action-plan section: {actionPlanSectionVersionId}</p>
      </div>

      <div className="mt-6 space-y-4">
        {actionPlan.items.map((item) => <ActionPlanItemView key={item.item_id} item={item} />)}
      </div>

      {actionPlan.effectiveness_checks.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-zinc-800 p-5">
          <h4 className="font-semibold text-zinc-200">Effectiveness planning</h4>
          <ul className="mt-3 space-y-3 text-sm text-zinc-400">
            {actionPlan.effectiveness_checks.map((check) => (
              <li key={check.check_id} className="rounded-xl border border-zinc-800 p-3">
                <p className="font-medium text-zinc-200">Check {check.check_id}</p>
                <p className="mt-1">Actions: {check.action_item_ids.join(", ")}</p>
                <p className="mt-1">Acceptance criteria: {display(check.acceptance_criteria)}</p>
                <p className="mt-1">Evaluation method: {display(check.evaluation_method)}</p>
                <p className="mt-1">Data source: {display(check.data_source)}</p>
                <p className="mt-1">Timing: {display(check.timing)}</p>
                <p className="mt-1">Responsible role: {display(check.responsible_role)}</p>
                <p className="mt-1">Sample or rationale: {display(check.sample_or_rationale)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {success ? <div role="status" className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">{success}</div> : null}
      {error ? <div role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200"><p>{error}</p>{reasons.length > 0 ? <ul className="mt-2 list-disc pl-5">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}{attempt && !submitting ? <button type="button" onClick={() => void submit(attempt)} className="mt-2 underline">Retry exact review decision</button> : null}</div> : null}

      <label className="mt-6 block text-sm text-zinc-200">
        Review rationale
        <textarea value={rationale} disabled={submitting || attempt !== null} onChange={(event) => setRationale(event.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" />
      </label>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={submitting || attempt !== null || rationale.trim().length === 0} onClick={() => begin("return")} className="min-h-11 rounded-xl border border-amber-400/40 px-5 font-semibold disabled:opacity-50">Return for action planning</button>
        <button type="button" disabled={submitting || attempt !== null || rationale.trim().length === 0} onClick={() => begin("approve")} className="min-h-11 rounded-xl bg-emerald-600 px-5 font-semibold disabled:opacity-50">Approve action plan</button>
      </div>

      {confirmationOpen && attempt ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><section role="dialog" aria-modal="true" aria-labelledby="action-plan-review-confirmation-heading" className="w-full max-w-xl rounded-3xl border border-zinc-700 bg-zinc-950 p-6">
        <h4 id="action-plan-review-confirmation-heading" className="text-2xl font-semibold">Confirm action-plan approval</h4>
        <p className="mt-3 text-sm leading-6 text-zinc-400">This human-controlled action will move the authoritative CAPA from S70 to S80 Implementation Active. It does not mean implementation evidence has been submitted.</p>
        <label className="mt-5 flex gap-3 rounded-xl border border-zinc-700 p-4 text-sm"><input type="checkbox" checked={confirmationChecked} disabled={submitting} onChange={(event) => setConfirmationChecked(event.target.checked)} />I confirm this approval decision and rationale.</label>
        <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={submitting} onClick={() => { setConfirmationOpen(false); setAttempt(null); }}>Cancel</button><button type="button" disabled={!confirmationChecked || submitting} onClick={() => { setConfirmationOpen(false); setStepUpOpen(true); }} className="min-h-11 rounded-xl bg-amber-600 px-5 font-semibold disabled:opacity-50">Continue to step-up</button></div>
      </section></div> : null}
      {stepUpOpen ? <FreshTotpStepUp open={stepUpOpen} title="Confirm action-plan approval" description="Fresh step-up authentication is required for this controlled CAPA decision." onCancel={() => setStepUpOpen(false)} onVerified={() => { setStepUpOpen(false); if (attempt) void submit(attempt); }} /> : null}
    </section>
  );
}
