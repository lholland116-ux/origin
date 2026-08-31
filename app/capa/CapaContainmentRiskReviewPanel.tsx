"use client";

import { type FormEvent, useState } from "react";
import type { CapaContainmentRiskContent } from "@/lib/capa/domain/capa-containment-risk";
import {
  buildCapaContainmentRiskReviewSubmission,
  EMPTY_CAPA_CONTAINMENT_RISK_REVIEW_DRAFT,
  type CapaContainmentRiskReviewDraft,
} from "./capa-containment-risk-review-draft";

export interface CapaContainmentRiskReviewPanelProps {
  readonly caseNumber: string;
  readonly busy: boolean;
  readonly blockerCodes: readonly string[];
  readonly onReview: (
    containmentRisk: CapaContainmentRiskContent,
    approvalRationale: string,
  ) => void;
}

const BLOCKER_LABELS: Readonly<Record<string, string>> = {
  MISSING_REQUIRED_CONTROLLED_DATA: "Required controlled S20 data is missing.",
  UNASSIGNED_CONTAINMENT: "An active containment action has no assigned owner.",
  UNRESOLVED_RISK_INFORMATION: "Risk information remains missing or unresolved.",
  OVERDUE_CONTAINMENT_CRITICALITY_UNRESOLVED:
    "Containment is overdue and its criticality cannot be established from controlled data.",
  REQUIRED_SEPARATE_ESCALATION_NOT_ADDRESSED:
    "A required separate escalation remains unaddressed.",
};

export default function CapaContainmentRiskReviewPanel({
  caseNumber, busy, blockerCodes, onReview,
}: CapaContainmentRiskReviewPanelProps) {
  const [draft, setDraft] = useState<CapaContainmentRiskReviewDraft>(
    EMPTY_CAPA_CONTAINMENT_RISK_REVIEW_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);

  function update(field: keyof CapaContainmentRiskReviewDraft, value: string) {
    if (busy) return;
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const built = buildCapaContainmentRiskReviewSubmission(draft);
    if (!built.valid) {
      setError(built.message);
      return;
    }
    setError(null);
    onReview(built.submission.containmentRisk, built.submission.approvalRationale);
  }

  return (
    <section className="mt-8 rounded-3xl border border-amber-400/20 bg-amber-500/[0.04] p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
        S20 · G-02 human review
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
        Containment and Impact/Risk
      </h2>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Record and review immediate controls, affected scope, organizational risk evaluation,
        and separate escalations for <span className="font-medium text-zinc-200">{caseNumber}</span>.
        AI does not determine the authoritative risk conclusion or accept G-02.
      </p>

      <div className="mt-6 rounded-2xl border border-zinc-700 bg-zinc-900/60 p-4">
        <h3 className="text-sm font-semibold text-zinc-100">G-02 review summary</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          Review immediate controls, the risk evaluation, escalations, and overdue work whose
          criticality remains unresolved. Server blockers cannot be bypassed.
        </p>
        {blockerCodes.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm text-amber-200">
            {blockerCodes.map((code) => (
              <li key={code}>• {BLOCKER_LABELS[code] ?? code}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">No server blocker result has been returned for this review attempt.</p>
        )}
      </div>

      <form onSubmit={submit} className="mt-7 space-y-6">
        <Field label="Immediate corrections and containment actions"
          helper="One per line: id | correction/containment | description | owner user ID | action date | target date | completed date | planned/in_progress/completed/cancelled | rationale | comma-separated evidence references"
          value={draft.actionRows} onChange={(v) => update("actionRows", v)} rows={6} />

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Affected/potentially affected products" value={draft.products} onChange={(v) => update("products", v)} />
          <Field label="Affected/potentially affected processes" value={draft.processes} onChange={(v) => update("processes", v)} />
          <Field label="Data impact" value={draft.dataImpact} onChange={(v) => update("dataImpact", v)} />
          <Field label="Customer impact" value={draft.customerImpact} onChange={(v) => update("customerImpact", v)} />
          <Field label="Patient impact" value={draft.patientImpact} onChange={(v) => update("patientImpact", v)} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Organizational risk method" value={draft.riskMethod} onChange={(v) => update("riskMethod", v)} rows={2} />
          <Field label="Risk terminology/version" value={draft.riskTerminologyVersion} onChange={(v) => update("riskTerminologyVersion", v)} rows={2} />
          <Field label="Risk result" value={draft.riskResult} onChange={(v) => update("riskResult", v)} rows={2} />
          <Field label="Risk rationale" value={draft.riskRationale} onChange={(v) => update("riskRationale", v)} rows={2} />
        </div>

        <Field label="Missing or unresolved risk information" value={draft.missingRiskInformation}
          onChange={(v) => update("missingRiskInformation", v)} />
        <Field label="Required risk/escalation records"
          helper="One per line: process | reference | status | rationale"
          value={draft.escalationRows} onChange={(v) => update("escalationRows", v)} />
        <Field label="Required human G-02 rationale" value={draft.approvalRationale}
          onChange={(v) => update("approvalRationale", v)} rows={3} />

        {error !== null ? <div role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
        <button type="submit" disabled={busy}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50">
          Review for G-02 acceptance
        </button>
      </form>
    </section>
  );
}

function Field({ label, helper, value, onChange, rows = 3 }: {
  readonly label: string; readonly helper?: string; readonly value: string;
  readonly onChange: (value: string) => void; readonly rows?: number;
}) {
  return <label className="block text-sm text-zinc-200">
    <span className="font-medium">{label}</span>
    {helper ? <span className="mt-1 block text-xs leading-5 text-zinc-500">{helper}</span> : null}
    <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows}
      className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none" />
  </label>;
}
