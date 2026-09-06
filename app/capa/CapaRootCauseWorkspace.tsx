"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapaInvestigationPlanContent } from "../../lib/capa/domain/capa-investigation-plan";
import type { CapaEvidenceAssumptionLedgerContent, CapaEvidenceAssumptionLedgerItem, CapaLedgerInformationClass } from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import { CAPA_ASSUMPTION_STATUSES, CAPA_CONFLICT_STATUSES, CAPA_EVIDENCE_STATUSES, CAPA_GAP_STATUSES } from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import { CAPA_CAUSAL_HYPOTHESIS_STATUSES, CAPA_CAUSAL_ROLES, type CapaCausalHypothesis, type CapaRootCausePackageContent } from "../../lib/capa/domain/capa-root-cause-package";
import CapaInvestigationProgressPanel from "./CapaInvestigationProgressPanel";
import CapaInvestigationActiveAdvisoryPanel from "./CapaInvestigationActiveAdvisoryPanel";
import { CAPA_LEDGER_INFORMATION_CLASSES, addHypothesis, addLedgerItem, applyRootCauseDraftMutation, clearRootCauseNotConfirmed,
  createHypothesis, createInitialLedgerDraft, createInitialRootCausePackageDraft, createLedgerItem,
  isValidCurrentUserId, removeHypothesis, removeLedgerItem, setRootCauseNotConfirmed, updateHypothesis, updateLedgerItem,
  validateRootCauseDrafts } from "./capa-root-cause-draft";
import type { CapaInvestigationActiveAdoptionSafeRecord } from "./capa-investigation-active-adoption-client";
import type { CapaInvestigationActiveHumanCausalRole } from "./capa-investigation-active-advisory-review";
import { createRootCauseSubmissionAttempt, submitRootCauseSubmissionAttempt,
  type RootCauseSubmissionAttempt } from "./capa-root-cause-submission-client";
import { createCapaInvestigationActiveWorkspaceAutosaveCoordinator, loadCapaInvestigationActiveWorkspace,
  saveCapaInvestigationActiveWorkspace, reconcileCapaInvestigationActiveWorkspaceAdoptions, type WorkspaceAutosaveStatus, type CapaInvestigationActiveWorkspaceProjection } from "./capa-investigation-active-workspace-client";

const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const ADOPTED_AI_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isAdoptedAi = (provenance: { readonly source_type: string; readonly source_reference: string | null; readonly adopted_by_user_id: string | null; readonly adopted_at: string | null }) => provenance.source_type === "ai_proposal" && provenance.source_reference !== null && ADOPTED_AI_UUID.test(provenance.source_reference) && provenance.adopted_by_user_id !== null && provenance.adopted_at !== null;
const toggle = (values: readonly string[], value: string, checked: boolean) =>
  checked ? [...values, value] : values.filter((entry) => entry !== value);
export const normalizedLedgerReferenceIds = (value: string): readonly string[] =>
  Object.freeze([...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))]);
const blockerText: Record<string, string> = {
  OPEN_INVESTIGATION_PLAN_ITEM: "Complete, disposition, or cancel every investigation item.",
  UNRESOLVED_CRITICAL_EVIDENCE_GAP: "Resolve every critical evidence gap.",
  UNRESOLVED_MATERIAL_CONTRADICTION: "Resolve every material contradiction.",
  OPEN_MATERIAL_ASSUMPTION: "Resolve every material assumption.",
  INVALID_EVIDENCE_RELIED_UPON: "A causal hypothesis relies on invalid evidence.",
  UNSUPPORTED_CAUSAL_HYPOTHESIS: "A causal hypothesis lacks supporting evidence.",
  UNRESOLVED_MATERIAL_ALTERNATIVE: "Resolve material alternative hypotheses.",
  ROOT_CAUSE_PACKAGE_INCOMPLETE: "Confirm a proposed root cause or record that root cause was not confirmed.",
  AI_PROPOSAL_NOT_HUMAN_ADOPTED: "A human must adopt every relied-upon AI proposal.",
};
const canonicalForReason: Readonly<Record<string, string>> = {
  UNRESOLVED_CRITICAL_EVIDENCE_GAP: "B-02",
  UNRESOLVED_MATERIAL_CONTRADICTION: "B-03",
  OPEN_MATERIAL_ASSUMPTION: "B-04",
  INVALID_EVIDENCE_RELIED_UPON: "B-06",
};
const shown = (value: string | boolean | null) => value === null ? "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : value;
const shownIds = (values: readonly string[]) => values.length ? values.join(", ") : "—";
function aiSourceReferences(ledger: CapaEvidenceAssumptionLedgerContent, rootPackage: CapaRootCausePackageContent): ReadonlySet<string> {
  const references = new Set<string>();
  for (const item of ledger.items) if (item.provenance.source_type === "ai_proposal" && item.provenance.source_reference !== null) references.add(item.provenance.source_reference);
  for (const hypothesis of rootPackage.hypotheses) if (hypothesis.provenance.source_type === "ai_proposal" && hypothesis.provenance.source_reference !== null) references.add(hypothesis.provenance.source_reference);
  return references;
}

