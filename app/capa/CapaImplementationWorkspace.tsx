"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_KINDS,
  type CapaImplementationEvidenceKind,
} from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import {
  CAPA_IMPLEMENTATION_PROVENANCE_ORIGIN_KINDS,
  CAPA_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KINDS,
  type CapaImplementationProvenanceOriginKind,
  type CapaImplementationProvenanceSourceSystemKind,
} from "../../lib/capa/implementation/capa-implementation-provenance-contract";
import {
  CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES,
  type CapaImplementationActionProgress,
  type CapaImplementationOwnerReportedStatus,
} from "../../lib/capa/implementation/capa-implementation-contract";
import type {
  CapaImplementationEvidence,
} from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import type {
  CapaImplementationEvidenceSource,
} from "../../lib/capa/implementation/capa-implementation-provenance-contract";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-return-response-contract";
import {
  createEmptyCapaImplementationEvidence,
  createInitialCapaImplementationWorkspaceDraft,
  emptyCapaImplementationEvidenceSource,
  generateCapaImplementationEvidenceAdvisory,
  loadCapaImplementationWorkspace,
  prepareCapaImplementationEvidenceAdvisoryAdoption,
  saveCapaImplementationWorkspace,
  submitCapaImplementationForReview,
  validateCapaImplementationWorkspaceForBrowser,
  type CapaImplementationApprovedActionProjection,
  type CapaImplementationEvidenceAdvisoryClientSuccess,
  type CapaImplementationWorkspaceProjection,
} from "./capa-implementation-workspace-client";

const STATUS_LABELS: Readonly<Record<CapaImplementationOwnerReportedStatus, string>> = {
  not_started: "Not started",
  in_progress: "In progress",
  reported_complete: "Owner-reported complete",
  blocked: "Blocked",
};
const EVIDENCE_LABELS: Readonly<Record<CapaImplementationEvidenceKind, string>> = {
  controlled_document: "Controlled document",
  training_record: "Training record",
  test_or_validation_result: "Test or validation result",
  inspection_or_observation: "Inspection or observation",
  change_control_record: "Change-control record",
  system_record: "System record",
  supplier_record: "Supplier record",
  external_record: "External record",
  other: "Other",
};
const ORIGIN_LABELS: Readonly<Record<CapaImplementationProvenanceOriginKind, string>> = {
  human_observation: "Human observation",
  lvtchat_record: "LVTChat record",
  uploaded_artifact: "Uploaded artifact",
  external_system: "External system",
  controlled_document: "Controlled document",
  other: "Other",
};
const SYSTEM_LABELS: Readonly<Record<CapaImplementationProvenanceSourceSystemKind, string>> = {
  lvtchat: "LVTChat",
  qms: "QMS",
  erp: "ERP",
  mes: "MES",
  plm: "PLM",
  lms: "LMS",
  lims: "LIMS",
  supplier_system: "Supplier system",
  other: "Other / not applicable",
};

interface CapaImplementationWorkspaceProps {
  readonly caseId: string;
  readonly caseNumber: string;
  readonly onSubmitted: () => Promise<void>;
}

function label(value: string | null, fallback = "Not provided"): string {
  return value === null || value.length === 0 ? fallback : value;
}

function updateProgress(
  progress: readonly CapaImplementationActionProgress[],
  reference: string,
  patch: Partial<CapaImplementationActionProgress>,
): readonly CapaImplementationActionProgress[] {
  return progress.map((item) => item.approved_action_reference === reference ? { ...item, ...patch } : item);
}

function updateEvidence(
  progress: readonly CapaImplementationActionProgress[],
  reference: string,
  evidenceId: string,
  patch: Partial<CapaImplementationEvidence>,
): readonly CapaImplementationActionProgress[] {
  return progress.map((item) => item.approved_action_reference !== reference ? item : { ...item, evidence: item.evidence.map((entry) => entry.evidence_id === evidenceId ? { ...entry, ...patch } : entry) });
}

function updateSource(
  progress: readonly CapaImplementationActionProgress[],
  reference: string,
  evidenceId: string,
  patch: Partial<CapaImplementationEvidenceSource>,
): readonly CapaImplementationActionProgress[] {
  return updateEvidence(progress, reference, evidenceId, { source: { ...progress.find((item) => item.approved_action_reference === reference)?.evidence.find((entry) => entry.evidence_id === evidenceId)?.source ?? emptyCapaImplementationEvidenceSource(), ...patch } });
}

