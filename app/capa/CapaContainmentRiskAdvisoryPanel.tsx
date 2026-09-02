"use client";

import { useEffect, useMemo, useState } from "react";

import type { CapaContainmentRiskReviewDraft } from "./capa-containment-risk-review-draft";
import {
  buildCapaContainmentRiskAdvisoryDraft,
} from "./capa-containment-risk-review-draft";
import {
  buildCapaContainmentRiskAdvisoryRequest,
  parseCapaContainmentRiskAdvisoryFailure,
  parseCapaContainmentRiskAdvisorySuccess,
  type CapaContainmentRiskAdvisoryResult,
  type CapaContainmentRiskAdvisorySnapshot,
} from "./capa-containment-risk-advisory-client";

export interface CapaContainmentRiskAdvisoryPanelProps {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly currentVersionId: string;
  readonly recordVersion: number;
  readonly draft: CapaContainmentRiskReviewDraft;
  readonly disabled: boolean;
  readonly onRequestingChange?: (requesting: boolean) => void;
}

const GENERIC_FAILURE = "The governed S20 advisory could not be completed. Please try again.";

function createTraceId(): string {
  return crypto.randomUUID();
}

function advisoryDraftFingerprint(draft: CapaContainmentRiskReviewDraft): string {
  return JSON.stringify([
    draft.actionRows, draft.products, draft.processes, draft.dataImpact,
    draft.customerImpact, draft.patientImpact, draft.riskMethod,
    draft.riskTerminologyVersion, draft.riskResult, draft.riskRationale,
    draft.missingRiskInformation, draft.escalationRows,
  ]);
}

