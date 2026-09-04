"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapaParticipant } from "./capa-participant-client";
import CapaParticipantSelector from "./CapaParticipantSelector";
import type { InvestigationPlanDraft } from "./capa-investigation-plan-draft";
import {
  integrateAdoptedInvestigationPlanItems,
} from "./capa-investigation-plan-draft";
import {
  buildCapaInvestigationPlanningAdvisoryRequest,
  fetchCapaInvestigationPlanningAdvisory,
  type CapaInvestigationPlanningAdvisorySuccess,
} from "./capa-investigation-planning-advisory-client";
import {
  createInvestigationPlanningAdoptionAttempt,
  submitInvestigationPlanningAdoptionAttempt,
  type InvestigationPlanningAdoptionAttempt,
} from "./capa-investigation-planning-adoption-client";
import {
  buildCapaInvestigationPlanningAdvisoryReview,
  setCapaInvestigationPlanningAdvisoryReviewDependency,
  updateCapaInvestigationPlanningAdvisoryReviewCard,
  validateCapaInvestigationPlanningAdvisorySelection,
  type CapaInvestigationPlanningAdvisoryReviewCard,
} from "./capa-investigation-planning-advisory-review";

export interface CapaInvestigationPlanningAdvisoryPanelProps {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly currentVersionId: string;
  readonly recordVersion: number;
  readonly currentUserId: string;
  readonly participants: readonly CapaParticipant[];
  readonly draft: InvestigationPlanDraft;
  readonly disabled: boolean;
  readonly onDraftChange: (draft: InvestigationPlanDraft) => void;
  readonly onBusyChange?: (busy: boolean) => void;
}

const GENERIC_FAILURE = "The governed S30 advisory could not be completed. Please try again.";

function fingerprint(draft: InvestigationPlanDraft): string {
  return JSON.stringify(draft.items.map((item) => [
    item.itemId, item.investigationQuestion, item.evidenceTarget, item.investigationMethod,
    item.ownerUserId, item.dueDate, item.scopeRelationship, item.dependencyItemIds,
  ]));
}