function advisoryFingerprint(draft: CapaImplementationWorkspaceProjection["draft"]): string {
  return JSON.stringify(draft?.action_progress ?? []);
}

export default function CapaImplementationWorkspace({ caseId, caseNumber, onSubmitted }: CapaImplementationWorkspaceProps) {
  const [projection, setProjection] = useState<CapaImplementationWorkspaceProjection | null>(null);
  const [draft, setDraft] = useState<CapaImplementationWorkspaceProjection["draft"]>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [saveStatus, setSaveStatus] = useState<"saved" | "unsaved" | "saving" | "conflict" | "failed">("saved");
  const [submissionStatus, setSubmissionStatus] = useState<"idle" | "submitting" | "conflict" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function hydrate() {
    setLoadStatus("loading");
    setMessage(null);
    const result = await loadCapaImplementationWorkspace(caseId);
    if (result.status === "failed") {
      setLoadStatus("failed");
      setSaveStatus("failed");
      setMessage(result.message);
      return;
    }
    const nextDraft = result.workspace.draft ?? createInitialCapaImplementationWorkspaceDraft(result.workspace.approved_actions);
    setProjection(result.workspace);
    setDraft(nextDraft);
    setLoadStatus("ready");
    setSaveStatus(result.workspace.draft === null ? "unsaved" : "saved");
  }

  useEffect(() => { void hydrate(); }, [caseId]);

  const currentFingerprint = useMemo(() => advisoryFingerprint(draft), [draft]);

  function changeDraft(next: CapaImplementationWorkspaceProjection["draft"]) {
    setDraft(next);
    setSaveStatus("unsaved");
    setMessage(null);
  }

  function setStatus(reference: string, status: CapaImplementationOwnerReportedStatus) {
    if (draft === null) return;
    changeDraft({ ...draft, action_progress: updateProgress(draft.action_progress, reference, { owner_reported_status: status, blocked_reason: status === "blocked" ? draft.action_progress.find((item) => item.approved_action_reference === reference)?.blocked_reason ?? null : null }) });
  }

  function setNarrative(reference: string, value: string) {
    if (draft === null) return;
    changeDraft({ ...draft, action_progress: updateProgress(draft.action_progress, reference, { implementation_narrative: value.length === 0 ? null : value }) });
  }

  function setBlockedReason(reference: string, value: string) {
    if (draft === null) return;
    changeDraft({ ...draft, action_progress: updateProgress(draft.action_progress, reference, { blocked_reason: value.length === 0 ? null : value }) });
  }

  function addEvidence(reference: string) {
    if (draft === null) return;
    const evidence = createEmptyCapaImplementationEvidence(reference);
    changeDraft({ ...draft, action_progress: draft.action_progress.map((item) => item.approved_action_reference === reference ? { ...item, evidence: [...item.evidence, evidence] } : item) });
  }

  function removeEvidence(reference: string, evidenceId: string) {
    if (draft === null) return;
    changeDraft({ ...draft, action_progress: draft.action_progress.map((item) => item.approved_action_reference === reference ? { ...item, evidence: item.evidence.filter((entry) => entry.evidence_id !== evidenceId) } : item) });
  }

  async function save() {
    if (projection === null || draft === null || saveStatus === "saving") return;
    const validationMessage = validateCapaImplementationWorkspaceForBrowser(draft);
    if (validationMessage !== null) {
      setSaveStatus("failed");
      setMessage(validationMessage);
      return;
    }
    setSaveStatus("saving");
    setMessage(null);
    const result = await saveCapaImplementationWorkspace(caseId, {
      expected_draft_revision: projection.draft_revision,
      action_progress: draft.action_progress,
      ...(projection.implementation_review_return_cycle === null ? {} : {
        implementation_review_return_response: draft.implementation_review_return_response === null
          ? null
          : { response_narrative: draft.implementation_review_return_response.response_narrative },
      }),
    });
    if (result.status === "failed") {
      setSaveStatus(result.code === "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" || result.code === "WORKFLOW_MUTATION_DETECTED" ? "conflict" : "failed");
      setMessage(result.message);
      return;
    }
    setProjection(result.workspace);
    setDraft(result.workspace.draft);
    setSaveStatus("saved");
    setMessage("S80 implementation workspace saved.");
  }

  async function submitForReview() {
    if (projection === null || draft === null || projection.draft_revision === null || saveStatus !== "saved" || submissionStatus === "submitting") return;
    if (projection.implementation_review_return_cycle !== null &&
        (draft.implementation_review_return_response === null ||
          draft.implementation_review_return_response.response_narrative.trim().length === 0)) {
      setMessage("An owner response to the S90 reviewer return is required before resubmission.");
      return;
    }
    setSubmissionStatus("submitting");
    setMessage(null);
    const result = await submitCapaImplementationForReview(caseId, projection.draft_revision);
    if (result.status === "failed") {
      setSubmissionStatus(result.code === "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" || result.code === "CAPA_CONCURRENCY_CONFLICT" ? "conflict" : "failed");
      setMessage(result.message);
      return;
    }
    setSubmissionStatus("idle");
    setMessage("Submitted to Implementation Review.");
    await onSubmitted();
  }

  function adoptNarrative(reference: string, value: string) {
    if (draft === null) return;
    setNarrative(reference, value);
  }

  function setReturnResponse(value: string) {
    if (draft === null || projection === null || projection.implementation_review_return_cycle === null) return;
    const cycle = projection.implementation_review_return_cycle;
    changeDraft({
      ...draft,
      implementation_review_return_response: value.length === 0 ? null : {
          schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
          return_transition_audit_event_id: cycle.return_transition_audit_event_id as never,
          source_case_version_id: cycle.source_case_version_id as never,
          resulting_case_version_id: cycle.resulting_case_version_id as never,
          response_narrative: value,
        },
    });
  }

  if (loadStatus === "loading") return <section className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-900/85 p-6" aria-live="polite">Loading the S80 implementation workspace…</section>;
  if (loadStatus === "failed" || projection === null || draft === null) return <section className="mt-8 rounded-3xl border border-red-400/25 bg-red-500/10 p-6" role="alert"><h2 className="text-xl font-semibold text-red-100">S80 workspace unavailable</h2><p className="mt-2 text-sm text-red-200">{message ?? "The implementation workspace could not be loaded."}</p><button type="button" onClick={() => void hydrate()} className="mt-4 min-h-11 rounded-xl border border-red-300/40 px-4 py-2 text-sm text-red-100">Reload workspace</button></section>;

  return <section className="mt-8 space-y-6" aria-labelledby="implementation-workspace-heading">
    <div className="rounded-3xl border border-blue-400/25 bg-blue-500/[0.06] p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">S80 · Implementation Active</p>
      <h2 id="implementation-workspace-heading" className="mt-2 text-2xl font-semibold text-zinc-100">Human implementation workspace</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">Work on the approved actions for {caseNumber}. The approved S70 action plan below is controlled authority and read-only. This workspace records what a human reports as implemented and the evidence they provide.</p>
      <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-100"><strong>Control boundary:</strong> Owner-reported complete is not Quality acceptance. Save the human-owned implementation package, then submit it for separate S90 Implementation Review.</div>
    </div>

    {projection.implementation_review_return_cycle !== null ? <section className="rounded-3xl border border-amber-300/30 bg-amber-400/[0.06] p-5 sm:p-7" aria-labelledby="implementation-review-return-heading">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">S90 · Returned for owner rework</p>
      <h3 id="implementation-review-return-heading" className="mt-2 text-xl font-semibold text-zinc-100">Implementation Review return</h3>
      <p className="mt-2 text-sm text-zinc-400">The reviewer rationale below is immutable. Add a separate human owner response explaining how the implementation package addresses it.</p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><ReadOnly label="Reviewer" value={projection.implementation_review_return_cycle.returned_by_user_id} /><ReadOnly label="Returned at" value={projection.implementation_review_return_cycle.returned_at} /><ReadOnly label="S90 source version" value={projection.implementation_review_return_cycle.source_case_version_id} /><ReadOnly label="S80 rework version" value={projection.implementation_review_return_cycle.resulting_case_version_id} /><ReadOnly label="Return cycle" value={projection.implementation_review_return_cycle.return_transition_audit_event_id} /></dl>
      <div className="mt-4 rounded-2xl border border-amber-200/20 bg-zinc-950/30 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Immutable reviewer rationale</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{projection.implementation_review_return_cycle.rationale}</p></div>
      <label className="mt-4 block text-sm text-zinc-200"><span className="font-medium">Owner response to reviewer return</span><textarea aria-required="true" value={draft.implementation_review_return_response?.response_narrative ?? ""} onChange={(event) => setReturnResponse(event.target.value)} maxLength={4_000} className="mt-2 min-h-28 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100" placeholder="Explain the rework completed in response to the reviewer rationale." /><span className="mt-1 block text-xs text-amber-200">Required before resubmission. This response is stored separately from the reviewer rationale.</span></label>
    </section> : null}

    <div className="space-y-6">{projection.approved_actions.map((action, index) => {
      const progress = draft.action_progress.find((item) => item.approved_action_reference === action.approved_action_reference) ?? { approved_action_reference: action.approved_action_reference, owner_reported_status: "not_started" as const, implementation_narrative: null, blocked_reason: null, evidence: [] };
      return <ImplementationActionCard key={action.approved_action_reference} index={index} action={action} progress={progress} onStatus={setStatus} onBlockedReason={setBlockedReason} onNarrative={setNarrative} onAddEvidence={addEvidence} onRemoveEvidence={removeEvidence} onEvidenceChange={(evidenceId, patch) => { if (draft !== null) changeDraft({ ...draft, action_progress: updateEvidence(draft.action_progress, action.approved_action_reference, evidenceId, patch) }); }} onSourceChange={(evidenceId, patch) => { if (draft !== null) changeDraft({ ...draft, action_progress: updateSource(draft.action_progress, action.approved_action_reference, evidenceId, patch) }); }} />;
    })}</div>

    <CapaImplementationEvidenceAdvisoryPanel caseId={caseId} caseVersionId={projection.case_version_id} recordVersion={projection.record_version} draftFingerprint={currentFingerprint} actions={projection.approved_actions} onAdoptNarrative={adoptNarrative} />

    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/85 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm text-zinc-300">{saveStatus === "saved" ? `Saved${projection.draft_revision === null ? " · new durable workspace" : ` · durable revision ${projection.draft_revision}`}` : saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? `UNSAVED local changes · durable revision ${projection.draft_revision ?? "new"}` : saveStatus === "conflict" ? "CONFLICT · local changes were not saved" : "UNSAVED · local changes are not durable"}</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void hydrate()} disabled={saveStatus === "saving" || submissionStatus === "submitting"} className="min-h-11 rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50">Reload authoritative workspace</button><button type="button" onClick={() => void save()} disabled={saveStatus !== "unsaved"} className="min-h-11 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Save implementation workspace</button><button type="button" onClick={() => void submitForReview()} disabled={saveStatus !== "saved" || projection.draft_revision === null || submissionStatus === "submitting"} className="min-h-11 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{submissionStatus === "submitting" ? "Submitting…" : "Submit for implementation review"}</button></div></div>
      {message !== null && saveStatus !== "failed" && saveStatus !== "conflict" && submissionStatus !== "failed" && submissionStatus !== "conflict" ? <p className="mt-3 text-sm text-emerald-200">{message}</p> : null}
      {saveStatus === "conflict" ? <p role="alert" className="mt-3 text-sm text-amber-200">{message} Use reload to discard local changes and retrieve the newer server version.</p> : null}
      {saveStatus === "failed" ? <p role="alert" className="mt-3 text-sm text-red-200">{message}</p> : null}
      {submissionStatus === "conflict" ? <p role="alert" className="mt-3 text-sm text-amber-200">{message} Reload the authoritative workspace before submitting again.</p> : null}
      {submissionStatus === "failed" ? <p role="alert" className="mt-3 text-sm text-red-200">{message}</p> : null}
    </div>
  </section>;
}

