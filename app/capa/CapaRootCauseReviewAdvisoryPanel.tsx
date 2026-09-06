"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildCapaRootCauseReviewAdvisoryRequest,
  fetchCapaRootCauseReviewAdvisory,
  type CapaRootCauseReviewAdvisoryFailure,
  type CapaRootCauseReviewAdvisorySuccess,
} from "./capa-root-cause-review-advisory-client";

type AdvisoryResult = CapaRootCauseReviewAdvisorySuccess;

export interface CapaRootCauseReviewAdvisoryRequestIdentity {
  readonly token: number;
  readonly caseId: string;
  readonly expectedCaseVersionId: string;
  readonly expectedRecordVersion: number;
}

export function isCurrentCapaRootCauseReviewAdvisoryRequest(
  candidate: CapaRootCauseReviewAdvisoryRequestIdentity,
  current: CapaRootCauseReviewAdvisoryRequestIdentity,
): boolean {
  return candidate.token === current.token &&
    candidate.caseId === current.caseId &&
    candidate.expectedCaseVersionId === current.expectedCaseVersionId &&
    candidate.expectedRecordVersion === current.expectedRecordVersion;
}

export default function CapaRootCauseReviewAdvisoryPanel({ caseId, expectedCaseVersionId, expectedRecordVersion }: {
  readonly caseId: string;
  readonly expectedCaseVersionId: string;
  readonly expectedRecordVersion: number;
}) {
  const [result, setResult] = useState<AdvisoryResult | null>(null);
  const [failure, setFailure] = useState<CapaRootCauseReviewAdvisoryFailure | null>(null);
  const [requesting, setRequesting] = useState(false);
  const requestTokenRef = useRef(0);
  const snapshotRef = useRef({ caseId, expectedCaseVersionId, expectedRecordVersion });
  snapshotRef.current = { caseId, expectedCaseVersionId, expectedRecordVersion };

  useEffect(() => {
    setResult(null);
    setFailure(null);
    setRequesting(false);
  }, [caseId, expectedCaseVersionId, expectedRecordVersion]);

  async function generate() {
    if (requesting) return;
    const identity: CapaRootCauseReviewAdvisoryRequestIdentity = {
      token: ++requestTokenRef.current,
      caseId,
      expectedCaseVersionId,
      expectedRecordVersion,
    };
    setRequesting(true);
    setFailure(null);
    const response = await fetchCapaRootCauseReviewAdvisory(caseId, buildCapaRootCauseReviewAdvisoryRequest({
      expectedCaseVersionId,
      expectedRecordVersion,
    }));
    const currentIdentity = {
      token: requestTokenRef.current,
      ...snapshotRef.current,
    };
    if (!isCurrentCapaRootCauseReviewAdvisoryRequest(identity, currentIdentity)) return;
    if ("advisory" in response) {
      setResult(response);
    } else {
      setFailure(response);
    }
    setRequesting(false);
  }

  const advisory = result?.advisory;
  const proposal = advisory?.proposal;
  return <section aria-labelledby="s50-root-cause-review-advisory-heading" className="rounded-3xl border border-amber-400/30 bg-amber-500/5 p-5 sm:p-7">
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">S50 · Advisory review packet</p>
      <h2 id="s50-root-cause-review-advisory-heading" className="mt-2 text-xl font-semibold">Root Cause Review Advisory</h2>
      <p className="mt-2 text-sm text-zinc-300">Read-only advisory material for human review. This request does not change the submitted controlled record.</p>
    </header>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void generate()} disabled={requesting} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:cursor-wait disabled:opacity-60">
        {requesting ? "Generating advisory…" : result ? "Regenerate advisory" : "Generate advisory"}
      </button>
      {requesting ? <span role="status" className="text-sm text-zinc-400">Preparing the governed review packet…</span> : null}
    </div>
    {failure ? <div role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
      <p>{failure.message}</p>
      {failure.correlationId ? <p className="mt-1 text-xs text-red-200/70">Correlation ID: {failure.correlationId}</p> : null}
      <button type="button" onClick={() => void generate()} disabled={requesting} className="mt-3 rounded-xl border border-red-300/40 px-3 py-2 text-sm">Retry request</button>
    </div> : null}
    {advisory && proposal ? <div className="mt-6 space-y-6">
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
        <p className="font-semibold">Advisory only · human review required</p>
        <p className="mt-1">Status: {advisory.status} · Output ID: {advisory.output_id}</p>
      </div>
      <section aria-labelledby="s50-advisory-summary-heading">
        <h3 id="s50-advisory-summary-heading" className="font-semibold">Neutral review summary</h3>
        <p className="mt-2 text-sm text-zinc-300">{proposal.neutral_review_summary}</p>
      </section>
      {advisory.warnings.length ? <section aria-labelledby="s50-advisory-warnings-heading">
        <h3 id="s50-advisory-warnings-heading" className="font-semibold">Advisory warnings</h3>
        <ul className="mt-2 space-y-2 text-sm">{advisory.warnings.map((warning, index) => <li key={`${warning}-${index}`} className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3 text-amber-100">{warning}</li>)}</ul>
      </section> : null}
      <section aria-labelledby="s50-advisory-version-heading">
        <h3 id="s50-advisory-version-heading" className="font-semibold">Version comparison</h3>
        {proposal.version_changes.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No version changes reported.</p> : <ul className="mt-2 space-y-3 text-sm">{proposal.version_changes.map((change) => <li key={change.change_key} className="rounded-xl border border-zinc-800 p-3"><p className="font-medium">{change.subject} · {change.change_type}</p><p className="mt-1 text-zinc-400">Previous: {change.previous_value ?? "—"} · Current: {change.current_value ?? "—"}</p><p className="mt-1 text-zinc-400">Human review question: {change.human_review_question}</p>{change.reference_keys.length ? <p className="mt-1 text-xs text-zinc-500">References: {change.reference_keys.join(", ")}</p> : null}</li>)}</ul>}
      </section>
      <section aria-labelledby="s50-advisory-blockers-heading">
        <h3 id="s50-advisory-blockers-heading" className="font-semibold">Blockers and warnings</h3>
        {proposal.blockers_warnings.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No blockers or warnings reported.</p> : <ul className="mt-2 space-y-3 text-sm">{proposal.blockers_warnings.map((warning) => <li key={warning.warning_key} className="rounded-xl border border-zinc-800 p-3"><p className="font-medium">{warning.subject} · {warning.kind}</p><p className="mt-1 text-zinc-400">{warning.description}</p><p className="mt-1 text-zinc-400">Human review question: {warning.human_review_question}</p>{warning.reference_keys.length ? <p className="mt-1 text-xs text-zinc-500">References: {warning.reference_keys.join(", ")}</p> : null}</li>)}</ul>}
      </section>
      <section aria-labelledby="s50-advisory-evidence-heading">
        <h3 id="s50-advisory-evidence-heading" className="font-semibold">Evidence map</h3>
        {proposal.evidence_map.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No evidence relationships reported.</p> : <ul className="mt-2 space-y-3 text-sm">{proposal.evidence_map.map((entry) => <li key={entry.mapping_key} className="rounded-xl border border-zinc-800 p-3"><p className="font-medium">{entry.subject} · {entry.relationship}</p><p className="mt-1 text-zinc-400">{entry.description} · Source status: {entry.source_status}</p><p className="mt-1 text-zinc-400">Human review question: {entry.human_review_question}</p>{entry.evidence_reference_keys.length ? <p className="mt-1 text-xs text-zinc-500">References: {entry.evidence_reference_keys.join(", ")}</p> : null}</li>)}</ul>}
      </section>
      <section aria-labelledby="s50-advisory-uncertainty-heading">
        <h3 id="s50-advisory-uncertainty-heading" className="font-semibold">Uncertainty and limitations</h3>
        {advisory.uncertainty_and_limitations.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No additional limitations reported.</p> : <ul className="mt-2 space-y-2 text-sm">{advisory.uncertainty_and_limitations.map((item, index) => <li key={`${item.category}-${index}`} className="rounded-xl border border-zinc-800 p-3"><p>{item.category}</p><p className="mt-1 text-zinc-400">Human review question: {item.human_review_question}</p></li>)}</ul>}
      </section>
      <p className="text-xs text-zinc-500">Citations returned by the governed advisory: {advisory.citations.length}</p>
    </div> : null}
  </section>;
}