export default function CapaInvestigationPlanningAdvisoryPanel({
  caseId, caseNumber, currentVersionId, recordVersion, currentUserId, participants,
  draft, disabled, onDraftChange, onBusyChange,
}: CapaInvestigationPlanningAdvisoryPanelProps) {
  const [focus, setFocus] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [advisory, setAdvisory] = useState<CapaInvestigationPlanningAdvisorySuccess | null>(null);
  const [cards, setCards] = useState<readonly CapaInvestigationPlanningAdvisoryReviewCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [adoptionAttempt, setAdoptionAttempt] = useState<InvestigationPlanningAdoptionAttempt | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adoptionMessage, setAdoptionMessage] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const draftFingerprint = useMemo(() => fingerprint(draft), [draft]);
  const latestDraftFingerprint = useRef(draftFingerprint);

  useEffect(() => {
    latestDraftFingerprint.current = draftFingerprint;
    setAdvisory(null);
    setCards([]);
    setCorrelationId(null);
    setError(null);
    setAdoptionAttempt(null);
    setAdoptionMessage(null);
    setRefreshRequired(false);
  }, [caseId, currentVersionId, recordVersion, focus, draftFingerprint]);

  useEffect(() => {
    onBusyChange?.(requesting || adopting);
  }, [adopting, onBusyChange, requesting]);

  async function generate() {
    if (disabled || requesting || adopting || adoptionAttempt !== null) return;
    setRequesting(true);
    setError(null);
    setAdoptionMessage(null);
    const request = buildCapaInvestigationPlanningAdvisoryRequest(focus, draft);
    const result = await fetchCapaInvestigationPlanningAdvisory(caseId, request);
    if (latestDraftFingerprint.current !== draftFingerprint) {
      setError("The working draft changed while the advisory was generated. Generate a new advisory.");
      setRequesting(false);
      return;
    }
    if ("advisory" in result) {
      if (result.snapshot.capaCaseId !== caseId || result.snapshot.caseVersionId !== currentVersionId ||
        result.snapshot.recordVersion !== recordVersion) {
        setAdvisory(null);
        setCards([]);
        setError("The CAPA version changed while the advisory was generated. Refresh the case and generate a new advisory.");
        setRefreshRequired(true);
      } else {
        const built = buildCapaInvestigationPlanningAdvisoryReview(result.advisory.proposal);
        if (!built.valid) {
          setAdvisory(null);
          setCards([]);
          setError(built.message);
        } else {
          setAdvisory(result);
          setCards(built.cards);
          setCorrelationId(result.correlationId);
        }
      }
    } else {
      setAdvisory(null);
      setCards([]);
      setError(result.message || GENERIC_FAILURE);
      setCorrelationId(result.correlationId);
      setRefreshRequired(result.code === "CAPA_ADVISORY_CASE_CHANGED");
    }
    setRequesting(false);
  }

  function updateCard(proposalKey: CapaInvestigationPlanningAdvisoryReviewCard["proposalKey"],
    changes: Partial<Pick<CapaInvestigationPlanningAdvisoryReviewCard, "investigationQuestion" | "evidenceTarget" |
      "investigationMethod" | "scopeRelationship" | "ownerUserId" | "dueDate" | "selected">>) {
    setCards((value) => updateCapaInvestigationPlanningAdvisoryReviewCard(value, proposalKey, changes));
  }

  async function adoptSelected() {
    if (disabled || requesting || adopting || advisory === null) return;
    const selection = validateCapaInvestigationPlanningAdvisorySelection(cards);
    if (!selection.valid) {
      setError(selection.message);
      return;
    }
    const attempt = adoptionAttempt ?? createInvestigationPlanningAdoptionAttempt({
      caseId,
      currentVersionId,
      recordVersion,
      outputId: advisory.advisory.outputId,
      selectedItems: selection.selectedItems,
      idempotencyKey: crypto.randomUUID(),
      currentUserId,
    });
    if (attempt === null) {
      setError("The adoption request could not be prepared.");
      return;
    }
    setAdoptionAttempt(attempt);
    setAdopting(true);
    setError(null);
    const result = await submitInvestigationPlanningAdoptionAttempt(attempt);
    if (result.status === "adopted" || result.status === "already_adopted") {
      const next = integrateAdoptedInvestigationPlanItems(draft, result.records,
        () => `INV-${crypto.randomUUID()}`);
      if (next === null) {
        setError("The trusted adoption response could not be integrated into the draft.");
      } else {
        onDraftChange(next);
        setAdoptionMessage(`${result.records.length} item${result.records.length === 1 ? "" : "s"} adopted into the working draft.`);
        setAdvisory(null);
        setCards([]);
        setAdoptionAttempt(null);
      }
    } else if (result.status === "failed") {
      setError(result.message);
      setRefreshRequired(result.requiresRefresh);
      if (!result.retryableExact) setAdoptionAttempt(null);
    }
    setAdopting(false);
  }

  return <section className="mt-7 rounded-2xl border border-sky-400/20 bg-sky-500/[0.04] p-4 sm:p-6">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Governed AI assistance</p>
    <h3 className="mt-2 text-xl font-semibold text-zinc-100">AI Investigation Planning</h3>
    <p className="mt-2 text-sm leading-6 text-zinc-400">
      Optional advisory only for {caseNumber}. Human review is required. AI does not release the investigation,
      perform G-03, select the authoritative owner, or mutate controlled CAPA workflow. Adoption records a human decision only.
    </p>
    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="block flex-1 text-sm text-zinc-200"><span className="font-medium">Optional analysis focus</span>
        <input value={focus} maxLength={1000} disabled={disabled || requesting || adopting || adoptionAttempt !== null}
          onChange={(event) => setFocus(event.target.value)}
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50" /></label>
      <button type="button" onClick={() => void generate()} disabled={disabled || requesting || adopting || adoptionAttempt !== null || refreshRequired}
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-sky-300/40 bg-sky-400/15 px-4 py-2.5 text-sm font-semibold text-sky-100 disabled:opacity-50">
        {requesting ? "Generating…" : "Generate advisory"}
      </button>
    </div>
    {error !== null ? <div role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}{refreshRequired ? " Refresh the authoritative CAPA before trying again." : ""}</div> : null}
    {adoptionMessage !== null ? <div role="status" className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">{adoptionMessage}</div> : null}
    {advisory !== null ? <div className="mt-6 rounded-2xl border border-sky-300/20 bg-zinc-950/50 p-4 sm:p-5">
      <div className="rounded-xl border border-sky-300/25 bg-sky-400/10 p-3 text-sm text-sky-100">
        <p className="font-semibold">Advisory only — human review required</p>
        <p className="mt-1 text-xs leading-5 text-sky-200/80">This output has not changed the CAPA workflow or controlled S30 record.</p>
      </div>
      <div className="mt-5 space-y-4">{cards.map((card) => <ReviewCard key={card.proposalKey} card={card}
        cards={cards} participants={participants} currentUserId={currentUserId} disabled={disabled || requesting || adopting || adoptionAttempt !== null}
        onUpdate={updateCard} onDependency={(dependent, prerequisite, selected) => {
          const next = setCapaInvestigationPlanningAdvisoryReviewDependency(cards, dependent, prerequisite, selected);
          if (next === null) setError("That dependency is invalid, duplicated, or creates a cycle."); else setCards(next);
        }} />)}</div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <button type="button" onClick={() => void adoptSelected()} disabled={disabled || requesting || adopting || refreshRequired || cards.length === 0}
          className="min-h-11 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{adopting ? "Adopting…" : adoptionAttempt ? "Retry exact adoption" : "Adopt selected into draft"}</button>
        {correlationId !== null ? <span className="text-[11px] text-zinc-600">Correlation ID: {correlationId}</span> : null}
      </div>
      <Guidance result={advisory} />
    </div> : null}
  </section>;
}