function ReadOnlyLedgerItem({ item }: { readonly item: CapaEvidenceAssumptionLedgerItem }) {
  return <article className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
    <h3 className="font-semibold">{item.item_id} · {readable(item.information_class)}</h3>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-zinc-500">Statement</dt><dd>{item.statement}</dd></div>
      <div><dt className="text-zinc-500">Evidence status</dt><dd>{shown(item.evidence_status)}</dd></div>
      <div><dt className="text-zinc-500">Assumption status</dt><dd>{shown(item.assumption_status)}</dd></div>
      <div><dt className="text-zinc-500">Gap status</dt><dd>{shown(item.gap_status)}</dd></div>
      <div><dt className="text-zinc-500">Conflict status</dt><dd>{shown(item.conflict_status)}</dd></div>
      <div><dt className="text-zinc-500">Provenance</dt><dd>{readable(item.provenance.source_type)}</dd></div>
      <div><dt className="text-zinc-500">Source reference</dt><dd>{shown(item.provenance.source_reference)}</dd></div>
      <div><dt className="text-zinc-500">Owner</dt><dd>{item.owner_user_id ? `Participant …${item.owner_user_id.slice(-8)}` : "—"}</dd></div>
      <div><dt className="text-zinc-500">Information date</dt><dd>{shown(item.information_date)}</dd></div>
      <div><dt className="text-zinc-500">Source version</dt><dd>{shown(item.source_version)}</dd></div>
      <div><dt className="text-zinc-500">Context</dt><dd>{shown(item.context)}</dd></div>
      <div><dt className="text-zinc-500">Supporting items</dt><dd>{shownIds(item.supporting_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Contradictory items</dt><dd>{shownIds(item.contradictory_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Conflict items</dt><dd>{shownIds(item.conflict_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Material to conclusion</dt><dd>{shown(item.material_to_conclusion)}</dd></div>
      <div><dt className="text-zinc-500">Critical to conclusion</dt><dd>{shown(item.critical_to_conclusion)}</dd></div>
      <div><dt className="text-zinc-500">Recommended next step</dt><dd>{shown(item.recommended_next_step)}</dd></div>
      <div><dt className="text-zinc-500">Target date</dt><dd>{shown(item.target_date)}</dd></div>
      {item.human_disposition ? <div className="sm:col-span-2"><dt className="text-zinc-500">Human disposition</dt><dd>{item.human_disposition.rationale} · Participant …{item.human_disposition.user_id.slice(-8)} · {item.human_disposition.disposition_at}</dd></div> : null}
    </dl>
  </article>;
}

function ReadOnlyHypothesis({ hypothesis }: { readonly hypothesis: CapaCausalHypothesis }) {
  return <article className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
    <h3 className="font-semibold">{hypothesis.hypothesis_id}</h3>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-zinc-500">Statement</dt><dd>{hypothesis.statement}</dd></div>
      <div><dt className="text-zinc-500">Status</dt><dd>{readable(hypothesis.status)}</dd></div>
      <div><dt className="text-zinc-500">Causal role</dt><dd>{readable(hypothesis.causal_role)}</dd></div>
      <div className="sm:col-span-2"><dt className="text-zinc-500">Rationale</dt><dd>{hypothesis.rationale}</dd></div>
      <div><dt className="text-zinc-500">Supporting evidence</dt><dd>{shownIds(hypothesis.supporting_evidence_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Contradictory evidence</dt><dd>{shownIds(hypothesis.contradictory_evidence_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Linked assumptions</dt><dd>{shownIds(hypothesis.linked_assumption_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Linked gaps</dt><dd>{shownIds(hypothesis.linked_gap_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Linked conflicts</dt><dd>{shownIds(hypothesis.linked_conflict_item_ids)}</dd></div>
      <div><dt className="text-zinc-500">Material to package</dt><dd>{shown(hypothesis.material_to_package)}</dd></div>
      <div><dt className="text-zinc-500">Responsible investigator</dt><dd>{hypothesis.responsible_user_id ? `Participant …${hypothesis.responsible_user_id.slice(-8)}` : "—"}</dd></div>
      <div><dt className="text-zinc-500">Provenance</dt><dd>{readable(hypothesis.provenance.source_type)}</dd></div>
    </dl>
  </article>;
}

export default function CapaRootCauseWorkspace({ caseId, caseNumber, plan, recordVersion, currentVersionId,
  currentUserId, mode, authoritativeLedger, authoritativeRootCausePackage, onAuthoritativeRefresh }: {
  readonly caseId: string; readonly caseNumber: string; readonly plan: CapaInvestigationPlanContent;
  readonly recordVersion: number; readonly currentVersionId: string; readonly currentUserId: string;
  readonly mode: "S40" | "S50"; readonly authoritativeLedger?: CapaEvidenceAssumptionLedgerContent;
  readonly authoritativeRootCausePackage?: CapaRootCausePackageContent;
  readonly onAuthoritativeRefresh: () => Promise<void>;
}) {
  const [ledger, setLedger] = useState(() => mode === "S50" ? authoritativeLedger ?? createInitialLedgerDraft() : createInitialLedgerDraft());
  const [rootPackage, setRootPackage] = useState(() => mode === "S50" ? authoritativeRootCausePackage ?? createInitialRootCausePackageDraft() : createInitialRootCausePackageDraft());
  const [newClass, setNewClass] = useState<CapaLedgerInformationClass>("verified_evidence");
  const [notConfirmed, setNotConfirmed] = useState(false);
  const [notConfirmedRationale, setNotConfirmedRationale] = useState("");
  const [notConfirmedSteps, setNotConfirmedSteps] = useState("");
  const [attempt, setAttempt] = useState<RootCauseSubmissionAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<readonly string[]>([]);
  const [hydrationStatus, setHydrationStatus] = useState<"loading" | "ready" | "failed">(mode === "S50" ? "ready" : "loading");
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceAutosaveStatus | "loading">(mode === "S50" ? "saved" : "loading");
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const coordinatorRef = useRef<ReturnType<typeof createCapaInvestigationActiveWorkspaceAutosaveCoordinator> | null>(null);
  const ledgerRef = useRef(ledger);
  const rootPackageRef = useRef(rootPackage);
  const acknowledgedAiReferencesRef = useRef<ReadonlySet<string>>(new Set());
  ledgerRef.current = ledger;
  rootPackageRef.current = rootPackage;

  const validation = useMemo(() => validateRootCauseDrafts(plan, ledger, rootPackage), [plan, ledger, rootPackage]);
  const readOnly = mode === "S50";
  const displayLedger = readOnly ? authoritativeLedger ?? createInitialLedgerDraft() : ledger;
  const displayRootPackage = readOnly ? authoritativeRootCausePackage ?? createInitialRootCausePackageDraft() : rootPackage;
  const references = displayLedger.items;
  const attributionAvailable = isValidCurrentUserId(currentUserId);
  const hydrated = readOnly || hydrationStatus === "ready";
  const editingDisabled = !readOnly && (!hydrated || !attributionAvailable || workspaceStatus === "conflict");
  const submissionBlocked = !readOnly && (!hydrated || workspaceStatus !== "saved" || coordinatorRef.current?.isBusy() === true);
  useEffect(() => {
    if (readOnly) return;
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({
      save: (value) => saveCapaInvestigationActiveWorkspace(caseId, value),
      onStatus: setWorkspaceStatus,
      onSaved: (workspace) => {
        setDraftRevision(workspace.draft_revision);
        acknowledgedAiReferencesRef.current = aiSourceReferences(workspace.evidence_assumption_ledger, workspace.root_cause_package);
      },
    });
    coordinatorRef.current = coordinator;
    return () => { coordinator.dispose(); if (coordinatorRef.current === coordinator) coordinatorRef.current = null; };
  }, [caseId, readOnly]);
  useEffect(() => {
    if (readOnly) { setHydrationStatus("ready"); setWorkspaceStatus("saved"); return; }
    let active = true;
    setHydrationStatus("loading"); setWorkspaceStatus("loading"); setError(null); setAttempt(null);
    const initialLedger = createInitialLedgerDraft();
    const initialRootPackage = createInitialRootCausePackageDraft();
    ledgerRef.current = initialLedger; rootPackageRef.current = initialRootPackage;
    setLedger(initialLedger); setRootPackage(initialRootPackage); setDraftRevision(null);
    acknowledgedAiReferencesRef.current = new Set(); coordinatorRef.current?.resetFromServer(null);
    void loadCapaInvestigationActiveWorkspace(caseId).then(async (result) => {
      if (!active) return;
      if (result.status === "failed") { setHydrationStatus("failed"); setWorkspaceStatus("failed"); setError("The durable S40 workspace could not be loaded. Editing remains disabled."); return; }
      const reconciled = await reconcileCapaInvestigationActiveWorkspaceAdoptions(caseId);
      if (!active) return;
      if (reconciled.status === "failed") { setHydrationStatus("failed"); setWorkspaceStatus("failed"); setError("The durable S40 workspace could not be reconciled. Editing remains disabled."); return; }
      const loadedLedger = reconciled.workspace?.evidence_assumption_ledger ?? initialLedger;
      const loadedRootPackage = reconciled.workspace?.root_cause_package ?? initialRootPackage;
      ledgerRef.current = loadedLedger; rootPackageRef.current = loadedRootPackage;
      setLedger(loadedLedger); setRootPackage(loadedRootPackage);
      const loadedRevision = reconciled.workspace?.draft_revision ?? null;
      setDraftRevision(loadedRevision); coordinatorRef.current?.resetFromServer(loadedRevision);
      acknowledgedAiReferencesRef.current = aiSourceReferences(loadedLedger, loadedRootPackage);
      setHydrationStatus("ready"); setWorkspaceStatus("saved");
    });
    return () => { active = false; };
  }, [caseId, readOnly]);
  const queueWorkspaceSave = (nextLedger: typeof ledger, nextRootPackage: typeof rootPackage) => {
    if (readOnly || !hydrated || coordinatorRef.current === null) return;
    const aiReferences = aiSourceReferences(nextLedger, nextRootPackage);
    if ([...aiReferences].some((reference) => !acknowledgedAiReferencesRef.current.has(reference))) {
      coordinatorRef.current.markBlocked();
      return;
    }
    const candidateValidation = validateRootCauseDrafts(plan, nextLedger, nextRootPackage);
    if (candidateValidation.status !== "valid") { coordinatorRef.current.markInvalid(); return; }
    coordinatorRef.current.queue({ evidence_assumption_ledger: candidateValidation.ledger, root_cause_package: candidateValidation.rootCausePackage });
  };
  const mutateLedger = (mutation: (value: typeof ledger) => typeof ledger) => {
    const next = applyRootCauseDraftMutation(ledgerRef.current, mutation).draft;
    ledgerRef.current = next; setAttempt(null); setLedger(next); queueWorkspaceSave(next, rootPackageRef.current);
  };
  const mutateRootPackage = (mutation: (value: typeof rootPackage) => typeof rootPackage) => {
    const next = applyRootCauseDraftMutation(rootPackageRef.current, mutation).draft;
    rootPackageRef.current = next; setAttempt(null); setRootPackage(next); queueWorkspaceSave(ledgerRef.current, next);
  };
  const setLedgerItem = (itemId: string, patch: Parameters<typeof updateLedgerItem>[2]) => {
    mutateLedger((value) => updateLedgerItem(value, itemId, patch, currentUserId));
  };
  const setHypothesis = (hypothesisId: string, patch: Parameters<typeof updateHypothesis>[2]) => {
    mutateRootPackage((value) => updateHypothesis(value, hypothesisId, patch, currentUserId));
  };
  async function submit(target: RootCauseSubmissionAttempt) {
    setSubmitting(true); setError(null); setReasons([]);
    const result = await submitRootCauseSubmissionAttempt(target);
    if (result.status === "submitted") {
      setAttempt(null); await onAuthoritativeRefresh();
    } else {
      setError(result.message); setReasons(result.reasons);
      if (result.requiresRefresh) { setAttempt(null); await onAuthoritativeRefresh(); }
      else if (!result.retryableExact) setAttempt(null);
    }
    setSubmitting(false);
  }
  function beginSubmission() {
    if (validation.status !== "valid" || validation.readiness.status !== "ready_for_review") return;
    const next = createRootCauseSubmissionAttempt({ caseId, recordVersion, currentVersionId,
      ledger: validation.ledger, rootCausePackage: validation.rootCausePackage, idempotencyKey: crypto.randomUUID() });
    if (next === null) { setError("The root-cause submission could not be prepared."); return; }
    setAttempt(next); void submit(next);
  }
  function applyAdopted(_records: readonly CapaInvestigationActiveAdoptionSafeRecord[], _roles: Readonly<Record<string, CapaInvestigationActiveHumanCausalRole>>, workspace: CapaInvestigationActiveWorkspaceProjection) {
    ledgerRef.current = workspace.evidence_assumption_ledger; rootPackageRef.current = workspace.root_cause_package;
    setAttempt(null); setLedger(workspace.evidence_assumption_ledger); setRootPackage(workspace.root_cause_package); setDraftRevision(workspace.draft_revision); acknowledgedAiReferencesRef.current = aiSourceReferences(workspace.evidence_assumption_ledger, workspace.root_cause_package); coordinatorRef.current?.resetFromServer(workspace.draft_revision); setWorkspaceStatus("saved"); setError(null);
  }

  return <section aria-labelledby="root-cause-workspace-heading" className="mt-8 space-y-6">
    <header><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{readOnly ? "S50 · Submitted read-only record" : "S40 · Investigation Active"}</p>
      <h2 id="root-cause-workspace-heading" className="mt-2 text-2xl font-semibold">{readOnly ? "Root Cause Review" : `Root Cause Workspace — ${caseNumber}`}</h2></header>
    {!readOnly && hydrationStatus === "loading" ? <p role="status" className="rounded-xl border border-blue-400/25 bg-blue-500/10 p-3 text-sm text-blue-100">Loading durable workspace…</p> : null}
    {!readOnly && hydrationStatus === "failed" ? <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">The durable S40 workspace could not be loaded. Refresh or reload is required.</p> : null}
    {!readOnly && hydrationStatus === "ready" ? <p role="status" className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-300">Workspace persistence: {workspaceStatus === "loading" ? "Loading…" : workspaceStatus === "saving" ? "Saving…" : workspaceStatus === "unsaved" ? "Unsaved changes" : workspaceStatus === "conflict" ? "Conflict — reload required" : workspaceStatus === "failed" ? "Save failed" : workspaceStatus === "blocked" ? "Persistence blocked — governed adoption is required" : "Saved"}{draftRevision !== null ? ` · revision ${draftRevision}` : ""}</p> : null}
    {!attributionAvailable && !readOnly ? <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">Authenticated user identity is unavailable. Human-attributed ledger and root-cause actions are disabled.</p> : null}
    {!readOnly && hydrationStatus === "ready" && workspaceStatus === "failed" ? <button type="button" onClick={() => coordinatorRef.current?.retry()} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm">Retry workspace save</button> : null}
    <fieldset disabled={editingDisabled}>
    <CapaInvestigationProgressPanel caseId={caseId} plan={plan} recordVersion={recordVersion}
      currentVersionId={currentVersionId} readOnly={readOnly} onAuthoritativeRefresh={onAuthoritativeRefresh} />
    {!readOnly && hydrationStatus === "ready" ? <CapaInvestigationActiveAdvisoryPanel caseId={caseId} currentVersionId={currentVersionId}
      recordVersion={recordVersion} ledger={ledger} rootPackage={rootPackage} currentUserId={currentUserId}
      onApplyAdoptions={applyAdopted} /> : null}

    <section aria-labelledby="ledger-heading" className="rounded-3xl border border-zinc-800 bg-zinc-900/75 p-5 sm:p-7">
      <h2 id="ledger-heading" className="text-xl font-semibold">Evidence &amp; Assumption Ledger</h2>
      <p className="mt-2 text-sm text-zinc-400">{readOnly ? "Authoritative submitted ledger; read-only." : "Durable working draft; non-authoritative until root cause is submitted for review."}</p>
      {!readOnly ? <div className="mt-4 flex flex-wrap gap-3"><label className="text-sm">Information class<select value={newClass}
        onChange={(event) => setNewClass(event.target.value as CapaLedgerInformationClass)} className="ml-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2">
        {CAPA_LEDGER_INFORMATION_CLASSES.map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
        <button type="button" onClick={() => mutateLedger((value) => addLedgerItem(value, createLedgerItem(newClass, `LED-${crypto.randomUUID()}`)))}
          className="rounded-xl bg-zinc-700 px-4 py-2 text-sm">Add ledger item</button></div> : null}
      <div className="mt-5 space-y-4">{displayLedger.items.length === 0 ? <p className="text-sm text-zinc-500">No ledger items recorded.</p> : readOnly ? displayLedger.items.map((item) => <ReadOnlyLedgerItem key={item.item_id} item={item} />) : displayLedger.items.map((item) => {
        const resolved = (item.evidence_status !== null && item.evidence_status !== "current") ||
          (item.assumption_status !== null && item.assumption_status !== "open") || item.gap_status === "resolved" || item.conflict_status === "resolved";
        const adoptedAi = isAdoptedAi(item.provenance);
        return <fieldset key={item.item_id} disabled={readOnly || submitting} className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="flex justify-between gap-3"><legend className="font-semibold">{readable(item.information_class)}</legend>
            {!readOnly && !adoptedAi ? <button type="button" className="text-sm text-red-300" onClick={() => mutateLedger((value) => removeLedgerItem(value, item.item_id))}>Remove</button> : null}</div>
          <label className="mt-3 block text-sm">Statement<textarea value={item.statement} readOnly={readOnly || adoptedAi}
            onChange={(event) => setLedgerItem(item.item_id, { statement: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {item.evidence_status !== null ? <label className="text-sm">Evidence status<select value={item.evidence_status} disabled={!attributionAvailable} onChange={(event) => setLedgerItem(item.item_id, { evidence_status: event.target.value as typeof item.evidence_status })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2">{item.information_class === "verified_evidence" ? <option value="current" disabled>Choose a human-dispositioned status</option> : null}{CAPA_EVIDENCE_STATUSES.filter((value) => !(item.information_class === "verified_evidence" && value === "current")).map((value) => <option key={value}>{value}</option>)}</select></label> : null}
            {item.assumption_status !== null ? <label className="text-sm">Assumption status<select value={item.assumption_status} disabled={!attributionAvailable} onChange={(event) => setLedgerItem(item.item_id, { assumption_status: event.target.value as typeof item.assumption_status })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2">{CAPA_ASSUMPTION_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label> : null}
            {item.gap_status !== null ? <label className="text-sm">Gap status<select value={item.gap_status} disabled={!attributionAvailable} onChange={(event) => setLedgerItem(item.item_id, { gap_status: event.target.value as typeof item.gap_status })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2">{CAPA_GAP_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label> : null}
            {item.conflict_status !== null ? <label className="text-sm">Conflict status<select value={item.conflict_status} disabled={!attributionAvailable} onChange={(event) => setLedgerItem(item.item_id, { conflict_status: event.target.value as typeof item.conflict_status })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2">{CAPA_CONFLICT_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label> : null}
            {(item.information_class === "assumption" || item.information_class === "conflicting_information") ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.material_to_conclusion} onChange={(event) => setLedgerItem(item.item_id, { material_to_conclusion: event.target.checked })} />Material to conclusion</label> : null}
            {item.information_class === "missing_information" ? <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.critical_to_conclusion} onChange={(event) => setLedgerItem(item.item_id, { critical_to_conclusion: event.target.checked })} />Critical to conclusion</label>
              <label className="text-sm">Recommended next step<input readOnly={adoptedAi} value={item.recommended_next_step ?? ""} onChange={(event) => setLedgerItem(item.item_id, { recommended_next_step: event.target.value || null })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2" /></label>
              <label className="text-sm">Target date<input type="date" value={item.target_date ?? ""} onChange={(event) => setLedgerItem(item.item_id, { target_date: event.target.value || null })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2" /></label></> : null}
          </div>
          {item.information_class === "retrieved_reference" ? <label className="mt-3 block text-sm">Source reference<input value={item.provenance.source_reference ?? ""} onChange={(event) => setLedgerItem(item.item_id, { provenance: { ...item.provenance, source_reference: event.target.value || null } })} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" /></label> : null}
          {(item.information_class === "verified_evidence" || item.information_class === "assumption" || item.information_class === "missing_information" || item.information_class === "conflicting_information") ? <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Supporting item IDs<input value={item.supporting_item_ids.join(", ")} onChange={(event) => setLedgerItem(item.item_id, { supporting_item_ids: normalizedLedgerReferenceIds(event.target.value) })} placeholder="LED-1, LED-2" className="mt-1 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" /></label>
            {item.information_class !== "missing_information" ? <label className="text-sm">Contradictory item IDs<input value={item.contradictory_item_ids.join(", ")} onChange={(event) => setLedgerItem(item.item_id, { contradictory_item_ids: normalizedLedgerReferenceIds(event.target.value) })} placeholder="LED-3" className="mt-1 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" /></label> : null}
            {item.information_class === "conflicting_information" ? <label className="text-sm">Conflict item IDs (at least two)<input value={item.conflict_item_ids.join(", ")} onChange={(event) => setLedgerItem(item.item_id, { conflict_item_ids: normalizedLedgerReferenceIds(event.target.value) })} placeholder="LED-1, LED-2" className="mt-1 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" /></label> : null}
          </div> : null}
          {resolved ? <label className="mt-3 block text-sm">Human disposition rationale<textarea disabled={!attributionAvailable} value={item.human_disposition?.rationale ?? ""} onChange={(event) => setLedgerItem(item.item_id, { human_disposition: { user_id: currentUserId, disposition_at: new Date().toISOString(), rationale: event.target.value } })} className="mt-1 min-h-16 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /><span className="text-xs text-zinc-500">Attributed to You</span></label> : null}
        </fieldset>;
      })}</div>
    </section>

    <section aria-labelledby="root-package-heading" className="rounded-3xl border border-zinc-800 bg-zinc-900/75 p-5 sm:p-7">
      <h2 id="root-package-heading" className="text-xl font-semibold">Root-Cause Package</h2>
      <p className="mt-2 text-sm text-zinc-400">{readOnly ? "Authoritative submitted package; read-only." : "Human-authored causal hypotheses. No conclusion is inferred automatically."}</p>
      {!readOnly ? <button type="button" onClick={() => mutateRootPackage((value) => addHypothesis(value, createHypothesis(`HYP-${crypto.randomUUID()}`)))} className="mt-4 rounded-xl bg-zinc-700 px-4 py-2 text-sm">Add hypothesis</button> : null}
      <div className="mt-5 space-y-4">{displayRootPackage.hypotheses.length === 0 ? <p className="text-sm text-zinc-500">No hypotheses recorded.</p> : readOnly ? displayRootPackage.hypotheses.map((hypothesis) => <ReadOnlyHypothesis key={hypothesis.hypothesis_id} hypothesis={hypothesis} />) : displayRootPackage.hypotheses.map((hypothesis) => {
        const adoptedAi = isAdoptedAi(hypothesis.provenance);
        return <fieldset key={hypothesis.hypothesis_id} disabled={submitting} className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="flex justify-between"><legend className="font-semibold">{hypothesis.hypothesis_id}</legend>{!readOnly && !adoptedAi ? <button type="button" onClick={() => mutateRootPackage((value) => removeHypothesis(value, hypothesis.hypothesis_id))} className="text-sm text-red-300">Remove</button> : null}</div>
        <label className="mt-3 block text-sm">Statement<textarea readOnly={adoptedAi} value={hypothesis.statement} onChange={(event) => setHypothesis(hypothesis.hypothesis_id, { statement: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Status<select value={hypothesis.status} onChange={(event) => setHypothesis(hypothesis.hypothesis_id, { status: event.target.value as typeof hypothesis.status })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2">{CAPA_CAUSAL_HYPOTHESIS_STATUSES.filter((value) => attributionAvailable || value === "proposed").map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm">Causal role<select value={hypothesis.causal_role} disabled={adoptedAi} onChange={(event) => setHypothesis(hypothesis.hypothesis_id, { causal_role: event.target.value as typeof hypothesis.causal_role })} className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-2">{CAPA_CAUSAL_ROLES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hypothesis.material_to_package} onChange={(event) => setHypothesis(hypothesis.hypothesis_id, { material_to_package: event.target.checked })} />Material to package</label>
          <p className="text-sm text-zinc-400">Responsible investigator: {hypothesis.responsible_user_id ? "You" : "Assigned when human disposition is recorded"}</p></div>
        <label className="mt-3 block text-sm">Rationale<textarea readOnly={adoptedAi} value={hypothesis.rationale} onChange={(event) => setHypothesis(hypothesis.hypothesis_id, { rationale: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{([
          ["supporting_evidence_item_ids", ["verified_evidence", "user_provided_statement", "retrieved_reference"]],
          ["contradictory_evidence_item_ids", ["verified_evidence", "user_provided_statement", "retrieved_reference"]],
          ["linked_assumption_item_ids", ["assumption"]], ["linked_gap_item_ids", ["missing_information"]],
          ["linked_conflict_item_ids", ["conflicting_information"]],
        ] as const).map(([field, classes]) => <fieldset key={field}><legend className="text-sm text-zinc-400">{readable(field)}</legend>{references.filter((item) => (classes as readonly string[]).includes(item.information_class)).map((item) => <label key={item.item_id} className="mt-1 block text-xs"><input type="checkbox" checked={hypothesis[field].includes(item.item_id)} onChange={(event) => setHypothesis(hypothesis.hypothesis_id, { [field]: toggle(hypothesis[field], item.item_id, event.target.checked) })} /> {item.item_id}: {item.statement || "Untitled"}</label>)}</fieldset>)}</div>
      </fieldset>; })}</div>
      {!readOnly ? <div className="mt-5 rounded-2xl border border-zinc-800 p-4"><label className="flex gap-2 text-sm"><input type="checkbox" disabled={!attributionAvailable} checked={notConfirmed || rootPackage.root_cause_not_confirmed !== null} onChange={(event) => { setAttempt(null); setNotConfirmed(event.target.checked); if (!event.target.checked) mutateRootPackage(clearRootCauseNotConfirmed); }} />Record that root cause was not confirmed</label>
        {notConfirmed || rootPackage.root_cause_not_confirmed !== null ? <div className="mt-3"><label className="block text-sm">Conclusion rationale<textarea value={notConfirmedRationale || rootPackage.root_cause_not_confirmed?.rationale || ""} onChange={(event) => { setAttempt(null); setNotConfirmedRationale(event.target.value); }} className="mt-1 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
          <label className="mt-3 block text-sm">Next steps (one per line)<textarea value={notConfirmedSteps || rootPackage.root_cause_not_confirmed?.next_steps.join("\n") || ""} onChange={(event) => { setAttempt(null); setNotConfirmedSteps(event.target.value); }} className="mt-1 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3" /></label>
          <button type="button" disabled={!attributionAvailable} onClick={() => mutateRootPackage((value) => setRootCauseNotConfirmed(value, { rationale: notConfirmedRationale.trim(), nextSteps: notConfirmedSteps.split("\n").map((step) => step.trim()).filter(Boolean) }, currentUserId))} className="mt-3 rounded-xl border border-zinc-700 px-4 py-2 text-sm">Record human conclusion</button></div> : null}</div> : null}
      {readOnly && displayRootPackage.root_cause_not_confirmed ? <section aria-labelledby="not-confirmed-review-heading" className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] p-4">
        <h3 id="not-confirmed-review-heading" className="font-semibold">Root cause not confirmed</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-zinc-500">Rationale</dt><dd>{displayRootPackage.root_cause_not_confirmed.rationale}</dd></div>
          <div><dt className="text-zinc-500">Concluded by</dt><dd>Participant …{displayRootPackage.root_cause_not_confirmed.concluded_by_user_id.slice(-8)}</dd></div>
          <div><dt className="text-zinc-500">Concluded at</dt><dd>{displayRootPackage.root_cause_not_confirmed.concluded_at}</dd></div>
          <div><dt className="text-zinc-500">Provenance</dt><dd>{readable(displayRootPackage.root_cause_not_confirmed.provenance.source_type)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-zinc-500">Next steps</dt><dd><ul className="list-disc pl-5">{displayRootPackage.root_cause_not_confirmed.next_steps.map((step) => <li key={step}>{step}</li>)}</ul></dd></div>
        </dl>
      </section> : null}
    </section>

    {!readOnly ? <section aria-labelledby="readiness-heading" className="rounded-3xl border border-blue-400/20 bg-blue-500/[0.05] p-5 sm:p-7"><h2 id="readiness-heading" className="text-xl font-semibold">Advisory Readiness</h2>
      {validation.status === "invalid" ? <p role="alert" className="mt-3 text-red-300">{readable(validation.scope)} structure is invalid: {readable(validation.reasonCode)}{"path" in validation ? ` (${validation.path})` : ""}</p>
        : validation.readiness.status === "ready_for_review" ? <p className="mt-3 text-emerald-300">Ready to submit for root-cause review. The server will revalidate.</p>
          : <ul className="mt-3 space-y-2 text-sm text-amber-200">{validation.readiness.reason_codes.map((reason) => <li key={reason}>{canonicalForReason[reason] ?? ""} {reason}: {blockerText[reason]}</li>)}</ul>}
      {error ? <div role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200"><p>{error}</p>{reasons.length ? <ul className="mt-2 list-disc pl-5">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}{attempt ? <button type="button" disabled={submitting} onClick={() => void submit(attempt)} className="mt-2 underline">Retry exact submission</button> : null}</div> : null}
      <div className="mt-5 flex justify-end"><button type="button" disabled={!attributionAvailable || submitting || submissionBlocked || validation.status !== "valid" || validation.readiness.status !== "ready_for_review"}
        onClick={beginSubmission} className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold disabled:opacity-40">{submitting ? "Submitting…" : "Submit root cause for review"}</button></div>
    </section> : null}
    </fieldset>
  </section>;
}