export default function CapaContainmentRiskAdvisoryPanel({
  caseId, caseNumber, currentVersionId, recordVersion, draft, disabled,
  onRequestingChange,
}: CapaContainmentRiskAdvisoryPanelProps) {
  const [focus, setFocus] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [advisory, setAdvisory] = useState<CapaContainmentRiskAdvisoryResult | null>(null);
  const [snapshot, setSnapshot] = useState<CapaContainmentRiskAdvisorySnapshot | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftFingerprint = useMemo(() => advisoryDraftFingerprint(draft), [draft]);

  useEffect(() => {
    setAdvisory(null);
    setSnapshot(null);
    setCorrelationId(null);
    setError(null);
  }, [draftFingerprint, focus]);

  async function generate() {
    if (disabled || isRequesting) return;
    const built = buildCapaContainmentRiskAdvisoryDraft(draft);
    if (!built.valid) {
      setError(`The advisory draft is incomplete: ${built.message}`);
      return;
    }

    const requestId = createTraceId();
    const browserCorrelationId = createTraceId();
    setIsRequesting(true);
    onRequestingChange?.(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/capa/${encodeURIComponent(caseId)}/containment-risk-advisory`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
            "x-correlation-id": browserCorrelationId,
          },
          body: JSON.stringify(buildCapaContainmentRiskAdvisoryRequest(focus, built.content)),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = parseCapaContainmentRiskAdvisoryFailure(body);
        setError(failure.message || GENERIC_FAILURE);
        setCorrelationId(failure.correlationId ?? browserCorrelationId);
        return;
      }

      const parsed = parseCapaContainmentRiskAdvisorySuccess(body);
      if (parsed === null) {
        setAdvisory(null);
        setSnapshot(null);
        setError(GENERIC_FAILURE);
        setCorrelationId(browserCorrelationId);
        return;
      }
      setCorrelationId(parsed.correlationId ?? browserCorrelationId);
      if (parsed.snapshot.capaCaseId !== caseId ||
        parsed.snapshot.caseVersionId !== currentVersionId ||
        parsed.snapshot.recordVersion !== recordVersion) {
        setAdvisory(null);
        setSnapshot(null);
        setError("The CAPA version changed while the advisory was generated. Refresh the case and generate a new advisory.");
        return;
      }
      setSnapshot(parsed.snapshot);
      setAdvisory(parsed.advisory);
    } catch {
      setAdvisory(null);
      setSnapshot(null);
      setCorrelationId(browserCorrelationId);
      setError(GENERIC_FAILURE);
    } finally {
      setIsRequesting(false);
      onRequestingChange?.(false);
    }
  }

  return (
    <section className="mt-7 rounded-2xl border border-sky-400/20 bg-sky-500/[0.04] p-4 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Governed AI assistance</p>
      <h3 className="mt-2 text-xl font-semibold text-zinc-100">AI Containment &amp; Impact/Risk Analysis</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Optional advisory only for {caseNumber}. Human review is required. This does not determine risk acceptability,
        accept containment, make G-02, advance workflow, or overwrite controlled S20 content.
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Unsaved working data may be included as <span className="font-medium text-zinc-300">untrusted human draft</span> data.
        Approval rationale is never sent to this advisory.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm text-zinc-200">
          <span className="font-medium">Optional analysis focus</span>
          <input value={focus} maxLength={1000} disabled={disabled || isRequesting}
            onChange={(event) => setFocus(event.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-sky-400 focus:outline-none disabled:opacity-50" />
        </label>
        <button type="button" onClick={generate} disabled={disabled || isRequesting}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-sky-300/40 bg-sky-400/15 px-4 py-2.5 text-sm font-semibold text-sky-100 disabled:cursor-not-allowed disabled:opacity-50">
          {isRequesting ? "Generating…" : "Generate advisory"}
        </button>
      </div>

      {error !== null ? <div role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
      {advisory !== null ? <AdvisoryResult result={advisory} correlationId={correlationId} snapshot={snapshot} /> : null}
    </section>
  );
}

function EmptyCategory({ label }: { readonly label: string }) {
  return <p className="mt-2 text-xs text-zinc-500">No advisory items were returned in {label}. This is not a determination of completeness or acceptability.</p>;
}

function AdvisoryResult({ result, correlationId, snapshot }: {
  readonly result: CapaContainmentRiskAdvisoryResult;
  readonly correlationId: string | null;
  readonly snapshot: CapaContainmentRiskAdvisorySnapshot | null;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-sky-300/20 bg-zinc-950/50 p-4 sm:p-5">
      <div className="rounded-xl border border-sky-300/25 bg-sky-400/10 p-3 text-sm text-sky-100">
        <p className="font-semibold">Advisory only — human review required</p>
        <p className="mt-1 text-xs leading-5 text-sky-200/80">This output has not changed the CAPA workflow or controlled S20 record.</p>
      </div>
      <ResultSection title="Missing risk inputs">
        {result.proposal.missingRiskInputs.length === 0 ? <EmptyCategory label="missing risk inputs" /> : result.proposal.missingRiskInputs.map((item) => <Item key={`${item.topic}-${item.humanReviewQuestion}`} label={item.topic} question={item.humanReviewQuestion} />)}
      </ResultSection>
      <ResultSection title="Missing impact dimensions">
        {result.proposal.missingImpactDimensions.length === 0 ? <EmptyCategory label="missing impact dimensions" /> : result.proposal.missingImpactDimensions.map((item) => <Item key={`${item.dimension}-${item.humanReviewQuestion}`} label={item.dimension} question={item.humanReviewQuestion} />)}
      </ResultSection>
      <ResultSection title="Human review questions">
        {result.proposal.humanReviewQuestions.length === 0 ? <EmptyCategory label="human review questions" /> : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">{result.proposal.humanReviewQuestions.map((item) => <li key={item}>{item}</li>)}</ul>}
      </ResultSection>
      <ResultSection title="Evidence/provenance gaps">
        {result.proposal.evidenceProvenanceGaps.length === 0 ? <EmptyCategory label="evidence/provenance gaps" /> : result.proposal.evidenceProvenanceGaps.map((item) => <Item key={`${item.category}-${item.humanReviewQuestion}`} label={item.category} question={item.humanReviewQuestion} />)}
      </ResultSection>
      <ResultSection title="Unverified assumptions">
        {result.assumptions.length === 0 ? <EmptyCategory label="unverified assumptions" /> : result.assumptions.map((item) => <Item key={`${item.relatedArea}-${item.verificationQuestion}`} label={`Unverified assumption · ${item.relatedArea}`} question={item.verificationQuestion} />)}
      </ResultSection>
      <ResultSection title="Uncertainty and limitations">
        {result.uncertaintyAndLimitations.length === 0 ? <EmptyCategory label="uncertainty and limitations" /> : result.uncertaintyAndLimitations.map((item) => <Item key={`${item.category}-${item.humanReviewQuestion}`} label={item.category} question={item.humanReviewQuestion} />)}
      </ResultSection>
      {correlationId !== null && snapshot !== null ? <p className="mt-5 text-[11px] text-zinc-600">Correlation ID: {correlationId}</p> : null}
    </div>
  );
}

function ResultSection({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return <section className="mt-5"><h4 className="text-sm font-semibold text-zinc-200">{title}</h4>{children}</section>;
}

function Item({ label, question }: { readonly label: string; readonly question: string }) {
  return <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-300"><div className="font-medium text-zinc-200">{label}</div><div className="mt-1 text-zinc-400">{question}</div></div>;
}