function ImplementationActionCard({ index, action, progress, onStatus, onBlockedReason, onNarrative, onAddEvidence, onRemoveEvidence, onEvidenceChange, onSourceChange }: {
  readonly index: number;
  readonly action: CapaImplementationApprovedActionProjection;
  readonly progress: CapaImplementationActionProgress;
  readonly onStatus: (reference: string, status: CapaImplementationOwnerReportedStatus) => void;
  readonly onBlockedReason: (reference: string, reason: string) => void;
  readonly onNarrative: (reference: string, value: string) => void;
  readonly onAddEvidence: (reference: string) => void;
  readonly onRemoveEvidence: (reference: string, evidenceId: string) => void;
  readonly onEvidenceChange: (evidenceId: string, patch: Partial<CapaImplementationEvidence>) => void;
  readonly onSourceChange: (evidenceId: string, patch: Partial<CapaImplementationEvidenceSource>) => void;
}) {
  return <article className="rounded-3xl border border-zinc-800 bg-zinc-900/85 p-5 sm:p-7" aria-labelledby={`implementation-action-${index}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Approved action {index + 1}</p><h3 id={`implementation-action-${index}`} className="mt-1 text-xl font-semibold text-zinc-100">{label(action.description, "Approved action description unavailable")}</h3></div><span className="rounded-full border border-zinc-700 px-3 py-1 font-mono text-xs text-zinc-400">{action.approved_action_reference}</span></div>
    <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-400/[0.06] p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">Read-only approved S70 authority</p><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><ReadOnly label="Action type" value={label(action.action_type)} /><ReadOnly label="Approved status" value={label(action.status)} /><ReadOnly label="Due date" value={label(action.due_date)} /><ReadOnly label="Deliverable" value={label(action.deliverable)} /><ReadOnly label="Implementation expectation" value={label(action.implementation_expectation)} /><ReadOnly label="Acceptance criteria" value={action.acceptance_criteria.length === 0 ? "Not specified" : action.acceptance_criteria.join(" · ")} /></dl></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm text-zinc-200"><span className="font-medium">Owner-reported execution status</span><select aria-describedby={`status-help-${index}`} value={progress.owner_reported_status} onChange={(event) => onStatus(action.approved_action_reference, event.target.value as CapaImplementationOwnerReportedStatus)} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-zinc-100">{CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select><span id={`status-help-${index}`} className="mt-1 block text-xs text-zinc-500">This is the human owner report, not formal Quality acceptance.</span></label><div className="rounded-xl border border-zinc-800 p-3 text-sm text-zinc-400"><p className="font-medium text-zinc-200">Evidence boundary</p><p className="mt-1">Narrative describes implementation. Objective evidence is recorded separately below.</p></div></div>
    {progress.owner_reported_status === "blocked" ? <label className="mt-4 block text-sm text-zinc-200"><span className="font-medium">Blocked reason</span><textarea aria-required="true" value={progress.blocked_reason ?? ""} onChange={(event) => onBlockedReason(action.approved_action_reference, event.target.value)} maxLength={4_000} className="mt-2 min-h-20 w-full rounded-xl border border-amber-300/30 bg-zinc-950 p-3 text-zinc-100" placeholder="Explain what is blocking implementation" />{(progress.blocked_reason ?? "").trim().length === 0 ? <span className="mt-1 block text-xs text-amber-200">A blocked reason is required before saving.</span> : null}</label> : null}
    <label className="mt-4 block text-sm text-zinc-200"><span className="font-medium">Implementation narrative</span><textarea aria-label={`Implementation narrative for approved action ${index + 1}`} value={progress.implementation_narrative ?? ""} maxLength={4_000} onChange={(event) => onNarrative(action.approved_action_reference, event.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-100" placeholder="Describe what was actually implemented. Do not use this field as a substitute for objective evidence." /><span className="mt-1 block text-xs text-zinc-500">{(progress.implementation_narrative ?? "").length}/4,000 characters</span></label>
     <div className="mt-5 rounded-2xl border border-zinc-800 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold text-zinc-100">Objective implementation evidence</h4><p className="mt-1 text-xs text-zinc-500">Each entry belongs only to this approved action. Evidence records are human-entered; AI cannot create evidence.</p></div><button type="button" onClick={() => onAddEvidence(action.approved_action_reference)} className="min-h-10 rounded-xl border border-blue-300/30 px-3 py-2 text-sm text-blue-100">Add evidence</button></div><div className="mt-4 space-y-4">{progress.evidence.length === 0 ? <p className="text-sm text-zinc-500">No objective evidence has been recorded for this action.</p> : progress.evidence.map((evidence, evidenceIndex) => <EvidenceEditor key={evidence.evidence_id} index={evidenceIndex} evidence={evidence} onChange={onEvidenceChange} onSourceChange={onSourceChange} onRemove={() => onRemoveEvidence(action.approved_action_reference, evidence.evidence_id)} />)}</div></div>
  </article>;
}

function ReadOnly({ label: title, value }: { readonly label: string; readonly value: string }) {
  return <div><dt className="text-xs uppercase tracking-wide text-zinc-500">{title}</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-200">{value}</dd></div>;
}

function EvidenceEditor({ index, evidence, onChange, onSourceChange, onRemove }: { readonly index: number; readonly evidence: CapaImplementationEvidence; readonly onChange: (evidenceId: string, patch: Partial<CapaImplementationEvidence>) => void; readonly onSourceChange: (evidenceId: string, patch: Partial<CapaImplementationEvidenceSource>) => void; readonly onRemove: () => void }) {
  const source = evidence.source;
  return <fieldset className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4"><legend className="px-1 text-sm font-semibold text-zinc-200">Evidence {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-zinc-300">Evidence kind<select aria-label={`Evidence ${index + 1} kind`} value={evidence.evidence_kind} onChange={(event) => onChange(evidence.evidence_id, { evidence_kind: event.target.value as CapaImplementationEvidenceKind })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-zinc-100">{CAPA_IMPLEMENTATION_EVIDENCE_KINDS.map((kind) => <option key={kind} value={kind}>{EVIDENCE_LABELS[kind]}</option>)}</select></label><label className="text-sm text-zinc-300">Evidence date<input aria-label={`Evidence ${index + 1} date`} type="date" value={evidence.evidence_date} onChange={(event) => onChange(evidence.evidence_id, { evidence_date: event.target.value })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-zinc-100" /></label></div><label className="mt-3 block text-sm text-zinc-300">Evidence description<textarea aria-label={`Evidence ${index + 1} description`} maxLength={4_000} value={evidence.description} onChange={(event) => onChange(evidence.evidence_id, { description: event.target.value })} className="mt-2 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-zinc-100" placeholder="Describe the evidence that exists and supports this action." /></label><div className="mt-4 border-t border-zinc-800 pt-4"><p className="text-sm font-semibold text-zinc-200">Evidence provenance</p><p className="mt-1 text-xs text-zinc-500">Vendor-neutral source details. Enter only references that actually exist.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm text-zinc-300">Origin kind<select value={source.origin_kind} onChange={(event) => onSourceChange(evidence.evidence_id, { origin_kind: event.target.value as CapaImplementationProvenanceOriginKind })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-zinc-100">{CAPA_IMPLEMENTATION_PROVENANCE_ORIGIN_KINDS.map((kind) => <option key={kind} value={kind}>{ORIGIN_LABELS[kind]}</option>)}</select></label><label className="text-sm text-zinc-300">Source system kind<select value={source.source_system_kind} onChange={(event) => onSourceChange(evidence.evidence_id, { source_system_kind: event.target.value as CapaImplementationProvenanceSourceSystemKind })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-zinc-100">{CAPA_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KINDS.map((kind) => <option key={kind} value={kind}>{SYSTEM_LABELS[kind]}</option>)}</select></label></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><TextSourceField label="Source system name" value={source.source_system_name} onChange={(value) => onSourceChange(evidence.evidence_id, { source_system_name: value.length === 0 ? null : value })} /><TextSourceField label="Source record reference" value={source.source_record_reference} onChange={(value) => onSourceChange(evidence.evidence_id, { source_record_reference: value.length === 0 ? null : value })} /><label className="text-sm text-zinc-300">Source record version<input value={source.source_record_version === null ? "" : String(source.source_record_version)} onChange={(event) => onSourceChange(evidence.evidence_id, { source_record_version: event.target.value.length === 0 ? null : (/^\d+$/.test(event.target.value) ? Number(event.target.value) : event.target.value) })} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-zinc-100" /></label><TextSourceField label="Artifact reference" value={source.artifact_reference} onChange={(value) => onSourceChange(evidence.evidence_id, { artifact_reference: value.length === 0 ? null : value })} /></div></div><div className="mt-4 flex justify-end"><button type="button" onClick={onRemove} className="min-h-10 rounded-xl border border-red-300/30 px-3 py-2 text-sm text-red-200">Remove draft evidence</button></div></fieldset>;
}

function TextSourceField({ label: title, value, onChange }: { readonly label: string; readonly value: string | null; readonly onChange: (value: string) => void }) {
  return <label className="text-sm text-zinc-300">{title}<input value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-zinc-100" /></label>;
}

function CapaImplementationEvidenceAdvisoryPanel({ caseId, caseVersionId, recordVersion, draftFingerprint, actions, onAdoptNarrative }: { readonly caseId: string; readonly caseVersionId: string; readonly recordVersion: number; readonly draftFingerprint: string; readonly actions: readonly CapaImplementationApprovedActionProjection[]; readonly onAdoptNarrative: (reference: string, value: string) => void }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [result, setResult] = useState<CapaImplementationEvidenceAdvisoryClientSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adoptionMessage, setAdoptionMessage] = useState<string | null>(null);
  const [generatedFingerprint, setGeneratedFingerprint] = useState<string | null>(null);
  const [adoptingFinding, setAdoptingFinding] = useState<string | null>(null);
  const latestFingerprint = useRef(draftFingerprint);

  useEffect(() => {
    latestFingerprint.current = draftFingerprint;
  }, [draftFingerprint]);

  const stale = generatedFingerprint !== null && generatedFingerprint !== draftFingerprint;

  async function generate() {
    setStatus("loading");
    setError(null);
    setAdoptionMessage(null);
    const requestedFingerprint = latestFingerprint.current;
    const next = await generateCapaImplementationEvidenceAdvisory(caseId, caseVersionId, recordVersion);
    if (latestFingerprint.current !== requestedFingerprint) {
      setStatus("failed");
      setError("The workspace changed while the advisory was generated. Generate a new advisory for the current draft.");
      return;
    }
    if (next.status === "failed") {
      setStatus("failed");
      setError(next.message);
      return;
    }
    if (next.value.snapshot.capa_case_id !== caseId || next.value.snapshot.case_version_id !== caseVersionId || next.value.snapshot.record_version !== recordVersion) {
      setStatus("failed");
      setError("The CAPA version changed while the advisory was generated. Reload the workspace before trying again.");
      return;
    }
    setResult(next.value);
    setGeneratedFingerprint(requestedFingerprint);
    setStatus("ready");
  }

  async function adopt(finding: CapaImplementationEvidenceAdvisoryClientSuccess["advisory"]["findings"][number]) {
    if (stale || !finding.adoption.eligible || finding.adoption.field !== "implementation_narrative" || finding.adoption.suggested_value === null || result === null) return;
    setAdoptingFinding(finding.finding_id);
    setError(null);
    const next = await prepareCapaImplementationEvidenceAdvisoryAdoption(caseId, { output_id: result.advisory.output_id as string, finding_id: finding.finding_id, expected_case_version_id: caseVersionId, expected_record_version: recordVersion });
    if (next.status === "failed") {
      setError(next.message);
      setAdoptingFinding(null);
      return;
    }
    onAdoptNarrative(next.value.patch.approved_action_reference, next.value.patch.value);
    setAdoptionMessage("Suggestion adopted into the local narrative draft. Review and edit it, then save the workspace deliberately.");
    setAdoptingFinding(null);
  }

  return <section className="rounded-3xl border border-violet-400/20 bg-violet-500/[0.05] p-5 sm:p-7" aria-labelledby="implementation-advisory-heading"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">AG-IMPLEMENT · GOVERNED AI ADVISORY</p><h2 id="implementation-advisory-heading" className="mt-1 text-xl font-semibold text-zinc-100">Implementation-evidence advisory</h2></div><button type="button" onClick={() => void generate()} disabled={status === "loading"} className="min-h-11 rounded-xl border border-violet-300/40 bg-violet-400/10 px-4 py-2 text-sm font-semibold text-violet-100 disabled:opacity-50">{status === "loading" ? "Generating…" : stale ? "Generate new advisory" : "Generate advisory"}</button></div><p className="mt-3 text-sm leading-6 text-zinc-400">Request structured advisory findings about implementation evidence, provenance, and alignment with approved actions. The advisory is not an acceptance decision and cannot create evidence, mark completion, change the baseline, or submit S80. Adoption does not create evidence.</p><p className="mt-2 text-xs text-zinc-500">Adoption does not save automatically. Adoption does not submit automatically; it prepares an editable local narrative patch for human review.</p>{stale ? <p role="alert" className="mt-4 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm text-amber-100">This advisory reflects an earlier local draft. Generate a new advisory before adopting a suggestion.</p> : null}{error !== null ? <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}{adoptionMessage !== null ? <p role="status" className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">{adoptionMessage}</p> : null}{result !== null && !stale ? <AdvisoryResult result={result} actions={actions} adoptingFinding={adoptingFinding} onAdopt={adopt} /> : null}</section>;
}

function AdvisoryResult({ result, actions, adoptingFinding, onAdopt }: { readonly result: CapaImplementationEvidenceAdvisoryClientSuccess; readonly actions: readonly CapaImplementationApprovedActionProjection[]; readonly adoptingFinding: string | null; readonly onAdopt: (finding: CapaImplementationEvidenceAdvisoryClientSuccess["advisory"]["findings"][number]) => Promise<void> }) {
  const actionName = new Map(actions.map((action) => [action.approved_action_reference, label(action.description, action.approved_action_reference)]));
  return <div className="mt-5 space-y-4" role="status"><div className="rounded-xl border border-violet-300/25 bg-violet-400/10 p-3 text-sm text-violet-100"><p className="font-semibold">Advisory only — human review required</p><p className="mt-1 text-xs text-violet-200/80">Generated findings are contextual guidance, not Quality approval or an implementation record.</p></div><p className="text-sm text-zinc-200">{result.advisory.advisory_summary}</p>{result.advisory.findings.length === 0 ? <p className="text-sm text-zinc-500">No findings were returned for this snapshot.</p> : <div className="space-y-4">{result.advisory.findings.map((finding) => <article key={finding.finding_id} className="rounded-2xl border border-violet-300/20 bg-zinc-950/40 p-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-violet-300/30 px-2 py-1 text-xs text-violet-200">{finding.severity}</span><span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300">{finding.category}</span><span className="text-xs text-zinc-500">Action: {actionName.get(finding.approved_action_reference) ?? finding.approved_action_reference}</span></div><p className="mt-3 text-sm font-semibold text-zinc-100">{finding.finding}</p><p className="mt-2 text-sm leading-6 text-zinc-400">{finding.rationale}</p><p className="mt-3 text-sm text-zinc-300"><strong>Suggested human action:</strong> {finding.suggested_human_action}</p>{finding.evidence_reference_ids.length > 0 ? <p className="mt-2 text-xs text-zinc-500">Evidence references: {finding.evidence_reference_ids.join(", ")}</p> : null}{finding.reference_keys.length > 0 ? <p className="mt-2 text-xs text-zinc-500">Governed references: {finding.reference_keys.join(", ")}</p> : null}{result.advisory.citations.filter((citation) => finding.reference_keys.includes(citation.reference_key)).map((citation) => <div key={citation.reference_key} className="mt-2 rounded-lg border border-zinc-800 p-2 text-xs text-zinc-400"><span className="font-medium text-zinc-300">{citation.reference_key}</span> · {citation.source_kind} · {citation.source_reference}{citation.locator === null ? "" : ` · ${citation.locator}`} · {citation.source_status}</div>)}{finding.adoption.eligible && finding.adoption.field === "implementation_narrative" && finding.adoption.suggested_value !== null ? <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] p-3"><p className="text-xs uppercase tracking-wide text-emerald-300">Eligible narrative suggestion</p><p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{finding.adoption.suggested_value}</p><button type="button" disabled={adoptingFinding !== null} onClick={() => void onAdopt(finding)} className="mt-3 min-h-10 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{adoptingFinding === finding.finding_id ? "Preparing…" : "Adopt into local narrative draft"}</button><p className="mt-2 text-xs text-zinc-500">Adoption prepares a local editable patch only. Nothing is saved automatically.</p></div> : <p className="mt-3 text-xs text-zinc-500">Advisory guidance only; no direct evidence or status patch is available.</p>}</article>)}</div>}{result.advisory.warnings.length > 0 ? <p className="text-xs text-amber-200">Warnings: {result.advisory.warnings.join(" ")}</p> : null}{result.advisory.uncertainty_and_limitations.length > 0 ? <p className="text-xs text-zinc-500">Limitations: {result.advisory.uncertainty_and_limitations.join(" ")}</p> : null}<p className="text-xs text-violet-200">Human review required. Correlation ID: {result.correlation_id}</p></div>;
}