function ReviewCard({ card, cards, participants, currentUserId, disabled, onUpdate, onDependency }: {
  readonly card: CapaInvestigationPlanningAdvisoryReviewCard;
  readonly cards: readonly CapaInvestigationPlanningAdvisoryReviewCard[];
  readonly participants: readonly CapaParticipant[];
  readonly currentUserId: string;
  readonly disabled: boolean;
  readonly onUpdate: (key: CapaInvestigationPlanningAdvisoryReviewCard["proposalKey"], changes: Partial<Pick<CapaInvestigationPlanningAdvisoryReviewCard, "investigationQuestion" | "evidenceTarget" | "investigationMethod" | "scopeRelationship" | "ownerUserId" | "dueDate" | "selected">>) => void;
  readonly onDependency: (dependent: CapaInvestigationPlanningAdvisoryReviewCard["proposalKey"], prerequisite: CapaInvestigationPlanningAdvisoryReviewCard["proposalKey"], selected: boolean) => void;
}) {
  return <article className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
    <label className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><input type="checkbox" checked={card.selected} disabled={disabled} onChange={(event) => onUpdate(card.proposalKey, { selected: event.target.checked })} />
      Adopt proposal <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-sky-200">{card.proposalKey}</span></label>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <Editable label="Investigation question" value={card.investigationQuestion} disabled={disabled} onChange={(value) => onUpdate(card.proposalKey, { investigationQuestion: value })} />
      <Editable label="Evidence target" value={card.evidenceTarget} disabled={disabled} onChange={(value) => onUpdate(card.proposalKey, { evidenceTarget: value })} />
      <Editable label="Investigation method" value={card.investigationMethod} disabled={disabled} onChange={(value) => onUpdate(card.proposalKey, { investigationMethod: value })} />
      <Editable label="Scope relationship" value={card.scopeRelationship} disabled={disabled} onChange={(value) => onUpdate(card.proposalKey, { scopeRelationship: value })} />
      <label className="text-sm text-zinc-300">Actual owner<CapaParticipantSelector participants={participants} currentUserId={currentUserId} value={card.ownerUserId} disabled={disabled} onChange={(value) => onUpdate(card.proposalKey, { ownerUserId: value })} /></label>
      <label className="text-sm text-zinc-300">Actual due date<input type="date" value={card.dueDate} disabled={disabled} onChange={(event) => onUpdate(card.proposalKey, { dueDate: event.target.value })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100" /></label>
    </div>
    <div className="mt-4 border-t border-zinc-800 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Advisory guidance</p>
      <p className="mt-1 text-xs text-zinc-400">Due-date consideration: {card.dueDateConsideration}</p>
      {card.proposedOwnerRole ? <p className="mt-1 text-xs text-zinc-400">Proposed owner role: {card.proposedOwnerRole} (guidance only)</p> : null}
      {card.suggestedSmeFunction ? <p className="mt-1 text-xs text-zinc-400">Suggested SME function: {card.suggestedSmeFunction}</p> : null}
      {card.humanReviewQuestions.length ? <ul className="mt-1 list-disc pl-4 text-xs text-zinc-400">{card.humanReviewQuestions.map((question) => <li key={question}>{question}</li>)}</ul> : null}
    </div>
    {cards.length > 1 ? <div className="mt-4"><p className="text-sm text-zinc-300">Proposal dependencies</p><div className="mt-2 flex flex-wrap gap-3">{cards.filter((candidate) => candidate.proposalKey !== card.proposalKey).map((candidate) => <label key={candidate.proposalKey} className="text-xs text-zinc-400"><input type="checkbox" checked={card.dependencyProposalKeys.includes(candidate.proposalKey)} disabled={disabled} onChange={(event) => onDependency(card.proposalKey, candidate.proposalKey, event.target.checked)} /> {candidate.proposalKey}</label>)}</div></div> : null}
  </article>;
}

function Editable({ label, value, disabled, onChange }: { readonly label: string; readonly value: string; readonly disabled: boolean; readonly onChange: (value: string) => void }) {
  return <label className="text-sm text-zinc-300">{label}<textarea value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100 disabled:opacity-50" /></label>;
}

function Guidance({ result }: { readonly result: CapaInvestigationPlanningAdvisorySuccess }) {
  return <div className="mt-5 grid gap-4 md:grid-cols-2"><GuidanceList title="Assumptions" values={result.advisory.assumptions.map((item) => `${item.related_area}: ${item.verification_question}`)} /><GuidanceList title="Uncertainties and limitations" values={result.advisory.uncertaintyAndLimitations.map((item) => `${item.category}: ${item.human_review_question}`)} /><GuidanceList title="Gaps" values={result.advisory.proposal.gaps.map((item) => `${item.gap}: ${item.human_review_question}`)} /><GuidanceList title="Warnings" values={result.advisory.warnings} /></div>;
}

function GuidanceList({ title, values }: { readonly title: string; readonly values: readonly string[] }) {
  return <section><h4 className="text-sm font-semibold text-zinc-200">{title}</h4>{values.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-400">{values.map((value) => <li key={value}>{value}</li>)}</ul> : <p className="mt-1 text-xs text-zinc-500">None returned.</p>}</section>;
}
