"use client";

import { useState } from "react";
import FreshTotpStepUp from "./FreshTotpStepUp";
import {
  createCapaActionPlanReviewAttempt,
  submitCapaActionPlanReviewAttempt,
  type CapaActionPlanReviewAttempt,
} from "./capa-action-plan-review-client";
import {
  buildCapaActionPlanReviewAdvisoryRequest,
  fetchCapaActionPlanReviewAdvisory,
  type CapaActionPlanReviewAdvisorySuccess,
} from "./capa-action-plan-review-advisory-client";
import type {
  CapaActionPlanContent,
  CapaActionPlanItem,
} from "../../lib/capa/domain/capa-action-plan";
import type { CapaActionPlanReviewDecision } from "../../lib/capa/domain/capa-action-plan-review-decision";
import type { CapaActionPlanReviewHistoryCycle } from "./capa-existing-case-client";

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

function advisoryLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function dispositionLabel(value: string) {
  if (value === "approve") return "Approve";
  if (value === "return") return "Return for action planning";
  return "Unable to recommend";
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
  reviewHistory,
  onAuthoritativeRefresh,
}: {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly actionPlanSectionVersionId: string;
  readonly actionPlan: CapaActionPlanContent;
  readonly reviewHistory?: readonly CapaActionPlanReviewHistoryCycle[];
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
  const [advisory, setAdvisory] = useState<CapaActionPlanReviewAdvisorySuccess | null>(null);
  const [advisoryRequesting, setAdvisoryRequesting] = useState(false);
  const [advisoryError, setAdvisoryError] = useState<string | null>(null);

  const stepUpTitle =
    attempt?.decision === "return"
      ? "Confirm return for action planning"
      : "Confirm action-plan approval";

  async function generateAdvisory() {
    setAdvisoryRequesting(true);
    setAdvisoryError(null);
    const result = await fetchCapaActionPlanReviewAdvisory(
      caseId,
      buildCapaActionPlanReviewAdvisoryRequest({
        expectedCaseVersionId: currentVersionId,
        expectedRecordVersion: recordVersion,
      }),
      actionPlanSectionVersionId,
    );
    if ("advisory" in result) {
      setAdvisory(result);
    } else {
      setAdvisoryError(result.message);
    }
    setAdvisoryRequesting(false);
  }

  function begin(decision: CapaActionPlanReviewDecision) {
    if (attempt !== null || submitting) return;

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
      setStepUpOpen(true);
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

      {reviewHistory !== undefined && reviewHistory.length > 0 ? <section aria-labelledby="action-plan-review-history-heading" className="mt-6 rounded-2xl border border-zinc-700 bg-zinc-950/45 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Controlled review history</p>
        <h4 id="action-plan-review-history-heading" className="mt-2 text-xl font-semibold text-zinc-100">Previous Return / Response cycles</h4>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Completed cycles are read-only. Each reviewer rationale and owner response below comes from authoritative controlled history.</p>
        <div className="mt-5 space-y-4">
          {reviewHistory.map((cycle, index) => <article key={cycle.returnContext.returnTransitionAuditEventId} className="rounded-xl border border-zinc-800 p-4">
            <h5 className="font-semibold text-zinc-100">Return / Response cycle {index + 1}</h5>
            <h6 className="mt-4 text-sm font-semibold text-zinc-300">Reviewer Return rationale</h6>
            <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-amber-400/50 pl-3 text-sm leading-6 text-amber-100">{cycle.returnContext.rationale}</blockquote>
            <h6 className="mt-4 text-sm font-semibold text-zinc-300">Owner response · immutable controlled history</h6>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{cycle.ownerResponse.content.responseNarrative}</p>
            <dl className="mt-4 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
              <div><dt>Returned at</dt><dd className="mt-1 text-zinc-400">{cycle.returnContext.returnedAt}</dd></div>
              <div><dt>Responded at</dt><dd className="mt-1 text-zinc-400">{cycle.ownerResponse.content.respondedAt}</dd></div>
              <div className="sm:col-span-2"><dt>Resubmitted case version</dt><dd className="mt-1 break-all font-mono text-zinc-400">{cycle.resubmissionCaseVersionId}</dd></div>
            </dl>
          </article>)}
        </div>
      </section> : null}

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

      <section aria-labelledby="action-plan-review-advisory-heading" className="mt-6 rounded-2xl border border-sky-400/25 bg-sky-500/[0.04] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">AI assistance · advisory only</p>
        <h4 id="action-plan-review-advisory-heading" className="mt-2 text-xl font-semibold">AI Review Advisory</h4>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          The submitted controlled S70 baseline remains the primary review artifact. AI output supports review but cannot approve, return, or transition this CAPA.
        </p>
        <button type="button" disabled={advisoryRequesting || submitting || attempt !== null} onClick={() => void generateAdvisory()} className="mt-5 min-h-11 rounded-xl border border-sky-300/40 bg-sky-400/10 px-4 py-2.5 text-sm font-semibold text-sky-100 disabled:opacity-50">
          {advisoryRequesting ? "Generating AI review…" : "Generate AI review"}
        </button>
        {advisoryRequesting ? <p role="status" className="mt-3 text-sm text-sky-200">Generating a governed advisory for the current submitted baseline…</p> : null}
        {advisoryError ? <p role="alert" className="mt-3 text-sm text-red-200">{advisoryError}</p> : null}

        {advisory ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-xl border border-sky-300/25 bg-sky-400/10 p-4 text-sm text-sky-100">
              <p className="font-semibold">Advisory only — human review is required.</p>
              <p className="mt-2">Overall assessment: <span className="font-semibold">{advisoryLabel(advisory.advisory.proposal.overall_assessment)}</span></p>
              <p className="mt-1">AI recommended disposition: <span className="font-semibold">{dispositionLabel(advisory.advisory.proposal.recommended_disposition)}</span></p>
            </div>

            <section aria-labelledby="action-plan-review-advisory-findings-heading">
              <h5 id="action-plan-review-advisory-findings-heading" className="text-lg font-semibold">Findings</h5>
              {advisory.advisory.proposal.findings.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No material findings were returned.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {advisory.advisory.proposal.findings.map((finding) => (
                    <article key={finding.finding_id} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em]">
                        <span className="text-zinc-300">{advisoryLabel(finding.category)}</span>
                        <span className="rounded-full border border-amber-400/30 px-2 py-1 text-amber-200">{advisoryLabel(finding.severity)}</span>
                      </div>
                      <h6 className="mt-3 font-semibold text-zinc-100">{finding.summary}</h6>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{finding.rationale}</p>
                      <p className="mt-3 text-sm text-zinc-300"><span className="font-semibold">Reviewer attention:</span> {finding.suggested_reviewer_attention}</p>
                      {finding.affected_action_ids.length > 0 ? <p className="mt-2 break-all text-xs text-zinc-500">Affected actions: {finding.affected_action_ids.join(", ")}</p> : null}
                      {finding.affected_root_cause_ids.length > 0 ? <p className="mt-1 break-all text-xs text-zinc-500">Affected root causes: {finding.affected_root_cause_ids.join(", ")}</p> : null}
                      {finding.reference_keys.length > 0 ? <p className="mt-1 break-all text-xs text-zinc-500">Supporting references: {finding.reference_keys.join(", ")}</p> : null}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="action-plan-review-advisory-limitations-heading" className="border-t border-zinc-800 pt-4">
              <h5 id="action-plan-review-advisory-limitations-heading" className="text-sm font-semibold text-zinc-200">Limitations and human review</h5>
              <ul className="mt-2 space-y-2 text-sm text-zinc-400">
                {advisory.advisory.proposal.limitations.map((limitation, index) => <li key={`${limitation}-${index}`}>{limitation}</li>)}
              </ul>
              <p className="mt-3 text-sm text-zinc-300">The human reviewer may disagree with this recommendation. Approve and Return remain independent human-controlled actions.</p>
            </section>
          </div>
        ) : null}
      </section>

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
      {stepUpOpen ? <FreshTotpStepUp open={stepUpOpen} title={stepUpTitle} description="Fresh step-up authentication is required for this controlled CAPA decision." onCancel={() => { setStepUpOpen(false); setAttempt(null); }} onVerified={() => { setStepUpOpen(false); if (attempt) void submit(attempt); }} /> : null}
    </section>
  );
}
